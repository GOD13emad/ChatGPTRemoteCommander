// Candidate composition for an already-attested native owner process.
// This is NOT a public MCP tool, an OAuth authenticator or a service installer.
// A trusted callback resolves the current chat/seat/operation independently of
// model-supplied fields; the existing Bridge owns grants, lease and receipts.
import {normalizeV2Route} from './v2-routing-contract.mjs';
import {createV2HybridNativeDriver} from './v2-hybrid-native-driver.mjs';
import {executeV2NativeWindowAction,reconcileV2NativeWindowAction}
 from './v2-native-window-bridge.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const tools=Object.freeze({
 observe:'workspace_window_observe',
 invoke:'workspace_window_invoke',
 type:'workspace_window_type'
});
const same=(a,b)=>['hostId','principalId','profileId','conversationId','operationId']
 .every(k=>a[k]===b[k])&&a.target.kind===b.target.kind&&a.target.id===b.target.id;
const valid=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x)&&x!=='.'&&x!=='..';

/**
 * Each worker is created inside its actual owner OS session. All dependencies
 * are host-provided capabilities, never arguments passed through MCP/HTTP.
 *
 * resolveTrustedInvocation(): {sessionHandle,route} from authenticated platform
 * binding. A handle alone, JWT subject, process PID or FULL_POWER text is not
 * sufficient. The session registry reattests it on every use.
 *
 * ownerProviders({route,sessionHandle}): {platform,providers} constructed from
 * trusted owner-local adapters and anchored to the selected exact window.
 * Providers MUST keep element capabilities across separately attested observe
 * and invoke operations; do not invent selectors from model text.
 *
 * withLease and receiptStore MUST be existing machine-global coordination
 * components; this module intentionally creates neither a duplicate lock nor
 * an in-memory receipt engine.
 */
export function createV2NativeGuiOwnerWorker({
 resolveTrustedInvocation,sessions,grants,withLease,receiptStore,
 ownerSeat,authorizeNativeSession,authorizeWindow,ownerProviders
}={}){
 if([resolveTrustedInvocation,withLease,ownerSeat,authorizeNativeSession,authorizeWindow,ownerProviders]
    .some(fn=>typeof fn!=='function')||
    typeof sessions?.resolveNativeRoute!=='function'||
    typeof grants?.isAllowed!=='function'||
    typeof receiptStore?.execute!=='function')
  fail('V2_GUI_OWNER_WORKER_TRUSTED_DEPENDENCIES_REQUIRED');
 async function context(action){
  if(!Object.hasOwn(tools,action))fail('V2_GUI_OWNER_ACTION_INVALID');
  // The callback takes NO untrusted argument and must be backed by the
  // authenticated current invocation rather than a saved chat selector.
  const identity=await resolveTrustedInvocation();
  if(!identity||!valid(identity.sessionHandle))fail('V2_GUI_OWNER_INVOCATION_UNATTESTED');
  const r=normalizeV2Route(identity.route);
  if(r.target.kind!=='app-window')fail('V2_GUI_OWNER_WINDOW_REQUIRED');
  const attested=normalizeV2Route(await sessions.resolveNativeRoute(identity.sessionHandle));
  if(!same(r,attested))fail('V2_GUI_OWNER_INVOCATION_CHANGED');
  // Do not even construct a native driver for a denied action.
  if(await grants.isAllowed(r,tools[action])!==true)fail('V2_GRANT_REQUIRED');
  // UI accessibility snapshots are reads. Require native owner scope consent
  // BEFORE the first provider probe, even if later window consent rejects.
  const seat=await ownerSeat(identity.sessionHandle);
  if(!valid(seat))fail('V2_GUI_OWNER_NATIVE_SEAT_REQUIRED');
  if(await authorizeNativeSession(Object.freeze({
   route:r,sessionHandle:identity.sessionHandle,seatId:seat,action
  }))!==true)fail('V2_GUI_OWNER_NATIVE_SCOPE_CONSENT_REQUIRED');
  // No native driver may be constructed for a changed/revoked binding.
  const rechecked=normalizeV2Route(await sessions.resolveNativeRoute(identity.sessionHandle));
  if(!same(rechecked,r)||await ownerSeat(identity.sessionHandle)!==seat)
   fail('V2_GUI_OWNER_SESSION_CHANGED');
  if(await grants.isAllowed(r,tools[action])!==true)fail('V2_GRANT_REQUIRED');
  return {r,sessionHandle:identity.sessionHandle};
 }
 async function driverFor({r,sessionHandle},action,elementId){
  const selected=await ownerProviders(Object.freeze({route:r,sessionHandle}));
  if(!selected||!['linux','windows'].includes(selected.platform))
   fail('V2_GUI_OWNER_NATIVE_PROVIDER_REQUIRED');
  return createV2HybridNativeDriver({
   platform:selected.platform,action,
   ...(action!=='observe'?{elementId}:{}),
   providers:selected.providers
  });
 }
 function services(context,nativeDriver){
  return Object.freeze({
   sessions,grants,withLease,receiptStore,ownerSeat,authorizeWindow,nativeDriver
  });
 }
 return Object.freeze({
  async execute(input={}){
   if(!input||typeof input!=='object'||Array.isArray(input)||
      Object.keys(input).some(k=>!['action','elementId','text'].includes(k)))
    fail('V2_GUI_OWNER_INPUT_INVALID');
   const {action,elementId,text}=input;
   const bound=await context(action);
   const driver=await driverFor(bound,action,elementId);
   return executeV2NativeWindowAction({
    route:bound.r,sessionHandle:bound.sessionHandle,action,elementId,text,
    services:services(bound,driver)
   });
  },
  async reconcile(input={}){
   if(!input||typeof input!=='object'||Array.isArray(input)||
      Object.keys(input).some(k=>!['action','elementId','text'].includes(k)))
    fail('V2_GUI_OWNER_INPUT_INVALID');
   const {action,elementId,text}=input;
   if(action!=='invoke'&&action!=='type')fail('V2_GUI_OWNER_RECONCILE_ACTION_INVALID');
   const bound=await context(action);
   if(typeof receiptStore.reconcileVerifiedObservation!=='function')
    fail('V2_GUI_OWNER_RECONCILIATION_STORE_REQUIRED');
   const driver=await driverFor(bound,action,elementId);
   return reconcileV2NativeWindowAction({
    route:bound.r,sessionHandle:bound.sessionHandle,action,elementId,text,
    services:services(bound,driver)
   });
  }
 });
}
