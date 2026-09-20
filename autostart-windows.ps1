param(
  [ValidateRange(2,300)][int]$IntervalSeconds = 5,
  [switch]$SelfTest,
  [string]$SelfTestProfile = ''
)
$ErrorActionPreference = 'Stop'
# Never inherit an isolated MCP config into the global supervisor. Primary startup
# uses the app's normal config selection; isolated instances set their config explicitly.
Remove-Item Env:REMOTE_COMMANDER_CONFIG -ErrorAction SilentlyContinue

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$VarDir = Join-Path $Root 'var'
$CredDir = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\credentials'
$ProfileDir = Join-Path $env:APPDATA 'tunnel-client'
$InstanceRoot = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\instances'
New-Item -ItemType Directory -Force -Path $VarDir,$CredDir,$InstanceRoot | Out-Null

function Write-SupervisorLog([string]$Message) {
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath (Join-Path $VarDir 'autostart.log') -Value $line -Encoding utf8
}

function Test-ProfileName([string]$Name) {
  return ($Name -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -and $Name -notmatch '\.\.' -and $Name -notin @('.','..'))
}

$created = $false
$mutex = $null
if (-not $SelfTest) {
  $mutex = [Threading.Mutex]::new($false, 'Local\ChatGPTRemoteCommanderSupervisor', [ref]$created)
  if (-not $created) { exit 0 }
}

function Get-McpHealth([int]$Port) {
  try { return Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2 }
  catch { return $null }
}

function Test-McpHealth([int]$Port,[string]$ExpectedConfigSha='',[string]$ExpectedProfile='') {
  $h = Get-McpHealth $Port
  if (-not $h -or -not $h.ok -or $h.name -ne 'chatgpt-remote-commander') { return $false }
  if ($ExpectedConfigSha -and [string]$h.configSha256 -ne $ExpectedConfigSha) { return $false }
  if ($ExpectedProfile -and [string]$h.instance.profile -ne $ExpectedProfile) { return $false }
  return $true
}

function Start-PrimaryMcp {
  if (Test-McpHealth 47831) { return }
  $listener = Get-NetTCPConnection -State Listen -LocalPort 47831 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) { throw 'Port 47831 is occupied but primary Remote Commander health is unavailable; refusing unknown process.' }
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  $out = Join-Path $VarDir 'mcp-autostart.out.log'
  $err = Join-Path $VarDir 'mcp-autostart.err.log'
  Start-Process -FilePath $npm -ArgumentList @('start','--silent') -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
  foreach ($i in 1..30) {
    Start-Sleep -Milliseconds 500
    if (Test-McpHealth 47831) { Write-SupervisorLog 'MCP_STARTED port=47831 profile=default'; return }
  }
  throw 'MCP_START_TIMEOUT port=47831'
}

function Find-TunnelExe {
  $stateFile = Join-Path $Root 'var\tunnel-client.json'
  if (-not (Test-Path -LiteralPath $stateFile -PathType Leaf)) {
    throw 'Pinned tunnel-client state missing; run install.ps1.'
  }

  $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  $exe = [IO.Path]::GetFullPath([string]$state.path)
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    throw 'Pinned tunnel-client executable missing.'
  }

  $actual = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne ([string]$state.sha256).ToLowerInvariant()) {
    throw 'Pinned tunnel-client SHA256 mismatch.'
  }

  return $exe
}

function CredentialPath([string]$Profile) {
  return Join-Path $CredDir "$Profile.dpapi"
}

function Get-ProfileHealthPort([string]$ProfileFile) {
  $text = Get-Content -LiteralPath $ProfileFile -Raw
  $match = [regex]::Match($text, 'listen_addr:\s*["'']?127\.0\.0\.1:(\d+)')
  if ($match.Success) { return [int]$match.Groups[1].Value }
  return 0
}

