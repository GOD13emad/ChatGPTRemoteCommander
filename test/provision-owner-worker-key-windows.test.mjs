import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../tools');
const enroll=path.join(dir,'provision-owner-worker-key-windows.mjs');
const ps=path.join(dir,'owner-dpapi-worker-key-windows.ps1');

test('Windows native Worker key enrollment is gated by platform, exact mode and profile before effects',{
  skip:process.platform==='win32'
},()=>{
  for(const args of [
    ['--enroll','chatgpt-remote-commander'],
    ['--preflight','chatgpt-remote-commander'],
    ['--enroll','../bad'],
    ['--grant','MMZ']
  ]){
    const result=spawnSync(process.execPath,[enroll,...args],{
      encoding:'utf8',timeout:10000,maxBuffer:4096
    });
    assert.equal(result.status,2);
    assert.equal(result.stdout,'');
    assert.match(result.stderr,/RC012_WINDOWS_OWNER_WORKER_ARGS_INVALID/);
  }
});
test('Windows key custody binds CurrentUser DPAPI, protects owner ACL and never emits a grant',()=>{
  const a=fs.readFileSync(enroll,'utf8'),p=fs.readFileSync(ps,'utf8');
  assert.match(a,/requestConsent/);
  assert.match(a,/ownerHashMode:'native-j01-v2'/);
  assert.match(a,/createWindowsDpapiWorkerKeyProvider/);
  assert.match(a,/processProof\(profile\)/);
  assert.match(a,/seed\.fill\(0\)/);
  assert.match(a,/workerGrantIssued:false/);
  assert.match(p,/DataProtectionScope\]::CurrentUser/);
  assert.match(p,/SetAccessRuleProtection\(\$true,\$false\)/);
  assert.match(p,/FileMode\]::CreateNew/);
  assert.match(p,/worker-ed25519-seed\.dpapi/);
  assert.match(p,/CryptographicOperations\]::FixedTimeEquals/);
  assert.doesNotMatch(p,/DataProtectionScope\]::LocalMachine/);
  assert.doesNotMatch(p,/Set-ExecutionPolicy|Start-Process\s+-Verb\s+RunAs/);
});
