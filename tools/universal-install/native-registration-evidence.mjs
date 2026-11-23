// Read-only, cross-OS native registration observation; NOT a restore grant.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {NATIVE_LINUX_PACKAGE,NATIVE_WINDOWS_UNINSTALL_KEY}
 from './native-os-adapters.mjs';
const HASH=/^[0-9a-f]{64}$/;
const VERSION=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-dev\.[1-9]\d*)?$/;
const fail=c=>{throw Object.assign(new Error(c),{code:c});};
const assert=(v,c)=>{if(!v)fail(c);};
function nativeRun(binary,args){
 const r=spawnSync(binary,args,{encoding:'utf8',windowsHide:true,
  timeout:60000,maxBuffer:2*1024*1024});
 assert(!r.error&&!r.signal&&Number.isInteger(r.status),'NATIVE_REGISTRATION_PROBE_UNAVAILABLE');
 return {code:r.status,stdout:r.stdout.trim(),stderr:r.stderr.trim()};
}
const windowsRead="$ErrorActionPreference='Stop'\n$key='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{REG_KEY}'\n$root=Join-Path $env:LOCALAPPDATA 'Programs\\remote-commander-unified'\n$exe=Join-Path $root 'Remote Commander.exe'\n$un=Join-Path $root 'Uninstall Remote Commander.exe'\n$r=Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue\nif(!$r){[Console]::Out.Write('{\"present\":false}');exit}\n$safe=$true\nforeach($p in @($root,$exe,$un)){\n if(!(Test-Path -LiteralPath $p)){$safe=$false;continue}\n if(((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){$safe=$false}\n}\n$found=Test-Path -LiteralPath $un -PathType Leaf\n$exeFound=Test-Path -LiteralPath $exe -PathType Leaf\n$v=[string]$r.DisplayVersion\n$u='\"'+$un+'\" /currentuser'\n$q=$u+' /S'\n$i=$exe+',0'\n$valid=([string]$r.DisplayName -ceq ('Remote Commander '+$v)) -and ([string]$r.UninstallString -ceq $u) -and ([string]$r.QuietUninstallString -ceq $q) -and ([string]$r.DisplayIcon -ceq $i) -and ([string]$r.NoModify -ceq '1') -and ([string]$r.NoRepair -ceq '1')\nif($exeFound -and (Get-Item -LiteralPath $exe).VersionInfo.FileVersion -cne $v){$valid=$false}\n$hash=if($found){(Get-FileHash -LiteralPath $un -Algorithm SHA256).Hash.ToLowerInvariant()}else{$null}\n[Console]::Out.Write((ConvertTo-Json -Compress -InputObject ([ordered]@{\n present=$true;version=$v;uninstallerPresent=[bool]$found;executablePresent=[bool]$exeFound;\n pathSafety=[bool]$safe;registrationFieldsMatch=[bool]$valid;uninstallerSha256=$hash\n})))";

export function inspectNativeRegistration({
 platform=process.platform==='win32'?'windows':process.platform,
 run=nativeRun
}={}){
 assert(['windows','linux'].includes(platform)&&typeof run==='function',
  'NATIVE_REGISTRATION_PLATFORM_UNSUPPORTED');
 let version=null,consistent=false,detail;
 if(platform==='windows'){
  const script=windowsRead.replace('{REG_KEY}',NATIVE_WINDOWS_UNINSTALL_KEY);
  const encoded=Buffer.from(script,'utf16le').toString('base64');
  const r=run('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded]);
  assert(r.code===0&&typeof r.stdout==='string'&&r.stdout.length<4096,
   'NATIVE_REGISTRATION_WINDOWS_READ_FAILED');
  let p;try{p=JSON.parse(r.stdout);}catch{fail('NATIVE_REGISTRATION_OUTPUT_INVALID');}
  assert(p&&typeof p==='object'&&typeof p.present==='boolean',
   'NATIVE_REGISTRATION_OUTPUT_INVALID');
  if(p.present){
   assert(typeof p.version==='string'&&VERSION.test(p.version)
    &&typeof p.uninstallerPresent==='boolean'&&typeof p.executablePresent==='boolean'
    &&typeof p.pathSafety==='boolean'&&typeof p.registrationFieldsMatch==='boolean'
    &&(p.uninstallerSha256===null||HASH.test(p.uninstallerSha256)),
   'NATIVE_REGISTRATION_OUTPUT_INVALID');
   version=p.version;
   consistent=p.uninstallerPresent&&p.executablePresent&&p.pathSafety
    &&p.registrationFieldsMatch&&HASH.test(p.uninstallerSha256??'');
  }
  detail={uninstallerPresent:p.present?p.uninstallerPresent:false,
   uninstallerSha256:p.present?p.uninstallerSha256:null,
   registrationStructureConsistent:consistent};
 }else{
  const format='-f=$'+'{Package}|$'+'{Version}|$'+'{Status}';
  const q=run('dpkg-query',['-W',format,NATIVE_LINUX_PACKAGE]);
  if(q.code===1&&/no packages found matching/i.test(q.stderr??'')){
   detail={dpkgListedEntries:0,dpkgVerifyPassed:false};
  }else{
   assert(q.code===0&&typeof q.stdout==='string','NATIVE_REGISTRATION_LINUX_QUERY_FAILED');
   const parts=q.stdout.split('|');
   assert(parts.length===3&&parts[0]===NATIVE_LINUX_PACKAGE
    &&parts[2]==='install ok installed','NATIVE_REGISTRATION_LINUX_STATUS_INVALID');
   version=parts[1].replace(/~dev\./,'-dev.');
   assert(VERSION.test(version),'NATIVE_REGISTRATION_LINUX_VERSION_INVALID');
   const list=run('dpkg-query',['-L',NATIVE_LINUX_PACKAGE]);
   assert(list.code===0&&typeof list.stdout==='string'&&list.stdout.length<2*1024*1024,
    'NATIVE_REGISTRATION_LINUX_LIST_FAILED');
   const paths=list.stdout.split(/\r?\n/).filter(Boolean);
   assert(paths.length>0&&paths.length<=20000&&paths.every(x=>x.startsWith('/')&&!x.includes('\0')),
    'NATIVE_REGISTRATION_LINUX_LIST_INVALID');
   const verify=run('dpkg',['--verify',NATIVE_LINUX_PACKAGE]);
   consistent=verify.code===0&&!verify.stdout&&!verify.stderr;
   detail={dpkgListedEntries:paths.length,dpkgVerifyPassed:consistent,
    dpkgPathListSha256:createHash('sha256').update(paths.join('\n')).digest('hex')};
  }
 }
 return Object.freeze({schema:'rc-universal-native-registration-evidence-v1',
  platform,status:version===null?'NOT_REGISTERED':
   consistent?'REGISTRATION_OBSERVED':'REGISTRATION_DRIFT',
  registeredVersion:version,...detail,archivePayloadMatchNotAsserted:true,
  fullRestoreVerified:false,publisherIdentityVerified:false,
  ownerRecoveryVerified:false,nativeEffectPerformed:false});
}
