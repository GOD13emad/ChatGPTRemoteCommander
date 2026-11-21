#!/usr/bin/env node
// Typed, read-only native package adapter for the *same* Commander V2 install authority.
// Native NSIS/DEB package execution and V1->V2 cutover are separate acceptance gates.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {collectV2InstallCollisionInventory,assessV2InstallCollision} from './v2-install-collision-inventory.mjs';

const fail=code=>{throw Error('V2_NATIVE_PLAN_'+code)};
const formats={win32:'nsis',linux:'deb'};
const extension={win32:'.exe',linux:'.deb'};
const product='Commander V2';
function shaFile(file){
  const fd=fs.openSync(file,'r');const b=Buffer.allocUnsafe(65536);
  const h=crypto.createHash('sha256');
  try{let n;while((n=fs.readSync(fd,b,0,b.length,null))>0)h.update(b.subarray(0,n));}
  finally{fs.closeSync(fd);}
  return h.digest('hex');
}
function safeArtifact(file){
  if(typeof file!=='string'||!path.isAbsolute(file))fail('ABSOLUTE_ARTIFACT_REQUIRED');
  let x=path.resolve(file);
  while(true){
    if(fs.existsSync(x)&&fs.lstatSync(x).isSymbolicLink())fail('ALIAS_ARTIFACT');
    const parent=path.dirname(x);if(parent===x)break;x=parent;
  }
  const s=fs.lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size<=0||s.size>1024*1024*1024)
    fail('NATIVE_ARTIFACT_NOT_REGULAR_OR_BUDGET');
  return s;
}
function relevantInventoryState(i,platform){
  if(!i||i.schema!==1||i.platform!==platform)
    return 'INVENTORY_NOT_PROVED';
  try{assessV2InstallCollision(i);}catch{return 'INVENTORY_NOT_PROVED'}
  if(i.completeness!=='OBSERVED')return 'INVENTORY_NOT_PROVED';
  if(platform==='win32'){
    for(const name of ['apps','tasks','processes']){
      if(i[name]?.status!=='OBSERVED'||!Array.isArray(i[name]?.items))return 'INVENTORY_NOT_PROVED';
      if(i[name].items.length)return 'EXISTING_COMMANDER_IDENTITY';
    }
  }else{
    for(const name of ['packages','unitFiles','activeUnits']){
      if(i[name]?.status!=='OBSERVED'||!Array.isArray(i[name]?.items))return 'INVENTORY_NOT_PROVED';
      if(i[name].items.length)return 'EXISTING_COMMANDER_IDENTITY';
    }
    if(i.locations?.some(x=>x.state!=='ABSENT'))
      return 'LEGACY_PATH_REQUIRES_MIGRATION';
  }
  return 'FRESH_HOST';
}
export function nativePackagePlan({
  artifact,sha256,version,profile='desktop',platform=process.platform,arch=process.arch,
  inventory,features=[]
}={}){
  if(!['win32','linux'].includes(platform)||!formats[platform])fail('OS_UNSUPPORTED');
  if(arch!=='x64')fail('NATIVE_PACKAGE_ARCH_UNQUALIFIED');
  if(typeof version!=='string'||!/^([0-9]+\.){2}[0-9]+(?:-[a-z0-9.-]+)?$/.test(version))
    fail('VERSION_INVALID');
  if(!/^[a-f0-9]{64}$/.test(sha256||''))fail('EXPECTED_NATIVE_SHA_REQUIRED');
  if(!Array.isArray(features)||features.some(x=>typeof x!=='string'||x.length>36))
    fail('INVALID_FEATURES');
  if(!['desktop','headless'].includes(profile))fail('PROFILE_INVALID');
  // Published QA installer currently carries Desktop. It cannot silently
  // claim a headless server service/profile that has not been packaged.
  if(profile==='headless')fail('HEADLESS_SERVICE_PAYLOAD_NOT_PROVED');
  const stat=safeArtifact(artifact);
  if(path.extname(artifact).toLowerCase()!==extension[platform])
    fail('ARTIFACT_EXTENSION_OS_MISMATCH');
  const fd=fs.openSync(artifact,'r'),magic=Buffer.alloc(platform==='win32'?2:8);
  try{fs.readSync(fd,magic,0,magic.length,0);}finally{fs.closeSync(fd);}
  if(platform==='win32'&&magic.toString('ascii')!=='MZ')fail('NOT_A_PE_EXECUTABLE');
  if(platform==='linux'&&magic.toString('ascii')!=='!<arch>\n')fail('NOT_A_DEBIAN_ARCHIVE');
  // The file header is only an early rejection check, not package identity.
  const verified=shaFile(artifact);
  if(verified!==sha256)fail('PINNED_NATIVE_ARTIFACT_HASH_MISMATCH');
  const observation=inventory??collectV2InstallCollisionInventory({platform});
  const state=relevantInventoryState(observation,platform);
  const command=platform==='win32'?
    {program:path.resolve(artifact),args:['/S'],admin:'native UAC only when required'}:
    {program:'apt-get',args:['install','-y',path.resolve(artifact)],admin:'native root/sudo required'};
  const result={
    schema:1,product,version,platform,arch,profile,packageFormat:formats[platform],
    packageBytes:stat.size,packageSha256:verified,installIdentity:platform==='win32'?
      'Commander V2':'commander-v2',
    command,preflight:state,
    status:state==='FRESH_HOST'?'NATIVE_FRESH_HOST_PREFLIGHT_READY':'BLOCKED',
    changesApplied:false,canInstall:false,existingInstallReplaced:false,
    publisherVerified:false,
    requiresRealNativeInstallAndRollbackProof:true,
    ownerApprovalNeeded:true,publicReleaseAuthorized:false
  };
  return result;
}
function parse(args){
  const o={};
  for(let n=0;n<args.length;n+=2){
    const k=args[n]?.replace(/^--/,'');
    if(!['artifact','sha256','version','profile'].includes(k)||Object.hasOwn(o,k)||
       n+1>=args.length)fail('OPTIONS_INVALID');
    o[k]=args[n+1];
  }
  if(!o.artifact||!o.sha256||!o.version)fail('REQUIRED_OPTIONS');
  return o;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=nativePackagePlan(parse(process.argv.slice(2)));
      process.stdout.write(JSON.stringify(result)+'\n');
      if(result.status==='BLOCKED')process.exitCode=3;
  }catch(e){console.error(e.message?.startsWith('V2_NATIVE_PLAN_')?e.message:'V2_NATIVE_PLAN_FAILED');process.exitCode=2;}
}
