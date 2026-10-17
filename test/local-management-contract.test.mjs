import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createLocalManagementGateway, encodeManagementRequest } from '../src/local-management-contract.mjs';
import { WorkflowStore } from '../src/workflow-store.mjs';

const target = {deviceId:'fixture',profileId:'default',configSha256:'1'.repeat(64),routeGeneration:7};
function setup(t, overrides={}) {
  const key=randomBytes(32), calls=[];
  const gateway=createLocalManagementGateway({target,key,now:()=>100000,
    dispatch:async (name,args)=>{calls.push({name,args});},
    readBack:async id=>({state:{id,revision:2,control:{intent:'PAUSED'},secret:'NEVER_EXPOSE'}}),...overrides});
  t.after(()=>gateway.close());
  const request={schema:1,sessionId:gateway.session().sessionId,target,requestId:'native-click-1',
    action:'workflow.pause',workflowId:'sample',expectedRevision:1,issuedAtEpochMs:99990,expiresAtEpochMs:110000};
  const wire=(delta={},k=key)=>encodeManagementRequest({...request,...delta},k);
  return {gateway,request,key,wire,calls};
}

test('valid MAC invokes only workflow_control and returns a bounded verified receipt',async t=>{
  const f=setup(t);const r=await f.gateway.handle(f.wire());
  assert.equal(r.state,'APPLIED');assert.equal(r.newRevision,2);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].name,'workflow_control');assert.equal(f.calls[0].args.action,'pause');
  assert.equal(JSON.stringify(r).includes('NEVER_EXPOSE'),false);
});

