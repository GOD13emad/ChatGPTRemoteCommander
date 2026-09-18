param(
  [string]$Profile,
  [switch]$RemoveCredential
)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$ProfileDir = Join-Path $env:APPDATA 'tunnel-client'
$CredDir = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\credentials'

function Assert-ProfileName([string]$Name) {
  if ($Name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') { throw 'Invalid profile name.' }
}

function Get-StringSha256([string]$Value) {
  return ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Value)))).ToLowerInvariant()
}

function ExpectedInstanceId {
  return (Get-StringSha256 $Root.ToLowerInvariant()).Substring(0,24)
}

function Find-TunnelExe {
  $manifestPath = Join-Path $Root 'tools\tunnel-client.active.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return $null }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $candidate = [IO.Path]::GetFullPath((Join-Path $Root ([string]$manifest.relativePath)))
  if (-not $candidate.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $null }
  $actual = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne ([string]$manifest.sha256).ToLowerInvariant()) { return $null }
  return $candidate
}

function ManagedProfiles {
  if (-not (Test-Path $ProfileDir)) { return @() }
  $out = @()
  foreach ($f in Get-ChildItem $ProfileDir -Filter '*.yaml' -File -ErrorAction SilentlyContinue) {
    $name = [IO.Path]::GetFileNameWithoutExtension($f.Name)
    if ($name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') { continue }
    $raw = Get-Content -LiteralPath $f.FullName -Raw
    if ($raw -match 'http://127\.0\.0\.1:47831/mcp') { $out += $name }
  }
  return $out
}

$runValue = (Get-ItemProperty -Path $runKey -Name 'ChatGPTRemoteCommander' -ErrorAction SilentlyContinue).ChatGPTRemoteCommander
if ($runValue -and ([string]$runValue).IndexOf((Join-Path $Root 'autostart-windows.ps1'), [StringComparison]::OrdinalIgnoreCase) -ge 0) {
  Remove-ItemProperty -Path $runKey -Name 'ChatGPTRemoteCommander' -ErrorAction SilentlyContinue
}

$rootPattern = [regex]::Escape($Root)
$supervisors = @(Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'autostart-windows\.ps1' -and $_.CommandLine -match $rootPattern })
foreach ($p in $supervisors) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }

$tunnels = @()
$exe = Find-TunnelExe
if ($exe) {
  $exeFull = [IO.Path]::GetFullPath($exe)
  foreach ($name in ManagedProfiles) {
    $escaped = [regex]::Escape($name)
    $matches = @(Get-CimInstance Win32_Process -Filter "Name='tunnel-client.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        $_.ExecutablePath -and
        [IO.Path]::GetFullPath([string]$_.ExecutablePath) -eq $exeFull -and
        $_.CommandLine -match ('run\s+--profile\s+(?:"{0}"|{0})(?:\s|$)' -f $escaped)
      })
    foreach ($p in $matches) {
      $tunnels += $p
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

$mcpStopped = $false
$listener = Get-NetTCPConnection -State Listen -LocalPort 47831 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $health = $null
  try { $health = Invoke-RestMethod 'http://127.0.0.1:47831/health' -TimeoutSec 2 } catch { }
  if ($health.ok -and $health.instanceId -eq (ExpectedInstanceId)) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if ($proc.Name -eq 'node.exe' -and $proc.CommandLine -match 'server-v0\.3\.mjs') {
      Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
      $mcpStopped = $true
    }
  }
}

$credentialState = 'kept'
if ($RemoveCredential) {
  if ([string]::IsNullOrWhiteSpace($Profile)) { throw '-Profile is required with -RemoveCredential.' }
  Assert-ProfileName $Profile
  $file = Join-Path $CredDir "$Profile.dpapi"
  Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
  $credentialState = 'removed'
}

Write-Host "AUTOSTART_DISABLED supervisors=$($supervisors.Count) tunnels=$($tunnels.Count) mcpStopped=$mcpStopped credential=$credentialState"
