import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createV012PrivateCoreRuntime} from '../src/v012-private-core-runtime.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const core=path.join(root,'tools/qa-v012-broker-core-no-grant-linux.mjs');
const runner=path.join(root,'tools/qa-v012-protected-broker-run-linux.sh');

test('no-grant owner native canary uses the EXACT checkout Core runtime, never installed dev.12',()=>{
  assert.equal(typeof createV012PrivateCoreRuntime,'function');
  const src=fs.readFileSync(core,'utf8');
  assert.match(src,/from '\.\.\/src\/v012-private-core-runtime\.mjs';/);
  assert.doesNotMatch(src,/from '\/usr\/lib\/chatgpt-remote-commander\/app\/src\//);
  assert.match(src,/RC012_CORE_BROKER_QA_SCOPE[^\n]+NO_EFFECTS/);
  assert.match(src,/RC012_NATIVE_OWNER_J01_PAIR_BIND_PROBE/);
  assert.match(src,/workerGrantIssued:false,installedCoreToolDispatched:false/);
});

test('no-grant owner canary runner launches EXACT checkout Core without absolute installed import loader',()=>{
  const src=fs.readFileSync(runner,'utf8');
  assert.match(src,/root="\$\(cd -- "\$\(dirname -- "\$0"\)\/\.\." && pwd -P\)"/);
  assert.match(src,/"\$node" "\$root\/tools\/qa-v012-broker-core-no-grant-linux\.mjs"/);
  assert.doesNotMatch(src,/--experimental-loader/);
  assert.doesNotMatch(src,/file:\/\/\/usr\/lib\/chatgpt-remote-commander\/app\/src\//);
  assert.match(src,/RC012_CORE_BROKER_QA_SCOPE=NO_EFFECTS/);
  assert.match(src,/RC012_QA_J01_OWNER_BIND:-0/);
  assert.match(src,/RC012_PRODUCTION_CORE_AND_TUNNEL_UNCHANGED_NO_GRANT_QA_COMPLETE/);
  assert.match(src,/-p RuntimeMaxSec=65s/);
  assert.match(src,/systemctl --user stop "\$qaUnit.service"/);
  assert.match(src,/systemctl --user reset-failed "\$qaUnit.service"/);
});
