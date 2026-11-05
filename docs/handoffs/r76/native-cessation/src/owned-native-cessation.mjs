// Host-only managed-executor witness. Never register these methods as MCP tools.
// No caller-supplied receipt can be admitted: evidence comes only from this
// instance's own trusted nativeRunner invocation and private in-memory registry.
import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i,fp=/^[a-f0-9]{64}$/;
const fail=code=>{throw Object.assign(Error(code),{code});};
const rootKey=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
export function sameNativeIdentity(actual,expected){
 return Number.isSafeInteger(actual?.pid)&&actual.pid>0&&typeof actual.creationFileTime==='string'
  && /^[1-9][0-9]{0,19}$/.test(actual.creationFileTime)&&actual.pid===expected?.pid
  && actual.creationFileTime===expected?.creationFileTime;
}
export function createOwnedNativeCessationOracle({nativeRunner,nativeConfig,leaseStoreFingerprint,launchLeasePreflight,authorizeContainedExecution}){
 if([nativeRunner,leaseStoreFingerprint,launchLeasePreflight,authorizeContainedExecution].some(fn=>typeof fn!=='function'))fail('NATIVE_CESSATION_HOST_DEPENDENCY_REQUIRED');
 const config=Object.freeze({...nativeConfig}),entries=new Map(),attempted=new Set();
 async function runOwned({state,stepId,args,input=''}){
  // Execute exactly the private immutable-value snapshot the policy reviews,
  // not caller-owned arrays/state that can change while policy awaits.
  state=structuredClone(state);args=structuredClone(args);
  if(typeof input!=='string')fail('NATIVE_CESSATION_INPUT_REQUIRED');
  const step=state?.steps?.find(x=>x.id===stepId);
  if(!step||step.status!=='running'||!uuid.test(step.operationId)||typeof state.root!=='string'
   ||typeof state.id!=='string'||typeof state.authority?.profileId!=='string')fail('NATIVE_CESSATION_EXECUTING_BINDING_REQUIRED');
  const storeFingerprint=leaseStoreFingerprint();if(!fp.test(storeFingerprint))fail('NATIVE_CESSATION_STORE_IDENTITY_REQUIRED');
  if(attempted.has(step.operationId))fail('NATIVE_CESSATION_NO_EXECUTION_REPLAY');
  const launch=launchLeasePreflight(state.id),currentOp=launch?.operations?.length===1?launch.operations[0]:null;
  if(!currentOp||currentOp.operationId!==step.operationId||currentOp.stepId!==stepId||currentOp.outcomeState!=='running'
   ||launch.workflowId!==state.id||launch.rootFingerprint!==sha(rootKey(state.root))
   ||launch.lease?.storeFingerprint!==storeFingerprint||!fp.test(launch.lease?.fingerprint))fail('NATIVE_CESSATION_LAUNCH_LEASE_BINDING_REQUIRED');
  // A Job Object does not fence IPC or remotely submitted work. The trusted
  // host must restrict this narrow witness to a reviewed fixed local action;
  // arbitrary shell/app/network actions cannot get this proof by default.
  if(await authorizeContainedExecution({state:structuredClone(state),stepId,args:structuredClone(args),input,nativeConfig:{...config}})!==true)fail('NATIVE_CESSATION_EXTERNAL_EFFECT_FENCE_REQUIRED');
  // Policy can await native/owner checks. Revalidate the exact current claim
  // and control state after that await, before any execution can start.
  const fresh=launchLeasePreflight(state.id),freshOp=fresh?.operations?.length===1?fresh.operations[0]:null;
  if(!freshOp||freshOp.operationId!==step.operationId||freshOp.stepId!==stepId||freshOp.outcomeState!=='running'
   ||fresh.workflowId!==state.id||fresh.rootFingerprint!==launch.rootFingerprint
   ||fresh.lease?.storeFingerprint!==storeFingerprint||fresh.lease?.fingerprint!==launch.lease.fingerprint
   ||fresh.controlActive!==true)fail('NATIVE_CESSATION_LAUNCH_LEASE_CHANGED');
  const binding=Object.freeze({workflowId:state.id,stepId,operationId:step.operationId,
   rootFingerprint:sha(rootKey(state.root)),leaseStoreFingerprint:storeFingerprint,
   leaseFingerprint:launch.lease.fingerprint,
   profile:state.authority.profileId,device:state.device});
  attempted.add(step.operationId); // A failed/uncertain launch is never retry authority.
  const result=await nativeRunner({...config,cwd:state.root,args,input});
  const p=result?.proof;
  if(result.closed!==true||!Number.isSafeInteger(result.helperPid)||result.helperPid<=0
   ||!sameNativeIdentity(p,p)||p.pid===result.helperPid||p.assignedBeforeResume!==true
   ||p.cleanupConfirmed!==true||p.cleanupWin32Error!==0||p.activeJobProcesses!==0
   ||typeof p.ownedJobTerminated!=='boolean')fail('NATIVE_CESSATION_TREE_NOT_PROVEN');
  // The native helper holds actual process/job handles, binds creation time,
  // assigns before resume, and does not return confirmed cleanup with a child
  // still in that Job Object. PID reuse alone cannot match this witness.
  const record=Object.freeze({binding,identity:Object.freeze({pid:p.pid,creationFileTime:p.creationFileTime}),
   helperPid:result.helperPid,proofDigest:sha(JSON.stringify(p)),completedUtc:new Date().toISOString(),
   attestationId:randomUUID(),nativeStatus:p.status,ownedJobTerminated:p.ownedJobTerminated});
  entries.set(binding.operationId,record);
  return {exitCode:result.exitCode,signal:result.signal,proof:structuredClone(p),binding};
 }
 async function verifyNativeCessation(preview){
  const op=preview?.operations?.length===1?preview.operations[0]:null;
  const record=op&&entries.get(op.operationId),b=record?.binding;
  if(!record||!b||op.stepId!==b.stepId||preview.workflowId!==b.workflowId
   ||preview.rootFingerprint!==b.rootFingerprint||preview.lease?.storeFingerprint!==b.leaseStoreFingerprint
   ||preview.lease?.fingerprint!==b.leaseFingerprint
   ||!fp.test(preview.lease?.fingerprint)||Date.now()-Date.parse(record.completedUtc)>30000
   ||Date.now()<Date.parse(record.completedUtc))return {verified:false};
  return {verified:true,processTreeStopped:true,allDescendantsStopped:true,externalEffectsFenced:true,
   operationId:b.operationId,rootFingerprint:b.rootFingerprint,leaseStoreFingerprint:b.leaseStoreFingerprint,
   leaseFingerprint:preview.lease.fingerprint,witness:'V1-02_OWNED_WINDOWS_JOB',
   attestationId:record.attestationId,verifiedAt:record.completedUtc,
   executorPid:record.identity.pid,executorCreationFileTime:record.identity.creationFileTime,
   nativeHelperPid:record.helperPid,nativeProofDigest:record.proofDigest,
   nativeStatus:record.nativeStatus,ownedJobTerminated:record.ownedJobTerminated};
 }
 return Object.freeze({runOwned,verifyNativeCessation});
}
