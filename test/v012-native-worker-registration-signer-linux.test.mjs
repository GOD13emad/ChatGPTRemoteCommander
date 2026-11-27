import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {oneShotNativeWorkerSigner}
  from '../tools/v012-native-worker-registration-signer-linux.mjs';
test('signer rejects absence of systemd encrypted credential without inspecting real identity',async()=>{
  await assert.rejects(oneShotNativeWorkerSigner({
    profile:'qa-profile',readInput:async()=>JSON.stringify({})
  }),{code:'RC012_NATIVE_SIGNER_CREDENTIAL_SCOPE_REQUIRED'});
});
test('native signer CLI refuses unprovisioned invocation and cannot grant from stdin',()=>{
  const script=path.resolve(import.meta.dirname,'../tools/v012-native-worker-registration-signer-linux.mjs');
  const env={...process.env};
  delete env.CREDENTIALS_DIRECTORY;
  delete env.RC012_NATIVE_SIGNER_SCOPE;
  const r=spawnSync(process.execPath,[script,'qa-profile'],{
    input:'{"grant":"FULL_POWER"}',encoding:'utf8',env,timeout:5000
  });
  assert.equal(r.status,2);
  assert.match(r.stderr,/RC012_NATIVE_SIGNER_COMMAND_SCOPE_REQUIRED/);
  assert.equal(r.stdout,'');
});
