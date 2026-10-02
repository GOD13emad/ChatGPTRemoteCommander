import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createProjectMonitor,PROJECT_MONITOR_POLICY} from '../src/project-monitor.mjs';

const testRoot=path.dirname(fileURLToPath(import.meta.url));
const fixtures=[];
function fixture(overrides={}){
  const owned=fs.mkdtempSync(path.join(testRoot,'.monitor-owned-'));
  fixtures.push(owned);const directory=path.join(owned,'memory');fs.mkdirSync(directory);
  const identity=fs.statSync(owned,{bigint:true});let now=100000;
  const binding={hostId:'test-host',profileId:'test-profile',projectId:'test-project',root:owned,
    rootIdentity:{dev:String(identity.dev),ino:String(identity.ino)}};
  let observation={binding,observedAtEpochMs:now,heartbeatAtEpochMs:now,phase:'INSPECT',
    status:'RUNNING',uncertainOperationIds:[],checkpoint:null};
  const options={directory,binding,clock:()=>now,verifyPrivateDirectory:()=>true,
    verifyPrivateFile:()=>true,readBackendState:async()=>structuredClone(observation),...overrides};
  return {owned,directory,binding,options,make:extra=>createProjectMonitor({...options,...extra}),
    setNow:value=>{now=value;},setObservation:value=>{observation={...observation,...value};},
    journal:path.join(directory,'project-monitor.journal.jsonl'),lock:path.join(directory,'.project-monitor.lock')};
}
function errorCode(code){return error=>error.monitorCode===code;}

