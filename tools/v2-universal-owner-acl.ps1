param([Parameter(Mandatory=$true)][ValidateSet('CheckSources','MakePrivate','CheckPrivate')][string]$Action)
# One owner-local ACL adapter for all Windows Commander V2 managed imports.
# Path parameters arrive through STDIN, never a shell interpolation or log.
$ErrorActionPreference='Stop'
if($env:OS -ne 'Windows_NT'){throw 'V2_OWNER_ACL_WINDOWS_ONLY'}
$owner=[Security.Principal.WindowsIdentity]::GetCurrent().User
$admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$raw=[Console]::In.ReadToEnd()
if([string]::IsNullOrWhiteSpace($raw) -or $raw.Length -gt 500000){throw 'V2_OWNER_ACL_INPUT_INVALID'}
$paths=@(ConvertFrom-Json -InputObject $raw)
if($paths.Count -lt 1 -or $paths.Count -gt 10000){throw 'V2_OWNER_ACL_BUDGET'}
function CheckPath([string]$p){
  if(-not [IO.Path]::IsPathFullyQualified($p)){throw 'V2_OWNER_ACL_ABSOLUTE_REQUIRED'}
  $item=Get-Item -LiteralPath $p -Force -ErrorAction Stop
  if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'V2_OWNER_ACL_ALIAS'}
}
$groupCount=0
foreach($entry in $paths){
  $p=[string]$entry
  CheckPath $p
  $a=Get-Acl -LiteralPath $p -ErrorAction Stop
  if($Action -eq 'CheckSources'){
    $identity=$a.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if($identity -eq $owner.Value){continue}
    if($identity -eq 'S-1-5-32-544' -and $admin){$groupCount++;continue}
    throw 'V2_OWNER_ACL_SOURCE_OWNER_REJECTED'
  }
  if($Action -eq 'MakePrivate'){
    $a.SetAccessRuleProtection($true,$false)
    foreach($old in @($a.Access)){[void]$a.RemoveAccessRuleSpecific($old)}
    $a.SetOwner($owner)
    $flags=if((Get-Item -LiteralPath $p -Force).PSIsContainer){
      [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    }else{[Security.AccessControl.InheritanceFlags]::None}
    $rule=[Security.AccessControl.FileSystemAccessRule]::new(
      $owner,[Security.AccessControl.FileSystemRights]::FullControl,
      $flags,[Security.AccessControl.PropagationFlags]::None,
      [Security.AccessControl.AccessControlType]::Allow)
    [void]$a.AddAccessRule($rule)
    Set-Acl -LiteralPath $p -AclObject $a -ErrorAction Stop
    $a=Get-Acl -LiteralPath $p -ErrorAction Stop
  }
  if(-not $a.AreAccessRulesProtected -or @($a.Access).Count -ne 1 -or
     $a.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $owner.Value -or
     $a.Access[0].IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $owner.Value){
    throw 'V2_OWNER_ACL_PRIVATE_PROOF_REJECTED'
  }
}
Write-Output ('V2_OWNER_ACL_PASS count='+$paths.Count+' groupOwned='+$groupCount+' action='+$Action)
