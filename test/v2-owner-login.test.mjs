import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveV2OwnerLogin,V2_DEFAULT_NATIVE_LOGIN_METHODS} from '../src/v2-owner-login.mjs';
const route=(chat='chat-a')=>({hostId:'host',principalId:'owner',profileId:'personal',
 conversationId:chat,operationId:'login-a',target:{kind:'browser-target',id:'brave'}});
function fixture(){
 const events=[],methods=new Map(),owner={
  appId:'brave',hostId:'host',principalId:'owner',seatId:'seat-1',
  windowId:'win-1',processStartId:'start-1',pid:44,present:true,
  backgroundReady:true,ownerSessionReady:true
 };
 let currentRoute=route(),auth='SIGNED_IN',nativeStart='start-1',coverage=true;
 const services={
  sessions:{resolveNativeRoute:async()=>currentRoute},
  observedNativeSeat:async()=>owner.seatId,
  listOwnerWindows:async()=>[owner],
  authorizeAttach:async()=>true,
  attachExisting:async()=>({ok:true,attachmentId:'native-1',foregroundChanged:false}),
  verifyAttachment:async()=>true,
  attestApplication:async()=>({verified:true,seatId:owner.seatId,processStartId:nativeStart}),
  inspectNativeAuthentication:async()=>{events.push('auth');return {status:auth};},
  inspectMethodAvailability:async({method})=>{
   events.push('availability:'+method);
   return {status:methods.get(method)?.availability||'ABSENT'};
  },
  useNativeMethod:async({method})=>{
   events.push('use:'+method);
   const m=methods.get(method);if(m?.nextAuth)auth=m.nextAuth;
   return {status:m?.effect||'NO_EFFECT'};
  },
  nativeInventoryComplete:async()=>coverage
 };
 const open=opts=>resolveV2OwnerLogin({
  route:route(),sessionHandle:'chat-a',appId:'brave',services,...opts
 });
 return {open,services,events,methods,auth:x=>auth=x,route:x=>currentRoute=x,
  generation:x=>nativeStart=x,coverage:x=>coverage=x};
}
test('default prefers the exact existing logged-in profile with no credential inspection',async()=>{
 const f=fixture(),v=await f.open();
 assert.equal(v.status,'AUTHENTICATED');
 assert.equal(v.method,'existing-session');
 assert.equal(v.existingSessionReused,true);
 assert.equal(v.passwordRequested,false);
 assert.equal(v.credentialExported,false);
 assert.equal(v.toolExecutionAuthorized,false);
 assert.equal(f.events.join(','),'auth');
});
test('all supported methods are enabled by default and checked in stable priority',async()=>{
 const f=fixture();f.auth('SIGNED_OUT');
 for(const m of V2_DEFAULT_NATIVE_LOGIN_METHODS)f.methods.set(m,{availability:'ABSENT'});
 const v=await f.open();
 assert.equal(v.status,'NO_SAVED_LOGIN_IN_SUPPORTED_SOURCES');
 assert.deepEqual(f.events.filter(x=>x.startsWith('availability:')),
  V2_DEFAULT_NATIVE_LOGIN_METHODS.map(x=>'availability:'+x));
 assert.equal(v.passwordRequested,false);
});
test('silent native SSO completes without requesting stored password',async()=>{
 const f=fixture();f.auth('SIGNED_OUT');
 f.methods.set('os-sso-cache',{availability:'READY',effect:'SUBMITTED',nextAuth:'SIGNED_IN'});
 const v=await f.open();
 assert.equal(v.status,'AUTHENTICATED');assert.equal(v.method,'os-sso-cache');
 assert.equal(f.events.includes('use:browser-autofill'),false);
});
test('browser-managed saved password autofill is used after absent SSO and passkey',async()=>{
 const f=fixture();f.auth('SIGNED_OUT');
 f.methods.set('browser-autofill',{availability:'READY',effect:'SUBMITTED',nextAuth:'SIGNED_IN'});
 const v=await f.open();
 assert.equal(v.status,'AUTHENTICATED');
 assert.equal(v.method,'browser-autofill');assert.equal(v.passwordRequested,false);
 assert.equal(v.credentialExported,false);
});
test('native passkey user presence and IdP MFA require owner action, not password entry',async()=>{
 const a=fixture();a.auth('SIGNED_OUT');
 a.methods.set('passkey',{availability:'READY',effect:'OWNER_ACTION_REQUIRED'});
 assert.equal((await a.open()).status,'OWNER_NATIVE_ACTION_REQUIRED');
 assert.equal(a.events.includes('use:browser-autofill'),false);
 const b=fixture();b.auth('MFA_REQUIRED');
 assert.equal((await b.open()).status,'OWNER_NATIVE_ACTION_REQUIRED');
 assert.equal(b.events.some(x=>x.startsWith('use:')),false);
});
test('unknown provider or incomplete coverage never falsely says no saved credentials',async()=>{
 const a=fixture();a.auth('SIGNED_OUT');a.coverage(false);
 assert.equal((await a.open()).status,'SAVED_LOGIN_AVAILABILITY_UNKNOWN');
 const b=fixture();b.auth('SIGNED_OUT');
 b.methods.set('native-password-manager',{availability:'UNKNOWN'});
 assert.equal((await b.open()).status,'SAVED_LOGIN_AVAILABILITY_UNKNOWN');
});
test('no-effect native SSO falls through, unknown effect blocks all replay',async()=>{
 const a=fixture();a.auth('SIGNED_OUT');
 a.methods.set('os-sso-cache',{availability:'READY',effect:'NO_EFFECT'});
 a.methods.set('browser-autofill',{availability:'READY',effect:'SUBMITTED',nextAuth:'SIGNED_IN'});
 assert.equal((await a.open()).method,'browser-autofill');
 const b=fixture();b.auth('SIGNED_OUT');
 b.methods.set('os-sso-cache',{availability:'READY',effect:'UNCERTAIN'});
 b.methods.set('browser-autofill',{availability:'READY',effect:'SUBMITTED',nextAuth:'SIGNED_IN'});
 assert.equal((await b.open()).status,'AUTH_EFFECT_UNCERTAIN');
 assert.equal(b.events.includes('use:browser-autofill'),false);
});
test('submitted but unverified native sign-in never blindly tries another provider',async()=>{
 const f=fixture();f.auth('SIGNED_OUT');
 f.methods.set('os-sso-cache',{availability:'READY',effect:'SUBMITTED'});
 f.methods.set('browser-autofill',{availability:'READY',effect:'SUBMITTED',nextAuth:'SIGNED_IN'});
 const v=await f.open();
 assert.equal(v.status,'AUTH_EFFECT_UNVERIFIED');
 assert.equal(f.events.includes('use:browser-autofill'),false);
});
test('route, native process generation and trusted broker are mandatory',async()=>{
 const a=fixture();a.route(route('foreign-chat'));
 await assert.rejects(a.open(),{code:'V2_OWNER_APP_SESSION_ROUTE_CHANGED'});
 const b=fixture();b.auth('SIGNED_OUT');
 b.services.inspectMethodAvailability=async()=>{b.generation('different');return {status:'READY'};};
 await assert.rejects(b.open(),{code:'V2_LOGIN_NATIVE_TARGET_CHANGED'});
 const c=fixture();delete c.services.nativeInventoryComplete;
 await assert.rejects(c.open(),{code:'V2_LOGIN_TRUSTED_OWNER_BROKER_REQUIRED'});
});
test('malformed method availability and credential-bearing target are rejected',async()=>{
 const a=fixture();a.auth('SIGNED_OUT');
 a.services.inspectMethodAvailability=async()=>({status:'NOT_FOUND',password:'secret'});
 await assert.rejects(a.open(),{code:'V2_LOGIN_METHOD_AVAILABILITY_INVALID'});
 const b=fixture();
 await assert.rejects(b.open({appId:'C:\\Users\\other\\passwords.txt'}),
  {code:'V2_LOGIN_SELECTION_INVALID'});
});

