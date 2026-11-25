import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {nativeLifecycleSpec,admittedDisposableHost,inspectUnifiedNativeSource}
  from '../tools/universal-install/native-smoke.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const call=(args,{env=process.env}={})=>spawnSync(process.execPath,[
  path.join(root,'tools/universal-install/native-smoke.mjs'),...args],{
  cwd:root,env,encoding:'utf8',timeout:12000,windowsHide:true});
const sha=spawnSync('git',['-C',root,'rev-parse','HEAD'],{
  encoding:'utf8',windowsHide:true}).stdout.trim();
test('one exact source version maps to NSIS and DEB native install/upgrade/rollback scripts',()=>{
  const {version}=inspectUnifiedNativeSource();
  const l=nativeLifecycleSpec('linux',version),w=nativeLifecycleSpec('win32',version);
  assert.equal(l.runner,'bash');assert.equal(l.format,'DEB');
  assert.equal(w.runner,'pwsh');assert.equal(w.format,'NSIS');
  assert.ok(l.artifact.includes(version));
  assert.ok(w.artifact.includes(version));
  assert.notEqual(l.script,w.script);
  assert.throws(()=>nativeLifecycleSpec('darwin',version),{code:'RC012_NATIVE_PLATFORM_UNSUPPORTED'});
  assert.throws(()=>nativeLifecycleSpec('win32','0.12.0-dev.1;rm'),{code:'RC012_NATIVE_VERSION_INVALID'});
});
test('one cross-platform CLI plans but refuses native changes on any real owner host',()=>{
  const r=call(['--plan','--expected-commit',sha]);
  assert.equal(r.status,0,r.stderr);
  const v=JSON.parse(r.stdout);
  assert.equal(v.status,'RC012_UNIVERSAL_NATIVE_QA_PLAN_READY');
  assert.equal(v.liveInstallApproved,false);
  assert.equal(v.ownerGrantIssued,false);
  assert.equal(v.qaOnly,true);
  // This is a NEGATIVE *owner-host* fixture. Hosted CI itself must be able
  // to run the native smoke, so do not inherit its approval environment.
  const ownerEnv={...process.env,CI:'false',GITHUB_ACTIONS:'false',
    RUNNER_ENVIRONMENT:'local'};
  const denied=call(['--run','--expected-commit',sha],{env:ownerEnv});
  assert.equal(denied.status,2,denied.stdout);
  assert.equal(JSON.parse(denied.stderr).reason,'RC012_NATIVE_HOSTED_RUNNER_ONLY');
});
test('commit/profile/platform mismatches fail closed; synthetic CI variables cannot confer auth',()=>{
  assert.equal(call(['--plan','--expected-commit','0'.repeat(40)]).status,2);
  assert.equal(call(['--plan']).status,2);
  const spec=nativeLifecycleSpec(process.platform==='win32'?'win32':'linux','0.12.0-dev.9');
  assert.equal(admittedDisposableHost({spec,env:{CI:'true',GITHUB_ACTIONS:'true',
    RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:spec.ghOs,
    GITHUB_WORKSPACE:root,RUNNER_TEMP:root}}),false);
  assert.equal(admittedDisposableHost({spec,env:{}}),false);
});

test('hosted native matrix executes only the common dispatcher; Windows version is source-bound',()=>{
  const workflow=fs.readFileSync(path.join(root,'.github/workflows/unified-installer-pilot.yml'),'utf8');
  const powershell=fs.readFileSync(path.join(root,'test/unified-windows-owner-migration.ps1'),'utf8');
  const migrate=fs.readFileSync(path.join(root,'packaging/unified/owner-windows-legacy-migrate.ps1'),'utf8');
  assert.match(workflow,/node tools\/universal-install\/native-smoke\.mjs --run --expected-commit/);
  assert.doesNotMatch(workflow,/run: bash test\/unified-native-upgrade-smoke\.sh/);
  assert.doesNotMatch(workflow,/run: \.\/test\/unified-windows-owner-migration\.ps1/);
  assert.match(powershell, /RC012_WINDOWS_NATIVE_VERSION_DRIFT/);
  assert.match(powershell, /docs\/release-train-0\.12\.json/);
  assert.doesNotMatch(powershell, /\$version='0\.12\.0-dev\.[0-9]+'/);
  assert.match(migrate, /RC012_EXPLICIT_EXPECTED_VERSION_REQUIRED/);
  assert.doesNotMatch(migrate, /ExpectedVersion='0\.12\.0-dev\.[0-9]+'/);
});
