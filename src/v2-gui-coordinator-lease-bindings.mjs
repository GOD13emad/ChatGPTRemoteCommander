// V2 candidate native GUI lease composition. Reuses ONE trusted coordinator
// and the existing Native Window Bridge. No new lease database, no public MCP
// registration and no assumption that a time-based fence is atomic with an OS
// GUI effect across a remote network. The real owner worker must maintain an
// authenticated, independent caller/session and OS target binding.
import {AsyncLocalStorage} from 'node:async_hooks';
import {normalizeV2Route,v2ResourceLeaseKey} from './v2-routing-contract.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const same=(a,b)=>['hostId','principalId','profileId','conversationId','operationId']
 .every(k=>a[k]===b[k])&&a.target.kind===b.target.kind&&a.target.id===b.target.id;
const METHODS=new Set(['probe','observe','readAccessibility','authorizeElement','apply','verify']);
function validOwnerResult(o){
 return o&&typeof o==='object'&&!Array.isArray(o)&&
 ['sessionHandle','route'].every(k=>Object.hasOwn(o,k))&&
 typeof o.sessionHandle==='string'&&o.sessionHandle.length>0;
}
/**
 * withLease: existing Bridge signature (resourceKey, work).
 * ownerProviders: existing owner worker signature ({route,sessionHandle}).
 * The trusted central coordinator is the single shared resource authority;
 * the OS effect is checked against its live fence immediately before applying.
 * This is a fail-closed local adapter, NOT proof of atomic distributed GUI
 * fencing when a native driver and coordinator are on different hosts.
 */
export function createV2GuiCoordinatorLeaseBindings({
 coordinator,resolveTrustedInvocation,sessions,ownerProviders,
 ttlMs=30000
}={}){
 if(typeof coordinator?.withFencedLease!=='function'||
    typeof resolveTrustedInvocation!=='function'||
    typeof sessions?.resolveNativeRoute!=='function'||
    typeof ownerProviders!=='function'||
    !Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>60000)
   fail('V2_GUI_COORDINATOR_TRUSTED_BOOTSTRAP_REQUIRED');
 const active=new AsyncLocalStorage();
 async function checkedIdentity(){
  const invocation=await resolveTrustedInvocation();
  if(!validOwnerResult(invocation))
   fail('V2_GUI_COORDINATOR_NATIVE_INVOCATION_REQUIRED');
  const route=normalizeV2Route(invocation.route);
  if(route.target.kind!=='app-window')
   fail('V2_GUI_COORDINATOR_TARGET_REQUIRED');
  const reattested=normalizeV2Route(
   await sessions.resolveNativeRoute(invocation.sessionHandle));
  if(!same(route,reattested))
   fail('V2_GUI_COORDINATOR_SESSION_CHANGED');
  return {route,sessionHandle:invocation.sessionHandle};
 }
 async function withLease(resourceKey,work){
  if(typeof work!=='function')
   fail('V2_GUI_COORDINATOR_WORK_REQUIRED');
  const {route,sessionHandle}=await checkedIdentity();
  if(resourceKey!==v2ResourceLeaseKey(route))
   fail('V2_GUI_COORDINATOR_RESOURCE_MISMATCH');
  let callbackEntered=false;
  try{
   return await coordinator.withFencedLease({
    route,ttlMs,run:async({lease,assertCurrent})=>{
     callbackEntered=true;
     if(!lease||typeof assertCurrent!=='function')
      fail('V2_GUI_COORDINATOR_FENCE_REQUIRED');
     await assertCurrent();
     return active.run({route,sessionHandle,assertCurrent},
      async()=>{await assertCurrent();return work()});
    }
   });
  }catch(error){
   // The host-side bounded retry is only legal if no callback was admitted.
   if(!callbackEntered&&error?.code==='V2_COORDINATOR_RESOURCE_BUSY')
    fail('GUI_LEASE_BUSY');
   throw error;
  }
 }
 async function ownerProvidersBound(selection){
  const {route,sessionHandle}=await checkedIdentity();
  const candidate=normalizeV2Route(selection?.route);
  if(!same(candidate,route)||selection.sessionHandle!==sessionHandle)
   fail('V2_GUI_COORDINATOR_PROVIDER_SCOPE_CHANGED');
  const selected=await ownerProviders(Object.freeze({route,sessionHandle}));
  if(!selected||!['windows','linux'].includes(selected.platform)||
     !selected.providers||typeof selected.providers!=='object'||
     Array.isArray(selected.providers))
   fail('V2_GUI_COORDINATOR_PROVIDER_INVALID');
  const wrapped=Object.create(null);
  for(const [key,provider] of Object.entries(selected.providers)){
   if(!provider||typeof provider!=='object'||Array.isArray(provider))
    fail('V2_GUI_COORDINATOR_PROVIDER_INVALID');
   const methods=Object.create(null);
   for(const method of METHODS){
    if(typeof provider[method]!=='function')
     fail('V2_GUI_COORDINATOR_PROVIDER_INVALID');
    methods[method]=async(...args)=>{
     // A provider that is reused across independent operations must not
     // pick up another request's AsyncLocalStorage state or authorization.
     const state=active.getStore();
     if(method==='apply'){
      if(!state||!same(state.route,route)||
         state.sessionHandle!==sessionHandle)
       fail('V2_GUI_COORDINATOR_EFFECT_WITHOUT_LEASE');
      const current=await checkedIdentity();
      if(!same(current.route,state.route)||current.sessionHandle!==sessionHandle)
       fail('V2_GUI_COORDINATOR_SESSION_CHANGED');
      await state.assertCurrent();
     }else if(state){
      if(!same(state.route,route)||state.sessionHandle!==sessionHandle)
       fail('V2_GUI_COORDINATOR_SESSION_CHANGED');
      await state.assertCurrent();
     }
     return provider[method](...args);
    };
   }
   wrapped[key]=Object.freeze(methods);
  }
  return Object.freeze({platform:selected.platform,providers:Object.freeze(wrapped)});
 }
 return Object.freeze({withLease,ownerProviders:ownerProvidersBound});
}
