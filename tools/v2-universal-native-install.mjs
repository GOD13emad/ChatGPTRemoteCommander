#!/usr/bin/env node
// One native Commander V2 install entry for Windows and Linux.
// Fresh-install only. Never removes or overwrites legacy Commander, profiles,
// tunnel credentials or existing OS registrations without a proven migration.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {nativePackagePlan} from './v2-universal-native-plan.mjs';

const fail=code=>{throw Error('V2_UNIFIED_NATIVE_INSTALL_'+code)};
const delay=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
function actuallyInstalled(version){
 if(process.platform==='linux'){
  try{
   const format='$'+'{Package}\t$'+'{Version}';
   const out=execFileSync('dpkg-query',['-W','-f='+format,'commander-v2'],
    {encoding:'utf8',timeout:9000,windowsHide:true}).trim();
   return out==='commander-v2\t'+version&&
     fs.existsSync('/opt/Commander V2/commander-v2');
  }catch{return false;}
 }
 if(process.platform!=='win32')fail('OS_UNSUPPORTED');
 const s=[
  "$ErrorActionPreference='Stop'",
  "$keys=@('HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
  "'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
  "'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')",
  "$a=@(Get-ItemProperty -Path $keys -EA SilentlyContinue|Where-Object {",
  "$_.DisplayName -eq 'Commander V2'})",
  "if($a.Count -ne 1){exit 7}",
  "if([string]$a[0].DisplayVersion -ne $env:V2_UNIFIED_EXPECTED_VERSION){exit 8}",
  "exit 0"
 ].join('\n');
 try{execFileSync('pwsh',['-NoProfile','-NonInteractive','-Command',s],
  {timeout:9000,windowsHide:true,env:{...process.env,V2_UNIFIED_EXPECTED_VERSION:version}});
  return true;
 }catch{return false;}
}
function nativeInvocation(admission){
 if(process.platform==='win32')return {bin:admission.command.program,args:['/S']};
 if(process.platform!=='linux')fail('UNSUPPORTED_OS');
 const args=['apt-get','install','-y',admission.command.args[2]];
 if(typeof process.getuid==='function'&&process.getuid()===0)
  return {bin:'env',args:['DEBIAN_FRONTEND=noninteractive',...args]};
 return {bin:'sudo',args:['env','DEBIAN_FRONTEND=noninteractive',...args]};
}
export function installNativeFresh({
 artifact,sha256,version,profile='desktop',inventory,
 approval=false,allowUnsigned=false,
 invoke,verify
}={}){
 if(!approval)fail('NATIVE_OWNER_APPROVAL_REQUIRED');
 if(!allowUnsigned)fail('UNSIGNED_QA_NOT_AUTHORIZED');
 const admission=nativePackagePlan({
  artifact,sha256,version,profile,platform:process.platform,arch:process.arch,inventory
 });
 if(admission.status!=='NATIVE_FRESH_HOST_PREFLIGHT_READY')
  fail('EXISTING_INSTALL_OR_INVENTORY_NOT_VERIFIED');
 if(admission.canInstall!==false||admission.changesApplied!==false)
  fail('ADMISSION_MUTATION_CONTRACT_DRIFT');
 // Byte pin is NOT a publisher identity. Normal UAC/sudo applies.
 const command=nativeInvocation(admission);
 const run=invoke??((bin,args)=>{
  const result=spawnSync(bin,args,{stdio:'inherit',timeout:260000,windowsHide:false});
  if(result.error||result.signal||result.status!==0)fail('OS_PACKAGE_INSTALL_FAILED');
 });
 run(command.bin,command.args);
 const probe=verify??actuallyInstalled;
 let installed=false;
 for(let i=0;i<12;i++){
  if(probe(version)){installed=true;break;}
  if(i!==11)delay(600);
 }
 if(!installed)fail('OS_INSTALL_IDENTITY_NOT_VERIFIED');
 return {schema:1,product:'Commander V2',version,platform:process.platform,
  packageFormat:admission.packageFormat,packageSha256:admission.packageSha256,
  status:'NATIVE_FRESH_INSTALL_VERIFIED',oneOsInstallIdentityVerified:true,
  ownerStateMigrated:false,previousInstallReplaced:false,
  rollbackOfExistingInstallProved:false,publisherSignatureVerified:false,
  fullPowerAuthorized:false};
}
function parse(argv){
 const opts={};let apply=false,allowUnsigned=false;
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  if(arg==='--apply'){apply=true;continue;}
  if(arg==='--allow-unsigned-qa'){allowUnsigned=true;continue;}
  const key=arg.replace(/^--/,'');
  if(!['artifact','sha256','version','profile'].includes(key)||!arg.startsWith('--')||
     Object.hasOwn(opts,key)||i+1>=argv.length)fail('OPTION_INVALID');
  opts[key]=argv[++i];
 }
 if(!opts.artifact||!opts.sha256||!opts.version)fail('REQUIRED_OPTION_MISSING');
 return {opts,apply,allowUnsigned};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const {opts,apply,allowUnsigned}=parse(process.argv.slice(2));
  if(!apply){
   const admission=nativePackagePlan({...opts,platform:process.platform,arch:process.arch});
   process.stdout.write(JSON.stringify(admission)+'\n');
   if(admission.status==='BLOCKED')process.exitCode=3;
  }else{
   const result=installNativeFresh({...opts,approval:true,allowUnsigned});
   process.stdout.write(JSON.stringify(result)+'\n');
  }
 }catch(e){
  console.error(e.message?.startsWith('V2_UNIFIED_NATIVE_INSTALL_')?e.message:
   'V2_UNIFIED_NATIVE_INSTALL_FAILED');
  process.exitCode=2;
 }
}
