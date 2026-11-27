[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$InstallDir,
  [string]$ExpectedVersion = '',
  [switch]$VerifyOnly,
  [switch]$SelfTest
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$pinPath = Join-Path $PSScriptRoot 'tunnel-client-pin.json'
if (-not (Test-Path -LiteralPath $pinPath -PathType Leaf)) { throw 'TUNNEL_CLIENT_PIN_METADATA_MISSING' }
$pin = Get-Content -LiteralPath $pinPath -Raw | ConvertFrom-Json
if ([int]$pin.schema -ne 1 -or [string]$pin.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or
    [string]$pin.releaseTag -cne ('v' + [string]$pin.version) -or
    [string]$pin.upstreamCommit -notmatch '^[a-f0-9]{40}$' -or
    [string]$pin.sha256sumsSha256 -notmatch '^[a-f0-9]{64}$') {
  throw 'TUNNEL_CLIENT_PIN_PROVENANCE_INVALID'
}
if ($ExpectedVersion -and $ExpectedVersion -cne [string]$pin.version) { throw 'TUNNEL_CLIENT_VERSION_OVERRIDE_REJECTED' }
$archName = if ($env:PROCESSOR_ARCHITEW6432 -eq 'ARM64' -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
$key = 'windows-' + $archName
$assetPin = $pin.assets.PSObject.Properties[$key].Value
if (-not $assetPin -or [string]$assetPin.binary -cne 'tunnel-client.exe' -or
    [string]$assetPin.sha256 -notmatch '^[a-f0-9]{64}$' -or
    [string]$assetPin.binarySha256 -notmatch '^[a-f0-9]{64}$') {
  throw 'TUNNEL_CLIENT_PIN_ASSET_INVALID'
}
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$version = [string]$pin.version
$tag = [string]$pin.releaseTag
$commit = [string]$pin.upstreamCommit
$asset = [string]$assetPin.file
$assetSha = [string]$assetPin.sha256
$binarySha = [string]$assetPin.binarySha256
$toolDir = Join-Path $InstallDir "tools\tunnel-client-v$version-windows-$archName"
$exe = Join-Path $toolDir 'tunnel-client.exe'
$metaPath = Join-Path $InstallDir 'var\tunnel-client-installed.json'
$legacyState = Join-Path $InstallDir 'var\tunnel-client.json'
$receiptPath = Join-Path $toolDir '.verified-archive-sha256'

function Test-ExistingTunnelClient {
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf) -or
      -not (Test-Path -LiteralPath $metaPath -PathType Leaf) -or
      -not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) { return $false }
  $meta = Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json
  $actual = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
  $receipt = (Get-Content -LiteralPath $receiptPath -Raw).Trim().ToLowerInvariant()
  if (-not ($actual -ceq $binarySha -and $receipt -ceq $assetSha -and
    [string]$meta.version -ceq $version -and [string]$meta.releaseTag -ceq $tag -and
    [string]$meta.upstreamCommit -ceq $commit -and [string]$meta.asset -ceq $asset -and
    [string]$meta.assetSha256 -ceq $assetSha -and [string]$meta.binarySha256 -ceq $binarySha)) { return $false }
  $versionText = (& $exe --version 2>&1 | Out-String).Trim()
  return ($versionText -like ($version + '+' + $commit + '*'))
}
if ($SelfTest) {
  [ordered]@{ok=$true;version=$version;releaseTag=$tag;asset=$asset;assetSha256=$assetSha;binarySha256=$binarySha;target=$toolDir} | ConvertTo-Json -Compress
  exit 0
}
if ($VerifyOnly) {
  if (-not (Test-ExistingTunnelClient)) { throw 'TUNNEL_CLIENT_EXISTING_PROVENANCE_INVALID' }
  Write-Output "TUNNEL_CLIENT_VERIFY_PASS version=$version path=$exe"
  exit 0
}
if (Test-Path -LiteralPath $toolDir) {
  if (Test-ExistingTunnelClient) {
    Write-Output "TUNNEL_CLIENT_REUSE_PASS version=$version path=$exe"
    exit 0
  }
  throw "TUNNEL_CLIENT_EXISTING_UNVERIFIED_PRESERVED path=$toolDir"
}
$parent = Split-Path -Parent $toolDir
New-Item -ItemType Directory -Force -Path $parent | Out-Null
if ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
  throw 'TUNNEL_CLIENT_PARENT_REPARSE_REJECTED'
}
$stage = Join-Path $parent ('.tunnel-client-stage-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
  $download = Join-Path $stage 'download'
  $extract = Join-Path $stage 'extract'
  New-Item -ItemType Directory -Path $download,$extract | Out-Null
  $base = "https://github.com/openai/tunnel-client/releases/download/$tag"
  $sums = Join-Path $download 'SHA256SUMS.txt'
  Invoke-WebRequest -Uri "$base/SHA256SUMS.txt" -OutFile $sums -TimeoutSec 180
  $sumsHash = (Get-FileHash -LiteralPath $sums -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sumsHash -cne ([string]$pin.sha256sumsSha256).ToLowerInvariant()) { throw 'TUNNEL_CLIENT_SHA256SUMS_PIN_MISMATCH' }
  $line = Get-Content -LiteralPath $sums | Where-Object { $_ -match ('^[a-fA-F0-9]{64}\s+\*?' + [regex]::Escape($asset) + '$') } | Select-Object -First 1
  if (-not $line -or (($line -split '\s+')[0]).ToLowerInvariant() -cne $assetSha) { throw 'TUNNEL_CLIENT_RELEASE_ASSET_PIN_MISMATCH' }
  $zip = Join-Path $download $asset
  Invoke-WebRequest -Uri "$base/$asset" -OutFile $zip -TimeoutSec 180
  $zipHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($zipHash -cne $assetSha) { throw 'TUNNEL_CLIENT_ASSET_SHA_MISMATCH' }
  Expand-Archive -LiteralPath $zip -DestinationPath $extract
  $stagedExe = Join-Path $extract 'tunnel-client.exe'
  if (-not (Test-Path -LiteralPath $stagedExe -PathType Leaf)) { throw 'TUNNEL_CLIENT_ARCHIVE_BINARY_MISSING' }
  $stagedHash = (Get-FileHash -LiteralPath $stagedExe -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($stagedHash -cne $binarySha) { throw 'TUNNEL_CLIENT_BINARY_SHA_MISMATCH' }
  $versionText = (& $stagedExe --version 2>&1 | Out-String).Trim()
  if ($versionText -notlike ($version + '+' + $commit + '*')) { throw 'TUNNEL_CLIENT_VERSION_MISMATCH' }
  Set-Content -LiteralPath (Join-Path $extract '.verified-archive-sha256') -Value $assetSha -NoNewline -Encoding ascii
  $meta = [ordered]@{schema=1;version=$version;releaseTag=$tag;upstreamCommit=$commit;asset=$asset;assetSha256=$assetSha;binarySha256=$binarySha}
  $meta | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stage 'tunnel-client-installed.json') -Encoding utf8
  $var = Join-Path $InstallDir 'var'
  New-Item -ItemType Directory -Force -Path $var | Out-Null
  Move-Item -LiteralPath $extract -Destination $toolDir
  Move-Item -LiteralPath (Join-Path $stage 'tunnel-client-installed.json') -Destination $metaPath
  $meta | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $legacyState -Encoding utf8
  Write-Output "TUNNEL_CLIENT_INSTALL_PASS version=$version assetSha256=$assetSha binarySha256=$binarySha path=$exe"
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
