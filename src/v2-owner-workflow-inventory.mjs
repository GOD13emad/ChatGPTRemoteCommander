// V2 authenticated-owner candidate: scoped WorkflowStore detail for ONE attested
// chat/workflow. Not mounted on a listener and not callable by the public GUI.
// Native session bindings, owner grants and the existing WorkflowStore remain
// authoritative; no second WorkflowStore, scheduler, receipt or credential route.
import {normalizeV2Route,assertV2CallerBinding} from './v2-routing-contract.mjs';
import {LIFECYCLE} from './workflow-autonomy.mjs';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA=/^[a-f0-9]{64}$/;
const STEPS=new Set(['pending','running','verified','recorded','uncertain','failed','skipped']);
const KNOWN_LIFECYCLE=new Set(LIFECYCLE);
function fail(code){throw Object.assign(new Error(code),{code});}
function id(x){return typeof x==='string'&&ID.test(x)&&x!=='.'&&x!=='..';}
function sameRoute(a,b) {
 return ['hostId','principalId','profileId','conversationId','operationId'].every(k=>a[k]===b[k]) &&
   a.target.kind===b.target.kind&&a.target.id===b.target.id;
}
function snapshot(view,route) {
 const s=view?.state;
 if(!s||typeof s!=='object'||Array.isArray(s)||s.id!==route.target.id||
    !Number.isSafeInteger(s.revision)||s.revision<0||
    !SHA.test(view.headSha256)||!Array.isArray(s.steps)||s.steps.length>1000)
   fail('V2_INVENTORY_STORE_INTEGRITY_REQUIRED');
 const seen=new Set(),steps=[];
 for(const step of s.steps) {
  if(!step||!id(step.id)||seen.has(step.id)||!STEPS.has(step.status))
   fail('V2_INVENTORY_STORE_INTEGRITY_REQUIRED');
  seen.add(step.id);
  // Never return free-form goals, arguments, raw task text, tool input,
  // receipts, evidence paths or logs from untrusted persisted snapshots.
  steps.push(Object.freeze({id:step.id,status:step.status}));
 }
 if(!KNOWN_LIFECYCLE.has(s.lifecycleState)||!['PASS','UNVALIDATED','VALIDATING','FAILED'].includes(s.acceptanceStatus))
  fail('V2_INVENTORY_STORE_INTEGRITY_REQUIRED');
 return Object.freeze({
  schema:1,source:'EXISTING_WORKFLOW_STORE',authority:'OWNER_SESSION_AND_GRANT_VERIFIED',
  hostId:route.hostId,workflowId:s.id,revision:s.revision,
  headSha256:view.headSha256,lifecycle:s.lifecycleState,
  acceptanceStatus:s.acceptanceStatus,
  schedulerEnabled:s.scheduler?.enabled===true,
  steps:Object.freeze(steps),isExecutionReceipt:false
 });
}
/**
 * Only the trusted owner worker may call this function. HTTP browser requests
 * cannot supply sessions or authorizeRead. No read/enumeration without
 * an independently attested short-lived session, positive exact grant, and
 * explicit owner read approval. Re-check after each await and after store read.
 */
export async function readV2OwnerWorkflowSummary({
 sessionHandle,expectedPrincipalId,sessions,observedCaller,grants,workflowStore,authorizeRead
}={}) {
 if(!id(sessionHandle)||!id(expectedPrincipalId)||typeof sessions?.resolveNativeRoute!=='function'||
    typeof observedCaller!=='function'||typeof grants?.isAllowed!=='function'||
    typeof workflowStore?.get!=='function'||typeof authorizeRead!=='function')
  fail('V2_INVENTORY_TRUSTED_OWNER_WORKER_REQUIRED');
 const binding=async()=>{
  const r=normalizeV2Route(await sessions.resolveNativeRoute(sessionHandle));
  if(r.target.kind!=='workflow-root')fail('V2_INVENTORY_WORKFLOW_ROUTE_REQUIRED');
  if(r.principalId!==expectedPrincipalId)fail('V2_INVENTORY_OAUTH_PRINCIPAL_MISMATCH');
  assertV2CallerBinding(r,await observedCaller());
  if(await grants.isAllowed(r,'workflow_read')!==true)
   fail('V2_INVENTORY_GRANT_REQUIRED');
  if(await authorizeRead(Object.freeze({route:r,sessionHandle}))!==true)
   fail('V2_INVENTORY_OWNER_CONSENT_REQUIRED');
  return r;
 };
 const first=await binding();
 const second=await binding();
 if(!sameRoute(first,second))fail('V2_INVENTORY_SESSION_CHANGED');
 const view=await workflowStore.get(first.target.id);
 const value=snapshot(view,first);
 const last=await binding();
 if(!sameRoute(first,last))fail('V2_INVENTORY_SESSION_CHANGED');
 // Check again because the grant/seat can be revoked during observation.
 return value;
}
