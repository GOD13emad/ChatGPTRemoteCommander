import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { WorkflowStore } from '../src/workflow-store.mjs';
import { createWorkflowTools } from '../src/workflow-tools.mjs';

function fixture() {
  const home=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'v105-cross-profile-')));
  const root=path.join(home,'project');
  fs.mkdirSync(root);
  const shared=path.join(home,'shared-leases');
  const opts=(p)=>({ directory:path.join(home,p,'workflows'),rootLeaseDirectory:shared,
    allowedRoots:[root],authority:{profileId:p},device:'fixture',configSha256:'a'.repeat(64),
    schedulerPolicy:{enabled:false,oneWriterPerRoot:true,leaseMs:5000} });
  const store=(p,extra={})=>new WorkflowStore({...opts(p),...extra});
  return {home,root,shared,store,cleanup:()=>fs.rmSync(home,{recursive:true,force:true})};
}
function create(store,id,root) {
  store.create({id,root,goal:'Safe lease fixture',acceptance:['No concurrent writer'],
    steps:[{id:'task',title:'Read'}]});
}
function call(store,id,dispatch) {
  return store.call({id,stepId:'task',expectedRevision:1,tool:'read_text',arguments:{path:'fixture'}},
    {validate:async()=>{},dispatch});
}
function expireDatabase(f) {
  const db=new DatabaseSync(path.join(f.shared,'root-leases.sqlite'));
  try {db.prepare("UPDATE root_leases SET expires_at='1970-01-01T00:00:00.000Z'").run();}finally{db.close();}
}
test('expiry during active call never permits a second profile dispatch',async()=>{
  const f=fixture(),a=f.store('profile-a'),b=f.store('profile-b');
  let release,started;const hold=new Promise(r=>release=r), entered=new Promise(r=>started=r);
  try {
    create(a,'first',f.root);create(b,'second',f.root);
    const first=call(a,'first',async()=>{started();await hold;return {ok:true};});
    await entered;
    expireDatabase(f);
    let calls=0;
    try {
      await assert.rejects(call(b,'second',async()=>{calls++;return{ok:true};}),
        /WORKFLOW_ROOT_LEASE_EXPIRED_RECONCILIATION_REQUIRED/);
      assert.equal(calls,0);
      const health=a.schedulerStatus();
      assert.equal(health.expiredLeasesRequiringReconciliation,1);
      assert.equal(health.rootLeasesBlocking,1);
    } finally {release();await first;}
    const result=await call(b,'second',async()=>({ok:true}));
    assert.equal(result.outcome,'RECORDED_NOT_VALIDATED');
  } finally {a.close();b.close();f.cleanup();}
});
test('expired unknown lease survives status checks and fail-closes after restart',async()=>{
  const f=fixture();let a=f.store('profile-a'),b=f.store('profile-b');
  try{
    create(a,'first',f.root);create(b,'second',f.root);
    const db=new DatabaseSync(path.join(f.shared,'root-leases.sqlite'));
    try{
      db.prepare('INSERT INTO root_leases(root,profile,workflow,owner,expires_at,revision) VALUES(?,?,?,?,?,?)')
        .run(process.platform==='win32'?path.resolve(f.root).toLowerCase():path.resolve(f.root),
           'profile-a','first','crashed-process-uncertain','1970-01-01T00:00:00.000Z',1);
    }finally{db.close();}
    assert.equal(b.schedulerStatus().expiredLeasesRequiringReconciliation,1);
    b.close();b=f.store('profile-b');
    assert.equal(b.schedulerStatus().expiredLeasesRequiringReconciliation,1);
    let dispatched=false;
    await assert.rejects(call(b,'second',async()=>{dispatched=true;return{ok:true};}),
      /WORKFLOW_ROOT_LEASE_EXPIRED_RECONCILIATION_REQUIRED/);
    assert.equal(dispatched,false);
  }finally{a.close();b.close();f.cleanup();}
});
test('adapter rejects implicit and private lease directory while accepting explicit shared path',()=>{
  const f=fixture();
  const api=(lease)=>createWorkflowTools({
    config:{durableWorkflows:{enabled:true,directory:path.join(f.home,'one','workflows'),
      ...(lease===undefined?{}:{rootLeaseDirectory:lease})}},
    roots:[f.root],device:'fixture',configSha256:'a'.repeat(64),
    lookup:name=>({name,inputSchema:{type:'object'}}),
    validateSchema:()=>[],dispatch:async()=>({ok:true})
  });
  try {
    assert.throws(()=>api(),/WORKFLOW_SHARED_ROOT_LEASE_DIRECTORY_REQUIRED/);
    assert.throws(()=>api(path.join(f.home,'one','workflows')),/WORKFLOW_SHARED_ROOT_LEASE_DIRECTORY_REQUIRED/);
    assert.throws(()=>api(path.join(f.home,'one','workflows','private-child')),
      /WORKFLOW_SHARED_ROOT_LEASE_DIRECTORY_REQUIRED/);
    if (process.platform === 'win32') assert.throws(()=>api(path.join(f.home,'one','workflows').toUpperCase()),
      /WORKFLOW_SHARED_ROOT_LEASE_DIRECTORY_REQUIRED/);
    const a=api(f.shared);
    try{assert.ok(a.definitions.length>0);}
    finally{a.close();}
  }finally{f.cleanup();}
});

test('capability scope distinguishes profile-local from configured shared store',()=>{
 const f=fixture(); const a=f.store('profile-shared');
 const local=new WorkflowStore({directory:path.join(f.home,'local'),allowedRoots:[f.root],
  authority:{profileId:'local'},device:'fixture',configSha256:'a'.repeat(64),
  schedulerPolicy:{enabled:false,oneWriterPerRoot:true}});
 try{assert.equal(a.capabilities().oneWriterScope,'CONFIGURED_SHARED_LEASE_STORE');
     assert.equal(local.capabilities().oneWriterScope,'PROFILE_LOCAL');}
 finally{local.close();a.close();f.cleanup();}
});


test('lease inspection is read-only, redacted and stable across profile restart',()=>{
 const f=fixture(); let a=f.store('alpha'), b=f.store('beta');
 try {
  create(a,'first',f.root);
  assert.equal(a.leaseStoreFingerprint(),b.leaseStoreFingerprint());
  const empty=b.rootLeaseStatus(f.root);
  assert.equal(empty.blocking,false);
  assert.equal(empty.leaseFingerprint,null);
  const db=new DatabaseSync(path.join(f.shared,'root-leases.sqlite'));
  try {
   db.prepare('INSERT INTO root_leases(root,profile,workflow,owner,expires_at,revision) VALUES(?,?,?,?,?,?)')
     .run(process.platform==='win32'?path.resolve(f.root).toLowerCase():path.resolve(f.root),
       'alpha','first','sensitive-owner-reference','2099-01-01T00:00:00.000Z',1);
  } finally {db.close();}
  const active=b.rootLeaseStatus(f.root);
  assert.equal(active.blocking,true);
  assert.equal(active.expired,false);
  assert.equal(active.reconciliationRequired,false);
  assert.match(active.leaseFingerprint,/^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(active).includes('sensitive-owner-reference'));
  assert.ok(!JSON.stringify(active).includes('"profile":"alpha"'));
  b.close(); b=f.store('beta');
  assert.equal(b.rootLeaseStatus(f.root).leaseFingerprint,active.leaseFingerprint);
  expireDatabase(f);
  const expired=b.rootLeaseStatus(f.root);
  assert.equal(expired.expired,true);
  assert.equal(expired.reconciliationRequired,true);
  assert.equal(expired.blocking,true);
  assert.notEqual(expired.leaseFingerprint,active.leaseFingerprint);
  assert.equal(b.schedulerStatus().rootLeasesBlocking,1);
 } finally {a.close();b.close();f.cleanup();}
});

