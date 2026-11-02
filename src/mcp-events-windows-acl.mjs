// Windows-specific confidentiality gate for MCP Events persisted webhook secrets.
// This does not grant permissions. It refuses paths whose effective ACL allows
// any principal beyond the current user, SYSTEM and Builtin Administrators.
import {execFileSync} from 'node:child_process';
import {lstatSync} from 'node:fs';
import path from 'node:path';

const SID=/^S-\d+(?:-\d+)+$/;
const CORE=new Set(['S-1-5-18','S-1-5-32-544']);
const ACL_COMMAND=String.raw`
$ErrorActionPreference='Stop'
$target=$args[0]
$acl=Get-Acl -LiteralPath $target
$type=[Security.Principal.SecurityIdentifier]
$current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$owner=$acl.GetOwner($type).Value
$allowed=@($acl.Access | Where-Object { $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow } | ForEach-Object { $_.IdentityReference.Translate($type).Value })
[pscustomobject]@{currentSid=$current;ownerSid=$owner;allowSids=@($allowed)} | ConvertTo-Json -Depth 3 -Compress
`;

const reject=()=>{throw new Error('MCP_EVENTS_WINDOWS_PRIVATE_ACL_REQUIRED');};

export function validateWindowsPrivateAcl(report){
 if(!report||typeof report!=='object'||Array.isArray(report)||
    typeof report.currentSid!=='string'||!SID.test(report.currentSid)||
    typeof report.ownerSid!=='string'||!SID.test(report.ownerSid)||
    report.currentSid!==report.ownerSid||!Array.isArray(report.allowSids)||
    report.allowSids.length===0)reject();
 const allowed=new Set([...CORE,report.currentSid]);
 for(const sid of report.allowSids){
  if(typeof sid!=='string'||!SID.test(sid)||!allowed.has(sid))reject();
 }
 if(!report.allowSids.includes(report.currentSid))reject();
 return true;
}

export function assertWindowsPrivateEventPath(target,{platform=process.platform,run=execFileSync}={}){
 if(platform!=='win32')return true;
 if(typeof target!=='string'||!path.isAbsolute(target)||typeof run!=='function')reject();
 try{
  const file=lstatSync(target);
  if(file.isSymbolicLink()||!(file.isDirectory()||file.isFile()))reject();
  const response=run('pwsh',['-NoProfile','-NonInteractive','-CommandWithArgs',ACL_COMMAND,target],{
   encoding:'utf8',timeout:7000,maxBuffer:16*1024,windowsHide:true
  });
  validateWindowsPrivateAcl(JSON.parse(response));
  return true;
 }catch{reject();}
}
