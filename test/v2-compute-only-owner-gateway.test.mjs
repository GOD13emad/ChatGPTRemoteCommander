import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createV2ComputeOnlyOwnerGateway} from '../src/v2-compute-only-owner-gateway.mjs';
import {createV2ComputeOnlyWorker} from '../src/v2-compute-only-worker.mjs';

const sha=s=>createHash('sha256').update(s).digest('hex');
const route={hostId:'HPC-159-17',principalId:'native-owner',profileId:'default',
 conversationId:'trusted-owner-session',operationId:'prime10000',
 target:{kind:'workflow-root',id:'hpc-compute'}};
const request={operationId:'prime10000',job:{schema:1,kind:'prime-statistics',limit:10000}};
function setup({authorized=true,resolve=async()=>route,worker}={}){
 let authCalls=0,dispatchCalls=0;
 const actualWorker=worker||{execute:async input=>{dispatchCalls++;
  return {status:'COMMITTED',receiptId:'compute-'+sha(JSON.stringify([
    input.route.hostId,input.route.principalId,input.route.profileId,
    input.route.conversationId,input.route.operationId])).slice(0,48),
   result:{schema:1,operationId:'prime10000',kind:'prime-statistics',
    limit:10000,count:1229,sum:5736396}}}};
 const workerProxy={execute:async x=>{if(worker)dispatchCalls++;const output=await actualWorker.execute(x);
  if(output?.result&&!output.digest)output.digest=sha(JSON.stringify(output.result));
  return output;}};
 const gateway=createV2ComputeOnlyOwnerGateway({
  worker:workerProxy,resolveAttestedRoute:resolve,
  authorizeNativeCompute:async()=>{authCalls++;return authorized;}
 });
 return {gateway,dispatchCalls:()=>dispatchCalls,authCalls:()=>authCalls};
}
test('native owner gate permits only exact attested workflow-root prime task',async()=>{
 const f=setup();
 const r=await f.gateway.execute(request);
 assert.equal(r.status,'COMMITTED');
 assert.equal(r.result.count,1229);
 assert.equal(r.result.sum,5736396);
 assert.equal(f.dispatchCalls(),1);
 assert.equal(f.authCalls(),1);
 assert.equal(Object.isFrozen(r),true);
});
test('missing trusted native resolver, authorization, or worker fails at bootstrap',()=>{
 for(const config of [
  {},{worker:{execute:async()=>{}}},{resolveAttestedRoute:async()=>route},
  {authorizeNativeCompute:async()=>true}
 ])assert.throws(()=>createV2ComputeOnlyOwnerGateway(config),
  {code:'V2_COMPUTE_ADMISSION_TRUSTED_BOOTSTRAP_REQUIRED'});
});
test('caller cannot smuggle principal, host, GUI, browser, shell or path',async()=>{
 const f=setup();
 const bad=[
  {...request,route},
  {...request,principalId:'attacker'},
  {...request,hostId:'attacker'},
  {...request,command:'whoami'},
  {...request,job:{...request.job,gui:'click'}},
  {...request,job:{...request.job,browser:'open'}},
  {...request,job:{...request.job,shell:'run'}},
  {...request,job:{...request.job,path:'/tmp/write'}},
  {...request,job:{...request.job,limit:50001}},
  {operationId:'../../foreign',job:request.job},
  {operationId:'other',job:request.job}
 ];
 for(const item of bad)await assert.rejects(f.gateway.execute(item),
  error=>error.code?.startsWith('V2_COMPUTE_ADMISSION_'));
 assert.equal(f.dispatchCalls(),0);
});
test('a denied native owner action never reaches the compute effect',async()=>{
 const f=setup({authorized:false});
 await assert.rejects(f.gateway.execute(request),
  {code:'V2_COMPUTE_ADMISSION_OWNER_DENIED'});
 assert.equal(f.dispatchCalls(),0);
 assert.equal(f.authCalls(),1);
});
test('native route changes during owner authorization fail closed',async()=>{
 let count=0;
 const f=setup({resolve:async()=>{count++;return count===1?route:{
  ...route,conversationId:'changed-session'};}});
 await assert.rejects(f.gateway.execute(request),
  {code:'V2_COMPUTE_ADMISSION_BINDING_CHANGED'});
 assert.equal(f.dispatchCalls(),0);
});
test('worker response must match bound route, digest, immutable receipt and count shape',async()=>{
 const validResult={schema:1,operationId:route.operationId,
  kind:'prime-statistics',limit:10000,count:1229,sum:5736396};
 const receiptId='compute-'+sha(JSON.stringify([
  route.hostId,route.principalId,route.profileId,
  route.conversationId,route.operationId])).slice(0,48);
 for(const invalid of [
  {status:'SUCCEEDED',receiptId,result:validResult},
  {status:'COMMITTED',receiptId:'not-ours',result:validResult},
  {status:'COMMITTED',receiptId,result:{...validResult,count:-2}},
  {status:'COMMITTED',receiptId,result:{...validResult,operationId:'other'}},
  {status:'COMMITTED',receiptId,result:{...validResult,arbitrary:'extra'}},
  {status:'COMMITTED',receiptId,digest:'0'.repeat(64),result:validResult}
 ]){
  let calls=0;
  const gateway=createV2ComputeOnlyOwnerGateway({
   worker:{execute:async()=>{calls++;return invalid;}},
   resolveAttestedRoute:async()=>route,authorizeNativeCompute:async()=>true
  });
  await assert.rejects(gateway.execute(request),
   {code:'V2_COMPUTE_ADMISSION_RESULT_INVALID'});
  assert.equal(calls,1);
 }
});
test('real bounded worker under native gate performs only computed artifact effect',async()=>{
 const receipts=new Map();
 let writes=0;
 const coordinator={
  withFencedLease:async({run})=>run({
   lease:{id:'11111111-1111-1111-1111-111111111111',fence:1,resource:'qa'},
   assertCurrent:async()=>true
  }),
  observePrivateArtifact:async({receiptId})=>receipts.has(receiptId)?
    {committed:true,digest:receipts.get(receiptId)}:{committed:false},
  createPrivateArtifact:async({receiptId,content})=>{
   writes++;const digest=sha(content);receipts.set(receiptId,digest);
   return {receiptId,committed:true,digest,replayed:false};
  }
 };
 const worker=createV2ComputeOnlyWorker({coordinator});
 const gateway=createV2ComputeOnlyOwnerGateway({worker,
  resolveAttestedRoute:async()=>route,authorizeNativeCompute:async()=>true});
 const initial=await gateway.execute(request);
 assert.equal(initial.status,'COMMITTED');
 assert.equal(initial.result.count,1229);
 assert.equal(initial.result.sum,5736396);
 assert.equal(writes,1);
 assert.equal(receipts.get(initial.receiptId),initial.digest);
 const replay=await gateway.execute(request);
 assert.equal(replay.status,'RECONCILED');
 assert.equal(writes,1);
});
