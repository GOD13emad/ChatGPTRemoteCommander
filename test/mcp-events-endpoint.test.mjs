import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as signJwt} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createConfiguredEventsEndpoint} from '../src/mcp-events-endpoint.mjs';
import {EVENT_NAME} from '../src/mcp-events-security.mjs';

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const b64=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
const issuer='https://identity.example.org';
const resource='https://commander.example.org/mcp';
const makeJwt=(overrides={})=>{
 const h=b64({alg:'RS256',typ:'JWT'});
 const p=b64({iss:issuer,aud:resource,sub:'person-a',tenant_id:'org-a',
  exp:1730000000+3600,scope:'commander.events.subscribe',...overrides});
 return h+'.'+p+'.'+signJwt('RSA-SHA256',Buffer.from(h+'.'+p),privateKey).toString('base64url');
};
const params={name:EVENT_NAME,arguments:{project_id:'rc-private-qa'},
 delivery:{mode:'webhook',url:'https://callbacks.chatgpt.com/test',
 secret:'whsec_'+Buffer.alloc(32,23).toString('base64')},cursor:null};
const principal='Bearer '+makeJwt();
test('disabled configuration has no event methods and cannot advertise events',()=>{
 assert.equal(createConfiguredEventsEndpoint({}),null);
 assert.equal(createConfiguredEventsEndpoint({mcpEvents:{enabled:false}}),null);
});
test('real RS256 signing key and per-project owner ACL gate a persisted event subscription',async()=>{
 const d=await mkdtemp(path.join(os.tmpdir(),'mcp-events-auth-'));
 try{
  const file=path.join(d,'events.json');
  const config={mcpEvents:{enabled:true,authType:'oauth-pinned-rs256',issuer,resource,
   publicKeyPem:publicKey.export({type:'spki',format:'pem'}),
   projects:[{id:'rc-private-qa',ownerSubject:'person-a',tenantId:'org-a',ownerIssuer:issuer}],
   storeFile:file}};
  const send=async ({body})=>{
   const v=JSON.parse(body);
   return {status:200,body:JSON.stringify({challenge:v.challenge})};
  };
  const factory=()=>createConfiguredEventsEndpoint(config,{send,now:()=>1730000000*1000});
  assert.deepEqual(factory().capabilities,{events:{}});
  assert.equal((await factory().dispatch('events/list',{},principal)).events[0].name,EVENT_NAME);
  const subscribed=await factory().dispatch('events/subscribe',params,principal);
  assert.ok(subscribed.id.startsWith('sub_'));
  assert.equal(JSON.parse(await readFile(file,'utf8')).subscriptions.length,1);
  assert.equal((await factory().inspect()).count,1);
  assert.equal((await factory().dispatch('events/subscribe',params,principal)).id,subscribed.id);
  await assert.rejects(factory().dispatch('events/list',{},undefined),/TOKEN_MISSING/);
  await assert.rejects(factory().dispatch('events/list',{},'Bearer '+makeJwt({sub:'another'})),/CATALOG_FORBIDDEN/);
  await assert.rejects(factory().dispatch('events/list',{},'Bearer '+makeJwt({aud:'https://evil.example.org'})),/JWT_AUDIENCE/);
  await assert.rejects(factory().dispatch('events/list',{},'Bearer '+makeJwt({exp:1})),/CATALOG_FORBIDDEN/);
  await assert.rejects(factory().dispatch('events/list',{},'Bearer '+makeJwt({scope:'other'})),/CATALOG_FORBIDDEN/);
  await assert.rejects(factory().dispatch('events/list',{},'Bearer '+makeJwt({tenant_id:'other'})),/CATALOG_FORBIDDEN/);
  await assert.rejects(factory().dispatch('events/list',{},'Bearer '+makeJwt({nbf:1730000050})),/JWT_CLOCK/);
  const parts=principal.slice(7).split('.');
  parts[1]=b64({iss:issuer,aud:resource,sub:'person-b',tenant_id:'org-a',
   exp:1730000500,scope:'commander.events.subscribe'});
  await assert.rejects(factory().dispatch('events/list',{},'Bearer '+parts.join('.')),/JWT_SIGNATURE/);
  assert.deepEqual(await factory().dispatch('events/unsubscribe',{
   ...params,delivery:{mode:'webhook',url:params.delivery.url}
  },principal),{});
  assert.equal((await factory().inspect()).count,0);
 }finally{await rm(d,{recursive:true,force:true});}
});
test('weak/missing RSA key or missing project ACL prevents opt in at startup',()=>{
 for(const extra of [{publicKeyPem:'invalid'},{projects:[]},{storeFile:'relative.json'}]){
  assert.throws(()=>createConfiguredEventsEndpoint({mcpEvents:{
   enabled:true,authType:'oauth-pinned-rs256',issuer,resource,
   publicKeyPem:publicKey.export({type:'spki',format:'pem'}),
   projects:[{id:'rc-private-qa',ownerSubject:'person-a',tenantId:'org-a',ownerIssuer:issuer}],
   storeFile:'/tmp/safe.json',...extra}}));
 }
});
