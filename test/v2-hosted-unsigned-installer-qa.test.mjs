import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {patchDebAnchor,patchYaml,PINS as NATIVE_STAGE_PINS} from '../tools/v2-deb-native-packager-stage.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const load=name=>fs.readFileSync(new URL(name,new URL('../',import.meta.url)),'utf8');

test('V2 installer workflow runs only on scoped candidate changes, hosted runner matrix and read-only checkout',()=>{
 const body=load('.github/workflows/v2-unsigned-installer-qa.yml');
 assert.match(body,/branches: \[mmz\/v2-unified-candidate-20261103\]/);
 assert.match(body,/paths:\s*\n\s*- '\.github\/workflows\/v2-unsigned-installer-qa.yml'/);
 assert.match(body,/workflow_dispatch:/);
 assert.match(body,/permissions:\s*\n\s*contents: read/);
 assert.match(body,/runs-on: ubuntu-24\.04/);
 assert.match(body,/runs-on: windows-2022/);
 assert.match(body,/persist-credentials: false/g);
 assert.ok(!body.includes('secrets.'));
 assert.ok(!body.includes('self-hosted'));
 assert.ok(!body.includes('main]'));
});
test('release acquisition is fixed to the exact published unsigned QA artifacts and pinned hashes',()=>{
 const linux=load('tools/v2-unsigned-installer-hosted-linux.sh');
 const win=load('tools/v2-unsigned-installer-hosted-windows.ps1');
 for(const source of [linux,win]){
  assert.match(source,/commander-v2\.1\.50-unsigned-qa\.readonlyfix\.20261105/);
  assert.match(source,/GOD13emad\/ChatGPTRemoteCommander/);
  assert.ok(!source.includes('curl | sh'));
  assert.ok(!source.includes('iex('));
 }
 assert.match(linux,/e16d14114b877c7389b05f97215b95077aafd854803292fcb689c0f04c98df12/);
 assert.match(win,/823cf44f3f63710bbf44a2a69490fef96445a676325041da2e46cb3d04f49076/);
 assert.match(linux,/sha256sum -c --status/);
 assert.match(win,/Get-FileHash/);
});
test('real installer lifecycle cannot begin on an ordinary owner session',()=>{
 const linux=load('tools/v2-unsigned-installer-hosted-linux.sh');
 const win=load('tools/v2-unsigned-installer-hosted-windows.ps1');
 for(const s of [linux,win]){
  assert.match(s,/GITHUB_ACTIONS/);
  assert.match(s,/RUNNER_ENVIRONMENT/);
  assert.match(s,/GITHUB_REPOSITORY/);
  assert.match(s,/RUNNER_OS/);
  assert.match(s,/HOSTED_.*ONLY_DENY/);
 }
 assert.match(linux,/apt-get install -y/);
 assert.match(linux,/apt-get purge -y/);
 assert.match(win,/RunOwned \$download '\/S'/);
 assert.match(win,/RunOwned \$uninstaller '\/S'/);
 assert.match(win,/InstallEntries/);
});


test('old to patched same-semver upgrade/rollback is pinned, observable and hosted-only',()=>{
 const workflow=load('.github/workflows/v2-unsigned-installer-qa.yml');
 assert.match(workflow,/qa-inplace-linux:/);
 assert.match(workflow,/qa-inplace-windows:/);
 assert.match(workflow,/run: bash tools\/v2-unsigned-installer-inplace-linux.sh/);
 assert.match(workflow,/run: .\/tools\/v2-unsigned-installer-inplace-windows.ps1/);
 for(const [file,oldHash,newHash] of [
  ['tools/v2-unsigned-installer-inplace-linux.sh','93d3e3632b13d4bda26f02d76a2108a514829900335a3e27ac135b021fc09995','e16d14114b877c7389b05f97215b95077aafd854803292fcb689c0f04c98df12'],
  ['tools/v2-unsigned-installer-inplace-windows.ps1','58f6ae3e10e56f1effb030ef929ab78c2de0623204e370efce8b80c4779caa65','823cf44f3f63710bbf44a2a69490fef96445a676325041da2e46cb3d04f49076']
 ]){
  const s=load(file);
  for(const word of ['GITHUB_ACTIONS','RUNNER_ENVIRONMENT','GITHUB_REPOSITORY','RUNNER_OS',
      'commander-v2.1.50-unsigned-qa.20261105','commander-v2.1.50-unsigned-qa.readonlyfix.20261105',
      oldHash,newHash,'1202e46e59162946452a255b03db98de77bd7bf81b978e3a1c867d2490937c64'])
   assert.ok(s.includes(word),file+': '+word);
  assert.ok(!s.includes('self-hosted'));
  assert.ok(!s.includes('GITHUB_TOKEN'));
 }
 const linux=load('tools/v2-unsigned-installer-inplace-linux.sh');
 assert.match(linux,/apt-get install -y --reinstall.*new.deb/);
 assert.match(linux,/apt-get install -y --reinstall.*old.deb/);
 assert.match(linux,/apt-get purge -y commander-v2/);
 const windows=load('tools/v2-unsigned-installer-inplace-windows.ps1');
 assert.match(windows,/RunOwned \$old '\/S'/g);
 assert.match(windows,/RunOwned \$new '\/S'/);
 assert.match(windows,/RunOwned \$reverted.uninstaller '\/S'/);
 assert.match(windows,/REGISTRATION_COUNT/);
 // A disposable userData marker must survive patch/revert/uninstall; no
 // secret or active owner profile is copied onto the hosted machine.
 assert.match(linux,/V2_REPLACE_LINUX_SYNTHETIC_OWNER_STATE_PRESERVED_PASS/);
 assert.match(windows,/V2_REPLACE_WINDOWS_SYNTHETIC_OWNER_STATE_PRESERVED_PASS/);
 assert.match(linux,/checkstate\(\)/);
 assert.match(windows,/function VerifyState/);
 assert.match(linux,/V2_HOSTED_SYNTHETIC_STATE_PRESERVE/);
 assert.match(windows,/V2_HOSTED_SYNTHETIC_STATE_PRESERVE/);
 assert.match(windows,/\(Test-Path -LiteralPath \$old\) -or \(Test-Path -LiteralPath \$new\)/);
 assert.doesNotMatch(windows,/Test-Path \$old -or Test-Path/);
});


