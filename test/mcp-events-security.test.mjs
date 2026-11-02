import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {
 EVENT_NAME,EVENT_CATALOG,canonicalEventArguments,callbackHost,
 isPublicIPv4,resolveVerifiedCallbackTarget,validateEventSubscription,
 signStandardWebhook,verifyChallengeEcho,createAuthenticatedEventAdmission
} from '../src/mcp-events-security.mjs';

const secret='whsec_'+randomBytes(32).toString('base64');
const params={name:EVENT_NAME,arguments:{project_id:'rc-owner-qa'},
 delivery:{mode:'webhook',url:'https://callbacks.chatgpt.com/commander/verified',secret},cursor:null};
const owner={verifiedHostPrincipal:'chat-principal-verified-in-test-only',
 authenticatedByHost:true,authorizedProjectIds:['rc-owner-qa']};
test('event metadata is a narrowly filtered webhook contract, not delivery acknowledgment',()=>{
 assert.equal(EVENT_CATALOG.name,EVENT_NAME);
 assert.equal(EVENT_CATALOG.inputSchema.additionalProperties,false);
 assert.deepEqual(EVENT_CATALOG.payloadSchema.required,
  ['project_id','correlation_id','delivery_id','state']);
});
test('no authenticated host principal means fail-closed, profile identity is insufficient',()=>{
 assert.throws(()=>validateEventSubscription(params,{}),/AUTHENTICATED_CHAT_PRINCIPAL_REQUIRED/);
 assert.throws(()=>validateEventSubscription(params,{...owner,authenticatedByHost:false}),/AUTHENTICATED_CHAT_PRINCIPAL_REQUIRED/);
 assert.throws(()=>validateEventSubscription(params,{...owner,authorizedProjectIds:['other']}),/OWNER_NOT_AUTHORIZED/);
});
test('stable identity binds verified principal, URL, event and project',()=>{
 const a=validateEventSubscription(params,owner);
 const b=validateEventSubscription({...params,arguments:{project_id:'rc-owner-qa'}},owner);
 assert.equal(a.subscriptionId,b.subscriptionId);
 assert.notEqual(a.subscriptionId,validateEventSubscription(params,{...owner,verifiedHostPrincipal:'another'}).subscriptionId);
 assert.ok(!JSON.stringify({...a,signingKey:undefined}).includes(secret));
 assert.equal(a.signingKey.length,32);
});
test('invalid argument and replay requests rejected',()=>{
 for(const args of [{},{project_id:'a',extra:true},{project_id:'../etc'},{project_id:3},null]){
  assert.throws(()=>canonicalEventArguments(args),/FILTER_INVALID/);
 }
 assert.throws(()=>validateEventSubscription({...params,cursor:'old'},owner),/REPLAY_NOT_SUPPORTED/);
 assert.throws(()=>validateEventSubscription({...params,name:'other'},owner),/EVENT_INVALID/);
});
test('callback rejects non-HTTPS, credentials, IP literals and internal names',()=>{
 for(const url of ['http://example.org/hook','https://localhost/a','https://app.local/abc',
  'https://10.1.1.2/a','https://127.0.0.1/','https://user:pass@example.org/',
  'https://example.org:8443/','https://example.org/#frag','https://host.internal/a']){
  assert.throws(()=>callbackHost(url),/URL_UNTRUSTED/);
 }
 assert.equal(callbackHost('https://events.chatgpt.com/a').hostname,'events.chatgpt.com');
});
test('private, metadata, documentation and mapped targets fail closed',async()=>{
 for(const ip of ['127.0.0.1','10.3.4.5','169.254.169.254','100.64.1.3',
  '172.19.2.3','192.168.1.1','192.0.2.1','198.51.100.2','203.0.113.1','::1']){
  assert.equal(isPublicIPv4(ip),false,ip);
  await assert.rejects(resolveVerifiedCallbackTarget('https://events.chatgpt.com/a',
   async()=>[{address:ip,family:ip.includes(':')?6:4}]),/DNS_NOT_PUBLIC/);
 }
 assert.equal(isPublicIPv4('8.8.8.8'),true);
 assert.equal((await resolveVerifiedCallbackTarget('https://events.chatgpt.com/a',
  async()=>[{address:'8.8.8.8',family:4}])).address,'8.8.8.8');
 await assert.rejects(resolveVerifiedCallbackTarget('https://events.chatgpt.com/a',
  async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]),/DNS_NOT_PUBLIC/);
});
test('Standard Webhooks signature uses exact body and timing safe challenge echo',()=>{
 const key=Buffer.from(secret.slice(6),'base64');
 const sig=signStandardWebhook(key,'msg_123',1730000000,'{"type":"verification","challenge":"abc"}');
 assert.match(sig,/^v1,[A-Za-z0-9+/]+={0,2}$/);
 assert.notEqual(sig,signStandardWebhook(key,'msg_123',1730000000,'{"type":"verification","challenge":"abd"}'));
 assert.equal(verifyChallengeEcho('abc','abc'),true);
 assert.equal(verifyChallengeEcho('abc','abd'),false);
});

test('OAuth issuer/audience/scope and owner ACL are mandatory before subscription',async()=>{
 const issuer='https://idp.example.test';
 const resource='https://mcp.example.test/mcp';
 const claims={issuer,resource,subject:'person-a',tenantId:'tenant-1',
  expiresAt:Math.floor(Date.now()/1000)+900,scopes:['commander.events.subscribe']};
 const gate=createAuthenticatedEventAdmission({
  issuer,resource,
  verifyAccessToken:async token=>{if(token!=='valid-opaque-test-token')throw new Error('bad');return claims;},
  resolveProjectAccess:async id=>id==='rc-owner-qa'?{
   id,ownerSubject:'person-a',ownerIssuer:issuer,tenantId:'tenant-1'
  }:null
 });
 const granted=await gate(params,'valid-opaque-test-token');
 assert.ok(granted.subscriptionId.startsWith('sub_'));
 await assert.rejects(gate(params,'invalid'),/unauthorized/i);
 await assert.rejects(gate({...params,arguments:{project_id:'other'}},'valid-opaque-test-token'),/forbidden/i);
 const expired=createAuthenticatedEventAdmission({
  issuer,resource,
  verifyAccessToken:async()=>({...claims,expiresAt:1}),
  resolveProjectAccess:async()=>{throw new Error('expired token must never reach ACL');}
 });
 await assert.rejects(expired(params,'valid-opaque-test-token'),/unauthorized/i);
});
