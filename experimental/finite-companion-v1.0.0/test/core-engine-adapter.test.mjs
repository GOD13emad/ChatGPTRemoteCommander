import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {collectCoreSourcePins,createCoreEngineAdapter,hostProofContent} from '../src/core-engine-adapter.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coreRoot = path.join(root,'fixtures/core-v0.10.6');
const configSha256 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const pins = collectCoreSourcePins(coreRoot);
// Keep SQLite paths below Windows MAX_PATH without changing machine policy.
// Hosted Windows TEMP may be a junction. Resolve the existing test parent
// before creating a fresh owned directory; do not relax the runtime alias guard.
const testArea = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'commander-core-tests-'));
if (path.join(testArea,'owned-'+'0'.repeat(36),'.engine/project-engine/project-runs.sqlite-journal').length>=240) throw Error('TEST_TEMP_PATH_TOO_LONG');
fs.mkdirSync(testArea,{recursive:true});
const host = {name:'chatgpt-remote-commander',deviceName:'saeid',platform:'win32',version:'0.10.6',
  configSha256,instance:{profile:'default',isolated:false}};
async function fixture({choices=['CONTINUE_STEP','CONTINUE_STEP'],hostValue=host,throwAfterWrite=false}={}) {
  const target=path.join(testArea,'owned-'+randomUUID());fs.mkdirSync(target);
  const calls=[],plans=[];let adapter;
  const enrollment={id:'owned-host-proof',runId:'owned-proof-run',owner:'saeed',authorizationSha256:'a'.repeat(64),configSha256,
    planDefinitions:[{id:'observe_status',tool:'system_status',arguments:{}},
      {id:'write_proof',tool:'write_text',arguments:{path:'HOST_PROOF.json',content:hostProofContent(configSha256)}}]};
  adapter=await createCoreEngineAdapter({coreRoot,corePins:pins,root:target,enrollment,
    planner:{plan:async context=>{plans.push(context);const v=choices[plans.length-1];return typeof v==='object'?v:{choice:v};}},
    dispatch:async(name,args)=>{
      const current=await adapter.state();
      const running=current.state.steps.filter(s=>s.status==='running');
      assert.equal(running.length,1,'the core journals its intent before host dispatch');
      assert.equal(running[0].tool,name);calls.push({name,args});
      if(name==='system_status')return {status:hostValue};
      assert.equal(name,'write_text');assert.equal(args.path,'HOST_PROOF.json');
      fs.writeFileSync(path.join(target,args.path),args.content,{flag:'wx'});
      if(throwAfterWrite)throw Object.assign(Error('QUALIFICATION_UNCERTAIN_WRITE'),{workflowCode:'QUALIFICATION_UNCERTAIN_WRITE'});
      return {ok:true};
    }});
  return {adapter,target,calls,plans,enrollment};
}

test('core registry pins exact fixture version and transitive workflow imports',()=>{
  for(const name of ['src/workflow-tools.mjs','src/workflow-store.mjs','src/project-engine.mjs','src/project-verifier.mjs',
    'src/project-planner.mjs','src/schema-validator.mjs','package.json'])assert.ok(pins.some(p=>p.relative===name),name);
  assert.ok(pins.length>7);assert.ok(pins.every(p=>p.nlink===1&&p.bytes>0&&/^[a-f0-9]{64}$/.test(p.sha256)));
});
test('construction and reads never activate unenrolled work',async()=>{
  const f=await fixture();try{
    const status=await f.adapter.status();assert.equal(status.runs.length,0);
    await f.adapter.health();await assert.rejects(f.adapter.tick(),/ADAPTER_EXPLICIT_ENROLLMENT_REQUIRED/);
    assert.equal(f.plans.length,0);assert.equal(f.calls.length,0);assert.equal(fs.existsSync(path.join(f.target,'HOST_PROOF.json')),false);
  }finally{await f.adapter.close();}
});
test('pinned core fixture completes exact two-step plan only after deterministic acceptance',async()=>{
  const f=await fixture();try{
    const queued=await f.adapter.enroll();assert.equal(queued.status,'QUEUED');
    assert.equal((await f.adapter.tick()).status,'QUEUED');
    assert.equal((await f.adapter.tick()).status,'QUEUED');
    const completed=await f.adapter.tick();assert.equal(completed.status,'COMPLETED');
    assert.equal(completed.lastCode,'PROJECT_ACCEPTANCE_VERIFIED');
    assert.equal(completed.actions,2);assert.equal(completed.plannerCalls,2);
    assert.equal(f.calls.length,2);assert.equal(f.plans.length,2);
    assert.deepEqual(f.plans.map(p=>p.currentStep),['observe_status','write_proof']);
    assert.equal(fs.readFileSync(path.join(f.target,'HOST_PROOF.json'),'utf8'),hostProofContent(configSha256));
    const state=await f.adapter.state();assert.equal(state.state.lifecycleState,'COMPLETED');
    assert.deepEqual(state.state.finalization.acceptanceResults,[true]);
    const operations=(await f.adapter.operations()).operations;assert.equal(operations.length,2);
    assert.equal(operations[0].status,'VERIFIED');assert.equal(operations[1].status,'EXECUTED');
    assert.equal((await f.adapter.tick()).skipped,true);assert.equal(f.plans.length,2);
  }finally{await f.adapter.close();}
});
test('owner STOP first blocks without any action',async()=>{
  const f=await fixture({choices:['STOP']});try{
    await f.adapter.enroll();const result=await f.adapter.tick();assert.equal(result.status,'BLOCKED');
    assert.equal(result.lastCode,'PROJECT_PLANNER_BLOCKED');assert.equal(result.actions,0);
    assert.equal(f.calls.length,0);assert.equal((await f.adapter.tick()).skipped,true);assert.equal(f.plans.length,1);
  }finally{await f.adapter.close();}
});
test('STOP after read does not infer authority for writing the proof',async()=>{
  const f=await fixture({choices:['CONTINUE_STEP','STOP']});try{
    await f.adapter.enroll();await f.adapter.tick();const result=await f.adapter.tick();
    assert.equal(result.status,'BLOCKED');assert.equal(result.actions,1);assert.equal(f.calls.length,1);
    assert.equal(fs.existsSync(path.join(f.target,'HOST_PROOF.json')),false);
  }finally{await f.adapter.close();}
});
for(const choice of [{choice:'CONTINUE_STEP',tool:'run_shell'},{choice:'UNKNOWN'},Object.create(null,{choice:{get(){throw Error('GETTER_MUST_NOT_RUN');},enumerable:true}})])
  test('unknown/expanded/getter model choice fails closed without host action '+String(Object.getOwnPropertyDescriptor(choice,'choice')?.value),async()=>{
    const f=await fixture({choices:[choice]});try{
      await f.adapter.enroll();const result=await f.adapter.tick();assert.equal(result.status,'BLOCKED');assert.equal(f.calls.length,0);
      assert.equal((await f.adapter.tick()).skipped,true);assert.equal(f.plans.length,1);
    }finally{await f.adapter.close();}
  });
