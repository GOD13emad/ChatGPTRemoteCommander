param(
  [string]$Profile,
  [switch]$RemoveCredential
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$ProfileDir = Join-Path $env:APPDATA 'tunnel-client'
$CredDir = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\credentials'

function Test-ProfileName([string]$Name) {
  return ($Name -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -and $Name -notmatch '\.\.' -and $Name -notin @('.','..'))
}
function Get-PinnedTunnelExe {
  $stateFile = Join-Path $Root 'var\tunnel-client.json'
  if (-not (Test-Path -LiteralPath $stateFile)) { return $null }
  try {
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $exe = [IO.Path]::GetFullPath([string]$state.path)
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { return $null }
    $hash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne [string]$state.sha256) { return $null }
    return $exe
  } catch { return $null }
}
function Get-ManagedProfiles {
  if (-not (Test-Path -LiteralPath $ProfileDir)) { return @() }
  $names = @()
  foreach ($f in Get-ChildItem -LiteralPath $ProfileDir -Filter '*.yaml' -File -ErrorAction SilentlyContinue) {
    $name = [IO.Path]::GetFileNameWithoutExtension($f.Name)
    if (-not (Test-ProfileName $name)) { continue }
    $text = Get-Content -LiteralPath $f.FullName -Raw
    if ($text -match 'http://127\.0\.0\.1:47831/mcp') { $names += $name }
  }
  return $names
}

Remove-ItemProperty -Path $runKey -Name 'ChatGPTRemoteCommander' -ErrorAction SilentlyContinue

$rootPattern = [regex]::Escape([IO.Path]::GetFullPath($Root))
$supervisors = @(Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'autostart-windows\.ps1' -and $_.CommandLine -match $rootPattern })
foreach ($p in $supervisors) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

$pinnedExe = Get-PinnedTunnelExe
$managedProfiles = @(Get-ManagedProfiles)
$tunnels = @()
if ($pinnedExe) {
  $expectedExe = [IO.Path]::GetFullPath($pinnedExe)
  $tunnels = @(Get-CimInstance Win32_Process -Filter "Name='tunnel-client.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      if (-not $_.ExecutablePath -or [IO.Path]::GetFullPath([string]$_.ExecutablePath) -ne $expectedExe) { return $false }
      foreach ($name in $managedProfiles) {
        $escaped = [regex]::Escape($name)
        if ($_.CommandLine -match "--profile(?:=|\s+)$escaped(?:\s|$)") { return $true }
      }
      return $false
    })
}
foreach ($p in $tunnels) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

$mcpStopped = $false
$stateFile = Join-Path $Root 'var\mcp-runtime.json'
if (Test-Path -LiteralPath $stateFile) {
  try {
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $listener = Get-NetTCPConnection -State Listen -LocalPort 47831 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener -and
        $listener.OwningProcess -eq [int]$state.pid -and
        [IO.Path]::GetFullPath([string]$state.projectDir) -eq [IO.Path]::GetFullPath($Root)) {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
      if ($proc.Name -eq 'node.exe' -and $proc.CommandLine -match 'src[\\/]server-v0\.3\.mjs') {
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
        $mcpStopped = $true
      }
    }
  } catch { }
}

$credentialState = 'kept'
if ($RemoveCredential) {
  if ([string]::IsNullOrWhiteSpace($Profile)) { throw '-Profile is required with -RemoveCredential.' }
  if (-not (Test-ProfileName $Profile)) { throw 'Invalid profile name.' }
  $file = Join-Path $CredDir "$Profile.dpapi"
  Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
  $credentialState = 'removed'
}

Write-Host "AUTOSTART_DISABLED supervisors=$($supervisors.Count) tunnels=$($tunnels.Count) mcpStopped=$mcpStopped credential=$credentialState"