test('lease inspection does not grant another profile or out-of-root access',()=>{
 const f=fixture(), a=f.store('alpha');
 try {
  const outside=path.join(f.home,'outside');fs.mkdirSync(outside);
  assert.throws(()=>a.rootLeaseStatus(outside),/WORKFLOW_ROOT_OUT_OF_SCOPE/);
  const other=new WorkflowStore({directory:path.join(f.home,'other-private'),allowedRoots:[f.root],
    device:'fixture',configSha256:'a'.repeat(64),authority:{profileId:'other'},
    schedulerPolicy:{oneWriterPerRoot:true,enabled:false}});
  try {
   assert.notEqual(a.leaseStoreFingerprint(),other.leaseStoreFingerprint());
   assert.equal(other.capabilities().oneWriterScope,'PROFILE_LOCAL');
   assert.equal(a.capabilities().leaseStoreFingerprint,a.leaseStoreFingerprint());
  } finally {other.close();}
 } finally {a.close();f.cleanup();}
});


test('workflow_status exposes same-host lease store identity without owner data',async()=>{
 const f=fixture();
 const api=(profile,lease=f.shared)=>createWorkflowTools({
  config:{durableWorkflows:{enabled:true,directory:path.join(f.home,profile,'workflows'),
    rootLeaseDirectory:lease,scheduler:{enabled:false,oneWriterPerRoot:true}}},
  roots:[f.root],device:'fixture',configSha256:'a'.repeat(64),
  lookup:name=>({name,inputSchema:{type:'object'}}),
  validateSchema:()=>[],dispatch:async()=>({ok:true})
 });
 const a=api('profile-a'),b=api('profile-b'),c=api('profile-c',path.join(f.home,'second-shared'));
 try {
  const one=await a.execute('workflow_status',{});
  const two=await b.execute('workflow_status',{});
  const distinct=await c.execute('workflow_status',{});
  assert.equal(one.leaseStoreFingerprint,two.leaseStoreFingerprint);
  assert.notEqual(one.leaseStoreFingerprint,distinct.leaseStoreFingerprint);
  assert.equal(one.leaseIdentityComparisonScope,'SAME_HOST_ONLY');
  assert.equal(one.oneWriterScope,'CONFIGURED_SHARED_LEASE_STORE');
  assert.ok(!JSON.stringify(one).includes('"owner"'));
 }finally{a.close();b.close();c.close();f.cleanup();}
});


test('vanished root lease never reports a successful operation receipt',async()=>{
 const f=fixture(),a=f.store('alpha');
 try{
  create(a,'first',f.root);
  const r=await call(a,'first',async()=>{
   const db=new DatabaseSync(path.join(f.shared,'root-leases.sqlite'));
   try{db.prepare('DELETE FROM root_leases').run();}finally{db.close();}
   return {ok:true};
  });
  assert.equal(r.outcome,'UNCERTAIN');
  assert.equal(r.receipt.errorCode,'WORKFLOW_ROOT_LEASE_LOST');
  assert.equal(r.result,null);
  const view=a.get('first');
  assert.equal(view.state.steps[0].status,'uncertain');
  assert.equal(a.resume('first').blockers.includes('WORKFLOW_OUTCOME_UNCERTAIN'),true);
 }finally{a.close();f.cleanup();}
});

test('foreign owner replacing lease cannot be released by the displaced executor',async()=>{
 const f=fixture(),a=f.store('alpha'),b=f.store('beta');
 try{
  create(a,'first',f.root);create(b,'second',f.root);
  const r=await call(a,'first',async()=>{
   const db=new DatabaseSync(path.join(f.shared,'root-leases.sqlite'));
   try{
    db.prepare("UPDATE root_leases SET owner='foreign-owner',profile='foreign-profile'").run();
   }finally{db.close();}
   return {ok:true};
  });
  assert.equal(r.outcome,'UNCERTAIN');
  assert.equal(r.receipt.errorCode,'WORKFLOW_ROOT_LEASE_LOST');
  assert.equal(a.rootLeaseStatus(f.root).blocking,true);
  let dispatched=false;
  await assert.rejects(call(b,'second',async()=>{dispatched=true;return{ok:true};}),/WORKFLOW_ROOT_LEASED/);
  assert.equal(dispatched,false);
 }finally{a.close();b.close();f.cleanup();}
});


test('lost lease is never replayed after reopening the workflow database',async()=>{
 const f=fixture();let a=f.store('alpha');
 try {
  create(a,'first',f.root);
  const r=await call(a,'first',async()=>{
   const db=new DatabaseSync(path.join(f.shared,'root-leases.sqlite'));
   try {db.prepare('DELETE FROM root_leases').run();}finally{db.close();}
   return {ok:true};
  });
  assert.equal(r.outcome,'UNCERTAIN');
  const operationId=a.get('first').state.steps[0].operationId;
  a.close();
  a=f.store('alpha');
  assert.equal(a.get('first').state.steps[0].status,'uncertain');
  assert.equal(a.get('first').state.steps[0].operationId,operationId);
  let replayed=false;
  await assert.rejects(call(a,'first',async()=>{replayed=true;return {ok:true};}),
    /WORKFLOW_OUTCOME_REQUIRES_RECONCILIATION/);
  assert.equal(replayed,false);
 }finally{a.close();f.cleanup();}
});


test('lost renewal is latched even if the original row reappears before receipt',async()=>{
 const f=fixture(),a=f.store('alpha');
 const realSetInterval=globalThis.setInterval;
 let heartbeat;
 globalThis.setInterval=(callback)=>{heartbeat=callback;return {unref(){}};};
 try{
  create(a,'first',f.root);
  const r=await call(a,'first',async()=>{
   const db=new DatabaseSync(path.join(f.shared,'root-leases.sqlite'));
   try {
    const prior=db.prepare('SELECT owner,profile FROM root_leases').get();
    assert.ok(prior?.owner);
    db.prepare("UPDATE root_leases SET owner='temporarily-foreign'").run();
    assert.equal(typeof heartbeat,'function');
    heartbeat();
    db.prepare('UPDATE root_leases SET owner=?').run(prior.owner);
   }finally{db.close();}
   return {ok:true};
  });
  assert.equal(r.outcome,'UNCERTAIN');
  assert.equal(r.receipt.errorCode,'WORKFLOW_ROOT_LEASE_LOST');
  assert.equal(a.get('first').state.steps[0].status,'uncertain');
 }finally{globalThis.setInterval=realSetInterval;a.close();f.cleanup();}
});


test('resume reports foreign active shared-root lease as blocked, then ready after release',async()=>{
 const f=fixture(),first=f.store('alpha'),second=f.store('beta');
 let enter,finish;
 const started=new Promise(resolve=>enter=resolve);
 const hold=new Promise(resolve=>finish=resolve);
 try{
  create(first,'one',f.root);create(second,'two',f.root);
  const pending=call(first,'one',async()=>{enter();await hold;return {ok:true};});
  await started;
  try{
   const view=second.resume('two');
   assert.equal(view.readyForNextStep,false);
   assert.ok(view.blockers.includes('WORKFLOW_ROOT_LEASED'));
  }finally{finish();await pending;}
  const available=second.resume('two');
  assert.equal(available.readyForNextStep,true);
  assert.ok(!available.blockers.includes('WORKFLOW_ROOT_LEASED'));
 }finally{first.close();second.close();f.cleanup();}
});

test('resume refuses readiness for expired unreconciled root lease after restart',()=>{
 const f=fixture();let second=f.store('beta');
 try{
  create(second,'two',f.root);
  const db=new DatabaseSync(path.join(f.shared,'root-leases.sqlite'));
  try{
   db.prepare('INSERT INTO root_leases(root,profile,workflow,owner,expires_at,revision) VALUES(?,?,?,?,?,?)')
    .run(process.platform==='win32'?path.resolve(f.root).toLowerCase():path.resolve(f.root),'alpha','one','orphan',
     '1970-01-01T00:00:00.000Z',1);
  }finally{db.close();}
  second.close();second=f.store('beta');
  const state=second.resume('two');
  assert.equal(state.readyForNextStep,false);
  assert.ok(state.blockers.includes('WORKFLOW_ROOT_LEASE_EXPIRED_RECONCILIATION_REQUIRED'));
 }finally{second.close();f.cleanup();}
});


