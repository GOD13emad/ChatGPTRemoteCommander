import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {installNativeFresh} from '../tools/v2-universal-native-install.mjs';
import {collectV2InstallCollisionInventory} from '../tools/v2-install-collision-inventory.mjs';

const cli=fileURLToPath(new URL('../tools/v2-universal-native-install.mjs',import.meta.url));
function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v2-native-install-executor-'));
 try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function pkg(dir){
 const win=process.platform==='win32';
 const artifact=path.join(dir,win?'Commander-V2-Windows-x64.exe':'Commander-V2-Linux-x64.deb');
 fs.writeFileSync(artifact,win?Buffer.from('MZ_fake_NativeQA'):Buffer.from('!<arch>\nFAKE_QA'));
 return {artifact,sha256:createHash('sha256').update(fs.readFileSync(artifact)).digest('hex')};
}
function inventory({collision=false,incomplete=false}={}){
 if(process.platform==='win32'){
  return collectV2InstallCollisionInventory({platform:'win32',home:'C:\\Users\\Test',
   exec:(_bin,args)=>{
    if(incomplete)throw Error('INCOMPLETE');
    return collision&&args[4].includes('Get-ItemProperty')?
      '[{"DisplayName":"Commander V2","DisplayVersion":"2.1.49"}]':'[]';
   }});
 }
 return collectV2InstallCollisionInventory({platform:'linux',home:'/tmp',includeLocations:false,
  exec:(bin)=>{
   if(incomplete)throw Error('INCOMPLETE');
   return collision&&bin==='dpkg-query'?'commander-v2 2.1.49\n':'';
  }});
}
const args=(dir,extra={})=>({...pkg(dir),version:'2.1.50',
 inventory:inventory(),approval:true,allowUnsigned:true,...extra});
test('explicit owner and unsigned QA approval required before any OS mutation',()=>{
 fixture(dir=>{
  const a=args(dir);let executed=false;
  const call={...a,invoke:()=>{executed=true},verify:()=>true};
  assert.throws(()=>installNativeFresh({...call,approval:false}),/NATIVE_OWNER_APPROVAL_REQUIRED/);
  assert.throws(()=>installNativeFresh({...call,allowUnsigned:false}),/UNSIGNED_QA_NOT_AUTHORIZED/);
  assert.equal(executed,false);
 });
});
test('one generic runner selects native OS package install and verifies one OS identity',()=>{
 fixture(dir=>{
  const a=args(dir);const calls=[];
  const result=installNativeFresh({...a,invoke:(bin,arguments_)=>calls.push({bin,args:arguments_}),
   verify:version=>version==='2.1.50'});
  assert.equal(result.status,'NATIVE_FRESH_INSTALL_VERIFIED');
  assert.equal(result.oneOsInstallIdentityVerified,true);
  assert.equal(result.ownerStateMigrated,false);
  assert.equal(result.fullPowerAuthorized,false);
  assert.equal(calls.length,1);
  const call=calls[0];
  if(process.platform==='win32'){
   assert.equal(call.bin,a.artifact);assert.deepEqual(call.args,['/S']);
  }else{
   assert.ok(['sudo','env'].includes(call.bin));
   assert.ok(call.args.includes('apt-get'));
   assert.ok(call.args.includes(a.artifact));
  }
 });
});
test('existing native package and incomplete collision inventory deny execution',()=>{
 fixture(dir=>{
  for(const inv of [inventory({collision:true}),inventory({incomplete:true})]){
   let executed=false;
   assert.throws(()=>installNativeFresh(args(dir,{inventory:inv,invoke:()=>{executed=true},verify:()=>true})),
    /EXISTING_INSTALL_OR_INVENTORY_NOT_VERIFIED/);
   assert.equal(executed,false);
  }
 });
});
test('artifact pin mismatch denies execution without altering existing files',()=>{
 fixture(dir=>{
  const a=args(dir);const old=fs.readFileSync(a.artifact);
  let executed=false;
  assert.throws(()=>installNativeFresh({...a,sha256:'0'.repeat(64),invoke:()=>{executed=true}}),
   /PINNED_NATIVE_ARTIFACT_HASH_MISMATCH/);
  assert.equal(executed,false);
  assert.deepEqual(fs.readFileSync(a.artifact),old);
 });
});
test('unsupported headless package is never treated as a full service installation',()=>{
 fixture(dir=>{
  let executed=false;
  assert.throws(()=>installNativeFresh(args(dir,{profile:'headless',
   invoke:()=>{executed=true}})),/HEADLESS_SERVICE_PAYLOAD_NOT_PROVED/);
  assert.equal(executed,false);
 });
});
test('operating system installer errors cannot be returned as installation PASS',()=>{
 fixture(dir=>{
  assert.throws(()=>installNativeFresh(args(dir,{invoke:()=>{throw Error('fixture OS denied')},
   verify:()=>true})),/fixture OS denied/);
 });
});
test('CLI refuses accidental apply without explicit unsigned-asset opt in',()=>{
 fixture(dir=>{
  const a=args(dir),calls=spawnSync(process.execPath,[cli,'--artifact',a.artifact,
   '--sha256',a.sha256,'--version',a.version,'--apply'],{encoding:'utf8',timeout:10000});
  assert.equal(calls.status,2);
  assert.match(calls.stderr,/UNSIGNED_QA_NOT_AUTHORIZED/);
 });
});