test('candidate DEB pre-remove hook is opt-in, package-scoped, idempotent and tested only in hosted Ubuntu',()=>{
 const wf=load('.github/workflows/v2-unsigned-installer-qa.yml');
 assert.match(wf,/qa-deb-prerm:/);
 assert.match(wf,/run: bash tools\/v2-deb-prerm-hosted-qa.sh/);
 const hook=load('tools/v2-deb-alternatives-prerm.sh');
 const qa=load('tools/v2-deb-prerm-hosted-qa.sh');
 assert.match(hook,/case "\$1" in remove\|upgrade/);
 assert.match(hook,/update-alternatives --query commander-v2/);
 assert.match(hook,/Alternative: \/opt\/Commander V2\/commander-v2/);
 assert.match(hook,/update-alternatives --remove commander-v2/);
 assert.doesNotMatch(hook,/rm -rf|\.\*\/|chmod 4/);
 for(const guard of ['GITHUB_ACTIONS','RUNNER_ENVIRONMENT','GITHUB_REPOSITORY','RUNNER_OS','HOSTED_ONLY_DENY']){
  assert.ok(qa.includes(guard));
 }
 assert.match(qa,/sha256sum -c --status/);
 assert.match(qa,/dpkg-deb --build --root-owner-group/);
 assert.match(qa,/chmod 0755.*unpacked\/DEBIAN/);
 assert.match(qa,/V2_PRERM_DISPOSABLE_INSTALL_PURGE_NO_ALTERNATIVES_WARNING_PASS/);
 assert.match(qa,/e16d14114b877c7389b05f97215b95077aafd854803292fcb689c0f04c98df12/);
});


test('DEB pre-remove hook refuses a foreign alternative and only removes its own',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cmdv2-prerm-mock-'));
 const hook=fileURLToPath(new URL('../tools/v2-deb-alternatives-prerm.sh',import.meta.url));
 try{
  const output=path.join(dir,'events');
  const mock=path.join(dir,'update-alternatives');
  fs.writeFileSync(mock,[
   '#!/bin/sh',
   'if [ "$1" = "--query" ];then',
   ' if [ "$MOCK_ABSENT" = yes ];then exit 2;fi',
   ' printf "%s\\n" "$MOCK_RESULT"',
   'elif [ "$1" = "--remove" ];then',
   ' printf "%s\\n" "$2:$3" >> "$MOCK_EVENTS"',
   'else exit 72;fi',
   ''
  ].join('\n'),{mode:0o700});
  const run=(action,result,absent=false)=>{
   fs.rmSync(output,{force:true});
   const r=spawnSync('/bin/sh',[hook,action],{
    env:{...process.env,PATH:dir+':'+process.env.PATH,
      MOCK_EVENTS:output,MOCK_RESULT:result,MOCK_ABSENT:absent?'yes':'no'},
    encoding:'utf8',timeout:2500
   });
   assert.equal(r.status,0,r.stderr);
   return fs.existsSync(output)?fs.readFileSync(output,'utf8').trim():'';
  };
  const own='Alternative: /opt/Commander V2/commander-v2';
  assert.equal(run('configure',own),'');
  assert.equal(run('remove','Alternative: /usr/bin/foreign'),'');
  assert.equal(run('remove',own,true),'');
  assert.equal(run('remove',own),'commander-v2:/opt/Commander V2/commander-v2');
  assert.equal(run('upgrade',own),'commander-v2:/opt/Commander V2/commander-v2');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});


test('native FPM packaging stage is anchored to exact vendor QA and verified hook source',()=>{
 const hash=createHash('sha256').update(load('tools/v2-deb-alternatives-prerm.sh')).digest('hex');
 assert.equal(hash,NATIVE_STAGE_PINS.hook);
 const source='deb:\n  packageName: commander-v2\n  depends:\n    - libnss3\n';
 const modified=patchDebAnchor(source);
 assert.match(modified,/deb:\n  packageName: commander-v2\n  fpm:\n    - "--before-remove=build\/v2-deb-alternatives-prerm.sh"\n  depends:/);
 assert.throws(()=>patchDebAnchor(modified),/ANCHOR_CHANGED/);
 assert.throws(()=>patchYaml(source),/BASELINE_CHANGED/);
 const integration=load('tools/v2-deb-native-packager-stage.mjs');
 assert.match(integration,/V2_COS_DISPOSABLE_SOURCE_QA_ONLY/);
 assert.match(integration,/v2-prerm-stage.lock/);
 assert.match(integration,/nativePackageBuilt:false/);
 assert.doesNotMatch(integration,/sudo|rm -rf|PUBLIC_RELEASE_CREATED/);
});