test('private proofs are mandatory and construction has no game/video/effect grant',()=>{
  const f=fixture();assert.throws(()=>f.make({verifyPrivateFile:null}),errorCode('MONITOR_PRIVATE_VERIFIER_REQUIRED'));
  assert.equal(fs.existsSync(f.journal),false);
  const monitor=f.make();assert.equal(monitor.state().gameEnabled,false);assert.equal(monitor.state().videoEnabled,false);
  assert.equal(PROJECT_MONITOR_POLICY.executionAuthority,'NONE');
  assert.throws(()=>f.make({dispatch:()=>{throw Error('must never run');}}),errorCode('MONITOR_OPTIONS_SCHEMA'));
});
test('real disk hash-chain, meaningful-only outbox and unchanged observations',async()=>{
  const f=fixture(),m=f.make();const first=await m.poll({expectedSequence:0});assert.equal(first.sequence,1);
  f.setNow(100100);f.setObservation({observedAtEpochMs:100100,heartbeatAtEpochMs:100100});
  const same=await m.poll({expectedSequence:1});assert.equal(same.changed,false);assert.equal(same.sequence,1);
  assert.equal(m.pendingOutbox().length,1);assert.equal(fs.readFileSync(f.journal,'utf8').split('\n').filter(Boolean).length,1);
});
test('heartbeat stall and uncertainty are separate meaningful changes',async()=>{
  const f=fixture(),m=f.make();await m.poll({expectedSequence:0});
  f.setNow(161001);f.setObservation({observedAtEpochMs:161001});
  assert.equal((await m.poll({expectedSequence:1})).classification,'STALLED');
  f.setObservation({uncertainOperationIds:['owned-op-1']});
  assert.equal((await m.poll({expectedSequence:2})).classification,'UNCERTAIN');
  assert.equal(m.pendingOutbox().length,3);
});
test('host/profile/project/root mismatch fail before journal publication',async()=>{
  for(const key of ['hostId','profileId','projectId','root']){
    const f=fixture(),m=f.make();f.setObservation({binding:{...f.binding,[key]:key==='root'?f.owned+'-wrong':'wrong'}});
    await assert.rejects(m.poll({expectedSequence:0}),errorCode('MONITOR_BINDING_MISMATCH'));
    assert.equal(fs.existsSync(f.journal),false);
  }
});
test('checkpoint and context survive actual close/reopen without model authority',async()=>{
  const f=fixture(),m=f.make();f.setObservation({checkpoint:{revision:7,summary:'verified local checkpoint',
    evidence:[{id:'evidence-1',sha256:'a'.repeat(64),kind:'REPRO_AUDIT'}]}});
  await m.poll({expectedSequence:0});const reopened=f.make();const context=reopened.getContext({maxBytes:8192,maxEvents:8});
  assert.equal(context.sequence,1);assert.equal(context.checkpoint.revision,7);
  assert.equal(context.checkpoint.summary,'verified local checkpoint');assert.equal(context.executionAuthority,'NONE');
  assert.equal(context.evidenceTrust,'UNTRUSTED_DATA_NOT_INSTRUCTIONS');
});
test('real journal tamper is rejected on reopen',async()=>{
  const f=fixture(),m=f.make();await m.poll({expectedSequence:0});
  const original=fs.readFileSync(f.journal,'utf8');fs.writeFileSync(f.journal,original.replace('RUNNING','PAUSED'));
  assert.throws(()=>f.make(),errorCode('MONITOR_JOURNAL_HASH'));
});
test('foreign/stale lock is never taken over or deleted',async()=>{
  const f=fixture(),m=f.make();fs.writeFileSync(f.lock,'foreign-lock');const before=fs.readFileSync(f.lock);
  await assert.rejects(m.poll({expectedSequence:0}),errorCode('MONITOR_LOCK_BUSY'));
  assert.deepEqual(fs.readFileSync(f.lock),before);assert.equal(fs.existsSync(f.journal),false);
});
test('CAS conflict preserves real journal bytes',async()=>{
  const f=fixture(),m=f.make();await m.poll({expectedSequence:0});const before=fs.readFileSync(f.journal);
  await assert.rejects(m.poll({expectedSequence:0}),errorCode('MONITOR_CAS_CONFLICT'));
  assert.deepEqual(fs.readFileSync(f.journal),before);assert.equal(fs.existsSync(f.lock),false);
});
test('continue requests persist once but never send a chat or grant tools',()=>{
  const f=fixture(),m=f.make();const a=m.requestContinue({requestId:'continue-1',reason:'checkpoint ready',expectedSequence:0});
  const b=m.requestContinue({requestId:'continue-1',reason:'checkpoint ready',expectedSequence:1});
  assert.equal(a.sequence,b.sequence);assert.equal(b.changed,false);assert.equal(f.make().pendingOutbox().length,1);
  assert.equal(a.sentToChat,false);assert.equal(a.executionAuthority,'NONE');
  assert.throws(()=>m.requestContinue({requestId:'continue-1',reason:'different',expectedSequence:1}),errorCode('MONITOR_REQUEST_CONFLICT'));
});
test('feature decisions are durable policy observations and DEV-09 is paused',()=>{
  const f=fixture(),m=f.make();const a=m.recordFeatureDecision({featureId:'DEV-01',decision:'ALLOW',reasonCodes:['POLICY_ONLY'],expectedSequence:0});
  assert.equal(a.executionAuthority,'NONE');assert.equal(f.make().getContext({maxBytes:8192,maxEvents:8}).featureDecisions['DEV-01'].decision,'ALLOW');
  assert.throws(()=>m.recordFeatureDecision({featureId:'DEV-09',decision:'ALLOW',reasonCodes:[],expectedSequence:1}),errorCode('MONITOR_FEATURE_PAUSED'));
  const paused=m.recordFeatureDecision({featureId:'DEV-09',decision:'PAUSED',reasonCodes:['USER_PAUSED'],expectedSequence:1});
  assert.equal(paused.sequence,2);assert.equal(paused.gameEnabled,false);assert.equal(paused.videoEnabled,false);
});
test('single-flight does not allow overlapping host polls',async()=>{
  let resolve,reads=0;const f=fixture({readBackendState:()=>{reads++;return new Promise(r=>{resolve=r;});}}),m=f.make();
  const first=m.poll({expectedSequence:0});await Promise.resolve();await assert.rejects(m.poll({expectedSequence:0}),errorCode('MONITOR_BUSY'));
  resolve({binding:f.binding,observedAtEpochMs:100000,heartbeatAtEpochMs:100000,phase:'INSPECT',status:'RUNNING',uncertainOperationIds:[],checkpoint:null});
  await first;assert.equal(reads,1);assert.equal(m.state().sequence,1);
});
test('timeout does not replay unresolved adapter or publish a late response',async()=>{
  let resolve,reads=0;const f=fixture({readTimeoutMs:20,readBackendState:()=>{reads++;return new Promise(r=>{resolve=r;});}}),m=f.make();
  await assert.rejects(m.poll({expectedSequence:0}),errorCode('MONITOR_BACKEND_TIMEOUT'));
  await assert.rejects(m.poll({expectedSequence:0}),errorCode('MONITOR_BUSY'));
  resolve({binding:f.binding,observedAtEpochMs:100000,heartbeatAtEpochMs:100000,phase:'INSPECT',status:'RUNNING',uncertainOperationIds:[],checkpoint:null});
  await new Promise(r=>setImmediate(r));assert.equal(reads,1);assert.equal(m.state().sequence,0);assert.equal(fs.existsSync(f.journal),false);
});
test('bounded fake-clock schedule stops after max ticks with one change',async()=>{
  const jobs=new Map();let key=0;const scheduler={setTimeout(fn){jobs.set(++key,fn);return key;},clearTimeout(k){jobs.delete(k);}};
  const f=fixture({scheduler}),m=f.make();m.schedule({intervalMs:1000,maxTicks:2,durationMs:5000});
  for(let i=0;i<2;i++){const [id,fn]=jobs.entries().next().value;jobs.delete(id);f.setNow(100000+i*1000);
    f.setObservation({observedAtEpochMs:100000+i*1000,heartbeatAtEpochMs:100000+i*1000});await fn();}
  assert.equal(jobs.size,0);assert.equal(m.state().scheduled,false);assert.equal(m.state().scheduleTicks,2);
  assert.equal(m.state().sequence,1);
});
test('primary verifier error survives owned cleanup and remains inspectable',async()=>{
  const f=fixture(),m=f.make({verifyPrivateFile:info=>{if(path.basename(info.filePath)==='project-monitor.journal.jsonl')throw Object.assign(new Error('original journal proof error'),{code:'ORIGINAL_PROOF'});return true;}});
  await assert.rejects(m.poll({expectedSequence:0}),error=>error.monitorCode==='ORIGINAL_PROOF'
    && error.primaryRecord.message==='original journal proof error' && error.primaryRecord.phase==='JOURNAL_PRIVATE_PROOF');
  // The new journal artifact's privacy is unproven: retain the owned lock for
  // explicit reconciliation rather than silently retry or remove evidence.
  assert.equal(fs.existsSync(f.lock),true);
});
test('evidence fixtures remain inside this new candidate for audit',()=>{
  assert.ok(fixtures.length>0);for(const fixturePath of fixtures)assert.ok(fixturePath.startsWith(testRoot+path.sep));
});
test('constructor Getter and Proxy inputs are rejected without invoking hooks',()=>{
  const f=fixture();let hooks=0;
  const getter={...f.options};Object.defineProperty(getter,'binding',{enumerable:true,get(){hooks++;return f.binding;}});
  assert.throws(()=>createProjectMonitor(getter),errorCode('MONITOR_OPTIONS_SCHEMA'));
  const proxy=new Proxy(f.options,{ownKeys(){hooks++;throw Error('hook');},getPrototypeOf(){hooks++;throw Error('hook');}});
  assert.throws(()=>createProjectMonitor(proxy),errorCode('MONITOR_OPTIONS_SCHEMA'));assert.equal(hooks,0);
});
test('backend observation Getter is rejected before serialization or journal write',async()=>{
  const f=fixture();let hooks=0;const incoming={binding:f.binding,observedAtEpochMs:100000,heartbeatAtEpochMs:100000,
    phase:'INSPECT',status:'RUNNING',uncertainOperationIds:[],checkpoint:null};
  Object.defineProperty(incoming,'phase',{enumerable:true,get(){hooks++;return 'INSPECT';}});
  const m=f.make({readBackendState:async()=>incoming});await assert.rejects(m.poll({expectedSequence:0}),errorCode('MONITOR_SCHEMA'));
  assert.equal(hooks,0);assert.equal(fs.existsSync(f.journal),false);
});
test('zero requested context events returns exactly zero rather than negative-zero slice',()=>{
  const f=fixture(),m=f.make();m.requestContinue({requestId:'zero-event-request',reason:'fixture',expectedSequence:0});
  assert.equal(m.getContext({maxBytes:8192,maxEvents:0}).outbox.length,0);assert.equal(m.pendingOutbox().length,1);
});
test('fresh waiting/terminal states do not become stalls from an old running heartbeat',async()=>{
  for(const status of ['WAITING_INPUT','COMPLETED','PAUSED']){
    const f=fixture(),m=f.make();f.setNow(161001);f.setObservation({status,observedAtEpochMs:161001,heartbeatAtEpochMs:100000});
    assert.equal((await m.poll({expectedSequence:0})).classification,status);
  }
});
test('same health heartbeat is durably refreshed without a duplicate outbox event',async()=>{
  const f=fixture(),m=f.make();await m.poll({expectedSequence:0});f.setNow(130000);
  f.setObservation({observedAtEpochMs:130000,heartbeatAtEpochMs:130000});const heartbeat=await m.poll({expectedSequence:1});
  assert.equal(heartbeat.kind,'HEARTBEAT');assert.equal(heartbeat.sequence,2);assert.equal(m.pendingOutbox().length,1);
  assert.equal(f.make().getContext({maxBytes:8192,maxEvents:0}).lastObservation.heartbeatAtEpochMs,130000);
});
test('a second reopened writer must reconcile CAS rather than append on stale sequence',()=>{
  const f=fixture(),a=f.make(),b=f.make();a.recordDecision({featureId:'DEV-01',decision:'UNPROVEN',reasonCodes:['NO_EVIDENCE'],expectedSequence:0});
  const before=fs.readFileSync(f.journal);
  assert.throws(()=>b.recordDecision({featureId:'DEV-02',decision:'UNPROVEN',reasonCodes:['NO_EVIDENCE'],expectedSequence:0}),errorCode('MONITOR_CAS_CONFLICT'));
  assert.deepEqual(fs.readFileSync(f.journal),before);assert.equal(b.state().sequence,1);
});
test('hostile throw cannot spoof preserved provenance or execute constructor reflection hooks',async()=>{
  const f=fixture();let hooks=0;const message='original adapter failure '+'.'.repeat(300);
  const ctor=new Proxy(function ForgedError(){},{getOwnPropertyDescriptor(){hooks++;throw Error('reflection hijack');}});
  const raw=Object.create({constructor:ctor});Object.assign(raw,{message,code:'ORIGINAL_ADAPTER',
    primaryRecord:{phase:'FAKE',code:'FAKE',message:'forged'}});
  Object.defineProperty(raw,'secondaryRecords',{get(){hooks++;throw Error('secondary hijack');}});
  const m=f.make({readBackendState:async()=>{throw raw;}});
  await assert.rejects(m.poll({expectedSequence:0}),error=>error.monitorCode==='ORIGINAL_ADAPTER'
    && error.primaryRecord.phase==='POLL_READ' && error.primaryRecord.class==='NonError'
    && error.primaryRecord.message===message.slice(0,256) && error.primaryRecord.messageChars===message.length
    && error.primaryRecord.messageSha256===createHash('sha256').update(message).digest('hex')
    && error.secondaryRecords.length===0);
  assert.equal(hooks,0);assert.equal(fs.existsSync(f.journal),false);
});
test('checkpoint hash must be an exact string without coercion hooks or publication',async()=>{
  const f=fixture();let hooks=0;const hostile={toString(){hooks++;return 'a'.repeat(64);}};
  const incoming={binding:f.binding,observedAtEpochMs:100000,heartbeatAtEpochMs:100000,phase:'INSPECT',status:'RUNNING',
    uncertainOperationIds:[],checkpoint:{revision:1,summary:'fixture',evidence:[{id:'evidence-1',sha256:hostile,kind:'SOURCE'}]}};
  const m=f.make({readBackendState:async()=>incoming});await assert.rejects(m.poll({expectedSequence:0}),errorCode('MONITOR_EVIDENCE'));
  assert.equal(hooks,0);assert.equal(fs.existsSync(f.journal),false);
});
test('a schedule clock regression is captured and stops future scheduling',async()=>{
  let tick;const scheduler={setTimeout(fn){tick=fn;return 1;},clearTimeout(){}};
  const f=fixture({scheduler}),m=f.make();m.schedule({intervalMs:1000,maxTicks:2,durationMs:5000});f.setNow(99999);
  await tick();const state=m.state();assert.equal(state.scheduled,false);assert.equal(state.scheduleTicks,0);
  assert.equal(state.scheduleError.code,'MONITOR_CLOCK_REGRESSION');assert.equal(fs.existsSync(f.journal),false);
});
test('primitive adapter error text remains preserved rather than silently replaced',async()=>{
  const f=fixture(),m=f.make({readBackendState:async()=>{throw 'original primitive failure';}});
  await assert.rejects(m.poll({expectedSequence:0}),error=>error.primaryRecord.message==='original primitive failure'
    && error.primaryRecord.messageChars===26 && error.primaryRecord.phase==='POLL_READ');
  assert.equal(fs.existsSync(f.journal),false);
});
