param(
  [ValidateRange(2,300)][int]$IntervalSeconds = 5
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$VarDir = Join-Path $Root 'var'
$CredDir = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\credentials'
$ProfileDir = Join-Path $env:APPDATA 'tunnel-client'
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
New-Item -ItemType Directory -Force -Path $VarDir,$CredDir | Out-Null

function Write-SupervisorLog([string]$Message) {
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath (Join-Path $VarDir 'autostart.log') -Value $line -Encoding utf8
}

$created = $false
$mutex = [Threading.Mutex]::new($false, 'Local\ChatGPTRemoteCommanderSupervisor', [ref]$created)
if (-not $created) { exit 0 }

function Test-McpHealth {
  try {
    $h = Invoke-RestMethod 'http://127.0.0.1:47831/health' -TimeoutSec 2
    return [bool]$h.ok
  } catch { return $false }
}
function Start-McpServer {
  if (Test-McpHealth) { return }
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  $out = Join-Path $VarDir 'mcp-autostart.out.log'
  $err = Join-Path $VarDir 'mcp-autostart.err.log'
  Start-Process -FilePath $npm -ArgumentList @('start','--silent') `
    -WorkingDirectory $Root -WindowStyle Hidden `
    -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
  foreach ($i in 1..30) {
    Start-Sleep -Milliseconds 500
    if (Test-McpHealth) {
      Write-SupervisorLog 'MCP_STARTED'
      return
    }
  }
  Write-SupervisorLog 'MCP_START_TIMEOUT'
}

function Find-TunnelExe {
  $bundled = Get-ChildItem (Join-Path $Root 'tools') -Filter 'tunnel-client.exe' -File -Recurse -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if ($bundled) { return $bundled.FullName }
  $cmd = Get-Command tunnel-client -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw 'tunnel-client not found'
}

function CredentialPath([string]$Profile) {
  $safe = $Profile -replace '[^A-Za-z0-9._-]','_'
  return Join-Path $CredDir "$safe.dpapi"
}
function Get-ProfileHealthPort([string]$ProfileFile) {
  $text = Get-Content -LiteralPath $ProfileFile -Raw
  $m = [regex]::Match($text, 'listen_addr:\s*["'']?127\.0\.0\.1:(\d+)')
  if ($m.Success) { return [int]$m.Groups[1].Value }
  return 0
}

function Get-ManagedProfiles {
  if (-not (Test-Path $ProfileDir)) { return @() }
  $items = @()
  foreach ($f in Get-ChildItem $ProfileDir -Filter '*.yaml' -File -ErrorAction SilentlyContinue) {
    $text = Get-Content -LiteralPath $f.FullName -Raw
    if ($text -notmatch 'http://127\.0\.0\.1:47831/mcp') { continue }
    $profile = [IO.Path]::GetFileNameWithoutExtension($f.Name)
    $cred = CredentialPath $profile
    $items += [pscustomobject]@{
      Profile = $profile
      File = $f.FullName
      Credential = $cred
      HealthPort = Get-ProfileHealthPort $f.FullName
    }
  }
  return $items
}

function TunnelProcessExists([string]$Profile) {
  $escaped = [regex]::Escape($Profile)
  return [bool](Get-CimInstance Win32_Process -Filter "Name='tunnel-client.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "run\s+--profile\s+$escaped(?:\s|$)" } |
    Select-Object -First 1)
}
function Start-TunnelProfile($Item) {
  if (-not (Test-Path -LiteralPath $Item.Credential)) {
    throw "credential not enrolled for profile $($Item.Profile)"
  }
  if (TunnelProcessExists $Item.Profile) { return }
  $encrypted = Get-Content -LiteralPath $Item.Credential -Raw
  $secure = ConvertTo-SecureString $encrypted
  $plain = [System.Net.NetworkCredential]::new('', $secure).Password
  try {
    if ([string]::IsNullOrWhiteSpace($plain)) { throw 'decrypted credential is empty' }
    $exe = Find-TunnelExe
    $log = Join-Path $VarDir ("tunnel-{0}.log" -f ($Item.Profile -replace '[^A-Za-z0-9._-]','_'))
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $exe
    $psi.WorkingDirectory = $Root
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    [void]$psi.ArgumentList.Add('run')
    [void]$psi.ArgumentList.Add('--profile')
    [void]$psi.ArgumentList.Add($Item.Profile)
    [void]$psi.ArgumentList.Add('--log.file')
    [void]$psi.ArgumentList.Add($log)
    $psi.Environment['CONTROL_PLANE_API_KEY'] = $plain
    [void]$psi.Environment.Remove('OPENAI_API_KEY')
    $p = [Diagnostics.Process]::Start($psi)
    Write-SupervisorLog "TUNNEL_STARTED profile=$($Item.Profile) pid=$($p.Id)"
  } finally {
    $plain = $null
    $secure = $null
  }
}
$missingLogged = @{}
try {
  Write-SupervisorLog "SUPERVISOR_STARTED pid=$PID root=$Root"
  while ($true) {
    try {
      Start-McpServer
      if (Test-McpHealth) {
        foreach ($item in Get-ManagedProfiles) {
          if (-not (Test-Path -LiteralPath $item.Credential)) {
            if (-not $missingLogged.ContainsKey($item.Profile)) {
              Write-SupervisorLog "CREDENTIAL_MISSING profile=$($item.Profile)"
              $missingLogged[$item.Profile] = $true
            }
            continue
          }
          $missingLogged.Remove($item.Profile)
          if (-not (TunnelProcessExists $item.Profile)) {
            Start-TunnelProfile $item
          }
        }
      }
    } catch {
      Write-SupervisorLog "SUPERVISOR_ITERATION_ERROR $($_.Exception.Message)"
    }
    Start-Sleep -Seconds $IntervalSeconds
  }
} finally {
  Write-SupervisorLog 'SUPERVISOR_STOPPED'
  if ($created) { try { $mutex.ReleaseMutex() } catch {} }
  $mutex.Dispose()
}
