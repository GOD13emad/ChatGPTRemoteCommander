import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {V2CentralCoordinator} from '../src/v2-central-coordinator.mjs';
import {createV2CoordinatorRpcServer,createV2RpcTokenLookup} from '../src/v2-coordinator-rpc.mjs';
import {createV2CoordinatorRpcClient} from '../src/v2-coordinator-rpc-client.mjs';
import {WorkflowStore} from '../src/workflow-store.mjs';
import {V2GrantRegistry} from '../src/v2-grant-registry.mjs';
import {executeV2CoordinatedWorkflowStep} from '../src/v2-coordinated-workflow.mjs';


const route=(hostId,conversationId)=>({hostId,principalId:'owner',
 profileId:'profile',conversationId,operationId:'write',
 target:{kind:'workflow-root',id:'shared-project'}});
const a=route('win-host','chat-a'),b=route('linux-host','chat-b');
const binding=r=>({hostId:r.hostId,principalId:r.principalId,profileId:r.profileId,conversationId:r.conversationId});
async function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-rpc-client-'));
 const tokens=[randomBytes(32).toString('base64url'),randomBytes(32).toString('base64url')];
 let now=500000,allowed=true;
 const coordinator=new V2CentralCoordinator({directory,now:()=>now,
  authorizeLease:async()=>allowed,
  requireGlobalResource:true,resolveGlobalResource:async()=> 'one-trusted-project'});
 const lookupToken=createV2RpcTokenLookup([a,b].map((r,i)=>({
  tokenSha256:createHash('sha256').update(tokens[i]).digest('hex'),binding:binding(r)})));
 const server=createV2CoordinatorRpcServer({coordinator,lookupToken});
 const {port}=await server.listen();
 const endpoint='http://127.0.0.1:'+port;
 const client=(i)=>createV2CoordinatorRpcClient({endpoint,
  tokenProvider:async()=>tokens[i],observedCaller:async()=>binding(i===0?a:b)});
 return {a,b,client,endpoint,directory,revoke:()=>allowed=false,advance:n=>now+=n,
  close:async()=>{await server.close();coordinator.close();fs.rmSync(directory,{recursive:true,force:true});}};
}
test('two real native clients on different host routes share one durable fenced lease',async()=>{
 const f=await fixture();
 try{
  const first=f.client(0),second=f.client(1);
  let resolve,entered;const held=new Promise(ok=>resolve=ok);
  const begun=new Promise(ok=>entered=ok);
  const task=first.withFencedLease({route:a,ttlMs:2000,run:async({lease,resource,assertCurrent})=>{
   assert.equal(lease.fence,1);
   assert.equal(resource,'["global-v1","workflow-root","one-trusted-project"]');
   entered();await held;await assertCurrent();return 'isolated-complete';
  }});
  await begun;
  await assert.rejects(second.acquire({route:b}),{code:'V2_COORDINATOR_RESOURCE_BUSY'});
  resolve();
  assert.equal(await task,'isolated-complete');
  const next=await second.acquire({route:b});
  assert.equal(next.fence,2);
  assert.equal(next.resource,'["global-v1","workflow-root","one-trusted-project"]');
  await second.release({route:b,lease:next});
 }finally{f.close&&await f.close();}
});
test('token belongs to a trusted observed host and chat; caller cannot claim a new route',async()=>{
 const f=await fixture();
 try{
  const first=f.client(0);
  await assert.rejects(first.acquire({route:b}),{code:'V2_ROUTE_CALLER_MISMATCH'});
  await assert.rejects(first.acquire({route:{...a,conversationId:'another-chat'}}),
   {code:'V2_ROUTE_CALLER_MISMATCH'});
  const authorized=await first.acquire({route:a});
  await assert.rejects(f.client(1).assertCurrent({route:b,lease:authorized}),
   {code:'V2_COORDINATOR_STALE_LEASE'});
  assert.equal(await first.release({route:a,lease:authorized}),true);
 }finally{await f.close();}
});
test('coordinator revocation prevents a previously admitted worker from reporting success',async()=>{
 const f=await fixture();
 try{
  await assert.rejects(f.client(0).withFencedLease({route:a,run:async({assertCurrent})=>{
   await assertCurrent();f.revoke();return 'must-not-confirm';
  }}),{code:'V2_COORDINATOR_AUTH_REQUIRED'});
 }finally{await f.close();}
});
test('lease expiry makes delayed work fail closed and allows a strictly higher fence',async()=>{
 const f=await fixture();
 try{
  await assert.rejects(f.client(0).withFencedLease({route:a,ttlMs:1000,
    run:async()=>{f.advance(1001);return 'not-confirmed';}}),
    {code:'V2_COORDINATOR_STALE_LEASE'});
  const next=await f.client(1).acquire({route:b});
  assert.equal(next.fence,2);
  await f.client(1).release({route:b,lease:next});
 }finally{await f.close();}
});
test('client rejects nonloopback endpoints, missing credentials, untrusted calls and unknown delivery',async()=>{
 const f=await fixture();
 try{
  for(const endpoint of ['https://127.0.0.1:3000','http://localhost:3000',
   'http://192.168.1.1:3000','http://127.0.0.1:3000/path']){
   assert.throws(()=>createV2CoordinatorRpcClient({endpoint,
      tokenProvider:async()=>'',observedCaller:async()=>binding(a)}),
      {code:'V2_RPC_CLIENT_LOOPBACK_ONLY'});
  }
  await assert.rejects(createV2CoordinatorRpcClient({endpoint:f.endpoint,
    tokenProvider:async()=>'',observedCaller:async()=>binding(a)}).acquire({route:a}),
    {code:'V2_RPC_CLIENT_PRIVATE_CREDENTIAL_REQUIRED'});
  let calls=0;
  const c=createV2CoordinatorRpcClient({endpoint:f.endpoint,
    tokenProvider:async()=>randomBytes(32).toString('base64url'),
    observedCaller:async()=>binding(a),fetchImpl:async()=>{calls++;throw Error('lost response');}});
  await assert.rejects(c.acquire({route:a}),{code:'V2_RPC_CLIENT_DELIVERY_UNCERTAIN'});
  assert.equal(calls,1,'unknown delivery must not be automatically retried');
 }finally{await f.close();}
});

