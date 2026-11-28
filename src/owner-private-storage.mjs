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
      "$identity=[Security.Principal.WindowsIdentity]::GetCurrent()",
      "$user=$identity.User",
      "$creatorOwner=$identity.Owner",
      "if(([IO.File]::GetAttributes($target) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'REPARSE'}",
      "if($directory){if(![IO.Directory]::Exists($target)){throw 'TYPE'};$acl=[IO.Directory]::GetAccessControl($target)}else{if(![IO.File]::Exists($target)){throw 'TYPE'};$acl=[IO.File]::GetAccessControl($target)}",
      "if($initialize){",
      " if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $creatorOwner.Value){throw 'INITIAL_OWNER_MISMATCH'}",
      " $acl.SetAccessRuleProtection($true,$false)",
      " foreach($rule in @($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))){$acl.RemoveAccessRuleAll($rule)|Out-Null}",
      " $acl.SetOwner($user)",
      " $flags=[Security.AccessControl.InheritanceFlags]::None",
      " if($directory){$flags=[Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit}",
      " $rule=[Security.AccessControl.FileSystemAccessRule]::new($user,[Security.AccessControl.FileSystemRights]::FullControl,$flags,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)",
      " $acl.AddAccessRule($rule)",
      " if($directory){[IO.Directory]::SetAccessControl($target,$acl);$acl=[IO.Directory]::GetAccessControl($target)}else{[IO.File]::SetAccessControl($target,$acl);$acl=[IO.File]::GetAccessControl($target)}",
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


// Native Windows exclusive creation with a protected owner DACL set at the
// CREATE_NEW syscall, rather than chmod/ACL repair after an unprotected file
// could have been visible. Deliberately no chmod, deletion, or fallback.
export function windowsCreateOwnerPrivateFile(file){
  const denied=()=>fail('OWNER_PRIVATE_FILE_CREATION_DENIED');
  if(process.platform!=='win32'||typeof file!=='string'||
     !path.win32.isAbsolute(file)||! /^[A-Za-z]:\\/.test(file)||
     file.includes('\0')||file.length>2048)denied();
  const root=process.env.SystemRoot||'C:\\Windows';
  const ps=path.win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe');
  try{
    const exe=fs.lstatSync(ps);
    if(!exe.isFile()||exe.isSymbolicLink()||fs.existsSync(file))denied();
    const encodedPath=Buffer.from(file,'utf8').toString('base64');
    const script=[
      "$ErrorActionPreference='Stop'",
      "$target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+encodedPath+"'))",
      "$parent=[IO.Path]::GetDirectoryName($target)",
      "if(![IO.Directory]::Exists($parent) -or [IO.File]::Exists($target)){throw 'NOT_EXCLUSIVE'}",
      "if(([IO.File]::GetAttributes($parent) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'PARENT_ALIAS'}",
      "$current=[Security.Principal.WindowsIdentity]::GetCurrent().User",
      "$pa=[IO.Directory]::GetAccessControl($parent)",
      "if(!$pa.AreAccessRulesProtected -or $pa.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $current.Value){throw 'PARENT_NOT_PRIVATE'}",
      "$allowed=@($current.Value,'S-1-5-18','S-1-5-32-544')",
      "foreach($r in $pa.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($r.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $allowed -notcontains $r.IdentityReference.Value){throw 'PARENT_BROAD_ALLOW'}}",
      "$sec=[Security.AccessControl.FileSecurity]::new()",
      "$sec.SetOwner($current)",
      "$sec.SetAccessRuleProtection($true,$false)",
      "$rule=[Security.AccessControl.FileSystemAccessRule]::new($current,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]::None,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)",
      "[void]$sec.AddAccessRule($rule)",
      "$rights=[Security.AccessControl.FileSystemRights]([int][Security.AccessControl.FileSystemRights]::ReadData -bor [int][Security.AccessControl.FileSystemRights]::WriteData)",
      "$types=[Type[]]@([string],[IO.FileMode],[Security.AccessControl.FileSystemRights],[IO.FileShare],[int],[IO.FileOptions],[Security.AccessControl.FileSecurity])",
      "$ctor=[IO.FileStream].GetConstructor($types)",
      "if($null -eq $ctor){throw 'NATIVE_CTOR_MISSING'}",
      "$params=[object[]]@([string]$target,[IO.FileMode]::CreateNew,$rights,[IO.FileShare]::None,[int]4096,[IO.FileOptions]::None,$sec)",
      "$stream=$ctor.Invoke($params)",
      "try{$stream.Flush()}finally{$stream.Dispose()}",
      "$got=[IO.File]::GetAccessControl($target)",
      "if(!$got.AreAccessRulesProtected -or $got.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $current.Value){throw 'FILE_NOT_PRIVATE'}",
      "$rules=@($got.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))",
      "if($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -cne $current.Value -or $rules[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow){throw 'FILE_ACL_NOT_EXACT'}",
      "[Console]::Out.Write('RC013_NEW_PRIVATE_OK')"
    ].join('\n');
    const env={
      SystemRoot:root,WINDIR:root,
      PATH:[path.win32.join(root,'System32'),root,
        path.win32.join(root,'System32','WindowsPowerShell','v1.0')].join(';')
    };
    const output=execFileSync(ps,['-NoLogo','-NoProfile','-NonInteractive',
      '-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
      {windowsHide:true,encoding:'utf8',timeout:7000,maxBuffer:4096,env,
        stdio:['ignore','pipe','pipe']});
    if(output.trim()!=='RC013_NEW_PRIVATE_OK')denied();
    return true;
  }catch{denied();}
}
