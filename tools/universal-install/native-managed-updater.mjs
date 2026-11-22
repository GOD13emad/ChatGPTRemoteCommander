// One shared Windows/Linux managed release stage; never silently install.
// Downloads only signed immutable Stable releases accepted by source train.
// Existing native-cli retains owner TTY, native OS privilege and rollback guards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createNativeOsAdapter} from './native-os-adapters.mjs';
import {discoverTrustedStableRelease,verifyTrustedNativeRelease,REPO}
  from './trusted-native-release.mjs';
const VERSION=/^(\d+)\.(\d+)\.(\d+)(?:-dev\.(\d+))?$/;
const deny=code=>{throw Object.assign(new Error(code),{code});};
const check=(v,code)=>{if(!v)deny(code);};
export function compareNativeVersions(a,b){
  const x=VERSION.exec(a??''),y=VERSION.exec(b??'');
  check(x&&y,'RC012_UPDATE_VERSION_INVALID');
  const parts=m=>[+m[1],+m[2],+m[3],m[4]?0:1,m[4]?+m[4]:0];
  const aa=parts(x),bb=parts(y);
  for(let i=0;i<aa.length;i++){
    if(aa[i]!==bb[i])return aa[i]>bb[i]?1:-1;
  }
  return 0;
}
function gh(program,args,timeoutMs=120000){
  const p=spawnSync(program,args,{encoding:'utf8',windowsHide:true,
    timeout:timeoutMs,maxBuffer:1024*1024});
  check(!p.error&&p.status===0,'RC012_UPDATE_GITHUB_UNAVAILABLE');
  return p.stdout;
}
function stageRoot(){
  return process.platform==='win32'
    ?path.join(process.env.LOCALAPPDATA||os.homedir(),
      'ChatGPTRemoteCommander','signed-native-releases')
    :path.join(process.env.XDG_STATE_HOME||path.join(os.homedir(),'.local','state'),
      'chatgpt-remote-commander','signed-native-releases');
}
function safeDirectory(p){
  fs.mkdirSync(p,{recursive:true,mode:0o700});
  const s=fs.lstatSync(p);
  check(s.isDirectory()&&!s.isSymbolicLink(),'RC012_UPDATE_UNTRUSTED_STAGE');
}
function writeOnce(file,value){
  const content=JSON.stringify(value,null,2)+'\n';
  if(fs.existsSync(file)){
    const s=fs.lstatSync(file);
    check(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1
      &&fs.readFileSync(file,'utf8')===content,
      'RC012_UPDATE_STAGE_COLLISION');
  }else fs.writeFileSync(file,content,{mode:0o600,flag:'wx'});
}
export function managedReceiptPath(){
  return path.join(stageRoot(),'managed-native.json');
}
function verifiedReceipt(file){
  if(!fs.existsSync(file))return null;
  const s=fs.lstatSync(file);
  check(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1
    &&s.size>100&&s.size<=4096,'RC012_UPDATE_RECEIPT_UNTRUSTED');
  let r;
  try{r=JSON.parse(fs.readFileSync(file,'utf8'));}
  catch{deny('RC012_UPDATE_RECEIPT_MALFORMED');}
  check(r?.schema===1&&r.verifiedNativeEffect===true
    &&typeof r.version==='string'&&typeof r.sha256==='string'
    &&typeof r.path==='string'&&path.isAbsolute(r.path),
    'RC012_UPDATE_RECEIPT_INVALID');
  return r;
}
function nativeFilename(version){
  check(VERSION.test(version)&&!version.includes('-'),
    'RC012_UPDATE_STABLE_RELEASE_ONLY');
  const platform=process.platform==='win32'?'Windows-':'Linux-';
  const arch=os.arch()==='x64'?(platform==='Linux-'?'amd64':'x64'):os.arch();
  check(['x64','arm64','amd64'].includes(arch),'RC012_UPDATE_ARCH_UNSUPPORTED');
  return 'Remote-Commander-Unified-'+version+'-'+platform+arch
    +(process.platform==='win32'?'.exe':'.deb');
}
export async function planManagedNativeUpdate({
  discover=discoverTrustedStableRelease,
  snapshot=()=>createNativeOsAdapter({
    platform:process.platform==='win32'?'windows':'linux',
    architecture:os.arch()}).snapshot(),
  receiptPath=managedReceiptPath()
}={}){
  const release=discover(),installed=await snapshot();
  check(installed&&Number.isInteger(installed.registeredInstallCount)
    &&installed.integrityVerified===true,
    'RC012_UPDATE_INSTALLED_STATE_UNTRUSTED');
  const current=installed.version;
  if(current!==null&&compareNativeVersions(release.version,current)<=0){
    return Object.freeze({status:'NO_NEWER_APPROVED_STABLE',
      version:release.version,installedVersion:current});
  }
  const receipt=current===null?null:verifiedReceipt(receiptPath);
  if(current!==null){
    check(receipt&&receipt.version===current,
      'RC012_UPDATE_LEGACY_INSTALL_REQUIRES_APPROVED_BOOTSTRAP');
  }
  return Object.freeze({status:'APPROVED_STABLE_READY_TO_STAGE',
    sourceHead:release.sourceHead,version:release.version,
    tag:release.tag,installedVersion:current,
    previous:receipt?{
      version:receipt.version,path:receipt.path,sha256:receipt.sha256}:null});
}
export async function stageManagedNativeUpdate({
  discover=discoverTrustedStableRelease,snapshot,
  root=stageRoot(),download=gh,verify=verifyTrustedNativeRelease
}={}){
  const plan=await planManagedNativeUpdate({discover,snapshot,
    receiptPath:path.join(root,'managed-native.json')});
  if(plan.status!=='APPROVED_STABLE_READY_TO_STAGE')return plan;
  const dir=path.join(root,plan.version+'-'+plan.sourceHead.slice(0,12));
  safeDirectory(dir);
  const candidatePath=path.join(dir,nativeFilename(plan.version));
  const raw=download('gh',['api',
    'repos/'+REPO+'/releases/tags/'+plan.tag],30000);
  let release;
  try{release=JSON.parse(raw);}catch{deny('RC012_UPDATE_RELEASE_METADATA_INVALID');}
  const assets=Array.isArray(release.assets)
    ?release.assets.filter(x=>x.name===path.basename(candidatePath)):[];
  // Metadata-only budget preflight before downloading a 150+ MB installer.
  check(assets.length===1&&/^sha256:[a-f0-9]{64}$/.test(assets[0].digest)
    &&assets[0].state==='uploaded'&&Number.isInteger(assets[0].size)
    &&assets[0].size>1024&&assets[0].size<=256*1024*1024,
    'RC012_UPDATE_ASSET_UNTRUSTED_OR_STORAGE_BUDGET');
  if(!fs.existsSync(candidatePath)){
    download('gh',['release','download',plan.tag,'--repo',REPO,
      '--pattern',path.basename(candidatePath),'--dir',dir],180000);
  }
  const s=fs.lstatSync(candidatePath);
  check(s.isFile()&&!s.isSymbolicLink()&&s.size===assets[0].size,
    'RC012_UPDATE_ASSET_SIZE_MISMATCH');
  const sha256=assets[0].digest.slice(7);
  const platform=process.platform==='win32'?'windows':'linux';
  const common={sourceHead:plan.sourceHead,
    platform:platform==='windows'?'win32':'linux',
    candidate:{sha256,bytes:s.size}};
  const provenance=plan.previous
    ?{schema:1,...common,rollback:{sha256:plan.previous.sha256,
      bytes:fs.statSync(plan.previous.path).size}}
    :{schema:2,...common};
  const provenanceManifestPath=path.join(dir,'native-release-provenance.json');
  writeOnce(provenanceManifestPath,provenance);
  const manifestPath=path.join(dir,'native-upgrade-manifest.json');
  writeOnce(manifestPath,{
    schema:'rc-universal-native-install-manifest-v1',
    product:'ChatGPTRemoteCommander',platform,architecture:os.arch(),
    installationKind:plan.previous?'upgrade':'fresh',
    expectedCommit:plan.sourceHead,
    candidate:{path:candidatePath,sha256,version:plan.version},
    previous:plan.previous,provenanceManifestPath
  });
  const evidence=verify(manifestPath);
  check(evidence?.verified===true&&evidence.sourceHead===plan.sourceHead,
    'RC012_UPDATE_INDEPENDENT_SIGNATURE_REQUIRED');
  return Object.freeze({status:'SIGNED_NATIVE_STAGED_OWNER_CONSENT_REQUIRED',
    manifestPath,releaseVersion:plan.version,currentVersion:plan.installedVersion,
    autoPromotion:false,nativeOwnerConsentRequired:true});
}
export async function applyStagedManagedNativeUpdate(manifestPath,{
  verify=verifyTrustedNativeRelease,
  nativeRun=(cli,manifest,proof)=>spawnSync(process.execPath,
    [cli,'--apply','--manifest',manifest],{
      stdio:'inherit',windowsHide:false,
      env:{...process.env,
        RC012_OWNER_PINNED_NATIVE_MANIFEST_SHA256:proof.pinnedManifestSha256,
        RC012_OWNER_PINNED_SOURCE_HEAD:proof.sourceHead}}),
  snapshot=()=>createNativeOsAdapter({
    platform:process.platform==='win32'?'windows':'linux',
    architecture:os.arch()}).snapshot(),
  root=stageRoot(),ownerTTY=process.stdin.isTTY&&process.stdout.isTTY
}={}){
  check(ownerTTY,'RC012_UPDATE_NATIVE_OWNER_TTY_REQUIRED');
  const proof=verify(manifestPath);
  check(proof?.verified===true&&proof.sourceHead&&proof.pinnedManifestSha256,
    'RC012_UPDATE_SIGNED_PROOF_REQUIRED');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  check(manifest.candidate?.version===proof.version
    &&manifest.expectedCommit===proof.sourceHead,
    'RC012_UPDATE_MANIFEST_CHANGED');
  const cli=path.join(path.dirname(fileURLToPath(import.meta.url)),
    'native-cli.mjs');
  const result=nativeRun(cli,manifestPath,proof);
  check(!result?.error&&result?.status===0,
    'RC012_UPDATE_OWNER_NATIVE_EFFECT_UNVERIFIED');
  const after=await snapshot();
  check(after?.integrityVerified===true&&after.registeredInstallCount===1
    &&after.version===proof.version,
    'RC012_UPDATE_POST_EFFECT_RECONCILIATION_REQUIRED');
  safeDirectory(root);
  const receipt=path.join(root,'managed-native.json');
  if(fs.existsSync(receipt)){
    const old=fs.lstatSync(receipt);
    check(old.isFile()&&!old.isSymbolicLink()&&old.nlink===1,
      'RC012_UPDATE_EXISTING_RECEIPT_UNTRUSTED');
    const backup=path.join(root,'managed-native.previous.json');
    if(fs.existsSync(backup)){
      const prior=fs.lstatSync(backup);
      check(prior.isFile()&&!prior.isSymbolicLink()&&prior.nlink===1,
        'RC012_UPDATE_PRIOR_RECEIPT_UNTRUSTED');
    }
    fs.copyFileSync(receipt,backup);
  }
  const tmp=path.join(root,'.managed-native.tmp-'+process.pid);
  const record={schema:1,verifiedNativeEffect:true,
    version:proof.version,sourceHead:proof.sourceHead,
    sha256:manifest.candidate.sha256,path:manifest.candidate.path};
  fs.writeFileSync(tmp,JSON.stringify(record,null,2)+'\n',
    {flag:'wx',mode:0o600});
  fs.renameSync(tmp,receipt);
  return Object.freeze({status:'MANAGED_NATIVE_INSTALLED_VERIFIED',
    version:proof.version,receiptRecorded:true,liveCoreChanged:false});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  (async()=>{
    const args=process.argv.slice(2);
    let result;
    if(args.length===1&&['--check','--stage'].includes(args[0])){
      result=args[0]==='--stage'
        ?await stageManagedNativeUpdate():await planManagedNativeUpdate();
    }else if(args.length===3&&args[0]==='--apply'
      &&args[1]==='--manifest'&&path.isAbsolute(args[2])){
      result=await applyStagedManagedNativeUpdate(args[2]);
    }else deny('RC012_UPDATE_ARGS_INVALID');
    console.log(JSON.stringify(result));
  })().catch(e=>{
    console.error(JSON.stringify({status:'NO_AUTOMATIC_PROMOTION',
      code:e?.code??'RC012_UPDATE_UNEXPECTED_FAILURE',liveCoreChanged:false}));
    process.exitCode=2;
  });
}
