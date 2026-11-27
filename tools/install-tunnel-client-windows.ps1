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
    [string]$assetPin.binarySha256 -notmatch '^[a-f0-9]{64}$' -or
    [string]$assetPin.cloudflaredSha256 -notmatch '^[a-f0-9]{64}$') {
  throw 'TUNNEL_CLIENT_PIN_ASSET_INVALID'
}
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$version = [string]$pin.version
$tag = [string]$pin.releaseTag
$commit = [string]$pin.upstreamCommit
$asset = [string]$assetPin.file
$assetSha = [string]$assetPin.sha256
$binarySha = [string]$assetPin.binarySha256
$cloudflaredSha = [string]$assetPin.cloudflaredSha256
if ($asset -cne "tunnel-client-v$version-windows-$archName.zip") { throw 'TUNNEL_CLIENT_PIN_ASSET_NAME_INVALID' }
$toolDir = Join-Path $InstallDir "tools\tunnel-client-v$version-windows-$archName"
$exe = Join-Path $toolDir 'tunnel-client.exe'
$cloudflared = Join-Path $toolDir 'cloudflared.exe'
$metaPath = Join-Path $InstallDir 'var\tunnel-client-installed.json'
$legacyState = Join-Path $InstallDir 'var\tunnel-client.json'
$receiptPath = Join-Path $toolDir '.verified-archive-sha256'