test('actual durable WorkflowStore commits its receipt through the authenticated RPC adapter',async()=>{
 const f=await fixture();
 const root=path.join(f.directory,'project');fs.mkdirSync(root,{mode:0o700});
 const store=new WorkflowStore({
  directory:path.join(f.directory,'store'),rootLeaseDirectory:path.join(f.directory,'root-leases'),
  allowedRoots:[f.directory],device:'win-host',configSha256:'1'.repeat(64),
  authority:{profileId:'profile',tier:'FULL_POWER',capabilities:[
   'filesystem.full','workflow.durable','workflow.scheduler']},
  schedulerPolicy:{enabled:true,resumeInterrupted:true,resumeAfterRestart:true,
   resumeAfterUpdate:true,oneWriterPerRoot:true,maxConcurrentProjects:1,
   leaseMs:5000,intervalMs:1000,retryBudget:3}
 });
 const grants=new V2GrantRegistry({
  directory:path.join(f.directory,'permissions'),authorizeAdministration:({actor})=>actor==='admin'
 });
 let effects=0;
 try{
  store.create({id:'shared-project',root,goal:'RPC integration acceptance',
   acceptance:['one recorded receipt'],steps:[{id:'write',title:'single bounded write'}]});
  grants.change({route:a,tool:'write_text',status:'ENABLED',expectedRevision:0,
   actor:'admin',reason:'fixture caller grant'});
  const output=await executeV2CoordinatedWorkflowStep({
   coordinator:f.client(0),route:a,ttlMs:3000,
   stepId:'write',expectedRevision:1,tool:'write_text',
   arguments:{path:path.join(root,'synthetic.txt'),content:'QA'},
   workflowStore:store,grantRegistry:grants,
   observedCaller:async()=>binding(a),authorizeTool:async()=>true,
   commitWithFence:async({resource,fence,leaseId,assertCurrent})=>{
    assert.equal(resource,'["global-v1","workflow-root","one-trusted-project"]');
    assert.equal(fence,1);assert.ok(leaseId.length>20);
    await assertCurrent();
    effects++;
    return {ok:true};
   }
  });
  assert.equal(output.outcome,'RECORDED_NOT_VALIDATED');
  assert.equal(store.get('shared-project').state.steps[0].status,'recorded');
  assert.equal(store.schedulerStatus().currentLeases,0);
  assert.equal(effects,1);
  assert.equal(fs.existsSync(path.join(root,'synthetic.txt')),false,
    'no pretend protected physical effect');
 }finally{grants.close();store.close();await f.close();}
});
