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
const VERSION=/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-dev\.[1-9][0-9]*)?$/;
const sha=b=>createHash('sha256').update(b).digest('hex');
const PRODUCT='ChatGPTRemoteCommander';
const PKG='chatgpt-remote-commander';
const WIN_KEY='e8b3b1a5-66f7-5b0b-b5ed-ddf867067934';
const metadata={product:PRODUCT,format:'native'};
const shellQuote=s=>"'"+s.replaceAll("'","''")+"'";
const dpkgVersion=v=>{
  const m=/^((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))(?:~dev\.([1-9][0-9]*))?$/.exec(v);
  check(!!m,'UNIVERSAL_NATIVE_LINUX_VERSION_INVALID');
  return m[1]+(m[2]?'-dev.'+m[2]:'');
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
export function windowsNativePowerShell({env=process.env}={}){
  // Windows PowerShell 5.1 is built into supported Windows hosts; do not
  // make package installation depend on separately installed PowerShell 7.
  const root=env.SystemRoot||String.raw`C:\Windows`;
  check(typeof root==='string'&&path.win32.isAbsolute(root)
    &&!/[\r\n\0]/.test(root),
    'UNIVERSAL_NATIVE_WINDOWS_SYSTEMROOT_INVALID');
  return path.win32.join(root,'System32','WindowsPowerShell',
    'v1.0','powershell.exe');
}
function ps(script,run,{timeoutMs=30000}={}){
  const enc=Buffer.from(script,'utf16le').toString('base64');
  return run(windowsNativePowerShell(),['-NoLogo','-NoProfile','-NonInteractive',
    '-EncodedCommand',enc],{timeoutMs}).stdout;
}
function shaOfRuntime(raw){
  check(typeof raw==='string'&&raw.length<100000&&raw.length>0,
    'UNIVERSAL_NATIVE_RUNTIME_UNAVAILABLE');
  return sha(raw);
}
// The owner-local transaction journal is allowed on an otherwise empty host.
// A real user profile, native Core service or historic Commander data is NOT.
// Refuse ambiguous links, files in the state root or any unexpected sibling.
export function cleanFreshLinuxOwnerState(home=os.homedir()){
  check(typeof home==='string'&&path.isAbsolute(home),
    'UNIVERSAL_NATIVE_FRESH_OWNER_ROOT_INVALID');
  const existing=[
    path.join(home,'.config','chatgpt-remote-commander'),
    path.join(home,'.local','share','ChatGPTRemoteCommander'),
    path.join(home,'.local','share','chatgpt-remote-commander')
  ];
  for(const root of existing){
    if(fs.existsSync(root))return false;
  }
  const root=path.join(home,'.local','state','chatgpt-remote-commander');
  if(!fs.existsSync(root))return true;
  const stat=fs.lstatSync(root);
  if(!stat.isDirectory()||stat.isSymbolicLink())return false;
  const entries=fs.readdirSync(root);
  if(entries.length!==1||entries[0]!=='rc-universal-native-journal')
    return false;
  const journal=path.join(root,'rc-universal-native-journal');
  const st=fs.lstatSync(journal);
  return st.isDirectory()&&!st.isSymbolicLink();
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
  function getRuntime({requireInactiveForFresh=false}={}){
    if(!win){
      const r=run('systemctl',['--user','show',
        'chatgpt-remote-commander.service','-p','MainPID',
        '-p','ExecStart','-p','ActiveState'],{timeoutMs:8000});
      check(r.stdout.includes('MainPID=')&&r.stdout.includes('ActiveState='),
        'UNIVERSAL_NATIVE_RUNTIME_UNAVAILABLE');
      // A previously absent, inactive user unit can appear after first
      // package installation. Its *unit file*, not the active Core, changed.
      // Preserve active service identity, but normalize inactive/zero-PID.
      const main=/^MainPID=(\d+)$/m.exec(r.stdout);
      const state=/^ActiveState=([a-z-]+)$/m.exec(r.stdout);
      check(!!main&&!!state,'UNIVERSAL_NATIVE_RUNTIME_UNAVAILABLE');
      // Failed units and zero-package but live legacy Core must not be
      // interpreted as a clean native install target.
      const inactive=main[1]==='0'&&state[1]==='inactive';
      if(requireInactiveForFresh&&!inactive)
        fail('UNIVERSAL_NATIVE_FRESH_ACTIVE_LEGACY_CORE');
      return shaOfRuntime(inactive?'NO_ACTIVE_COMMANDER_CORE':r.stdout);
    }
    const script=[
      "$ErrorActionPreference='Stop'",
      "$l=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | "+
        "Select-Object LocalAddress,LocalPort,OwningProcess | "+
        "Sort-Object LocalAddress,LocalPort,OwningProcess)",
      "$canonical=($l|ConvertTo-Json -Depth 3 -Compress)",
      "$sha=[Security.Cryptography.SHA256]::Create()",
      "try {",
      " $hash=$sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical))",
      " [Console]::Out.Write([BitConverter]::ToString($hash).Replace('-','').ToLowerInvariant())",
      "} finally { $sha.Dispose() }"
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
      const q=run('dpkg-query',['-W',format,PKG],{checkExit:false});
      const pair=q.stdout.split('|');
      if(q.code===0&&pair.length===2&&pair[1]==='install ok installed'){
        version=dpkgVersion(pair[0]);
        const v=run('dpkg',['--verify',PKG],{timeoutMs:45000,checkExit:false});
        integrity=v.code===0&&!v.stdout&&!v.stderr;
      }else if(q.code===1&&!q.stdout
        &&/no packages found matching/i.test(q.stderr)){
        // Fresh means no installed identity AND no existing user config.
        // Any orphaned account/tunnel state must use migration, not install.
        check(cleanFreshLinuxOwnerState(),
          'UNIVERSAL_NATIVE_FRESH_OWNER_STATE_PRESENT');
        version=null;
      }else fail('UNIVERSAL_NATIVE_INSTALLED_PACKAGE_MISSING');
    }else{
      const script=[
        "$ErrorActionPreference='Stop'",
        "$root='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'",
        "$hits=@()",
        // A clean Windows profile may not have any per-user uninstall keys.
        // Treat absence as empty, but still fail closed if the read fails.
        "if(Test-Path -LiteralPath $root -ErrorAction Stop){"+
          " $hits=@(Get-ChildItem -LiteralPath $root | Where-Object {"+
          " $_.PSChildName -eq "+shellQuote(WIN_KEY)+" })}",
        "if($hits.Count -gt 1){throw 'COMMANDER_NSIS_REGISTRY_INVALID'}",
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
          "{[Console]::Out.Write('LEGACY_MIGRATION_REQUIRED');exit 0}",
        "$bin=Join-Path $env:LOCALAPPDATA 'Programs\\remote-commander-unified\\Remote Commander.exe'",
        "$ownerPairs=Join-Path $env:APPDATA 'ChatGPTRemoteCommander\\private-pair'",
        "if($hits.Count -eq 0){",
        " if((Test-Path -LiteralPath $bin) -or (Test-Path -LiteralPath $ownerPairs))"+
          "{throw 'COMMANDER_FRESH_OWNER_STATE_PRESENT'}",
        " [Console]::Out.Write('ABSENT');exit 0",
        "}",
        "$v=Get-ItemProperty -LiteralPath $hits[0].PSPath",
        "$file=Get-Item -LiteralPath $bin -ErrorAction Stop",
        "if($v.DisplayVersion -cne $file.VersionInfo.FileVersion -or "+
          "$v.DisplayName -cnotlike 'Remote Commander *')"+
          "{throw 'COMMANDER_NSIS_VERSION_DRIFT'}",
        "[Console]::Out.Write($v.DisplayVersion)"
      ].join('\n');
      version=ps(script,run);
      // A verified legacy-family registry hit is NOT a clean fresh
      // install and MUST NOT be auto-uninstalled or silently replaced.
      if(version==='LEGACY_MIGRATION_REQUIRED')
        fail('UNIVERSAL_NATIVE_LEGACY_MIGRATION_REQUIRED');
      if(version!=='ABSENT')
        check(VERSION.test(version),'UNIVERSAL_NATIVE_WINDOWS_INSTALLED_VERSION_INVALID');
      else version=null;
    }
    return {...metadata,version,registeredInstallCount:version===null?0:1,
      integrityVerified:integrity,runtime:{
        fingerprint:getRuntime({requireInactiveForFresh:version===null}),
        liveCoreCutover:false,
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
        // GitHub Windows runners can have an already-elevated owner token.
        // Per-user NSIS has NO elevation request and postcheck mandates HKCU.
        // Reject SYSTEM/anonymous service contexts, not valid admin owners.
        "if($identity.IsSystem -or $identity.IsAnonymous)"+
          "{throw 'WINDOWS_NSIS_OWNER_CONTEXT_REQUIRED'}",
        "$p=Start-Process -FilePath "+shellQuote(p)+
          " -ArgumentList '/S' -PassThru -Wait -ErrorAction Stop",
        "if($p.ExitCode -ne 0){throw 'WINDOWS_NSIS_EXIT_NONZERO'}",
        "[Console]::Out.Write('NATIVE_NSIS_EXIT_ZERO')"
      ].join('\n');
      check(ps(script,run,{timeoutMs:180000})==='NATIVE_NSIS_EXIT_ZERO',
        'UNIVERSAL_NATIVE_NSIS_EFFECT_FAILED');
    }
  }
  async function uninstall(_artifact,plan){
    check(plan?.installationKind==='fresh',
      'UNIVERSAL_NATIVE_FRESH_UNINSTALL_NOT_APPROVED');
    if(!win){
      run('pkexec',['/usr/bin/dpkg','--remove',PKG],{timeoutMs:180000});
    }else{
      const base=path.join(process.env.LOCALAPPDATA||'',
        'Programs','remote-commander-unified');
      const uninstaller=path.join(base,'Uninstall Remote Commander.exe');
      const st=fs.lstatSync(uninstaller);
      check(st.isFile()&&!st.isSymbolicLink()&&st.size>1024,
        'UNIVERSAL_NATIVE_UNINSTALLER_UNTRUSTED');
      const script=[
        "$ErrorActionPreference='Stop'",
        "$me=[Security.Principal.WindowsIdentity]::GetCurrent()",
        "if($me.IsSystem -or $me.IsAnonymous)"+
          "{throw 'WINDOWS_NSIS_OWNER_CONTEXT_REQUIRED'}",
        "$p=Start-Process -FilePath "+shellQuote(uninstaller)+
          " -ArgumentList '/S' -PassThru -Wait -ErrorAction Stop",
        "if($p.ExitCode -ne 0){throw 'WINDOWS_NSIS_UNINSTALL_NONZERO'}",
        "[Console]::Out.Write('NATIVE_NSIS_UNINSTALL_EXIT_ZERO')"
      ].join('\n');
      check(ps(script,run,{timeoutMs:180000})==='NATIVE_NSIS_UNINSTALL_EXIT_ZERO',
        'UNIVERSAL_NATIVE_NSIS_UNINSTALL_FAILED');
    }
  }
  return Object.freeze({
    platform,architecture,inspect,snapshot,
    install:effect,restore:effect,uninstall,verify:async()=>snapshot()
  });
}
