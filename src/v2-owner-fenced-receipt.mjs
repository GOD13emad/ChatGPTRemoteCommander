// Read the existing V2 Coordinator fenced receipt under a re-attested owner
// route. This proves ONLY a coordinator database commit, not a worker effect.
import {normalizeV2Route,assertV2CallerBinding} from './v2-routing-contract.mjs';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA=/^[a-f0-9]{64}$/;
function deny(code){throw Object.assign(new Error(code),{code});}
function validId(s){return typeof s==='string'&&ID.test(s)&&s!=='.'&&s!=='..';}
function same(a,b){
 return ['hostId','principalId','profileId','conversationId','operationId']
  .every(k=>a[k]===b[k])&&a.target.kind===b.target.kind&&a.target.id===b.target.id;
}
function checkedReceipt(receipt,receiptId,route){
 if(receipt===null){
  return Object.freeze({schema:1,source:'V2_CENTRAL_COORDINATOR',
   state:'NOT_FOUND',workflowId:route.target.id,receiptId,
   digest:null,fence:null,coordinatorCommitted:false,workerEffectVerified:false});
 }
 if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||
  Object.keys(receipt).length!==4||
  !['receiptId','digest','fence','committed'].every(k=>Object.hasOwn(receipt,k))||
  receipt.receiptId!==receiptId||!SHA.test(receipt.digest)||
  !Number.isSafeInteger(receipt.fence)||receipt.fence<1||receipt.committed!==true)
  deny('V2_OWNER_RECEIPT_INVALID_COORDINATOR_DATA');
 return Object.freeze({schema:1,source:'V2_CENTRAL_COORDINATOR',
  state:'COMMITTED_FENCED_RECEIPT',workflowId:route.target.id,
  receiptId,digest:receipt.digest,fence:receipt.fence,
  coordinatorCommitted:true,workerEffectVerified:false});
}
export async function readV2OwnerFencedReceipt({
 sessionHandle,expectedPrincipalId,sessions,observedCaller,grants,
 authorizeRead,resolveReceiptId,coordinator
}={}){
 if(!validId(sessionHandle)||!validId(expectedPrincipalId)||
  typeof sessions?.resolveNativeRoute!=='function'||
  typeof observedCaller!=='function'||typeof grants?.isAllowed!=='function'||
  typeof authorizeRead!=='function'||typeof resolveReceiptId!=='function'||
  typeof coordinator?.getFencedReceipt!=='function')
  deny('V2_OWNER_RECEIPT_TRUSTED_WORKER_REQUIRED');
 const recheck=async()=>{
  const route=normalizeV2Route(await sessions.resolveNativeRoute(sessionHandle));
  if(route.target.kind!=='workflow-root')deny('V2_OWNER_RECEIPT_WORKFLOW_REQUIRED');
  if(route.principalId!==expectedPrincipalId)
   deny('V2_OWNER_RECEIPT_PRINCIPAL_MISMATCH');
  assertV2CallerBinding(route,await observedCaller());
  if(await grants.isAllowed(route,'workflow_read')!==true)
   deny('V2_OWNER_RECEIPT_GRANT_REQUIRED');
  if(await authorizeRead(Object.freeze({route,sessionHandle}))!==true)
   deny('V2_OWNER_RECEIPT_CONSENT_REQUIRED');
  return route;
 };
 const first=await recheck();
 // Never allow model/HTTP input to select receiptId. It must come from the
 // canonical owner operation journal and be scoped to this exact route.
 const receiptId=await resolveReceiptId(first);
 if(!validId(receiptId)||receiptId!==first.operationId)
  deny('V2_OWNER_RECEIPT_OPERATION_ID_REQUIRED');
 const second=await recheck();
 if(!same(first,second))deny('V2_OWNER_RECEIPT_SESSION_CHANGED');
 const value=await coordinator.getFencedReceipt({route:first,receiptId});
 const candidate=checkedReceipt(value,receiptId,first);
 const final=await recheck();
 if(!same(first,final))deny('V2_OWNER_RECEIPT_SESSION_CHANGED');
 return candidate;
}