function Get-ProfileMcpPort([string]$ProfileFile) {
  $text = Get-Content -LiteralPath $ProfileFile -Raw
  $match = [regex]::Match($text, 'url:\s*["'']?http://127\.0\.0\.1:(\d+)/mcp')
  if ($match.Success) { return [int]$match.Groups[1].Value }
  return 0
}

function Get-InstanceRecord([string]$Profile) {
  if (-not (Test-ProfileName $Profile)) { throw "invalid instance profile $Profile" }
  $dir = Join-Path $InstanceRoot $Profile
  $recordFile = Join-Path $dir 'instance.json'
  if (-not (Test-Path -LiteralPath $recordFile -PathType Leaf)) { return $null }
  $record = Get-Content -LiteralPath $recordFile -Raw | ConvertFrom-Json
  if ([int]$record.schema -ne 1 -or $record.enabled -ne $true -or $record.isolated -ne $true -or [string]$record.profile -ne $Profile) { throw "invalid instance record $Profile" }
  $port = [int]$record.mcpPort
  if ($port -lt 1024 -or $port -gt 65535 -or $port -eq 47831) { throw "invalid instance port $Profile" }
  $expectedConfig = [IO.Path]::GetFullPath((Join-Path $dir 'config.json'))
  $actualConfig = [IO.Path]::GetFullPath([string]$record.configPath)
  if ($actualConfig -ne $expectedConfig -or -not (Test-Path -LiteralPath $actualConfig -PathType Leaf)) { throw "invalid instance config path $Profile" }
  $sha = (Get-FileHash -LiteralPath $actualConfig -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sha -ne [string]$record.configSha256) { throw "instance config hash mismatch $Profile" }
  $cfg = Get-Content -LiteralPath $actualConfig -Raw | ConvertFrom-Json
  if ([int]$cfg.port -ne $port -or [string]$cfg.instance.profile -ne $Profile -or $cfg.instance.isolated -ne $true) { throw "instance config identity mismatch $Profile" }
  return [pscustomobject]@{ Profile=$Profile; Port=$port; ConfigPath=$actualConfig; ConfigSha256=$sha; StateDir=$dir }
}

function Stop-OwnedMcpInstance($Instance, [int]$ListenerPid) {
  $markerFile = Join-Path $Instance.StateDir 'mcp-runtime.json'
  if (-not (Test-Path -LiteralPath $markerFile -PathType Leaf)) {
    throw "instance port $($Instance.Port) occupied without runtime marker; refusing to stop it"
  }
  $marker = Get-Content -LiteralPath $markerFile -Raw | ConvertFrom-Json
  $project = [IO.Path]::GetFullPath([string]$marker.projectDir)
  $expectedRoot = [IO.Path]::GetFullPath($Root)
  if ([int]$marker.pid -ne $ListenerPid -or [int]$marker.port -ne $Instance.Port -or
      [string]$marker.instance.profile -ne $Instance.Profile -or $project -ne $expectedRoot) {
    throw "instance listener ownership mismatch profile=$($Instance.Profile); refusing to stop it"
  }
  Stop-Process -Id $ListenerPid -Force -ErrorAction Stop
  foreach ($i in 1..20) {
    Start-Sleep -Milliseconds 250
    if (-not (Get-NetTCPConnection -State Listen -LocalPort $Instance.Port -ErrorAction SilentlyContinue)) { return }
  }
  throw "owned instance did not release port $($Instance.Port)"
}

