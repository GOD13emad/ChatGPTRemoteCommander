// Pure acceptance for the fixed two-step owner-enrolled companion. File
// existence/model exit0 alone never imply a completed core workflow.
import {types} from 'node:util';
import {createHash} from 'node:crypto';

const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const RUN_REQUIRED=['runId','workflowId','status','lastCode','maxActions','attempts','actions','maxPlannerCalls','plannerCalls',
  'maxExtensions','extensions','pendingExtension','workerActions','pendingWorker','workerReceipts','deadline','history',
  'observationRefs','createdAt','updatedAt','checkCount','checksArePlannerEditable'];
const RUN_ALLOWED=[...RUN_REQUIRED,'correlationId','workflowFingerprint','scopeFingerprint','policyHash','lastRevision',
  'summary','finalRevision','verification','brainSync'];
const NATIVE_KEYS=['schema','status','win32Error','cleanupWin32Error','cleanupConfirmed','pid','creationFileTime',
  'assignedBeforeResume','exitCode','elapsedMs','activeJobProcesses','peakJobMemoryBytes','ownedJobTerminated','stdoutHex','stderrHex'];
function fail(code){throw Object.assign(new Error(code),{code});}
function snapshot(value,depth=0,limit={nodes:0}){
  if(++limit.nodes>20000||depth>24||types.isProxy(value))fail('COMPANION_ACCEPTANCE_DATA');
  if(value===null||['string','boolean'].includes(typeof value))return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(!value||typeof value!=='object')fail('COMPANION_ACCEPTANCE_DATA');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Array.isArray(value)){
    if(Reflect.ownKeys(descriptors).length!==value.length+1)fail('COMPANION_ACCEPTANCE_DATA');
    return Array.from({length:value.length},(_,n)=>{
      if(!Object.hasOwn(descriptors,n)||!Object.hasOwn(descriptors[n],'value'))fail('COMPANION_ACCEPTANCE_DATA');
      return snapshot(descriptors[n].value,depth+1,limit);
    });
  }
  if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('COMPANION_ACCEPTANCE_DATA');
  const result={};
  for(const key of Reflect.ownKeys(descriptors)){
    if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key)||!descriptors[key].enumerable
      ||!Object.hasOwn(descriptors[key],'value'))fail('COMPANION_ACCEPTANCE_DATA');
    result[key]=snapshot(descriptors[key].value,depth+1,limit);
  }
  return result;
}
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function fields(value,required,allowed=required){
  if(!value||typeof value!=='object'||Array.isArray(value)||required.some(k=>!Object.hasOwn(value,k))
    ||Object.keys(value).some(k=>!allowed.includes(k)))fail('COMPANION_ACCEPTANCE_SCHEMA');
}
function runShape(run){fields(run,RUN_REQUIRED,RUN_ALLOWED);}
const same=(a,b)=>canonical(a)===canonical(b);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');

