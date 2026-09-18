param(
  [ValidateRange(2,300)][int]$IntervalSeconds = 5
)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$VarDir = Join-Path $Root 'var'
$CredDir = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\credentials'
$ProfileDir = Join-Path $env:APPDATA 'tunnel-client'
New-Item -ItemType Directory -Force -Path $VarDir,$CredDir | Out-Null

function Write-SupervisorLog([string]$Message) {
  Add-Content -LiteralPath (Join-Path $VarDir 'autostart.log') -Value "$(Get-Date -Format o) $Message" -Encoding utf8
}

$created = $false
$mutexName = 'Local\ChatGPTRemoteCommanderSupervisor-' + ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Root.ToLowerInvariant())))).Substring(0,16)
$mutex = [Threading.Mutex]::new($false, $mutexName, [ref]$created)
if (-not $created) { exit 0 }

function Assert-ProfileName([string]$Name) {
  if ($Name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') { throw "Invalid managed profile name: $Name" }
}

function Get-StringSha256([string]$Value) {
  return ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Value)))).ToLowerInvariant()
}

function Get-ExpectedMcpIdentity {
  $configPath = if (Test-Path -LiteralPath (Join-Path $Root 'config.local.json')) { Join-Path $Root 'config.local.json' } else { Join-Path $Root 'config.json' }
  return [pscustomobject]@{
    InstanceId = (Get-StringSha256 $Root.ToLowerInvariant()).Substring(0,24)
    ConfigSha256 = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Version = (Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
  }
}

function Get-McpHealth {
  try { return Invoke-RestMethod 'http://127.0.0.1:47831/health' -TimeoutSec 2 } catch { return $null }
}

function Test-McpHealth {
  $health = Get-McpHealth
  if (-not $health -or -not $health.ok) { return $false }
  $expected = Get-ExpectedMcpIdentity
  return ($health.instanceId -eq $expected.InstanceId -and $health.version -eq $expected.Version -and $health.configSha256 -eq $expected.ConfigSha256)
}

function Start-McpServer {
  if (Test-McpHealth) { return }

  $listener = Get-NetTCPConnection -State Listen -LocalPort 47831 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $health = Get-McpHealth
    if ($health) {
      Write-SupervisorLog "MCP_IDENTITY_MISMATCH expected=$((Get-ExpectedMcpIdentity).InstanceId) actual=$($health.instanceId)"
    } else {
      Write-SupervisorLog "MCP_PORT_OCCUPIED pid=$($listener.OwningProcess)"
    }
    return
  }

  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  $out = Join-Path $VarDir 'mcp-autostart.out.log'
  $err = Join-Path $VarDir 'mcp-autostart.err.log'
  Start-Process -FilePath $npm -ArgumentList @('start','--silent') -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null

  foreach ($i in 1..30) {
    Start-Sleep -Milliseconds 500
    if (Test-McpHealth) { Write-SupervisorLog 'MCP_STARTED'; return }
  }
  Write-SupervisorLog 'MCP_START_TIMEOUT'
}

function Find-TunnelExe {
  $manifestPath = Join-Path $Root 'tools\tunnel-client.active.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Pinned tunnel-client manifest is missing.' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $candidate = [IO.Path]::GetFullPath((Join-Path $Root ([string]$manifest.relativePath)))
  if (-not $candidate.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) { throw 'Pinned tunnel-client path escapes install root.' }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw 'Pinned tunnel-client executable is missing.' }
  $actual = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne ([string]$manifest.sha256).ToLowerInvariant()) { throw 'Pinned tunnel-client hash mismatch.' }
  return $candidate
}

function CredentialPath([string]$Profile) {
  Assert-ProfileName $Profile
  return Join-Path $CredDir "$Profile.dpapi"
}

function Get-ProfileHealthPort([string]$ProfileFile) {
  $text = Get-Content -LiteralPath $ProfileFile -Raw
  $m = [regex]::Match($text, 'listen_addr:\s*["'']?127\.0\.0\.1:(\d+)')
  if (-not $m.Success) { return 0 }
  return [int]$m.Groups[1].Value
}

