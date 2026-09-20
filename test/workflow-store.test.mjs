import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { WorkflowStore, canonical, hash } from '../src/workflow-store.mjs';
const worker = fileURLToPath(new URL('./workflow-worker.mjs', import.meta.url));
const fixture = () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-memory-')));
  const options = { directory: path.join(root, 'memory'), allowedRoots: [root], device: 'fixture', configSha256: '1'.repeat(64) };
  const s = new WorkflowStore(options);
  const create = (id='sample') => s.create({ id, root, goal: 'Resume safely', acceptance: ['Validate visible outcome'], steps: [{ id: 'first', title: 'Inspect' }, { id: 'second', title: 'Act' }] });
  return { root, options, s, create, dispose() { s.close(); fs.rmSync(root, { recursive: true, force: true }); } };
};
function runWorker(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [worker, ...args], { stdio: ['ignore','pipe','pipe'] });
    let out='', err=''; p.stdout.on('data',d=>out+=d); p.stderr.on('data',d=>err+=d);
    const timer = setTimeout(()=>{p.kill();reject(new Error('worker timeout'));},15000);
    p.once('error',reject); p.once('close',code=>{clearTimeout(timer);resolve({code,out,err});});
  });
}
const host = dispatch => ({ validate: async()=>{}, dispatch });
const call = (f, extra={}) => f.s.call({ id:'sample',stepId:'first',expectedRevision:1,tool:'read_text',arguments:{path:'x'},...extra },host(async()=>({ok:true})));

