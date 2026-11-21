param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('Fixture','OwnerRoaming','OwnerLocalRuntime')]
  [string]$Mode,
  [string]$FixtureRoot,
  [string]$OutputParent,
  [switch]$PermitAdministratorsGroupSource
)
# v0.12 scoped Windows owner-state backup. Never a live-consistent full migration.
# Always runs under the current Windows owner token; never requires elevation.
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
function Stop-WithCode([string]$code) { throw "V012_WIN_SNAPSHOT_$code" }
function FullPath([string]$p) {
  if ([string]::IsNullOrWhiteSpace($p) -or -not [IO.Path]::IsPathFullyQualified($p)) {
    Stop-WithCode 'NONABSOLUTE_PATH'
  }
  return [IO.Path]::GetFullPath($p).TrimEnd([char[]]@('\','/'))
}
function Assert-NoReparseAncestors([string]$path) {
  $p=FullPath $path
  $root=[IO.Path]::GetPathRoot($p)
  $cur=$root
  foreach($part in $p.Substring($root.Length).Split([char[]]@('\','/'),[StringSplitOptions]::RemoveEmptyEntries)) {
    $cur=Join-Path $cur $part
    $it=Get-Item -LiteralPath $cur -Force -ErrorAction Stop
    if (-not $it.PSIsContainer -or (($it.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
      Stop-WithCode 'PATH_ALIAS_OR_NONDIR'
    }
  }
  return $p
}
function Get-Sid {
  $who=[Security.Principal.WindowsIdentity]::GetCurrent()
  if ($null -eq $who -or $null -eq $who.User) { Stop-WithCode 'NO_OWNER_SID' }
  return $who.User
}
function Confirm-Owner([string]$path,[Security.Principal.SecurityIdentifier]$sid) {
  $acl=Get-Acl -LiteralPath $path -ErrorAction Stop
  $actual=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if($actual -eq $sid.Value){ return }
  if($actual -eq 'S-1-5-32-544' -and $script:AdminGroupSourcesAllowed){
    $script:AdminGroupSourceEntries++
    return
  }
  Stop-WithCode 'FOREIGN_SOURCE_OWNER'
}
function Private-Acl([string]$target,[bool]$directory,[Security.Principal.SecurityIdentifier]$sid) {
  $acl=Get-Acl -LiteralPath $target -ErrorAction Stop
  $acl.SetAccessRuleProtection($true,$false)
  foreach($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
  $acl.SetOwner($sid)
  $inherit=if($directory) {
    [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  }else{[Security.AccessControl.InheritanceFlags]::None}
  $rule=[Security.AccessControl.FileSystemAccessRule]::new(
    $sid,
    [Security.AccessControl.FileSystemRights]::FullControl,
    $inherit,
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow
  )
  [void]$acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $target -AclObject $acl -ErrorAction Stop
  $check=Get-Acl -LiteralPath $target -ErrorAction Stop
  $aces=@($check.Access)
  if(-not $check.AreAccessRulesProtected -or
    $check.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or
    $aces.Count -ne 1 -or
    $aces[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
    ([string]$aces[0].IdentityReference -ne $sid.Value -and
     $aces[0].IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) -or
    ($aces[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl) {
    Stop-WithCode 'PRIVATE_ACL_NOT_PROVED'
  }
}
function Assert-Private-Acl([string]$target,[Security.Principal.SecurityIdentifier]$sid) {
  $a=Get-Acl -LiteralPath $target
  $rules=@($a.Access)
  if(-not $a.AreAccessRulesProtected -or
     $a.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or
     $rules.Count -ne 1 -or
     $rules[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
     ($rules[0].IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value)) {
     Stop-WithCode 'EXISTING_DESTINATION_ACL_NOT_PRIVATE'
  }
}
function Copy-Tree([string]$from,[string]$dest,[string]$relative,[Security.Principal.SecurityIdentifier]$sid,[System.Collections.Generic.List[object]]$manifest,[hashtable]$counter) {
  Confirm-Owner $from $sid
  foreach($item in @(Get-ChildItem -LiteralPath $from -Force -ErrorAction Stop | Sort-Object -Property Name)) {
    if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-WithCode 'SOURCE_REPARSE_POINT' }
    $rel=if($relative) { $relative+'/'+$item.Name }else{$item.Name}
    $dst=Join-Path $dest $item.Name
    if(Test-Path -LiteralPath $dst) { Stop-WithCode 'DESTINATION_COLLISION' }
    Confirm-Owner $item.FullName $sid
    if($item.PSIsContainer) {
      [void](New-Item -ItemType Directory -Path $dst -ErrorAction Stop)
      Private-Acl $dst $true $sid
      Copy-Tree $item.FullName $dst $rel $sid $manifest $counter
    } elseif($item -is [System.IO.FileInfo]) {
      if($manifest.Count -ge 10000 -or $item.Length -gt 134217728 -or $counter.Bytes+$item.Length -gt 134217728) {
        Stop-WithCode 'FILE_OR_BYTE_BUDGET'
      }
      $size=[long]$item.Length
      $ticks=$item.LastWriteTimeUtc.Ticks
      $originHash=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      Copy-Item -LiteralPath $item.FullName -Destination $dst -ErrorAction Stop
      Private-Acl $dst $false $sid
      $copied=(Get-Item -LiteralPath $dst -Force)
      $after=(Get-Item -LiteralPath $item.FullName -Force)
      $sourceHash=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      $targetHash=(Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash.ToLowerInvariant()
      if($originHash -ne $sourceHash -or $sourceHash -ne $targetHash -or
         $after.Length -ne $size -or $after.LastWriteTimeUtc.Ticks -ne $ticks -or $copied.Length -ne $size) {
        Stop-WithCode 'SOURCE_CHANGED_OR_COPY_MISMATCH'
      }
      $manifest.Add([ordered]@{relative=$rel;sha256=$sourceHash;bytes=$size})
      $counter.Bytes += $size
    }else{ Stop-WithCode 'SOURCE_NONREGULAR_FILE' }
  }
}
$created=$null
try {
  if($env:OS -ne 'Windows_NT') { Stop-WithCode 'WINDOWS_ONLY' }
  $sid=Get-Sid
  $script:AdminGroupSourcesAllowed=$false
  $script:AdminGroupSourceEntries=0
  if($PermitAdministratorsGroupSource){
    if($Mode -notin @('OwnerRoaming','OwnerLocalRuntime')){Stop-WithCode 'GROUP_SOURCE_MODE_RESTRICTED'}
    $principal=[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
      Stop-WithCode 'ADMIN_GROUP_SOURCE_NEEDS_NATIVE_ELEVATION'
    }
    $script:AdminGroupSourcesAllowed=$true
  }
  if($Mode -in @('OwnerRoaming','OwnerLocalRuntime')){
    if($FixtureRoot -or $OutputParent) { Stop-WithCode 'OWNER_PATH_OVERRIDE_DENIED' }
    $base=if($Mode -eq 'OwnerRoaming'){$env:APPDATA}else{$env:LOCALAPPDATA}
    $source=Join-Path $base 'ChatGPTRemoteCommander'
    $output=Join-Path $env:LOCALAPPDATA 'CommanderV2\migration-private'
  }else{
    if(-not $FixtureRoot -or -not $OutputParent) { Stop-WithCode 'FIXTURE_PATHS_REQUIRED' }
    $source=$FixtureRoot
    $output=$OutputParent
    $temp=[IO.Path]::GetFullPath($env:TEMP).TrimEnd([char[]]@('\','/'))+'\'
    if(-not ([IO.Path]::GetFullPath($source)).StartsWith($temp,[StringComparison]::OrdinalIgnoreCase)){
      Stop-WithCode 'FIXTURE_OUTSIDE_TEMP'
    }
  }
  $source=Assert-NoReparseAncestors $source
  $output=FullPath $output
  if ($source.Equals($output,[StringComparison]::OrdinalIgnoreCase) -or
      $output.StartsWith($source+'\',[StringComparison]::OrdinalIgnoreCase) -or
      $source.StartsWith($output+'\',[StringComparison]::OrdinalIgnoreCase)) { Stop-WithCode 'SOURCE_DESTINATION_OVERLAP' }
  if(Test-Path -LiteralPath $output){
    $output=Assert-NoReparseAncestors $output
    Assert-Private-Acl $output $sid
  }else{
    [void](Assert-NoReparseAncestors (Split-Path -Parent $output))
    [void](New-Item -ItemType Directory -Path $output -ErrorAction Stop)
    Private-Acl $output $true $sid
  }
  $id='v012-windows-'+($Mode.ToLowerInvariant())+'-'+[guid]::NewGuid().ToString('N')
  $created=Join-Path $output $id
  [void](New-Item -ItemType Directory -Path $created -ErrorAction Stop)
  Private-Acl $created $true $sid
  $data=Join-Path $created 'data'
  [void](New-Item -ItemType Directory -Path $data -ErrorAction Stop)
  Private-Acl $data $true $sid
  $entries=[System.Collections.Generic.List[object]]::new()
  $counter=@{Bytes=[long]0}
  if($Mode -eq 'OwnerLocalRuntime'){
    # Fixed owner-local runtime subset; do not sweep multi-GiB QA, caches,
    # browser profiles or other-user workspace state.
    Confirm-Owner $source $sid
    foreach($component in @('routing','instances','credentials')){
      $from=Join-Path $source $component
      if(-not (Test-Path -LiteralPath $from -PathType Container)){
        Stop-WithCode 'REQUIRED_LOCAL_COMPONENT_ABSENT'
      }
      $componentRoot=Get-Item -LiteralPath $from -Force -ErrorAction Stop
      if(($componentRoot.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
        Stop-WithCode 'SOURCE_REPARSE_POINT'
      }
      Confirm-Owner $from $sid
      $componentDest=Join-Path $data $component
      [void](New-Item -ItemType Directory -Path $componentDest -ErrorAction Stop)
      Private-Acl $componentDest $true $sid
      Copy-Tree $from $componentDest $component $sid $entries $counter
    }
  }else{
    Copy-Tree $source $data '' $sid $entries $counter
  }
  $manifestData=[ordered]@{schema=1;mode=$Mode;entries=@($entries.ToArray());files=$entries.Count;bytes=$counter.Bytes}
  $manifestJson=ConvertTo-Json -InputObject $manifestData -Depth 8 -Compress
  $manifestFile=Join-Path $created 'manifest.json'
  [IO.File]::WriteAllText($manifestFile,$manifestJson,[Text.UTF8Encoding]::new($false))
  Private-Acl $manifestFile $false $sid
  $manifestSha=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($manifestJson))).ToLowerInvariant()
  $restore=Join-Path $created 'isolated-restore-verify'
  [void](New-Item -ItemType Directory -Path $restore -ErrorAction Stop)
  Private-Acl $restore $true $sid
  foreach($e in $entries){
    $parts=$e.relative.Split('/')
    $inFile=Join-Path $data ([IO.Path]::Combine($parts))
    $outFile=Join-Path $restore ([IO.Path]::Combine($parts))
    $outDir=Split-Path -Parent $outFile
    if(-not (Test-Path -LiteralPath $outDir)){
      [void](New-Item -ItemType Directory -Path $outDir -Force -ErrorAction Stop)
      # Ancestors are nested inside private root; explicit private ACL on every generated leaf directory.
      Private-Acl $outDir $true $sid
    }
    Copy-Item -LiteralPath $inFile -Destination $outFile -ErrorAction Stop
    Private-Acl $outFile $false $sid
    $actual=(Get-FileHash -LiteralPath $outFile -Algorithm SHA256).Hash.ToLowerInvariant()
    if($actual -ne $e.sha256 -or (Get-Item -LiteralPath $outFile).Length -ne $e.bytes){
      Stop-WithCode 'ISOLATED_RESTORE_MISMATCH'
    }
  }
  Remove-Item -LiteralPath $restore -Recurse -Force -ErrorAction Stop
  $summary=[ordered]@{
    schema=1;mode=$Mode;snapshotId=$id;files=$entries.Count;bytes=$counter.Bytes;
    manifestSha256=$manifestSha;
    ownerOnlyDaclVerified=$true;
    adminGroupOwnedSourceEntries=$script:AdminGroupSourceEntries;
    privilegedSourceReadAttested=$script:AdminGroupSourcesAllowed;
    localRuntimeComponents=if($Mode -eq 'OwnerLocalRuntime'){@('routing','instances','credentials')}else{@()};
    offlineCopyAndRestore='PASS';
    liveConsistencyVerified=$false;
    fullFleetMigrationAccepted=$false;
    installedCutoverAuthorized=$false
  }
  $receiptFile=Join-Path $created 'receipt.json'
  [IO.File]::WriteAllText($receiptFile,(ConvertTo-Json -InputObject $summary -Depth 4 -Compress),[Text.UTF8Encoding]::new($false))
  Private-Acl $receiptFile $false $sid
  $re=[IO.File]::ReadAllText($receiptFile)
  if(($re | ConvertFrom-Json).manifestSha256 -ne $manifestSha){
    Stop-WithCode 'RECEIPT_READBACK_FAILED'
  }
  'V012_WIN_OWNER_STATE_SNAPSHOT='+$re
}catch{
  $msg=$_.Exception.Message
  if($created -and (Test-Path -LiteralPath $created)){
    # Only remove the unique directory created by this invocation.
    try {Remove-Item -LiteralPath $created -Force -Recurse -ErrorAction Stop} catch {}
  }
  if($msg -like 'V012_WIN_SNAPSHOT_*') { [Console]::Error.WriteLine($msg) }
  else{
    # No private paths, filenames, or exception messages in diagnostics.
    $type=$_.Exception.GetType().Name
    if(-not $type.EndsWith('Exception')){$type='UNKNOWN'}
    [Console]::Error.WriteLine('V012_WIN_SNAPSHOT_FAILED_'+$type)
  }
  exit 2
}
