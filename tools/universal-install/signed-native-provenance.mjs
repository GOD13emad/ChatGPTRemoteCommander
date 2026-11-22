// Shared Linux/Windows package-only release trust. The public GitHub/Sigstore
// builder, not an artifact-provided SHA, authenticates candidate bytes and HEAD.
// This does not sign an old rollback installer or grant a Worker/Tunnel cutover.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const REPO='GOD13emad/ChatGPTRemoteCommander';
const WORKFLOW=REPO+'/.github/workflows/unified-installer-pilot.yml';
const SHA=/^[a-f0-9]{64}$/;
const HEAD=/^[a-f0-9]{40}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};

export function verifiedAttestationSubject(stdout,{name,sha256}){
  let results;
  try{results=JSON.parse(stdout);}catch{fail('UNIVERSAL_NATIVE_SIGSTORE_JSON_INVALID');}
  if(!Array.isArray(results)||results.length<1||results.length>30)
    fail('UNIVERSAL_NATIVE_SIGSTORE_RESULT_INVALID');
  const matched=results.some(v=>{
    const statement=v?.verificationResult?.statement;
    return statement?.predicateType==='https://slsa.dev/provenance/v1'
      &&Array.isArray(statement.subject)
      &&statement.subject.some(s=>s?.name===name&&s?.digest?.sha256===sha256)
      &&v.verificationResult?.verifiedIdentity?.subjectAlternativeName;
  });
  if(!matched)fail('UNIVERSAL_NATIVE_SIGSTORE_SUBJECT_MISMATCH');
  return true;
}

export function verifySignedNativeRelease({
  manifestPath,candidatePath,expectedCommit,platform
}={}, {run=spawnSync}={}){
  if(typeof expectedCommit!=='string'||!HEAD.test(expectedCommit)
    ||!['linux','windows'].includes(platform)
    ||[manifestPath,candidatePath].some(s=>typeof s!=='string'||!path.isAbsolute(s)))
    fail('UNIVERSAL_NATIVE_SIGSTORE_ARGUMENT_INVALID');
  const manifestStat=fs.lstatSync(manifestPath);
  const candidateStat=fs.lstatSync(candidatePath);
  if(!manifestStat.isFile()||manifestStat.isSymbolicLink()
    ||manifestStat.nlink!==1||manifestStat.size<90||manifestStat.size>4096
    ||!candidateStat.isFile()||candidateStat.isSymbolicLink()
    ||candidateStat.nlink!==1||candidateStat.size<1024
    ||candidateStat.size>1536*1024*1024)
    fail('UNIVERSAL_NATIVE_SIGSTORE_ARTIFACT_UNTRUSTED');
  const buf=fs.readFileSync(manifestPath);
  if(buf.length!==manifestStat.size)
    fail('UNIVERSAL_NATIVE_SIGSTORE_MANIFEST_CHANGED');
  let manifest;
  try{manifest=JSON.parse(buf.toString('utf8'));}
  catch{fail('UNIVERSAL_NATIVE_SIGSTORE_MANIFEST_INVALID');}
  const digest=manifest?.candidate?.sha256;
  if(manifest?.sourceHead!==expectedCommit
    ||manifest?.platform!==(platform==='windows'?'win32':'linux')
    ||!SHA.test(digest??'')
    ||manifest?.candidate?.bytes!==candidateStat.size)
    fail('UNIVERSAL_NATIVE_SIGSTORE_MANIFEST_MISMATCH');
  const args=['attestation','verify',candidatePath,'--repo',REPO,
    '--source-digest',expectedCommit,'--signer-workflow',WORKFLOW,
    '--deny-self-hosted-runners','--format','json'];
  const result=run('gh',args,{encoding:'utf8',windowsHide:true,
    timeout:90000,maxBuffer:512*1024});
  if(result?.error||result?.signal||result?.status!==0
    ||typeof result.stdout!=='string')
    fail('UNIVERSAL_NATIVE_SIGSTORE_VERIFICATION_FAILED');
  verifiedAttestationSubject(result.stdout,{
    name:path.basename(candidatePath),sha256:digest
  });
  // Double-check release manifest did not change during online verification.
  const after=fs.lstatSync(manifestPath);
  if(after.ino!==manifestStat.ino||after.dev!==manifestStat.dev
    ||after.size!==manifestStat.size||after.mtimeMs!==manifestStat.mtimeMs
    ||after.ctimeMs!==manifestStat.ctimeMs)
    fail('UNIVERSAL_NATIVE_SIGSTORE_MANIFEST_CHANGED');
  return Object.freeze({
    manifestSha256:createHash('sha256').update(buf).digest('hex'),
    sourceHead:expectedCommit,candidateSha256:digest,
    signer:WORKFLOW,signedCandidateVerified:true,
    rollbackSignatureVerified:false,liveCoreChanged:false
  });
}