for(const hostValue of [{...host,deviceName:'Emad-PC-Ultimate'},{...host,version:'0.10.5'},
  {...host,configSha256:'f'.repeat(64)},{...host,instance:{profile:'secondary',isolated:false}}])
  test('actual host/config/runtime/profile drift blocks proof and preserves uncertain receipt '+JSON.stringify(hostValue.instance)+' '+hostValue.deviceName+' '+hostValue.version+' '+hostValue.configSha256.slice(0,4),async()=>{
    const f=await fixture({hostValue});try{
      await f.adapter.enroll();const result=await f.adapter.tick();assert.equal(result.status,'BLOCKED');assert.equal(f.calls.length,1);
      assert.equal(fs.existsSync(path.join(f.target,'HOST_PROOF.json')),false);assert.equal((await f.adapter.tick()).skipped,true);
      const operations=(await f.adapter.operations()).operations;assert.equal(operations.length,1);assert.equal(operations[0].status,'UNCERTAIN');
    }finally{await f.adapter.close();}
  });
test('uncertain post-write outcome is never replayed or marked completed',async()=>{
  const f=await fixture({throwAfterWrite:true});try{
    await f.adapter.enroll();await f.adapter.tick();const result=await f.adapter.tick();assert.equal(result.status,'BLOCKED');
    assert.equal(fs.existsSync(path.join(f.target,'HOST_PROOF.json')),true);assert.equal((await f.adapter.tick()).skipped,true);
    assert.equal(f.calls.length,2);assert.equal(f.plans.length,2);
    assert.equal((await f.adapter.operations()).operations[1].status,'UNCERTAIN');
    assert.notEqual((await f.adapter.state()).state.lifecycleState,'COMPLETED');
  }finally{await f.adapter.close();}
});
test('duplicate enrollment cannot replenish model/action budget',async()=>{
  const f=await fixture();try{
    await f.adapter.enroll();await f.adapter.tick();const first=await f.adapter.status();
    await assert.rejects(f.adapter.enroll(),/ADAPTER_ALREADY_ENROLLED/);
    const second=await f.adapter.status();assert.equal(second.plannerCalls,first.plannerCalls);assert.equal(second.maxPlannerCalls,2);
  }finally{await f.adapter.close();}
});
test('proof modification fails independent acceptance instead of being repaired',async()=>{
  const f=await fixture();try{
    await f.adapter.enroll();await f.adapter.tick();await f.adapter.tick();
    fs.writeFileSync(path.join(f.target,'HOST_PROOF.json'),'tampered qualification proof');
    const result=await f.adapter.tick();assert.equal(result.status,'BLOCKED');assert.equal(f.calls.length,2);assert.equal(f.plans.length,2);
    assert.equal((await f.adapter.tick()).skipped,true);
  }finally{await f.adapter.close();}
});
test('nonempty root, false authority, and mismatched source pins are refused before core DB creation',async()=>{
  const base=await fixture();const enrollment=base.enrollment;await base.adapter.close();
  const create=async changes=>{
    const target=path.join(testArea,'owned-'+randomUUID());fs.mkdirSync(target);
    if(changes.nonempty)fs.writeFileSync(path.join(target,'preserve.txt'),'belongs to existing work');
    const config={coreRoot,corePins:pins,root:target,enrollment,planner:{plan:async()=>({choice:'CONTINUE_STEP'})},dispatch:async()=>host,...changes};
    delete config.nonempty;await assert.rejects(createCoreEngineAdapter(config));
    assert.equal(fs.existsSync(path.join(target,'.engine')),false);
  };
  await create({nonempty:true});
  await create({enrollment:{...enrollment,owner:'emad'}});
  await create({corePins:pins.map((pin,n)=>n?pin:{...pin,sha256:'0'.repeat(64)})});
  await create({enrollment:{...enrollment,planDefinitions:[enrollment.planDefinitions[0],{id:'write_proof',tool:'write_text',arguments:{path:'../outside.txt',content:'not authorized'}}]}});
});