test('scheduler tick surfaces foreign lease blockers and becomes ready after owner releases',async()=>{
 const f=fixture(),first=f.store('alpha');
 let enter,release;
 const started=new Promise(resolve=>enter=resolve);
 const hold=new Promise(resolve=>release=resolve);
 const adapter=createWorkflowTools({
  config:{durableWorkflows:{enabled:true,
    directory:path.join(f.home,'beta','workflows'),rootLeaseDirectory:f.shared,
    executionTools:['read_text'],
    scheduler:{enabled:true,intervalMs:60000,oneWriterPerRoot:true}}},
  roots:[f.root],device:'fixture',configSha256:'a'.repeat(64),
  lookup:name=>({name,inputSchema:{type:'object'}}),
  validateSchema:()=>[],dispatch:async()=>({ok:true})
 });
 try{
  create(first,'first',f.root);
  await adapter.execute('workflow_create',{id:'second',root:f.root,goal:'wait for independent writer',
    acceptance:['no overlap'],steps:[{id:'read',title:'Read once'}]});
  const busy=call(first,'first',async()=>{enter();await hold;return {ok:true};});
  await started;
  try{
   const tick=await adapter.execute('workflow_scheduler_tick',{});
   const blocked=tick.blocked.find(item=>item.id==='second');
   assert.ok(blocked);
   assert.ok(blocked.blockers.includes('WORKFLOW_ROOT_LEASED'));
   assert.equal(tick.ready.some(item=>item.id==='second'),false);
  }finally{release();await busy;}
  const resumed=await adapter.execute('workflow_scheduler_tick',{});
  assert.ok(resumed.ready.some(item=>item.id==='second'));
 }finally{adapter.close();first.close();f.cleanup();}
});


test('uncertain timed-out effect retains root lease across restart until external cessation is proven',async()=>{
 const f=fixture();let a=f.store('alpha'),b=f.store('beta');
 try{
  create(a,'first',f.root);create(b,'second',f.root);
  const result=await call(a,'first',async()=>({timedOut:true,exitCode:null}));
  assert.equal(result.outcome,'UNCERTAIN');
  assert.equal(a.get('first').state.steps[0].status,'uncertain');
  // A timed-out tool response is not evidence that its external child stopped.
  assert.equal(b.rootLeaseStatus(f.root).blocking,true);
  a.close();a=f.store('alpha');
  assert.equal(a.get('first').state.steps[0].status,'uncertain');
  assert.equal(b.rootLeaseStatus(f.root).blocking,true);
  let secondDispatches=0;
  await assert.rejects(call(b,'second',async()=>{secondDispatches++;return{ok:true};}),
    /WORKFLOW_ROOT_LEASED|WORKFLOW_ROOT_LEASE_EXPIRED_RECONCILIATION_REQUIRED/);
  assert.equal(secondDispatches,0);
 }finally{a.close();b.close();f.cleanup();}
});


test('read-only APPLIED reconciliation does not reclaim an uncertain external lease',async()=>{
 const f=fixture(),a=f.store('alpha'),b=f.store('beta');
 try {
  create(a,'first',f.root);create(b,'second',f.root);
  const operation=await call(a,'first',async()=>({timedOut:true,exitCode:null}));
  assert.equal(operation.outcome,'UNCERTAIN');
  const proof=await a.reconcileAutomatically('first',{verify:async()=>({
    status:'APPLIED',summary:'post-state matched independently'
  })});
  assert.equal(proof.changed,true);
  assert.equal(proof.status,'APPLIED');
  assert.equal(a.get('first').state.steps[0].status,'reconciled_applied');
  // Post-state verification is not an execution-cessation or process-tree receipt.
  assert.equal(b.rootLeaseStatus(f.root).blocking,true);
  assert.ok(b.resume('second').blockers.includes('WORKFLOW_ROOT_LEASED'));
 }finally {a.close();b.close();f.cleanup();}
});


test('independent Node process cannot dispatch after a timed-out shared-root effect',async()=>{
 const f=fixture();const a=f.store('alpha');let b=f.store('beta');
 try{
  create(a,'first',f.root);create(b,'second',f.root);
  const done=await call(a,'first',async()=>({timedOut:true,exitCode:null}));
  assert.equal(done.outcome,'UNCERTAIN');
  b.close();b=null;
  const options={
   directory:path.join(f.home,'beta','workflows'),rootLeaseDirectory:f.shared,
   allowedRoots:[f.root],device:'fixture',configSha256:'a'.repeat(64),
   authority:{profileId:'beta'},
   schedulerPolicy:{enabled:false,oneWriterPerRoot:true,leaseMs:5000}
  };
  const moduleUrl=new URL('../src/workflow-store.mjs',import.meta.url).href;
  const script=[
    'import fs from "node:fs";',
    'import {WorkflowStore} from ' + JSON.stringify(moduleUrl) + ';',
    'const options=JSON.parse(process.argv[1]), root=process.argv[2];',
    'const s=new WorkflowStore(options); let dispatched=false;',
    'try {',
    '  await s.call({id:"second",stepId:"task",expectedRevision:1,tool:"read_text",arguments:{path:"fixture"}},{',
    '    validate:async()=>{},',
    '    dispatch:async()=>{dispatched=true;fs.writeFileSync(root+"/unexpected-effect.txt","bad");return{ok:true};}',
    '  });',
    '  console.log(JSON.stringify({code:"NONE",dispatched}));',
    '} catch(e) {',
    '  console.log(JSON.stringify({code:e.workflowCode??e.message,dispatched}));',
    '} finally {s.close();}'
  ].join('\n');
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,JSON.stringify(options),f.root],
    {encoding:'utf8',timeout:9000});
  assert.equal(child.status,0,child.stderr||String(child.error));
  const parsed=JSON.parse(child.stdout.trim());
  assert.equal(parsed.code,'WORKFLOW_ROOT_LEASED');
  assert.equal(parsed.dispatched,false);
  assert.equal(fs.existsSync(path.join(f.root,'unexpected-effect.txt')),false);
 }finally{a.close();b?.close();f.cleanup();}
});

test('finalization cannot mark an orphaned uncertain effect COMPLETED after APPLIED evidence',async()=>{
 const f=fixture(),a=f.store('alpha');
 try{
  create(a,'first',f.root);
  fs.writeFileSync(path.join(f.root,'proof.txt'),'independent proof');
  const execution=await call(a,'first',async()=>({timedOut:true,exitCode:null}));
  assert.equal(execution.outcome,'UNCERTAIN');
  const checked=await a.reconcileAutomatically('first',{verify:async()=>({status:'APPLIED',summary:'Observed post-state'})});
  assert.equal(checked.status,'APPLIED');
  assert.equal(a.rootLeaseStatus(f.root).blocking,true);
  const revision=a.get('first').state.revision;
  assert.throws(()=>a.finalize({id:'first',expectedRevision:revision,acceptanceResults:[true],
   files:['proof.txt'],summary:'Independent evidence seen'}),
   /WORKFLOW_ROOT_LEASED|WORKFLOW_ROOT_LEASE_EXPIRED_RECONCILIATION_REQUIRED/);
  const after=a.get('first').state;
  assert.equal(after.revision,revision);
  assert.notEqual(after.lifecycleState,'COMPLETED');
  assert.notEqual(after.acceptanceStatus,'PASS');
 }finally{a.close();f.cleanup();}
});

