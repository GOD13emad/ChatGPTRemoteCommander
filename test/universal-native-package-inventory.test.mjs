import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {
  compareNativeArchiveToInstalled,compareNativePackageToInstalled
} from '../tools/universal-install/native-package-inventory.mjs';

const fixture='N3q8ryccAARYlu6JcwAAAAAAAAAgAAAAAAAAAPDTbstGSUxFX09ORV9BTFBIQUZJTEVfVFdPX0JFVEEhAACBMweuMZk+UB/C23rL4jEwL51hkMGIhCP/OIZTc2POB3irrwMnuuggfNwsIYuWBbNfUX/8LWm9mACd+j0ephE/dvDOpXZNsqEWttoR1sd7zduVHQAAFwYcAQlXAAcLAQABIwMBAQVdABAAAAx2CgEjzIaBAAA=';
const sha=x=>createHash('sha256').update(x).digest('hex');
function files(){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rc-native-archive-qa-'));
  const root=path.join(temp,'installed');
  fs.mkdirSync(root,{recursive:true});
  fs.writeFileSync(path.join(root,'aaa.txt'),'FILE_ONE_ALPHA');
  fs.writeFileSync(path.join(root,'bbb.txt'),'FILE_TWO_BETA!');
  const inner=path.join(temp,'payload.tar');
  const r=spawnSync(process.platform==='win32'?'tar.exe':'tar',
    ['-cf',inner,'-C',root,'aaa.txt','bbb.txt'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  return {temp,root,inner};
}
test('platform-neutral archived inventory proves exact bytes, not version or file names',async()=>{
  const f=files();
  try{
    const result=await compareNativeArchiveToInstalled({
      archivePath:f.inner,installedRoot:f.root
    });
    assert.equal(result.fileCount,2);
    assert.equal(result.match,2);
    assert.equal(result.payloadMatch,true);
    assert.equal(result.archiveMembersVerified,true);
    assert.equal(result.completeInventory,false);
    assert.equal(result.archivedPayloadSha256,result.installedPayloadSha256);
    fs.writeFileSync(path.join(f.root,'bbb.txt'),'FILE_TWO_DRIFT');
    const changed=await compareNativeArchiveToInstalled({
      archivePath:f.inner,installedRoot:f.root
    });
    assert.equal(changed.payloadMatch,false);
    assert.equal(changed.match,1);
    assert.deepEqual(changed.mismatches,['bbb.txt']);
    fs.rmSync(path.join(f.root,'aaa.txt'));
    const absent=await compareNativeArchiveToInstalled({
      archivePath:f.inner,installedRoot:f.root
    });
    assert.equal(absent.missing,1);
    assert.equal(absent.payloadMatch,false);
  }finally{fs.rmSync(f.temp,{recursive:true,force:true});}
});
test('native NSIS 7z is verified or fails closed when the host lacks LZMA support',async()=>{
  if(process.platform!=='win32')return;
  const f=files();
  try{
    const pkg=path.join(f.temp,'installer.exe');
    const bytes=Buffer.concat([
      Buffer.alloc(123456,0x31),Buffer.from(fixture,'base64'),
      Buffer.alloc(4096,0x32)
    ]);
    fs.writeFileSync(pkg,bytes);
    const inner=path.join(f.temp,'probe.7z');
    fs.writeFileSync(inner,Buffer.from(fixture,'base64'));
    const probe=spawnSync('tar.exe',['-tf',inner],{encoding:'utf8'});
    if(probe.status!==0&&/LZMA codec is unsupported/i.test(probe.stderr)){
      await assert.rejects(compareNativePackageToInstalled({
        platform:'windows',packagePath:pkg,installedRoot:f.root,
        expectedPackageSha256:sha(bytes)
      }),{code:'NATIVE_BASELINE_ARCHIVE_CODEC_UNAVAILABLE'});
      return;
    }
    assert.equal(probe.status,0,probe.stderr);
    const ok=await compareNativePackageToInstalled({
      platform:'windows',packagePath:pkg,installedRoot:f.root,
      expectedPackageSha256:sha(bytes)
    });
    assert.equal(ok.fileCount,2);
    assert.equal(ok.payloadMatch,true);
    assert.equal(ok.archiveMembersVerified,true);
    assert.equal(ok.completeInventory,false);
    assert.equal(ok.packageSha256,sha(bytes));
    await assert.rejects(compareNativePackageToInstalled({
      platform:'windows',packagePath:pkg,installedRoot:f.root,
      expectedPackageSha256:'0'.repeat(64)
    }),{code:'NATIVE_BASELINE_PACKAGE_SHA_MISMATCH'});
    const bad=Buffer.from(bytes);
    bad[123456+8]^=1;
    fs.writeFileSync(pkg,bad);
    await assert.rejects(compareNativePackageToInstalled({
      platform:'windows',packagePath:pkg,installedRoot:f.root,
      expectedPackageSha256:sha(bad)
    }),{code:'NATIVE_BASELINE_NSIS_START_CRC_INVALID'});
  }finally{fs.rmSync(f.temp,{recursive:true,force:true});}
});
test('native archive inventory excludes symlinks, traversal, hostile platform and stale hash',async()=>{
  const f=files();
  try{
    const wrong=process.platform==='win32'?'linux':'windows';
    await assert.rejects(compareNativePackageToInstalled({
      platform:wrong,packagePath:f.inner,installedRoot:f.root,
      expectedPackageSha256:sha(fs.readFileSync(f.inner))
    }),{code:'NATIVE_BASELINE_PLATFORM_MISMATCH'});
    fs.rmSync(path.join(f.root,'aaa.txt'));
    try{
      fs.symlinkSync(path.join(f.temp,'bbb.txt'),path.join(f.root,'aaa.txt'));
      const result=await compareNativeArchiveToInstalled({
        archivePath:f.inner,installedRoot:f.root
      });
      assert.equal(result.payloadMatch,false);
      assert.equal(result.unsafe>0,true);
    }catch(error){
      // Windows without CreateSymbolicLinkPrivilege cannot create a test link.
      if(error.code!=='EPERM'&&error.code!=='EACCES')throw error;
    }
  }finally{fs.rmSync(f.temp,{recursive:true,force:true});}
});