test('a failed provider inventory is UNKNOWN; all other native routes still run',async()=>{
 const f=fixture();f.auth('SIGNED_OUT');
 f.services.inspectMethodAvailability=async({method})=>{
  f.events.push('availability:'+method);
  if(method==='os-sso-cache')throw Error('provider private state');
  if(method==='passkey')return {status:'READY'};
  return {status:'ABSENT'};
 };
 f.services.useNativeMethod=async()=>({status:'NO_EFFECT'});
 const v=await f.open();
 assert.equal(v.status,'SAVED_LOGIN_AVAILABILITY_UNKNOWN');
 assert.equal(f.events.includes('availability:passkey'),true);
 assert.equal(v.passwordRequested,false);
});
test('credential-bearing result objects are refused and never returned to chat',async()=>{
 const a=fixture();a.auth('SIGNED_OUT');
 a.services.inspectMethodAvailability=async()=>({status:'READY',password:'should-not-exist'});
 await assert.rejects(a.open(),{code:'V2_LOGIN_METHOD_AVAILABILITY_INVALID'});
 const b=fixture();
 b.services.inspectNativeAuthentication=async()=>({status:'SIGNED_IN',cookie:'should-not-exist'});
 await assert.rejects(b.open(),{code:'V2_LOGIN_AUTH_STATE_INVALID'});
 const c=fixture();c.auth('SIGNED_OUT');
 c.services.inspectMethodAvailability=async()=>({status:'READY'});
 c.services.useNativeMethod=async()=>({status:'SUBMITTED',token:'should-not-exist'});
 const v=await c.open();
 assert.equal(v.status,'AUTH_EFFECT_UNCERTAIN');
 assert.equal(JSON.stringify(v).includes('token'),false);
});
test('post-sign-in observation failure remains uncertain and never retries an auth method',async()=>{
 const f=fixture();f.auth('SIGNED_OUT');
 f.services.inspectMethodAvailability=async({method})=>({status:method==='os-sso-cache'?'READY':'ABSENT'});
 f.services.useNativeMethod=async()=>({status:'SUBMITTED'});
 let reads=0;
 f.services.inspectNativeAuthentication=async()=>{if(++reads===1)return {status:'SIGNED_OUT'};throw Error('transport secret');};
 const v=await f.open();
 assert.equal(v.status,'AUTH_EFFECT_UNCERTAIN');
 assert.equal(v.passwordRequested,false);
});