export function assertCompanionAcceptance(input){
  const data=snapshot(input);
  fields(data,['coreStatus','state','operations','ticks','modelRecords','actions','proofSha256','expectedProofSha256']);
  const {coreStatus:run,state:envelope,operations,ticks,modelRecords,actions,proofSha256,expectedProofSha256}=data;
  if(!HASH.test(proofSha256)||!HASH.test(expectedProofSha256)||proofSha256!==expectedProofSha256)fail('COMPANION_ACCEPTANCE_FILE_HASH');
  runShape(run);
  if(run.status!=='COMPLETED'||run.lastCode!=='PROJECT_ACCEPTANCE_VERIFIED')fail('COMPANION_ACCEPTANCE_CORE_NOT_COMPLETED');
  if(run.maxActions!==2||run.actions!==2||run.attempts!==2||run.maxPlannerCalls!==2||run.plannerCalls!==2
    ||run.maxExtensions!==0||run.extensions!==0||run.workerActions!==0||run.pendingExtension!==null||run.pendingWorker!==null
    ||!same(run.workerReceipts,[])||!same(run.observationRefs,[])||run.checkCount!==1||run.checksArePlannerEditable!==false)
    fail('COMPANION_ACCEPTANCE_BUDGET_OR_PENDING');
  if(!Number.isSafeInteger(run.deadline)||!Number.isFinite(Date.parse(run.createdAt))||!Number.isFinite(Date.parse(run.updatedAt))
    ||run.deadline-Date.parse(run.createdAt)<119000||run.deadline-Date.parse(run.createdAt)>120001
    ||Date.parse(run.updatedAt)>run.deadline)fail('COMPANION_ACCEPTANCE_DEADLINE');
  if(!Array.isArray(ticks)||ticks.length!==3)fail('COMPANION_ACCEPTANCE_TICKS');
  for(let n=0;n<ticks.length;n++){
    const tick=ticks[n];runShape(tick);
    if(tick.workflowId!==run.workflowId||tick.runId!==run.runId||tick.maxActions!==2||tick.maxPlannerCalls!==2
      ||tick.actions!==Math.min(n+1,2)||tick.plannerCalls!==Math.min(n+1,2)||tick.attempts!==Math.min(n+1,2)
      ||tick.status!==(n===2?'COMPLETED':'QUEUED')||tick.lastCode!==(n===2?'PROJECT_ACCEPTANCE_VERIFIED':'PROJECT_STEP_RECORDED'))
      fail('COMPANION_ACCEPTANCE_TICK_PARITY');
  }
  if(!same(ticks[2],run))fail('COMPANION_ACCEPTANCE_FINAL_SNAPSHOT');
  if(!Array.isArray(run.verification)||run.verification.length!==1)fail('COMPANION_ACCEPTANCE_VERIFIER');
  const verification=run.verification[0];fields(verification,['criterion','passed','code','path','sha256']);
  if(verification.criterion!==0||verification.passed!==true||verification.code!=='PASS'
    ||verification.path!=='HOST_PROOF.json'||verification.sha256!==expectedProofSha256)fail('COMPANION_ACCEPTANCE_VERIFIER');
  fields(envelope,['state','headSha256','memoryIsUntrustedData','acceptanceStatus']);
  if(!HASH.test(envelope.headSha256)||envelope.memoryIsUntrustedData!==true)fail('COMPANION_ACCEPTANCE_STATE_ENVELOPE');
  // Installed workflow_get's outer acceptanceStatus is always UNVALIDATED.
  // The authoritative finalized state is envelope.state, never that label.
  const state=envelope.state;
  if(state?.id!==run.workflowId||state?.device!=='saeid'||state?.lifecycleState!=='COMPLETED'||state?.acceptanceStatus!=='PASS'
    ||!Number.isSafeInteger(state.revision)||state.revision!==run.finalRevision
    ||state.control?.intent!=='ACTIVE'||state.control?.generation!==0||state.scheduler?.enabled!==false
    ||state.scheduler?.automaticContinuation!==false||state.scheduler?.retryBudget!==0||state.scheduler?.lastFailureCode!==null)
    fail('COMPANION_ACCEPTANCE_STATE_NOT_FINAL');
  if(!Array.isArray(state.acceptance)||state.acceptance.length!==1||state.finalization?.status!=='PASS'
    ||!same(state.finalization.acceptanceResults,[true])||!Number.isFinite(Date.parse(state.finalization.validatedAt)))
    fail('COMPANION_ACCEPTANCE_CRITERIA');
  if(!Array.isArray(state.finalization.evidence)||state.finalization.evidence.length!==1)fail('COMPANION_ACCEPTANCE_EVIDENCE');
  const evidence=state.finalization.evidence[0];fields(evidence,['path','bytes','sha256']);
  if(evidence.path!=='HOST_PROOF.json'||evidence.sha256!==expectedProofSha256||!Number.isSafeInteger(evidence.bytes)
    ||evidence.bytes<1||evidence.bytes>4096)fail('COMPANION_ACCEPTANCE_EVIDENCE');
  if(!same(run.brainSync,state.finalization.brainSync)||state.brain?.lastSyncedRevision!==state.revision
    ||state.brain?.lastSyncSha256!==run.brainSync?.jsonSha256||!HASH.test(run.brainSync?.jsonSha256)
    ||!HASH.test(run.brainSync?.markdownSha256))fail('COMPANION_ACCEPTANCE_BRAIN_SYNC');
  fields(operations,['id','operations']);
  if(operations.id!==run.workflowId||!Array.isArray(operations.operations)||operations.operations.length!==2
    ||!Array.isArray(state.steps)||state.steps.length!==2||!Array.isArray(run.history)||run.history.length!==2)
    fail('COMPANION_ACCEPTANCE_JOURNAL');
  const spec=[['observe_status','system_status','READ_ONLY','VERIFIED','verified'],
    ['write_proof','write_text','IDEMPOTENT_MUTATION','EXECUTED','recorded']];
  const operationIds=new Set();
  for(let n=0;n<2;n++){
    const [id,tool,classification,operationStatus,stepStatus]=spec[n],step=state.steps[n],op=operations.operations[n],history=run.history[n];
    if(step.id!==id||step.tool!==tool||step.classification!==classification||step.status!==stepStatus
      ||op.stepId!==id||op.tool!==tool||op.classification!==classification||op.status!==operationStatus||op.resultStatus!=='EXECUTED'
      ||op.exitCode!==null||!UUID.test(op.operationId)||operationIds.has(op.operationId)||!UUID.test(op.attemptId)
      ||!HASH.test(op.inputHash)||!HASH.test(op.idempotencyKey)||!HASH.test(op.preStateHash)
      ||step.operationId!==op.operationId||step.attemptId!==op.attemptId||step.inputHash!==op.inputHash
      ||step.idempotencyKey!==op.idempotencyKey||step.receipt?.operationId!==op.operationId||step.receipt?.inputHash!==op.inputHash
      ||step.receipt?.classification!==classification||step.receipt?.outputStored!==false
      ||history.stepId!==id||history.status!=='RECORDED'||history.operationId!==op.operationId||history.reservedPlannerCalls!==1)
      fail('COMPANION_ACCEPTANCE_JOURNAL_RECEIPT');
    if(step.receipt?.exception||step.receipt?.timedOut||step.receipt?.isError||step.receipt?.ok===false)
      fail('COMPANION_ACCEPTANCE_UNCERTAIN');
    operationIds.add(op.operationId);
  }
  if(!Array.isArray(modelRecords)||modelRecords.length!==2||!Array.isArray(actions)||actions.length!==2)
    fail('COMPANION_ACCEPTANCE_MODEL_ACTION_COUNT');
  const threadIds=new Set();
  for(let n=0;n<2;n++){
    const record=modelRecords[n];
    fields(record,['schema','status','call','model','threadId','usage','choice','streamSha256','artifactSha256','nativeProof','knownDiagnostic','automaticRetry']);
    if(record.schema!==1||record.status!=='PASS_MODEL_PROPOSAL_VALIDATED'||record.call!==n+1||record.model!=='gpt-6.1-sol'
      ||record.choice!=='CONTINUE_STEP'||record.automaticRetry!==false||!UUID.test(record.threadId)||threadIds.has(record.threadId)
      ||!HASH.test(record.streamSha256)||!HASH.test(record.artifactSha256)||![0,1].includes(record.knownDiagnostic))
      fail('COMPANION_ACCEPTANCE_MODEL_RECEIPT');
    const proof=record.nativeProof;fields(proof,NATIVE_KEYS);
    if(proof.schema!==1||proof.status!=='COMPLETED'||proof.win32Error!==0||proof.cleanupWin32Error!==0||proof.cleanupConfirmed!==true
      ||proof.assignedBeforeResume!==true||proof.exitCode!==0||proof.activeJobProcesses!==0||proof.ownedJobTerminated!==false
      ||!Number.isSafeInteger(proof.pid)||proof.pid<1||typeof proof.creationFileTime!=='string'||!/^[1-9][0-9]{0,19}$/.test(proof.creationFileTime)
      ||!Number.isSafeInteger(proof.elapsedMs)||proof.elapsedMs<0||proof.elapsedMs>57000
      ||!Number.isSafeInteger(proof.peakJobMemoryBytes)||proof.peakJobMemoryBytes<0||proof.peakJobMemoryBytes>512*1048576
      ||typeof proof.stdoutHex!=='string'||!/^(?:[a-f0-9]{2})*$/.test(proof.stdoutHex)||proof.stdoutHex.length>131072||proof.stderrHex!=='')
      fail('COMPANION_ACCEPTANCE_NATIVE_PROOF');
    if(!record.usage||!Number.isSafeInteger(record.usage.input_tokens)||record.usage.input_tokens<1
      ||!Number.isSafeInteger(record.usage.output_tokens)||record.usage.output_tokens<1||record.usage.output_tokens>4096)
      fail('COMPANION_ACCEPTANCE_USAGE');
    threadIds.add(record.threadId);
  }
  fields(actions[0],['tool','responseSha256','requestClosed']);fields(actions[1],['tool','path','sha256']);
  if(actions[0].tool!=='system_status'||actions[0].requestClosed!==true||!HASH.test(actions[0].responseSha256)
    ||actions[1].tool!=='write_text'||actions[1].path!=='HOST_PROOF.json'||actions[1].sha256!==expectedProofSha256)
    fail('COMPANION_ACCEPTANCE_ACTION_RECEIPT');
  return Object.freeze({schema:1,status:'PASS_FINITE_COMPANION_ACCEPTANCE',phase:'FINAL_ACCEPTED',
    workflowId:run.workflowId,runId:run.runId,finalRevision:state.revision,actions:2,modelCalls:2,
    proofSha256,coreSnapshotSha256:digest(run),workflowSnapshotSha256:digest(envelope),journalSnapshotSha256:digest(operations),
    proofScope:'FINITE_OWNER_ENROLLED_CHECK_ONLY_NOT_GENERAL_DAEMON',whole:'NOT_FINAL',automaticRetry:false});
}
