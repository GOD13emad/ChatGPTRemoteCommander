param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('OwnerLocal','Fixture')]
  [string]$Mode,
  [string]$FixtureRoot,
  [ValidateRange(1,500000)][int]$MaxEntries=150000,
  [ValidateRange(1,600)][int]$MaxSeconds=180
)
# v0.12 owner-local Windows state inventory. Metadata only: no file bytes,
# passwords, URLs, file names from unknown subtrees, or credential materials.
# A classification is NOT a deletion plan, a coherent snapshot, or cutover consent.
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
function Fail([string]$reason){throw "V012_LOCAL_INVENTORY_$reason"}
function FullPath([string]$p){
  if([string]::IsNullOrWhiteSpace($p) -or -not [IO.Path]::IsPathFullyQualified($p)){Fail 'ABSOLUTE_PATH_REQUIRED'}
  return [IO.Path]::GetFullPath($p).TrimEnd([char[]]@('\','/'))
}
function Assert-RealDir([string]$p){
  $p=FullPath $p
  $root=[IO.Path]::GetPathRoot($p)
  $cur=$root
  foreach($part in $p.Substring($root.Length).Split([char[]]@('\','/'),[StringSplitOptions]::RemoveEmptyEntries)){
    $cur=Join-Path $cur $part
    $item=Get-Item -LiteralPath $cur -Force -ErrorAction Stop
    if(-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){
      Fail 'SOURCE_ALIAS_OR_NONDIR'
    }
  }
  return $p
}
if($env:OS -ne 'Windows_NT'){Fail 'WINDOWS_ONLY'}
if($Mode -eq 'OwnerLocal'){
  if($FixtureRoot){Fail 'OWNER_PATH_OVERRIDE_DENIED'}
  $root=Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander'
}else{
  if(-not $FixtureRoot){Fail 'FIXTURE_ROOT_REQUIRED'}
  $temp=(FullPath $env:TEMP)+'\'
  $candidate=FullPath $FixtureRoot
  if(-not $candidate.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase)){
    Fail 'FIXTURE_OUTSIDE_TEMP'
  }
  $root=$candidate
}
$root=Assert-RealDir $root
# Known project-generated categories are *not* proof that a directory is
# expendable. Unknown directories always remain explicitly unclassified.
$names=@{
  'credentials'='state-candidate'; 'instances'='state-candidate'; 'routing'='state-candidate'
  'browser-profiles'='state-candidate'; 'owner-workspace-v1'='state-candidate'
  'owner-gui-v1'='state-candidate'; 'owner-recovery'='state-candidate'
  'owner-auth-backups'='state-candidate'; 'shared'='state-candidate'
  'backups'='recovery-evidence'; 'manual-backups'='recovery-evidence'
  'audit'='recovery-evidence'; 'evidence'='recovery-evidence'
  'diagnostics'='recovery-evidence'; 'diagnostic-receipts'='recovery-evidence'
  'outputs'='recovery-evidence'; 'recovery'='recovery-evidence'
  'app'='runtime-candidate'; 'apps'='runtime-candidate'
  'adapters'='runtime-candidate'; 'extensions'='runtime-candidate'
  'runtimes'='runtime-candidate'; 'tools'='runtime-candidate'
  'browser-companion'='runtime-candidate'; 'browser-hybrid'='runtime-candidate'
  'server-headless-v1'='runtime-candidate'; 'toolchains'='runtime-candidate'
  'qa'='staging-candidate'; 'previews'='staging-candidate'
  'build'='staging-candidate'; 'candidates'='staging-candidate'
  'candidate-stage'='staging-candidate'; 'migration-stage'='staging-candidate'
  'migration-staging'='staging-candidate'; 'downloads'='staging-candidate'
  'benchmarks'='staging-candidate'; 'full-access-candidate'='staging-candidate'
}
$groups=[ordered]@{}
foreach($key in @('state-candidate','recovery-evidence','runtime-candidate','staging-candidate','unclassified')){
  $groups[$key]=[ordered]@{files=[long]0;directories=[long]0;bytes=[long]0;knownTopDirs=0}
}
$sw=[Diagnostics.Stopwatch]::StartNew()
$scanned=0L
$aliasCount=0L
$accessErrors=0L
$rootEntries=0L
$complete=$true
$reason='NONE'
$stack=[Collections.Generic.Stack[object]]::new()
try{
  foreach($item in (Get-ChildItem -LiteralPath $root -Force -ErrorAction Stop)){
    $kind=if($names.ContainsKey($item.Name.ToLowerInvariant())){$names[$item.Name.ToLowerInvariant()]}else{'unclassified'}
    $stack.Push([pscustomobject]@{Item=$item;Kind=$kind;Top=$true})
    $rootEntries++
  }
}catch{ $accessErrors++; $complete=$false; $reason='ROOT_ENUMERATION_ERROR' }
while($stack.Count -gt 0){
  if($scanned -ge $MaxEntries){$complete=$false;$reason='ENTRY_LIMIT';break}
  if($sw.Elapsed.TotalSeconds -gt $MaxSeconds){$complete=$false;$reason='TIME_LIMIT';break}
  $current=$stack.Pop()
  $obj=$current.Item
  $g=$groups[$current.Kind]
  $scanned++
  if(($obj.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){
    $aliasCount++;$complete=$false
    if($reason -eq 'NONE'){$reason='REPARSE_SKIPPED'}
    continue
  }
  if($obj.PSIsContainer){
    $g.directories++
    if($current.Top -and $current.Kind -ne 'unclassified'){$g.knownTopDirs++}
    try{
      foreach($child in (Get-ChildItem -LiteralPath $obj.FullName -Force -ErrorAction Stop)){
        $stack.Push([pscustomobject]@{Item=$child;Kind=$current.Kind;Top=$false})
      }
    }catch{
      $accessErrors++;$complete=$false
      if($reason -eq 'NONE'){$reason='ENUMERATION_ERROR'}
    }
  }elseif($obj -is [IO.FileInfo]){
    $g.files++;$g.bytes += [long]$obj.Length
  }else{
    $accessErrors++;$complete=$false
    if($reason -eq 'NONE'){$reason='UNKNOWN_FILE_TYPE'}
  }
}
$sw.Stop()
$files=0L;$dirs=0L;$bytes=0L
foreach($g in $groups.Values){$files+=$g.files;$dirs+=$g.directories;$bytes+=$g.bytes}
[ordered]@{
  schema=1;mode=$Mode;scope='CURRENT_PROCESS_USER_READ_ONLY'
  inventoryComplete=$complete;stopReason=$reason
  scannedEntries=$scanned;topLevelEntries=$rootEntries
  totalFiles=$files;totalDirectories=$dirs;totalBytes=$bytes
  skippedReparseEntries=$aliasCount;enumerationErrors=$accessErrors
  maxEntries=$MaxEntries;maxSeconds=$MaxSeconds;groups=$groups
  filesOpenedForContent=0;filesCopied=0;ownerAuthenticated=$false
  consistentBackupVerified=$false;cutoverAccepted=$false
} | ConvertTo-Json -Depth 6 -Compress
