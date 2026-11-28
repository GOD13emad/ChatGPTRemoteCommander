// Shared Linux/Windows package-only release trust. The public GitHub/Sigstore
// builder, not an artifact-provided SHA, authenticates candidate bytes and HEAD.
// This does not sign an old rollback installer or grant a Worker/Tunnel cutover.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import {createHash} from 'node:crypto';
import tls from 'node:tls';
import {spawnSync} from 'node:child_process';

const REPO='GOD13emad/ChatGPTRemoteCommander';
const WORKFLOW=REPO+'/.github/workflows/unified-installer-pilot.yml';
// Immutable IDs resist repository rename/squatting of the public name.
const REPO_ID='1374266155';
const OWNER_ID='94546844';
const SHA=/^[a-f0-9]{64}$/;
const HEAD=/^[a-f0-9]{40}$/;
const MAX_PUBLIC_ATTESTATION_BYTES=4*1024*1024;
const fail=code=>{throw Object.assign(new Error(code),{code});};

const MAX_NATIVE_CANDIDATE_BYTES=1536n*1024n*1024n;
const sameCandidateSnapshot=(a,b)=>a.dev===b.dev&&a.ino===b.ino
  &&a.mode===b.mode&&a.nlink===b.nlink&&a.size===b.size
  &&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
function candidateSnapshot(file,expected){
  const st=fs.lstatSync(file,{bigint:true});
  if(expected&&!sameCandidateSnapshot(st,expected))
    fail('UNIVERSAL_NATIVE_SIGSTORE_CANDIDATE_CHANGED');
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1n
    ||st.size<1024n||st.size>MAX_NATIVE_CANDIDATE_BYTES)
    fail('UNIVERSAL_NATIVE_SIGSTORE_ARTIFACT_UNTRUSTED');
  return st;
}
// Bind a bounded read to the inspected regular file, and recheck its path.
// This is an artifact integrity precondition, not local OS actor isolation.
function hashBoundNativeCandidate(file,expected){
  const st=candidateSnapshot(file,expected);
  const digest=createHash('sha256');
  const buf=Buffer.alloc(64*1024);
  let fd;
  try{
    fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)
      |(fs.constants.O_NONBLOCK??0));
    if(!sameCandidateSnapshot(st,fs.fstatSync(fd,{bigint:true})))
      fail('UNIVERSAL_NATIVE_SIGSTORE_CANDIDATE_CHANGED');
    let remaining=Number(st.size);
    while(remaining>0){
      const n=fs.readSync(fd,buf,0,Math.min(remaining,buf.length),null);
      if(n===0)fail('UNIVERSAL_NATIVE_SIGSTORE_CANDIDATE_CHANGED');
      digest.update(buf.subarray(0,n));remaining-=n;
    }
    if(!sameCandidateSnapshot(st,fs.fstatSync(fd,{bigint:true})))
      fail('UNIVERSAL_NATIVE_SIGSTORE_CANDIDATE_CHANGED');
    candidateSnapshot(file,st);
    return {snapshot:st,sha256:digest.digest('hex')};
  }finally{buf.fill(0);if(fd!==undefined)fs.closeSync(fd);}
}


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
// GitHub CLI v2.51.0–v2.101.0 accepted workflow-name prefixes; the
// pinned --signer-workflow flag is not an adequate policy check on those builds.
export function assertSafeGhAttestationVersion(binary,{run=spawnSync}={}){
  const result=run(binary,['--version'],{
    encoding:'utf8',windowsHide:true,timeout:5000,maxBuffer:4096
  });
  if(result?.error||result?.signal||result?.status!==0
    ||typeof result.stdout!=='string')
    fail('UNIVERSAL_NATIVE_GH_VERSION_UNVERIFIED');
  const m=/^gh version ([0-9]+)\.([0-9]+)\.([0-9]+)(?=\s|$)/.exec(result.stdout);
  if(!m)fail('UNIVERSAL_NATIVE_GH_VERSION_UNVERIFIED');
  const numbers=m.slice(1).map(Number);
  if(numbers.some(n=>!Number.isSafeInteger(n))
    ||numbers[0]<2||(numbers[0]===2&&numbers[1]<102))
    fail('UNIVERSAL_NATIVE_GH_VERSION_UNSAFE');
  return numbers.join('.');
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
    const signer=typeof ref==='string'&&/^refs\/(?:heads|tags)\/[a-zA-Z0-9._/-]+$/.test(ref)
      ?'https://github.com/'+WORKFLOW+'@'+ref:null;
    const san=cert?.subjectAlternativeName;
    // sigstore-go exposes X.509 URI SAN as {type:'URI',value:'...'};
    // some verification transports expose the same URI as a string.
    const sanUri=typeof san==='string' ? san
      :san?.type==='URI'&&typeof san?.value==='string' ? san.value : null;
    const source=cert?.sourceRepositoryDigest;
    return statement?.predicateType==='https://slsa.dev/provenance/v1'
      &&Array.isArray(statement.subject)
      &&statement.subject.some(s=>s?.name===name&&s?.digest?.sha256===sha256)
      &&cert?.sourceRepositoryIdentifier===REPO_ID
      &&cert?.sourceRepositoryOwnerIdentifier===OWNER_ID
      &&cert?.sourceRepositoryURI==='https://github.com/'+REPO
      &&cert?.runnerEnvironment==='github-hosted'
      &&cert?.issuer==='https://token.actions.githubusercontent.com'
      &&typeof source==='string'&&HEAD.test(source)
      &&(!expectedCommit||source===expectedCommit)
      &&cert?.githubWorkflowSHA===source&&cert?.buildSignerDigest===source
      &&signer!==null&&sanUri===signer
      &&cert?.buildSignerURI===signer&&cert?.buildConfigURI===signer
      &&cert?.githubWorkflowRepository===REPO&&cert?.githubWorkflowRef===ref
      &&v.verificationResult?.verifiedIdentity?.subjectAlternativeName;
  });
  if(!matched)fail('UNIVERSAL_NATIVE_SIGSTORE_SUBJECT_MISMATCH');
  return true;
}

