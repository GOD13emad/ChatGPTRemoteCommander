import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {hash} from '../src/project-catalog.mjs';
import {createProjectRunner,inspectProjectState} from '../src/durable-project-runner.mjs';
function fixture(){
 const base=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc112-readstate-'))),root=path.join(base,'workspace'),stateRoot=path.join(base,'state');fs.mkdirSync(root);fs.mkdirSync(stateRoot);
 const content='bounded fixture\n',grant={schema:1,projectId:'fixture112',owner:'saeed',authorizationSha256:'a'.repeat(64),root,inputs:[],sourcePins:[],catalog:[{id:'write',kind:'write_text',path:'PROOF.txt',content,sha256:hash(content),bytes:Buffer.byteLength(content)}],budgets:{maxModelCalls:1,maxActions:1,wallTimeMs:10000,maxOutputBytes:1024},acceptance:[{type:'file_sha256',path:'PROOF.txt',sha256:hash(content),bytes:Buffer.byteLength(content)}]};
 let calls=0;const modelPort={async plan(c,{callId}){calls++;return {proposal:{choice:'CONTINUE_STEP'},receipt:{model:'gpt-6.1-sol',callId,validated:true,streamSha256:'b'.repeat(64),artifactSha256:'c'.repeat(64)}};}};
 return {root,stateRoot,grant,modelPort,get calls(){return calls;}};
}
test('fresh inspection performs zero filesystem mutation',()=>{const f=fixture();assert.equal(inspectProjectState(f).status,'FRESH');assert.deepEqual(fs.readdirSync(f.stateRoot),[]);assert.equal(f.calls,0);});
test('live and abandoned locks both block inspection',()=>{const f=fixture(),r=createProjectRunner(f);assert.throws(()=>inspectProjectState(f),{code:'PROJECT_READ_ONLY_OWNER_LOCK_PRESENT'});r.close();fs.writeFileSync(path.join(f.stateRoot,'OWNER_LOCK.json'),'unknown owner');assert.throws(()=>inspectProjectState(f),{code:'PROJECT_READ_ONLY_OWNER_LOCK_PRESENT'});});
test('completed inspection preserves journal, counters and deadline without replay',async()=>{const f=fixture(),r=createProjectRunner(f);await r.tick();await r.tick();const before=r.status();r.close();const p=path.join(f.stateRoot,'HISTORY.jsonl'),sha=hash(fs.readFileSync(p));for(let i=0;i<3;i++){const s=inspectProjectState(f);assert.equal(s.status,'FINAL_ACCEPTED');assert.equal(s.modelCalls,1);assert.equal(s.actions,1);assert.equal(s.deadline,before.deadline);}assert.equal(hash(fs.readFileSync(p)),sha);assert.equal(f.calls,1);});
test('pending model failure is reconciliation, never readiness',async()=>{const f=fixture(),r=createProjectRunner({...f,modelPort:{async plan(){throw Object.assign(Error('fixture'),{code:'FIXTURE_FAILURE'});}}});await assert.rejects(r.tick());r.close();assert.equal(inspectProjectState(f).status,'RECONCILIATION_REQUIRED');});
test('paused and cancelled projects remain terminal to the automatic dispatcher',()=>{for(const action of ['pause','cancel']){const f=fixture(),r=createProjectRunner(f);r.control(action);r.close();assert.equal(inspectProjectState(f).status,action==='pause'?'PAUSED':'CANCELLED');}});
test('changed grant and torn history fail closed',()=>{const f=fixture(),r=createProjectRunner(f);r.close();assert.throws(()=>inspectProjectState({...f,grant:{...f.grant,authorizationSha256:'d'.repeat(64)}}),{code:'PROJECT_ENROLLMENT_DRIFT'});fs.appendFileSync(path.join(f.stateRoot,'HISTORY.jsonl'),'partial');assert.throws(()=>inspectProjectState(f),{code:'PROJECT_JOURNAL_TORN_NO_REPAIR'});});
