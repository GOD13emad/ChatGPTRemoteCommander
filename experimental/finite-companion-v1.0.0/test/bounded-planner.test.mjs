import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports}from'node:module';
import {createHash}from'node:crypto';
import {createBoundedPlanner}from'../src/bounded-planner.mjs';

// Builtin seams are mocked: this suite creates no files and launches no process.
const ROOT='C:\\pure-planner-fixture',BYTES=Buffer.from('pure image pin fixture'),SHA=createHash('sha256').update(BYTES).digest('hex');
const context=()=>({schema:1,bindingSha256:'a'.repeat(64),workflowId:'saeed_companion',runId:'finite_run',owner:'saeed',authorizationSha256:'b'.repeat(64),currentStep:'observe_status',choices:['CONTINUE_STEP','STOP'],budget:{remainingAttempts:2,remainingPlannerCalls:2,callsPerPlan:1,workerCallsPerPlan:0}});
function harness(t,{mkdirFailure=false}={}){
 const events=[],files=new Map(),fds=new Map();let nextFd=1,spawnCalls=0;
 const stat=(file)=>({isDirectory:()=>file===ROOT,isFile:()=>file!==ROOT,isSymbolicLink:()=>false,nlink:1,size:files.get(file)?.length??BYTES.length,dev:1,ino:1,mtimeMs:0});
 t.mock.method(fs,'lstatSync',stat);t.mock.method(fs,'readdirSync',()=>[]);t.mock.method(fs,'readFileSync',file=>typeof file==='number'?files.get(fds.get(file)):BYTES);
 t.mock.method(fs,'mkdirSync',file=>{events.push('mkdir');if(mkdirFailure)throw Object.assign(Error('fixture denied'),{code:'EACCES'});});
 t.mock.method(fs,'openSync',(file)=>{events.push('open:'+file.split('\\').at(-1));const fd=nextFd++;fds.set(fd,file);files.set(file,Buffer.alloc(0));return fd;});
 t.mock.method(fs,'writeFileSync',(fd,bytes)=>{files.set(fds.get(fd),Buffer.from(bytes));events.push('write:'+fds.get(fd).split('\\').at(-1));});
 t.mock.method(fs,'fsyncSync',()=>{});t.mock.method(fs,'fstatSync',fd=>stat(fds.get(fd)));t.mock.method(fs,'closeSync',()=>{});
 t.mock.method(childProcess,'spawn',()=>{spawnCalls++;events.push('spawn-BLOCKED');throw Object.assign(Error('no real process allowed'),{code:'MOCK_SPAWN_DENIED'});});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const planner=createBoundedPlanner({recordRoot:ROOT,helper:'C:\\pure-helper.exe',helperSha256:SHA,executable:'C:\\pure-codex.exe',executableSha256:SHA});
 return {planner,events,files,spawnCalls:()=>spawnCalls};
}
test('invalid extra instruction is denied before reservation or side effects',{concurrency:false},async t=>{const h=harness(t);await assert.rejects(h.planner.plan({...context(),instructions:'unsafe'}));assert.equal(h.planner.describe().calls,0);assert.equal(h.spawnCalls(),0);assert.deepEqual(h.events,[]);});
test('getter context is denied without accessing or reserving',{concurrency:false},async t=>{const h=harness(t);let reads=0;const value=context();Object.defineProperty(value,'schema',{get(){reads++;return 1;},enumerable:true});await assert.rejects(h.planner.plan(value));assert.equal(reads,0);assert.equal(h.planner.describe().calls,0);assert.equal(h.spawnCalls(),0);assert.deepEqual(h.events,[]);});
test('failed mock model call reserves durable intent before invocation and latches no retry',{concurrency:false},async t=>{const h=harness(t);await assert.rejects(h.planner.plan(context()),{code:'MOCK_SPAWN_DENIED'});const state=h.planner.describe();assert.equal(state.calls,1);assert.equal(state.failed,true);assert.equal(state.busy,false);assert.equal(h.spawnCalls(),1);const spawnIndex=h.events.indexOf('spawn-BLOCKED');assert.ok(h.events.indexOf('write:INTENT.json')>=0);assert.ok(h.events.indexOf('write:INTENT.json')<spawnIndex);assert.ok(h.events.includes('write:FAILURE.json'));await assert.rejects(h.planner.plan(context()),{code:'PLANNER_LATCHED_OR_BUDGET'});assert.equal(h.spawnCalls(),1);});
test('filesystem reservation failure latches and does not call model',{concurrency:false},async t=>{const h=harness(t,{mkdirFailure:true});await assert.rejects(h.planner.plan(context()),{code:'EACCES'});assert.equal(h.planner.describe().calls,1);assert.equal(h.planner.describe().failed,true);assert.equal(h.planner.describe().busy,false);assert.equal(h.spawnCalls(),0);await assert.rejects(h.planner.plan(context()),{code:'PLANNER_LATCHED_OR_BUDGET'});assert.equal(h.spawnCalls(),0);});
test('already aborted request does not reserve or invoke',{concurrency:false},async t=>{const h=harness(t),controller=new AbortController();controller.abort();await assert.rejects(h.planner.plan(context(),{signal:controller.signal}),{code:'PLANNER_LATCHED_OR_BUDGET'});assert.equal(h.planner.describe().calls,0);assert.equal(h.spawnCalls(),0);assert.deepEqual(h.events,[]);});
