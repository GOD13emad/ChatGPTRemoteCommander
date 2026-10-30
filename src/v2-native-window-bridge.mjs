// V2 R4: owner-worker native-window bridge, candidate only; no public MCP
// endpoint and no second GUI/receipt/lease engine. Input IDs are selections,
// NOT identity proof; trusted owner session and OS window resolver supply it.
import { normalizeV2Route } from './v2-routing-contract.mjs';
import { executeV2BoundOperation } from './v2-authorized-operation.mjs';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ACTION_TO_TOOL=Object.freeze({
  observe:'workspace_window_observe',
  invoke:'workspace_window_invoke',
  type:'workspace_window_type'
});
function fail(code){throw Object.assign(new Error(code),{code});}
function valid(v){return typeof v==='string'&&ID.test(v)&&v!=='.'&&v!=='..';}
function requiredFunction(v){if(typeof v!=='function')fail('V2_WINDOW_TRUSTED_BACKEND_REQUIRED');}
const scopedFields=['hostId','principalId','profileId','conversationId','operationId'];
function sameRoute(a,b){
 return scopedFields.every(k=>a[k]===b[k]) &&
   a.target.kind===b.target.kind && a.target.id===b.target.id;
}
const windowFields=['targetId','hostId','principalId','seatId','pid','windowHandle','processStartId'];
// Accessibility output is a bounded owner-consented *view*, not a browser
// credential export, screenshot, raw provider object or a privileged action.
const MAX_ELEMENTS=64, MAX_LABEL=160;
const SENSITIVE=/password|secret|credential|token|private|hidden/i;
function accessibilityView(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
    !Array.isArray(raw.elements)||raw.elements.length>MAX_ELEMENTS)
   fail('V2_WINDOW_ACCESSIBILITY_SNAPSHOT_INVALID');
 const items=raw.elements.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item)||
     !valid(item.id)||typeof item.role!=='string'||
     !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(item.role)||
     typeof item.enabled!=='boolean')
    fail('V2_WINDOW_ACCESSIBILITY_SNAPSHOT_INVALID');
  const sensitive=item.sensitive===true||SENSITIVE.test(item.role);
  if(item.name!==undefined&&typeof item.name!=='string')
    fail('V2_WINDOW_ACCESSIBILITY_SNAPSHOT_INVALID');
  return Object.freeze({
    id:item.id,role:item.role,
    name:sensitive?'[redacted]':String(item.name??'').slice(0,MAX_LABEL),
    enabled:item.enabled,sensitive
  });
 });
 return Object.freeze({elements:Object.freeze(items),truncated:raw.truncated===true});
}

function windowIdentity(d){
 if(!d||typeof d!=='object'||Array.isArray(d)||
    !windowFields.every(k=>Object.hasOwn(d,k)) ||
    !valid(d.targetId)||!valid(d.hostId)||!valid(d.principalId)||
    !valid(d.seatId)||!valid(d.windowHandle)||!valid(d.processStartId)||
    !Number.isSafeInteger(d.pid)||d.pid<=0||d.present!==true)
   fail('V2_WINDOW_NATIVE_OBSERVATION_REQUIRED');
 return windowFields.map(k=>String(d[k])).join('\u0000');
}

/**
 * A pre-wired, native owner-worker-only operation bridge. This does NOT start
 * Cua Driver, attach a user browser, elevate SYSTEM/Session 0, or bypass portal
 * consent. The caller installs these five trusted dependencies, never RPC args:
 * sessions.resolveNativeRoute(handle) — previously attested/consented chat route
 * ownerSeat(handle) — currently OS-observed native seat
 * authorizeWindow({route, descriptor, sessionHandle}) — positive owner policy
 * nativeDriver.observe(targetId), authorizeElement(...), apply(...)
 * grants.isAllowed(route,tool), withLease, receiptStore — existing Core services
 * Any unknown physical effect is returned UNCERTAIN and durable requestId is
 * owned by the existing receiptStore. Never auto-replay the same unknown effect.
 */
