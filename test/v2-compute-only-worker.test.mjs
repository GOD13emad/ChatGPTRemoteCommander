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
import {createV2ComputeOnlyWorker} from '../src/v2-compute-only-worker.mjs';

const route={hostId:'fixture-hpc',principalId:'fixture-owner',
 profileId:'fixture-default',conversationId:'fixture-chat',
 operationId:'primes-10000',target:{kind:'workflow-root',id:'compute-only'}};
const binding=({hostId,principalId,profileId,conversationId})=>({
 hostId,principalId,profileId,conversationId});
const job=limit=>({schema:1,kind:'prime-statistics',limit});
const sha=s=>createHash('sha256').update(s).digest('hex');
async function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'v2-compute-only-'));
 const token=randomBytes(32).toString('base64url');
 let allowed=true;
 const central=new V2CentralCoordinator({directory,
  authorizeLease:async()=>allowed,resolveGlobalResource:async()=> 'fixture-compute-root',
  requireGlobalResource:true});
 const server=createV2CoordinatorRpcServer({
  coordinator:central,artifactActuator:createV2GuardedArtifactActuator({coordinator:central}),
  lookupToken:createV2RpcTokenLookup([{
   tokenSha256:sha(token),binding:binding(route)
  }])
 });
 const {port}=await server.listen();
 const client=createV2CoordinatorRpcClient({endpoint:'http://127.0.0.1:'+port,
  tokenProvider:async()=>token,observedCaller:async()=>binding(route)});
 return {client,deny:()=>allowed=false,async close(){
  await server.close();central.close();
  fs.rmSync(directory,{recursive:true,force:true});
 }};
}

test('real fenced RPC stores one prime computation result and independently observes artifact',async()=>{
 const f=await fixture();
 try{
  const worker=createV2ComputeOnlyWorker({coordinator:f.client});
  const first=await worker.execute({route,job:job(10000)});
  assert.equal(first.status,'COMMITTED');
  assert.deepEqual(first.result,{schema:1,operationId:'primes-10000',
   kind:'prime-statistics',limit:10000,count:1229,sum:5736396});
  assert.equal(first.digest,sha(JSON.stringify(first.result)));
  const observed=await f.client.observePrivateArtifact({
   route,receiptId:first.receiptId});
  assert.equal(observed.committed,true);
  assert.equal(observed.digest,first.digest);
  const again=await worker.execute({route,job:job(10000)});
  assert.equal(again.status,'RECONCILED');
  assert.equal(again.digest,first.digest);
 }finally{await f.close();}
});

test('changed inputs for same operation cannot replace immutable artifact',async()=>{
 const f=await fixture();
 try{
  const worker=createV2ComputeOnlyWorker({coordinator:f.client});
  await worker.execute({route,job:job(10000)});
  await assert.rejects(worker.execute({route,job:job(9000)}),
   {code:'V2_COMPUTE_RECEIPT_CONFLICT'});
 }finally{await f.close();}
});

test('compute-only rejects shell, GUI, browser, extra keys, overflow and untrusted route',async()=>{
 const f=await fixture();
 try{
  const worker=createV2ComputeOnlyWorker({coordinator:f.client});
  for(const invalid of [
   {schema:1,kind:'run_shell',limit:10000},
   {...job(10000),command:'whoami'},
   {...job(10000),browser:'open'},
   {...job(10000),gui:'click'},
   job(50001),job(1),job(10.5),null
  ])await assert.rejects(worker.execute({route,job:invalid}),
   {code:'V2_COMPUTE_JOB_NOT_ALLOWLISTED'});
  await assert.rejects(worker.execute({route:{
   ...route,target:{kind:'desktop-seat',id:'desktop'}
  },job:job(10000)}),{code:'V2_COMPUTE_WORKFLOW_ROOT_REQUIRED'});
  await assert.rejects(worker.execute({route:{
   ...route,conversationId:'untrusted-chat'
  },job:job(10000)}),{code:'V2_ROUTE_CALLER_MISMATCH'});
  assert.equal((await f.client.observePrivateArtifact({
   route,receiptId:'compute-no-effect'})).committed,false);
 }finally{await f.close();}
});

test('revoked server-side route denies pure job before it can publish',async()=>{
 const f=await fixture();
 try{
  f.deny();
  await assert.rejects(createV2ComputeOnlyWorker({
   coordinator:f.client}).execute({route,job:job(10000)}),
   {code:'V2_COORDINATOR_AUTH_REQUIRED'});
 }finally{await f.close();}
});

test('lost acknowledgment reconciles existing artifact, never resends the effect',async()=>{
 const f=await fixture();
 try{
  let calls=0;
  const c={...f.client,createPrivateArtifact:async request=>{
   calls++;
   await f.client.createPrivateArtifact(request);
   throw Object.assign(new Error('lost ACK'),{
    code:'V2_RPC_CLIENT_DELIVERY_UNCERTAIN'});
  }};
  const result=await createV2ComputeOnlyWorker({coordinator:c})
   .execute({route,job:job(10000)});
  assert.equal(result.status,'RECONCILED');
  assert.equal(calls,1);
  assert.equal((await f.client.observePrivateArtifact({
   route,receiptId:result.receiptId})).digest,result.digest);
 }finally{await f.close();}
});