test('finalization refuses foreign expired lease and preserves acceptance state',async()=>{
 const f=fixture(),a=f.store('alpha');
 try {
  create(a,'first',f.root);
  fs.writeFileSync(path.join(f.root,'proof.txt'),'success proof');
  const done=await call(a,'first',async()=>({ok:true}));
  assert.equal(done.outcome,'RECORDED_NOT_VALIDATED');
  const db=new DatabaseSync(path.join(f.shared,'root-leases.sqlite'));
  try {
    db.prepare('INSERT INTO root_leases(root,profile,workflow,owner,expires_at,revision) VALUES(?,?,?,?,?,?)').run(
      process.platform==='win32'?path.resolve(f.root).toLowerCase():path.resolve(f.root),
      'beta','other','foreign-expired','1970-01-01T00:00:00.000Z',1);
  }finally{db.close();}
  const version=a.get('first').state.revision;
  assert.throws(()=>a.finalize({id:'first',expectedRevision:version,
    acceptanceResults:[true],files:['proof.txt'],summary:'Should not finalize'}),
    /WORKFLOW_ROOT_LEASE_EXPIRED_RECONCILIATION_REQUIRED/);
  assert.equal(a.get('first').state.revision,version);
  assert.equal(a.get('first').state.acceptanceStatus,'UNVALIDATED');
  assert.equal(a.rootLeaseStatus(f.root).blocking,true);
 } finally {a.close();f.cleanup();}
});

test('successful completed shared-root dispatch can still finalize normally',async()=>{
 const f=fixture(),a=f.store('alpha');
 try {
  create(a,'first',f.root);
  fs.writeFileSync(path.join(f.root,'proof.txt'),'valid proof');
  const done=await call(a,'first',async()=>({ok:true}));
  assert.equal(done.outcome,'RECORDED_NOT_VALIDATED');
  assert.equal(a.rootLeaseStatus(f.root).blocking,false);
  const state=a.get('first').state;
  const final=a.finalize({id:'first',expectedRevision:state.revision,
   acceptanceResults:[true],files:['proof.txt'],summary:'Verified complete'});
  assert.equal(final.state.lifecycleState,'COMPLETED');
  assert.equal(final.state.acceptanceStatus,'PASS');
 }finally{a.close();f.cleanup();}
});

test('reconciliation preflight binds orphaned lease to stable operation evidence after restart',async()=>{
 const f=fixture();let a=f.store('alpha'),b=f.store('beta');
 try{
  create(a,'first',f.root);create(b,'second',f.root);
  const operation=await call(a,'first',async()=>({timedOut:true,exitCode:null}));
  assert.equal(operation.outcome,'UNCERTAIN');
  const revision=a.get('first').state.revision;
  const before=a.reconciliationPreflight('first');
  assert.equal(before.status,'CESSATION_EVIDENCE_REQUIRED');
  assert.equal(before.releaseEligible,false);
  assert.equal(before.lease.blocking,true);
  assert.equal(before.lease.storeFingerprint,a.leaseStoreFingerprint());
  assert.match(before.lease.fingerprint,/^[a-f0-9]{64}$/);
  assert.match(before.rootFingerprint,/^[a-f0-9]{64}$/);
  assert.deepEqual(before.operations.map(x=>x.operationId),[operation.operation.operationId]);
  assert.ok(before.requiredEvidence.includes('verified_process_tree_cessation'));
  assert.equal(before.outcomeVerificationIsCessationProof,false);
  assert.ok(!JSON.stringify(before).includes('owner'));
  assert.ok(!JSON.stringify(before).includes(f.root));
  assert.equal(a.get('first').state.revision,revision);
  const foreign=b.reconciliationPreflight('second');
  assert.equal(foreign.status,'FOREIGN_LEASE_BLOCKING');
  assert.equal(foreign.operations.length,0);
  assert.equal(foreign.lease.fingerprint,b.rootLeaseStatus(f.root).leaseFingerprint);
  a.close();a=f.store('alpha');
  assert.deepEqual(a.reconciliationPreflight('first'),before);
  const applied=await a.reconcileAutomatically('first',{verify:async()=>({status:'APPLIED',summary:'post-state verified'})});
  assert.equal(applied.status,'APPLIED');
  const after=a.reconciliationPreflight('first');
  assert.equal(after.releaseEligible,false);
  assert.equal(after.status,'CESSATION_EVIDENCE_REQUIRED');
  assert.equal(after.operations[0].outcomeState,'reconciled_applied');
  assert.equal(after.lease.fingerprint,before.lease.fingerprint);
 }finally{a.close();b.close();f.cleanup();}
});

test('reconciliation preflight for unleased workflow cannot invent a release permission',()=>{
 const f=fixture(),a=f.store('alpha');
 try{
  create(a,'first',f.root);
  const before=a.reconciliationPreflight('first');
  assert.equal(before.status,'NO_BLOCKING_LEASE');
  assert.equal(before.releaseEligible,false);
  assert.equal(before.operations.length,0);
  assert.equal(before.lease.fingerprint,null);
  assert.equal(a.get('first').state.revision,1);
 }finally{a.close();f.cleanup();}
});

test('reconciliation preflight explicitly reports disabled one-writer enforcement',()=>{
 const f=fixture();
 const s=new WorkflowStore({directory:path.join(f.home,'unlocked'),allowedRoots:[f.root],
  device:'fixture',authority:{profileId:'unlocked'},configSha256:'a'.repeat(64),
  schedulerPolicy:{enabled:false,oneWriterPerRoot:false}});
 try{
  create(s,'first',f.root);
  const p=s.reconciliationPreflight('first');
  assert.equal(p.status,'ENFORCEMENT_DISABLED');
  assert.equal(p.enforcementEnabled,false);
  assert.equal(p.releaseEligible,false);
  assert.equal(p.lease.blocking,false);
 }finally{s.close();f.cleanup();}
});

test('preflight never attributes a replaced owner to an old operation in the same profile and workflow',async()=>{
 const f=fixture();let a=f.store('alpha');
 try {
  create(a,'first',f.root);
  const outcome=await call(a,'first',async()=>({timedOut:true,exitCode:null}));
  assert.equal(outcome.outcome,'UNCERTAIN');
  const expected=a.reconciliationPreflight('first');
  assert.deepEqual(expected.operations.map(o=>o.operationId),[outcome.operation.operationId]);
  const db=new DatabaseSync(path.join(f.shared,'root-leases.sqlite'));
  try {
   const old=db.prepare('SELECT owner FROM root_leases').get().owner;
   const [worker,operation]=old.split(':');
   const forged=worker+':'+operation.slice(0,-1)+(operation.endsWith('0')?'1':'0');
   db.prepare('UPDATE root_leases SET owner=?').run(forged);
   assert.notEqual(db.prepare('SELECT owner FROM root_leases').get().owner,old);
  } finally {db.close();}
  const mismatched=a.reconciliationPreflight('first');
  assert.equal(mismatched.status,'UNATTRIBUTED_LEASE_BLOCKING');
  assert.equal(mismatched.lease.blocking,true);
  assert.equal(mismatched.releaseEligible,false);
  assert.deepEqual(mismatched.operations,[]);
  a.close();a=f.store('alpha');
  assert.equal(a.reconciliationPreflight('first').status,'UNATTRIBUTED_LEASE_BLOCKING');
  assert.deepEqual(a.reconciliationPreflight('first').operations,[]);
 }finally{a.close();f.cleanup();}
});

test('preflight selects only operation that actually owns current lease, excluding completed prior steps',async()=>{
 const f=fixture(),a=f.store('alpha');
 try {
  a.create({id:'multi',root:f.root,goal:'Two-step fixture',acceptance:['Safe operations'],
    steps:[{id:'task',title:'First'},{id:'next',title:'Second'}]});
  const first=await call(a,'multi',async()=>({ok:true}));
  assert.equal(first.outcome,'RECORDED_NOT_VALIDATED');
  const version=a.get('multi').state.revision;
  const later=await a.call({id:'multi',stepId:'next',expectedRevision:version,
    tool:'read_text',arguments:{path:'another'}},
    {validate:async()=>{},dispatch:async()=>({timedOut:true,exitCode:null})});
  assert.equal(later.outcome,'UNCERTAIN');
  const preflight=a.reconciliationPreflight('multi');
  assert.equal(preflight.status,'CESSATION_EVIDENCE_REQUIRED');
  assert.deepEqual(preflight.operations.map(x=>x.operationId),[later.operation.operationId]);
  assert.deepEqual(preflight.operations.map(x=>x.stepId),['next']);
  assert.equal(preflight.operations.some(x=>x.operationId===first.operation.operationId),false);
 }finally{a.close();f.cleanup();}
});

