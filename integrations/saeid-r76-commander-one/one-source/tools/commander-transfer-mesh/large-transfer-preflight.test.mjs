import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {TEN_GIB,evaluateLargeTransfer} from './large-transfer-preflight.mjs';
const G=1024n**3n;
const file=fileURLToPath(new URL('./large-transfer-preflight.mjs',import.meta.url));
const args={bytes:TEN_GIB,freeBytes:80n*G,role:'send',backendCompatible:true};
test('10 GiB is admitted by 16 GiB file limit and 64 GiB queue limit',()=>{
 const x=evaluateLargeTransfer(args);
 assert.equal(x.safeToAttempt,true);
 assert.equal(x.checks.configuredFileSize,true);
 assert.equal(x.networkValidated,false);
});
test('receiving 10 GiB conservatively budgets 3 copies plus 2 GiB',()=>{
 const x=evaluateLargeTransfer({...args,role:'receive'});
 assert.equal(x.reservedBytes,32n*G);
 assert.equal(x.safeToAttempt,true);
});
test('rejection at insufficient disk and pending capacity',()=>{
 assert.equal(evaluateLargeTransfer({...args,freeBytes:21n*G}).checks.diskHeadroom,false);
 assert.equal(evaluateLargeTransfer({...args,pendingBytes:60n*G}).checks.pendingCapacity,false);
});
test('exceeding source cap, missing worker support or full worker pool is denied',()=>{
 for(const changed of [{bytes:17n*G},{backendCompatible:false},{activeJobs:3}]){
  assert.equal(evaluateLargeTransfer({...args,...changed}).safeToAttempt,false);
 }
});
test('invalid negative numbers and invalid roles fail closed',()=>{
 for(const changed of [{bytes:-1n},{freeBytes:-1n},{role:'unknown'},{maxActiveJobs:0}]){
  assert.throws(()=>evaluateLargeTransfer({...args,...changed}),/INVALID_PREFLIGHT_/);
 }
});
test('live old R06 worker cannot pass modern policy inspection',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ctmesh-preflight-'));
 try{
  fs.writeFileSync(path.join(root,'node.json'),JSON.stringify({alias:'PC'}));
  fs.writeFileSync(path.join(root,'durable-send.mjs'),"console.error('old');process.exit(1);\n");
  const run=spawnSync(process.execPath,[file,'--root',root,'--peer','Linux','--role','send','--bytes',TEN_GIB.toString()],{encoding:'utf8',timeout:10000});
  assert.equal(run.status,2,run.stderr);
  const x=JSON.parse(run.stdout.trim());
  assert.equal(x.checks.compatibleDurableBackend,false);
  assert.equal(x.safeToAttempt,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('modern worker capability and no transfer job provide read-only preflight result',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ctmesh-preflight-'));
 try{
  fs.writeFileSync(path.join(root,'node.json'),JSON.stringify({alias:'PC'}));
  const backend=fileURLToPath(new URL('./durable-send.mjs',import.meta.url));
  fs.copyFileSync(backend,path.join(root,'durable-send.mjs'));
  const run=spawnSync(process.execPath,[file,'--root',root,'--peer','Linux','--role','send','--bytes',TEN_GIB.toString()],{encoding:'utf8',timeout:10000});
  const x=JSON.parse(run.stdout.trim());
  assert.equal(x.checks.compatibleDurableBackend,true);
  assert.equal(x.bytes,TEN_GIB.toString());
  assert.equal(x.networkValidated,false);
  assert.equal(fs.existsSync(path.join(root,'jobs')),false);
  assert.equal(run.status,x.safeToAttempt?0:2);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
