import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createV012PrivateCoreRuntime} from '../src/v012-private-core-runtime.mjs';
import {assertOwnerPairEnrollmentScope}
  from '../src/rc012-owner-enrolled-no-grant-bootstrap-linux.mjs';

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
  assert.match(src,/resolvePinnedOwnerTunnelDirectory/);
  assert.doesNotMatch(src,/private-pair\/\$profile/);
  assert.match(src,/-p RuntimeMaxSec="\$coreMaxAge"/);
  assert.match(src,/systemctl --user stop "\$qaUnit.service"/);
  assert.match(src,/systemctl --user reset-failed "\$qaUnit.service"/);
});

test('no-grant bootstrap and installer use the same owner PIN directory resolver',()=>{
  const source=fs.readFileSync(path.join(root,
    'src/rc012-owner-enrolled-no-grant-bootstrap-linux.mjs'),'utf8');
  assert.match(source,/resolvePinnedOwnerTunnelDirectory/);
  assert.doesNotMatch(source,/selected==='chatgpt-remote-commander'\?'default':selected/);
});

test('private owner PIN identity rejects a different host separately from a profile alias',()=>{
  const args={selectedProfile:'Emad',configuredHostId:'host-one',
    enrolledProfile:'Emad',enrolledHostId:'host-one'};
  assert.doesNotThrow(()=>assertOwnerPairEnrollmentScope(args));
  assert.throws(()=>assertOwnerPairEnrollmentScope({
    ...args,enrolledHostId:'host-two'
  }),{code:'RC012_OWNER_BOOTSTRAP_TUNNEL_HOST_MISMATCH'});
  assert.throws(()=>assertOwnerPairEnrollmentScope({
    ...args,enrolledProfile:'another-pair'
  }),{code:'RC012_OWNER_BOOTSTRAP_TUNNEL_PROFILE_MISMATCH'});
  assert.throws(()=>assertOwnerPairEnrollmentScope({
    ...args,configuredHostId:undefined
  }),{code:'RC012_OWNER_BOOTSTRAP_SCOPE_REQUIRED'});
});


test('J01 QA timeouts outlive native dialog and remain fail-closed',()=>{
  const runner=fs.readFileSync(path.join(root,'tools/qa-v012-protected-broker-run-linux.sh'),'utf8');
  const qa=fs.readFileSync(core,'utf8');
  const native=fs.readFileSync(path.join(root,'src/native-owner-session-provider-linux.mjs'),'utf8');
  const nativeMs=Number(native.match(/dialogTimeoutMs=(\d+)/)?.[1]);
  const requestMs=Number(qa.match(/name:'v2_private_owner_bind',timeoutMs:(\d+)/)?.[1]);
  const brokerMs=Number([...runner.matchAll(/brokerMaxAge=(\d+)s/g)].at(-1)?.[1])*1000;
  const coreMs=Number([...runner.matchAll(/coreMaxAge=(\d+)s/g)].at(-1)?.[1])*1000;
  assert.equal(nativeMs,120000);
  assert.ok(requestMs>nativeMs,'request must outlive native dialog');
  assert.ok(coreMs>requestMs,'core unit must outlive HTTP request');
  assert.ok(brokerMs>coreMs,'native broker must outlive core unit');
  assert.match(runner,/RC012_QA_J01_OWNER_BIND:-0/);
  assert.match(runner,/systemctl --user stop "\$qaUnit.service"/);
});
