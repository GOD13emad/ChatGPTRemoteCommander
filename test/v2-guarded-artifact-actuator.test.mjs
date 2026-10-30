import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {V2CentralCoordinator} from '../src/v2-central-coordinator.mjs';
import {createV2GuardedArtifactActuator} from '../src/v2-guarded-artifact-actuator.mjs';
import {WorkflowStore} from '../src/workflow-store.mjs';
import {V2GrantRegistry} from '../src/v2-grant-registry.mjs';
import {executeV2CoordinatedWorkflowStep} from '../src/v2-coordinated-workflow.mjs';

const route=(hostId,conversationId)=>({
 hostId,principalId:'owner',profileId:'profile',conversationId,
 operationId:'write',target:{kind:'workflow-root',id:'shared-project'}
});
const a=route('host-a','chat-a'),b=route('host-b','chat-b');
const binding=r=>({hostId:r.hostId,principalId:r.principalId,
 profileId:r.profileId,conversationId:r.conversationId});
const sha=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-artifact-'));
 let now=120000,allowed=true;
 const options={directory,now:()=>now,authorizeLease:async()=>allowed,
  requireGlobalResource:true,resolveGlobalResource:async()=> 'shared-physical-root'};
 const coordinator=new V2CentralCoordinator(options);
 const actuator=createV2GuardedArtifactActuator({coordinator});
 return {directory,coordinator,actuator,options,
  revoke:()=>allowed=false,advance:n=>now+=n,
  close:()=>{coordinator.close();fs.rmSync(directory,{force:true,recursive:true});}};
}
function artifactPath(f,lease,id){
 const h=sha(lease.resource);
 return path.join(f.directory,'v2-private-artifacts',h,id+'.artifact');
}
test('two chat routes to a shared resource: one fenced immutable physical artifact',async()=>{
 const f=fixture();
 try{
  const first=await f.coordinator.acquire({route:a,ttlMs:2000});
  const out=await f.actuator.create({route:a,lease:first,receiptId:'run-1',content:'isolated original'});
  assert.equal(out.committed,true);assert.equal(out.replayed,false);
  assert.equal(fs.readFileSync(artifactPath(f,first,'run-1'),'utf8'),'isolated original');
  const same=await f.actuator.create({route:a,lease:first,receiptId:'run-1',content:'isolated original'});
  assert.equal(same.replayed,true);
  await assert.rejects(f.actuator.create({route:a,lease:first,receiptId:'run-1',
   content:'different'}),{code:'V2_ARTIFACT_RECEIPT_CONFLICT'});
  await assert.rejects(f.coordinator.acquire({route:b}),{code:'V2_COORDINATOR_RESOURCE_BUSY'});
  await f.coordinator.release({route:a,lease:first});
  const second=await f.coordinator.acquire({route:b});
  assert.equal(second.fence,2);
  await assert.rejects(f.actuator.create({route:a,lease:first,
   receiptId:'run-2',content:'stale'}),{code:'V2_COORDINATOR_STALE_LEASE'});
  await assert.rejects(f.actuator.create({route:b,lease:second,
   receiptId:'run-1',content:'different holder'}),
   {code:'V2_ARTIFACT_RECEIPT_CONFLICT'});
  const next=await f.actuator.create({route:b,lease:second,receiptId:'run-2',content:'valid'});
  assert.equal(next.fence,2);
  assert.equal((await f.actuator.observe({route:b,receiptId:'run-2'})).digest,sha('valid'));
 }finally{f.close();}
});
test('restart preserves both exact artifact bytes and SQLite fencing receipt',async()=>{
 const f=fixture();let secondary;
 try{
  const l=await f.coordinator.acquire({route:a});
  await f.actuator.create({route:a,lease:l,receiptId:'durable-1',content:'persistent bytes'});
  secondary=new V2CentralCoordinator(f.options);
  const checker=createV2GuardedArtifactActuator({coordinator:secondary});
  assert.equal((await checker.observe({route:a,receiptId:'durable-1'})).committed,true);
  await assert.rejects(checker.create({route:b,lease:l,
   receiptId:'other',content:'foreign'}),{code:'V2_COORDINATOR_STALE_LEASE'});
 }finally{secondary?.close();f.close();}
});
test('interrupted post-link/pre-receipt mutation is reconciled without re-execution',async()=>{
 const f=fixture();
 try{
  const lease=await f.coordinator.acquire({route:a});
  const target=artifactPath(f,lease,'interrupted');
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  fs.writeFileSync(target,'existing exact bytes',{flag:'wx',mode:0o600});
  const result=await f.actuator.create({route:a,lease,receiptId:'interrupted',
   content:'existing exact bytes'});
  assert.equal(result.recovered,true);
  assert.equal(result.replayed,false);
  assert.equal(fs.readFileSync(target,'utf8'),'existing exact bytes');
  const identical=await f.actuator.create({route:a,lease,receiptId:'interrupted',
   content:'existing exact bytes'});
  assert.equal(identical.replayed,true);
  assert.equal(identical.recovered,false);
 }finally{f.close();}
});
test('conflicting existing physical artifact refuses overwrite',async()=>{
 const f=fixture();
 try{
  const l=await f.coordinator.acquire({route:a});
  fs.mkdirSync(path.dirname(artifactPath(f,l,'collision')),{recursive:true,mode:0o700});
  fs.writeFileSync(artifactPath(f,l,'collision'),'do not replace',{flag:'wx',mode:0o600});
  await assert.rejects(f.actuator.create({route:a,lease:l,receiptId:'collision',
    content:'new data'}),{code:'V2_ARTIFACT_EXISTING_CONFLICT'});
  assert.equal(fs.readFileSync(artifactPath(f,l,'collision'),'utf8'),'do not replace');
 }finally{f.close();}
});
test('existing symlink injection is refused when native host permits link creation',async(t)=>{
 const f=fixture();
 try{
  const l=await f.coordinator.acquire({route:a});
  const outside=path.join(f.directory,'outside.txt');
  fs.writeFileSync(outside,'sensitive original',{flag:'wx'});
  const target=artifactPath(f,l,'alias');
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  try{fs.symlinkSync(outside,target);}
  catch(e){
   // Restricted Windows operators cannot mint test symlinks. This is an
   // explicit untested boundary, not an actuator PASS or a reason to elevate.
   if(process.platform==='win32'&&e.code==='EPERM'){
    t.skip('NATIVE_SYMLINK_CREATION_DENIED');
    return;
   }
   throw e;
  }
  await assert.rejects(f.actuator.create({route:a,lease:l,receiptId:'alias',
    content:'new data'}),{code:'V2_ARTIFACT_EXISTING_UNSAFE'});
  assert.equal(fs.readFileSync(outside,'utf8'),'sensitive original');
 }finally{f.close();}
});
test('tampered durable artifact must not be represented as a verified receipt',async()=>{
 const f=fixture();
 try{
  const held=await f.coordinator.acquire({route:a});
  await f.actuator.create({route:a,lease:held,receiptId:'tamper',content:'original'});
  fs.writeFileSync(artifactPath(f,held,'tamper'),'external tampering');
  await assert.rejects(f.actuator.observe({route:a,receiptId:'tamper'}),
    {code:'V2_ARTIFACT_INTEGRITY_FAILED'});
  await assert.rejects(f.actuator.create({route:a,lease:held,
   receiptId:'tamper',content:'original'}),{code:'V2_ARTIFACT_EXISTING_CONFLICT'});
 }finally{f.close();}
});
test('expired, revoked, malformed, large or host-local leases never touch physical bytes',async()=>{
 const f=fixture();
 try{
  assert.throws(()=>createV2GuardedArtifactActuator({coordinator:{}}),
   {code:'V2_ARTIFACT_TRUSTED_COORDINATOR_REQUIRED'});
  const l=await f.coordinator.acquire({route:a,ttlMs:1000});
  await assert.rejects(f.actuator.create({route:a,lease:l,
   receiptId:'invalid/../../',content:'bad'}),{code:'V2_ARTIFACT_ARGUMENT_INVALID'});
  await assert.rejects(f.actuator.create({route:a,lease:l,
   receiptId:'huge',content:'x'.repeat(65537)}),{code:'V2_ARTIFACT_ARGUMENT_INVALID'});
  await assert.rejects(f.actuator.create({route:a,lease:l,
   receiptId:'CON',content:'should-reject-on-windows-and-linux'}),
   {code:'V2_ARTIFACT_ARGUMENT_INVALID'});
  await assert.rejects(f.actuator.create({route:a,lease:l,
   receiptId:'file:name',content:'colon'}),
   {code:'V2_ARTIFACT_ARGUMENT_INVALID'});
  f.advance(1001);
  await assert.rejects(f.actuator.create({route:a,lease:l,
   receiptId:'late',content:'fail'}),{code:'V2_COORDINATOR_STALE_LEASE'});
  f.revoke();
  await assert.rejects(f.actuator.create({route:a,lease:l,
   receiptId:'revoked',content:'fail'}),{code:'V2_COORDINATOR_AUTH_REQUIRED'});
  assert.equal(fs.existsSync(artifactPath(f,l,'late')),false);
  assert.equal(fs.existsSync(artifactPath(f,l,'revoked')),false);
 }finally{f.close();}
});
test('real durable WorkflowStore gateway invokes a guarded physical artifact once',async()=>{
 const f=fixture();
 const root=path.join(f.directory,'synthetic-workflow');fs.mkdirSync(root);
 const store=new WorkflowStore({directory:path.join(f.directory,'store'),
  rootLeaseDirectory:path.join(f.directory,'root-leases'),allowedRoots:[f.directory],
  device:'host-a',configSha256:'1'.repeat(64),
  authority:{profileId:'profile',tier:'FULL_POWER',capabilities:[
   'filesystem.full','workflow.durable','workflow.scheduler']},
  schedulerPolicy:{enabled:true,resumeInterrupted:true,resumeAfterRestart:true,
   resumeAfterUpdate:true,oneWriterPerRoot:true,maxConcurrentProjects:1,
   leaseMs:5000,intervalMs:1000,retryBudget:3}});
 const grants=new V2GrantRegistry({directory:path.join(f.directory,'permissions'),
  authorizeAdministration:({actor})=>actor==='admin'});
 try{
  store.create({id:'shared-project',root,goal:'bounded physical artifact',
   acceptance:['immutable original'],steps:[{id:'write',title:'create immutable artifact'}]});
  grants.change({route:a,tool:'write_text',status:'ENABLED',expectedRevision:0,
   actor:'admin',reason:'synthetic fixture'});
  let calls=0;
  const output=await executeV2CoordinatedWorkflowStep({
   coordinator:f.coordinator,route:a,ttlMs:3000,
   stepId:'write',expectedRevision:1,tool:'write_text',
   arguments:{path:path.join(root,'synthetic.txt'),content:'bounded content'},
   workflowStore:store,grantRegistry:grants,
   observedCaller:async()=>binding(a),authorizeTool:async()=>true,
   commitWithFence:async({resource,leaseId,fence,assertCurrent,args})=>{
    await assertCurrent();calls++;
    return f.actuator.create({route:a,lease:{id:leaseId,resource,fence},
      receiptId:'write',content:args.content});
   }
  });
  assert.equal(output.outcome,'RECORDED_NOT_VALIDATED');
  assert.equal(calls,1);
  const observed=await f.actuator.observe({route:a,receiptId:'write'});
  assert.equal(observed.committed,true);
  assert.equal(fs.existsSync(path.join(root,'synthetic.txt')),false);
  assert.equal(fs.readFileSync(path.join(f.directory,'v2-private-artifacts',
    sha('["global-v1","workflow-root","shared-physical-root"]'),'write.artifact'),'utf8'),
    'bounded content');
 }finally{grants.close();store.close();f.close();}
});