test('wrong key fails before dispatch',async t=>{
  const f=setup(t);await assert.rejects(f.gateway.handle(f.wire({},randomBytes(32))),/MANAGEMENT_AUTH_FAILED/);assert.equal(f.calls.length,0);
});
for(const field of ['deviceId','profileId','configSha256','routeGeneration'])test(`target ${field} drift is refused`,async t=>{
  const f=setup(t);const changed={...target,[field]:field==='routeGeneration'?8:field==='configSha256'?'2'.repeat(64):'other'};
  await assert.rejects(f.gateway.handle(f.wire({target:changed})),/MANAGEMENT_TARGET_CHANGED/);assert.equal(f.calls.length,0);
});
for(const action of ['shell.execute','workflow.resume','delivery.ack','gui.type','__proto__'])test(`unexposed action ${action} denied`,t=>{
  const f=setup(t);assert.throws(()=>f.wire({action}),/MANAGEMENT_ACTION_DENIED/);assert.equal(f.calls.length,0);
});
for(const value of [true,0,-1,'1',1.5,null,10001])test(`invalid revision ${JSON.stringify(value)} rejected before effect`,t=>{
  const f=setup(t);assert.throws(()=>f.wire({expectedRevision:value}),/MANAGEMENT_SCHEMA/);assert.equal(f.calls.length,0);
});
for(const delta of [{issuedAtEpochMs:100001,expiresAtEpochMs:100000},{issuedAtEpochMs:1,expiresAtEpochMs:999999},{issuedAtEpochMs:true,expiresAtEpochMs:100010}])test('invalid lifetime/schema refused',t=>{
  const f=setup(t);assert.throws(()=>f.wire(delta));assert.equal(f.calls.length,0);
});
test('expired and future-issued requests cannot execute',async t=>{
  const f=setup(t);
  for(const d of [{issuedAtEpochMs:90000,expiresAtEpochMs:100000},{issuedAtEpochMs:105000,expiresAtEpochMs:110000}])
    await assert.rejects(f.gateway.handle(f.wire(d)),/MANAGEMENT_EXPIRED_OR_FUTURE/);
  assert.equal(f.calls.length,0);
});
test('new session rejects previous-session envelope even with same test key',async t=>{
  const f=setup(t);await assert.rejects(f.gateway.handle(f.wire({sessionId:'0'.repeat(64)})),/MANAGEMENT_SESSION_CHANGED/);
});
test('canonical wire rejects duplicate keys, whitespace aliases and unknown input',async t=>{
  const f=setup(t);const w=f.wire();
  for(const altered of [' '+w,w.replace('"schema":1','"schema":1,"schema":1'),w.replace('"schema":1','"unknown":0,"schema":1')])
    await assert.rejects(f.gateway.handle(altered));
  assert.equal(f.calls.length,0);
});
test('malformed, oversized and array envelopes have no effect',async t=>{
  const f=setup(t);for(const w of ['[1]','{','x'.repeat(8193),'null'])await assert.rejects(f.gateway.handle(w));assert.equal(f.calls.length,0);
});
test('ten concurrent identical clicks dispatch once and do not share mutable receipt objects',async t=>{
  const f=setup(t);const all=await Promise.all(Array.from({length:10},()=>f.gateway.handle(f.wire())));
  assert.equal(f.calls.length,1);assert.ok(all.every(r=>r.state==='APPLIED'));all[0].target.profileId='changed';assert.equal(all[1].target.profileId,'default');
});
test('same request ID with changed effect conflicts rather than dispatching twice',async t=>{
  const f=setup(t);await f.gateway.handle(f.wire());await assert.rejects(f.gateway.handle(f.wire({action:'workflow.cancel'})),/MANAGEMENT_REQUEST_ID_CONFLICT/);assert.equal(f.calls.length,1);
});
test('bounded request budget has no silent eviction and close prevents new requests',async t=>{
  const f=setup(t,{maxRequests:1});await f.gateway.handle(f.wire());
  await assert.rejects(f.gateway.handle(f.wire({requestId:'second'})),/MANAGEMENT_REQUEST_BUDGET/);
  f.gateway.close();await assert.rejects(f.gateway.handle(f.wire()),/MANAGEMENT_CLOSED/);
});
test('unknown dispatch failure is uncertain, private text is redacted, duplicate never retries',async t=>{
  let calls=0;const f=setup(t,{dispatch:async()=>{calls++;throw new Error('PRIVATE_PATH_AND_SECRET');}});
  const r=await f.gateway.handle(f.wire());assert.equal(r.state,'UNCERTAIN');assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
  await f.gateway.handle(f.wire());assert.equal(calls,1);
});
test('successful dispatch is not APPLIED without matching independent readback',async t=>{
  const f=setup(t,{readBack:async()=>({state:{id:'wrong',revision:2,control:{intent:'PAUSED'}}})});
  const r=await f.gateway.handle(f.wire());assert.equal(r.state,'UNCERTAIN');assert.equal(r.code,'MANAGEMENT_READBACK_UNVERIFIED');
});

for(const action of ['pause','cancel'])test(`resident real SQLite WorkflowStore ${action}, stale revision and restart persistence`,async t=>{
  const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-management-contract-')));
  const opts={directory:path.join(root,'state'),allowedRoots:[root],device:'fixture',configSha256:'1'.repeat(64)};
  const store=new WorkflowStore(opts);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  store.create({id:'sample',root,goal:'Bounded native action',acceptance:['Recorded control only'],steps:[{id:'one',title:'Never execute this step'}]});
  let calls=0;const f=setup(t,{dispatch:async(name,args)=>{calls++;assert.equal(name,'workflow_control');return store.control(args);},readBack:async id=>store.get(id)});
  const wire=f.wire({action:'workflow.'+action});const result=await f.gateway.handle(wire);
  assert.equal(result.state,'APPLIED');assert.equal(result.controlIntent,action==='pause'?'PAUSED':'CANCELLED');
  assert.equal(store.get('sample').state.steps[0].status,'pending');assert.equal(store.schedulerStatus().currentLeases,0);
  assert.equal((await f.gateway.handle(wire)).state,'APPLIED');assert.equal(calls,1);
  const stale=await f.gateway.handle(f.wire({requestId:'stale',action:'workflow.'+action}));
  assert.equal(stale.state,'REJECTED');assert.equal(stale.code,'WORKFLOW_REVISION_CONFLICT');
  const reopened=new WorkflowStore(opts);try{assert.equal(reopened.get('sample').state.control.intent,result.controlIntent);}finally{reopened.close();}
});

