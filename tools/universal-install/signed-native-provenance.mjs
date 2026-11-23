// Shared Linux/Windows package-only release trust. The public GitHub/Sigstore
// builder, not an artifact-provided SHA, authenticates candidate bytes and HEAD.
// This does not sign an old rollback installer or grant a Worker/Tunnel cutover.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const REPO='GOD13emad/ChatGPTRemoteCommander';
const WORKFLOW=REPO+'/.github/workflows/unified-installer-pilot.yml';
// Immutable IDs resist repository rename/squatting of the public name.
const REPO_ID='1374266155';
const OWNER_ID='94546844';
const SHA=/^[a-f0-9]{64}$/;
const HEAD=/^[a-f0-9]{40}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};

export function officialNativeVerifierBinary({
  platform=process.platform,env=process.env,exists=fs.existsSync
}={}){
  // Microsoft's WinGet user-scope portable GitHub CLI exposes a verified
  // package through a user-local command alias. Fresh remote sessions and
  // scheduled tasks may not inherit WinGet's updated PATH immediately.
  if(platform==='win32'&&typeof env.LOCALAPPDATA==='string'){
    const userCli=path.join(env.LOCALAPPDATA,'Microsoft','WinGet',
      'Links','gh.exe');
    if(exists(userCli))return userCli;
  }
  return 'gh';
}
function requirePatchedNativeVerifier(binary,run){
  const result=run(binary,['--version'],{encoding:'utf8',windowsHide:true,
    timeout:10000,maxBuffer:4096});
  if(result?.error||result?.signal||result?.status!==0
    ||typeof result.stdout!=='string')
    fail('UNIVERSAL_NATIVE_SIGSTORE_VERIFIER_UNAVAILABLE');
  const version=/^gh version (\d+)\.(\d+)\.(\d+)(?: \([^\r\n]*\))?(?:\r?\n|$)/
    .exec(result.stdout);
  const [major,minor,patch]=version?.slice(1).map(Number)??[];
  if(![major,minor,patch].every(Number.isSafeInteger))
    fail('UNIVERSAL_NATIVE_SIGSTORE_VERIFIER_VERSION_INVALID');
  // GitHub CLI 2.102.0 corrected workflow-identity matching.
  if(major<2||(major===2&&minor<102))
    fail('UNIVERSAL_NATIVE_SIGSTORE_VERIFIER_UPDATE_REQUIRED');
}
export function verifiedAttestationSubject(stdout,{name,sha256,expectedCommit}={}){
  let results;
  try{results=JSON.parse(stdout);}catch{fail('UNIVERSAL_NATIVE_SIGSTORE_JSON_INVALID');}
  if(!Array.isArray(results)||results.length<1||results.length>30)
    fail('UNIVERSAL_NATIVE_SIGSTORE_RESULT_INVALID');
  const matched=results.some(v=>{
    const statement=v?.verificationResult?.statement;
    const cert=v?.verificationResult?.signature?.certificate;
    const ref=cert?.sourceRepositoryRef;
    if(typeof ref!=='string'||!/^refs\/(?:heads|tags)\/[^\s]+$/.test(ref))
      return false;
    const signerIdentity='https://github.com/'+WORKFLOW+'@'+ref;
    return statement?.predicateType==='https://slsa.dev/provenance/v1'
      &&Array.isArray(statement.subject)
      &&statement.subject.some(s=>s?.name===name&&s?.digest?.sha256===sha256)
      &&cert?.sourceRepositoryIdentifier===REPO_ID
      &&cert?.sourceRepositoryOwnerIdentifier===OWNER_ID
      &&cert?.sourceRepositoryURI==='https://github.com/'+REPO
      &&cert?.runnerEnvironment==='github-hosted'
      &&cert?.issuer==='https://token.actions.githubusercontent.com'
      &&(!expectedCommit||cert?.sourceRepositoryDigest===expectedCommit)
      &&HEAD.test(cert.sourceRepositoryDigest??'')
      &&cert.subjectAlternativeName===signerIdentity
      &&cert.buildSignerURI===signerIdentity
      &&cert.buildSignerDigest===cert.sourceRepositoryDigest;
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
  const binary=officialNativeVerifierBinary();
  requirePatchedNativeVerifier(binary,run);
  const result=run(binary,args,{encoding:'utf8',windowsHide:true,
    timeout:90000,maxBuffer:512*1024});
  if(result?.error||result?.signal||result?.status!==0
    ||typeof result.stdout!=='string')
    fail('UNIVERSAL_NATIVE_SIGSTORE_VERIFICATION_FAILED');
  verifiedAttestationSubject(result.stdout,{
    name:path.basename(candidatePath),sha256:digest,
    expectedCommit
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

/**
 * Public repository attestations are downloadable without a GitHub login.
 * The response is UNTRUSTED until the official gh offline bundle verifier
 * authenticates Sigstore certificate identity, source and exact artifact.
 */
export async function publicNativeAttestationBundles(sha256,{fetcher=fetch}={}){
  if(typeof sha256!=='string'||!SHA.test(sha256))
    fail('UNIVERSAL_NATIVE_PUBLIC_ATTESTATION_DIGEST_INVALID');
  let response;
  try{
    response=await fetcher('https://api.github.com/repos/'+REPO+
      '/attestations/sha256:'+sha256,{
      headers:{Accept:'application/vnd.github+json',
        'User-Agent':'ChatGPTCommander-SignedNativeVerifier/0.12'},
      signal:AbortSignal.timeout(15000)
    });
  }catch{fail('UNIVERSAL_NATIVE_PUBLIC_ATTESTATION_UNAVAILABLE');}
  if(response?.status!==200)
    fail('UNIVERSAL_NATIVE_PUBLIC_ATTESTATION_UNAVAILABLE');
  let text;
  try{text=await response.text();}
  catch{fail('UNIVERSAL_NATIVE_PUBLIC_ATTESTATION_UNAVAILABLE');}
  if(typeof text!=='string'||text.length<50||text.length>4*1024*1024)
    fail('UNIVERSAL_NATIVE_PUBLIC_ATTESTATION_UNTRUSTED');
  let list;
  try{list=JSON.parse(text).attestations;}
  catch{fail('UNIVERSAL_NATIVE_PUBLIC_ATTESTATION_UNTRUSTED');}
  if(!Array.isArray(list)||list.length<1||list.length>30)
    fail('UNIVERSAL_NATIVE_PUBLIC_ATTESTATION_UNTRUSTED');
  const bundles=list.map(v=>v?.bundle);
  if(bundles.some(b=>!b||typeof b!=='object'||Array.isArray(b)))
    fail('UNIVERSAL_NATIVE_PUBLIC_ATTESTATION_UNTRUSTED');
  return bundles;
}
export async function verifyPublicSignedNativeRelease(args,{
  fetcher=fetch,run=spawnSync
}={}){
  // All SHA, platform and immutable manifest checks are still enforced
  // by verifySignedNativeRelease; never trust an HTTP bundle by itself.
  const candidate=args?.candidatePath,manifest=args?.manifestPath;
  if(typeof candidate!=='string'||!path.isAbsolute(candidate)
    ||typeof manifest!=='string'||!path.isAbsolute(manifest))
    fail('UNIVERSAL_NATIVE_SIGSTORE_ARGUMENT_INVALID');
  const digest=createHash('sha256');
  const st=fs.lstatSync(candidate);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1
    ||st.size<1024||st.size>1536*1024*1024)
    fail('UNIVERSAL_NATIVE_SIGSTORE_ARTIFACT_UNTRUSTED');
  const fd=fs.openSync(candidate,'r');
  const buf=Buffer.allocUnsafe(64*1024);
  try{
    for(let n;(n=fs.readSync(fd,buf,0,buf.length,null))>0;){
      digest.update(buf.subarray(0,n));
    }
  }finally{buf.fill(0);fs.closeSync(fd);}
  const sha=digest.digest('hex');
  const bundles=await publicNativeAttestationBundles(sha,{fetcher});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-native-sigstore-'));
  const bundlePath=path.join(dir,'bundle.jsonl');
  try{
    fs.chmodSync(dir,0o700);
    fs.writeFileSync(bundlePath,bundles.map(b=>JSON.stringify(b)).join('\n')+'\n',
      {flag:'wx',mode:0o600});
    return verifySignedNativeRelease(args,{run:(exe,argv,opts)=>
      run(exe,argv[0]==='attestation'?[...argv,'--bundle',bundlePath]:argv,opts)});
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