function Get-ManagedProfiles {
  if (-not (Test-Path $ProfileDir)) { return @() }
  $items = @()
  foreach ($f in Get-ChildItem $ProfileDir -Filter '*.yaml' -File -ErrorAction SilentlyContinue) {
    $profile = [IO.Path]::GetFileNameWithoutExtension($f.Name)
    try { Assert-ProfileName $profile } catch { Write-SupervisorLog "PROFILE_REJECTED file=$($f.Name)"; continue }
    $text = Get-Content -LiteralPath $f.FullName -Raw
    if ($text -notmatch 'http://127\.0\.0\.1:47831/mcp') { continue }
    $healthPort = Get-ProfileHealthPort $f.FullName
    if ($healthPort -lt 1) { Write-SupervisorLog "PROFILE_HEALTH_PORT_INVALID profile=$profile"; continue }
    $items += [pscustomobject]@{
      Profile = $profile
      File = $f.FullName
      Credential = CredentialPath $profile
      HealthPort = $healthPort
    }
  }
  return $items
}

function Get-TunnelProcess([string]$Profile, [string]$Exe) {
  Assert-ProfileName $Profile
  $escaped = [regex]::Escape($Profile)
  $exeFull = [IO.Path]::GetFullPath($Exe)
  return Get-CimInstance Win32_Process -Filter "Name='tunnel-client.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ExecutablePath -and
      [IO.Path]::GetFullPath([string]$_.ExecutablePath) -eq $exeFull -and
      $_.CommandLine -match ('run\s+--profile\s+(?:"{0}"|{0})(?:\s|$)' -f $escaped)
    } |
    Select-Object -First 1
}

function Test-TunnelReady([int]$Port) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/readyz" -UseBasicParsing -TimeoutSec 2
    return ($response.StatusCode -eq 200 -and $response.Content.Trim() -eq 'ready')
  } catch { return $false }
}

function Start-TunnelProfile($Item, [string]$Exe) {
  if (-not (Test-Path -LiteralPath $Item.Credential -PathType Leaf)) { throw "credential not enrolled for profile $($Item.Profile)" }
  $encrypted = Get-Content -LiteralPath $Item.Credential -Raw
  $secure = ConvertTo-SecureString $encrypted
  $plain = [System.Net.NetworkCredential]::new('', $secure).Password
  try {
    if ([string]::IsNullOrWhiteSpace($plain)) { throw 'decrypted credential is empty' }
    $log = Join-Path $VarDir ("tunnel-{0}.log" -f $Item.Profile)
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $Exe
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

    for ($i=1; $i -le 30; $i++) {
      Start-Sleep -Milliseconds 500
      if (Test-TunnelReady $Item.HealthPort) {
        Write-SupervisorLog "TUNNEL_STARTED profile=$($Item.Profile) pid=$($p.Id)"
        return
      }
      if ($p.HasExited) { throw "tunnel-client exited early for profile $($Item.Profile)" }
    }
    try { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } } catch { }
    throw "tunnel readiness timeout for profile $($Item.Profile)"
  } finally {
    $plain = $null
    $secure = $null
  }
}

$missingLogged = @{}
$notReadySince = @{}
try {
  Write-SupervisorLog "SUPERVISOR_STARTED pid=$PID rootHash=$((Get-ExpectedMcpIdentity).InstanceId)"
  while ($true) {
    try {
      Start-McpServer
      if (Test-McpHealth) {
        $exe = Find-TunnelExe
        foreach ($item in Get-ManagedProfiles) {
          if (-not (Test-Path -LiteralPath $item.Credential -PathType Leaf)) {
            if (-not $missingLogged.ContainsKey($item.Profile)) {
              Write-SupervisorLog "CREDENTIAL_MISSING profile=$($item.Profile)"
              $missingLogged[$item.Profile] = $true
            }
            continue
          }

          [void]$missingLogged.Remove($item.Profile)
          $proc = Get-TunnelProcess $item.Profile $exe
          if ($proc -and (Test-TunnelReady $item.HealthPort)) {
            [void]$notReadySince.Remove($item.Profile)
            continue
          }

          if ($proc) {
            if (-not $notReadySince.ContainsKey($item.Profile)) { $notReadySince[$item.Profile] = [DateTime]::UtcNow }
            $age = ([DateTime]::UtcNow - $notReadySince[$item.Profile]).TotalSeconds
            if ($age -lt 30) { continue }
            Write-SupervisorLog "TUNNEL_STUCK_RESTART profile=$($item.Profile) pid=$($proc.ProcessId)"
            Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
            [void]$notReadySince.Remove($item.Profile)
          }

          Start-TunnelProfile $item $exe
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