test('preflight does not attribute forged lease owner to already completed earlier step',async()=>{
 const f=fixture(),a=f.store('alpha');
 try{
  a.create({id:'multi',root:f.root,goal:'Two phases',acceptance:['Completion safety'],
    steps:[{id:'task',title:'First'},{id:'next',title:'Second'}]});
  const first=await call(a,'multi',async()=>({ok:true}));
  assert.equal(first.outcome,'RECORDED_NOT_VALIDATED');
  const next=await a.call({id:'multi',stepId:'next',expectedRevision:a.get('multi').state.revision,
    tool:'read_text',arguments:{path:'another'}},
    {validate:async()=>{},dispatch:async()=>({timedOut:true,exitCode:null})});
  assert.equal(next.outcome,'UNCERTAIN');
  const db=new DatabaseSync(path.join(f.shared,'root-leases.sqlite'));
  try{
   const current=db.prepare('SELECT owner FROM root_leases').get().owner;
   const forged=current.split(':')[0]+':'+first.operation.operationId;
   db.prepare('UPDATE root_leases SET owner=?').run(forged);
  }finally{db.close();}
  const preview=a.reconciliationPreflight('multi');
  assert.equal(preview.status,'UNATTRIBUTED_LEASE_BLOCKING');
  assert.equal(preview.lease.blocking,true);
  assert.equal(preview.releaseEligible,false);
  assert.deepEqual(preview.operations,[]);
 }finally{a.close();f.cleanup();}
});

test('nonterminal asynchronous execution receipts never release the shared root lease',async()=>{
 for(const [label,result] of [
   ['queue',{status:'QUEUED',operationId:'native-queued-1',submitted:true}],
   ['running',{status:'RUNNING',operationId:'native-running-1',ok:true}],
   ['submitted',{submitted:true,operationId:'native-submitted-1'}],
   ['in-progress',{status:'IN_PROGRESS',operationId:'native-progress-1'}]
 ]) {
   const f=fixture();let a=f.store('alpha'),b=f.store('beta');
   try {
     create(a,'first',f.root);create(b,'second',f.root);
     const returned=await call(a,'first',async()=>result);
     assert.equal(returned.outcome,'UNCERTAIN',label);
     assert.equal(returned.receipt.errorCode,'WORKFLOW_DEFERRED_EFFECT_UNVERIFIED',label);
     assert.equal(a.get('first').state.steps[0].status,'uncertain',label);
     assert.equal(b.rootLeaseStatus(f.root).blocking,true,label);
     a.close();a=f.store('alpha');
     assert.equal(b.rootLeaseStatus(f.root).blocking,true,label);
     let started=0;
     await assert.rejects(call(b,'second',async()=>{started++;return {ok:true};}),
       /WORKFLOW_ROOT_LEASED|WORKFLOW_ROOT_LEASE_EXPIRED_RECONCILIATION_REQUIRED/,label);
     assert.equal(started,0,label);
   }finally{a.close();b.close();f.cleanup();}
 }
});

test('a definitive successful result still releases the lease for another workflow',async()=>{
 const f=fixture(),a=f.store('alpha'),b=f.store('beta');
 try {
   create(a,'first',f.root);create(b,'second',f.root);
   const first=await call(a,'first',async()=>({status:'SUCCEEDED',ok:true,exitCode:0}));
   assert.equal(first.outcome,'RECORDED_NOT_VALIDATED');
   assert.equal(a.rootLeaseStatus(f.root).blocking,false);
   const second=await call(b,'second',async()=>({ok:true}));
   assert.equal(second.outcome,'RECORDED_NOT_VALIDATED');
 }finally{a.close();b.close();f.cleanup();}
});

test('terminal negative, null and missing execution results are never successful root-lease receipts',async()=>{
 for(const [label,result] of [
   ['failed',{status:'FAILED',operationId:'native-failed'}],
   ['cancelled',{status:'CANCELLED',operationId:'native-cancelled'}],
   ['timed-out',{status:'TIMED_OUT',operationId:'native-timeout'}],
   ['rejected',{status:'REJECTED',operationId:'native-rejected'}],
   ['null',null],
   ['undefined',undefined]
 ]) {
   const f=fixture(),a=f.store('alpha'),b=f.store('beta');
   try {
     create(a,'first',f.root);create(b,'second',f.root);
     const r=await call(a,'first',async()=>result);
     assert.equal(r.outcome,'UNCERTAIN',label);
     assert.equal(r.receipt.errorCode,'WORKFLOW_EFFECT_COMPLETION_UNVERIFIED',label);
     assert.equal(b.rootLeaseStatus(f.root).blocking,true,label);
     let second=0;
     await assert.rejects(call(b,'second',async()=>{second++;return {ok:true};}),/WORKFLOW_ROOT_LEASED/,label);
     assert.equal(second,0,label);
   }finally{a.close();b.close();f.cleanup();}
 }
});

test('native UNCERTAIN and unrecognized operation status never release root lease',async()=>{
 for(const [name,result] of [
   ['native-uncertain',{status:'UNCERTAIN',operationId:'native-unknown-1'}],
   ['cancel-requested',{status:'CANCEL_REQUESTED',operationId:'native-unknown-2'}],
   ['unknown-future-status',{status:'RECONCILING',operationId:'native-unknown-3'}],
   ['nested-state-uncertain',{state:{status:'UNCERTAIN'},operationId:'native-unknown-4'}]
 ]) {
   const f=fixture(),a=f.store('alpha'),b=f.store('beta');
   try{
     create(a,'first',f.root);create(b,'second',f.root);
     const out=await call(a,'first',async()=>result);
     assert.equal(out.outcome,'UNCERTAIN',name);
     assert.equal(out.receipt.errorCode,'WORKFLOW_EFFECT_COMPLETION_UNVERIFIED',name);
     assert.equal(b.rootLeaseStatus(f.root).blocking,true,name);
     let effects=0;
     await assert.rejects(call(b,'second',async()=>{effects++;return{ok:true};}),/WORKFLOW_ROOT_LEASED/,name);
     assert.equal(effects,0,name);
   }finally{a.close();b.close();f.cleanup();}
 }
});

test('nested durable operation_result must include a definitive successful execution receipt',async()=>{
 for(const [name,returned] of [
  ['missing-final-receipt',{state:{status:'SUCCEEDED',operationId:'native-1'},result:null}],
  ['nested-command-error',{state:{status:'SUCCEEDED',operationId:'native-2'},result:{exitCode:1}}],
  ['nested-result-error',{state:{status:'SUCCEEDED',operationId:'native-3'},result:{isError:true}}],
  ['nested-task-queued',{state:{status:'SUCCEEDED',operationId:'native-4'},result:{status:'QUEUED',operationId:'child-native-4'}}]
 ]) {
  const f=fixture(),a=f.store('alpha'),b=f.store('beta');
  try{
    create(a,'first',f.root);create(b,'second',f.root);
    const out=await call(a,'first',async()=>returned);
    assert.equal(out.outcome,'UNCERTAIN',name);
    assert.equal(out.receipt.errorCode,'WORKFLOW_EFFECT_COMPLETION_UNVERIFIED',name);
    assert.equal(b.rootLeaseStatus(f.root).blocking,true,name);
    assert.ok(b.resume('second').blockers.includes('WORKFLOW_ROOT_LEASED'),name);
  }finally{a.close();b.close();f.cleanup();}
 }
});

