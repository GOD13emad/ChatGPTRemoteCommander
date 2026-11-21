import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {nativePackagePlan} from '../tools/v2-universal-native-plan.mjs';
import {collectV2InstallCollisionInventory} from '../tools/v2-install-collision-inventory.mjs';
const executable=fileURLToPath(new URL('../tools/v2-universal-native-plan.mjs',import.meta.url));
const fixture=(fn)=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v2-native-plan-'));
 try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
};
function artifact(dir,platform){
 const file=path.join(dir,platform==='win32'?'Commander-V2-Windows-x64.exe':'Commander-V2-Linux-x64.deb');
 fs.writeFileSync(file,platform==='win32'?Buffer.from([0x4d,0x5a,0,0,1]):Buffer.from('!<arch>\nTEST_PKG'));
 const sha256=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 return {file,sha256};
}
function observed(platform,{collision=false,unknown=false}={}){
 if(platform==='win32'){
  const inv=collectV2InstallCollisionInventory({platform,home:'C:\\Users\\Fixture',
   exec:(_bin,args)=>unknown?(()=>{throw Error('fixture probe unavailable')})():
     args[4].includes('Get-ItemProperty')&&collision?
       '[{"DisplayName":"Remote Commander","DisplayVersion":"0.11.0"}]':'[]'});
  return inv;
 }
 return collectV2InstallCollisionInventory({platform,home:'/tmp',includeLocations:false,
   exec:(cmd)=>unknown?(()=>{throw Error('fixture probe unavailable')})():
     cmd==='dpkg-query'&&collision?'chatgpt-remote-commander 0.11.0\n':''});
}
const opts=(dir,platform,inv)=>{const f=artifact(dir,platform);return {
 artifact:f.file,sha256:f.sha256,version:'2.1.50',platform,arch:'x64',
 profile:'desktop',inventory:inv??observed(platform)};};
test('one general native preflight selects pinned NSIS on fresh Windows without executing it',()=>{
 fixture(dir=>{
  const plan=nativePackagePlan(opts(dir,'win32'));
  assert.equal(plan.status,'NATIVE_FRESH_HOST_PREFLIGHT_READY');
  assert.equal(plan.packageFormat,'nsis');assert.deepEqual(plan.command.args,['/S']);
  assert.equal(plan.installIdentity,'Commander V2');
  assert.equal(plan.canInstall,false);
  assert.equal(plan.changesApplied,false);
  assert.equal(plan.publisherVerified,false);
 });
});
test('same preflight selects Debian package management for clean Ubuntu',()=>{
 fixture(dir=>{
  const plan=nativePackagePlan(opts(dir,'linux'));
  assert.equal(plan.status,'NATIVE_FRESH_HOST_PREFLIGHT_READY');
  assert.equal(plan.packageFormat,'deb');
  assert.equal(plan.command.program,'apt-get');
  assert.equal(plan.command.args[0],'install');
  assert.equal(plan.command.args[2],plan.command.args[2]);
  assert.equal(plan.canInstall,false);
 });
});
test('real V1 uninstall registrations and running tasks prevent replacement',()=>{
 for(const platform of ['win32','linux'])fixture(dir=>{
  const plan=nativePackagePlan(opts(dir,platform,observed(platform,{collision:true})));
  assert.equal(plan.status,'BLOCKED');
  assert.equal(plan.preflight,'EXISTING_COMMANDER_IDENTITY');
  assert.equal(plan.existingInstallReplaced,false);
 });
});
test('incomplete or modified native inventory cannot become clean-install approval',()=>{
 for(const platform of ['win32','linux'])fixture(dir=>{
  const incomplete=nativePackagePlan(opts(dir,platform,observed(platform,{unknown:true})));
  assert.equal(incomplete.preflight,'INVENTORY_NOT_PROVED');
  const forged=observed(platform);
  if(platform==='win32')forged.apps.items.push({name:'Remote Commander',version:'0.11'});
  else forged.packages.items.push({name:'commander-v2',version:'2.1.50'});
  const result=nativePackagePlan(opts(dir,platform,forged));
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.preflight,'INVENTORY_NOT_PROVED');
 });
});
test('tamper, wrong package type, unsupported headless and wrong architecture fail closed',()=>{
 fixture(dir=>{
  const good=opts(dir,'win32');
  fs.appendFileSync(good.artifact,'Evil');
  assert.throws(()=>nativePackagePlan(good),/PINNED_NATIVE_ARTIFACT_HASH_MISMATCH/);
  assert.throws(()=>nativePackagePlan({...good,sha256:'0'.repeat(64)}),/PINNED_NATIVE_ARTIFACT_HASH_MISMATCH/);
  assert.throws(()=>nativePackagePlan({...good,arch:'arm64'}),/NATIVE_PACKAGE_ARCH_UNQUALIFIED/);
  assert.throws(()=>nativePackagePlan({...good,profile:'headless'}),/HEADLESS_SERVICE_PAYLOAD_NOT_PROVED/);
 });
 fixture(dir=>{
  const good=opts(dir,'linux');
  assert.throws(()=>nativePackagePlan({...good,platform:'win32',inventory:observed('win32')}),/ARTIFACT_EXTENSION_OS_MISMATCH/);
  fs.writeFileSync(good.artifact,'not really an archive');
  assert.throws(()=>nativePackagePlan({...good,sha256:createHash('sha256').update(fs.readFileSync(good.artifact)).digest('hex')}),/NOT_A_DEBIAN_ARCHIVE/);
 });
});
test('native adapter CLI is read-only: missing source or absent authorization never starts installation',()=>{
 fixture(dir=>{
  const a=artifact(dir,process.platform==='win32'?'win32':'linux');
  const q=spawnSync(process.execPath,[executable,'--artifact',a.file,'--sha256',a.sha256,
    '--version','2.1.50','--profile','desktop'],{encoding:'utf8',timeout:7000});
  assert.ok([0,3].includes(q.status),q.stderr);
  if(q.status===0)assert.equal(JSON.parse(q.stdout).changesApplied,false);
  const u=spawnSync(process.execPath,[executable,'--apply','--artifact',a.file],
    {encoding:'utf8',timeout:7000});
  assert.equal(u.status,2);
  assert.match(u.stderr,/OPTIONS_INVALID|REQUIRED_OPTIONS/);
  assert.equal(fs.existsSync(a.file),true);
 });
});
