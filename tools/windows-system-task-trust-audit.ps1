# Read-only trust-chain audit for Commander SYSTEM Scheduled Task actions.
[CmdletBinding()]
param([string]$TaskNamePattern='ChatGPTRemoteCommander-*',[string]$InspectPath)
$ErrorActionPreference='Stop'
$mask=[long][Security.AccessControl.FileSystemRights]::WriteData -bor [long][Security.AccessControl.FileSystemRights]::WriteAttributes -bor [long][Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor [long][Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [long][Security.AccessControl.FileSystemRights]::Delete -bor [long][Security.AccessControl.FileSystemRights]::ChangePermissions -bor [long][Security.AccessControl.FileSystemRights]::TakeOwnership
function Trusted($identity) {
 if(([string]$identity -ieq 'NT SERVICE\TrustedInstaller') -or
    ([string]$identity -match '^S-1-5-80-956008885-')){return $true}
 try {
  $account=if($identity -is [string]){[Security.Principal.NTAccount]::new($identity)}else{$identity}
  $sid=$account.Translate([Security.Principal.SecurityIdentifier]).Value
  return $sid -in @('S-1-5-18','S-1-5-32-544') -or
   [string]$identity -ieq 'NT SERVICE\TrustedInstaller'
 } catch {
  return ([string]$identity -ieq 'NT SERVICE\TrustedInstaller')
 }
}
function Inspect([string]$name){
 $codes=[Collections.Generic.List[string]]::new()
 if(-not [IO.Path]::IsPathFullyQualified($name)){
  return [pscustomobject]@{path=$name;safe=$false;codes=@('NOT_ABSOLUTE')}
 }
 $p=[IO.Path]::GetFullPath($name)
 for($n=0;$n -lt 64 -and $p;$n++){
  try {
   $item=Get-Item -LiteralPath $p -Force -ErrorAction Stop
   if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){$codes.Add('REPARSE_POINT')}
   $acl=Get-Acl -LiteralPath $p -ErrorAction Stop
   if(-not (Trusted $acl.Owner)){$codes.Add('UNTRUSTED_OWNER')}
   foreach($ace in $acl.Access){
    if($ace.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow){continue}
    # InheritOnly ACE does not apply at this path; children are inspected separately.
    if(($ace.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0){continue}
    if(Trusted $ace.IdentityReference){continue}
    if(([long]$ace.FileSystemRights -band $mask) -ne 0){$codes.Add('UNTRUSTED_WRITE_ACE')}
   }
  }catch{$codes.Add('MISSING_OR_UNREADABLE')}
  $parent=[IO.Path]::GetDirectoryName($p)
  if(-not $parent -or $parent -eq $p){break}
  $p=$parent
 }
 $unique=@($codes.ToArray()|Select-Object -Unique)
 return [pscustomobject]@{path=$name;safe=($unique.Count -eq 0);codes=$unique}
}
function Get-Script([string]$ArgumentText){
 if(!$ArgumentText){return $null}
 $m=[regex]::Match($ArgumentText,'(?i)(?:^|\s)-(?:File|f)(?:\s+|:)(?:"(?<dq>[^"]+)"|''(?<sq>[^'']+)''|(?<bare>\S+))')
 if(!$m.Success){return $null}
 foreach($n in @('dq','sq','bare')){if($m.Groups[$n].Success){return $m.Groups[$n].Value}}
 return $null
}

function Get-TaskProof($task){
 try{
  $xml=[string](Export-ScheduledTask -InputObject $task -ErrorAction Stop)
  if([string]::IsNullOrWhiteSpace($xml)){throw 'EMPTY'}
  $hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($xml))).ToLowerInvariant()
  return [pscustomobject]@{task=$task.TaskName;definitionAvailable=$true;definitionSha256=$hash;dependencyClosureVerified=$false}
 }catch{return [pscustomobject]@{task=$task.TaskName;definitionAvailable=$false;definitionSha256='';dependencyClosureVerified=$false}}
}
function Get-SourceProof([string]$path){
 try{
  $sha=(Get-FileHash -LiteralPath $path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors)
  return [pscustomobject]@{sha256=$sha;syntaxValid=(@($errors).Count -eq 0);dependencyClosureVerified=$false}
 }catch{return [pscustomobject]@{sha256='';syntaxValid=$false;dependencyClosureVerified=$false}}
}
$proofs=[Collections.Generic.List[object]]::new()
$items=[Collections.Generic.List[object]]::new()
if($InspectPath){
 $items.Add([pscustomobject]@{task='DIRECT_PATH_INSPECTION';kind='file';evaluation=(Inspect $InspectPath)})
}else{
 $tasks=@(Get-ScheduledTask -ErrorAction Stop | Where-Object{$_.TaskName -like $TaskNamePattern -and [string]$_.Principal.UserId -match '(?i)(SYSTEM|S-1-5-18)$'})
 foreach($t in $tasks){
  $proofs.Add((Get-TaskProof $t))
  foreach($action in @($t.Actions)){
  $items.Add([pscustomobject]@{task=$t.TaskName;kind='executable';evaluation=(Inspect ([string]$action.Execute))})
  $script=Get-Script ([string]$action.Arguments)
  if($script){
   $items.Add([pscustomobject]@{task=$t.TaskName;kind='script';evaluation=(Inspect $script);source=(Get-SourceProof $script)})
  }elseif([string]$action.Arguments -match '(?i)\.ps1(?:\s|"|$)'){
   $items.Add([pscustomobject]@{task=$t.TaskName;kind='script';evaluation=[pscustomobject]@{path='';safe=$false;codes=@('UNPARSEABLE_SCRIPT_ARGUMENT')}})
  }
 }}
}
$bad=@($items.ToArray()|Where-Object{$_.evaluation.safe -ne $true})
[pscustomobject]@{
 ok=$true;readOnly=$true;checks=$items.Count;unsafe=$bad.Count
 accepted=($bad.Count -eq 0)
 migrationReady=$false
 migrationBlockers=@('DEPENDENCY_CLOSURE_UNVERIFIED','OWNER_SESSION_E2E_REQUIRED','INDEPENDENT_SECURITY_REVIEW_REQUIRED')
 definitions=@($proofs.ToArray());results=@($items.ToArray())
}|ConvertTo-Json -Depth 6 -Compress
