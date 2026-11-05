// QA-only current-owner privacy ACL. This is NOT an authenticated caller boundary.
import fs from 'node:fs';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
function ps(script,extra={}){
 if(process.platform!=='win32')throw Error('WINDOWS_PRIVATE_EVIDENCE_QA_ONLY');
 const exe=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
 // Node is an intermediate process: inherited PS7 module paths are not
 // sanitized automatically for Windows PowerShell5.1. Scope this pin to this
 // own child only; never modify the controller or machine environment.
 const childEnv={...process.env,...extra};
 for(const key of Object.keys(childEnv))if(key.toLowerCase()==='psmodulepath')delete childEnv[key];
 childEnv.PSModulePath=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','Modules');
 const wrapped=`$qaPhase='PRIVATE_STORAGE_BEGIN'\ntry {\n${script}\n} catch {\n[ordered]@{phase=$qaPhase;errorId=$_.FullyQualifiedErrorId;category=$_.CategoryInfo.Category.ToString();exceptionType=$_.Exception.GetType().FullName;hresult=$_.Exception.HResult;message=$_.Exception.Message} | ConvertTo-Json -Compress\nexit 91\n}`;
 const r=spawnSync(exe,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(wrapped,'utf16le').toString('base64')],
  {env:childEnv,encoding:'utf8',timeout:15000,windowsHide:true});
 if(r.error||r.status!==0)throw Object.assign(Error('PRIVATE_EVIDENCE_QA_POLICY_CHECK_FAILED'),{
  qaPhase:'OWN_FRESH_DIRECTORY_ACL',exitCode:r.status,signal:r.signal,spawnErrorCode:r.error?.code??null,
  stderrSha256:createHash('sha256').update(r.stderr??'').digest('hex'),stderrBytes:Buffer.byteLength(r.stderr??''),
  privateQaDiagnostic:(()=>{try{return JSON.parse(r.stdout.trim());}catch{return {parseable:false};}})()});
 return JSON.parse(r.stdout.trim());
}
export function createWindowsPrivateEvidenceDirectory(parent){
 const directory=path.join(fs.realpathSync.native(parent),'witness-private-'+randomUUID());fs.mkdirSync(directory);
 ps(`$ErrorActionPreference='Stop'
$p=$env:RC_WITNESS_PRIVATE_DIR
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$qaPhase='PRIVATE_STORAGE_BUILD_TYPED_ACL'
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
$inherit=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
foreach($principal in @($sid.Value,'S-1-5-18')) {
 $identity=[Security.Principal.SecurityIdentifier]::new($principal)
 $rule=[Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl',$inherit,'None','Allow')
 $acl.AddAccessRule($rule)
}
$qaPhase='PRIVATE_STORAGE_APPLY_ACL'
Set-Acl -LiteralPath $p -AclObject $acl -ErrorAction Stop
'{"createdPrivateDirectory":true}'`,{RC_WITNESS_PRIVATE_DIR:directory});
 if(!verifyWindowsPrivateEvidenceDirectory(directory))throw Error('PRIVATE_EVIDENCE_QA_DACL_UNVERIFIED');
 return directory;
}
export function verifyWindowsPrivateEvidenceDirectory(directory){
 return ps(`$ErrorActionPreference='Stop'
$p=[IO.Path]::GetFullPath($env:RC_WITNESS_PRIVATE_DIR)
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$rootAcl=Get-Acl -LiteralPath $p -ErrorAction Stop
$private=$rootAcl.AreAccessRulesProtected -and $rootAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $sid
$item=Get-Item -LiteralPath $p -Force
while($item) {if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){$private=$false};$item=$item.Parent}
$items=@((Get-Item -LiteralPath $p -Force)) + @(Get-ChildItem -LiteralPath $p -Force)
foreach($item in $items) {
 if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){$private=$false}
 $acl=Get-Acl -LiteralPath $item.FullName -ErrorAction Stop
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid){$private=$false}
 foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
  if($rule.IdentityReference.Value -notin @($sid,'S-1-5-18') -or $rule.AccessControlType -ne 'Allow'){$private=$false}
 }
}
@{private=$private;ownerSid=$sid;scope='same-owner-local-evidence-not-public-auth'} | ConvertTo-Json -Compress`,{RC_WITNESS_PRIVATE_DIR:directory}).private===true;
}
export function currentWindowsHostGeneration(){return ps(`$ErrorActionPreference='Stop'
$p=Get-Process -Id ([int]$env:RC_WITNESS_HOST_PID) -ErrorAction Stop
@{pid=$p.Id;creationFileTime=$p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()} | ConvertTo-Json -Compress`,{RC_WITNESS_HOST_PID:String(process.pid)});}