export function verifySignedNativeRelease(args={}, {run=spawnSync}={}){
  return verifyNativeRelease(args,{run});
}
function verifyNativeRelease({
  manifestPath,candidatePath,expectedCommit,platform
}={}, {run,previousCandidate}={}){
  if(typeof expectedCommit!=='string'||!HEAD.test(expectedCommit)
    ||!['linux','windows'].includes(platform)
    ||[manifestPath,candidatePath].some(s=>typeof s!=='string'||!path.isAbsolute(s)))
    fail('UNIVERSAL_NATIVE_SIGSTORE_ARGUMENT_INVALID');
  const manifestStat=fs.lstatSync(manifestPath);
  if(!manifestStat.isFile()||manifestStat.isSymbolicLink()
    ||manifestStat.nlink!==1||manifestStat.size<90||manifestStat.size>4096)
    fail('UNIVERSAL_NATIVE_SIGSTORE_ARTIFACT_UNTRUSTED');
  const candidateStat=candidateSnapshot(candidatePath,previousCandidate?.snapshot);
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
    ||manifest?.candidate?.bytes!==Number(candidateStat.size))
    fail('UNIVERSAL_NATIVE_SIGSTORE_MANIFEST_MISMATCH');
  // Re-read after bundle retrieval; equal timestamps alone do not prove
  // content identity on every filesystem.
  const before=hashBoundNativeCandidate(candidatePath,candidateStat);
  if(previousCandidate&&before.sha256!==previousCandidate.sha256)
    fail('UNIVERSAL_NATIVE_SIGSTORE_CANDIDATE_CHANGED');
  if(before.sha256!==digest)
    fail('UNIVERSAL_NATIVE_SIGSTORE_CANDIDATE_HASH_MISMATCH');
  const args=['attestation','verify',candidatePath,'--repo',REPO,
    '--source-digest',expectedCommit,'--signer-workflow',WORKFLOW,
    '--deny-self-hosted-runners','--format','json'];
  const ghBinary=officialNativeVerifierBinary();
  assertSafeGhAttestationVersion(ghBinary,{run});
  const result=run(ghBinary,args,{encoding:'utf8',windowsHide:true,
    timeout:90000,maxBuffer:512*1024});
  if(result?.error||result?.signal||result?.status!==0
    ||typeof result.stdout!=='string')
    fail('UNIVERSAL_NATIVE_SIGSTORE_VERIFICATION_FAILED');
  verifiedAttestationSubject(result.stdout,{
    name:path.basename(candidatePath),sha256:digest,
    expectedCommit
  });
  // The verifier's result is about the candidate, not an arbitrary later
  // file at the same path. Bind the receipt to unchanged local bytes.
  const verified=hashBoundNativeCandidate(candidatePath,before.snapshot);
  if(verified.sha256!==before.sha256)
    fail('UNIVERSAL_NATIVE_SIGSTORE_CANDIDATE_CHANGED');
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
// Scope OS roots to one GitHub request. Concurrent operations and unrelated
// TLS clients must never see a temporarily changed thread-wide CA list.
export function publicAttestationHttpsAgent({
  tlsApi=tls,proxyEnv=https.globalAgent.options.proxyEnv
}={}){
  if(typeof tlsApi.getCACertificates!=='function')return null;
  const system=tlsApi.getCACertificates('system');
  if(system.length===0)return null;
  const roots=new Set([...tlsApi.getCACertificates('default'),...system]);
  return new https.Agent({ca:[...roots],keepAlive:false,proxyEnv,
    rejectUnauthorized:true});
}

