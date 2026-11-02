// Reconcile a bounded physical PRIVATE Coordinator artifact with its fenced
// SQLite receipt. This is proof of owner-private staging bytes ONLY, not
// an arbitrary worker/GUI/browser effect. Trusted owner worker only.
import {normalizeV2Route,assertV2CallerBinding} from './v2-routing-contract.mjs';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA=/^[0-9a-f]{64}$/;
const valid=x=>typeof x==='string'&&ID.test(x)&&x!=='.'&&x!=='..';
const error=code=>{throw Object.assign(new Error(code),{code});};
function same(a,b){
 return ['hostId','principalId','profileId','conversationId','operationId']
 .every(k=>a[k]===b[k])&&a.target.kind===b.target.kind&&a.target.id===b.target.id;
}
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
export async function readV2OwnerPrivateArtifactProof({
 sessionHandle,expectedPrincipalId,sessions,observedCaller,grants,
 authorizeRead,coordinator,artifactActuator
}={}){
 if(!valid(sessionHandle)||!valid(expectedPrincipalId)||
    typeof sessions?.resolveNativeRoute!=='function'||
    typeof observedCaller!=='function'||typeof grants?.isAllowed!=='function'||
    typeof authorizeRead!=='function'||typeof coordinator?.getFencedReceipt!=='function'||
    typeof artifactActuator?.observe!=='function')
   error('V2_PRIVATE_PROOF_TRUSTED_BACKEND_REQUIRED');
 const recheck=async()=>{
  const route=normalizeV2Route(await sessions.resolveNativeRoute(sessionHandle));
  if(route.target.kind!=='workflow-root')error('V2_PRIVATE_PROOF_WORKFLOW_REQUIRED');
  if(route.principalId!==expectedPrincipalId)error('V2_PRIVATE_PROOF_OWNER_MISMATCH');
  assertV2CallerBinding(route,await observedCaller());
  if(await grants.isAllowed(route,'workflow_read')!==true)
   error('V2_PRIVATE_PROOF_GRANT_REQUIRED');
  if(await authorizeRead(Object.freeze({route,sessionHandle}))!==true)
   error('V2_PRIVATE_PROOF_CONSENT_REQUIRED');
  return route;
 };
 const first=await recheck();
 const second=await recheck();
 if(!same(first,second))error('V2_PRIVATE_PROOF_SESSION_CHANGED');
 // Operation ID comes ONLY from native attestation; the model or browser
 // never selects paths, receipt IDs, or files.
 const receiptId=first.operationId;
 const row=await coordinator.getFencedReceipt({route:first,receiptId});
 const observed=await artifactActuator.observe({route:first,receiptId});
 let proof;
 if(row===null){
   if(!exact(observed,['committed'])||observed.committed!==false)
    error('V2_PRIVATE_PROOF_INCONSISTENT');
   proof=Object.freeze({schema:1,source:'V2_PRIVATE_ARTIFACT_ACTUATOR',
    state:'NOT_FOUND',workflowId:first.target.id,receiptId,
    digest:null,fence:null,coordinatorCommitted:false,
    privateArtifactVerified:false,workerEffectVerified:false});
 }else{
   if(!exact(row,['receiptId','digest','fence','committed'])||
    !exact(observed,['committed','receiptId','digest','fence'])||
    row.receiptId!==receiptId||observed.receiptId!==receiptId||
    row.committed!==true||observed.committed!==true||
    typeof row.digest!=='string'||!SHA.test(row.digest)||
    observed.digest!==row.digest||
    !Number.isSafeInteger(row.fence)||row.fence<1||
    observed.fence!==row.fence)
    error('V2_PRIVATE_PROOF_INCONSISTENT');
   proof=Object.freeze({schema:1,source:'V2_PRIVATE_ARTIFACT_ACTUATOR',
    state:'PRIVATE_ARTIFACT_HASH_VERIFIED',workflowId:first.target.id,
    receiptId,digest:row.digest,fence:row.fence,
    coordinatorCommitted:true,privateArtifactVerified:true,
    workerEffectVerified:false});
 }
 const after=await recheck();
 if(!same(first,after))error('V2_PRIVATE_PROOF_SESSION_CHANGED');
 return proof;
}
