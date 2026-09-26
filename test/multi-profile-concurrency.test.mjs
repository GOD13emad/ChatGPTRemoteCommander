import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { WorkflowStore } from '../src/workflow-store.mjs';
import { MutationIdempotencyStore } from '../src/mutation-idempotency.mjs';
import { DeliveryStore } from '../src/delivery-store.mjs';
import { buildProfileInstance } from '../src/profile-instances.mjs';

function temp(prefix='rc-cross-profile-'){return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),prefix)));}
function options(root,directory,leaseDirectory,profile){
  return {
    directory,rootLeaseDirectory:leaseDirectory,allowedRoots:[root],device:'fixture',
    configSha256:'1'.repeat(64),
    authority:{profileId:profile,tier:'FULL_POWER',capabilities:['filesystem.full','workflow.durable','workflow.scheduler']},
    schedulerPolicy:{enabled:true,resumeInterrupted:true,resumeAfterRestart:true,resumeAfterUpdate:true,oneWriterPerRoot:true,maxConcurrentProjects:1,leaseMs:5000,intervalMs:1000,retryBudget:3}
  };
}
const host=dispatch=>({validate:async()=>{},dispatch});
function create(store,id,root){return store.create({id,root,goal:'cross-profile proof',acceptance:['one writer'],steps:[{id:'write',title:'Write once'}]});}

