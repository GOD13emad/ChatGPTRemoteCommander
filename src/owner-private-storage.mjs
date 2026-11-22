// Shared owner-private SQLite storage verification.
// Adapted from the independently qualified RC013 native Windows ACL guard.
// No credentials, browser profiles, grants or service authority live here.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const fail=code=>{throw Object.assign(new Error(code),{privateStorageCode:code});};
export function isPosixOwnerPrivate(file,{directory=false}={}){
  if(process.platform==='win32'||typeof process.getuid!=='function')return false;
  try{
    const st=fs.lstatSync(file);
    return (directory?st.isDirectory():st.isFile())
      &&!st.isSymbolicLink()&&(directory||st.nlink===1)
      &&st.uid===process.getuid()&&(st.mode&0o077)===0;
  }catch{return false;}
}
export function windowsPrivateAcl(file,{directory=false,initializeNew=false}={}){
  const failCode=directory?'OWNER_PRIVATE_DIRECTORY_UNSAFE':'OWNER_PRIVATE_FILE_UNSAFE';
  if(process.platform!=='win32'||typeof file!=='string'||!path.win32.isAbsolute(file)
    ||file.includes('\0')||! /^[A-Za-z]:\\/.test(file)||file.length>2048)
    fail(failCode);
  const root=process.env.SystemRoot||'C:\\Windows';
  const ps=path.win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');
  try{
    const exe=fs.lstatSync(ps);
    if(!exe.isFile()||exe.isSymbolicLink())fail(failCode);
    const base64=Buffer.from(file,'utf8').toString('base64');
    const script=[
      "$ErrorActionPreference='Stop'",
      "$target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+base64+"'))",
      "$directory="+(directory?'$true':'$false'),
      "$initialize="+(initializeNew?'$true':'$false'),
      "$user=[Security.Principal.WindowsIdentity]::GetCurrent().User",
      "if(([IO.File]::GetAttributes($target) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'REPARSE'}",
      "if($directory){if(![IO.Directory]::Exists($target)){throw 'TYPE'};$acl=[IO.Directory]::GetAccessControl($target)}else{if(![IO.File]::Exists($target)){throw 'TYPE'};$acl=[IO.File]::GetAccessControl($target)}",
      "if($initialize){",
      " if(!$directory){throw 'INIT_TYPE'}",
      " if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $user.Value){throw 'INITIAL_OWNER_MISMATCH'}",
      " $acl.SetAccessRuleProtection($true,$false)",
      " foreach($rule in @($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))){$acl.RemoveAccessRuleAll($rule)|Out-Null}",
      " $acl.SetOwner($user)",
      " $flags=[Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit",
      " $rule=[Security.AccessControl.FileSystemAccessRule]::new($user,[Security.AccessControl.FileSystemRights]::FullControl,$flags,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)",
      " $acl.AddAccessRule($rule)",
      " [IO.Directory]::SetAccessControl($target,$acl)",
      " $acl=[IO.Directory]::GetAccessControl($target)",
      "}",
      "if($directory -and !$acl.AreAccessRulesProtected){throw 'INHERITED_DIRECTORY_ACL'}",
      "if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $user.Value){throw 'OWNER_MISMATCH'}",
      "$allowed=@($user.Value,'S-1-5-18','S-1-5-32-544')",
      "foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){",
      " if($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $allowed -notcontains $rule.IdentityReference.Value){throw 'BROAD_ALLOW'}",
      "}",
      "[Console]::Out.Write('RC013_ACL_OK')"
    ].join('\n');
    const env={
      SystemRoot:root,WINDIR:root,
      PATH:[path.win32.join(root,'System32'),root,
        path.win32.join(root,'System32','WindowsPowerShell','v1.0')].join(';')
    };
    const result=execFileSync(ps,['-NoLogo','-NoProfile','-NonInteractive',
      '-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
    {windowsHide:true,encoding:'utf8',timeout:7000,maxBuffer:4096,env,stdio:['ignore','pipe','pipe']});
    if(result.trim()!=='RC013_ACL_OK')fail(failCode);
  }catch{fail(failCode);}
}