function Start-McpInstance($Instance) {
  if (Test-McpHealth $Instance.Port $Instance.ConfigSha256 $Instance.Profile) { return }
  $listener = Get-NetTCPConnection -State Listen -LocalPort $Instance.Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    Stop-OwnedMcpInstance $Instance ([int]$listener.OwningProcess)
    Write-SupervisorLog "MCP_INSTANCE_RECYCLE profile=$($Instance.Profile) oldPid=$($listener.OwningProcess) port=$($Instance.Port)"
  }
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $server = Join-Path $Root 'src\server-v0.3.mjs'
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $node
  $psi.WorkingDirectory = $Root
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  [void]$psi.ArgumentList.Add($server)
  $psi.Environment['REMOTE_COMMANDER_CONFIG'] = $Instance.ConfigPath
  $process = [Diagnostics.Process]::Start($psi)
  foreach ($i in 1..40) {
    Start-Sleep -Milliseconds 500
    if (Test-McpHealth $Instance.Port $Instance.ConfigSha256 $Instance.Profile) {
      Write-SupervisorLog "MCP_INSTANCE_READY profile=$($Instance.Profile) pid=$($process.Id) port=$($Instance.Port)"
      return
    }
    if ($process.HasExited) { break }
  }
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  throw "instance MCP readiness failed profile=$($Instance.Profile)"
}
function Get-ManagedProfiles {
  if (-not (Test-Path -LiteralPath $ProfileDir)) { return @() }
  $items = @()
  foreach ($file in Get-ChildItem -LiteralPath $ProfileDir -Filter '*.yaml' -File -ErrorAction SilentlyContinue) {
    $profile = [IO.Path]::GetFileNameWithoutExtension($file.Name)
    if (-not (Test-ProfileName $profile)) { Write-SupervisorLog "PROFILE_SKIPPED_INVALID name=$profile"; continue }
    $mcpPort = Get-ProfileMcpPort $file.FullName
    if ($mcpPort -le 0) { continue }
    $instance = if ($mcpPort -eq 47831) { $null } else { Get-InstanceRecord $profile }
    if ($mcpPort -ne 47831 -and (-not $instance -or $instance.Port -ne $mcpPort)) { throw "profile instance missing/mismatched $profile" }
    $items += [pscustomobject]@{
      Profile=$profile
      File=$file.FullName
      Credential=(CredentialPath $profile)
      HealthPort=(Get-ProfileHealthPort $file.FullName)
      McpPort=$mcpPort
      Instance=$instance
    }
  }
  return $items
}

function Test-TunnelReady([int]$Port) {
  if ($Port -le 0) {
    return $false
  }

  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/readyz" -UseBasicParsing -TimeoutSec 2
    return ($response.StatusCode -eq 200 -and $response.Content.Trim() -eq 'ready')
  } catch {
    return $false
  }
}

function Get-TunnelProcess([string]$Profile, [string]$Exe) {
  $expected = [IO.Path]::GetFullPath($Exe)
  $escaped = [regex]::Escape($Profile)
  $profileRegex = '--profile(?:=|\s+)["'']?' + $escaped + '["'']?(?:\s|$)'

  return Get-CimInstance Win32_Process -Filter "Name='tunnel-client.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ExecutablePath -and
      [IO.Path]::GetFullPath([string]$_.ExecutablePath) -eq $expected -and
      $_.CommandLine -match $profileRegex
    } |
    Select-Object -First 1
}

