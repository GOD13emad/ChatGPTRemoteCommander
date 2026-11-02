// Isolated secret-store fixtures. Windows's %TEMP% may inherit Everyone
// access; test subscription secrets only inside a newly restricted directory.
import {mkdtemp} from 'node:fs/promises';
import {rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {assertWindowsPrivateEventPath} from '../src/mcp-events-windows-acl.mjs';

const PRIVATE=String.raw`
$ErrorActionPreference='Stop'
$target=$args[0]
$acl=Get-Acl -LiteralPath $target
$acl.SetAccessRuleProtection($true,$false)
$user=[Security.Principal.WindowsIdentity]::GetCurrent().User
$rule=New-Object Security.AccessControl.FileSystemAccessRule($user,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
$acl.SetAccessRule($rule)
Set-Acl -LiteralPath $target -AclObject $acl
`;

export async function privateEventTestDirectory(prefix){
 const dir=await mkdtemp(path.join(os.tmpdir(),prefix));
 if(process.platform!=='win32')return dir;
 try{
  execFileSync('pwsh',['-NoProfile','-NonInteractive','-CommandWithArgs',PRIVATE,dir],{
   encoding:'utf8',timeout:8000,maxBuffer:8192,windowsHide:true
  });
  assertWindowsPrivateEventPath(dir);
  return dir;
 }catch(error){
  rmSync(dir,{recursive:true,force:true});
  throw Object.assign(new Error('MCP_EVENT_TEST_PRIVATE_DIRECTORY_REQUIRED'),{cause:error});
 }
}
