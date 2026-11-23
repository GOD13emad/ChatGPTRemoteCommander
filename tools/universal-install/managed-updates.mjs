#!/usr/bin/env node
// Stable-channel automatic discovery/staging. This is intentionally not a
// background privilege broker and never silently installs a NoPromote build.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {verifyPublicSignedNativeRelease} from './signed-native-provenance.mjs';

const REPO='GOD13emad/ChatGPTRemoteCommander';
const TAG=/^v(\d+)\.(\d+)\.(\d+)$/;
const COMMIT=/^[a-f0-9]{40}$/;
const SHA256=/^[a-f0-9]{64}$/;
const fail=c=>{throw Object.assign(new Error(c),{code:c});};
function exec(binary,args,{timeout=25000,maxBuffer=3*1024*1024}={}){
  const r=spawnSync(binary,args,{encoding:'utf8',timeout,
    maxBuffer,windowsHide:true});
  if(r.error||r.signal||r.status!==0||typeof r.stdout!=='string')
    fail('RC012_AUTO_UPDATE_TRUSTED_SOURCE_UNAVAILABLE');
  return r.stdout;
}
function json(v){
  try{return JSON.parse(v);}catch{fail('RC012_AUTO_UPDATE_INVALID_JSON');}
}
export function compareReleaseVersions(a,b){
  const parse=v=>{
    const x=/^(\d+)\.(\d+)\.(\d+)(?:(?:~|-)(?:dev|rc)[.-]?(\d+))?$/.exec(v);
    if(!x)return null;
    return [Number(x[1]),Number(x[2]),Number(x[3]),x[4]?0:1,x[4]?Number(x[4]):0];
  };
  const aa=parse(a),bb=parse(b);
  if(!aa||!bb)fail('RC012_AUTO_UPDATE_VERSION_INVALID');
  for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i])return aa[i]>bb[i]?1:-1;
  return 0;
}
export function approvedRelease({current,releases,trainFor}={}){
  if(typeof current!=='string'||!Array.isArray(releases)
    ||typeof trainFor!=='function')
    fail('RC012_AUTO_UPDATE_ARGUMENT_INVALID');
  const sorted=releases.filter(r=>r&&!r.draft&&!r.prerelease&&TAG.test(r.tag_name||''))
    .sort((a,b)=>compareReleaseVersions(b.tag_name.slice(1),a.tag_name.slice(1)));
  for(const release of sorted){
    const tag=release.tag_name,version=tag.slice(1);
    if(compareReleaseVersions(version,current)<=0)continue;
    const majorMinor=version.split('.').slice(0,2).join('.');
    const train=trainFor(tag,majorMinor);
    if(!train||train.schema!=='rc-suite-release-train-v1'
      ||train.train!==majorMinor||train.releaseTag!==tag
      ||train.sourceVersion!==version||train.isStable!==true
      ||train.publishApproved!==true||train.autoupdateApproved!==true
      ||train.installedPromotionApproved!==true||train.channel!=='stable')
      continue;
    return {tag,version,release,train};
  }
  return null;
}
function installedNativeVersion(){
  if(process.platform==='linux'){
    const result=spawnSync('dpkg-query',
      ['-W','-f=${Version}','chatgpt-remote-commander'],{
        encoding:'utf8',timeout:15000,windowsHide:true});
    if(result.status===1&&typeof result.stderr==='string'
      &&/no packages found/i.test(result.stderr))return null;
    if(result.error||result.signal||result.status!==0
      ||typeof result.stdout!=='string')
      fail('RC012_AUTO_UPDATE_NATIVE_INVENTORY_UNAVAILABLE');
    return result.stdout.trim().replace('~dev.','-dev.');
  }
  if(process.platform==='win32'){
    const reg=String.raw`HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\e8b3b1a5-66f7-5b0b-b5ed-ddf867067934`;
    // A missing key is an expected *first-install* state. An absent-key
    // Get-ItemProperty call can set a nonzero exit code even with SilentlyContinue.
    const script="$ErrorActionPreference='Stop';"+
      "$p='"+reg+"';"+
      "if(Test-Path -LiteralPath $p){"+
      "$v=Get-ItemProperty -LiteralPath $p -ErrorAction Stop;"+
      "[Console]::Write($v.DisplayVersion)}";
    // The Windows Store may expose a non-launchable pwsh.exe app alias.
    // Use the built-in Windows PowerShell executable on every Windows host.
    const shell=path.join(process.env.SystemRoot||String.raw`C:\Windows`,
      'System32','WindowsPowerShell','v1.0','powershell.exe');
    const result=exec(shell,
      ['-NoLogo','-NoProfile','-NonInteractive','-Command',script]);
    return result.trim()||null;
  }
  fail('RC012_AUTO_UPDATE_PLATFORM_UNSUPPORTED');
}
// Public, read-only release discovery works on un-enrolled hosts: gh api
// requires account sign-in even for public repositories. Candidate signature
// verification remains a separate mandatory gate and is NOT replaced by HTTPS.
export async function publicGitHubJson(endpoint,{fetcher=fetch}={}){
  if(!/^(?:releases\?per_page=30|commits\/v[0-9]+\.[0-9]+\.[0-9]+|contents\/docs\/release-train-[0-9]+\.[0-9]+\.json\?ref=[a-f0-9]{40})$/.test(endpoint))
    fail('RC012_AUTO_UPDATE_PUBLIC_API_ROUTE_DENIED');
  let response;
  try{
    response=await fetcher('https://api.github.com/repos/'+REPO+'/'+endpoint,{
      headers:{Accept:'application/vnd.github+json',
        'User-Agent':'ChatGPTCommander-SignedStableUpdate/0.12'},
      signal:AbortSignal.timeout(15000)
    });
  }catch{fail('RC012_AUTO_UPDATE_PUBLIC_API_UNAVAILABLE');}
  if(response?.status===404)return null;
  if(response?.status!==200)fail('RC012_AUTO_UPDATE_PUBLIC_API_REJECTED');
  let content;
  try{content=await response.text();}
  catch{fail('RC012_AUTO_UPDATE_PUBLIC_API_UNAVAILABLE');}
  if(content.length<2||content.length>3*1024*1024)
    fail('RC012_AUTO_UPDATE_PUBLIC_API_RESPONSE_INVALID');
  return json(content);
}
async function signedSourceTrain(sourceHead,majorMinor,api){
  const res=await api('contents/docs/release-train-'+majorMinor+
    '.json?ref='+sourceHead);
  if(!res)return null;
  if(res.type!=='file'||res.encoding!=='base64'
    ||typeof res.content!=='string'||res.content.length>1024*1024)
    fail('RC012_AUTO_UPDATE_TRAIN_SOURCE_INVALID');
  const text=Buffer.from(res.content.replace(/\s/g,''),'base64').toString('utf8');
  if(text.length>100*1024)fail('RC012_AUTO_UPDATE_TRAIN_SOURCE_INVALID');
  return json(text);
}
export function expectedArtifact(release,platform,architecture='x64'){
  // Match the signed release version, not merely a filename pattern.
  // A GitHub v0.12.0 release must NEVER stage an unrelated dev.10 build
  // or an artifact for the wrong CPU/OS.
  if(!release||!TAG.test(release.tag_name??'')
    ||!['linux','win32'].includes(platform)
    ||architecture!=='x64')return null;
  const version=release.tag_name.slice(1);
  const exact=platform==='linux'
    ? 'Remote-Commander-Unified-'+version+'-Linux-amd64.deb'
    : 'Remote-Commander-Unified-'+version+'-Windows-x64.exe';
  const matches=(release.assets||[]).filter(a=>
    a?.name===exact && a?.state==='uploaded'
    && Number.isSafeInteger(a.size) && a.size>1024
    && /^sha256:[a-f0-9]{64}$/.test(a.digest??''));
  return matches.length===1?matches[0]:null;
}
function stageDirectory(){
  return process.platform==='win32'
    ?path.join(process.env.LOCALAPPDATA||os.homedir(),
      'ChatGPTRemoteCommander','native-auto-update-staging')
    :path.join(os.homedir(),'.cache','chatgpt-remote-commander',
      'native-auto-update-staging');
}
export async function discoverApprovedUpdate({
  api=publicGitHubJson,readInstalled=installedNativeVersion
}={}){
  const current=readInstalled();
  if(current===null)return {current:null,selected:null,
    needsFirstInstall:true};
  const releases=await api('releases?per_page=30');
  if(!Array.isArray(releases)||releases.length>30)
    fail('RC012_AUTO_UPDATE_RELEASE_INDEX_INVALID');
  const sorted=releases.filter(r=>r&&!r.draft&&!r.prerelease&&TAG.test(r.tag_name||''))
    .sort((a,b)=>compareReleaseVersions(b.tag_name.slice(1),a.tag_name.slice(1)));
  for(const release of sorted){
    const tag=release.tag_name,version=tag.slice(1);
    if(compareReleaseVersions(version,current)<=0)continue;
    const target=await api('commits/'+tag);
    const sourceHead=target?.sha;
    if(typeof sourceHead!=='string'||!COMMIT.test(sourceHead))
      fail('RC012_AUTO_UPDATE_SOURCE_HEAD_UNAVAILABLE');
    // Read train from the resolved *immutable commit*, never a moving tag.
    const train=await signedSourceTrain(sourceHead,
      version.split('.').slice(0,2).join('.'),api);
    const selected=approvedRelease({current,releases:[release],
      trainFor:()=>train});
    if(selected)return {current,selected:{...selected,sourceHead}};
  }
  return {current,selected:null};
}
export async function downloadPublicReleaseAsset({
  tag,name,destination,expectedSha256,expectedBytes,fetcher=fetch
}={}){
  if(!TAG.test(tag??'')||typeof name!=='string'
    ||!/^Remote-Commander-Unified-[0-9.]+-(?:Linux-amd64\.deb|Windows-x64\.exe)$/.test(name)
    ||!SHA256.test(expectedSha256??'')
    ||!Number.isSafeInteger(expectedBytes)||expectedBytes<1024
    ||expectedBytes>1536*1024*1024
    ||typeof destination!=='string'||!path.isAbsolute(destination)
    ||path.basename(destination)!==name)
    fail('RC012_AUTO_UPDATE_ASSET_DOWNLOAD_ARGS_INVALID');
  const url='https://github.com/'+REPO+'/releases/download/'+
    encodeURIComponent(tag)+'/'+encodeURIComponent(name);
  let response;
  try{
    response=await fetcher(url,{signal:AbortSignal.timeout(180000)});
  }catch{fail('RC012_AUTO_UPDATE_ASSET_DOWNLOAD_UNAVAILABLE');}
  const finalUrl=typeof response?.url==='string'&&response.url
    ?response.url:url;
  let host;
  try{const u=new URL(finalUrl);if(u.protocol!=='https:')throw Error();
    host=u.hostname;}catch{fail('RC012_AUTO_UPDATE_ASSET_REDIRECT_DENIED');}
  if(!['github.com','release-assets.githubusercontent.com',
    'objects.githubusercontent.com'].includes(host))
    fail('RC012_AUTO_UPDATE_ASSET_REDIRECT_DENIED');
  if(response?.status!==200||!response.body)
    fail('RC012_AUTO_UPDATE_ASSET_DOWNLOAD_UNAVAILABLE');
  const temp=destination+'.partial-'+process.pid;
  const fd=fs.openSync(temp,'wx',0o600);
  const hash=createHash('sha256');
  let bytes=0,complete=false;
  try{
    for await(const data of response.body){
      const chunk=Buffer.from(data);
      bytes+=chunk.length;
      if(bytes>expectedBytes)
        fail('RC012_AUTO_UPDATE_ASSET_SIZE_MISMATCH');
      fs.writeSync(fd,chunk);
      hash.update(chunk);
    }
    if(bytes!==expectedBytes||hash.digest('hex')!==expectedSha256)
      fail('RC012_AUTO_UPDATE_ASSET_HASH_MISMATCH');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    if(fs.existsSync(destination))
      fail('RC012_AUTO_UPDATE_ASSET_DESTINATION_EXISTS');
    fs.renameSync(temp,destination);
    complete=true;
  }finally{
    try{fs.closeSync(fd);}catch{}
    if(!complete&&fs.existsSync(temp))fs.rmSync(temp);
  }
  return destination;
}
export async function stageApprovedUpdate({run=spawnSync,api=publicGitHubJson}={}){
  const {current,selected}=await discoverApprovedUpdate({api});
  if(!selected)return {status:current===null
    ?'NATIVE_FIRST_INSTALL_REQUIRED':'NO_APPROVED_NEW_RELEASE',
    current,installed:false};
  const platform=process.platform;
  const asset=expectedArtifact(selected.release,platform,os.arch());
  if(!asset||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))
    fail('RC012_AUTO_UPDATE_SIGNED_ASSET_MISSING');
  const commit=selected.sourceHead;
  if(typeof commit!=='string'||!COMMIT.test(commit))
    fail('RC012_AUTO_UPDATE_SOURCE_HEAD_UNAVAILABLE');
  const root=stageDirectory();
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  if(fs.lstatSync(root).isSymbolicLink())fail('RC012_AUTO_UPDATE_STAGE_UNTRUSTED');
  const dir=path.join(root,selected.tag+'-'+commit.slice(0,12));
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  if(fs.lstatSync(dir).isSymbolicLink())fail('RC012_AUTO_UPDATE_STAGE_UNTRUSTED');
  const dst=path.join(dir,asset.name);
  if(!fs.existsSync(dst))
    await downloadPublicReleaseAsset({tag:selected.tag,name:asset.name,
      destination:dst,expectedSha256:asset.digest.slice(7),
      expectedBytes:asset.size});
  const st=fs.lstatSync(dst);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size!==asset.size)
    fail('RC012_AUTO_UPDATE_ASSET_UNTRUSTED');
  // Verify the entire candidate contents. A digest supplied with the same
  // release is NOT sufficient: verify Sigstore against the fixed signer too.
  const hash=createHash('sha256');
  const fd=fs.openSync(dst,'r');
  const buf=Buffer.allocUnsafe(64*1024);
  try{for(let n;(n=fs.readSync(fd,buf,0,buf.length,null))>0;){
    hash.update(buf.subarray(0,n));
  }}finally{buf.fill(0);fs.closeSync(fd);}
  const digest=hash.digest('hex');
  if(digest!==asset.digest.slice(7))fail('RC012_AUTO_UPDATE_ASSET_HASH_MISMATCH');
  // This is a candidate-only provenance receipt, not an authorized
  // upgrade manifest or rollback approval.
  const proof=path.join(dir,'.candidate-attestation-'+process.pid+'.json');
  try{
    fs.writeFileSync(proof,JSON.stringify({sourceHead:commit,platform,
      candidate:{sha256:digest,bytes:st.size}}),{flag:'wx',mode:0o600});
    const checked=await verifyPublicSignedNativeRelease({
      manifestPath:proof,candidatePath:dst,
      expectedCommit:commit,
      platform:platform==='win32'?'windows':platform
    },{run});
    if(checked.signedCandidateVerified!==true
      ||checked.candidateSha256!==digest)
      fail('RC012_AUTO_UPDATE_SIGNED_ASSET_REJECTED');
  }finally{
    if(fs.existsSync(proof))fs.rmSync(proof);
  }
  return {status:'SIGNED_UPDATE_STAGED_AWAITING_OWNER',
    from:current,to:selected.version,sourceHead:commit,
    tag:selected.tag,candidatePath:dst,sha256:digest,installed:false,
    ownerConsentNeeded:true,rollbackAcceptanceNeeded:true};
}
async function main(args){
  if(args.length!==1||!['--check','--stage'].includes(args[0]))
    fail('RC012_AUTO_UPDATE_USAGE');
  const result=args[0]==='--stage'?await stageApprovedUpdate():
    await (async()=>{const v=await discoverApprovedUpdate();return {
      status:v.needsFirstInstall?'NATIVE_FIRST_INSTALL_REQUIRED'
        :v.selected?'APPROVED_UPDATE_DISCOVERED':'NO_APPROVED_NEW_RELEASE',
      current:v.current,next:v.selected?.version??null,installed:false
    };})();
  console.log(JSON.stringify(result));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main(process.argv.slice(2)).catch(e=>{
    console.error(JSON.stringify({status:'RC012_AUTO_UPDATE_BLOCKED',code:e.code||'RC012_AUTO_UPDATE_FAILED'}));
    process.exitCode=2;
  });
}
