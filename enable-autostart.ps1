param(
  [string]$Profile = 'chatgpt-remote-commander',
  [string]$TunnelId,
  [ValidateRange(0,65535)][int]$HealthPort = 0,
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProfileDir = Join-Path $env:APPDATA 'tunnel-client'
$CredDir = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\credentials'
$McpUrl = 'http://127.0.0.1:47831/mcp'
$HealthUrl = 'http://127.0.0.1:47831/health'

function Assert-ProfileName([string]$Name) {
  if ($Name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
    throw 'Profile must be 1-64 characters: letters, digits, dot, underscore or hyphen; first character must be alphanumeric.'
  }
}

function Find-TunnelExe {
  $manifestPath = Join-Path $Root 'tools\tunnel-client.active.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'Pinned tunnel-client manifest is missing. Re-run install.ps1 without -SkipTunnelClient.'
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ([string]::IsNullOrWhiteSpace([string]$manifest.relativePath) -or [string]::IsNullOrWhiteSpace([string]$manifest.sha256)) {
    throw 'Pinned tunnel-client manifest is invalid.'
  }
  $candidate = [IO.Path]::GetFullPath((Join-Path $Root ([string]$manifest.relativePath)))
  $rootFull = [IO.Path]::GetFullPath($Root)
  if (-not $candidate.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) { throw 'Pinned tunnel-client path escapes install root.' }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw 'Pinned tunnel-client executable is missing.' }
  $actual = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne ([string]$manifest.sha256).ToLowerInvariant()) { throw 'Pinned tunnel-client executable hash mismatch.' }
  return $candidate
}

function Find-FreeHealthPort {
  foreach ($candidate in 47832..47931) {
    if (-not (Get-NetTCPConnection -State Listen -LocalPort $candidate -ErrorAction SilentlyContinue)) { return $candidate }
  }
  throw 'No free tunnel health port found in 47832..47931.'
}

function Read-ProfileData([string]$File) {
  $raw = Get-Content -LiteralPath $File -Raw
  if ($raw -notmatch [regex]::Escape($McpUrl)) { throw 'Existing profile does not target this Remote Commander MCP.' }
  $portMatch = [regex]::Match($raw, 'listen_addr:\s*["'']?127\.0\.0\.1:(\d+)')
  if (-not $portMatch.Success) { throw 'Existing profile has no valid loopback health port.' }
  $tunnelMatch = [regex]::Match($raw, 'tunnel_[A-Za-z0-9_-]+')
  return [pscustomobject]@{
    Raw = $raw
    HealthPort = [int]$portMatch.Groups[1].Value
    TunnelId = if ($tunnelMatch.Success) { $tunnelMatch.Value } else { $null }
  }
}

function Test-McpHealth {
  try {
    $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
    return [bool]($health.ok -and $health.name -eq 'chatgpt-remote-commander')
  } catch { return $false }
}

function Ensure-McpHealth {
  if (Test-McpHealth) { return }
  if (Get-NetTCPConnection -State Listen -LocalPort 47831 -ErrorAction SilentlyContinue) {
    throw 'Port 47831 is already in use but expected Remote Commander health is unavailable.'
  }
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  $varDir = Join-Path $Root 'var'
  New-Item -ItemType Directory -Force -Path $varDir | Out-Null
  Start-Process -FilePath $npm -ArgumentList @('start','--silent') -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $varDir 'mcp-connect.out.log') -RedirectStandardError (Join-Path $varDir 'mcp-connect.err.log') | Out-Null
  foreach ($i in 1..30) {
    Start-Sleep -Milliseconds 500
    if (Test-McpHealth) { Write-Host 'MCP was not running; it has been started automatically.'; return }
  }
  throw "Remote Commander MCP did not become healthy at $HealthUrl."
}

function Get-TunnelProcess([string]$Name, [string]$Exe) {
  $profilePattern = [regex]::Escape($Name)
  $exeFull = [IO.Path]::GetFullPath($Exe)
  return Get-CimInstance Win32_Process -Filter "Name='tunnel-client.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ExecutablePath -and
      [IO.Path]::GetFullPath([string]$_.ExecutablePath) -eq $exeFull -and
      $_.CommandLine -match ('run\s+--profile\s+(?:"{0}"|{0})(?:\s|$)' -f $profilePattern)
    } |
    Select-Object -First 1
}

function Test-TunnelReady([int]$Port) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/readyz" -UseBasicParsing -TimeoutSec 2
    return ($response.StatusCode -eq 200 -and $response.Content.Trim() -eq 'ready')
  } catch { return $false }
}

