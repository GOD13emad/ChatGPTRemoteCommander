import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createOwnedWitnessJournal} from '../../src/owned-witness-journal.mjs';
import {createOwnedNativeCessationOracle} from '../../src/owned-native-cessation.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot=path.join(here,'fixtures');fs.mkdirSync(fixtureRoot,{recursive:true});
const hash=x=>createHash('sha256').update(x).digest('hex');
const pins=Object.fromEntries(['oracle','nativeRunner','modelContract','nativeHelper','executable','containedActionPolicy'].map((k,i)=>[k,String(i+1).repeat(64)]));
const generation={pid:12345,creationFileTime:'134383698807009294'};
const newDir=()=>fs.realpathSync.native(fs.mkdtempSync(path.join(fixtureRoot,'unit-')));
const open=(directory,create=false,extra={})=>createOwnedWitnessJournal({directory,pins,hostGeneration:generation,verifyPrivateDirectory:()=>true,create,...extra});
const b=()=>({workflowId:'independent',stepId:'once',operationId:randomUUID(),rootFingerprint:'a'.repeat(64),leaseStoreFingerprint:'b'.repeat(64),leaseFingerprint:'c'.repeat(64),profile:'unit-owner',device:'unit-device'});
const digs={argsDigest:'d'.repeat(64),inputDigest:'e'.repeat(64),nativeConfigDigest:'f'.repeat(64)};
const snapshot=dir=>Object.fromEntries(fs.readdirSync(dir).sort().map(n=>[n,hash(fs.readFileSync(path.join(dir,n)))]));
function makeRecord(binding){return {binding,identity:{pid:45678,creationFileTime:'134383698807009295'},helperPid:45679,proofDigest:'8'.repeat(64),completedUtc:new Date().toISOString(),attestationId:randomUUID(),nativeStatus:'COMPLETED',ownedJobTerminated:false,nativeProof:{pid:45678,creationFileTime:'134383698807009295',assignedBeforeResume:true,cleanupConfirmed:true,cleanupWin32Error:0,activeJobProcesses:0,status:'COMPLETED',ownedJobTerminated:false}};}
function closedFixture(){const dir=newDir(),j=open(dir,true),binding=b();j.recordLaunch(binding,digs);j.recordWitness(binding.operationId,makeRecord(binding));j.close();return {dir,binding};}