test('nested durable operation_result with verified success preserves normal release',async()=>{
 const f=fixture(),a=f.store('alpha'),b=f.store('beta');
 try{
   create(a,'first',f.root);create(b,'second',f.root);
   const out=await call(a,'first',async(_tool,_args,context)=>({
      state:{status:'SUCCEEDED',operationId:'native-success',requestId:context.steps[0].operationId},
      result:{operationId:'native-success',ok:true,exitCode:0}
   }));
   assert.equal(out.outcome,'RECORDED_NOT_VALIDATED');
   assert.equal(b.rootLeaseStatus(f.root).blocking,false);
 }finally{a.close();b.close();f.cleanup();}
});


test('orphan release is unavailable without a host-injected native cessation verifier',async()=>{
 const f=fixture(),a=f.store('alpha'),b=f.store('beta');
 try {
  create(a,'first',f.root);create(b,'second',f.root);
  assert.equal((await call(a,'first',async()=>({timedOut:true,exitCode:null}))).outcome,'UNCERTAIN');
  const p=a.reconciliationPreflight('first');
  assert.equal(p.releaseEligible,false);
  await assert.rejects(a.reconcileOrphanLease({id:'first',expectedRevision:p.revision,
   expectedLeaseFingerprint:p.lease.fingerprint,expectedRootFingerprint:p.rootFingerprint,
   expectedLeaseStoreFingerprint:p.lease.storeFingerprint}),/WORKFLOW_NATIVE_CESSATION_VERIFIER_UNAVAILABLE/);
  assert.equal(b.rootLeaseStatus(f.root).blocking,true);
 }finally{a.close();b.close();f.cleanup();}
});

test('CAS orphan release requires matching identity-bound native proof and appends immutable audit',async()=>{
 const f=fixture();let calls=0;
 const a=f.store('alpha',{verifyNativeCessation:async(snapshot)=>{
  calls++;
  assert.equal(snapshot.status,'CESSATION_EVIDENCE_REQUIRED');
  assert.equal(snapshot.operations.length,1);
  return {verified:true,externalEffectsFenced:true,processTreeStopped:true,allDescendantsStopped:true,
   witness:'V1-02_TEST_INJECTED_VERIFIER',attestationId:'native-test-witness-1',
   operationId:snapshot.operations[0].operationId,rootFingerprint:snapshot.rootFingerprint,
   leaseFingerprint:snapshot.lease.fingerprint,leaseStoreFingerprint:snapshot.lease.storeFingerprint,
   verifiedAt:new Date().toISOString()};
 }});
 const b=f.store('beta');
 try{
  create(a,'first',f.root);create(b,'second',f.root);
  assert.equal((await call(a,'first',async()=>({timedOut:true,exitCode:null}))).outcome,'UNCERTAIN');
  expireDatabase(f);
  const p=a.reconciliationPreflight('first');
  assert.equal(p.lease.expired,true);
  const input={id:'first',expectedRevision:p.revision,expectedLeaseFingerprint:p.lease.fingerprint,
   expectedRootFingerprint:p.rootFingerprint,expectedLeaseStoreFingerprint:p.lease.storeFingerprint};
  const released=await a.reconcileOrphanLease(input);
  assert.equal(calls,1);
  assert.equal(released.released,true);
  assert.equal(released.operationId,p.operations[0].operationId);
  assert.equal(a.rootLeaseStatus(f.root).blocking,false);
  const db=new DatabaseSync(path.join(f.shared,'root-leases.sqlite'));
  try{
   const rows=db.prepare('SELECT operation_id, attestation_digest FROM root_lease_release_evidence').all();
   assert.equal(rows.length,1);
   assert.equal(rows[0].operation_id,released.operationId);
   assert.match(rows[0].attestation_digest,/^[a-f0-9]{64}$/);
   assert.throws(()=>db.prepare('DELETE FROM root_lease_release_evidence').run(),/APPEND_ONLY/);
  }finally{db.close();}
  const next=await call(b,'second',async()=>({ok:true}));
  assert.equal(next.outcome,'RECORDED_NOT_VALIDATED');
  await assert.rejects(a.reconcileOrphanLease(input),/WORKFLOW_ROOT_LEASE_CAS_MISMATCH|WORKFLOW_ROOT_LEASE_NOT_PRESENT/);
 }finally{a.close();b.close();f.cleanup();}
});

test('CAS orphan release rejects mismatched, stale and unverified attestations',async()=>{
 for(const [caseName,modify] of [
  ['wrong-operation',proof=>({...proof,operationId:'00000000-0000-4000-8000-000000000000'})],
  ['wrong-root',proof=>({...proof,rootFingerprint:'0'.repeat(64)})],
  ['wrong-lease',proof=>({...proof,leaseFingerprint:'0'.repeat(64)})],
  ['no-cessation',proof=>({...proof,allDescendantsStopped:false})],
  ['stale-proof',proof=>({...proof,verifiedAt:'2000-01-01T00:00:00.000Z'})],
 ]) {
  const f=fixture(),a=f.store('alpha',{verifyNativeCessation:async snapshot=>modify({
    verified:true,externalEffectsFenced:true,processTreeStopped:true,allDescendantsStopped:true,
    witness:'V1-02_TEST_INJECTED_VERIFIER',attestationId:'native-test-witness',
    operationId:snapshot.operations[0].operationId,rootFingerprint:snapshot.rootFingerprint,
    leaseFingerprint:snapshot.lease.fingerprint,leaseStoreFingerprint:snapshot.lease.storeFingerprint,
    verifiedAt:new Date().toISOString()
  })});
  try{
   create(a,'first',f.root);
   assert.equal((await call(a,'first',async()=>({timedOut:true,exitCode:null}))).outcome,'UNCERTAIN');
   const p=a.reconciliationPreflight('first');
   await assert.rejects(a.reconcileOrphanLease({id:'first',expectedRevision:p.revision,
    expectedLeaseFingerprint:p.lease.fingerprint,expectedRootFingerprint:p.rootFingerprint,
    expectedLeaseStoreFingerprint:p.lease.storeFingerprint}),/WORKFLOW_CESSATION_NOT_VERIFIED/,caseName);
   assert.equal(a.rootLeaseStatus(f.root).blocking,true,caseName);
  }finally{a.close();f.cleanup();}
 }
});

test('CAS release refuses a changed lease during async verifier even with earlier valid proof',async()=>{
 const f=fixture();let proofCalled=false;
 const a=f.store('alpha',{verifyNativeCessation:async snapshot=>{
  proofCalled=true;
  const db=new DatabaseSync(path.join(f.shared,'root-leases.sqlite'));
  try{db.prepare('UPDATE root_leases SET revision=revision+1').run();}finally{db.close();}
  return {verified:true,externalEffectsFenced:true,processTreeStopped:true,allDescendantsStopped:true,
   witness:'V1-02_TEST_INJECTED_VERIFIER',attestationId:'native-test-witness-2',
   operationId:snapshot.operations[0].operationId,rootFingerprint:snapshot.rootFingerprint,
   leaseFingerprint:snapshot.lease.fingerprint,leaseStoreFingerprint:snapshot.lease.storeFingerprint,
   verifiedAt:new Date().toISOString()};
 }});
 try{
  create(a,'first',f.root);
  assert.equal((await call(a,'first',async()=>({timedOut:true,exitCode:null}))).outcome,'UNCERTAIN');
  const p=a.reconciliationPreflight('first');
  await assert.rejects(a.reconcileOrphanLease({id:'first',expectedRevision:p.revision,
   expectedLeaseFingerprint:p.lease.fingerprint,expectedRootFingerprint:p.rootFingerprint,
   expectedLeaseStoreFingerprint:p.lease.storeFingerprint}),/WORKFLOW_ROOT_LEASE_CAS_MISMATCH/);
  assert.equal(proofCalled,true);
  assert.equal(a.rootLeaseStatus(f.root).blocking,true);
 }finally{a.close();f.cleanup();}
});


