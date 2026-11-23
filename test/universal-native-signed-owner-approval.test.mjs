import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {verifiedAttestationSubject,verifySignedNativeRelease,
  verifyPublicSignedNativeRelease,publicNativeAttestationBundles,
  officialNativeVerifierBinary,assertSafeGhVerifierVersion}
  from '../tools/universal-install/signed-native-provenance.mjs';
import {windowsGuiApprovalScript}
  from '../tools/universal-install/native-cli.mjs';

const candidateSha='b'.repeat(64),head='a'.repeat(40);
function verifiedJson(name,sha=candidateSha){
  return JSON.stringify([{
    verificationResult:{
      statement:{predicateType:'https://slsa.dev/provenance/v1',
        subject:[{name,digest:{sha256:sha}}]},
      signature:{certificate:{
        sourceRepositoryIdentifier:'1374266155',
        sourceRepositoryOwnerIdentifier:'94546844',
        sourceRepositoryURI:'https://github.com/GOD13emad/ChatGPTRemoteCommander',
        sourceRepositoryDigest:head,runnerEnvironment:'github-hosted',
        issuer:'https://token.actions.githubusercontent.com',
        sourceRepositoryRef:'refs/heads/fix/rc012-owner-gui-consent-source-20261123',
        githubWorkflowRef:'refs/heads/fix/rc012-owner-gui-consent-source-20261123',
        githubWorkflowRepository:'GOD13emad/ChatGPTRemoteCommander',
        githubWorkflowSHA:head,buildSignerDigest:head,
        subjectAlternativeName:'https://github.com/GOD13emad/ChatGPTRemoteCommander/.github/workflows/unified-installer-pilot.yml@refs/heads/fix/rc012-owner-gui-consent-source-20261123',
        buildSignerURI:'https://github.com/GOD13emad/ChatGPTRemoteCommander/.github/workflows/unified-installer-pilot.yml@refs/heads/fix/rc012-owner-gui-consent-source-20261123',
        buildConfigURI:'https://github.com/GOD13emad/ChatGPTRemoteCommander/.github/workflows/unified-installer-pilot.yml@refs/heads/fix/rc012-owner-gui-consent-source-20261123'
      }},
      verifiedIdentity:{subjectAlternativeName:{regexp:'verified-by-cli'}}
    }
  }]);
}
test('Windows one-click script is a real owner-session Yes/No UI, never a typed hash',()=>{
  const plan={installedVersion:'0.12.0-dev.9',
    candidate:{version:'0.12.0-dev.10'},
    transactionId:"user-manifest-'$($evil)-"+'c'.repeat(64)};
  const script=windowsGuiApprovalScript(plan);
  assert.match(script,/System\.Windows\.Forms\.MessageBox/);
  assert.match(script,/System\.Windows\.Forms\.MessageBoxButtons\]::YesNo/);
  assert.match(script,/MessageBoxDefaultButton\]::Button2/);
  assert.match(script,/\$hostForm\.TopMost=\$true/);
  assert.match(script,/MessageBox\]::Show\(\$hostForm,\$message/);
  assert.match(script,/\$hostForm\.Dispose\(\)/);
  assert.match(script,/UserInteractive/);
  assert.match(script,/SessionId -le 0/);
  assert.ok(script.includes('\n'),'PowerShell script must have actual line breaks');
  assert.doesNotMatch(script,/\$\(\$evil\)/,
    'an untrusted transaction string cannot become a PowerShell expression');
  const encoded=script.match(/FromBase64String\('([^']+)'\)/)?.[1];
  assert.ok(encoded);
  assert.match(Buffer.from(encoded,'base64').toString('utf8'),/user-manifest-'\$\(\$evil\)/);
  assert.match(script,/DialogResult\]::Yes/);
});
test('signed candidate uses official pinned repo/source/signer and refuses bad results',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-signed-owner-'));
  const candidate=path.join(dir,'Remote-Commander-Unified-0.12.0-dev.10-Linux-amd64.deb');
  const manifest=path.join(dir,'provenance.json');
  try{
    fs.writeFileSync(candidate,Buffer.alloc(4096,97),{flag:'wx'});
    fs.writeFileSync(manifest,JSON.stringify({schema:1,sourceHead:head,platform:'linux',
      candidate:{sha256:candidateSha,bytes:4096},
      rollback:{sha256:'c'.repeat(64),bytes:4096}}),{flag:'wx'});
    const calls=[];
    const run=(exe,a,opts)=>{
      calls.push({exe,a,opts});
      if(a[0]==='--version')
        return {status:0,stdout:'gh version 2.103.2 (2026-10-23)'};
      return {status:0,stdout:verifiedJson(path.basename(candidate))};
    };
    const approved=verifySignedNativeRelease({
      manifestPath:manifest,candidatePath:candidate,
      expectedCommit:head,platform:'linux'
    },{run});
    assert.equal(approved.signedCandidateVerified,true);
    assert.equal(approved.rollbackSignatureVerified,false,
      'never claim an unsigned baseline is signed');
    assert.match(approved.manifestSha256,/^[a-f0-9]{64}$/);
    assert.equal(calls.length,2);
    assert.equal(calls[0].exe,calls[1].exe,
      'the binary version inspected must be the binary that signs off the package');
    assert.deepEqual(calls[0].a,['--version']);
    assert.ok(calls[0].opts.timeout<=5000);
    assert.ok(calls[0].opts.maxBuffer<=8192);
    const args=calls[1].a;
    assert.deepEqual(args.slice(0,3),['attestation','verify',candidate]);
    assert.ok(args.includes('--source-digest')&&args.includes(head));
    assert.ok(args.includes('--signer-workflow'));
    assert.ok(args.includes('--deny-self-hosted-runners'));
    assert.throws(()=>verifySignedNativeRelease({
      manifestPath:manifest,candidatePath:candidate,expectedCommit:head,platform:'linux'
    },{run:(_exe,a)=>a[0]==='--version'
      ?{status:0,stdout:'gh version 2.103.2 (2026-10-23)'}
      :{status:1,stdout:''}}),/UNIVERSAL_NATIVE_SIGSTORE_VERIFICATION_FAILED/);
    assert.throws(()=>verifySignedNativeRelease({
      manifestPath:manifest,candidatePath:candidate,expectedCommit:head,platform:'linux'
    },{run:(_exe,a)=>a[0]==='--version'
      ?{status:0,stdout:'gh version 2.103.2 (2026-10-23)'}
      :{status:0,stdout:verifiedJson('other.exe')}}),
    /UNIVERSAL_NATIVE_SIGSTORE_SUBJECT_MISMATCH/);
    for(const bad of ['gh version 2.101.0 (2026-10-01)',
      'gh version 2.51.0 (2025-01-01)','gh version 2.102.0-rc1',
      'gh version totally-unknown','gh version 2.101.999 (2026-10-01)']){
      let invoked=0;
      assert.throws(()=>verifySignedNativeRelease({
        manifestPath:manifest,candidatePath:candidate,expectedCommit:head,platform:'linux'
      },{run:(exe,a)=>{
        invoked++;
        assert.deepEqual(a,['--version']);
        return {status:0,stdout:bad};
      }}),/UNIVERSAL_NATIVE_SIGSTORE_VERIFIER_VERSION_(UNSAFE|INVALID)/);
      assert.equal(invoked,1,'unsafe CLI must never invoke attestation verification');
    }
    assert.throws(()=>verifySignedNativeRelease({
      manifestPath:manifest,candidatePath:candidate,expectedCommit:head,platform:'linux'
    },{run:()=>({status:1,stdout:'gh version 2.103.2'})}),
    /UNIVERSAL_NATIVE_SIGSTORE_VERIFIER_VERSION_INVALID/);
    assert.throws(()=>verifiedAttestationSubject('{}',{
      name:path.basename(candidate),sha256:candidateSha
    }),/UNIVERSAL_NATIVE_SIGSTORE_RESULT_INVALID/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('official gh CLI minimum security floor is fail-closed and accepts patched versions',()=>{
 const valid=[
   ['gh version 2.102.0 (2026-09-30)','2.102.0'],
   ['gh version 2.103.2 (2026-10-23)'+String.fromCharCode(10)+
     'https://github.com/cli/cli','2.103.2'],
   ['gh version 2.105.0 (2026-11-12)','2.105.0'],
   ['gh version 3.0.0 (future)','3.0.0']
 ];
 for(const [printed,version] of valid)
   assert.equal(assertSafeGhVerifierVersion(printed),version);
 for(const unsafe of ['gh version 2.101.0 (2026-09-01)',
   'gh version 2.0.999 (legacy)','gh version 1.999.999 (legacy)',
   'gh version 2.101.999 (fake)']){
   assert.throws(()=>assertSafeGhVerifierVersion(unsafe),
     /SIGSTORE_VERIFIER_VERSION_UNSAFE/);
 }
 for(const malformed of ['gh version 2.102.0-pre','2.103.2','gh version unknown',
   'gh version 2.102.0-rc1','gh version 2.102.0-beta (pre-release)']){
   assert.throws(()=>assertSafeGhVerifierVersion(malformed),
     /SIGSTORE_VERIFIER_VERSION_INVALID/);
 }
});
test('attestation certificate matches full signer workflow URI, ref and digest',()=>{
 const name='Remote-Commander-Unified-0.12.0-dev.10-Linux-amd64.deb';
 const valid=JSON.parse(verifiedJson(name));
 assert.equal(verifiedAttestationSubject(JSON.stringify(valid),
   {name,sha256:candidateSha,expectedCommit:head}),true);
 const certificate=valid[0].verificationResult.signature.certificate;
 const original=certificate.subjectAlternativeName;
 for(const hostile of [
   original.replace('unified-installer-pilot.yml@','unified-installer-pilot.yml-OTHER@'),
   original.replace('unified-installer-pilot.yml@','unified-installer-pilot.yml/OTHER@'),
   original.replace('refs/heads/','refs/tags/'),
   original.replace('https://github.com/','https://other-host.invalid/')
 ]){
   certificate.subjectAlternativeName=hostile;
   assert.throws(()=>verifiedAttestationSubject(JSON.stringify(valid),
     {name,sha256:candidateSha,expectedCommit:head}),/SIGSTORE_SUBJECT_MISMATCH/);
 }
 certificate.subjectAlternativeName=original;
 for(const field of ['buildSignerURI','buildConfigURI','githubWorkflowRef',
   'githubWorkflowSHA','buildSignerDigest']){
   const originalValue=certificate[field];certificate[field]='WRONG';
   assert.throws(()=>verifiedAttestationSubject(JSON.stringify(valid),
     {name,sha256:candidateSha,expectedCommit:head}),/SIGSTORE_SUBJECT_MISMATCH/);
   certificate[field]=originalValue;
 }
});
test('offline Sigstore rejects a renamed/re-owned repository even if subject matches',()=>{
 const name='Remote-Commander-Unified-0.12.0-dev.10-Linux-amd64.deb';
 const v=JSON.parse(verifiedJson(name));
 v[0].verificationResult.signature.certificate.sourceRepositoryIdentifier='999999';
 assert.throws(()=>verifiedAttestationSubject(JSON.stringify(v),
   {name,sha256:candidateSha,expectedCommit:head}),/SIGSTORE_SUBJECT_MISMATCH/);
 const w=JSON.parse(verifiedJson(name));
 w[0].verificationResult.signature.certificate.sourceRepositoryDigest='f'.repeat(40);
 assert.throws(()=>verifiedAttestationSubject(JSON.stringify(w),
   {name,sha256:candidateSha,expectedCommit:head}),/SIGSTORE_SUBJECT_MISMATCH/);
});
test('public attestation retrieval fails closed on missing or invalid bundles',async()=>{
  const d='f'.repeat(64);
  await assert.rejects(publicNativeAttestationBundles(d,{fetcher:async()=>({
    status:401,text:async()=>''})}),/PUBLIC_ATTESTATION_UNAVAILABLE/);
  await assert.rejects(publicNativeAttestationBundles(d,{fetcher:async()=>({
    status:200,text:async()=>JSON.stringify({attestations:[]})})}),
    /PUBLIC_ATTESTATION_UNTRUSTED/);
  await assert.rejects(publicNativeAttestationBundles('wrong',{fetcher:async()=>({
    status:200,text:async()=>''})}),/PUBLIC_ATTESTATION_DIGEST_INVALID/);
});
test('public offline bundle verifier demands official gh success and pinned subject',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-public-sigstore-test-'));
 const artifact=path.join(dir,'Remote-Commander-Unified-0.12.0-dev.10-Linux-amd64.deb');
 const manifest=path.join(dir,'receipt.json');
 try{
  const bytes=Buffer.alloc(4096,80);
  fs.writeFileSync(artifact,bytes,{flag:'wx'});
  const sha=(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(manifest,JSON.stringify({schema:1,sourceHead:head,
    platform:'linux',candidate:{sha256:sha,bytes:4096}}),{flag:'wx'});
  let url,verifiedBundlePath;
  const fetcher=async u=>{
   url=u;return {status:200,text:async()=>JSON.stringify({attestations:[
     {bundle:{mediaType:'application/vnd.dev.sigstore.bundle.v0.3+json',
       verificationMaterial:{},dsseEnvelope:{}}}]})};
  };
  const fakeVerifier=(_exe,args)=>{
   if(args[0]==='--version'){
     assert.deepEqual(args,['--version'],
       'no bundle or attestation flags on the version probe');
     return {status:0,stdout:'gh version 2.105.0 (2026-11-12)'};
   }
   const i=args.indexOf('--bundle');
   assert.ok(i>0);
   verifiedBundlePath=args[i+1];
   assert.match(fs.readFileSync(verifiedBundlePath,'utf8'),/dsseEnvelope/);
   assert.ok(args.includes('--deny-self-hosted-runners'));
   assert.ok(args.includes('--source-digest')&&args.includes(head));
   return {status:0,stdout:verifiedJson(path.basename(artifact),sha)};
  };
  const result=await verifyPublicSignedNativeRelease({
   manifestPath:manifest,candidatePath:artifact,
   expectedCommit:head,platform:'linux'
  },{fetcher,run:fakeVerifier});
  assert.equal(result.signedCandidateVerified,true);
  assert.ok(url.endsWith('sha256:'+sha));
  assert.equal(fs.existsSync(verifiedBundlePath),false,'temp bundle must be removed');
  await assert.rejects(verifyPublicSignedNativeRelease({
   manifestPath:manifest,candidatePath:artifact,
   expectedCommit:head,platform:'linux'
  },{fetcher,run:(_exe,args)=>args[0]==='--version'
    ?{status:0,stdout:'gh version 2.103.2 (2026-10-23)'}
    :{status:1,stdout:''}}),/SIGSTORE_VERIFICATION_FAILED/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('user-local WinGet CLI path is consistent across fresh shell and scheduled task',()=>{
 const home='C:\\Users\\owner\\AppData\\Local';
 const expected=path.join(home,'Microsoft','WinGet','Links','gh.exe');
 assert.equal(officialNativeVerifierBinary({
   platform:'win32',env:{LOCALAPPDATA:home},exists:f=>f===expected
 }),expected);
 assert.equal(officialNativeVerifierBinary({
   platform:'win32',env:{LOCALAPPDATA:home},exists:()=>false
 }),'gh');
 assert.equal(officialNativeVerifierBinary({platform:'linux',env:{LOCALAPPDATA:home},
   exists:()=>true}),'gh');
});
