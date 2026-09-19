param(
  [ValidateRange(2,300)][int]$IntervalSeconds = 5
)
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$VarDir = Join-Path $Root 'var'
$CredDir = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\credentials'
$ProfileDir = Join-Path $env:APPDATA 'tunnel-client'
New-Item -ItemType Directory -Force -Path $VarDir,$CredDir | Out-Null

function Write-SupervisorLog([string]$Message) {
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath (Join-Path $VarDir 'autostart.log') -Value $line -Encoding utf8
}

function Test-ProfileName([string]$Name) {
  return ($Name -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -and $Name -notmatch '\.\.' -and $Name -notin @('.','..'))
}

$created = $false
$mutex = [Threading.Mutex]::new($false, 'Local\ChatGPTRemoteCommanderSupervisor', [ref]$created)
if (-not $created) {
  exit 0
}

function Test-McpHealth {
  try {
    $health = Invoke-RestMethod 'http://127.0.0.1:47831/health' -TimeoutSec 2
    return [bool]($health.ok -and $health.name -eq 'chatgpt-remote-commander')
  } catch {
    return $false
  }
}

function Start-McpServer {
  if (Test-McpHealth) {
    return
  }

  $listener = Get-NetTCPConnection -State Listen -LocalPort 47831 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    throw 'Port 47831 is occupied but Remote Commander health is unavailable; supervisor will not stop an unknown process.'
  }

  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  $out = Join-Path $VarDir 'mcp-autostart.out.log'
  $err = Join-Path $VarDir 'mcp-autostart.err.log'

  Start-Process -FilePath $npm -ArgumentList @('start','--silent') -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null

  foreach ($i in 1..30) {
    Start-Sleep -Milliseconds 500
    if (Test-McpHealth) {
      Write-SupervisorLog 'MCP_STARTED'
      return
    }
  }

  throw 'MCP_START_TIMEOUT'
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
  if ($match.Success) {
    return [int]$match.Groups[1].Value
  }
  return 0
}

function Get-ManagedProfiles {
  if (-not (Test-Path -LiteralPath $ProfileDir)) {
    return @()
  }

  $items = @()
  foreach ($file in Get-ChildItem -LiteralPath $ProfileDir -Filter '*.yaml' -File -ErrorAction SilentlyContinue) {
    $text = Get-Content -LiteralPath $file.FullName -Raw
    if ($text -notmatch 'http://127\.0\.0\.1:47831/mcp') {
      continue
    }

    $profile = [IO.Path]::GetFileNameWithoutExtension($file.Name)
    if (-not (Test-ProfileName $profile)) {
      Write-SupervisorLog "PROFILE_SKIPPED_INVALID name=$profile"
      continue
    }

    $items += [pscustomobject]@{
      Profile = $profile
      File = $file.FullName
      Credential = CredentialPath $profile
      HealthPort = Get-ProfileHealthPort $file.FullName
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

$missingLogged = @{}
try {
  Write-SupervisorLog "SUPERVISOR_STARTED pid=$PID root=$Root"

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
          $process = Get-TunnelProcess $item.Profile $exe
          if (-not $process -or -not (Test-TunnelReady $item.HealthPort)) {
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
  if ($created) {
    try {
      $mutex.ReleaseMutex()
    } catch {
    }
  }
  $mutex.Dispose()
}
