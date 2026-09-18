param(
  [Parameter(Mandatory=$true)][string]$Directory,
  [string]$ExpectedVersion = '',
  [string]$ExpectedCommit = ''
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$Directory=[IO.Path]::GetFullPath($Directory)
function Assert-True([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
function Hash([string]$Path){return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}

$manifestPath=Join-Path $Directory 'RELEASE_MANIFEST.json'
$sumsPath=Join-Path $Directory 'SHA256SUMS.txt'
Assert-True (Test-Path -LiteralPath $manifestPath -PathType Leaf) 'VERIFY_MANIFEST_MISSING'
Assert-True (Test-Path -LiteralPath $sumsPath -PathType Leaf) 'VERIFY_SHA256SUMS_MISSING'
$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
Assert-True ([string]$manifest.sourceCommit -match '^[0-9a-f]{40}$') 'VERIFY_BAD_SOURCE_COMMIT'
if($ExpectedVersion){Assert-True ([string]$manifest.version -eq $ExpectedVersion) 'VERIFY_VERSION_MISMATCH'}
if($ExpectedCommit){Assert-True ([string]$manifest.sourceCommit -eq $ExpectedCommit.ToLowerInvariant()) 'VERIFY_COMMIT_MISMATCH'}

$seen=@{}
foreach($line in Get-Content -LiteralPath $sumsPath){
  if([string]::IsNullOrWhiteSpace($line)){continue}
  $m=[regex]::Match($line,'^([0-9a-fA-F]{64})  (.+)$')
  Assert-True $m.Success "VERIFY_BAD_SUM_LINE $line"
  $expected=$m.Groups[1].Value.ToLowerInvariant();$name=$m.Groups[2].Value
  Assert-True (-not $seen.ContainsKey($name)) "VERIFY_DUPLICATE_ASSET $name"
  $seen[$name]=$true
  $path=Join-Path $Directory $name
  Assert-True (Test-Path -LiteralPath $path -PathType Leaf) "VERIFY_ASSET_MISSING $name"
  Assert-True ((Hash $path) -eq $expected) "VERIFY_HASH_MISMATCH $name"
}

foreach($required in @('install.ps1','install.sh','plugin-template.zip',('plugin-template-v{0}.zip' -f $manifest.version),'RELEASE_MANIFEST.json')){
  Assert-True $seen.ContainsKey($required) "VERIFY_REQUIRED_ASSET_NOT_HASHED $required"
}

$commit=[string]$manifest.sourceCommit
$win=Get-Content -LiteralPath (Join-Path $Directory 'install.ps1') -Raw
$lin=Get-Content -LiteralPath (Join-Path $Directory 'install.sh') -Raw
Assert-True $win.Contains("[string]`$ExpectedCommit = '$commit'") 'VERIFY_WINDOWS_INSTALLER_NOT_COMMIT_STAMPED'
Assert-True $lin.Contains($commit) 'VERIFY_LINUX_INSTALLER_NOT_COMMIT_STAMPED'

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath=Join-Path $Directory 'plugin-template.zip'
$zip=[IO.Compression.ZipFile]::OpenRead($zipPath)
try{
  $names=@($zip.Entries|ForEach-Object{$_.FullName.Replace('\','/')})
  foreach($required in @('plugin.json','.app.json.example','skills/remote-commander/SKILL.md','assets/icon.png','assets/logo.png')){
    Assert-True ($names -contains $required) "VERIFY_PLUGIN_ENTRY_MISSING $required"
  }
  Assert-True (-not ($names -contains '.app.json')) 'VERIFY_PRIVATE_APP_BINDING_LEAKED'
  foreach($n in $names){
    Assert-True ($n -notmatch '(^|/)(config\.local\.json|\.env|credentials?/|downloads?/|PROJECT_BRAIN\.md)') "VERIFY_PRIVATE_PLUGIN_ENTRY $n"
  }
  $entry=$zip.GetEntry('plugin.json')
  $reader=[IO.StreamReader]::new($entry.Open(),[Text.Encoding]::UTF8,$true)
  try{$plugin=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
  Assert-True ([string]$plugin.version -eq [string]$manifest.version) 'VERIFY_PLUGIN_VERSION_MISMATCH'
}finally{$zip.Dispose()}

$versioned=Join-Path $Directory ('plugin-template-v{0}.zip' -f $manifest.version)
Assert-True ((Hash $versioned) -eq (Hash $zipPath)) 'VERIFY_PLUGIN_ZIPS_DIFFER'

foreach($f in @($manifest.files)){
  $path=Join-Path $Directory ([string]$f.name)
  Assert-True (Test-Path -LiteralPath $path -PathType Leaf) "VERIFY_MANIFEST_ASSET_MISSING $($f.name)"
  Assert-True ((Hash $path) -eq [string]$f.sha256) "VERIFY_MANIFEST_HASH_MISMATCH $($f.name)"
  Assert-True ((Get-Item -LiteralPath $path).Length -eq [long]$f.bytes) "VERIFY_MANIFEST_SIZE_MISMATCH $($f.name)"
}

Write-Host 'RELEASE_VERIFY_PASS'
Write-Host "Version: $($manifest.version)"
Write-Host "Commit: $commit"
Write-Host "Directory: $Directory"
