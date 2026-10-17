import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createWorkflowTools} from '../src/workflow-tools.mjs';
import {createLocalManagementGateway,encodeManagementRequest} from '../src/local-management-contract.mjs';
import {localManagementReason,inspectLocalManagementEvent} from '../src/local-management-reconcile.mjs';

const target=Object.freeze({deviceId:'fixture',profileId:'default',configSha256:'1'.repeat(64),routeGeneration:3});
function makeTools(root){
 let calls=0;
 const tools=createWorkflowTools({
  config:{durableWorkflows:{enabled:true,directory:path.join(root,'state'),scheduler:{enabled:false}},
    capabilityProfile:{id:'default'},instance:{profile:'default'}},
  roots:[root],device:'fixture',configSha256:target.configSha256,lookup:()=>null,
  validateSchema:()=>[],dispatch:async()=>{calls++;assert.fail('No project effect allowed');},
 });
 return {tools,effects:()=>calls};
}
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rcm-reconcile-'));
 const f=makeTools(root);
 t.after(async()=>{await f.tools.close();fs.rmSync(root,{recursive:true,force:true});});
 await f.tools.execute('workflow_create',{id:'sample',root,goal:'PRIVATE_DO_NOT_EXPOSE',
   acceptance:['Just store a control intent'],steps:[{id:'never',title:'Never dispatched'}]});
 return {root,...f};
}
const inspect=(workflowTools,overrides={})=>inspectLocalManagementEvent({
 target,readIdentity:()=>target,workflowTools,
 workflowId:'sample',requestId:'native-control-1',
 action:'workflow.pause',expectedRevision:1,...overrides,
});
async function apply(f,requestId='native-control-1') {
 const key=randomBytes(32);
 const gateway=createLocalManagementGateway({
  target,key,dispatch:(name,args)=>f.tools.execute(name,args),
  readBack:id=>f.tools.execute('workflow_get',{id}),
 });
 try{
  const now=Date.now();
  const payload={schema:1,sessionId:gateway.session().sessionId,target,
   requestId,action:'workflow.pause',workflowId:'sample',expectedRevision:1,
   issuedAtEpochMs:now,expiresAtEpochMs:now+8000};
  return await gateway.handle(encodeManagementRequest(payload,key));
 } finally {gateway.close();key.fill(0);}
}

test('recorded Core event binds exact native request marker; historic read is non-mutating',async t=>{
 const f=await fixture(t);
 const status=await apply(f);
 assert.equal(status.state,'APPLIED');
 const first=await inspect(f.tools);
 assert.equal(first.state,'JOURNALED_APPLIED');
 assert.equal(first.evidenceKind,'CORE_VERIFIED_EVENT_CHAIN_ONLY');
 assert.equal(first.evidence.eventRevision,2);
 assert.match(first.evidence.eventSha256,/^[a-f0-9]{64}$/);
 assert.equal(first.evidence.workerTerminationVerified,false);
 assert.equal(first.mutated,false);
 assert.equal(first.replayed,false);
 assert.ok(!JSON.stringify(first).includes('PRIVATE_DO_NOT_EXPOSE'));
 assert.equal((await f.tools.execute('workflow_get',{id:'sample'})).state.revision,2);
 assert.equal(f.effects(),0);
});

test('read-only verification works after closing and reopening the same SQLite Core store',async t=>{
 const f=await fixture(t);
 await apply(f);
 await f.tools.close();
 const reopened=makeTools(f.root);
 t.after(async()=>reopened.tools.close());
 const status=await inspect(reopened.tools);
 assert.equal(status.state,'JOURNALED_APPLIED');
 assert.equal(status.evidence.currentRevision,2);
 assert.equal(reopened.effects(),0);
});

test('missing marker means UNRESOLVED, even if current control intent happens to match',async t=>{
 const f=await fixture(t);
 await f.tools.execute('workflow_control',{id:'sample',expectedRevision:1,action:'pause',reason:'Unrelated explicit owner control'});
 const status=await inspect(f.tools);
 assert.equal(status.state,'UNRESOLVED');
 assert.equal(status.code,'MANAGEMENT_NO_EXACT_CONTROL_EVENT');
 assert.equal(status.evidence,null);
 assert.equal(f.effects(),0);
});