test('creation, restart, typed notes and scoped search retain exact state',()=>{
  const f=fixture();try {
    f.create(); f.s.note({id:'sample',expectedRevision:1,kind:'fact',text:'سلام project memory'});
    const before=f.s.get('sample'); f.s.close(); const s=new WorkflowStore(f.options);
    try {assert.deepEqual(s.get('sample'),before);assert.equal(s.search({id:'sample',query:'سلام'}).matches.length,1);assert.equal(s.get('sample').state.notes[0].verification,'UNVERIFIED');}finally{s.close();}
  }finally{f.dispose();}
});
test('stale revision cannot overwrite new memory',()=>{const f=fixture();try{f.create();f.s.note({id:'sample',expectedRevision:1,kind:'decision',text:'A'});assert.throws(()=>f.s.note({id:'sample',expectedRevision:1,kind:'decision',text:'B'}),/REVISION_CONFLICT/);}finally{f.dispose();}});
test('exact duplicate returns receipt and never executes twice',async()=>{const f=fixture();try{
 f.create();let n=0;const h=host(async()=>{n++;return{ok:true};});const a={id:'sample',stepId:'first',expectedRevision:1,tool:'read_text',arguments:{path:'x'}};
 await f.s.call(a,h); const b=await f.s.call(a,h);assert.equal(b.cachedReceipt,true);assert.equal(n,1);assert.equal(f.s.get('sample').state.revision,3);
}finally{f.dispose();}});
test('changed inputs cannot reuse an already executed step',async()=>{const f=fixture();try{f.create();await call(f);await assert.rejects(call(f,{arguments:{path:'y'}}),/REQUIRES_RECONCILIATION/);}finally{f.dispose();}});
test('tool exception remains uncertain; no blind retry',async()=>{const f=fixture();try{
 f.create();let n=0;const a={id:'sample',stepId:'first',expectedRevision:1,tool:'write_text',arguments:{}};
 const h=host(async()=>{n++;throw new Error('sensitive failure detail');});const r=await f.s.call(a,h);
 assert.equal(r.outcome,'UNCERTAIN');assert.ok(f.s.resume('sample').blockers.includes('WORKFLOW_OUTCOME_UNCERTAIN'));
 await assert.rejects(f.s.call(a,h),/REQUIRES_RECONCILIATION/);assert.equal(n,1);assert.ok(!canonical(f.s.export('sample')).includes('sensitive failure detail'));
}finally{f.dispose();}});
for(const result of [{exitCode:7},{timedOut:true},{isError:true},{ok:false},{exitCode:null}]) test('non-success result is not validated '+JSON.stringify(result),async()=>{const f=fixture();try{f.create();const r=await f.s.call({id:'sample',stepId:'first',expectedRevision:1,tool:'run_project_command',arguments:{}},host(async()=>result));assert.equal(r.outcome,'UNCERTAIN');}finally{f.dispose();}});
test('raw arguments and output never reach exported memory',async()=>{const f=fixture();try{f.create();const marker='private_'+Date.now();await f.s.call({id:'sample',stepId:'first',expectedRevision:1,tool:'read_text',arguments:{secret:marker}},host(async()=>({text:marker})));assert.ok(!canonical(f.s.export('sample')).includes(marker));}finally{f.dispose();}});
test('dependency gate rejects out-of-order action without invoking host',async()=>{const f=fixture();try{f.create();let n=0;await assert.rejects(f.s.call({id:'sample',stepId:'second',expectedRevision:1,tool:'read_text',arguments:{}},host(async()=>{n++;})),/DEPENDENCY/);assert.equal(n,0);}finally{f.dispose();}});
test('host policy failure occurs before durable intent',async()=>{const f=fixture();try{f.create();await assert.rejects(f.s.call({id:'sample',stepId:'first',expectedRevision:1,tool:'x',arguments:{}},{validate:async()=>{throw Error('DENY');},dispatch:async()=>{throw Error('unexpected');}}),/DENY/);assert.equal(f.s.get('sample').state.revision,1);}finally{f.dispose();}});
test('checkpoint detects changed and missing evidence, stops next action',()=>{const f=fixture();try{
 f.create();fs.writeFileSync(path.join(f.root,'proof.txt'),'before');f.s.checkpoint({id:'sample',expectedRevision:1,files:['proof.txt'],nextAction:'Inspect',summary:'Recorded evidence'});
 const listed=f.s.list().find(x=>x.id==='sample'),snapshot=f.s.get('sample').state;assert.equal(listed.lifecycle,'WAITING');assert.equal(listed.schedulerEnabled,snapshot.scheduler.enabled);
 assert.equal(f.s.resume('sample').readyForNextStep,true);fs.writeFileSync(path.join(f.root,'proof.txt'),'after');assert.ok(f.s.resume('sample').blockers.includes('WORKFLOW_EVIDENCE_STALE'));
 fs.unlinkSync(path.join(f.root,'proof.txt'));assert.ok(f.s.resume('sample').blockers.includes('WORKFLOW_EVIDENCE_UNAVAILABLE'));
}finally{f.dispose();}});
test('device drift blocks but config hash drift with preserved authority is update-safe',()=>{const f=fixture();try{f.create();const s=new WorkflowStore({...f.options,device:'other'});try{assert.ok(s.resume('sample').blockers.includes('WORKFLOW_IDENTITY_CHANGED'));}finally{s.close();}const c=new WorkflowStore({...f.options,configSha256:'2'.repeat(64)});try{const r=c.resume('sample');assert.deepEqual(r.blockers,[]);assert.equal(r.configDrift,true);assert.equal(r.currentConfigSha256,'2'.repeat(64));}finally{c.close();}}finally{f.dispose();}});
test('project evidence stays scoped while private local memory may live outside project roots',()=>{const f=fixture();const privateDir=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-private-memory-')));try{f.create();assert.throws(()=>f.s.evidence(f.root,['../outside']),/OUT_OF_SCOPE/);const s=new WorkflowStore({...f.options,directory:privateDir});try{assert.equal(s.capabilities().privateLocalStorage,true);assert.throws(()=>s.create({id:'outside',root:path.dirname(f.root),goal:'x',acceptance:['x'],steps:[{id:'one',title:'x'}]}),/ROOT_OUT_OF_SCOPE/);}finally{s.close();}}finally{f.dispose();fs.rmSync(privateDir,{recursive:true,force:true});}});
test('symlink and hardlink evidence rejected',t=>{const f=fixture();try{
 const target=path.join(f.root,'proof.txt');fs.writeFileSync(target,'x');
 fs.linkSync(target,path.join(f.root,'hard.txt'));assert.throws(()=>f.s.evidence(f.root,['hard.txt']),/INVALID_FILE/);fs.unlinkSync(path.join(f.root,'hard.txt'));
 try{fs.symlinkSync(target,path.join(f.root,'soft.txt'));}catch(e){if(e.code==='EPERM'){t.diagnostic('OS symlink privilege unavailable; hardlink guard tested');return;}throw e;}
 assert.throws(()=>f.s.evidence(f.root,['soft.txt']),/LINK/);
}finally{f.dispose();}});
test('credential-shaped strings and malformed IDs rejected without persisting',()=>{const f=fixture();try{f.create();assert.throws(()=>f.s.note({id:'sample',expectedRevision:1,kind:'fact',text:['sk','x'.repeat(40)].join('-')}),/SECRET/);assert.throws(()=>f.s.get('../x'),/INVALID_ID/);assert.equal(f.s.get('sample').state.revision,1);}finally{f.dispose();}});
test('invalid DAG and duplicate IDs fail at create',()=>{const f=fixture();try{assert.throws(()=>f.s.create({id:'bad',root:f.root,goal:'Test',acceptance:['x'],steps:[{id:'a',title:'x',dependsOn:['b']}]}),/DEPENDENCY/);assert.throws(()=>f.s.create({id:'bad',root:f.root,goal:'Test',acceptance:['x'],steps:[{id:'a',title:'x'},{id:'a',title:'y'}]}),/DUPLICATE/);}finally{f.dispose();}});
test('history triggers enforce append-only and projection tampering fails closed',()=>{const f=fixture();try{
 f.create();const db=new DatabaseSync(f.s.location);try{assert.throws(()=>db.exec("DELETE FROM events"),/APPEND_ONLY/);db.exec("UPDATE workflows SET snapshot='{}' WHERE id='sample'");}finally{db.close();}
 assert.throws(()=>f.s.get('sample'),/CORRUPT/);
}finally{f.dispose();}});
test('export has verifiable canonical digest and excludes foreign project',()=>{const f=fixture();try{f.create();f.create('other');const b=f.s.export('sample');assert.equal(b.sha256,hash(canonical(b.bundle)));assert.equal(b.bundle.state.id,'sample');assert.equal(b.bundle.events.length,1);assert.equal(f.s.list().length,2);}finally{f.dispose();}});
test('second live process cannot reconcile another process in-flight',async()=>{const f=fixture();try{
 f.create();fs.writeFileSync(path.join(f.root,'proof.txt'),'inspect');let release;const wait=new Promise(r=>release=r);
 const action=f.s.call({id:'sample',stepId:'first',expectedRevision:1,tool:'read_text',arguments:{}},host(async()=>{await wait;return{ok:true};}));
 await new Promise(r=>setTimeout(r,30));const s=new WorkflowStore(f.options);
 try{assert.throws(()=>s.reconcile({id:'sample',stepId:'first',expectedRevision:2,outcome:'applied',files:['proof.txt'],explanation:'Reviewed'}),/STILL_RUNNING/);}finally{s.close();release();await action;}
}finally{f.dispose();}});
test('process crash after external effect preserves uncertain intent and never repeats it',async()=>{const f=fixture();try{
 f.create();const r=await runWorker(['crash',f.root]);assert.equal(r.code,73,r.err);assert.equal(fs.readFileSync(path.join(f.root,'effect.txt'),'utf8'),'once');
 assert.ok(f.s.resume('sample').blockers.includes('WORKFLOW_OUTCOME_UNCERTAIN'));
 await assert.rejects(call(f),/REQUIRES_RECONCILIATION/);
 const proof=f.s.reconcile({id:'sample',stepId:'first',expectedRevision:2,outcome:'applied',files:['effect.txt'],explanation:'One marker was independently observed after child exit'});
 assert.equal(proof.state.steps[0].status,'reconciled_applied');assert.equal(f.s.resume('sample').nextStep,'second');
}finally{f.dispose();}});
test('two processes contend for same revision: exactly one records intent/action',async()=>{const f=fixture();try{
 f.create();const r=await Promise.all([runWorker(['race',f.root]),runWorker(['race',f.root])]);
 assert.ok(r.some(x=>x.code===0),JSON.stringify(r));assert.equal(fs.readFileSync(path.join(f.root,'effects.txt'),'utf8').split('\n').filter(Boolean).length,1);
 assert.equal(f.s.get('sample').state.steps[0].status,'verified');
}finally{f.dispose();}});
test('crash inside an uncommitted transaction is rolled back on reopen',async()=>{const f=fixture();try{
 f.create();const r=await runWorker(['transaction-crash',f.root]);assert.equal(r.code,74,r.err);assert.equal(f.s.get('sample').state.revision,1);
}finally{f.dispose();}});
test('large and deeply nested inputs are bounded',()=>{const f=fixture();try{f.create();assert.throws(()=>f.s.note({id:'sample',expectedRevision:1,kind:'fact',text:'x'.repeat(9000)}),/INVALID_TEXT/);let v={};for(let i=0;i<30;i++)v={nested:v};assert.throws(()=>canonical(v),/DEPTH/);}finally{f.dispose();}});
test('not-applied attestation does not create an automatic retry',async()=>{const f=fixture();try{
 f.create();fs.writeFileSync(path.join(f.root,'proof.txt'),'not applied');await f.s.call({id:'sample',stepId:'first',expectedRevision:1,tool:'x',arguments:{}},host(async()=>{throw Error('failed');}));
 f.s.reconcile({id:'sample',stepId:'first',expectedRevision:3,outcome:'not_applied',files:['proof.txt'],explanation:'Independent target inspection'});
 assert.ok(f.s.resume('sample').blockers.includes('WORKFLOW_REPLAN_REQUIRED'));await assert.rejects(call(f),/REQUIRES_RECONCILIATION/);
}finally{f.dispose();}});
