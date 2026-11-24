// Native Windows ACL verification for the V0.12 host-global operation lease.
// Reuses existing owner-private NTFS directory validation; never repairs or
// widens an existing ACL. An owner-private parent is not enough: persisted DB
// files and SQLite sidecars must also belong to this Windows user.
import path from 'node:path';
import {execFile} from 'node:child_process';
import {ensureWindowsMonitorDirectories}
  from './browser-companion-windows-private.mjs';

const POWERSHELL=String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
const SCRIPT=String.raw`
$ErrorActionPreference='Stop'
$base=$env:RC012_NATIVE_LEASE_DB_FILE
if([string]::IsNullOrWhiteSpace($base)){throw 'DB_PATH_REQUIRED'}
$owner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed=@($owner,'S-1-5-18','S-1-5-32-544')
function CheckDbFile([string]$p) {
  if(-not(Test-Path -LiteralPath $p -PathType Leaf)){return}
  $item=Get-Item -LiteralPath $p -Force -ErrorAction Stop
  if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){
    throw 'DB_NOT_REGULAR'
  }
  $acl=([IO.FileInfo]::new($p)).GetAccessControl([Security.AccessControl.AccessControlSections]'Owner,Access')
  if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $owner){
    throw 'DB_OWNER_MISMATCH'
  }
  $ownRule=$false
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    if($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow){
      if($allowed -cnotcontains $rule.IdentityReference.Value){throw 'DB_ACL_TOO_BROAD'}
      if($rule.IdentityReference.Value -ceq $owner){$ownRule=$true}
    }
  }
  if(-not $ownRule){throw 'DB_OWNER_ALLOW_REQUIRED'}
}
foreach($suffix in @('','-journal','-wal','-shm')){
  CheckDbFile ($base+$suffix)
}
[Console]::Out.Write('RC012_WINDOWS_NATIVE_LEASE_ACL_VALID')
`;

// Validates storage without returning Windows identity data to the caller.
// Existing owner-private directory helper checks every path component for
// reparse points and validates owner SID, protected DACL and NTFS volume.
export async function assertWindowsHostLeaseStorage(directory,dbFile) {
  if(process.platform!=='win32'
    ||typeof directory!=='string'
    ||!path.win32.isAbsolute(directory)
    ||! /^[a-z]:[\\/]/i.test(directory)
    ||typeof dbFile!=='string'
    ||path.win32.dirname(dbFile).toLowerCase()!==directory.toLowerCase())
    throw Error('V012_WINDOWS_NATIVE_LEASE_PRIVATE_DIRECTORY_REQUIRED');
  try{
    await ensureWindowsMonitorDirectories([directory],{create:false});
    const result=await new Promise((resolve,reject)=>{
      execFile(POWERSHELL,
        ['-NoLogo','-NoProfile','-NonInteractive','-Command',SCRIPT],{
          windowsHide:true,timeout:8000,maxBuffer:4096,
          env:{...process.env,RC012_NATIVE_LEASE_DB_FILE:dbFile}
        },(error,stdout,stderr)=>{
          if(error||stderr.trim())return reject(error??Error('ACL_STDERR'));
          resolve(stdout);
        });
    });
    if(result!=='RC012_WINDOWS_NATIVE_LEASE_ACL_VALID')
      throw Error('ACL_RESULT_INVALID');
  }catch{
    // Never leak OS identities, ACL contents, user folders or provider output.
    throw Error('V012_WINDOWS_NATIVE_LEASE_STORAGE_UNTRUSTED');
  }
}