import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,sign} from 'node:crypto';
import {MutationIdempotencyStore} from '../src/mutation-idempotency.mjs';
import {V2GrantRegistry} from '../src/v2-grant-registry.mjs';
import {createV2NativeOwnerAssertionIssuer} from '../src/v2-caller-assertion.mjs';
import {createV2JwksTokenVerifier} from '../src/v2-oauth-jwks.mjs';
import {createV2OAuthV1McpDispatcher} from '../src/v2-oauth-v1-mcp-dispatcher.mjs';
import {createV2CandidateHttpIngress} from '../src/v2-mcp-http-ingress.mjs';

const now=1780000000000,iss='https://mmz-test-idp.example',
 resource='https://mmz-test-mcp.example/mcp-v2';
const route={hostId:'mmz',principalId:'owner',profileId:'mmz-profile',
 conversationId:'owner-chat',operationId:'read-once',
 target:{kind:'host-shell',id:'mmz'}};
const args={};
test('isolated protected HTTP V2 -> signed JWT/JWKS -> native binding -> grant -> once-only V1 gateway',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v2-oauth-http-parity-'));
 const g=new V2GrantRegistry({directory:path.join(root,'grants'),
  authorizeAdministration:({actor})=>actor==='qa-admin'});
 const receipts=new MutationIdempotencyStore({directory:path.join(root,'receipts'),scope:'mmz'});
 const oauth=generateKeyPairSync('ed25519'),native=generateKeyPairSync('ed25519');
 const pub={...oauth.publicKey.export({format:'jwk'}),kid:'qa-jwt',use:'sig',alg:'EdDSA'};
 const verifier=createV2JwksTokenVerifier({
  issuer:iss,audience:resource,jwksUri:iss+'/keys',
  now:()=>now,request:async()=>new Response(JSON.stringify({keys:[pub]}),{status:200})
 });
 const head=Buffer.from(JSON.stringify({alg:'EdDSA',typ:'at+jwt',kid:'qa-jwt'})).toString('base64url');
 const claims=Buffer.from(JSON.stringify({iss,aud:resource,sub:'owner-sub',scope:'commander.full',
  nbf:Math.floor(now/1000)-1,exp:Math.floor(now/1000)+60})).toString('base64url');
 const unsigned=head+'.'+claims;
 const bearer=unsigned+'.'+sign(null,Buffer.from(unsigned),oauth.privateKey).toString('base64url');
 let effects=0,transportOkay=true,observed='owner-seat',nativeIssues=0;
 const nativeIssue=createV2NativeOwnerAssertionIssuer({
  issuer:'qa-native-issuer',audience:'v2-private',keyId:'native-kid',
  privateKey:native.privateKey,now:()=>now,nonce:()=> 'qa-'+(++nativeIssues),
  resolveNativeRoute:async handle=>handle==='trusted-chat-session'?route:null,
  observedNativeSession:async()=>observed,authorizeIssue:async({route:r,tool})=>
   r.conversationId==='owner-chat'&&tool==='system_status'
 });
 const ingress=createV2CandidateHttpIngress({
  resource,authorizationServers:[iss],scopes:['commander.full'],
  attestTransport:async()=>({authenticated:transportOkay,sessionHandle:'trusted-chat-session'}),
  dispatcherFactory:async verifiedSession=>createV2OAuthV1McpDispatcher({
   resource,authorizationServers:[iss],scopes:['commander.full'],
   issuer:iss,audience:resource,verifyAccessToken:verifier,
   resolvePrincipal:async subject=>subject==='owner-sub'?'owner':null,
   resolveTrustedInvocation:async action=>{
    assert.equal(verifiedSession.sessionHandle,'trusted-chat-session');
    return nativeIssue({sessionHandle:verifiedSession.sessionHandle,
     tool:action.tool,args:action.arguments});
   },
   assertionTrust:{issuer:'qa-native-issuer',audience:'v2-private',
    publicKeys:new Map([['native-kid',native.publicKey]])},
   observedNativeSession:async()=>observed,grantRegistry:g,
   receiptStore:receipts,withLease:async(_key,fn)=>fn(),
   localGateway:{call:async ({tool})=>{
    assert.equal(tool,'system_status');effects++;
    return {result:{isError:false,
     structuredContent:{ok:true,privateData:'QA_PRIVATE_DONT_PERSIST'}}};
   }},now:()=>now
  })
 });
 const server=ingress.createUnboundServer();
 try{
  await new Promise((resolve,reject)=>{
   server.once('error',reject);server.listen(0,'127.0.0.1',resolve);
  });
  const base='http://127.0.0.1:'+server.address().port;
  const metadata=await fetch(base+ingress.protectedResource.metadataPath);
  assert.equal(metadata.status,200);
  assert.deepEqual((await metadata.json()).authorization_servers,[iss]);
  const rpc=async(token,meta)=>{
   const response=await fetch(base+'/mcp-v2',{method:'POST',headers:{
    'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
    body:JSON.stringify({jsonrpc:'2.0',id:'qa-call',method:'tools/call',
     params:{name:'v2_v1_protected_call',arguments:{tool:'system_status',arguments:args},
      ...(meta?{_meta:meta}:{})}})
   });
   return {code:response.status,data:await response.json()};
  };
  const missing=await rpc(null);
  assert.equal(missing.code,200);
  assert.equal(missing.data.result.isError,true);
  assert.ok(missing.data.result._meta['mcp/www_authenticate']);
  assert.equal(effects,0);
  const forged=await rpc(bearer.slice(0,-3)+'bad');
  assert.equal(forged.data.result.isError,true);assert.equal(effects,0);
  const denied=await rpc(bearer);
  assert.equal(denied.data.result.isError,true);assert.equal(effects,0);
  assert.equal(denied.data.result._meta,undefined);
  g.change({route,tool:'system_status',status:'ENABLED',expectedRevision:0,
   actor:'qa-admin',reason:'synthetic read-only QA grant'});
  const first=await rpc(bearer);
  assert.equal(first.data.result.isError,false);
  assert.equal(first.data.result.structuredContent.privateData,'QA_PRIVATE_DONT_PERSIST');
  assert.equal(effects,1);
  const duplicate=await rpc(bearer);
  assert.equal(duplicate.data.result.structuredContent.privateOutputStored,false);
  assert.equal(effects,1);
  assert.ok(!JSON.stringify(duplicate).includes('QA_PRIVATE_DONT_PERSIST'));
  assert.ok(!fs.readFileSync(receipts.location,'utf8').includes('QA_PRIVATE_DONT_PERSIST'));
  const mismatched=await rpc(bearer,{'openai/session':'different-session'});
  assert.equal(mismatched.code,403);assert.equal(effects,1);
  g.change({route,tool:'system_status',status:'REVOKED',expectedRevision:1,
   actor:'qa-admin',reason:'synthetic revoke'});
  assert.equal((await rpc(bearer)).data.result.isError,true);
  assert.equal(effects,1);
  transportOkay=false;
  assert.equal((await rpc(bearer)).code,403);
  assert.equal(effects,1);
 }finally{
  server.closeAllConnections();
  await new Promise(ok=>server.close(ok));
  g.close();receipts.close();fs.rmSync(root,{recursive:true,force:true});
 }
});