test('trusted recovery bridge is host-only and never exposed through the public workflow tool catalog',async()=>{
 const f=fixture();
 const api=createWorkflowTools({
  config:{durableWorkflows:{enabled:true,directory:path.join(f.home,'api-workflows'),
    rootLeaseDirectory:f.shared,scheduler:{enabled:false,oneWriterPerRoot:true}}},
  roots:[f.root],device:'fixture',configSha256:'a'.repeat(64),
  lookup:name=>({name,inputSchema:{type:'object'}}),
  validateSchema:()=>[],dispatch:async()=>({ok:true})
 });
 try{
  assert.equal(typeof api.reconcileOrphanLeaseHostOnly,'function');
  assert.equal(Object.keys(api).includes('reconcileOrphanLeaseHostOnly'),false);
  assert.equal(api.definitions.some(d=>/reconcile_orphan_lease|lease_release/i.test(d.name)),false);
  await assert.rejects(api.execute('workflow_reconcile_orphan_lease',{}),/WORKFLOW_UNKNOWN_TOOL/);
  await assert.rejects(api.reconcileOrphanLeaseHostOnly({id:'first'}),/WORKFLOW_NATIVE_CESSATION_VERIFIER_UNAVAILABLE/);
 }finally{api.close();f.cleanup();}
});

test('trusted recovery bridge accepts only host-injected verified witness, not user tool arguments',async()=>{
 const f=fixture();
 const api=createWorkflowTools({
  config:{durableWorkflows:{enabled:true,directory:path.join(f.home,'api-workflows'),
    rootLeaseDirectory:f.shared,scheduler:{enabled:false,oneWriterPerRoot:true}}},
  roots:[f.root],device:'fixture',configSha256:'a'.repeat(64),
  lookup:name=>({name,inputSchema:{type:'object'}}),
  validateSchema:()=>[],dispatch:async()=>({timedOut:true,exitCode:null}),
  verifyNativeCessation:async snapshot=>({
    verified:true,externalEffectsFenced:true,processTreeStopped:true,allDescendantsStopped:true,
    witness:'V1-02_TEST_INJECTED_VERIFIER',attestationId:'native-bridge-witness-1',
    operationId:snapshot.operations[0].operationId,rootFingerprint:snapshot.rootFingerprint,
    leaseFingerprint:snapshot.lease.fingerprint,leaseStoreFingerprint:snapshot.lease.storeFingerprint,
    verifiedAt:new Date().toISOString()
  })
 });
 try{
  await api.execute('workflow_create',{id:'first',root:f.root,goal:'Recover',
    acceptance:['No overlap'],steps:[{id:'task',title:'Read once'}]});
  const done=await api.execute('workflow_call',{id:'first',stepId:'task',
    expectedRevision:1,tool:'read_text',arguments:{path:'fixture'}});
  assert.equal(done.outcome,'UNCERTAIN');
  const snapshot=await api.execute('workflow_reconciliation_preflight',{id:'first'});
  const released=await api.reconcileOrphanLeaseHostOnly({
    id:'first',expectedRevision:snapshot.revision,
    expectedLeaseFingerprint:snapshot.lease.fingerprint,
    expectedRootFingerprint:snapshot.rootFingerprint,
    expectedLeaseStoreFingerprint:snapshot.lease.storeFingerprint
  });
  assert.equal(released.released,true);
  assert.equal((await api.execute('workflow_reconciliation_preflight',{id:'first'})).lease.blocking,false);
 }finally{api.close();f.cleanup();}
});


test('CAS release rejects a changed workflow revision while the native verifier is awaiting',async()=>{
 const f=fixture(); let a;
 a=f.store('alpha',{verifyNativeCessation:async snapshot=>{
  const changed=a.control({id:'first',expectedRevision:snapshot.revision,action:'pause',reason:'Owner changed state during proof'});
  assert.equal(changed.state.revision,snapshot.revision+1);
  return {verified:true,externalEffectsFenced:true,processTreeStopped:true,allDescendantsStopped:true,
   witness:'V1-02_TEST_INJECTED_VERIFIER',attestationId:'native-test-revision-race',
   operationId:snapshot.operations[0].operationId,rootFingerprint:snapshot.rootFingerprint,
   leaseFingerprint:snapshot.lease.fingerprint,leaseStoreFingerprint:snapshot.lease.storeFingerprint,
   verifiedAt:new Date().toISOString()};
 }});
 try{
  create(a,'first',f.root);
  assert.equal((await call(a,'first',async()=>({timedOut:true,exitCode:null}))).outcome,'UNCERTAIN');
  const p=a.reconciliationPreflight('first');
  await assert.rejects(a.reconcileOrphanLease({id:'first',expectedRevision:p.revision,
   expectedLeaseFingerprint:p.lease.fingerprint,expectedRootFingerprint:p.rootFingerprint,
   expectedLeaseStoreFingerprint:p.lease.storeFingerprint}),/WORKFLOW_ROOT_LEASE_CAS_MISMATCH/);
  assert.equal(a.rootLeaseStatus(f.root).blocking,true);
  const db=new DatabaseSync(path.join(f.shared,'root-leases.sqlite'));
  try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM root_lease_release_evidence').get().n,0);}
  finally{db.close();}
 }finally{a.close();f.cleanup();}
});


test('successful effect with blocked lease cleanup reports an explicit retained-lease warning after restart',async()=>{
 const f=fixture();let a=f.store('alpha'),b=f.store('beta');
 const filename=path.join(f.shared,'root-leases.sqlite');
 try {
  create(a,'first',f.root);create(b,'second',f.root);
  const guard=new DatabaseSync(filename);
  try {guard.exec("CREATE TRIGGER fail_test_release BEFORE DELETE ON root_leases BEGIN SELECT RAISE(ABORT,'SIMULATED_RELEASE_FAILURE'); END");}
  finally{guard.close();}
  const outcome=await call(a,'first',async()=>({ok:true,exitCode:0}));
  assert.equal(outcome.outcome,'RECORDED_NOT_VALIDATED');
  assert.equal(outcome.leaseReleasePending,true);
  assert.equal(b.rootLeaseStatus(f.root).blocking,true);
  const before=a.reconciliationPreflight('first');
  assert.equal(before.status,'TERMINAL_RECEIPT_ORPHAN_LEASE');
  assert.deepEqual(before.operations,[]);
  assert.equal(before.releaseEligible,false);
  a.close();a=f.store('alpha');
  assert.equal(a.reconciliationPreflight('first').status,'TERMINAL_RECEIPT_ORPHAN_LEASE');
  let cachedDispatches=0;
  const cached=await call(a,'first',async()=>{cachedDispatches++;return{ok:true};});
  assert.equal(cached.cachedReceipt,true);
  assert.equal(cached.leaseReleasePending,true);
  assert.equal(cachedDispatches,0);
  let effects=0;
  await assert.rejects(call(b,'second',async()=>{effects++;return{ok:true};}),/WORKFLOW_ROOT_LEASED/);
  assert.equal(effects,0);
 }finally{
  try {const db=new DatabaseSync(filename);try{db.exec('DROP TRIGGER IF EXISTS fail_test_release');}finally{db.close();}}catch{}
  a.close();b.close();f.cleanup();
 }
});

test('ordinary successful dispatch explicitly confirms no pending root lease release',async()=>{
 const f=fixture(),a=f.store('alpha');
 try{
  create(a,'first',f.root);
  const out=await call(a,'first',async()=>({ok:true,exitCode:0}));
  assert.equal(out.outcome,'RECORDED_NOT_VALIDATED');
  assert.equal(out.leaseReleasePending,false);
  assert.equal(a.rootLeaseStatus(f.root).blocking,false);
  let cachedDispatches=0;
  const cached=await call(a,'first',async()=>{cachedDispatches++;return{ok:true};});
  assert.equal(cached.cachedReceipt,true);
  assert.equal(cached.leaseReleasePending,false);
  assert.equal(cachedDispatches,0);
 }finally{a.close();f.cleanup();}
});


