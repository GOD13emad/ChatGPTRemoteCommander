// Windows-native directory ACL creation for read-only Companion observations.
// No existing directory ACL is modified; no elevation or arbitrary shell input.
import path from 'node:path';
import { execFile } from 'node:child_process';
const POWERSHELL=String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
const SCRIPT=String.raw`
$ErrorActionPreference='Stop'
$user=[Security.Principal.WindowsIdentity]::GetCurrent().User
$allowed=@($user.Value,'S-1-5-18','S-1-5-32-544')
$full=[Security.AccessControl.FileSystemRights]::FullControl
$inherit=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
function Check-Directory($p) {
  $item=Get-Item -LiteralPath $p -Force -ErrorAction Stop
  if(-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'ROOT_UNSAFE'}
}
function Check-Private($p) {
  Check-Directory $p
  $acl=([IO.DirectoryInfo]::new($p)).GetAccessControl([Security.AccessControl.AccessControlSections]'Owner,Access')
  if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $user.Value){throw 'ROOT_OWNER_MISMATCH'}
  $own=$false
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
    if($rule.AccessControlType -ne 'Allow' -or $allowed -notcontains $rule.IdentityReference.Value){throw 'ROOT_NOT_PRIVATE'}
    if($rule.IdentityReference.Value -eq $user.Value -and
      ($rule.FileSystemRights -band $full) -eq $full -and
      ($rule.InheritanceFlags -band $inherit) -eq $inherit -and
      $rule.PropagationFlags -eq 'None'){$own=$true}
  }
  if(-not $own){throw 'ROOT_NOT_PRIVATE'}
}
function New-Private($p) {
  $acl=New-Object Security.AccessControl.DirectorySecurity
  $acl.SetOwner($user)
  $acl.SetAccessRuleProtection($true,$false)
  foreach($sid in $allowed){
    $rule=[Security.AccessControl.FileSystemAccessRule]::new(
      ([Security.Principal.SecurityIdentifier]::new($sid)),$full,$inherit,
      [Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($rule)
  }
  # .NET Framework creates the directory with the requested security descriptor.
  # If a directory already exists, Create does not replace its descriptor.
  ([IO.DirectoryInfo]::new($p)).Create($acl)
  Check-Private $p
}
$roots=ConvertFrom-Json -InputObject $env:RC_MONITOR_DIRS_JSON
$roots=@($roots)
if($roots.Count -lt 1 -or $roots.Count -gt 3){throw 'ROOT_COUNT_INVALID'}
foreach($raw in $roots){
  if($raw -notmatch '^[A-Za-z]:[\\/]'){throw 'ROOT_INVALID'}
  $p=[IO.Path]::GetFullPath($raw)
  $drive=[IO.Path]::GetPathRoot($p)
  if(([IO.DriveInfo]::new($drive)).DriveFormat -ne 'NTFS'){throw 'ROOT_NOT_NTFS'}
  $parts=$p.Substring($drive.Length).Split([char]92,[StringSplitOptions]::RemoveEmptyEntries)
  $current=$drive
  foreach($part in $parts){
    $current=Join-Path $current $part
    if(Test-Path -LiteralPath $current){Check-Directory $current}
    else{if($env:RC_MONITOR_DIRS_CREATE -ne '1'){throw 'ROOT_MISSING'};New-Private $current}
  }
  Check-Private $p
}
[Console]::Out.Write('RC_MONITOR_PRIVATE_DIRECTORIES_OK')
`;
export function ensureWindowsMonitorDirectories(roots,{create=true}={}) {
  if(process.platform!=='win32'||!Array.isArray(roots)||roots.length<1||roots.length>3||
    roots.some(p=>typeof p!=='string'||!path.win32.isAbsolute(p)||! /^[a-z]:[\\/]/i.test(p)))
    return Promise.reject(Error('BROWSER_COMPANION_WINDOWS_ROOT_INVALID'));
  return new Promise((resolve,reject)=>{
    execFile(POWERSHELL,['-NoLogo','-NoProfile','-NonInteractive','-Command',SCRIPT],{
      // PowerShell cold starts can exceed 8 seconds on a loaded hosted Windows
      // runner; keep the native ACL proof bounded without failing valid roots.
      windowsHide:true,timeout:20000,maxBuffer:4096,
      env:{...process.env,RC_MONITOR_DIRS_JSON:JSON.stringify(roots),RC_MONITOR_DIRS_CREATE:create?'1':'0'}
    },(error,stdout,stderr)=>{
      if(error||stderr.trim()||stdout!=='RC_MONITOR_PRIVATE_DIRECTORIES_OK')
        return reject(Error('BROWSER_COMPANION_WINDOWS_PRIVATE_ROOT_UNPROVEN'));
      resolve();
    });
  });
}