Assert-ProfileName $Profile
Ensure-McpHealth
$TunnelExe = Find-TunnelExe
New-Item -ItemType Directory -Force -Path $ProfileDir,$CredDir | Out-Null
$ProfileFile = Join-Path $ProfileDir "$Profile.yaml"
$CredFile = Join-Path $CredDir "$Profile.dpapi"
$ProfileExists = Test-Path -LiteralPath $ProfileFile
$ProfileCreated = $false
$NewCredential = -not (Test-Path -LiteralPath $CredFile)

if ($ProfileExists) {
  $profileData = Read-ProfileData $ProfileFile
  if ($TunnelId) {
    if (-not $profileData.TunnelId) { throw 'Existing profile tunnel_id could not be verified; omit -TunnelId or recreate the profile explicitly.' }
    if ($TunnelId -ne $profileData.TunnelId) { throw 'Requested TunnelId does not match the existing profile.' }
  }
  if ($HealthPort -ne 0 -and $HealthPort -ne $profileData.HealthPort) { throw 'Requested HealthPort does not match the existing profile.' }
  $HealthPort = $profileData.HealthPort
  $TunnelId = $profileData.TunnelId
} else {
  if (-not $TunnelId) { $TunnelId = Read-Host 'Paste OpenAI tunnel_id for this account' }
  if ($TunnelId -notmatch '^tunnel_[A-Za-z0-9_-]+$') { throw 'Invalid tunnel_id format.' }
  if ($HealthPort -eq 0) { $HealthPort = Find-FreeHealthPort }
  elseif (Get-NetTCPConnection -State Listen -LocalPort $HealthPort -ErrorAction SilentlyContinue) { throw "HealthPort $HealthPort is already in use." }
}

if ($NewCredential) {
  $SecureKey = Read-Host 'Paste Runtime API key once (input hidden; saved only after validation succeeds)' -AsSecureString
} else {
  $Encrypted = Get-Content -LiteralPath $CredFile -Raw
  $SecureKey = ConvertTo-SecureString $Encrypted
  Write-Host "Reusing existing DPAPI credential for profile $Profile."
}
$PlainKey = [System.Net.NetworkCredential]::new('', $SecureKey).Password
if ([string]::IsNullOrWhiteSpace($PlainKey)) { throw 'Runtime API key is empty.' }

try {
  $env:CONTROL_PLANE_API_KEY = $PlainKey
  if (-not $ProfileExists) {
    & $TunnelExe init --sample sample_mcp_remote_no_auth --profile $Profile --tunnel-id $TunnelId --mcp-server-url $McpUrl --health-listen-addr "127.0.0.1:$HealthPort" --force
    if ($LASTEXITCODE -ne 0) { throw "tunnel-client init failed: $LASTEXITCODE" }
    $ProfileCreated = $true
    $profileData = Read-ProfileData $ProfileFile
    if ($profileData.HealthPort -ne $HealthPort) { throw 'Created profile health port does not match requested value.' }
    if ($profileData.TunnelId -and $profileData.TunnelId -ne $TunnelId) { throw 'Created profile tunnel_id does not match requested value.' }
  }

  $running = Get-TunnelProcess $Profile $TunnelExe
  if ($running -and (Test-TunnelReady $HealthPort)) {
    Write-Host "Existing tunnel profile $Profile is already ready on health port $HealthPort; doctor bind check skipped."
  } else {
    & $TunnelExe doctor --profile $Profile --explain
    if ($LASTEXITCODE -ne 0) { throw "tunnel-client doctor failed: $LASTEXITCODE" }
  }

  if ($NewCredential) {
    $Encrypted = ConvertFrom-SecureString $SecureKey
    $tempCred = "$CredFile.tmp-$PID"
    [IO.File]::WriteAllText($tempCred, $Encrypted, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tempCred -Destination $CredFile -Force
    Write-Host "DPAPI credential committed for profile $Profile after successful validation."
  }
} catch {
  if ($ProfileCreated) { Remove-Item -LiteralPath $ProfileFile -Force -ErrorAction SilentlyContinue }
  throw
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
  $rootPattern = [regex]::Escape([IO.Path]::GetFullPath($Root))
  $existing = Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'autostart-windows\.ps1' -and $_.CommandLine -match $rootPattern } |
    Select-Object -First 1
  if (-not $existing) {
    Start-Process -FilePath $pwsh -ArgumentList @('-NoLogo','-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',$supervisor) -WindowStyle Hidden | Out-Null
  }
}

Write-Host ''
Write-Host "AUTOSTART_ENROLL_PASS profile=$Profile healthPort=$HealthPort credential=$CredFile"
Write-Host 'Windows logon autostart is enabled. No Tunnel ID, IP/port, or Runtime API key is required on later logons.'