test('terminal receipt orphan requires trusted native cessation proof before CAS release',async()=>{
 const f=fixture();
 const dbPath=path.join(f.shared,'root-leases.sqlite');
 let verified=0;
 const a=f.store('alpha',{verifyNativeCessation:async snapshot=>{
  verified++;
  assert.equal(snapshot.status,'TERMINAL_RECEIPT_ORPHAN_LEASE');
  assert.equal(snapshot.operations.length,1);
  return {verified:true,externalEffectsFenced:true,processTreeStopped:true,allDescendantsStopped:true,
   witness:'V1-02_TEST_INJECTED_VERIFIER',attestationId:'terminal-native-verified',
   operationId:snapshot.operations[0].operationId,rootFingerprint:snapshot.rootFingerprint,
   leaseFingerprint:snapshot.lease.fingerprint,leaseStoreFingerprint:snapshot.lease.storeFingerprint,
   verifiedAt:new Date().toISOString()};
 }});
 const b=f.store('beta');
 try{
  create(a,'first',f.root);create(b,'second',f.root);
  const guard=new DatabaseSync(dbPath);
  try {guard.exec("CREATE TRIGGER prevent_terminal_release BEFORE DELETE ON root_leases BEGIN SELECT RAISE(ABORT,'SIMULATED_CLEANUP_FAILURE'); END");}
  finally{guard.close();}
  const out=await call(a,'first',async()=>({ok:true,exitCode:0}));
  assert.equal(out.outcome,'RECORDED_NOT_VALIDATED');
  assert.equal(out.leaseReleasePending,true);
  assert.equal(b.rootLeaseStatus(f.root).blocking,true);
  const preview=a.reconciliationPreflight('first');
  assert.equal(preview.status,'TERMINAL_RECEIPT_ORPHAN_LEASE');
  assert.equal(preview.releaseEligible,false);
  const input={id:'first',expectedRevision:preview.revision,
   expectedLeaseFingerprint:preview.lease.fingerprint,
   expectedRootFingerprint:preview.rootFingerprint,
   expectedLeaseStoreFingerprint:preview.lease.storeFingerprint};
  await assert.rejects(a.reconcileOrphanLease(input),/SIMULATED_CLEANUP_FAILURE/);
  assert.equal(b.rootLeaseStatus(f.root).blocking,true);
  const remove=new DatabaseSync(dbPath);
  try{remove.exec('DROP TRIGGER prevent_terminal_release');}finally{remove.close();}
  const released=await a.reconcileOrphanLease(input);
  assert.equal(released.released,true);
  assert.equal(verified,2);
  assert.equal(b.rootLeaseStatus(f.root).blocking,false);
  const next=await call(b,'second',async()=>({ok:true}));
  assert.equal(next.outcome,'RECORDED_NOT_VALIDATED');
 }finally{
  try{const cleanup=new DatabaseSync(dbPath);try{cleanup.exec('DROP TRIGGER IF EXISTS prevent_terminal_release');}finally{cleanup.close();}}catch{}
  a.close();b.close();f.cleanup();
 }
});

test('terminal orphan cannot be released with missing native verifier even after completed receipt',async()=>{
 const f=fixture(),a=f.store('alpha');
 const dbPath=path.join(f.shared,'root-leases.sqlite');
 try{
  create(a,'first',f.root);
  const guard=new DatabaseSync(dbPath);
  try{guard.exec("CREATE TRIGGER prevent_terminal_release BEFORE DELETE ON root_leases BEGIN SELECT RAISE(ABORT,'SIMULATED_CLEANUP_FAILURE'); END");}
  finally{guard.close();}
  const out=await call(a,'first',async()=>({ok:true,exitCode:0}));
  assert.equal(out.leaseReleasePending,true);
  const preview=a.reconciliationPreflight('first');
  assert.equal(preview.status,'TERMINAL_RECEIPT_ORPHAN_LEASE');
  await assert.rejects(a.reconcileOrphanLease({id:'first',expectedRevision:preview.revision,
   expectedLeaseFingerprint:preview.lease.fingerprint,
   expectedRootFingerprint:preview.rootFingerprint,
   expectedLeaseStoreFingerprint:preview.lease.storeFingerprint}),
   /WORKFLOW_NATIVE_CESSATION_VERIFIER_UNAVAILABLE/);
  assert.equal(a.rootLeaseStatus(f.root).blocking,true);
 }finally{
  try{const cleanup=new DatabaseSync(dbPath);try{cleanup.exec('DROP TRIGGER IF EXISTS prevent_terminal_release');}finally{cleanup.close();}}catch{}
  a.close();f.cleanup();
 }
});

test('host dispatch receives the persisted running intent and cannot mutate its durable snapshot',async()=>{
  const f=fixture(), a=f.store('alpha');
  let observed=null;
  try{
    create(a,'first',f.root);
    const result=await call(a,'first',async(tool,args,context)=>{
      const persisted=a.get('first').state;
      const received=context.steps.find(step=>step.id==='task');
      const durable=persisted.steps.find(step=>step.id==='task');
      assert.equal(tool,'read_text');
      assert.deepEqual(args,{path:'fixture'});
      assert.equal(context.revision,persisted.revision);
      assert.equal(received.status,'running');
      assert.equal(received.operationId,durable.operationId);
      assert.equal(received.attemptId,durable.attemptId);
      assert.equal(received.idempotencyKey,durable.idempotencyKey);
      assert.equal(received.ownerPid,process.pid);
      assert.match(received.operationId,/^[0-9a-f-]{36}$/);
      observed=received.operationId;
      received.operationId='mutated-dispatch-copy';
      assert.equal(a.get('first').state.steps[0].operationId,observed);
      return {ok:true};
    });
    assert.equal(result.outcome,'RECORDED_NOT_VALIDATED');
    assert.ok(observed);
    assert.equal(result.operation.operationId,observed);
    assert.equal(a.get('first').state.steps[0].operationId,observed);
  }finally{a.close();f.cleanup();}
});

// R78 union: R77's independent external-effect fence is mandatory, even when
// all earlier R67 process-tree/identity fields are supplied by a trusted fixture.
test('R78 union refuses missing, false or string external-effect fences without deleting the exact lease',async()=>{
 for(const flag of [undefined,false,'true']){
  const f=fixture();
  const a=f.store('alpha',{verifyNativeCessation:async snapshot=>({
   verified:true,externalEffectsFenced:flag,processTreeStopped:true,allDescendantsStopped:true,
   witness:'V1-02_TEST_FENCE_NEGATIVE',attestationId:'r78-fence-negative',
   operationId:snapshot.operations[0].operationId,rootFingerprint:snapshot.rootFingerprint,
   leaseFingerprint:snapshot.lease.fingerprint,leaseStoreFingerprint:snapshot.lease.storeFingerprint,
   verifiedAt:new Date().toISOString()
  })});
  try{
   create(a,'first',f.root);
   const outcome=await call(a,'first',async()=>({timedOut:true,exitCode:null}));
   assert.equal(outcome.outcome,'UNCERTAIN');
   const p=a.reconciliationPreflight('first');
   await assert.rejects(a.reconcileOrphanLease({id:'first',expectedRevision:p.revision,
    expectedLeaseFingerprint:p.lease.fingerprint,expectedRootFingerprint:p.rootFingerprint,
    expectedLeaseStoreFingerprint:p.lease.storeFingerprint}),/WORKFLOW_CESSATION_NOT_VERIFIED/);
   assert.equal(a.rootLeaseStatus(f.root).leaseFingerprint,p.lease.fingerprint);
   const db=new DatabaseSync(path.join(f.shared,'root-leases.sqlite'));
   try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM root_lease_release_evidence').get().n,0);}
   finally{db.close();}
  }finally{a.close();f.cleanup();}
 }
});
