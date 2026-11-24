import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const script=path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  '../tools/qa-v012-native-worker-key-runtime-linux.mjs');
function probe(profile,scope,credentialDirectory){
  const env={...process.env};
  delete env.CREDENTIALS_DIRECTORY;
  delete env.RC012_QA_NATIVE_WORKER_SCOPE;
  if(scope!==undefined)env.RC012_QA_NATIVE_WORKER_SCOPE=scope;
  if(credentialDirectory!==undefined)env.CREDENTIALS_DIRECTORY=credentialDirectory;
  return spawnSync(process.execPath,[script,profile],{
    env,encoding:'utf8',timeout:10000,maxBuffer:4096
  });
}
test('existing owner key QA must fail closed outside a genuine native credential scope',()=>{
  for(const [profile,scope,dir] of [
    ['chatgpt-remote-commander',undefined,undefined],
    ['chatgpt-remote-commander','VERIFY_EXISTING_NO_GRANT',undefined],
    ['bad.profile','VERIFY_EXISTING_NO_GRANT','/tmp/blocked-non-native'],
    ['../bad','VERIFY_EXISTING_NO_GRANT','/tmp/blocked-non-native']
  ]){
    const r=probe(profile,scope,dir);
    assert.equal(r.status,2);
    assert.match(r.stderr,/RC012_NATIVE_WORKER_QA_SCOPE_REQUIRED/);
    assert.equal(r.stdout,'','never disclose any signing material');
  }
});

test('Worker key no-grant QA resolves the exact enrolled native PIN alias',()=>{
  const src=fs.readFileSync(script,'utf8');
  assert.match(src,/resolvePinnedOwnerTunnelDirectory/);
  assert.doesNotMatch(src,/profile==='chatgpt-remote-commander'\?'default':profile/);
});
