import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {
  compareNativeVersions,planManagedNativeUpdate,
  stageManagedNativeUpdate,applyStagedManagedNativeUpdate
} from '../tools/universal-install/native-managed-updater.mjs';
const sourceHead='a'.repeat(40),version='0.12.0';
const release={version,sourceHead,tag:'v0.12.0'};
const discover=()=>release;
const snapshot=version=>({
  version,registeredInstallCount:version===null?0:1,integrityVerified:true
});
const sha=b=>createHash('sha256').update(b).digest('hex');
const withDir=async fn=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-native-auto-'));
  try{await fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
};
test('automatic monotonic ordering across dev/stable and 1.0',()=>{
  for(const [a,b] of [['0.12.0','0.12.0-dev.10'],
    ['0.13.0-dev.1','0.12.0'],['1.0.0','0.99.9']])
    assert.equal(compareNativeVersions(a,b),1);
  for(const [a,b] of [['0.12.0-dev.9','0.12.0'],
    ['0.12.0','0.13.0'],['0.12.0','0.12.0']])
    assert.ok(compareNativeVersions(a,b)<=0);
});
test('current signed version is no-op, never reinstalled',async()=>{
  const result=await planManagedNativeUpdate({
    discover,snapshot:()=>snapshot(version)
  });
  assert.equal(result.status,'NO_NEWER_APPROVED_STABLE');
});
test('legacy dev.9 installed without managed receipt is blocked',async()=>withDir(async dir=>{
  await assert.rejects(planManagedNativeUpdate({
    discover,snapshot:()=>snapshot('0.12.0-dev.9'),
    receiptPath:path.join(dir,'absent.json')
  }),{code:'RC012_UPDATE_LEGACY_INSTALL_REQUIRES_APPROVED_BOOTSTRAP'});
}));
test('first signed stable release staged from matching official digest, idempotently',async()=>withDir(async dir=>{
  const name='Remote-Commander-Unified-'+version+
    (process.platform==='win32'?'-Windows-x64.exe':'-Linux-amd64.deb');
  const bytes=Buffer.alloc(7000,4),digest=sha(bytes);
  const download=(tool,args)=>{
    assert.equal(tool,'gh');
    if(args[0]==='api')return JSON.stringify({assets:[{
      name,digest:'sha256:'+digest,size:bytes.length,state:'uploaded'
    }]});
    assert.equal(args[0],'release');
    fs.writeFileSync(path.join(dir,version+'-'+sourceHead.slice(0,12),name),bytes);
    return '';
  };
  const verify=file=>{
    const p=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(p.installationKind,'fresh');
    assert.equal(p.previous,null);
    assert.equal(p.expectedCommit,sourceHead);
    assert.equal(p.candidate.sha256,digest);
    return {verified:true,sourceHead};
  };
  const args={discover,snapshot:()=>snapshot(null),root:dir,download,verify};
  const first=await stageManagedNativeUpdate(args);
  assert.equal(first.status,'SIGNED_NATIVE_STAGED_OWNER_CONSENT_REQUIRED');
  assert.equal(first.autoPromotion,false);
  assert.equal(first.nativeOwnerConsentRequired,true);
  const second=await stageManagedNativeUpdate(args);
  assert.deepEqual(second,first);
}));
test('over-budget asset rejected before any binary download',async()=>withDir(async dir=>{
  const name='Remote-Commander-Unified-'+version+
    (process.platform==='win32'?'-Windows-x64.exe':'-Linux-amd64.deb');
  let downloaded=false;
  const download=(tool,args)=>{
    if(args[0]==='release'){downloaded=true;throw Error('unexpected-write');}
    return JSON.stringify({assets:[{name,digest:'sha256:'+'f'.repeat(64),
      size:300*1024*1024,state:'uploaded'}]});
  };
  await assert.rejects(stageManagedNativeUpdate({
    discover,snapshot:()=>snapshot(null),root:dir,download
  }),{code:'RC012_UPDATE_ASSET_UNTRUSTED_OR_STORAGE_BUDGET'});
  assert.equal(downloaded,false);
}));
test('unattended native effect requires actual owner TTY, not silent approval',async()=>{
  let verified=false;
  await assert.rejects(applyStagedManagedNativeUpdate('/not-used',{
    ownerTTY:false,verify:()=>{verified=true;}
  }),{code:'RC012_UPDATE_NATIVE_OWNER_TTY_REQUIRED'});
  assert.equal(verified,false);
});
test('only verified owner native effect writes managed installation receipt',async()=>withDir(async dir=>{
  const file=path.join(dir,'manifest.json'),candidate=path.join(dir,'candidate.deb');
  fs.writeFileSync(file,JSON.stringify({expectedCommit:sourceHead,
    candidate:{version,path:candidate,sha256:'b'.repeat(64)}}));
  let invoked=0;
  const result=await applyStagedManagedNativeUpdate(file,{
    root:dir,ownerTTY:true,
    verify:()=>({verified:true,sourceHead,version,
      pinnedManifestSha256:'c'.repeat(64)}),
    nativeRun:()=>{invoked++;return {status:0};},
    snapshot:()=>snapshot(version)
  });
  assert.equal(invoked,1);
  assert.equal(result.status,'MANAGED_NATIVE_INSTALLED_VERIFIED');
  const receipt=JSON.parse(fs.readFileSync(path.join(dir,'managed-native.json'),'utf8'));
  assert.equal(receipt.verifiedNativeEffect,true);
  assert.equal(receipt.version,version);
}));
