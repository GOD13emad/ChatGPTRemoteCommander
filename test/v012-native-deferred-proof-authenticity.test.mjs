import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureWindowsMonitorDirectories} from '../src/browser-companion-windows-private.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {createAsyncOperationTools} from '../src/async-operations.mjs';
import {createV012OwnerNativeHostLease} from '../src/v012-owner-native-host-lease-bootstrap.mjs';
import {createV012SharedPhysicalRootFence} from '../src/v012-shared-physical-root-fence.mjs';
import {processContainmentAvailable} from '../src/process-containment.mjs';
test('same-OS-owner stored receipt must not clear native host root while child tree is active', {timeout:90000}, async t=>{
const sha=b=>createHash('sha256').update(b).digest('hex');
if(!await processContainmentAvailable())return t.skip('native worker containment unavailable');
const host='qa-owner',parent=fs.realpathSync.native(os.tmpdir());
const top=process.platform==='win32'
  ?path.join(parent,'rc012-proof-auth-'+randomUUID())
  :fs.mkdtempSync(path.join(parent,'rc012-proof-auth-'));
if(process.platform==='win32')await ensureWindowsMonitorDirectories([top],{create:true});
else fs.chmodSync(top,0o700);
const stateRoot=path.join(top,'async'),flag=path.join(top,'allow-done');
const route={hostId:host,principalId:'owner',profileId:'default',
  conversationId:'fixture-chat',operationId:'qa-operation',
  target:{kind:'workflow-root',id:'project'}};
let native,tools,observed,pid=null,evidence=null;
try{
 native=await createV012OwnerNativeHostLease({directory:top,hostId:host});
 let fence;
 const prepare=async()=>({
  kind:'process',file:process.execPath,
  args:['-e',"const fs=require('node:fs');const p="+JSON.stringify(flag)+";let t=setInterval(()=>{if(fs.existsSync(p)){clearInterval(t);process.stdout.write('done')}} ,35);"],
  cwd:top,timeoutMs:15000
 });
 fence=createV012SharedPhysicalRootFence({
   nativeHostLease:native,hostId:host,allowedRoots:[top],
   resolveTrustedRouteRoot:()=>top,
   readDeferredCompletion:req=>tools.readNativeRootCompletion(req)
 });
 tools=createAsyncOperationTools({
  config:{asyncOperations:{enabled:true,stateDir:stateRoot}},
  nativeRootExecution:{
   required:()=>true,
   bind:meta=>{
     observed={...meta,binding:fence.bindDeferredOperation(meta)};
     return observed.binding;
   }
  },
  prepare
 });
 const requestId='fixture-'+randomUUID();
 const queued=await fence.withDirectRouteLease(route,()=>tools.execute('operation_start',{
   requestId,tool:'run_project_command',arguments:{}
  },{authorizeNativeLaunch:async()=>true}));
 const requestPath=path.join(observed.storage.stateRoot,'requests',observed.storage.requestKey+'.json');
 const reservation=JSON.parse(fs.readFileSync(requestPath,'utf8'));
 pid=reservation.nativeSupervisorPid;
 if(queued.status!=='QUEUED'||!Number.isInteger(pid))throw Error('EXPECTED_NATIVE_QUEUED_SUPERVISOR');
 // The same-OS-owner test actor can rewrite the private reservation too.
 // A mere stored-PID liveness check must not be mistaken for broker proof.
 fs.writeFileSync(requestPath,JSON.stringify({
   ...reservation,nativeSupervisorPid:2147483647
 })+'\n',{mode:0o600});
 const operationId=queued.operationId,inputHash=observed.inputHash,binding=observed.binding;
 const proof={schema:1,...Object.fromEntries([
   'workflowId','stepId','operationId','rootFingerprint','revision','leaseId','fencingToken'
 ].map(k=>[k,binding[k]])),
 provider:process.platform==='win32'?'windows-job-object':'systemd-service-exit-type-cgroup',runId:operationId,activeProcesses:0,verified:true,
 outcome:'synthetic',cleanupRequired:false,completedAt:new Date().toISOString()};
 proof.proofDigest=sha(JSON.stringify(proof));
 const receipt=Buffer.from(JSON.stringify({
  operationId,inputHash,status:'SUCCEEDED',tool:'run_project_command',
  finishedAt:new Date().toISOString()
 })+'\n');
 const opDir=path.join(stateRoot,'operations',operationId);
 fs.writeFileSync(path.join(opDir,'result.json'),receipt,{mode:0o600,flag:'wx'});
 fs.writeFileSync(path.join(opDir,'native-completion.json'),JSON.stringify({
  schema:1,operationId,inputHash,receiptSha256:sha(receipt),processCessationProof:proof
 })+'\n',{mode:0o600,flag:'wx'});
 const accepted=!!(await tools.readNativeRootCompletion(observed));
 const doneFileBefore=fs.existsSync(flag);
 let alive=false;try{process.kill(pid,0);alive=true;}catch{}
 let effects=0,admitted=false,error=null;
 try{await fence.withWorkflowRootLease(top,async()=>{effects++;return {ok:true};});admitted=true;}
 catch(e){error=e.code??e.message;}
 const summary={source:'c77e4aa',nativeContainmentAvailable:true,
   syntheticPrivateFilesAccepted:accepted,supervisorAliveAtReleaseCheck:alive,
   realWorkerReleaseFlagSet:doneFileBefore,secondEffectAdmittedBeforeRelease:admitted,
   secondEffects:effects,denialCode:error,scope:'synthetic fixture, same-OS-owner file write, not remote Chat grant'};
 evidence=summary;
}finally{
 try{fs.writeFileSync(flag,'release',{mode:0o600});}catch{}
 if(pid!==null){
  for(let i=0;i<60;i++){
    let alive=false;try{process.kill(pid,0);alive=true;}catch{}
    if(!alive)break;
    await new Promise(r=>setTimeout(r,150));
  }
 }
 let supervisorAlive=false;
 if(pid!==null){try{process.kill(pid,0);supervisorAlive=true;}catch{}}
 if(supervisorAlive) {try{process.kill(pid,'SIGTERM');}catch{}}
 await tools?.close().catch(()=>{});
 try{native?.close();}catch{}
 if(!supervisorAlive&&fs.existsSync(top)){
  fs.rmSync(top,{recursive:true,force:true});
  t.diagnostic('SYNTHETIC_ROOT_CLEANED=TRUE');
 }else{
  t.diagnostic('SYNTHETIC_ROOT_RETAINED_DUE_TO_RUNNING_SUPERVISOR='+supervisorAlive);
 }
}

assert.equal(evidence?.realWorkerReleaseFlagSet,false,'worker remains active before release marker');
assert.equal(evidence?.supervisorAliveAtReleaseCheck,true,'real native supervisor must still be running');
assert.equal(evidence?.syntheticPrivateFilesAccepted,false,
  'owner-root reader must not accept same-owner forged completion files without native provenance');
assert.equal(evidence?.secondEffectAdmittedBeforeRelease,false,
  'same-owner forged receipt must not release occupied native host root');
});
