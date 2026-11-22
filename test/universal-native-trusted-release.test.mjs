import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyTrustedNativeRelease,discoverTrustedStableRelease,REPO,SIGNER}
  from '../tools/universal-install/trusted-native-release.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const source='a'.repeat(40),version='0.12.0';
const platform=process.platform==='win32'?'windows':'linux';
function fixture(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-signed-auto-'));
  const name='Remote-Commander-Unified-'+version+'-'
    +(platform==='linux'?'Linux-amd64.deb':'Windows-x64.exe');
  const candidatePath=path.join(dir,name);
  const bytes=Buffer.alloc(8192,4);
  fs.writeFileSync(candidatePath,bytes);
  const provenanceManifestPath=path.join(dir,'provenance.json');
  fs.writeFileSync(provenanceManifestPath,JSON.stringify({schema:2,
    sourceHead:source,platform:platform==='windows'?'win32':'linux',
    candidate:{sha256:hash(bytes),bytes:bytes.length}}));
  const manifestPath=path.join(dir,'native.json');
  fs.writeFileSync(manifestPath,JSON.stringify({
    schema:'rc-universal-native-install-manifest-v1',
    product:'ChatGPTRemoteCommander',platform,
    architecture:os.arch(),installationKind:'fresh',expectedCommit:source,
    candidate:{path:candidatePath,sha256:hash(bytes),version},
    previous:null,provenanceManifestPath
  }));
  const release={tag_name:'v'+version,draft:false,
    prerelease:false,immutable:true,assets:[{
      name,state:'uploaded',digest:'sha256:'+hash(bytes),size:bytes.length
    }]};
  const train={sourceVersion:version,isStable:true,
    publishApproved:true,autoupdateApproved:true,
    installedPromotionApproved:true,channel:'stable'};
  const calls=[];
  function run(args){
    calls.push(args);
    if(args[0]==='attestation'){
      assert.deepEqual(args,[
        'attestation','verify',candidatePath,'--repo',REPO,
        '--source-ref','refs/tags/v'+version,'--source-digest',source,
        '--signer-workflow',SIGNER
      ]);
      return '{}';
    }
    assert.equal(args[0],'api');
    const endpoint=args[1];
    if(endpoint.endsWith('/releases/latest'))return JSON.stringify(release);
    if(endpoint.endsWith('/git/ref/tags/v'+version))
      return JSON.stringify({ref:'refs/tags/v'+version,
        object:{type:'commit',sha:source}});
    if(endpoint.includes('/contents/docs/release-train-0.12.json?ref=')){
      const raw=JSON.stringify(train);
      return JSON.stringify({encoding:'base64',
        content:Buffer.from(raw).toString('base64'),size:raw.length});
    }
    throw Error('UNEXPECTED_GH_CALL');
  }
  try{fn({dir,candidatePath,provenanceManifestPath,manifestPath,
    release,train,calls,run});}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('immutable official stable release computes provenance pin, without user hash',()=>fixture(f=>{
  const v=verifyTrustedNativeRelease(f.manifestPath,{run:f.run});
  assert.equal(v.verified,true);
  assert.equal(v.sourceHead,source);
  assert.equal(v.pinnedManifestSha256,
    hash(fs.readFileSync(f.provenanceManifestPath)));
  assert.equal(v.approvalIssued,false);
  assert.equal(v.promotionPerformed,false);
  assert.equal(f.calls.filter(c=>c[0]==='attestation').length,1);
}));
test('automatic release discovery refuses unsigned promotion, reports no silent OS approval',()=>fixture(f=>{
  const v=discoverTrustedStableRelease({run:f.run});
  assert.equal(v.status,'APPROVED_STABLE_RELEASE_FOUND');
  assert.equal(v.safeToInstallWithoutOSApproval,false);
  assert.equal(v.sourceHead,source);
}));
test('prerelease and mutable channel are fail closed before attestation',()=>fixture(f=>{
  f.release.prerelease=true;
  assert.throws(()=>verifyTrustedNativeRelease(f.manifestPath,{run:f.run}),
    {code:'RC012_AUTO_NO_IMMUTABLE_STABLE'});
  f.release.prerelease=false;f.release.immutable=false;
  assert.throws(()=>verifyTrustedNativeRelease(f.manifestPath,{run:f.run}),
    {code:'RC012_AUTO_NO_IMMUTABLE_STABLE'});
  assert.equal(f.calls.some(x=>x[0]==='attestation'),false);
}));
test('release train must explicitly approve autoupdate',()=>fixture(f=>{
  f.train.autoupdateApproved=false;
  assert.throws(()=>verifyTrustedNativeRelease(f.manifestPath,{run:f.run}),
    {code:'RC012_AUTO_TRAIN_NOT_APPROVED'});
  assert.equal(f.calls.some(x=>x[0]==='attestation'),false);
}));
test('tampered candidate blocked before signature verifier',()=>fixture(f=>{
  fs.writeFileSync(f.candidatePath,Buffer.alloc(8192,9));
  assert.throws(()=>verifyTrustedNativeRelease(f.manifestPath,{run:f.run}),
    {code:'RC012_AUTO_ARTIFACT_HASH_MISMATCH'});
}));
test('old dev.9 without attested stable rollback cannot silently update',()=>fixture(f=>{
  const old=path.join(f.dir,'dev9.exe'),b=Buffer.alloc(8192,6);
  fs.writeFileSync(old,b);
  const m=JSON.parse(fs.readFileSync(f.manifestPath,'utf8'));
  m.installationKind='upgrade';m.previous={
    path:old,version:'0.12.0-dev.9',sha256:hash(b)};
  fs.writeFileSync(f.manifestPath,JSON.stringify(m));
  assert.throws(()=>verifyTrustedNativeRelease(f.manifestPath,{run:f.run}),
    {code:'RC012_AUTO_UNATTESTED_LEGACY_ROLLBACK'});
}));
test('provenance manifest mismatch cannot forge user pin',()=>fixture(f=>{
  const p=JSON.parse(fs.readFileSync(f.provenanceManifestPath,'utf8'));
  p.candidate.sha256='f'.repeat(64);
  fs.writeFileSync(f.provenanceManifestPath,JSON.stringify(p));
  assert.throws(()=>verifyTrustedNativeRelease(f.manifestPath,{run:f.run}),
    {code:'RC012_AUTO_PROVENANCE_BINDING_FAILED'});
}));
test('attestation verifier failure never becomes a trusted receipt',()=>fixture(f=>{
  const run=args=>{
    if(args[0]==='attestation')throw Error('SIGNATURE_INVALID');
    return f.run(args);
  };
  assert.throws(()=>verifyTrustedNativeRelease(f.manifestPath,{run}),
    /SIGNATURE_INVALID/);
}));