async function fetchPublicAttestation(url,{headers,signal}){
  const agent=publicAttestationHttpsAgent();
  if(!agent)return fetch(url,{headers,signal,redirect:'error'});
  try{
    const response=await new Promise((resolve,reject)=>{
      https.get(url,{agent,headers,signal},resolve).once('error',reject);
    });
    const status=response.statusCode;
    if(status!==200){
      response.destroy();
      return {status};
    }
    const chunks=[];
    let bytes=0;
    for await(const chunk of response){
      bytes+=chunk.length;
      if(bytes>MAX_PUBLIC_ATTESTATION_BYTES)
        fail('UNIVERSAL_NATIVE_PUBLIC_ATTESTATION_UNTRUSTED');
      chunks.push(chunk);
    }
    return {status,text:async()=>Buffer.concat(chunks,bytes).toString('utf8')};
  }finally{agent.destroy();}
}

export async function publicNativeAttestationBundles(sha256,{fetcher=fetch}={}){
  if(typeof sha256!=='string'||!SHA.test(sha256))
    fail('UNIVERSAL_NATIVE_PUBLIC_ATTESTATION_DIGEST_INVALID');
  let response;
  try{
    const retrieve=fetcher===fetch?fetchPublicAttestation:fetcher;
    response=await retrieve('https://api.github.com/repos/'+REPO+
      '/attestations/sha256:'+sha256,{
      headers:{Accept:'application/vnd.github+json',
        'User-Agent':'ChatGPTCommander-SignedNativeVerifier/0.12'},
      signal:AbortSignal.timeout(15000)
    });
  }catch(error){
    if(error?.code==='UNIVERSAL_NATIVE_PUBLIC_ATTESTATION_UNTRUSTED')throw error;
    fail('UNIVERSAL_NATIVE_PUBLIC_ATTESTATION_UNAVAILABLE');
  }
  if(response?.status!==200)
    fail('UNIVERSAL_NATIVE_PUBLIC_ATTESTATION_UNAVAILABLE');
  let text;
  try{text=await response.text();}
  catch{fail('UNIVERSAL_NATIVE_PUBLIC_ATTESTATION_UNAVAILABLE');}
  if(typeof text!=='string'||text.length<50||text.length>MAX_PUBLIC_ATTESTATION_BYTES)
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
  const previousCandidate=hashBoundNativeCandidate(candidate);
  const sha=previousCandidate.sha256;
  const bundles=await publicNativeAttestationBundles(sha,{fetcher});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-native-sigstore-'));
  const bundlePath=path.join(dir,'bundle.jsonl');
  try{
    fs.chmodSync(dir,0o700);
    fs.writeFileSync(bundlePath,bundles.map(b=>JSON.stringify(b)).join('\n')+'\n',
      {flag:'wx',mode:0o600});
    // The bundle is an option of `gh attestation verify`, not `gh --version`.
    // Preserve the independent minimum-version check exactly as issued.
    return verifyNativeRelease(args,{previousCandidate,run:(exe,argv,opts)=>{
      if(argv.length===1&&argv[0]==='--version')
        return run(exe,argv,opts);
      if(argv[0]!=='attestation'||argv[1]!=='verify')
        fail('UNIVERSAL_NATIVE_SIGSTORE_GH_COMMAND_INVALID');
      return run(exe,[...argv,'--bundle',bundlePath],opts);
    }});
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
