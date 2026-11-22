#!/usr/bin/env node
// Stable-channel automatic discovery/staging. This is intentionally not a
// background privilege broker and never silently installs a NoPromote build.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {verifiedAttestationSubject} from './signed-native-provenance.mjs';

const REPO='GOD13emad/ChatGPTRemoteCommander';
const WORKFLOW=REPO+'/.github/workflows/unified-installer-pilot.yml';
const TAG=/^v(\d+)\.(\d+)\.(\d+)$/;
const COMMIT=/^[a-f0-9]{40}$/;
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
    const r=exec('dpkg-query',['-W','-f=${Version}','chatgpt-remote-commander']);
    // dpkg: 0.12.0~dev.9 -> comparable 0.12.0-dev.9
    return r.trim().replace('~dev.','-dev.');
  }
  if(process.platform==='win32'){
    const reg='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\e8b3b1a5-66f7-5b0b-b5ed-ddf867067934';
    return exec('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-Command',
      "(Get-ItemProperty -LiteralPath '"+reg+"').DisplayVersion"]).trim();
  }
  fail('RC012_AUTO_UPDATE_PLATFORM_UNSUPPORTED');
}
function ghApi(endpoint){return json(exec('gh',['api',endpoint]));}
function signedSourceTrain(tag,majorMinor){
  const loc='repos/'+REPO+'/contents/docs/release-train-'+majorMinor+
    '.json?ref='+encodeURIComponent(tag);
  try{
    const res=ghApi(loc);
    if(res.type!=='file'||res.encoding!=='base64')return null;
    const text=Buffer.from(res.content.replace(/\s/g,''),'base64').toString('utf8');
    return json(text);
  }catch{return null;}
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
export function discoverApprovedUpdate(){
  const current=installedNativeVersion();
  const releases=ghApi('repos/'+REPO+'/releases?per_page=30');
  const selected=approvedRelease({current,releases,trainFor:signedSourceTrain});
  return {current,selected};
}
export function stageApprovedUpdate({run=exec,api=ghApi}={}){
  const {current,selected}=discoverApprovedUpdate();
  if(!selected)return {status:'NO_APPROVED_NEW_RELEASE',current,installed:false};
  const platform=process.platform;
  const asset=expectedArtifact(selected.release,platform,os.arch());
  if(!asset||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))
    fail('RC012_AUTO_UPDATE_SIGNED_ASSET_MISSING');
  const commit=api('repos/'+REPO+'/commits/'+encodeURIComponent(selected.tag)).sha;
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
    run('gh',['release','download',selected.tag,'-R',REPO,'-p',asset.name,'-D',dir],{timeout:180000});
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
  const verified=run('gh',['attestation','verify',dst,'--repo',REPO,
    '--source-digest',commit,'--signer-workflow',WORKFLOW,
    '--deny-self-hosted-runners','--format','json'],{timeout:90000,maxBuffer:512*1024});
  verifiedAttestationSubject(verified,{name:asset.name,sha256:digest});
  return {status:'SIGNED_UPDATE_STAGED_AWAITING_OWNER',
    from:current,to:selected.version,sourceHead:commit,
    tag:selected.tag,candidatePath:dst,sha256:digest,installed:false,
    ownerConsentNeeded:true,rollbackAcceptanceNeeded:true};
}
async function main(args){
  if(args.length!==1||!['--check','--stage'].includes(args[0]))
    fail('RC012_AUTO_UPDATE_USAGE');
  const result=args[0]==='--stage'?stageApprovedUpdate():
    (()=>{const v=discoverApprovedUpdate();return {
      status:v.selected?'APPROVED_UPDATE_DISCOVERED':'NO_APPROVED_NEW_RELEASE',
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
