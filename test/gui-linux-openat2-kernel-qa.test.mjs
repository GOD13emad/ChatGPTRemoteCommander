import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const src=fileURLToPath(new URL('../tools/gui-linux-openat2-kernel-qa.py',import.meta.url));
test('real Linux openat2 kernel rejects symlinks, escapes, replay in disposable J01 QA',
 {skip:process.platform!=='linux',timeout:20000},()=>{
  const r=spawnSync('python3',['-I',src],{encoding:'utf8',timeout:17000,maxBuffer:32768});
  assert.equal(r.error,undefined,String(r.error));
  assert.equal(r.status,0,r.stderr);
  const result=JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.equal(result.schema,'rc-e44-openat2-real-kernel-qa-v1');
  assert.equal(result.tests,11);
  assert.equal(result.actualKernelConfinement,true);
  assert.equal(result.requestedFlags,15);
  assert.equal(result.noCrossMountBehaviorTested,true);
  assert.equal(result.noPowerLossProven,true);
  assert.equal(result.ownerAuthenticated,false);
  assert.equal(result.storageTrusted,false);
  assert.equal(result.releaseAuthorized,false);
  assert.equal(result.nativeOutcome,'UNKNOWN');
  assert.match(r.stderr,/Ran 11 tests/);
  assert.match(r.stderr,/OK/);
});
