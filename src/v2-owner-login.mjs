// V2 owner-local, no-password-reentry selection for existing signed-in apps.
// A broker operating inside the same authorized OS/browser user seat owns all
// native credential flows. No credentials, cookies, tokens or profiles are read,
// exported or replayed here. This is not a standalone auth provider.
import {normalizeV2Route} from './v2-routing-contract.mjs';
import {openV2OwnerApplication} from './v2-owner-session-reuse.mjs';
const METHODS=Object.freeze([
 'os-sso-cache','browser-sso','passkey','browser-autofill','native-password-manager'
]);
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const AUTH=new Set(['SIGNED_IN','SIGNED_OUT','MFA_REQUIRED','CONSENT_REQUIRED','UNKNOWN']);
const AVAIL=new Set(['READY','ABSENT','UNKNOWN']);
const OUTCOMES=new Set(['SUBMITTED','NO_EFFECT','OWNER_ACTION_REQUIRED','UNCERTAIN']);
const fail=(code)=>{throw Object.assign(new Error(code),{code});};
const valid=x=>typeof x==='string'&&ID.test(x)&&x!=='.'&&x!=='..';
const sameRoute=(a,b)=>['hostId','principalId','profileId','conversationId','operationId']
 .every(k=>a[k]===b[k])&&a.target.kind===b.target.kind&&a.target.id===b.target.id;
function needs(...values){if(values.some(x=>typeof x!=='function'))fail('V2_LOGIN_TRUSTED_OWNER_BROKER_REQUIRED');}
const exactStatus=(v,allowed,code)=>{
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==1||!allowed.has(v.status))
  fail(code);
 return v.status;
};
function snapshot(v){
 return exactStatus(v,AUTH,'V2_LOGIN_AUTH_STATE_INVALID');
}
function pinned(v,first){
 if(!v||typeof v!=='object'||Array.isArray(v)||v.verified!==true||
  !valid(v.seatId)||!valid(v.processStartId)||v.seatId!==first.seatId||
  v.processStartId!==first.processStartId)
  fail('V2_LOGIN_NATIVE_TARGET_CHANGED');
}
/**
 * An authorized owner agent chooses the first available native sign-in
 * mechanism without asking the user to repeat a password.
 *
 * Status requires independent, same-user native evidence. Availability is a
 * categorical capability result, not a credential count or exported secret.
 * A broker may initiate browser-managed autofill or native passkeys; a passkey
 * user-presence prompt and IdP MFA/consent remain permitted and cannot be
 * silently bypassed. All methods are enabled by default, subject to native
 * support, exact-owner grants and user consent.
 */
export async function resolveV2OwnerLogin({
 route,sessionHandle,appId,windowId,openIfMissing=false,
 services
}={}){
 const r=normalizeV2Route(route);
 if(!valid(sessionHandle)||!valid(appId)||r.target.id!==appId||
    !['app-window','browser-target'].includes(r.target.kind)||
    (windowId!==undefined&&!valid(windowId))||typeof openIfMissing!=='boolean')
  fail('V2_LOGIN_SELECTION_INVALID');
 if(!services||typeof services!=='object')fail('V2_LOGIN_TRUSTED_OWNER_BROKER_REQUIRED');
 needs(services.attestApplication,services.inspectNativeAuthentication,
  services.inspectMethodAvailability,services.useNativeMethod,
  services.nativeInventoryComplete,services.sessions?.resolveNativeRoute);
 // Existing window first, otherwise an explicitly requested registered app.
 const app=await openV2OwnerApplication({
   route:r,sessionHandle,appId,windowId,openIfMissing,mode:'background',
   services
 });
 const intent=Object.freeze({route:r,sessionHandle,appId,windowId:app.windowId,pid:app.pid});
 const observedRoute=async()=>{
  const active=normalizeV2Route(await services.sessions.resolveNativeRoute(sessionHandle));
  if(!sameRoute(r,active))fail('V2_LOGIN_SESSION_CHANGED');
 };
 await observedRoute();
 const first=await services.attestApplication(intent);
 if(!first||first.verified!==true||!valid(first.seatId)||!valid(first.processStartId))
  fail('V2_LOGIN_NATIVE_TARGET_UNVERIFIED');
 async function check(){
  await observedRoute();
  pinned(await services.attestApplication(intent),first);
 }
 async function state(){
  await check();
  const v=snapshot(await services.inspectNativeAuthentication(intent));
  await check();
  return v;
 }
 let current=await state();
 const response=(status,method=null)=>Object.freeze({
   status,method,appId,windowId:app.windowId,
   existingSessionReused:app.existingSessionReused,
   passwordRequested:false,credentialExported:false,
   loginVerified:status==='AUTHENTICATED',
   // A sign-in is not permission to execute arbitrary tools.
   toolExecutionAuthorized:false
 });
 if(current==='SIGNED_IN')return response('AUTHENTICATED','existing-session');
 if(current==='MFA_REQUIRED'||current==='CONSENT_REQUIRED')
  return response('OWNER_NATIVE_ACTION_REQUIRED');
 if(current==='UNKNOWN')return response('LOGIN_STATE_UNVERIFIED');
 let definiteAbsence=true;
 for(const method of METHODS){
  await check();
  let info;
  try {info=await services.inspectMethodAvailability(Object.freeze({...intent,method}));}
  catch {info={status:'UNKNOWN'};}
  await check();
  const available=exactStatus(info,AVAIL,'V2_LOGIN_METHOD_AVAILABILITY_INVALID');
  if(available==='UNKNOWN'){definiteAbsence=false;continue;}
  if(available==='ABSENT')continue;
  definiteAbsence=false;
  await check();
  let effect;
  try {
   effect=await services.useNativeMethod(Object.freeze({...intent,method}));
  }catch {return response('AUTH_EFFECT_UNCERTAIN',method);}
  if(!effect||typeof effect!=='object'||Array.isArray(effect)||
     Object.keys(effect).length!==1||!OUTCOMES.has(effect.status))
   return response('AUTH_EFFECT_UNCERTAIN',method);
  // Any uncertain/possibly dispatched authentication must not be retried
  // through the next provider. First reconcile the original owner session.
  if(effect.status==='UNCERTAIN'||effect.status==='SUBMITTED'){
   if(effect.status==='UNCERTAIN')return response('AUTH_EFFECT_UNCERTAIN',method);
   try{current=await state();}
   catch{return response('AUTH_EFFECT_UNCERTAIN',method);}
   if(current==='SIGNED_IN')return response('AUTHENTICATED',method);
   if(current==='MFA_REQUIRED'||current==='CONSENT_REQUIRED')
    return response('OWNER_NATIVE_ACTION_REQUIRED',method);
   return response('AUTH_EFFECT_UNVERIFIED',method);
  }
  if(effect.status==='OWNER_ACTION_REQUIRED')
   return response('OWNER_NATIVE_ACTION_REQUIRED',method);
  // NO_EFFECT explicitly means no OS/browser sign-in was dispatched;
  // safe to inspect the next method without copying credentials.
 }
 await check();
 let coverage;
 try{coverage=await services.nativeInventoryComplete(intent);}catch{coverage=false;}
 await check();
 if(coverage!==true||!definiteAbsence)
  return response('SAVED_LOGIN_AVAILABILITY_UNKNOWN');
 // Only a trusted same-user broker can attest complete coverage of the
 // configured/supported providers. This does not claim absence everywhere.
 return response('NO_SAVED_LOGIN_IN_SUPPORTED_SOURCES');
}
export const V2_DEFAULT_NATIVE_LOGIN_METHODS=METHODS;
