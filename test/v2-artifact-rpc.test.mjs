import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {V2CentralCoordinator} from '../src/v2-central-coordinator.mjs';
import {createV2GuardedArtifactActuator} from '../src/v2-guarded-artifact-actuator.mjs';
import {createV2RpcTokenLookup,createV2CoordinatorRpcServer} from '../src/v2-coordinator-rpc.mjs';
import {createV2CoordinatorRpcClient} from '../src/v2-coordinator-rpc-client.mjs';
import {WorkflowStore} from '../src/workflow-store.mjs';
import {V2GrantRegistry} from '../src/v2-grant-registry.mjs';
import {executeV2CoordinatedWorkflowStep} from '../src/v2-coordinated-workflow.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const route=(hostId,conversationId)=>({
 hostId,conversationId,principalId:'owner',profileId:'profile',
 operationId:'write',target:{kind:'workflow-root',id:'shared-project'}
});
const a=route('host-a','chat-a'),b=route('host-b','chat-b');
const binding=r=>({hostId:r.hostId,conversationId:r.conversationId,
 principalId:r.principalId,profileId:r.profileId});
async function fixture({enabled=true}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-artifact-rpc-'));
 let clock=100000;
 const coordinator=new V2CentralCoordinator({directory,now:()=>clock,
  authorizeLease:async()=>true,
  resolveGlobalResource:async()=> 'one-trusted-volume',requireGlobalResource:true});
 const artifactActuator=createV2GuardedArtifactActuator({coordinator});
 const tokens=[randomBytes(32).toString('base64url'),randomBytes(32).toString('base64url')];
 const server=createV2CoordinatorRpcServer({coordinator,artifactActuator:enabled?artifactActuator:null,
  lookupToken:createV2RpcTokenLookup([a,b].map((route,i)=>({
   tokenSha256:sha(tokens[i]),binding:binding(route)})))});
 const {port}=await server.listen();
 const endpoint='http://127.0.0.1:'+port;
 const client=i=>createV2CoordinatorRpcClient({endpoint,
  tokenProvider:async()=>tokens[i],observedCaller:async()=>binding(i===0?a:b)});
 return {directory,server,coordinator,artifactActuator,client,endpoint,tokens,
  advance:n=>clock+=n,
  async close(){await server.close();coordinator.close();fs.rmSync(directory,{recursive:true,force:true});}};
}
test('two authenticated remote routes: only current fence creates one private artifact',async()=>{
 const f=await fixture();
 try{
  const first=f.client(0),second=f.client(1);
  const held=await first.acquire({route:a,ttlMs:4000});
  const initial=await first.createPrivateArtifact({
   route:a,lease:held,receiptId:'private-1',content:'one bounded remote effect'});
  assert.equal(initial.committed,true);
  assert.equal(initial.fence,1);
  assert.equal(initial.recovered,false);
  assert.equal(initial.replayed,false);
  assert.equal(initial.digest,sha('one bounded remote effect'));
  const repeated=await first.createPrivateArtifact({
   route:a,lease:held,receiptId:'private-1',content:'one bounded remote effect'});
  assert.equal(repeated.replayed,true);
  const proof=await second.observePrivateArtifact({route:b,receiptId:'private-1'});
  assert.equal(proof.committed,true);
  assert.equal(proof.digest,initial.digest);
  assert.equal(await second.observePrivateArtifact({route:b,receiptId:'absent'}).then(v=>v.committed),false);
  await assert.rejects(second.createPrivateArtifact({route:b,lease:held,
   receiptId:'foreign',content:'unauthorized'}),{code:'V2_COORDINATOR_STALE_LEASE'});
  await first.release({route:a,lease:held});
  const next=await second.acquire({route:b});
  assert.equal(next.fence,2);
  await assert.rejects(second.createPrivateArtifact({route:b,lease:next,
    receiptId:'private-1',content:'attempt overwrite'}),{code:'V2_ARTIFACT_RECEIPT_CONFLICT'});
  const good=await second.createPrivateArtifact({route:b,lease:next,
    receiptId:'private-2',content:'second valid'});
  assert.equal(good.fence,2);
  await second.release({route:b,lease:next});
 }finally{await f.close();}
});
test('artifact routes disabled by default; bad shapes, caller claims and overflow fail closed',async()=>{
 const disabled=await fixture({enabled:false});
 try{
  const c=disabled.client(0);
  const held=await c.acquire({route:a});
  await assert.rejects(c.createPrivateArtifact({route:a,lease:held,receiptId:'new',
   content:'private'}),{code:'V2_RPC_NOT_FOUND'});
  assert.equal((await fetch(disabled.endpoint+'/v2/lease/create-artifact',
   {method:'POST'})).status,404);
 }finally{await disabled.close();}
 const f=await fixture();
 try{
  const client=f.client(0),held=await client.acquire({route:a});
  await assert.rejects(client.createPrivateArtifact({route:b,lease:held,receiptId:'other',
   content:'wrong route'}),{code:'V2_ROUTE_CALLER_MISMATCH'});
  await assert.rejects(client.createPrivateArtifact({route:a,lease:held,
   receiptId:'unsafe/../',content:'x'}),{code:'V2_RPC_CLIENT_ARTIFACT_INVALID'});
  await assert.rejects(client.createPrivateArtifact({route:a,lease:held,
   receiptId:'large',content:'x'.repeat(6145)}),{code:'V2_RPC_CLIENT_ARTIFACT_INVALID'});
  const r=await fetch(f.endpoint+'/v2/lease/create-artifact',{
   method:'POST',headers:{authorization:'Bearer '+f.tokens[0],
    'content-type':'application/json'},
   body:JSON.stringify({route:a,lease:held,receiptId:'body',content:'value',digest:sha('value')})
  });
  assert.equal(r.status,400);
 }finally{await f.close();}
});
test('real durable WorkflowStore workflow reaches only the bounded coordinator-side artifact over RPC',async()=>{
 const f=await fixture();
 const root=path.join(f.directory,'workflow-root');fs.mkdirSync(root);
 const store=new WorkflowStore({
  directory:path.join(f.directory,'store'),rootLeaseDirectory:path.join(f.directory,'root-leases'),
  allowedRoots:[f.directory],device:'host-a',configSha256:'1'.repeat(64),
  authority:{profileId:'profile',tier:'FULL_POWER',capabilities:[
   'filesystem.full','workflow.durable','workflow.scheduler']},
  schedulerPolicy:{enabled:true,resumeInterrupted:true,resumeAfterRestart:true,
   resumeAfterUpdate:true,oneWriterPerRoot:true,maxConcurrentProjects:1,
   leaseMs:5000,intervalMs:1000,retryBudget:3}
 });
 const grants=new V2GrantRegistry({directory:path.join(f.directory,'permissions'),
  authorizeAdministration:({actor})=>actor==='admin'});
 try{
  store.create({id:'shared-project',root,goal:'isolated guarded artifact',
   acceptance:['one immutable file'],steps:[{id:'write',title:'once'}]});
  grants.change({route:a,tool:'write_text',status:'ENABLED',expectedRevision:0,
   actor:'admin',reason:'fixture only'});
  const client=f.client(0);
  let calls=0;
  const result=await executeV2CoordinatedWorkflowStep({
   coordinator:client,route:a,ttlMs:3000,stepId:'write',expectedRevision:1,
   tool:'write_text',arguments:{path:path.join(root,'project.txt'),content:'bounded fixture'},
   workflowStore:store,grantRegistry:grants,observedCaller:async()=>binding(a),
   authorizeTool:async()=>true,
   commitWithFence:async({resource,leaseId,fence,args,assertCurrent})=>{
    await assertCurrent();calls++;
    return client.createPrivateArtifact({route:a,lease:{id:leaseId,resource,fence,
      expiresAtMs:103000},receiptId:'write',content:args.content});
   }
  });
  assert.equal(result.outcome,'RECORDED_NOT_VALIDATED');
  assert.equal(calls,1);
  assert.equal((await client.observePrivateArtifact({route:a,receiptId:'write'})).committed,true);
  assert.equal(fs.existsSync(path.join(root,'project.txt')),false,
   'project-supplied path must never be a physical write target');
 }finally{grants.close();store.close();await f.close();}
});