export async function executeV2NativeWindowAction({
  route, sessionHandle, action, elementId, text, services
}={}) {
 const r=normalizeV2Route(route);
 if(r.target.kind!=='app-window')fail('V2_WINDOW_ROUTE_REQUIRED');
 if(!valid(sessionHandle))fail('V2_WINDOW_BOUND_SESSION_REQUIRED');
 if(!Object.hasOwn(ACTION_TO_TOOL,action))fail('V2_WINDOW_ACTION_UNSUPPORTED');
 if(action==='observe' && (elementId!==undefined||text!==undefined))
   fail('V2_WINDOW_OBSERVE_PAYLOAD_INVALID');
 if(action!=='observe' && !valid(elementId))
   fail('V2_WINDOW_ACCESSIBLE_ELEMENT_REQUIRED');
 if(action==='invoke' && text!==undefined)fail('V2_WINDOW_INVOKE_PAYLOAD_INVALID');
 if(action==='type' && (typeof text!=='string'||text.length===0||text.length>4096))
   fail('V2_WINDOW_TEXT_INVALID');
 if(!services||typeof services!=='object'||!services.sessions||!services.nativeDriver||
    !services.grants||!services.receiptStore)
   fail('V2_WINDOW_TRUSTED_BACKEND_REQUIRED');
 for(const f of [
  services.sessions.resolveNativeRoute,services.ownerSeat,services.authorizeWindow,
  services.nativeDriver.observe,services.nativeDriver.apply,
  services.nativeDriver.authorizeElement,services.grants.isAllowed,
  services.withLease
 ])requiredFunction(f);
 const observedCaller=async()=>{
  // resolveNativeRoute must itself re-attest the native session/route each time.
  const b=normalizeV2Route(await services.sessions.resolveNativeRoute(sessionHandle));
  if(!sameRoute(r,b))fail('V2_WINDOW_SESSION_ROUTE_CHANGED');
  return Object.fromEntries(scopedFields.slice(0,4).map(k=>[k,b[k]]));
 };
 const descriptor=async()=>{
  await observedCaller();
  const d=await services.nativeDriver.observe(r.target.id);
  const fingerprint=windowIdentity(d);
  const currentSeat=await services.ownerSeat(sessionHandle);
  if(!valid(currentSeat)||currentSeat!==d.seatId ||
     r.target.id!==d.targetId||r.hostId!==d.hostId||
     r.principalId!==d.principalId)
    fail('V2_WINDOW_NATIVE_OWNER_MISMATCH');
  if(await services.authorizeWindow({route:r,descriptor:d,sessionHandle})!==true)
    fail('V2_WINDOW_OWNER_CONSENT_REQUIRED');
  return {descriptor:d,fingerprint};
 };
 // Do not reserve a receipt/lease if native session, owner or target is stale.
 const first=await descriptor();
 const tool=ACTION_TO_TOOL[action];
 const args=action==='observe'?{action}:action==='invoke'
   ?{action,elementId}:{action,elementId,text};
 return executeV2BoundOperation(r,{
  observedCaller,
  hasGrant:(route,chosen)=>services.grants.isAllowed(route,chosen),
  withLease:services.withLease,
  receiptStore:services.receiptStore,
  execute:async()=>{
   const before=await descriptor();
   if(before.fingerprint!==first.fingerprint)
     fail('V2_WINDOW_REPLACED_BEFORE_EFFECT');
   if(action==='observe'){
    requiredFunction(services.nativeDriver.readAccessibility);
    // The native driver is a trusted owner-worker callback, not the model.
    // Never return the provider's raw accessibility object, hidden values,
    // passwords, offscreen tree, arbitrary attributes or screenshots.
    const view=accessibilityView(await services.nativeDriver.readAccessibility({
      descriptor:before.descriptor,maxElements:MAX_ELEMENTS,sessionHandle
    }));
    const after=await descriptor();
    if(after.fingerprint!==first.fingerprint)
      fail('V2_WINDOW_REPLACED_DURING_OBSERVE');
    return Object.freeze({status:'OBSERVED',targetId:r.target.id,...view});
   }
   if(await services.nativeDriver.authorizeElement({
     descriptor:before.descriptor,elementId,action
   })!==true)fail('V2_WINDOW_ACCESSIBLE_ELEMENT_DENIED');
   // Re-observe after an asynchronous accessibility/consent check.
   const ready=await descriptor();
   if(ready.fingerprint!==first.fingerprint)
     fail('V2_WINDOW_REPLACED_BEFORE_EFFECT');
   try{
    // Explicit owner-bound accessibility element only. No global SendInput,
    // screen coordinate, password-field fallback or implicit focus steal.
    await services.nativeDriver.apply({
     descriptor:ready.descriptor, action, elementId,
     ...(action==='type'?{text}:{}),
     sessionHandle
    });
   }catch{
    return Object.freeze({status:'UNCERTAIN',targetId:r.target.id});
   }
   try{
    const after=await descriptor();
    if(after.fingerprint!==first.fingerprint)
     return Object.freeze({status:'UNCERTAIN',targetId:r.target.id});
    if(typeof services.nativeDriver.verify!=='function' ||
       await services.nativeDriver.verify({
        descriptor:after.descriptor,action,elementId
       })!==true)
     return Object.freeze({status:'UNCERTAIN',targetId:r.target.id});
   }catch{
    return Object.freeze({status:'UNCERTAIN',targetId:r.target.id});
   }
   return Object.freeze({status:'VERIFIED',targetId:r.target.id});
  }
 },tool,args);
}
