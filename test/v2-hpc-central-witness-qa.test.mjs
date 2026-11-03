import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// POSIX owner/UID, local HOME and native review fixtures are Linux-specific.
// Windows must exercise its separate owner/Win32 adapters, not emulate POSIX authorization.
const posixTest = process.platform === 'win32' ? test.skip : test;
const file=fileURLToPath(new URL('../tools/v2-hpc-central-witness-qa.mjs',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const host='HPC-159-17',id='centralqa30000_20261102';
function setup(){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'v2-central-witness-test-'));
 const home=path.join(base,'home');fs.mkdirSync(home,{mode:0o700});
 const root=path.join(home,'.local/state/CommanderV2/QA/central-hpc-e2e-20261102');
 const run=(action,hostName=host)=>{
  const r=spawnSync(process.execPath,[file,action,hostName],
   {env:{...process.env,HOME:home},encoding:'utf8',timeout:6000});
  return {rc:r.status,stdout:r.stdout,stderr:r.stderr};
 };
 const witness=(overrides={})=>{
  const request=fs.readFileSync(path.join(root,'requests',host+'.json'),'utf8');
  const result={schema:1,operationId:id,kind:'prime-statistics',
   limit:30000,count:3245,sum:45675864};
  const record={schema:1,host,
   scope:'V1_LOCAL_OWNER_QUEUE_NOT_CENTRAL_V2',result,
   inputSha256:sha(request),digest:sha(JSON.stringify(result)),...overrides};
  fs.writeFileSync(path.join(root,'remote-evidence',host+'.json'),JSON.stringify(record)+'\n');
 };
 return {run,witness,root,close:()=>fs.rmSync(base,{recursive:true,force:true})};
}
test('disallows unregistered host and actions without local state changes',()=>{
 const f=setup();try{
  const r=f.run('seal','unknown');assert.notEqual(r.rc,0);
  assert.match(r.stderr,/V2_HPC_WITNESS_COMMAND_UNSUPPORTED/);
  assert.equal(fs.existsSync(f.root),false);
 }finally{f.close();}
});
posixTest('unobserved or altered remote evidence fails closed',()=>{
 const f=setup();try{
  assert.equal(f.run('prepare').rc,0);
  assert.notEqual(f.run('seal').rc,0);
  f.witness({digest:'0'.repeat(64)});
  const r=f.run('seal');assert.notEqual(r.rc,0);
  assert.match(r.stderr,/V2_HPC_WITNESS_REMOTE_RECEIPT_INVALID/);
  assert.notEqual(f.run('verify').rc,0);
 }finally{f.close();}
});
posixTest('central SQLite fenced artifact seals genuine bounded HPC evidence and independently verifies',()=>{
 const f=setup();try{
  assert.equal(f.run('prepare').rc,0);f.witness();
  const first=f.run('seal');assert.equal(first.rc,0,first.stderr);
  const sealed=JSON.parse(first.stdout);assert.equal(sealed.status,'CENTRAL_QA_SEALED');
  assert.equal(sealed.count,3245);assert.equal(sealed.sum,45675864);
  const second=f.run('verify');assert.equal(second.rc,0,second.stderr);
  assert.equal(JSON.parse(second.stdout).digest,sealed.digest);
  const replay=f.run('seal');assert.equal(replay.rc,0,replay.stderr);
  assert.equal(JSON.parse(replay.stdout).status,'SEALED_RECONCILED');
 }finally{f.close();}
});
posixTest('post-commit receipt mutation cannot replace immutable central evidence',()=>{
 const f=setup();try{
  assert.equal(f.run('prepare').rc,0);f.witness();
  assert.equal(f.run('seal').rc,0);
  f.witness({host:'HPC-154-66'});
  assert.notEqual(f.run('seal').rc,0);
  assert.notEqual(f.run('verify').rc,0);
 }finally{f.close();}
});
