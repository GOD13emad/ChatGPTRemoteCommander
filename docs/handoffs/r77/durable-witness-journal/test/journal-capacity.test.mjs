// Serialized parser/resource fixtures only; no native process or release authority.
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash,randomUUID} from 'node:crypto';
import {createOwnedWitnessJournal} from '../src/owned-witness-journal.mjs';import {createOwnedNativeCessationOracle} from '../src/owned-native-cessation.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','evidence','capacity-fixtures');fs.mkdirSync(root,{recursive:true});
const hash=x=>createHash('sha256').update(x).digest('hex');
const canon=x=>JSON.stringify(x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canon(x[k]))])):Array.isArray(x)?x.map(v=>JSON.parse(canon(v))):x);
const pins=Object.fromEntries(['oracle','nativeRunner','modelContract','nativeHelper','executable','containedActionPolicy'].map(k=>[k,'a'.repeat(64)]));
function fixture(pairs,pending){const directory=fs.realpathSync.native(fs.mkdtempSync(path.join(root,'capacity-'))),project=path.join(directory,'..',path.basename(directory)+'-project');fs.mkdirSync(project);
 const options={directory,pins,hostGeneration:{pid:process.pid,creationFileTime:'134383698807009294'},verifyPrivateDirectory:()=>true};
 let j=createOwnedWitnessJournal({...options,create:true});const binding={workflowId:'unit',stepId:'first',operationId:randomUUID(),rootFingerprint:hash(process.platform==='win32'?project.toLowerCase():project),leaseStoreFingerprint:'b'.repeat(64),leaseFingerprint:'c'.repeat(64),profile:'fixture-owner',device:'fixture'};
 j.recordLaunch(binding,{argsDigest:'a'.repeat(64),inputDigest:'a'.repeat(64),nativeConfigDigest:'a'.repeat(64)});
 const proof={pid:1111,creationFileTime:'134383698807009294',assignedBeforeResume:true,cleanupConfirmed:true,cleanupWin32Error:0,activeJobProcesses:0,status:'COMPLETED',ownedJobTerminated:false};
 j.recordWitness(binding.operationId,{binding,identity:{pid:proof.pid,creationFileTime:proof.creationFileTime},helperPid:2222,proofDigest:'d'.repeat(64),completedUtc:new Date().toISOString(),attestationId:randomUUID(),nativeStatus:'COMPLETED',ownedJobTerminated:false,nativeProof:proof});j.close();
 const file=path.join(directory,'witness.jsonl'),templates=fs.readFileSync(file,'utf8').trim().split('\n').map(x=>JSON.parse(x));let head='0'.repeat(64),count=0,rows=[];
 function add(index,op){const row=structuredClone(templates[index]);row.sequence=++count;row.previous=head;if(index===0)row.body.binding.operationId=op;else{row.body.operationId=op;row.body.witness.binding.operationId=op;}delete row.hash;row.hash=hash(canon(row));head=row.hash;rows.push(canon(row));}
 for(let i=0;i<pairs;i++){const op=randomUUID();add(0,op);add(1,op);}for(let i=0;i<pending;i++)add(0,randomUUID());
 fs.writeFileSync(file,rows.join('\n')+'\n');j=createOwnedWitnessJournal(options);let runnerCalls=0;
 const op=randomUUID(),state={id:'unit',root:project,device:'fixture',authority:{profileId:'fixture-owner'},steps:[{id:'first',operationId:op,status:'running'}]};
 const oracle=createOwnedNativeCessationOracle({journal:j,nativeConfig:{},leaseStoreFingerprint:()=>binding.leaseStoreFingerprint,authorizeContainedExecution:async()=>true,
  launchLeasePreflight:()=>({workflowId:'unit',rootFingerprint:binding.rootFingerprint,lease:{storeFingerprint:binding.leaseStoreFingerprint,fingerprint:binding.leaseFingerprint},controlActive:true,operations:[{stepId:'first',operationId:op,outcomeState:'running'}]}),
  nativeRunner:async()=>{runnerCalls++;return{closed:true,helperPid:2222,exitCode:0,proof};}});
 return{file,j,oracle,get runnerCalls(){return runnerCalls;},run:()=>oracle.runOwned({state,stepId:'first',args:['mock-only']})};}
test('row reservations for all pending launches prevent a known unpersistable effect and leave prior bytes unchanged',async()=>{const f=fixture(999,1),before=fs.readFileSync(f.file);await assert.rejects(f.run(),/CAPACITY_BEFORE_WRITE/);assert.equal(f.runnerCalls,0);assert.deepEqual(fs.readFileSync(f.file),before);assert.equal(f.j.attemptedOperationIds().length,1000);f.oracle.close();});
test('byte reservations for all pending launches prevent known capacity exhaustion before dispatch or append',async()=>{const f=fixture(0,500),before=fs.readFileSync(f.file);await assert.rejects(f.run(),/CAPACITY_BEFORE_WRITE/);assert.equal(f.runnerCalls,0);assert.deepEqual(fs.readFileSync(f.file),before);assert.equal(f.j.attemptedOperationIds().length,500);f.oracle.close();});
test('last fully reserved pair can commit both launch and its own terminal witness',async()=>{const f=fixture(999,0),before=fs.readFileSync(f.file);await f.run();assert.equal(f.runnerCalls,1);const after=fs.readFileSync(f.file);assert.equal(after.toString('utf8').trim().split('\n').length,2000);assert.equal(after.subarray(0,before.length).equals(before),true);f.oracle.close();});
