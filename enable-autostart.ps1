param(
  [string]$Profile = 'chatgpt-remote-commander',
  [string]$TunnelId,
  [ValidateRange(0,65535)][int]$HealthPort = 0,
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProfileDir = Join-Path $env:APPDATA 'tunnel-client'
$ProfileFile = Join-Path $ProfileDir "$Profile.yaml"
$CredDir = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\credentials'
$SafeProfile = $Profile -replace '[^A-Za-z0-9._-]','_'
$CredFile = Join-Path $CredDir "$SafeProfile.dpapi"
$McpUrl = 'http://127.0.0.1:47831/mcp'
$HealthUrl = 'http://127.0.0.1:47831/health'

function Find-TunnelExe {
  $bundled = Get-ChildItem (Join-Path $Root 'tools') -Filter 'tunnel-client.exe' -File -Recurse -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if ($bundled) { return $bundled.FullName }
  $cmd = Get-Command tunnel-client -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw 'tunnel-client not found. Run install.ps1 first.'
}

function Find-FreeHealthPort {
  foreach ($candidate in 47832..47931) {
    if (-not (Get-NetTCPConnection -State Listen -LocalPort $candidate -ErrorAction SilentlyContinue)) {
      return $candidate
    }
  }
  throw 'No free tunnel health port found in 47832..47931.'
}
function Test-McpHealth {
  try {
    $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
    return [bool]$health.ok
  } catch { return $false }
}
function Ensure-McpHealth {
  if (Test-McpHealth) { return }
  $listener = Get-NetTCPConnection -State Listen -LocalPort 47831 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    throw "Port 47831 is already in use but Remote Commander health is unavailable. Refusing to stop an unknown process."
  }
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  $varDir = Join-Path $Root 'var'
  New-Item -ItemType Directory -Force -Path $varDir | Out-Null
  Start-Process -FilePath $npm -ArgumentList @('start','--silent') -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $varDir 'mcp-connect.out.log') -RedirectStandardError (Join-Path $varDir 'mcp-connect.err.log') | Out-Null
  foreach ($i in 1..30) {
    Start-Sleep -Milliseconds 500
    if (Test-McpHealth) {
      Write-Host 'MCP was not running; it has been started automatically.'
      return
    }
  }
  throw "Remote Commander MCP did not become healthy at $HealthUrl. Check var/mcp-connect.err.log."
}
Ensure-McpHealth

$TunnelExe = Find-TunnelExe
$ProfileExists = Test-Path -LiteralPath $ProfileFile
if (-not $ProfileExists) {
  if (-not $TunnelId) { $TunnelId = Read-Host 'Paste OpenAI tunnel_id for this account' }
  if ($TunnelId -notmatch '^tunnel_[A-Za-z0-9_-]+$') { throw 'Invalid tunnel_id format.' }
  if ($HealthPort -eq 0) { $HealthPort = Find-FreeHealthPort }
} elseif ($HealthPort -eq 0) {
  $raw = Get-Content -LiteralPath $ProfileFile -Raw
  $m = [regex]::Match($raw, 'listen_addr:\s*["'']?127\.0\.0\.1:(\d+)')
  if ($m.Success) { $HealthPort = [int]$m.Groups[1].Value }
}

New-Item -ItemType Directory -Force -Path $CredDir | Out-Null
if (Test-Path -LiteralPath $CredFile) {
  $Encrypted = Get-Content -LiteralPath $CredFile -Raw
  $SecureKey = ConvertTo-SecureString $Encrypted
  Write-Host "Reusing existing DPAPI credential for profile $Profile."
} else {
  $SecureKey = Read-Host 'Paste Runtime API key once (input hidden; saved encrypted for this Windows user)' -AsSecureString
  $Encrypted = ConvertFrom-SecureString $SecureKey
  [IO.File]::WriteAllText($CredFile, $Encrypted, [Text.UTF8Encoding]::new($false))
}
$PlainKey = [System.Net.NetworkCredential]::new('', $SecureKey).Password
if ([string]::IsNullOrWhiteSpace($PlainKey)) { throw 'Runtime API key is empty.' }

try {
  $env:CONTROL_PLANE_API_KEY = $PlainKey
  if (-not $ProfileExists) {
    & $TunnelExe init --sample sample_mcp_remote_no_auth --profile $Profile `
      --tunnel-id $TunnelId --mcp-server-url $McpUrl `
      --health-listen-addr "127.0.0.1:$HealthPort" --force
    if ($LASTEXITCODE -ne 0) { throw "tunnel-client init failed: $LASTEXITCODE" }
  }
  $profilePattern = [regex]::Escape($Profile)
  $runningProfile = Get-CimInstance Win32_Process -Filter "Name='tunnel-client.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "run\s+--profile\s+$profilePattern(?:\s|$)" } |
    Select-Object -First 1
  $ready = $false
  if ($runningProfile -and $HealthPort -gt 0) {
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$HealthPort/readyz" -UseBasicParsing -TimeoutSec 2
      $ready = ($response.StatusCode -eq 200 -and $response.Content.Trim() -eq 'ready')
    } catch { $ready = $false }
  }
  if ($ready) {
    Write-Host "Existing tunnel profile $Profile is already ready on health port $HealthPort; doctor bind check skipped."
  } else {
    & $TunnelExe doctor --profile $Profile --explain
    if ($LASTEXITCODE -ne 0) { throw "tunnel-client doctor failed: $LASTEXITCODE" }
  }
} finally {
  Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
  $PlainKey = $null
  $SecureKey = $null
}

$pwsh = (Get-Command pwsh.exe -ErrorAction Stop).Source
$supervisor = Join-Path $Root 'autostart-windows.ps1'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
New-Item -Path $runKey -Force | Out-Null
$command = '"{0}" -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{1}"' -f $pwsh,$supervisor
New-ItemProperty -Path $runKey -Name 'ChatGPTRemoteCommander' -Value $command -PropertyType String -Force | Out-Null

if (-not $NoStart) {
  $existing = Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match [regex]::Escape('autostart-windows.ps1') } |
    Select-Object -First 1
  if (-not $existing) {
    Start-Process -FilePath $pwsh -ArgumentList @('-NoLogo','-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',$supervisor) -WindowStyle Hidden | Out-Null
  }
}

Write-Host ''
Write-Host "AUTOSTART_ENROLL_PASS profile=$Profile credential=$CredFile"
Write-Host 'Windows logon autostart is enabled. No Tunnel ID, IP/port, or Runtime API key is required on later logons.'
