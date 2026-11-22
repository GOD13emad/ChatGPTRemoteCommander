// Source-neutral auto-pinning for immutable approved stable native releases.
// Never convert a self-declared manifest hash into release authority.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const REPO='GOD13emad/ChatGPTRemoteCommander';
export const SIGNER=REPO+'/.github/workflows/unified-installer-pilot.yml';
const HEAD=/^[a-f0-9]{40}$/,HASH=/^[a-f0-9]{64}$/;
const VERSION=/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const requireThat=(x,code)=>{if(!x)fail(code);};
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
function gh(args,{timeoutMs=30000}={}){
  const p=spawnSync('gh',args,{encoding:'utf8',windowsHide:true,
    timeout:timeoutMs,maxBuffer:1024*1024});
  requireThat(!p.error&&p.status===0,'RC012_AUTO_GITHUB_UNAVAILABLE');
  return p.stdout;
}
function json(s){
  try{return JSON.parse(s);}catch{fail('RC012_AUTO_MALFORMED_RESPONSE');}
}
const api=(run,endpoint)=>json(run(['api','repos/'+REPO+'/'+endpoint]));
function tagHead(run,version){
  const tag=api(run,'git/ref/tags/v'+version);
  requireThat(tag?.ref==='refs/tags/v'+version&&object(tag.object),
    'RC012_AUTO_TAG_NOT_TRUSTED');
  let {sha,type}=tag.object;
  if(type==='tag'){
    const annotated=api(run,'git/tags/'+sha);
    requireThat(annotated?.verification?.verified===true&&object(annotated.object),
      'RC012_AUTO_ANNOTATED_TAG_UNSIGNED');
    sha=annotated.object.sha;type=annotated.object.type;
  }
  requireThat(type==='commit'&&HEAD.test(sha),'RC012_AUTO_TAG_INVALID');
  return sha;
}
function requireAcceptedTrain(run,version,sha){
  const [major,minor]=version.split('.');
  const data=api(run,'contents/docs/release-train-'+major+'.'+minor+'.json?ref='+sha);
  requireThat(data?.encoding==='base64'&&typeof data.content==='string'
    &&data.size>50&&data.size<100000,'RC012_AUTO_TRAIN_MISSING');
  const train=json(Buffer.from(data.content.replace(/\s/g,''),'base64').toString('utf8'));
  requireThat(train.sourceVersion===version&&train.isStable===true
    &&train.publishApproved===true&&train.autoupdateApproved===true
    &&train.installedPromotionApproved===true&&train.channel==='stable',
    'RC012_AUTO_TRAIN_NOT_APPROVED');
}
function latest(run){
  const release=api(run,'releases/latest');
  requireThat(object(release)&&typeof release.tag_name==='string'
    &&release.tag_name.startsWith('v')&&VERSION.test(release.tag_name.slice(1))
    &&release.immutable===true&&release.draft===false
    &&release.prerelease===false,'RC012_AUTO_NO_IMMUTABLE_STABLE');
  return release;
}
function approvedAsset(release,name,sha,size){
  const candidates=Array.isArray(release.assets)
    ?release.assets.filter(a=>a.name===name&&a.state==='uploaded'):[];
  requireThat(candidates.length===1&&candidates[0].digest==='sha256:'+sha
    &&candidates[0].size===size,'RC012_AUTO_RELEASE_ASSET_MISMATCH');
}
function shaFile(file,expected){
  requireThat(typeof file==='string'&&path.isAbsolute(file)&&HASH.test(expected),
    'RC012_AUTO_ARTIFACT_PATH_INVALID');
  const before=fs.lstatSync(file);
  requireThat(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1
    &&before.size>1024&&before.size<1536*1024*1024,
    'RC012_AUTO_ARTIFACT_UNTRUSTED');
  const fd=fs.openSync(file,'r');
  try{
    let size=0;const hash=createHash('sha256'),buf=Buffer.allocUnsafe(1048576);
    while(true){
      const n=fs.readSync(fd,buf,0,buf.length,null);
      if(n===0)break;
      size+=n;
      requireThat(size<=1536*1024*1024,'RC012_AUTO_ARTIFACT_LIMIT');
      hash.update(buf.subarray(0,n));
    }
    const after=fs.fstatSync(fd);
    requireThat(size===before.size&&after.size===before.size
      &&after.ino===before.ino&&after.mtimeMs===before.mtimeMs,
      'RC012_AUTO_ARTIFACT_CHANGED');
    requireThat(hash.digest('hex')===expected,'RC012_AUTO_ARTIFACT_HASH_MISMATCH');
    return size;
  }finally{fs.closeSync(fd);}
}
function attest(run,file,version,head){
  run(['attestation','verify',file,'--repo',REPO,
    '--source-ref','refs/tags/v'+version,'--source-digest',head,
    '--signer-workflow',SIGNER],{timeoutMs:90000});
}
function readManifest(file){
  requireThat(typeof file==='string'&&path.isAbsolute(file),
    'RC012_AUTO_MANIFEST_ABSOLUTE_REQUIRED');
  const s=fs.lstatSync(file);
  requireThat(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1
    &&s.size>80&&s.size<=4096,'RC012_AUTO_MANIFEST_UNTRUSTED');
  const value=json(fs.readFileSync(file,'utf8'));
  const platform=process.platform==='win32'?'windows':'linux';
  requireThat(value.schema==='rc-universal-native-install-manifest-v1'
    &&value.product==='ChatGPTRemoteCommander'
    &&value.platform===platform&&value.architecture===os.arch()
    &&HEAD.test(value.expectedCommit)&&object(value.candidate)
    &&(value.installationKind==='fresh'&&value.previous===null
      ||object(value.previous)),'RC012_AUTO_MANIFEST_INVALID');
  return value;
}
export function discoverTrustedStableRelease({run=gh}={}){
  const release=latest(run),version=release.tag_name.slice(1);
  const sourceHead=tagHead(run,version);
  requireAcceptedTrain(run,version,sourceHead);
  return Object.freeze({status:'APPROVED_STABLE_RELEASE_FOUND',version,
    sourceHead,tag:release.tag_name,safeToInstallWithoutOSApproval:false});
}
export function verifyTrustedNativeRelease(manifestPath,{run=gh}={}){
  const manifest=readManifest(manifestPath),candidate=manifest.candidate;
  requireThat(VERSION.test(candidate.version)&&HASH.test(candidate.sha256),
    'RC012_AUTO_PRERELEASE_NOT_ELIGIBLE');
  const release=latest(run),version=candidate.version;
  requireThat(release.tag_name==='v'+version,
    'RC012_AUTO_NOT_LATEST_APPROVED_RELEASE');
  const size=shaFile(candidate.path,candidate.sha256);
  approvedAsset(release,path.basename(candidate.path),candidate.sha256,size);
  const sourceHead=tagHead(run,version);
  requireThat(sourceHead===manifest.expectedCommit,'RC012_AUTO_SOURCE_MISMATCH');
  requireAcceptedTrain(run,version,sourceHead);
  attest(run,candidate.path,version,sourceHead);
  if(manifest.previous!==null){
    const prev=manifest.previous;
    requireThat(VERSION.test(prev.version)&&HASH.test(prev.sha256),
      'RC012_AUTO_UNATTESTED_LEGACY_ROLLBACK');
    const bytes=shaFile(prev.path,prev.sha256);
    const prevRelease=api(run,'releases/tags/v'+prev.version);
    requireThat(prevRelease?.tag_name==='v'+prev.version&&prevRelease.immutable===true
      &&prevRelease.draft===false&&prevRelease.prerelease===false,
      'RC012_AUTO_ROLLBACK_RELEASE_NOT_TRUSTED');
    approvedAsset(prevRelease,path.basename(prev.path),prev.sha256,bytes);
    const prevHead=tagHead(run,prev.version);
    attest(run,prev.path,prev.version,prevHead);
  }
  const provFile=manifest.provenanceManifestPath;
  requireThat(typeof provFile==='string'&&path.isAbsolute(provFile),
    'RC012_AUTO_PROVENANCE_MANIFEST_REQUIRED');
  const st=fs.lstatSync(provFile);
  requireThat(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1&&st.size>50
    &&st.size<=4096,'RC012_AUTO_PROVENANCE_UNTRUSTED');
  const bytes=fs.readFileSync(provFile),p=json(bytes.toString('utf8'));
  requireThat(p.schema===(manifest.previous===null?2:1)
    &&p.sourceHead===sourceHead
    &&p.platform===(process.platform==='win32'?'win32':'linux')
    &&p.candidate?.sha256===candidate.sha256&&p.candidate?.bytes===size,
    'RC012_AUTO_PROVENANCE_BINDING_FAILED');
  if(manifest.previous!==null){
    requireThat(p.rollback?.sha256===manifest.previous.sha256
      &&p.rollback?.bytes===fs.statSync(manifest.previous.path).size,
      'RC012_AUTO_ROLLBACK_BINDING_FAILED');
  }
  return Object.freeze({verified:true,sourceHead,version,
    pinnedManifestSha256:createHash('sha256').update(bytes).digest('hex'),
    rollbackVerified:manifest.previous!==null,
    packageOnly:true,approvalIssued:false,promotionPerformed:false});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(args.length===1&&args[0]==='--discover'){
      console.log(JSON.stringify(discoverTrustedStableRelease()));
    }else{
      requireThat(args.length===3&&['--check','--launch'].includes(args[0])
        &&args[1]==='--manifest'&&path.isAbsolute(args[2]),
        'RC012_AUTO_ARGUMENTS_INVALID');
      const result=verifyTrustedNativeRelease(args[2]);
      if(args[0]==='--check'){
        console.log(JSON.stringify({status:'TRUSTED_RELEASE_VERIFIED',...result}));
      }else{
        requireThat(process.stdin.isTTY&&process.stdout.isTTY,
          'RC012_AUTO_NATIVE_OWNER_TTY_REQUIRED');
        // One shared native-cli remains the sole owner/OS effect authority.
        // The owner never types a checksum. No fake TTY or UAC/polkit bypass.
        const cli=path.join(path.dirname(fileURLToPath(import.meta.url)),
          'native-cli.mjs');
        const r=spawnSync(process.execPath,[cli,'--apply','--manifest',args[2]],{
          stdio:'inherit',windowsHide:false,env:{...process.env,
            RC012_OWNER_PINNED_NATIVE_MANIFEST_SHA256:result.pinnedManifestSha256,
            RC012_OWNER_PINNED_SOURCE_HEAD:result.sourceHead}});
        requireThat(!r.error&&r.status===0,'RC012_AUTO_NATIVE_EFFECT_UNVERIFIED');
      }
    }
  }catch(e){
    console.error(JSON.stringify({status:'NO_AUTOMATIC_PROMOTION',
      code:e?.code??'RC012_AUTO_UNEXPECTED_FAILURE',packageOnly:true}));
    process.exitCode=2;
  }
}
