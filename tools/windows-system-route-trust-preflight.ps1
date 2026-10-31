# Read-only Windows elevated route admission preflight.
# This checks necessary trust conditions; it NEVER authorizes migration by itself.
[CmdletBinding()]
param(
  [string]$MachineRoot = 'C:\ProgramData\ChatGPTRemoteCommander\machine-runtime',
  [string]$CandidateRoot = 'C:\Program Files\ChatGPTRemoteCommander\TrustedCode\CandidateSource'
)
$ErrorActionPreference='Stop'
# On an existing target, creating files or changing its contents is unsafe.
# On an existing ancestor, CreateDirectories alone cannot replace a protected
# child; require delete-child, delete, ownership or ACL-control authority.
$targetWriteMask= [long][Security.AccessControl.FileSystemRights]::WriteData -bor
 [long][Security.AccessControl.FileSystemRights]::AppendData -bor
 [long][Security.AccessControl.FileSystemRights]::WriteAttributes -bor
 [long][Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
 [long][Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
 [long][Security.AccessControl.FileSystemRights]::Delete -bor
 [long][Security.AccessControl.FileSystemRights]::ChangePermissions -bor
 [long][Security.AccessControl.FileSystemRights]::TakeOwnership
$ancestorControlMask= [long][Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
 [long][Security.AccessControl.FileSystemRights]::Delete -bor
 [long][Security.AccessControl.FileSystemRights]::ChangePermissions -bor
 [long][Security.AccessControl.FileSystemRights]::TakeOwnership
function Test-TrustedIdentity($identity) {
  try {
    $id=if($identity -is [Security.Principal.SecurityIdentifier]){$identity}else{([Security.Principal.NTAccount]::new([string]$identity)).Translate([Security.Principal.SecurityIdentifier])}
    # Exact privileged SIDs only. Service SIDs require an independently approved
    # explicit allowlist, never a partial SID-prefix match.
    return $id.Value -in @('S-1-5-18','S-1-5-32-544',
      'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  }catch{return $false}
}
function Inspect-Trust([string]$path) {
  $codes=[Collections.Generic.List[string]]::new()
  if(-not [IO.Path]::IsPathFullyQualified($path)){
    return [pscustomobject]@{path=$path;safe=$false;codes=@('NOT_ABSOLUTE')}
  }
  $cursor=[IO.Path]::GetFullPath($path)
  for($i=0;$i -lt 64;$i++){
    try {
      $item=Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
      if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){$codes.Add('REPARSE_POINT')}
      $acl=Get-Acl -LiteralPath $cursor -ErrorAction Stop
      if(-not(Test-TrustedIdentity $acl.Owner)){$codes.Add('UNTRUSTED_OWNER')}
      foreach($ace in $acl.Access){
        if($ace.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow){continue}
        if(($ace.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0){continue}
        if(Test-TrustedIdentity $ace.IdentityReference){continue}
        $mask=if($i -eq 0){$targetWriteMask}else{$ancestorControlMask}
        if(([long]$ace.FileSystemRights -band $mask) -ne 0){$codes.Add('UNTRUSTED_WRITE_ACE')}
      }
    }catch{$codes.Add('MISSING_OR_UNREADABLE')}
    $parent=[IO.Path]::GetDirectoryName($cursor)
    if(-not $parent -or $parent -eq $cursor){break}
    $cursor=$parent
  }
  $unique=@($codes.ToArray()|Select-Object -Unique)
  return [pscustomobject]@{path=$path;safe=($unique.Count -eq 0);codes=$unique}
}
$root=[IO.Path]::GetFullPath($CandidateRoot)
$machine=[IO.Path]::GetFullPath($MachineRoot)
$required=[ordered]@{
  candidateRoot=$root
  supervisor=(Join-Path $root 'autostart-windows.ps1')
  supervisorRuntime=(Join-Path $root 'windows-supervisor-runtime.ps1')
  supervisorRouting=(Join-Path $root 'supervisor-routing.ps1')
  core=(Join-Path $root 'src\server-v0.3.mjs')
  package=(Join-Path $root 'package.json')
  admissionHelper=(Join-Path $root 'tools\windows-system-trust-admission.ps1')
  preflightTool=(Join-Path $root 'tools\windows-system-route-trust-preflight.ps1')
  machineRoot=$machine
  machineConfig=(Join-Path $machine 'primary\config.json')
  machineRoute=(Join-Path $machine 'routing\default.json')
}
$results=@(foreach($e in $required.GetEnumerator()){
  [pscustomobject]@{name=[string]$e.Key;trust=(Inspect-Trust ([string]$e.Value))}
})
$codes=[Collections.Generic.List[string]]::new()
foreach($x in $results){
  if(-not $x.trust.safe){$codes.Add("TRUST_FAILURE:$($x.name)")}
}
$routeFile=[string]$required.machineRoute
$routeValid=$false
$routeMatches=$false
$routeIsUserProfile=$false
$routeHasExpectedFields=$false
$routeVersion=''
$routeCommit=''
if(Test-Path -LiteralPath $routeFile -PathType Leaf){
  try{
    $json=Get-Content -LiteralPath $routeFile -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    $routeRoot=[string]$json.active.projectDir
    $routeHasExpectedFields=([int]$json.schema -ge 1 -and [string]$json.profile -eq 'default' -and
      [int]$json.generation -ge 1 -and $routeRoot -and [string]$json.active.configPath -and
      [string]$json.active.configSha256 -match '^[a-fA-F0-9]{64}$')
    $routeVersion=[string]$json.active.version
    $routeCommit=[string]$json.active.commit
    if([IO.Path]::IsPathFullyQualified($routeRoot)){
      $routeMatches=([IO.Path]::GetFullPath($routeRoot).TrimEnd('\') -ieq $root.TrimEnd('\'))
      $routeIsUserProfile=([IO.Path]::GetFullPath($routeRoot) -match '^[A-Z]:\\Users\\')
    }
    $actualConfigPath=[string]$json.active.configPath
    $expectedConfigPath=[string]$required.machineConfig
    $configBound=([IO.Path]::IsPathFullyQualified($actualConfigPath) -and
      [IO.Path]::GetFullPath($actualConfigPath) -ieq [IO.Path]::GetFullPath($expectedConfigPath))
    $configHashMatches=$false
    $portMatches=$false
    if($configBound -and (Test-Path -LiteralPath $expectedConfigPath -PathType Leaf)){
      $actualHash=(Get-FileHash -LiteralPath $expectedConfigPath -Algorithm SHA256).Hash
      $configHashMatches=($actualHash -ieq [string]$json.active.configSha256)
      $trustedConfig=Get-Content -LiteralPath $expectedConfigPath -Raw | ConvertFrom-Json -ErrorAction Stop
      $portMatches=([int]$json.active.port -ge 1024 -and
        [int]$json.active.port -eq [int]$trustedConfig.port)
    }
    $trustedPackage=Get-Content -LiteralPath ([string]$required.package) -Raw | ConvertFrom-Json -ErrorAction Stop
    $versionAligned=($routeVersion -eq [string]$trustedPackage.version)
    $commitValid=($routeCommit -match '^[0-9a-fA-F]{40}$')
    $routeValid=($routeHasExpectedFields -and $routeMatches -and $configBound -and
      $configHashMatches -and $portMatches -and $versionAligned -and $commitValid)
    if(-not $routeHasExpectedFields){$codes.Add('ROUTE_SCHEMA_OR_BINDING_UNVERIFIED')}
    if(-not $routeMatches){$codes.Add('ROUTE_NOT_PINNED_TO_TRUSTED_SOURCE')}
    if(-not $configBound){$codes.Add('ROUTE_CONFIG_NOT_PINNED_TO_TRUSTED_MACHINE')}
    if(-not $configHashMatches){$codes.Add('ROUTE_CONFIG_HASH_UNVERIFIED')}
    if(-not $portMatches){$codes.Add('ROUTE_PORT_MISMATCH')}
    if(-not $versionAligned){$codes.Add('ROUTE_VERSION_MISMATCH')}
    if(-not $commitValid){$codes.Add('ROUTE_COMMIT_INVALID')}
  }catch{$codes.Add('MALFORMED_MACHINE_ROUTE')}
}else{$codes.Add('MACHINE_ROUTE_MISSING')}
# Static ACLs and route bindings do not prove that every dynamically loaded dependency,
# credential scope, installed worker and recovery path is trusted.
$preflightPassed=($codes.Count -eq 0 -and $routeValid)
[pscustomobject]@{
  schema=1;readOnly=$true;preflightPassed=$preflightPassed
  migrationReady=$false;dependencyClosureVerified=$false
  releaseAuthorized=$false
  route=[pscustomobject]@{
    exists=(Test-Path -LiteralPath $routeFile -PathType Leaf)
    valid=$routeValid;boundToTrustedSource=$routeMatches
    activeSourceInUserProfile=$routeIsUserProfile
    version=$routeVersion;commit=$routeCommit
  }
  checks=$results.Count
  failures=@($codes.ToArray()|Select-Object -Unique)
  required=@($results)
  mandatoryUnresolved=@('FULL_DEPENDENCY_CLOSURE','TRUSTED_CONFIG_AND_CREDENTIAL_SCOPE',
    'OWNER_SESSION_NATIVE_E2E','INDEPENDENT_SECURITY_REVIEW','RECOVERY_AND_CUTOVER')
}|ConvertTo-Json -Compress -Depth 7
