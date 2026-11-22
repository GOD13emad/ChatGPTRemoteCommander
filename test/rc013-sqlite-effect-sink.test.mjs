import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Rc013SqliteEffectSink } from '../src/rc013-sqlite-effect-sink.mjs';
const H='a'.repeat(64), PAYLOAD='b'.repeat(64);
const claims=(over={})=>({projectId:'project-a',hostId:'host-a',rootFingerprint:H,epoch:1,operationKey:'op-1',payloadHash:PAYLOAD,counterKey:'counter-1',...over});
function fixture(t){
  const dir=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'rc013-owner-sink-'));
  const dbPath=path.join(dir,'owner.sqlite');
  const options={databasePath:dbPath,verifyOwner:()=>true};
  const sink=new Rc013SqliteEffectSink(options);t.after(()=>{sink.close();fs.rmSync(dir,{recursive:true,force:true});});
  sink.enroll({projectId:'project-a',hostId:'host-a',rootFingerprint:H,epoch:1});
  return {sink,dbPath,options};
}
test('native SQL effects are atomically reserved with operation ID and persisted',t=>{
  const f=fixture(t);
  assert.equal(f.sink.increment(claims()).status,'APPLIED');
  assert.equal(f.sink.increment(claims()).status,'CACHED');
  assert.equal(f.sink.inspect('project-a','counter-1'),1);
  const reopened=new Rc013SqliteEffectSink(f.options);
  try{assert.equal(reopened.inspect('project-a','counter-1'),1)}finally{reopened.close()}
});
test('same operation key with changed payload or counter is a conflict',t=>{
  const f=fixture(t);f.sink.increment(claims());
  assert.throws(()=>f.sink.increment(claims({payloadHash:H})),/RC013_SINK_REPLAY_CONFLICT/);
  assert.throws(()=>f.sink.increment(claims({counterKey:'counter-2'})),/RC013_SINK_REPLAY_CONFLICT/);
  assert.equal(f.sink.inspect('project-a','counter-2'),0);
});
test('owner epoch CAS fences stale writers even when their operation key is new',t=>{
  const f=fixture(t);
  assert.deepEqual(f.sink.rotate({projectId:'project-a',expectedEpoch:1,nextHostId:'host-b',nextRootFingerprint:H}),{projectId:'project-a',hostId:'host-b',epoch:2});
  assert.throws(()=>f.sink.increment(claims()),/RC013_SINK_AUTHORITY_FENCE_REJECTED/);
  assert.throws(()=>f.sink.increment(claims({operationKey:'op-2'})),/RC013_SINK_AUTHORITY_FENCE_REJECTED/);
  assert.equal(f.sink.increment(claims({hostId:'host-b',epoch:2,operationKey:'op-3'})).status,'APPLIED');
  assert.throws(()=>f.sink.rotate({projectId:'project-a',expectedEpoch:1,nextHostId:'host-c',nextRootFingerprint:H}),/RC013_SINK_STALE_EPOCH/);
});
test('no native owner proof means no enrollment or epoch rotation',t=>{
  const d=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'rc013-owner-noauth-'));
  const sink=new Rc013SqliteEffectSink({databasePath:path.join(d,'db.sqlite'),verifyOwner:()=>false});t.after(()=>{sink.close();fs.rmSync(d,{recursive:true,force:true});});
  assert.throws(()=>sink.enroll({projectId:'project-a',hostId:'host-a',rootFingerprint:H,epoch:1}),/RC013_SINK_OWNER_PROOF_REQUIRED/);
});
test('reject forged proxy and accessor input without reading semantic fields',t=>{
  const f=fixture(t);
  let called=0;
  const bad=claims();Object.defineProperty(bad,'epoch',{enumerable:true,get(){called++;return 1}});
  assert.throws(()=>f.sink.increment(bad),/RC013_SINK_RECORD_INVALID/);
  const proxy=new Proxy(claims(),{get(t,k){called++;return Reflect.get(t,k)}});
  assert.throws(()=>f.sink.increment(proxy),/RC013_SINK_RECORD_INVALID/);
  assert.equal(called,0);assert.equal(f.sink.inspect('project-a','counter-1'),0);
});
function child(dbPath,scope){
  return new Promise((resolve,reject)=>{
    const cp=spawn(process.execPath,[fileURLToPath(new URL('./rc013-sqlite-sink-worker.mjs',import.meta.url)),dbPath,JSON.stringify(scope)],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';cp.stdout.on('data',x=>stdout+=x);cp.stderr.on('data',x=>stderr+=x);
    cp.on('error',reject);cp.on('close',code=>code===0?resolve(JSON.parse(stdout)):reject(Error(`worker exit=${code} ${stderr}`)));
  });
}
test('two independent processes racing the SAME effect result in precisely one SQL write',async t=>{
  const f=fixture(t);
  // Two SQLite connections in two distinct OS processes; both have same
  // authority DB path, unlike independent per-host SQLite databases.
  const results=await Promise.all([child(f.dbPath,claims()),child(f.dbPath,claims())]);
  assert.deepEqual(results.map(x=>x.status).sort(),['APPLIED','CACHED']);
  assert.equal(f.sink.inspect('project-a','counter-1'),1);
});
test('two processes can commit different operation IDs without losing increments',async t=>{
  const f=fixture(t);
  const results=await Promise.all([child(f.dbPath,claims()),child(f.dbPath,claims({operationKey:'op-2'}))]);
  assert.deepEqual(results.map(x=>x.status).sort(),['APPLIED','APPLIED']);
  assert.equal(f.sink.inspect('project-a','counter-1'),2);
});

test('secondary host and stale epoch fail closed in a separately spawned process',async t=>{
  const f=fixture(t);
  await assert.rejects(child(f.dbPath,claims({hostId:'host-b',operationKey:'bad-host'})),/RC013_SINK_AUTHORITY_FENCE_REJECTED/);
  f.sink.rotate({projectId:'project-a',expectedEpoch:1,nextHostId:'host-b',nextRootFingerprint:H});
  await assert.rejects(child(f.dbPath,claims({operationKey:'stale-epoch'})),/RC013_SINK_AUTHORITY_FENCE_REJECTED/);
  assert.equal(f.sink.inspect('project-a','counter-1'),0);
});
