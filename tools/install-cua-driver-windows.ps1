[CmdletBinding()]
param(
  [string]$InstallRoot = '',
  [switch]$VerifyOnly,
  [switch]$SelfTest
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$pinPath = Join-Path $PSScriptRoot 'cua-driver-pin.json'
if (-not (Test-Path -LiteralPath $pinPath -PathType Leaf)) { throw 'CUA_DRIVER_PIN_METADATA_MISSING' }
$pin = Get-Content -LiteralPath $pinPath -Raw | ConvertFrom-Json
if ([int]$pin.schema -ne 1 -or [string]$pin.version -cne '0.38.0' -or
    [string]$pin.releaseTag -cne ('cua-driver-rs-v' + [string]$pin.version) -or
    [string]$pin.upstreamCommit -notmatch '^[a-f0-9]{40}$' -or
    [string]$pin.sha256sumsSha256 -notmatch '^[a-f0-9]{64}$') {
  throw 'CUA_DRIVER_PIN_PROVENANCE_INVALID'
}
$archName = if ($env:PROCESSOR_ARCHITEW6432 -eq 'ARM64' -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
$key = 'windows-' + $archName
$assetPin = $pin.assets.PSObject.Properties[$key].Value
if (-not $assetPin -or [string]$assetPin.binary -cne 'cua-driver.exe' -or
    [string]$assetPin.file -notmatch ('^cua-driver-rs-0\.38\.0-windows-.*-binary\.zip$') -or
    [string]$assetPin.sha256 -notmatch '^[a-f0-9]{64}$' -or
    [string]$assetPin.binarySha256 -notmatch '^[a-f0-9]{64}$') {
  throw 'CUA_DRIVER_PIN_ASSET_INVALID'
}
if (-not $InstallRoot) { $InstallRoot = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander' }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$version = [string]$pin.version
$releaseTag = [string]$pin.releaseTag
$upstreamCommit = [string]$pin.upstreamCommit
$asset = [string]$assetPin.file
$assetSha = [string]$assetPin.sha256
$binarySha = [string]$assetPin.binarySha256
$finalDir = Join-Path $InstallRoot "adapters\cua-driver\v$version"
$exe = Join-Path $finalDir 'cua-driver.exe'
$metaPath = Join-Path $finalDir 'cua-driver-installed.json'
$receiptPath = Join-Path $finalDir '.verified-archive-sha256'

function Test-ExistingCuaPayload {
  if (-not (Test-Path -LiteralPath $finalDir -PathType Container) -or
      -not (Test-Path -LiteralPath $exe -PathType Leaf) -or
      -not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) { return $false }
  foreach($path in @($finalDir,$exe,$receiptPath)){
    if((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){return $false}
  }
  $actual = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
  $receipt = (Get-Content -LiteralPath $receiptPath -Raw).Trim().ToLowerInvariant()
  if (-not ($actual -ceq $binarySha -and $receipt -ceq $assetSha)) { return $false }
  $versionText = (& $exe --version 2>&1 | Out-String).Trim()
  return ($versionText -ceq ('cua-driver ' + $version))
}
function Test-ExistingCuaMetadata {
  if (-not (Test-Path -LiteralPath $metaPath -PathType Leaf)) { return $false }
  if ((Get-Item -LiteralPath $metaPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { return $false }
  $meta = Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json
  return ([int]$meta.schema -eq 1 -and [string]$meta.version -ceq $version -and
    [string]$meta.releaseTag -ceq $releaseTag -and [string]$meta.upstreamCommit -ceq $upstreamCommit -and
    [string]$meta.asset -ceq $asset -and [string]$meta.assetSha256 -ceq $assetSha -and
    [string]$meta.binarySha256 -ceq $binarySha)
}
function Write-CuaMetadata {
  $tmp = $metaPath + '.stage-' + [guid]::NewGuid().ToString('N')
  $meta = [ordered]@{
    schema=1;version=$version;releaseTag=$releaseTag;upstreamCommit=$upstreamCommit
    asset=$asset;assetSha256=$assetSha;binarySha256=$binarySha
    verification='official-archive-receipt-and-binary-sha256'
  }
  try {
    $meta | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $tmp -Encoding utf8
    Move-Item -LiteralPath $tmp -Destination $metaPath
  } finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
  }
}
if ($SelfTest) {
  [ordered]@{ok=$true;version=$version;releaseTag=$releaseTag;asset=$asset;assetSha256=$assetSha;binarySha256=$binarySha;target=$finalDir} | ConvertTo-Json -Compress
  exit 0
}
if ($VerifyOnly) {
  if (-not (Test-ExistingCuaPayload) -or -not (Test-ExistingCuaMetadata)) { throw 'CUA_DRIVER_EXISTING_PROVENANCE_INVALID' }
  Write-Output "CUA_DRIVER_VERIFY_PASS version=$version path=$exe"
  exit 0
}
if (Test-Path -LiteralPath $finalDir) {
  if (-not (Test-ExistingCuaPayload)) { throw "CUA_DRIVER_EXISTING_UNVERIFIED_PRESERVED path=$finalDir" }
  if (Test-Path -LiteralPath $metaPath) {
    if (-not (Test-ExistingCuaMetadata)) { throw "CUA_DRIVER_EXISTING_METADATA_MISMATCH_PRESERVED path=$metaPath" }
  } else {
    Write-CuaMetadata
    if (-not (Test-ExistingCuaMetadata)) { throw 'CUA_DRIVER_METADATA_ADOPTION_FAILED' }
    Write-Output "CUA_DRIVER_METADATA_ADOPTED version=$version"
  }
  Write-Output "CUA_DRIVER_REUSE_PASS version=$version path=$exe"
  exit 0
}
$parent = Split-Path -Parent $finalDir
New-Item -ItemType Directory -Force -Path $parent | Out-Null
if ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
  throw 'CUA_DRIVER_PARENT_REPARSE_REJECTED'
}
$stage = Join-Path $parent ('.cua-driver-stage-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
  $download = Join-Path $stage 'download'
  $extract = Join-Path $stage 'extract'
  New-Item -ItemType Directory -Path $download,$extract | Out-Null
  $base = "https://github.com/trycua/cua/releases/download/$releaseTag"
  $sums = Join-Path $download 'SHA256SUMS'
  Invoke-WebRequest -Uri "$base/SHA256SUMS" -OutFile $sums -TimeoutSec 180
  $sumsHash = (Get-FileHash -LiteralPath $sums -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sumsHash -cne ([string]$pin.sha256sumsSha256).ToLowerInvariant()) { throw 'CUA_DRIVER_SHA256SUMS_PIN_MISMATCH' }
  $line = Get-Content -LiteralPath $sums | Where-Object { $_ -match ('^[a-fA-F0-9]{64}\s+\*?' + [regex]::Escape($asset) + '$') } | Select-Object -First 1
  if (-not $line -or (($line -split '\s+')[0]).ToLowerInvariant() -cne $assetSha) { throw 'CUA_DRIVER_RELEASE_ASSET_PIN_MISMATCH' }
  $zip = Join-Path $download $asset
  Invoke-WebRequest -Uri "$base/$asset" -OutFile $zip -TimeoutSec 180
  $zipHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($zipHash -cne $assetSha) { throw 'CUA_DRIVER_ASSET_SHA_MISMATCH' }
  Expand-Archive -LiteralPath $zip -DestinationPath $extract
  $stagedExe = Join-Path $extract 'cua-driver.exe'
  if (-not (Test-Path -LiteralPath $stagedExe -PathType Leaf)) { throw 'CUA_DRIVER_ARCHIVE_BINARY_MISSING' }
  $stagedHash = (Get-FileHash -LiteralPath $stagedExe -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($stagedHash -cne $binarySha) { throw 'CUA_DRIVER_BINARY_SHA_MISMATCH' }
  $versionText = (& $stagedExe --version 2>&1 | Out-String).Trim()
  if ($versionText -cne ('cua-driver ' + $version)) { throw 'CUA_DRIVER_VERSION_MISMATCH' }
  Set-Content -LiteralPath (Join-Path $extract '.verified-archive-sha256') -Value $assetSha -NoNewline -Encoding ascii
  $meta = [ordered]@{schema=1;version=$version;releaseTag=$releaseTag;upstreamCommit=$upstreamCommit;asset=$asset;assetSha256=$assetSha;binarySha256=$binarySha;verification='official-archive-and-binary-sha256'}
  $meta | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $extract 'cua-driver-installed.json') -Encoding utf8
  Move-Item -LiteralPath $extract -Destination $finalDir
  Write-Output "CUA_DRIVER_INSTALL_PASS version=$version assetSha256=$assetSha binarySha256=$binarySha path=$exe"
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