for(const action of [['workflow.pause'], {toString:()=> 'workflow.pause'}, null, true])test('non-string action cannot coerce to an allowed operation',t=>{
  const f=setup(t);assert.throws(()=>f.wire({action}),/MANAGEMENT_ACTION_DENIED/);assert.equal(f.calls.length,0);
});
test('revocation after reservation but before dispatch prevents the effect',async t=>{
  const f=setup(t);const pending=f.gateway.handle(f.wire());f.gateway.close();
  assert.equal((await pending).code,'MANAGEMENT_SESSION_REVOKED');assert.equal(f.calls.length,0);
});
test('expiry after reservation but before dispatch prevents the effect',async t=>{
  let clock=100000;const f=setup(t,{now:()=>clock});const pending=f.gateway.handle(f.wire());clock=120000;
  assert.equal((await pending).code,'MANAGEMENT_EXPIRED_BEFORE_EFFECT');assert.equal(f.calls.length,0);
});
test('deadline marks uncertain without cancelling or retrying a late effect',async t=>{
  let calls=0,finish;const f=setup(t,{operationTimeoutMs:10,dispatch:()=>{calls++;return new Promise(r=>{finish=r;});}});
  const r=await f.gateway.handle(f.wire());assert.equal(r.state,'UNCERTAIN');finish();
  assert.deepEqual(await f.gateway.handle(f.wire()),r);assert.equal(calls,1);
});
test('readback timeout does not fabricate success',async t=>{
  let finish;const f=setup(t,{operationTimeoutMs:10,readBack:()=>new Promise(r=>{finish=r;})});
  const r=await f.gateway.handle(f.wire());assert.equal(r.code,'MANAGEMENT_READBACK_UNVERIFIED');finish();
});

test('revocation in the dispatch microtask boundary prevents the effect',async t=>{
  const f=setup(t);const pending=f.gateway.handle(f.wire());queueMicrotask(()=>f.gateway.close());
  const r=await pending;assert.equal(r.state,'REJECTED');assert.equal(r.code,'MANAGEMENT_SESSION_REVOKED');assert.equal(f.calls.length,0);
});
test('expiry in the dispatch microtask boundary prevents the effect',async t=>{
  let clock=100000;const f=setup(t,{now:()=>clock});const pending=f.gateway.handle(f.wire());queueMicrotask(()=>{clock=120000;});
  const r=await pending;assert.equal(r.state,'REJECTED');assert.equal(r.code,'MANAGEMENT_EXPIRED_BEFORE_EFFECT');assert.equal(f.calls.length,0);
});

// Rotation is a new native-bootstrap requirement, not a new global authority.
test('current identity is rechecked immediately before dispatch', async t => {
  let current=true;const f=setup(t,{isCurrent:()=>current});
  const promise=f.gateway.handle(f.wire());queueMicrotask(()=>{current=false;});
  const result=await promise;assert.equal(result.state,'REJECTED');
  assert.equal(result.code,'MANAGEMENT_TARGET_CHANGED');assert.equal(f.calls.length,0);
});
for (const value of [false, undefined, Promise.resolve(true)]) test('non-true synchronous identity proof cannot admit a command', async t => {
  const f=setup(t,{isCurrent:()=>value});const result=await f.gateway.handle(f.wire());
  assert.equal(result.state,'REJECTED');assert.equal(f.calls.length,0);
});
test('identity callback failure is redacted and cannot execute',async t=>{
  const f=setup(t,{isCurrent:()=>{throw new Error('PRIVATE_IDENTITY_DETAILS');}});
  const result=await f.gateway.handle(f.wire());assert.equal(result.state,'REJECTED');
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.equal(f.calls.length,0);
});
test('identity rotation after the effect cannot return APPLIED from old-instance readback',async t=>{
  let current=true;const f=setup(t,{isCurrent:()=>current,dispatch:async()=>{current=false;}});
  const result=await f.gateway.handle(f.wire());assert.equal(result.state,'UNCERTAIN');
  assert.equal(result.code,'MANAGEMENT_READBACK_UNVERIFIED');
});