test('unit: explicit consumed intent survives reopen and cannot be appended again',()=>{
 const dir=newDir(),binding=b(),j=open(dir,true);j.recordLaunch(binding,digs);j.close();
 const reopened=open(dir);assert.deepEqual(reopened.attemptedOperationIds(),[binding.operationId]);assert.equal(reopened.evidence(binding.operationId),null);
 assert.throws(()=>reopened.recordLaunch(binding,digs),/NO_EXECUTION_REPLAY/);reopened.close();
});
test('unit: partial tail poisons open without truncation or repair',()=>{
 const {dir}=closedFixture();fs.appendFileSync(path.join(dir,'witness.jsonl'),'{"sequence":');const before=snapshot(dir);
 assert.throws(()=>open(dir),/PARTIAL_OR_ENCODING/);assert.deepEqual(snapshot(dir),before);
});
test('unit: committed field tamper is rejected without accepting malformed record',()=>{
 const {dir}=closedFixture(),file=path.join(dir,'witness.jsonl');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('COMPLETED','FORGED'));const before=snapshot(dir);
 assert.throws(()=>open(dir),/CHAIN/);assert.deepEqual(snapshot(dir),before);
});
test('unit: duplicate JSON key is rejected rather than normalized',()=>{
 const {dir}=closedFixture(),file=path.join(dir,'witness.jsonl');let s=fs.readFileSync(file,'utf8');s=s.replace('"schema":1','"schema":1,"schema":1');fs.writeFileSync(file,s);
 assert.throws(()=>open(dir),/NONCANONICAL_OR_DUPLICATE_KEYS/);
});
test('unit: duplicate and reordered complete records fail whole-chain validation',()=>{
 for(const mode of ['duplicate','reorder']){const {dir}=closedFixture(),file=path.join(dir,'witness.jsonl'),lines=fs.readFileSync(file,'utf8').trimEnd().split('\n');
 fs.writeFileSync(file,(mode==='duplicate'?[lines[0],...lines]:lines.reverse()).join('\n')+'\n');assert.throws(()=>open(dir),/CHAIN/);}
});
test('unit: exact dependency pin drift cannot reopen witness journal',()=>{
 const {dir}=closedFixture();assert.throws(()=>open(dir,false,{pins:{...pins,oracle:'0'.repeat(64)}}),/IDENTITY_DRIFT/);
});
test('unit: strict witness schema refuses raw output or caller secret field',()=>{
 const dir=newDir(),j=open(dir,true),binding=b();j.recordLaunch(binding,digs);
 assert.throws(()=>j.recordWitness(binding.operationId,{...makeRecord(binding),stdout:'PRIVATE_SENTINEL_OUTPUT'}),/SCHEMA/);
 assert.equal(j.evidence(binding.operationId),null);assert.ok(!fs.readFileSync(path.join(dir,'witness.jsonl'),'utf8').includes('PRIVATE_SENTINEL_OUTPUT'));j.close();
});
test('unit: same-process head pin detects valid-prefix truncation after admission',()=>{
 const dir=newDir(),j=open(dir,true),binding=b();j.recordLaunch(binding,digs);const record=makeRecord(binding);j.recordWitness(binding.operationId,record);
 const file=path.join(dir,'witness.jsonl'),first=fs.readFileSync(file,'utf8').split('\n')[0]+'\n';fs.writeFileSync(file,first);
 assert.throws(()=>j.assertCommittedWitness(binding.operationId,record),/CHANGED_AFTER_COMMIT/);
 assert.throws(()=>j.close(),/CLOSED_OR_POISONED/);assert.ok(fs.existsSync(path.join(dir,'writer.lock')));
});
test('unit: append fsync failure after effect never grants Map authority or replay',async()=>{
 const dir=newDir(),j=open(dir,true),project=dir,operationId=randomUUID();let nativeCalls=0;
 const state={id:'fault',root:project,authority:{profileId:'unit-owner'},device:'unit-device',steps:[{id:'once',status:'running',operationId}]};
 const preview={workflowId:'fault',rootFingerprint:hash(project.toLowerCase()),controlActive:true,operations:[{stepId:'once',operationId,outcomeState:'running'}],lease:{storeFingerprint:'b'.repeat(64),fingerprint:'c'.repeat(64)}};
 const originalFsync=fs.fsyncSync;
 const oracle=createOwnedNativeCessationOracle({journal:j,nativeConfig:{},leaseStoreFingerprint:()=>preview.lease.storeFingerprint,launchLeasePreflight:()=>preview,authorizeContainedExecution:async()=>true,
 nativeRunner:async()=>{nativeCalls++;fs.fsyncSync=()=>{throw Object.assign(Error('QA_FSYNC_FAILURE'),{code:'EIO'});};return {closed:true,helperPid:45679,exitCode:0,signal:null,proof:makeRecord(b()).nativeProof};}});
 try{await assert.rejects(oracle.runOwned({state,stepId:'once',args:['fixed-unit-action']}),/QA_FSYNC_FAILURE/);}finally{fs.fsyncSync=originalFsync;}
 assert.equal(nativeCalls,1);assert.equal((await oracle.verifyNativeCessation(preview)).verified,false);
 await assert.rejects(oracle.runOwned({state,stepId:'once',args:['fixed-unit-action']}),/NO_EXECUTION_REPLAY/);assert.equal(nativeCalls,1);
});
test('unit: missing storage is not initialized by create=false',()=>{
 const dir=newDir();assert.throws(()=>open(dir),/ENOENT/);assert.deepEqual(fs.readdirSync(dir),[]);
});
test('unit: rehashed witness replacement cannot replace same-process committed head',()=>{
 const dir=newDir(),j=open(dir,true),binding=b(),record=makeRecord(binding);j.recordLaunch(binding,digs);j.recordWitness(binding.operationId,record);
 const file=path.join(dir,'witness.jsonl'),rows=fs.readFileSync(file,'utf8').trimEnd().split('\n').map(JSON.parse);
 const canonical=x=>JSON.stringify(x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])):Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):x);
 rows[1].body.witness.completedUtc=new Date(Date.parse(record.completedUtc)-1).toISOString();const {hash:oldHash,...payload}=rows[1];rows[1].hash=hash(canonical(payload));
 fs.writeFileSync(file,rows.map(canonical).join('\n')+'\n');assert.throws(()=>j.assertCommittedWitness(binding.operationId,record),/CHANGED_AFTER_COMMIT/);
 assert.throws(()=>j.close(),/CLOSED_OR_POISONED/);
});
test('unit: second process writer rejects while current owner keeps exact log',()=>{
 const dir=newDir(),j=open(dir,true),before=snapshot(dir);
 const child=spawnSync(process.execPath,['--input-type=module','-e',
 `import {createOwnedWitnessJournal} from ${JSON.stringify(new URL('../../src/owned-witness-journal.mjs',import.meta.url).href)};try{createOwnedWitnessJournal({directory:process.argv[1],pins:JSON.parse(process.argv[2]),hostGeneration:JSON.parse(process.argv[3]),verifyPrivateDirectory:()=>true});process.exitCode=2;}catch(e){if(e.code!=='EEXIST')throw e;console.log('EXCLUSIVE_WRITER_DENIED');}`,
 dir,JSON.stringify(pins),JSON.stringify({...generation,pid:generation.pid+1})],{encoding:'utf8',windowsHide:true});
 assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/EXCLUSIVE_WRITER_DENIED/);assert.deepEqual(snapshot(dir),before);j.close();
});
