import test from 'node:test';
import assert from 'node:assert/strict';
import {createV2NativeOwnerSessionBindings} from '../src/v2-native-owner-session-bindings.mjs';

const route=(chat)=>({
  hostId:'host',principalId:'owner',profileId:'profile',
  conversationId:chat,operationId:'write',
  target:{kind:'workflow-root',id:'flow-'+chat}
});
function fixture(){
 let now=1780000000000,seat='owner-seat',allow=true,revoker=true,
  active=new Map([['chat-a',route('chat-a')],['chat-b',route('chat-b')]]);
 const registry=createV2NativeOwnerSessionBindings({
  now:()=>now,ttlMs:4000,
  attestPlatformSession:async proof=>proof?.verified===true?proof.handle:null,
  resolveOwnerRoute:async handle=>active.get(handle),
  observedNativeSession:async()=>seat,
  authorizeBinding:async()=>allow,
  authorizeRevocation:async({adminProof})=>revoker&&adminProof==='trusted-owner'
 });
 return {registry,bind:chat=>registry.bindTrusted({verified:true,handle:chat}),
  setSeat:v=>{seat=v;},setAllow:v=>{allow=v;},setRevoke:v=>{revoker=v;},
  setRoute:(chat,r)=>active.set(chat,r),advance:ms=>{now+=ms;}};
}
test('two independent chats share one OS seat but retain isolated trusted routes',async()=>{
 const f=fixture();try{
  assert.deepEqual((await f.bind('chat-a')).sessionHandle,'chat-a');
  await f.bind('chat-b');
  assert.equal(f.registry.size,2);
  const a=await f.registry.resolveNativeRoute('chat-a');
  const b=await f.registry.resolveNativeRoute('chat-b');
  assert.equal(a.conversationId,'chat-a');
  assert.equal(b.conversationId,'chat-b');
  assert.equal(Object.isFrozen(a),true);
  assert.equal(await f.registry.revokeTrusted({
   sessionHandle:'chat-b',adminProof:'trusted-owner'
  }),true);
  await assert.rejects(f.registry.resolveNativeRoute('chat-b'),
   {code:'V2_SESSION_NOT_BOUND'});
  assert.equal((await f.registry.resolveNativeRoute('chat-a')).conversationId,'chat-a');
 }finally{f.registry.close();}
});
test('untrusted platform proof, missing consent and forged revocation fail closed',async()=>{
 const f=fixture();try{
  await assert.rejects(f.registry.bindTrusted({verified:false,handle:'chat-a'}),
   {code:'V2_SESSION_PLATFORM_ATTESTATION_REQUIRED'});
  f.setAllow(false);
  await assert.rejects(f.bind('chat-a'),
   {code:'V2_SESSION_OWNER_CONSENT_REQUIRED'});
  assert.equal(f.registry.size,0);
  f.setAllow(true);
  await f.bind('chat-a');
  await assert.rejects(f.bind('chat-a'),{code:'V2_SESSION_BINDING_EXISTS'});
  await assert.rejects(f.registry.revokeTrusted({
   sessionHandle:'chat-a',adminProof:'forged-owner'
  }),{code:'V2_SESSION_REVOKE_AUTH_REQUIRED'});
  assert.equal((await f.registry.resolveNativeRoute('chat-a')).conversationId,'chat-a');
 }finally{f.registry.close();}
});
test('session binding expires and cannot survive a changed native seat or chat route',async()=>{
 const f=fixture();try{
  await f.bind('chat-a');await f.bind('chat-b');
  f.setSeat('new-desktop-seat');
  await assert.rejects(f.registry.resolveNativeRoute('chat-a'),
   {code:'V2_SESSION_TRUST_LOST'});
  assert.equal(f.registry.size,1);
  f.setSeat('owner-seat');
  f.setRoute('chat-b',route('chat-c'));
  await assert.rejects(f.registry.resolveNativeRoute('chat-b'),
   {code:'V2_SESSION_TRUST_LOST'});
  await f.bind('chat-a');
  f.advance(4001);
  await assert.rejects(f.registry.resolveNativeRoute('chat-a'),
   {code:'V2_SESSION_BINDING_EXPIRED'});
  assert.equal(f.registry.size,0);
 }finally{f.registry.close();}
});
test('owner consent cannot authorize a binding already changed while awaiting',async()=>{
 let routeValue=route('chat-a'),seat='seat-one',consentCalls=0;
 const r=createV2NativeOwnerSessionBindings({
  now:()=>1780000000000,
  attestPlatformSession:async proof=>proof.valid?'chat-a':null,
  resolveOwnerRoute:async()=>routeValue,
  observedNativeSession:async()=>seat,
  authorizeBinding:async()=>{
   consentCalls++;if(consentCalls===1)routeValue=route('chat-b');
   else if(consentCalls===2)seat='seat-two';
   return true;
  },
  authorizeRevocation:async()=>true
 });
 try{
  await assert.rejects(r.bindTrusted({valid:true}),
   {code:'V2_SESSION_BINDING_CHANGED_DURING_CONSENT'});
  routeValue=route('chat-a');
  await assert.rejects(r.bindTrusted({valid:true}),
   {code:'V2_SESSION_BINDING_CHANGED_DURING_CONSENT'});
  await r.bindTrusted({valid:true});
  assert.equal((await r.resolveNativeRoute('chat-a')).conversationId,'chat-a');
 }finally{r.close();}
});

test('expired sessions release bounded owner registry capacity without reuse of live bindings',async()=>{
 let now=1780000000000;
 const r=createV2NativeOwnerSessionBindings({
  now:()=>now,maxBindings:1,ttlMs:1000,
  attestPlatformSession:async proof=>proof.verified?proof.chat:null,
  resolveOwnerRoute:async chat=>route(chat),
  observedNativeSession:async()=> 'owner-seat',
  authorizeBinding:async()=>true,authorizeRevocation:async()=>true
 });
 try{
  await r.bindTrusted({verified:true,chat:'chat-a'});
  await assert.rejects(r.bindTrusted({verified:true,chat:'chat-b'}),
   {code:'V2_SESSION_CAPACITY_REACHED'});
  now+=1000;
  await r.bindTrusted({verified:true,chat:'chat-b'});
  assert.equal(r.size,1);
  await assert.rejects(r.resolveNativeRoute('chat-a'),
   {code:'V2_SESSION_NOT_BOUND'});
  assert.equal((await r.resolveNativeRoute('chat-b')).conversationId,'chat-b');
 }finally{r.close();}
});
