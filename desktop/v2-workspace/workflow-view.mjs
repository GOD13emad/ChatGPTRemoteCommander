// Presentation-only adapter for a separately verified, native-owner WorkflowStore
// reader. No status can be derived from local drafts, monitor counts or model text.
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA=/^[0-9a-f]{64}$/;
const STATES=new Set(['CREATED','RUNNING','WAITING','RESUMING','BLOCKED','INTERRUPTED',
  'FINALIZING','VALIDATING','COMPLETED','FAILED','CANCELLED']);
const STEP_STATES=new Set(['pending','running','verified','recorded','uncertain','failed','skipped']);
function exact(value,names){
 return value!==null && typeof value==='object' && !Array.isArray(value) &&
  Object.keys(value).length===names.length &&
  Object.keys(value).every(k=>names.includes(k));
}
const NAMES=['schema','source','authority','hostId','workflowId','revision',
 'headSha256','lifecycle','acceptanceStatus','schedulerEnabled','steps','isExecutionReceipt'];
export function normalizeOwnerWorkflowView(value){
 if(!exact(value,NAMES)||value.schema!==1||
    value.source!=='EXISTING_WORKFLOW_STORE'||
    value.authority!=='OWNER_SESSION_AND_GRANT_VERIFIED'||
    value.isExecutionReceipt!==false||
    typeof value.hostId!=='string'||!ID.test(value.hostId)||
    typeof value.workflowId!=='string'||!ID.test(value.workflowId)||
    !Number.isSafeInteger(value.revision)||value.revision<0||
    typeof value.headSha256!=='string'||!SHA.test(value.headSha256)||
    !STATES.has(value.lifecycle)||
    !['UNVALIDATED','VALIDATING','PASS','FAILED'].includes(value.acceptanceStatus)||
    typeof value.schedulerEnabled!=='boolean'||
    !Array.isArray(value.steps)||value.steps.length>1000)
  throw Error('V2_WORKFLOW_VIEW_UNTRUSTED');
 const seen=new Set(),steps=[];
 for(const item of value.steps){
   if(!exact(item,['id','status'])||typeof item.id!=='string'||!ID.test(item.id)||
      seen.has(item.id)||!STEP_STATES.has(item.status))throw Error('V2_WORKFLOW_VIEW_UNTRUSTED');
   seen.add(item.id);
   steps.push(Object.freeze({id:item.id,status:item.status}));
 }
 return Object.freeze({
   workflowId:value.workflowId,revision:value.revision,
   lifecycle:value.lifecycle,acceptanceStatus:value.acceptanceStatus,
   steps:Object.freeze(steps),isExecutionReceipt:false,
   evidenceSha256:value.headSha256,observedAt:new Date().toISOString()
 });
}


const RECEIPT_FIELDS=['schema','source','state','workflowId','receiptId',
 'digest','fence','coordinatorCommitted','workerEffectVerified'];
export function normalizeCoordinatorReceiptView(value){
 if(!exact(value,RECEIPT_FIELDS)||value.schema!==1||
    value.source!=='V2_CENTRAL_COORDINATOR'||value.workerEffectVerified!==false||
    typeof value.workflowId!=='string'||!ID.test(value.workflowId)||
    typeof value.receiptId!=='string'||!ID.test(value.receiptId))
  throw Error('V2_FENCED_RECEIPT_UNTRUSTED');
 const found=value.state==='COMMITTED_FENCED_RECEIPT';
 if(!found && value.state!=='NOT_FOUND')throw Error('V2_FENCED_RECEIPT_UNTRUSTED');
 if(found !== value.coordinatorCommitted ||
    (found && (typeof value.digest!=='string'||!SHA.test(value.digest)||
      !Number.isSafeInteger(value.fence)||value.fence<1))||
    (!found&&(value.digest!==null||value.fence!==null)))
  throw Error('V2_FENCED_RECEIPT_UNTRUSTED');
 return Object.freeze({workflowId:value.workflowId,receiptId:value.receiptId,
  state:value.state,coordinatorCommitted:found,workerEffectVerified:false,
  fence:found?value.fence:null,digest:found?value.digest:null,
  observedAt:new Date().toISOString()});
}


const PROOF_FIELDS=['schema','source','state','workflowId','receiptId','digest','fence',
 'coordinatorCommitted','privateArtifactVerified','workerEffectVerified'];
export function normalizePrivateArtifactProof(value){
 if(!exact(value,PROOF_FIELDS)||value.schema!==1||
  value.source!=='V2_PRIVATE_ARTIFACT_ACTUATOR'||
  value.workerEffectVerified!==false||
  typeof value.workflowId!=='string'||!ID.test(value.workflowId)||
  typeof value.receiptId!=='string'||!ID.test(value.receiptId))throw Error('V2_PRIVATE_PROOF_UNTRUSTED');
 const ok=value.state==='PRIVATE_ARTIFACT_HASH_VERIFIED';
 if(!ok&&value.state!=='NOT_FOUND')throw Error('V2_PRIVATE_PROOF_UNTRUSTED');
 if(value.coordinatorCommitted!==ok||value.privateArtifactVerified!==ok||
  (ok&&(typeof value.digest!=='string'||!SHA.test(value.digest)||
   !Number.isSafeInteger(value.fence)||value.fence<1))||
  (!ok&&(value.digest!==null||value.fence!==null)))
   throw Error('V2_PRIVATE_PROOF_UNTRUSTED');
 return Object.freeze({workflowId:value.workflowId,receiptId:value.receiptId,
  state:value.state,coordinatorCommitted:ok,privateArtifactVerified:ok,
  workerEffectVerified:false,fence:ok?value.fence:null,
  digest:ok?value.digest:null,observedAt:new Date().toISOString()});
}
