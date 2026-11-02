// Portable Windows/Linux smoke for the exact compute-only source module.
// The coordinator below is a test double; this does not establish owner auth,
// live network admission or production end-to-end dispatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createV2ComputeOnlyWorker} from '../src/v2-compute-only-worker.mjs';

const sha=s=>createHash('sha256').update(s).digest('hex');
const route={hostId:'hpc-qa',principalId:'qa-owner',profileId:'qa-default',
 conversationId:'qa-chat',operationId:'prime-10000',
 target:{kind:'workflow-root',id:'qa-compute'}};
const job={schema:1,kind:'prime-statistics',limit:10000};
function fixture({revoked=false,lostAck=false}={}){
 const artifacts=new Map();
 let writes=0;
 const deny=code=>{throw Object.assign(new Error(code),{code});};
 const coordinator={
  withFencedLease:async({route:r,run})=>{
   if(revoked)deny('V2_COORDINATOR_AUTH_REQUIRED');
   if(r.hostId!==route.hostId||r.conversationId!==route.conversationId)
    deny('V2_ROUTE_CALLER_MISMATCH');
   const assertCurrent=async()=>{if(revoked)deny('V2_COORDINATOR_AUTH_REQUIRED');return true;};
   return run({lease:Object.freeze({id:'11111111-1111-1111-1111-111111111111',
    fence:1,resource:'fixture'}),assertCurrent});
  },
  observePrivateArtifact:async({receiptId})=>{
   const item=artifacts.get(receiptId);
   return item?{committed:true,receiptId,digest:item.digest,fence:1}:{committed:false};
  },
  createPrivateArtifact:async({receiptId,content})=>{
   writes++;
   const digest=sha(content);
   if(artifacts.has(receiptId))deny('V2_ARTIFACT_RECEIPT_CONFLICT');
   artifacts.set(receiptId,{digest,content});
   if(lostAck)deny('V2_RPC_CLIENT_DELIVERY_UNCERTAIN');
   return {committed:true,receiptId,digest,fence:1,replayed:false};
  }
 };
 return {coordinator,artifacts,writes:()=>writes};
}

test('native bounded compute yields verified 10,000-prime statistics',async()=>{
 const f=fixture(),w=createV2ComputeOnlyWorker({coordinator:f.coordinator});
 const r=await w.execute({route,job});
 assert.equal(r.status,'COMMITTED');
 assert.equal(r.result.count,1229);
 assert.equal(r.result.sum,5736396);
 assert.equal(r.digest,sha(JSON.stringify(r.result)));
 assert.equal(f.artifacts.get(r.receiptId).digest,r.digest);
 const repeated=await w.execute({route,job});
 assert.equal(repeated.status,'RECONCILED');
 assert.equal(f.writes(),1);
 await assert.rejects(w.execute({route,job:{...job,limit:9000}}),
  {code:'V2_COMPUTE_RECEIPT_CONFLICT'});
 assert.equal(f.writes(),1);
});
test('native compute-only rejects unrelated capabilities and foreign callers',async()=>{
 const f=fixture(),w=createV2ComputeOnlyWorker({coordinator:f.coordinator});
 for(const bad of [{...job,kind:'run_shell'}, {...job,command:'dir'},
  {...job,browser:'visit'}, {...job,gui:'click'}, {...job,limit:50001}]){
  await assert.rejects(w.execute({route,job:bad}),{code:'V2_COMPUTE_JOB_NOT_ALLOWLISTED'});
 }
 await assert.rejects(w.execute({route:{...route,target:{kind:'desktop-seat',id:'gui'}},job}),
  {code:'V2_COMPUTE_WORKFLOW_ROOT_REQUIRED'});
 await assert.rejects(w.execute({route:{...route,conversationId:'other'},job}),
  {code:'V2_ROUTE_CALLER_MISMATCH'});
 assert.equal(f.writes(),0);
});
test('native lost acknowledgment reconciles without mutation retry',async()=>{
 const f=fixture({lostAck:true});
 const r=await createV2ComputeOnlyWorker({coordinator:f.coordinator}).execute({route,job});
 assert.equal(r.status,'RECONCILED');assert.equal(f.writes(),1);
 assert.equal(f.artifacts.get(r.receiptId).digest,r.digest);
});
test('native revoked route fails before any effect',async()=>{
 const f=fixture({revoked:true});
 await assert.rejects(createV2ComputeOnlyWorker({coordinator:f.coordinator}).execute({route,job}),
  {code:'V2_COORDINATOR_AUTH_REQUIRED'});
 assert.equal(f.writes(),0);
});
