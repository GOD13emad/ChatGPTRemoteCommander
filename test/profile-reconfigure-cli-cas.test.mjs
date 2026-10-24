import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildProfileInstance } from '../src/profile-instances.mjs';

const cwd = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(cwd,'../tools/reconfigure-profile-instance.mjs');
const sha = buf => createHash('sha256').update(buf).digest('hex');

function fixture(){
 const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-cli-cas-')));
 const state=path.join(root,'instance');fs.mkdirSync(state);
 const config={host:'127.0.0.1',port:47831,allowedRoots:[root],
  allowedPrograms:['git','node'],auditLog:'var/audit.jsonl',powerMode:{enabled:true,
   fullFilesystem:true,allowShell:true,allowProcessControl:true,allowPermanentDelete:false,
   guiControl:{enabled:false}}};
 const baseFile=path.join(root,'base.json');fs.writeFileSync(baseFile,JSON.stringify(config));
 const built=buildProfileInstance({baseConfig:config,profile:'saeid-secondary',
  port:47834,stateDirectory:state});
 const current=path.join(state,'config.json');
 const record=path.join(state,'instance.json');
 fs.writeFileSync(current,built.json);
 fs.writeFileSync(record,JSON.stringify({...built.record,configPath:current},null,2)+'\n');
 const invoke = (...args) => spawnSync(process.execPath,[cli,'--profile','saeid-secondary',
   '--state-dir',state,'--base-config',baseFile,...args],{
    encoding:'utf8',timeout:12000,windowsHide:true});
 return {root,state,current,record,invoke,dispose:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('real CLI handles expected policy SHA CAS, rejects stale/invalid without changing state',()=>{
 const f=fixture();try{
  const original=fs.readFileSync(f.current);
  const hash=sha(original);
  const first=f.invoke('--power','--expected-config-sha256',hash);
  assert.equal(first.status,0,first.stderr);
  const result=JSON.parse(first.stdout.trim());
  assert.equal(result.oldConfigSha256,hash);
  assert.equal(result.profile,'saeid-secondary');
  const now=fs.readFileSync(f.current);
  assert.equal(result.newConfigSha256,sha(now));
  assert.notEqual(hash,result.newConfigSha256);
  const backups=fs.readdirSync(path.join(f.state,'backups')).length;
  const record=fs.readFileSync(f.record);
  const stale=f.invoke('--standard','--expected-config-sha256',hash);
  assert.notEqual(stale.status,0);
  assert.match(stale.stderr,/PROFILE_RECONFIGURE_STALE_POLICY/);
  const invalid=f.invoke('--standard','--expected-config-sha256','invalid-sha');
  assert.notEqual(invalid.status,0);
  assert.match(invalid.stderr,/PROFILE_RECONFIGURE_EXPECTED_CONFIG_SHA_INVALID/);
  assert.deepEqual(fs.readFileSync(f.current),now);
  assert.deepEqual(fs.readFileSync(f.record),record);
  assert.equal(fs.readdirSync(path.join(f.state,'backups')).length,backups);
  assert.equal(fs.existsSync(path.join(f.state,'.profile-reconfigure.lock')),false);
 }finally{f.dispose()}
});
test('real CLI refuses concurrent edit without touching isolated credentials or runtime',()=>{
 const f=fixture();try{
  const config=fs.readFileSync(f.current);
  const record=fs.readFileSync(f.record);
  const lock=path.join(f.state,'.profile-reconfigure.lock');
  fs.writeFileSync(lock,'unrelated owner operation');
  const run=f.invoke('--power','--expected-config-sha256',sha(config));
  assert.notEqual(run.status,0);
  assert.match(run.stderr,/PROFILE_RECONFIGURE_BUSY/);
  assert.deepEqual(fs.readFileSync(f.current),config);
  assert.deepEqual(fs.readFileSync(f.record),record);
  assert.equal(fs.readFileSync(lock,'utf8'),'unrelated owner operation');
  assert.equal(fs.existsSync(path.join(f.state,'backups')),false);
 }finally{f.dispose()}
});