function Test-RegularPath([string]$Path, [string]$Kind = 'Leaf') {
  if (-not (Test-Path -LiteralPath $Path -PathType $Kind)) { return $false }
  return (-not ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint))
}
function Test-ExistingTunnelClient([switch]$AllowLegacy) {
  if (-not (Test-RegularPath (Split-Path -Parent $toolDir) 'Container') -or
      -not (Test-RegularPath $toolDir 'Container') -or
      -not (Test-RegularPath $exe) -or -not (Test-RegularPath $cloudflared) -or
      -not (Test-RegularPath $receiptPath)) { return $false }
  $actual = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
  $actualCloudflared = (Get-FileHash -LiteralPath $cloudflared -Algorithm SHA256).Hash.ToLowerInvariant()
  $receipt = (Get-Content -LiteralPath $receiptPath -Raw).Trim().ToLowerInvariant()
  if ($actual -cne $binarySha -or $actualCloudflared -cne $cloudflaredSha -or $receipt -cne $assetSha) { return $false }
  if (Test-Path -LiteralPath $metaPath) {
    if (-not (Test-RegularPath (Split-Path -Parent $metaPath) 'Container') -or -not (Test-RegularPath $metaPath)) { return $false }
    $meta = Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json
    if ([int]$meta.schema -ne 1 -or [string]$meta.version -cne $version -or
        [string]$meta.releaseTag -cne $tag -or [string]$meta.upstreamCommit -cne $commit -or
        [string]$meta.asset -cne $asset -or [string]$meta.assetSha256 -cne $assetSha -or
        [string]$meta.binarySha256 -cne $binarySha) { return $false }
    $companionProperty = $meta.PSObject.Properties['cloudflaredSha256']
    $verificationProperty = $meta.PSObject.Properties['verification']
    if ($null -ne $companionProperty -and [string]$companionProperty.Value -cne $cloudflaredSha) { return $false }
    if ($null -ne $verificationProperty -and [string]$verificationProperty.Value -cne 'archive-and-binary-set-sha256') { return $false }
    if (-not $AllowLegacy -and ($null -eq $companionProperty -or $null -eq $verificationProperty)) { return $false }
  } elseif (-not $AllowLegacy) { return $false }
  if (-not $AllowLegacy) {
    if (-not (Test-RegularPath $legacyState)) { return $false }
    $state = Get-Content -LiteralPath $legacyState -Raw | ConvertFrom-Json
    if ([string]$state.path -ine $exe -or [string]$state.sha256 -cne $binarySha -or
        [string]$state.cloudflaredSha256 -cne $cloudflaredSha) { return $false }
  }
  $versionText = (& $exe --version 2>&1 | Out-String).Trim()
  return ($LASTEXITCODE -eq 0 -and $versionText -like ($version + '+' + $commit + '*'))
}
function Write-VerifiedTunnelState {
  $var = Split-Path -Parent $metaPath
  New-Item -ItemType Directory -Force -Path $var | Out-Null
  if (-not (Test-RegularPath $var 'Container')) { throw 'TUNNEL_CLIENT_STATE_PARENT_REPARSE_REJECTED' }
  foreach ($target in @($metaPath,$legacyState)) {
    if ((Test-Path -LiteralPath $target) -and -not (Test-RegularPath $target)) { throw 'TUNNEL_CLIENT_STATE_PATH_REJECTED' }
  }
  $meta = [ordered]@{
    schema=1;version=$version;releaseTag=$tag;upstreamCommit=$commit;asset=$asset
    assetSha256=$assetSha;binarySha256=$binarySha;cloudflaredSha256=$cloudflaredSha
    verification='archive-and-binary-set-sha256'
  }
  # Existing supervisor, enrollment and handoff consumers require path/sha256.
  $state = [ordered]@{}
  foreach ($key in $meta.Keys) { $state[$key] = $meta[$key] }
  $state['path'] = $exe
  $state['sha256'] = $binarySha
  $state['recordedAt'] = (Get-Date).ToUniversalTime().ToString('o')
  foreach ($entry in @(@{path=$metaPath;value=$meta},@{path=$legacyState;value=$state})) {
    $tmp = $entry.path + '.stage-' + [guid]::NewGuid().ToString('N')
    try {
      [IO.File]::WriteAllText($tmp,($entry.value | ConvertTo-Json -Depth 5) + [Environment]::NewLine,[Text.UTF8Encoding]::new($false))
      [IO.File]::Move($tmp,$entry.path,$true)
    } finally {
      if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
    }
  }
}
if ($SelfTest) {
  [ordered]@{ok=$true;version=$version;releaseTag=$tag;asset=$asset;assetSha256=$assetSha;binarySha256=$binarySha;cloudflaredSha256=$cloudflaredSha;target=$toolDir} | ConvertTo-Json -Compress
  exit 0
}
if ($VerifyOnly) {
  if (-not (Test-ExistingTunnelClient)) { throw 'TUNNEL_CLIENT_EXISTING_PROVENANCE_INVALID' }
  Write-Output "TUNNEL_CLIENT_VERIFY_PASS version=$version path=$exe"
  exit 0
}
if (Test-Path -LiteralPath $toolDir) {
  if (Test-ExistingTunnelClient -AllowLegacy) {
    Write-VerifiedTunnelState
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
  $stagedCloudflared = Join-Path $extract 'cloudflared.exe'
  if (-not (Test-RegularPath $stagedExe) -or -not (Test-RegularPath $stagedCloudflared)) { throw 'TUNNEL_CLIENT_ARCHIVE_BINARY_MISSING' }
  $stagedHash = (Get-FileHash -LiteralPath $stagedExe -Algorithm SHA256).Hash.ToLowerInvariant()
  $stagedCloudflaredHash = (Get-FileHash -LiteralPath $stagedCloudflared -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($stagedHash -cne $binarySha -or $stagedCloudflaredHash -cne $cloudflaredSha) { throw 'TUNNEL_CLIENT_BINARY_SET_SHA_MISMATCH' }
  $versionText = (& $stagedExe --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $versionText -notlike ($version + '+' + $commit + '*')) { throw 'TUNNEL_CLIENT_VERSION_MISMATCH' }
  Set-Content -LiteralPath (Join-Path $extract '.verified-archive-sha256') -Value $assetSha -NoNewline -Encoding ascii
  Move-Item -LiteralPath $extract -Destination $toolDir
  Write-VerifiedTunnelState
  Write-Output "TUNNEL_CLIENT_INSTALL_PASS version=$version assetSha256=$assetSha binarySha256=$binarySha cloudflaredSha256=$cloudflaredSha path=$exe"
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