function Start-TunnelProfile($Item) {
  if (-not (Test-Path -LiteralPath $Item.Credential -PathType Leaf)) {
    throw "credential not enrolled for profile $($Item.Profile)"
  }
  if ($Item.HealthPort -le 0) {
    throw "profile $($Item.Profile) has no valid loopback health port"
  }

  $exe = Find-TunnelExe
  $existing = Get-TunnelProcess $Item.Profile $exe
  if ($existing) {
    if (Test-TunnelReady $Item.HealthPort) {
      return
    }
    throw "profile $($Item.Profile) process exists but readiness failed"
  }

  $encrypted = Get-Content -LiteralPath $Item.Credential -Raw
  $secure = ConvertTo-SecureString $encrypted
  $plain = [System.Net.NetworkCredential]::new('', $secure).Password

  try {
    if ([string]::IsNullOrWhiteSpace($plain)) {
      throw 'decrypted credential is empty'
    }

    $log = Join-Path $VarDir ("tunnel-{0}.log" -f $Item.Profile)
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $exe
    $psi.WorkingDirectory = $Root
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    [void]$psi.ArgumentList.Add('run')
    [void]$psi.ArgumentList.Add('--profile')
    [void]$psi.ArgumentList.Add($Item.Profile)
    [void]$psi.ArgumentList.Add('--profile-dir')
    [void]$psi.ArgumentList.Add($ProfileDir)
    [void]$psi.ArgumentList.Add('--log.file')
    [void]$psi.ArgumentList.Add($log)
    $psi.Environment['CONTROL_PLANE_API_KEY'] = $plain
    [void]$psi.Environment.Remove('OPENAI_API_KEY')

    $process = [Diagnostics.Process]::Start($psi)
    $ready = $false
    foreach ($i in 1..40) {
      Start-Sleep -Milliseconds 500
      if (Test-TunnelReady $Item.HealthPort) {
        $ready = $true
        break
      }
      if ($process.HasExited) {
        break
      }
    }

    if (-not $ready) {
      if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      }
      throw "tunnel readiness failed for profile $($Item.Profile)"
    }

    Write-SupervisorLog "TUNNEL_READY profile=$($Item.Profile) pid=$($process.Id) port=$($Item.HealthPort)"
  } finally {
    $plain = $null
    $secure = $null
  }
}

. (Join-Path $Root 'supervisor-routing.ps1')

if ($SelfTest) {
  $profiles = @(Get-ManagedProfiles | ForEach-Object { [pscustomobject]@{ profile=$_.Profile; mcpPort=$_.McpPort; healthPort=$_.HealthPort; isolated=[bool]$_.Instance } })
  $instance = $null
  if ($SelfTestProfile) {
    if (-not (Test-ProfileName $SelfTestProfile)) { throw 'Invalid SelfTestProfile.' }
    $instance = Get-InstanceRecord $SelfTestProfile
  }
  $routes=@(); foreach($p in @('default')+@($profiles.profile)){try{$r=Get-RouteState $p;if($r){$routes+=[pscustomobject]@{profile=$p;generation=$r.State.generation;active=$r.Active}}}catch{}}; [pscustomobject]@{ ok=$true; profiles=$profiles; instance=$instance; routes=$routes; autoUpdateScript=(Test-Path (Join-Path $Root 'auto-update-windows.ps1')) } | ConvertTo-Json -Depth 8 -Compress
  exit 0
}

$missingLogged = @{}
try {
  Write-SupervisorLog "SUPERVISOR_STARTED pid=$PID root=$Root"

  while ($true) {
    try {
      if (-not (Ensure-RoutedProfile 'default' 47831)) { Start-PrimaryMcp }
      $exe = Find-TunnelExe
      foreach ($item in Get-ManagedProfiles) {
        if ($item.Instance) { if (-not (Ensure-RoutedProfile $item.Profile $item.McpPort)) { Start-McpInstance $item.Instance } }
        elseif (-not (Test-McpHealth 47831)) { throw 'primary MCP unavailable' }

        if (-not (Test-Path -LiteralPath $item.Credential -PathType Leaf)) {
          if (-not $missingLogged.ContainsKey($item.Profile)) {
            Write-SupervisorLog "CREDENTIAL_MISSING profile=$($item.Profile)"
            $missingLogged[$item.Profile] = $true
          }
          continue
        }
        [void]$missingLogged.Remove($item.Profile)
        $process = Get-TunnelProcess $item.Profile $exe
        if (-not $process -or -not (Test-TunnelReady $item.HealthPort)) { Start-TunnelProfile $item }
      }
      Start-AutoUpdateIfDue
    } catch {
      Write-SupervisorLog "SUPERVISOR_ITERATION_ERROR $($_.Exception.Message)"
    }

    Start-Sleep -Seconds $IntervalSeconds
  }
} finally {
  Write-SupervisorLog 'SUPERVISOR_STOPPED'
  if ($created -and $mutex) {
    try { $mutex.ReleaseMutex() } catch {}
  }
  if ($mutex) { $mutex.Dispose() }
}
