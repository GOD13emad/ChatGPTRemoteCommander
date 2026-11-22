// Only this adapter layer knows dpkg/NSIS. Same transaction, invariants,
// Journal, approval, rollback and package identity on every owner's host.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const fail=c=>{throw Object.assign(new Error(c),{code:c});};
const check=(c,e)=>{if(!c)fail(e);};
const HASH=/^[a-f0-9]{64}$/;
const VERSION=/^0\.12\.0-dev\.[1-9][0-9]*$/;
const sha=b=>createHash('sha256').update(b).digest('hex');
const PRODUCT='ChatGPTRemoteCommander';
const PKG='chatgpt-remote-commander';
const WIN_KEY='e8b3b1a5-66f7-5b0b-b5ed-ddf867067934';
const metadata={product:PRODUCT,format:'native'};
const shellQuote=s=>"'"+s.replaceAll("'","''")+"'";
const dpkgVersion=v=>{
  const m=/^0\.12\.0~dev\.([1-9][0-9]*)$/.exec(v);
  check(!!m,'UNIVERSAL_NATIVE_LINUX_VERSION_INVALID');
  return '0.12.0-dev.'+m[1];
};
function regularArtifact(input,platform,arch){
  check(input&&typeof input.path==='string'&&path.isAbsolute(input.path)
    &&HASH.test(input.sha256)&&VERSION.test(input.version),
    'UNIVERSAL_NATIVE_ARTIFACT_ARGUMENT_INVALID');
  const p=path.resolve(input.path),st=fs.lstatSync(p);
  check(st.isFile()&&!st.isSymbolicLink()&&st.size>1024
    &&st.size<1024*1024*1024,'UNIVERSAL_NATIVE_ARTIFACT_UNTRUSTED');
  const artifactArch=platform==='linux'&&arch==='x64'?'amd64':arch;
  const exact='Remote-Commander-Unified-'+input.version+'-'
    +(platform==='linux'?'Linux-':'Windows-')+artifactArch
    +(platform==='linux'?'.deb':'.exe');
  check(path.basename(p)===exact,'UNIVERSAL_NATIVE_ARTIFACT_FAMILY_MISMATCH');
  const fd=fs.openSync(p,'r'),h=createHash('sha256'),buf=Buffer.alloc(1024*1024);
  try{
    const before=fs.fstatSync(fd);
    check(before.isFile()&&before.dev===st.dev&&before.ino===st.ino
      &&before.size===st.size,'UNIVERSAL_NATIVE_ARTIFACT_CHANGED');
    let bytes=0;
    for(let n;(n=fs.readSync(fd,buf,0,buf.length,null))>0;){
      bytes+=n;h.update(buf.subarray(0,n));
    }
    const after=fs.fstatSync(fd),last=fs.lstatSync(p);
    check(bytes===before.size&&after.size===before.size
      &&after.dev===before.dev&&after.ino===before.ino
      &&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs
      &&last.dev===before.dev&&last.ino===before.ino
      &&last.mtimeMs===before.mtimeMs
      &&!last.isSymbolicLink(),'UNIVERSAL_NATIVE_ARTIFACT_CHANGED');
  }finally{buf.fill(0);fs.closeSync(fd);}
  check(h.digest('hex')===input.sha256,
    'UNIVERSAL_NATIVE_ARTIFACT_SHA256_MISMATCH');
  return p;
}
function defaultRun(binary,argv,{timeoutMs=15000,checkExit=true}={}){
  const r=spawnSync(binary,argv,{
    encoding:'utf8',windowsHide:true,timeout:timeoutMs,maxBuffer:256*1024
  });
  check(!r.error&&!r.signal&&Number.isInteger(r.status),
    'UNIVERSAL_NATIVE_OS_COMMAND_UNAVAILABLE');
  if(checkExit)check(r.status===0,'UNIVERSAL_NATIVE_OS_COMMAND_REJECTED');
  return {code:r.status,stdout:r.stdout.trim(),stderr:r.stderr.trim()};
}
function ps(script,run,{timeoutMs=15000}={}){
  const enc=Buffer.from(script,'utf16le').toString('base64');
  return run('pwsh',['-NoLogo','-NoProfile','-NonInteractive',
    '-EncodedCommand',enc],{timeoutMs}).stdout;
}
function shaOfRuntime(raw){
  check(typeof raw==='string'&&raw.length<100000&&raw.length>0,
    'UNIVERSAL_NATIVE_RUNTIME_UNAVAILABLE');
  return sha(raw);
}
/** Effects are internal methods; executeNativeTransaction supplies owner
 * approval, exclusive journal and pre/post-effect reconciliation. */