test('machine-global root lease blocks a second profile on the same project root and releases after completion',async()=>{
  const root=temp(), project=path.join(root,'project'), shared=path.join(root,'shared');
  fs.mkdirSync(project);
  const a=new WorkflowStore(options(root,path.join(root,'profile-a'),shared,'profile-a'));
  const b=new WorkflowStore(options(root,path.join(root,'profile-b'),shared,'profile-b'));
  try{
    create(a,'flowa',project);create(b,'flowb',project);
    let entered;const started=new Promise(r=>entered=r);let release;const held=new Promise(r=>release=r);
    const first=a.call({id:'flowa',stepId:'write',expectedRevision:1,tool:'write_text',arguments:{path:path.join(project,'a.txt'),content:'a'}},
      host(async()=>{entered();await held;return{ok:true};}));
    await started;
    let bEffects=0;
    await assert.rejects(
      b.call({id:'flowb',stepId:'write',expectedRevision:1,tool:'write_text',arguments:{path:path.join(project,'b.txt'),content:'b'}},
        host(async()=>{bEffects++;return{ok:true};})),
      /WORKFLOW_ROOT_LEASED/
    );
    assert.equal(bEffects,0);
    assert.equal(b.get('flowb').state.revision,1);
    assert.equal(a.schedulerStatus().currentLeases,1);
    assert.equal(b.schedulerStatus().currentLeases,1);
    release();await first;
    assert.equal(a.schedulerStatus().currentLeases,0);
    const second=await b.call({id:'flowb',stepId:'write',expectedRevision:1,tool:'write_text',arguments:{path:path.join(project,'b.txt'),content:'b'}},
      host(async()=>{bEffects++;return{ok:true};}));
    assert.equal(second.outcome,'RECORDED_NOT_VALIDATED');
    assert.equal(bEffects,1);
  }finally{a.close();b.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('machine-global root lease permits independent roots to execute concurrently',async()=>{
  const root=temp(), p1=path.join(root,'p1'),p2=path.join(root,'p2'),shared=path.join(root,'shared');
  fs.mkdirSync(p1);fs.mkdirSync(p2);
  const a=new WorkflowStore(options(root,path.join(root,'a'),shared,'profile-a'));
  const b=new WorkflowStore(options(root,path.join(root,'b'),shared,'profile-b'));
  try{
    create(a,'flowa',p1);create(b,'flowb',p2);
    let releaseA;const heldA=new Promise(r=>releaseA=r);let enteredA;const startA=new Promise(r=>enteredA=r);
    const first=a.call({id:'flowa',stepId:'write',expectedRevision:1,tool:'write_text',arguments:{path:path.join(p1,'a.txt'),content:'a'}},
      host(async()=>{enteredA();await heldA;return{ok:true};}));
    await startA;
    const second=await b.call({id:'flowb',stepId:'write',expectedRevision:1,tool:'write_text',arguments:{path:path.join(p2,'b.txt'),content:'b'}},
      host(async()=>({ok:true})));
    assert.equal(second.outcome,'RECORDED_NOT_VALIDATED');
    releaseA();await first;
  }finally{a.close();b.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('concurrent same mutation requestId produces one effect and later retry reuses durable success',async()=>{
  const root=temp();let effects=0;const store=new MutationIdempotencyStore({directory:path.join(root,'mut'),scope:'profile-a'});
  try{
    let release;const held=new Promise(r=>release=r);let entered;const started=new Promise(r=>entered=r);
    const input={id:'term',input:'x'};
    const first=store.execute({requestId:'same-req',tool:'send_terminal',input},async()=>{effects++;entered();await held;return{ok:true,effects};});
    await started;
    await assert.rejects(
      store.execute({requestId:'same-req',tool:'send_terminal',input},async()=>{effects++;return{ok:true,effects};}),
      /MUTATION_OUTCOME_UNCERTAIN/
    );
    assert.equal(effects,1);
    release();const result=await first;
    assert.deepEqual(result,{ok:true,effects:1});
    const retry=await store.execute({requestId:'same-req',tool:'send_terminal',input},async()=>{effects++;return{ok:true,effects};});
    assert.deepEqual(retry,result);assert.equal(effects,1);
  }finally{store.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('profile delivery scopes do not leak event metadata or claim authority',()=>{
  const root=temp(),dir=path.join(root,'delivery');
  const a=new DeliveryStore({directory:dir,scope:'profile-a'});
  const b=new DeliveryStore({directory:dir,scope:'profile-b'});
  try{
    const item=a.publish({eventKey:'same-project:done',correlationId:'chat-a',source:'project',sourceId:'run-a',kind:'COMPLETED'});
    assert.throws(()=>b.get(item.deliveryId,'chat-a'),/DELIVERY_NOT_FOUND|DELIVERY_CORRELATION_MISMATCH/);
    assert.throws(()=>b.claim({deliveryId:item.deliveryId,correlationId:'chat-a',attemptId:'b-attempt'}),/DELIVERY_NOT_FOUND|DELIVERY_CORRELATION_MISMATCH/);
    assert.equal(b.list({correlationId:'chat-a'}).items.length,0);
  }finally{a.close();b.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('profile builder derives the same machine-global lease directory for isolated profiles',()=>{
  const root=temp(),machine=path.join(root,'machine'),instances=path.join(machine,'instances');
  const project=path.join(root,'project');fs.mkdirSync(project,{recursive:true});
  const base={
    allowedRoots:[project],allowedPrograms:['node'],
    powerMode:{enabled:true,fullFilesystem:true,allowShell:true,allowProcessControl:true,allowPermanentDelete:true,
      guiControl:{enabled:false,allowScreenshot:true,allowMouse:true,allowKeyboard:true,allowWindowFocus:true}},
    durableWorkflows:{enabled:true,scheduler:{enabled:true,oneWriterPerRoot:true,maxConcurrentProjects:1}}
  };
  try{
    const a=buildProfileInstance({baseConfig:base,profile:'a',port:48001,stateDirectory:path.join(instances,'a'),allowedRoots:[project],powerMode:true});
    const b=buildProfileInstance({baseConfig:base,profile:'b',port:48002,stateDirectory:path.join(instances,'b'),allowedRoots:[project],powerMode:true});
    const expected=path.join(machine,'shared','root-leases');
    assert.equal(a.config.durableWorkflows.rootLeaseDirectory,expected);
    assert.equal(b.config.durableWorkflows.rootLeaseDirectory,expected);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('candidate config pins shared lease directory under the supplied machine state root',()=>{
  const root=temp(),state=path.join(root,'state'),runtime=path.join(root,'runtime'),workflow=path.join(root,'workflow'),out=path.join(root,'candidate.json');
  fs.mkdirSync(state,{recursive:true});fs.mkdirSync(runtime,{recursive:true});fs.mkdirSync(workflow,{recursive:true});
  const project=path.join(root,'project');fs.mkdirSync(project);
  const defaults={
    host:'127.0.0.1',port:47831,allowedRoots:[project],allowedPrograms:['node'],
    powerMode:{enabled:false,fullFilesystem:false,allowShell:false,allowProcessControl:false,allowPermanentDelete:false,guiControl:{enabled:false}},
    durableWorkflows:{enabled:true,directory:workflow,scheduler:{enabled:true,oneWriterPerRoot:true,maxConcurrentProjects:1}}
  };
  const defaultPath=path.join(root,'default.json');fs.writeFileSync(defaultPath,JSON.stringify(defaults));
  try{
    const run=spawnSync(process.execPath,['tools/build-candidate-config.mjs','--default',defaultPath,'--output',out,'--profile-id','default','--port','48010','--state-dir',runtime,'--workflow-dir',workflow,'--provider-root',state],{cwd:path.resolve('.'),encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    const cfg=JSON.parse(fs.readFileSync(out,'utf8'));
    assert.equal(cfg.durableWorkflows.rootLeaseDirectory,path.join(state,'shared','root-leases'));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
