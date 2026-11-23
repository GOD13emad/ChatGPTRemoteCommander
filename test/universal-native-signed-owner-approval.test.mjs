import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {verifiedAttestationSubject,verifySignedNativeRelease,
  verifyPublicSignedNativeRelease,publicNativeAttestationBundles,
  officialNativeVerifierBinary}
  from '../tools/universal-install/signed-native-provenance.mjs';
import {windowsGuiApprovalScript}
  from '../tools/universal-install/native-cli.mjs';

const candidateSha='b'.repeat(64),head='a'.repeat(40);
const sourceRef='refs/heads/qa';
const signer='https://github.com/GOD13emad/ChatGPTRemoteCommander/.github/workflows/unified-installer-pilot.yml@'+sourceRef;
const ghVersion={status:0,stdout:'gh version 2.103.2 (2026-10-23)\n'};
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
        sourceRepositoryRef:sourceRef,subjectAlternativeName:signer,
        buildSignerURI:signer,buildSignerDigest:head
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
test('native owner approval shows the actual rollback and uninstall destinations',()=>{
  const plan={installedVersion:'0.12.0-dev.10',
    candidate:{version:'0.12.0-dev.10'},transactionId:'c'.repeat(64)};
  for(const [rollbackTarget,target] of [
    ['0.12.0-dev.9','0.12.0-dev.9'],
    ['NATIVE_ABSENCE','No Commander package']
  ]){
    const script=windowsGuiApprovalScript({...plan,rollbackTarget});
    const encoded=script.match(/FromBase64String\('([^']+)'\)/)?.[1];
    assert.ok(encoded);
    const text=Buffer.from(encoded,'base64').toString('utf8');
    assert.ok(text.split('\n').includes('0.12.0-dev.10 -> '+target));
  }
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
    const input={
      manifestPath:manifest,candidatePath:candidate,
      expectedCommit:head,platform:'linux'
    };
    const calls=[];
    const run=(cmd,args,opts)=>{
      calls.push({cmd,args,opts});
      if(args[0]==='--version')return ghVersion;
      return {status:0,stdout:verifiedJson(path.basename(candidate))};
    };
    const approved=verifySignedNativeRelease(input,{run});
    assert.equal(approved.signedCandidateVerified,true);
    assert.equal(approved.rollbackSignatureVerified,false,
      'never claim an unsigned baseline is signed');
    assert.match(approved.manifestSha256,/^[a-f0-9]{64}$/);
    assert.deepEqual(calls[0].args,['--version']);
    assert.equal(calls[1].cmd,calls[0].cmd);
    assert.equal(calls[0].opts.timeout,10000);
    const {args}=calls[1];
    assert.deepEqual(args.slice(0,3),['attestation','verify',candidate]);
    assert.ok(args.includes('--source-digest')&&args.includes(head));
    assert.ok(args.includes('--signer-workflow'));
    assert.ok(args.includes('--deny-self-hosted-runners'));
    assert.throws(()=>verifySignedNativeRelease(input,{run:(_cmd,a)=>a[0]==='--version'
      ?ghVersion:{status:1,stdout:''}}),/UNIVERSAL_NATIVE_SIGSTORE_VERIFICATION_FAILED/);
    assert.throws(()=>verifySignedNativeRelease(input,{run:(_cmd,a)=>a[0]==='--version'
      ?ghVersion:{status:0,stdout:verifiedJson('other.exe')}}),
    /UNIVERSAL_NATIVE_SIGSTORE_SUBJECT_MISMATCH/);
    for(const [stdout,reason] of [
      ['gh version 2.101.0','VERIFIER_UPDATE_REQUIRED'],
      ['gh version 2.102.0-dev','VERIFIER_VERSION_INVALID'],
      ['unknown version','VERIFIER_VERSION_INVALID']
    ]){
      assert.throws(()=>verifySignedNativeRelease(input,{run:(_cmd,a)=>{
        assert.deepEqual(a,['--version']);
        return {status:0,stdout};
      }}),new RegExp(reason));
    }
    assert.throws(()=>verifiedAttestationSubject('{}',{
      name:path.basename(candidate),sha256:candidateSha
    }),/UNIVERSAL_NATIVE_SIGSTORE_RESULT_INVALID/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
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
test('certificate SAN, signer URI, source ref and digest must name the exact workflow',()=>{
  const name='Remote-Commander-Unified-0.12.0-dev.10-Linux-amd64.deb';
  for(const [key,value] of [
    ['subjectAlternativeName',signer.replace('unified-installer-pilot.yml','other.yml')],
    ['buildSignerURI',signer.replace(sourceRef,'refs/heads/other')],
    ['sourceRepositoryRef','refs/heads/other'],
    ['buildSignerDigest','f'.repeat(40)]
  ]){
    const rows=JSON.parse(verifiedJson(name));
    rows[0].verificationResult.signature.certificate[key]=value;
    assert.throws(()=>verifiedAttestationSubject(JSON.stringify(rows),
      {name,sha256:candidateSha,expectedCommit:head}),/SIGSTORE_SUBJECT_MISMATCH/);
  }
});
test('typed Sigstore-Go URI SAN is admitted only for the exact pinned signer',()=>{
  const name='Remote-Commander-Unified-0.12.0-dev.10-Linux-amd64.deb';
  const rows=JSON.parse(verifiedJson(name));
  const cert=rows[0].verificationResult.signature.certificate;
  cert.subjectAlternativeName={type:'URI',value:signer};
  assert.equal(verifiedAttestationSubject(JSON.stringify(rows),{
    name,sha256:candidateSha,expectedCommit:head
  }),true);
  for(const san of [
    {type:'DNS',value:signer},
    {type:'URI',value:signer.replace('.yml@','.yml-OTHER@')},
    {type:'URI',value:signer+'@refs/heads/fake'},
    {type:'URI',value:123},
    {type:'URI'},
    null
  ]){
    cert.subjectAlternativeName=san;
    assert.throws(()=>verifiedAttestationSubject(JSON.stringify(rows),{
      name,sha256:candidateSha,expectedCommit:head
    }),/UNIVERSAL_NATIVE_SIGSTORE_SUBJECT_MISMATCH/);
  }
  cert.subjectAlternativeName={type:'URI',value:signer};
  cert.sourceRepositoryRef='refs/heads/other';
  assert.throws(()=>verifiedAttestationSubject(JSON.stringify(rows),{
    name,sha256:candidateSha,expectedCommit:head
  }),/UNIVERSAL_NATIVE_SIGSTORE_SUBJECT_MISMATCH/);
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
    assert.deepEqual(args,['--version']);
    return ghVersion;
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
  },{fetcher,run:(_cmd,a)=>a[0]==='--version'
    ?ghVersion:{status:1,stdout:''}}),/SIGSTORE_VERIFICATION_FAILED/);
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