export function createNativeOsAdapter({
  platform=process.platform==='win32'?'windows':process.platform,
  architecture=os.arch(),run=defaultRun
}={}){
  check(['windows','linux'].includes(platform)
    &&['x64','arm64'].includes(architecture)
    &&typeof run==='function','UNIVERSAL_NATIVE_PLATFORM_UNSUPPORTED');
  const win=platform==='windows';
  function getRuntime(){
    if(!win){
      const r=run('systemctl',['--user','show',
        'chatgpt-remote-commander.service','-p','MainPID',
        '-p','ExecStart','-p','ActiveState'],{timeoutMs:8000});
      check(r.stdout.includes('MainPID=')&&r.stdout.includes('ActiveState='),
        'UNIVERSAL_NATIVE_RUNTIME_UNAVAILABLE');
      return shaOfRuntime(r.stdout);
    }
    const script=[
      "$ErrorActionPreference='Stop'",
      "$l=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | "+
        "Select-Object LocalAddress,LocalPort,OwningProcess | "+
        "Sort-Object LocalAddress,LocalPort,OwningProcess)",
      "$canonical=($l|ConvertTo-Json -Depth 3 -Compress)",
      "$hash=[Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($canonical))",
      "[Console]::Out.Write([Convert]::ToHexString($hash).ToLowerInvariant())"
    ].join('\n');
    const digest=ps(script,run);
    check(HASH.test(digest),'UNIVERSAL_NATIVE_RUNTIME_UNAVAILABLE');
    return digest;
  }
  async function inspect(input){
    const artifact=regularArtifact(input,platform,architecture);
    if(!win){
      const pkg=run('dpkg-deb',['--field',artifact,'Package']).stdout;
      const version=dpkgVersion(run('dpkg-deb',['--field',artifact,'Version']).stdout);
      const arch=run('dpkg-deb',['--field',artifact,'Architecture']).stdout;
      check(pkg===PKG&&version===input.version
        &&arch===(architecture==='x64'?'amd64':'arm64'),
        'UNIVERSAL_NATIVE_LINUX_PACKAGE_METADATA_MISMATCH');
    }else{
      const script=[
        "$ErrorActionPreference='Stop'",
        "$i=Get-Item -LiteralPath "+shellQuote(artifact)+" -ErrorAction Stop",
        "[Console]::Out.Write($i.VersionInfo.FileVersion)"
      ].join('\n');
      check(ps(script,run)===input.version,
        'UNIVERSAL_NATIVE_WINDOWS_BINARY_VERSION_MISMATCH');
    }
    return {...metadata,platform,architecture,
      sha256:input.sha256,version:input.version};
  }
  async function snapshot(){
    let version,integrity=true;
    if(!win){
      const format='-f='+String.fromCharCode(36)+'{Version}|'+
        String.fromCharCode(36)+'{Status}';
      const pair=run('dpkg-query',['-W',format,PKG]).stdout.split('|');
      check(pair.length===2&&pair[1]==='install ok installed',
        'UNIVERSAL_NATIVE_INSTALLED_PACKAGE_MISSING');
      version=dpkgVersion(pair[0]);
      const v=run('dpkg',['--verify',PKG],{timeoutMs:45000,checkExit:false});
      integrity=v.code===0&&!v.stdout&&!v.stderr;
    }else{
      const script=[
        "$ErrorActionPreference='Stop'",
        "$root='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'",
        "$hits=@(Get-ChildItem -LiteralPath $root | Where-Object {"+
          " $_.PSChildName -eq "+shellQuote(WIN_KEY)+" })",
        "if($hits.Count -ne 1){throw 'COMMANDER_NSIS_REGISTRY_INVALID'}",
        // One NSIS family per user: never coexist with legacy Inno or HKLM.
        "$legacy=Get-ItemProperty -LiteralPath ($root+'\\RemoteCommander') "+
          "-ErrorAction SilentlyContinue",
        "$machine=Get-ItemProperty -LiteralPath "+
          "'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\"+WIN_KEY+"' "+
          "-ErrorAction SilentlyContinue",
        "$legacyMachine=Get-ItemProperty -LiteralPath "+
          "'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RemoteCommander' "+
          "-ErrorAction SilentlyContinue",
        "$legacyWow=Get-ItemProperty -LiteralPath "+
          "'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RemoteCommander' "+
          "-ErrorAction SilentlyContinue",
        "if($legacy -or $machine -or $legacyMachine -or $legacyWow)"+
          "{throw 'COMMANDER_DUPLICATE_INSTALL_FAMILY'}",
        "$v=Get-ItemProperty -LiteralPath $hits[0].PSPath",
        "$bin=Join-Path $env:LOCALAPPDATA 'Programs\\remote-commander-unified\\Remote Commander.exe'",
        "$file=Get-Item -LiteralPath $bin -ErrorAction Stop",
        "if($v.DisplayVersion -cne $file.VersionInfo.FileVersion -or "+
          "$v.DisplayName -cnotlike 'Remote Commander *')"+
          "{throw 'COMMANDER_NSIS_VERSION_DRIFT'}",
        "[Console]::Out.Write($v.DisplayVersion)"
      ].join('\n');
      version=ps(script,run);
      check(VERSION.test(version),'UNIVERSAL_NATIVE_WINDOWS_INSTALLED_VERSION_INVALID');
    }
    return {...metadata,version,registeredInstallCount:1,
      integrityVerified:integrity,runtime:{
        fingerprint:getRuntime(),liveCoreCutover:false,
        ownerGrantIssued:false,existingTunnelModified:false
      }};
  }
  async function effect(artifact,plan){
    check(artifact?.version===plan?.candidate?.version
      ||artifact?.version===plan?.previous?.version,
      'UNIVERSAL_NATIVE_UNEXPECTED_EFFECT_TARGET');
    const p=regularArtifact(artifact,platform,architecture);
    if(!win){
      // Linux pkexec is OS-native consent; never request/supply a password.
      run('pkexec',['/usr/bin/dpkg','--install',p],{timeoutMs:180000});
    }else{
      const script=[
        "$ErrorActionPreference='Stop'",
        "$identity=[Security.Principal.WindowsIdentity]::GetCurrent()",
        "$isAdmin=[Security.Principal.WindowsPrincipal]::new($identity).IsInRole("+
          "[Security.Principal.WindowsBuiltInRole]::Administrator)",
        "if($isAdmin){throw 'WINDOWS_NSIS_ELEVATED_OWNER_REFUSED'}",
        "$p=Start-Process -FilePath "+shellQuote(p)+
          " -ArgumentList '/S' -PassThru -Wait -ErrorAction Stop",
        "if($p.ExitCode -ne 0){throw 'WINDOWS_NSIS_EXIT_NONZERO'}",
        "[Console]::Out.Write('NATIVE_NSIS_EXIT_ZERO')"
      ].join('\n');
      check(ps(script,run,{timeoutMs:180000})==='NATIVE_NSIS_EXIT_ZERO',
        'UNIVERSAL_NATIVE_NSIS_EFFECT_FAILED');
    }
  }
  return Object.freeze({
    platform,architecture,inspect,snapshot,
    install:effect,restore:effect,verify:async()=>snapshot()
  });
}