test('historical control proof survives later revisions without claiming current pause',async t=>{
 const f=await fixture(t);
 await apply(f);
 await f.tools.execute('workflow_control',{id:'sample',expectedRevision:2,action:'cancel',reason:'Later separate owner decision'});
 const status=await inspect(f.tools);
 assert.equal(status.state,'JOURNALED_APPLIED');
 assert.equal(status.evidence.eventRevision,2);
 assert.equal(status.evidence.currentRevision,3);
 assert.equal(status.evidence.workerTerminationVerified,false);
});

test('wrong action or revision for a matching request identifier is CONFLICT, never APPLIED',async t=>{
 const f=await fixture(t);
 await apply(f);
 assert.equal((await inspect(f.tools,{action:'workflow.cancel'})).state,'CONFLICT');
 assert.equal((await inspect(f.tools,{expectedRevision:2})).state,'CONFLICT');
 assert.equal(f.effects(),0);
});

test('duplicate persisted request markers are a conflict and must not be retried',async t=>{
 const f=await fixture(t);
 await apply(f);
 await f.tools.execute('workflow_control',{id:'sample',expectedRevision:2,action:'pause',
   reason:localManagementReason('native-control-1')});
 const status=await inspect(f.tools);
 assert.equal(status.state,'CONFLICT');
 assert.equal(status.code,'MANAGEMENT_REQUEST_MARKER_DUPLICATED');
});

test('mismatching generation or config blocks reads of another native target',async t=>{
 const f=await fixture(t);
 await apply(f);
 let reads=0;
 const wrapped={definitions:f.tools.definitions,execute:(name,args)=>{reads++;return f.tools.execute(name,args);}};
 for(const changed of [{...target,routeGeneration:9},{...target,configSha256:'2'.repeat(64)}]){
  const res=await inspect(wrapped,{readIdentity:()=>changed});
  assert.equal(res.state,'UNVERIFIED');
  assert.equal(res.code,'MANAGEMENT_TARGET_CHANGED');
 }
 assert.equal(reads,0);
});

test('untrusted or modified event-chain bytes are never promoted to successful reconciliation',async t=>{
 const f=await fixture(t);
 await apply(f);
 const original=await f.tools.execute('workflow_export',{id:'sample'});
 let calls=0;
 const fake={definitions:f.tools.definitions,execute:async()=>{calls++;return {bundle:{...original.bundle,
    events:original.bundle.events.map((x,i)=>i===1?{...x,body:x.body+'x'}:x)}};}};
 const status=await inspect(fake);
 assert.equal(status.state,'UNVERIFIED');
 assert.equal(status.code,'MANAGEMENT_JOURNAL_INVALID');
 assert.equal(calls,1);
});

test('read timeout is UNVERIFIED, never a license to replay an uncertain command',async t=>{
 const f=await fixture(t);
 let calls=0;
 const hanging={definitions:f.tools.definitions,execute:()=>{calls++;return new Promise(()=>{});}};
 const status=await inspect(hanging,{timeoutMs:20});
 assert.equal(status.state,'UNVERIFIED');
 assert.equal(status.code,'MANAGEMENT_JOURNAL_UNAVAILABLE');
 assert.equal(status.replayed,false);
 assert.equal(calls,1);
});

test('input requires an explicit scoped resident Core reader with no command dispatch',async t=>{
 const f=await fixture(t);
 await assert.rejects(inspectLocalManagementEvent({target,readIdentity:()=>target,workflowTools:{
  definitions:[{name:'workflow_control'}],execute:()=>assert.fail('must not execute')},
  workflowId:'sample',requestId:'req-1',action:'workflow.pause',expectedRevision:1
 }),/MANAGEMENT_RECOVERY_ADAPTER_REQUIRED/);
 assert.throws(()=>localManagementReason('bad\nrequest'),/MANAGEMENT_REQUEST_ID/);
 assert.equal(f.effects(),0);
});
