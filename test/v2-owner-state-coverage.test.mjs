import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectV2OwnerState} from '../tools/v2-owner-state-coverage.mjs';
const run=fn=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v2-owner-coverage-'));
 try{fn(root)}finally{fs.rmSync(root,{recursive:true,force:true})}
};
test('does not read or return private path, credentials or file contents',()=>{
 run(root=>{
  const x=path.join(root,'.config','BraveSoftware','Brave-Browser');
  fs.mkdirSync(x,{recursive:true});
  const file=path.join(x,'Login Data');
  fs.writeFileSync(file,'PRIVATE-FIXTURE-TOKEN', {mode:0o600});
  const before=fs.statSync(file).mtimeMs;
  const result=inspectV2OwnerState({platform:'linux',home:root});
  assert.equal(result.entries.find(e=>e.kind==='brave-userdata').presence,'PRESENT');
  assert.equal(result.totals.PRESENT,1);
  assert.equal(result.consistentBackupVerified,false);
  assert.equal(result.cutoverAccepted,false);
  assert.equal(result.filesRead,0);
  assert.equal(result.filesCopied,0);
  assert.equal(fs.statSync(file).mtimeMs,before);
  assert.ok(!JSON.stringify(result).includes(root));
  assert.ok(!JSON.stringify(result).includes('PRIVATE-FIXTURE-TOKEN'));
  assert.equal(result.entries.every(e=>e.backup==='NOT_EVALUATED'),true);
 });
});
test('flags aliased and non-directory candidates without following them',()=>{
 if(process.platform!=='linux')return;
 run(root=>{
  const dest=path.join(root,'target');fs.mkdirSync(dest);
  const conf=path.join(root,'.config');fs.mkdirSync(conf);
  const brave=path.join(conf,'BraveSoftware');fs.mkdirSync(brave);
  fs.symlinkSync(dest,path.join(brave,'Brave-Browser'));
  fs.writeFileSync(path.join(conf,'google-chrome'),'not a directory');
  const r=inspectV2OwnerState({platform:'linux',home:root});
  assert.equal(r.entries.find(e=>e.kind==='brave-userdata').presence,'ALIAS');
  assert.equal(r.entries.find(e=>e.kind==='chrome-userdata').presence,'NON_DIRECTORY');
  assert.equal(r.totals.ALIAS,1);
  assert.equal(r.totals.NON_DIRECTORY,1);
 });
});
test('unavailable Windows account roots stay UNKNOWN rather than ABSENT',()=>{
 const r=inspectV2OwnerState({platform:'win32',appData:null,localAppData:null});
 assert.equal(r.entries.every(x=>x.presence==='UNKNOWN'),true);
 assert.throws(()=>inspectV2OwnerState({platform:'darwin'}),/OS_UNSUPPORTED/);
});
test('live CLI is bounded, metadata only and does not claim preservation PASS',()=>{
 const script=fileURLToPath(new URL('../tools/v2-owner-state-coverage.mjs',import.meta.url));
 const out=JSON.parse(execFileSync(process.execPath,[script,'--inspect'],{encoding:'utf8'}));
 assert.equal(out.filesRead,0);
 assert.equal(out.consistentBackupVerified,false);
 assert.equal(out.entries.length,8);
 assert.ok(out.entries.every(x=>!('path' in x)&&!('credential' in x)));
 assert.equal(out.entries.every(x=>x.restore==='NOT_TESTED'),true);
 assert.equal(out.cutoverAccepted,false);
});
