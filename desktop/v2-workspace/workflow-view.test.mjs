import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOwnerWorkflowView,normalizeCoordinatorReceiptView,normalizePrivateArtifactProof} from './workflow-view.mjs';
const valid=()=>({
 schema:1,source:'EXISTING_WORKFLOW_STORE',authority:'OWNER_SESSION_AND_GRANT_VERIFIED',
 hostId:'host-1',workflowId:'wf-1',revision:4,headSha256:'a'.repeat(64),
 lifecycle:'BLOCKED',acceptanceStatus:'UNVALIDATED',schedulerEnabled:false,
 steps:[{id:'one',status:'recorded'},{id:'two',status:'uncertain'}],
 isExecutionReceipt:false
});
test('sanitizes a trusted native WorkflowStore view, explicitly not receipt',()=>{
 const v=normalizeOwnerWorkflowView(valid());
 assert.equal(v.workflowId,'wf-1');
 assert.equal(v.lifecycle,'BLOCKED');
 assert.equal(v.isExecutionReceipt,false);
 assert.equal(v.evidenceSha256,'a'.repeat(64));
 assert.equal(v.steps[0].status,'recorded');
 assert.doesNotMatch(JSON.stringify(v),/host-1|OWNER_SESSION_AND_GRANT_VERIFIED/);
});
test('rejects unknown fields, fake final, duplicate steps and forged receipt flag',()=>{
 for (const item of [
  {...valid(),secret:'hidden'}, {...valid(),isExecutionReceipt:true},
  {...valid(),lifecycle:'DONE'}, {...valid(),headSha256:'xx'},
  {...valid(),steps:[{id:'one',status:'verified',payload:'SECRET'}]},
  {...valid(),steps:[{id:'one',status:'recorded'},{id:'one',status:'recorded'}]},
  {...valid(),steps:[{id:'one',status:'completed'}]},
  {...valid(),authority:'TOKEN_SUPPLIED_NOT_NATIVE'}
 ]) assert.throws(()=>normalizeOwnerWorkflowView(item),/V2_WORKFLOW_VIEW_UNTRUSTED/);
});
test('recognized honest lifecycle statuses are not coerced to completion',()=>{
 for(const lifecycle of ['BLOCKED','INTERRUPTED','WAITING','RUNNING','COMPLETED']){
  const r=normalizeOwnerWorkflowView({...valid(),lifecycle});
  assert.equal(r.lifecycle,lifecycle);
  assert.equal(r.isExecutionReceipt,false);
 }
});

test('central fenced receipt is reported separately from external effects',()=>{
 const raw={schema:1,source:'V2_CENTRAL_COORDINATOR',
  state:'COMMITTED_FENCED_RECEIPT',workflowId:'wf-one',receiptId:'op-one',
  digest:'a'.repeat(64),fence:4,coordinatorCommitted:true,workerEffectVerified:false};
 const x=normalizeCoordinatorReceiptView(raw);
 assert.equal(x.coordinatorCommitted,true);
 assert.equal(x.workerEffectVerified,false);
 assert.equal(x.fence,4);
 assert.equal(x.receiptId,'op-one');
 assert.doesNotMatch(JSON.stringify(x),/V2_CENTRAL_COORDINATOR/);
 const absent=normalizeCoordinatorReceiptView({...raw,state:'NOT_FOUND',
   digest:null,fence:null,coordinatorCommitted:false});
 assert.equal(absent.coordinatorCommitted,false);
 assert.equal(absent.workerEffectVerified,false);
});
test('receipt parser rejects forged effect, extra fields and dishonest absence',()=>{
 const raw={schema:1,source:'V2_CENTRAL_COORDINATOR',
  state:'COMMITTED_FENCED_RECEIPT',workflowId:'wf-one',receiptId:'op-one',
  digest:'a'.repeat(64),fence:3,coordinatorCommitted:true,workerEffectVerified:false};
 for(const data of [{...raw,workerEffectVerified:true},
   {...raw,secret:'UNTRUSTED'}, {...raw,coordinatorCommitted:false},
   {...raw,fence:0}, {...raw,state:'NOT_FOUND'},
   {...raw,state:'COMPLETED'}, {...raw,receiptId:'../escape'}])
   assert.throws(()=>normalizeCoordinatorReceiptView(data),/V2_FENCED_RECEIPT_UNTRUSTED/);
});

test('private artifact proof remains scoped to immutable staged bytes only',()=>{
 const raw={schema:1,source:'V2_PRIVATE_ARTIFACT_ACTUATOR',
  state:'PRIVATE_ARTIFACT_HASH_VERIFIED',workflowId:'project',
  receiptId:'operation',digest:'c'.repeat(64),fence:3,
  coordinatorCommitted:true,privateArtifactVerified:true,workerEffectVerified:false};
 const x=normalizePrivateArtifactProof(raw);
 assert.equal(x.privateArtifactVerified,true);
 assert.equal(x.workerEffectVerified,false);
 assert.equal(x.state,'PRIVATE_ARTIFACT_HASH_VERIFIED');
 const absent=normalizePrivateArtifactProof({...raw,state:'NOT_FOUND',digest:null,fence:null,
  coordinatorCommitted:false,privateArtifactVerified:false});
 assert.equal(absent.privateArtifactVerified,false);
 for(const item of [{...raw,workerEffectVerified:true},
  {...raw,privateArtifactVerified:false},{...raw,secret:'hidden'},
  {...raw,digest:'bad'}, {...raw,fence:0},
  {...raw,state:'NOT_FOUND',digest:null,fence:null}]){
  assert.throws(()=>normalizePrivateArtifactProof(item),/V2_PRIVATE_PROOF_UNTRUSTED/);
 }
});
