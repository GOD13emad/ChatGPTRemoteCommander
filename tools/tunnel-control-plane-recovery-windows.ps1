# Bounded, fail-closed recovery of a live Tunnel whose Control Plane is degraded.
# Readiness alone is insufficient: /readyz may stay healthy after VPN reconnect.
function Test-RcTunnelRecoveryDecision {
  param(
    [string]$Status, [string]$Category, [int]$HttpStatus,
    [DateTimeOffset]$FirstSeenUtc, [DateTimeOffset]$NowUtc,
    [string[]]$AttemptsUtc = @()
  )
  if ($Status -ne 'degraded') { return $false }
  $recoverable = ($Category -in @('network_error', 'timeout', 'transport_error')) -or
    ($Category -eq 'http_error' -and $HttpStatus -eq 403)
  if (-not $recoverable -or ($NowUtc - $FirstSeenUtc).TotalSeconds -lt 120) { return $false }
  $recent = @()
  foreach ($entry in $AttemptsUtc) {
    $when = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$entry, [ref]$when)) { return $false }
    if ($when -gt $NowUtc) { return $false }
    if (($NowUtc - $when).TotalHours -lt 2) { $recent += $when }
  }
  if ($recent.Count -ge 3) { return $false }
  if ($recent.Count -gt 0) {
    $latest = @($recent | Sort-Object -Descending)[0]
    if (($NowUtc - $latest).TotalMinutes -lt 15) { return $false }
  }
  return $true
}
function Get-RcTunnelRecoveryAttempts {
  param([string]$Folder, [string]$Profile)
  if ($Profile -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') { throw 'TUNNEL_RECOVERY_INVALID_PROFILE' }
  $file = Join-Path $Folder ("tunnel-recovery-{0}.json" -f $Profile)
  if (-not (Test-Path -LiteralPath $file)) { return @() }
  $info = Get-Item -LiteralPath $file -Force -ErrorAction Stop
  if (($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $info.Length -gt 8192 -or $info.Length -lt 2) {
    throw 'TUNNEL_RECOVERY_STATE_UNTRUSTED'
  }
  $json = Get-Content -LiteralPath $file -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  if ($json.schema -ne 1 -or $null -eq $json.attemptsUtc -or @($json.attemptsUtc).Count -gt 12) {
    throw 'TUNNEL_RECOVERY_STATE_INVALID'
  }
  return @($json.attemptsUtc | ForEach-Object { [string]$_ })
}
function Save-RcTunnelRecoveryAttempts {
  param([string]$Folder, [string]$Profile, [string[]]$AttemptsUtc)
  $file = Join-Path $Folder ("tunnel-recovery-{0}.json" -f $Profile)
  if (Test-Path -LiteralPath $file) {
    $info = Get-Item -LiteralPath $file -Force
    if ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'TUNNEL_RECOVERY_STATE_UNTRUSTED' }
  }
  $temp = Join-Path $Folder ("tunnel-recovery-{0}.{1}.tmp" -f $Profile, $PID)
  $obj = @{ schema = 1; attemptsUtc = @($AttemptsUtc | Select-Object -Last 12) }
  try {
    [IO.File]::WriteAllText($temp, ($obj | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temp -Destination $file -Force
  } finally { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
}
function Test-RcTunnelRecoveryOwnership {
  param([object]$Process, [string]$Exe, [string]$Profile, [int]$HealthPort)
  $pidNumber = [int]$Process.ProcessId
  if ($pidNumber -le 0 -or $HealthPort -lt 1024 -or $HealthPort -gt 65535) { return $false }
  try {
    $live = Get-Process -Id $pidNumber -ErrorAction Stop
    $actualExe = [IO.Path]::GetFullPath([string]$live.Path)
    $expectedExe = [IO.Path]::GetFullPath($Exe)
    if ($actualExe -ne $expectedExe -or [string]$Process.ExecutablePath -ne $expectedExe) { return $false }
    $escaped = [regex]::Escape($Profile)
    $profilePattern = '--profile(?:=|\s+)["'']?' + $escaped + '["'']?(?:\s|$)'
    if ([string]$Process.CommandLine -notmatch $profilePattern) { return $false }
    $listeners = @(Get-NetTCPConnection -LocalPort $HealthPort -State Listen -ErrorAction Stop)
    if ($listeners.Count -ne 1) { return $false }
    $listener = $listeners[0]
    if ([int]$listener.OwningProcess -ne $pidNumber -or
        [string]$listener.LocalAddress -notin @('127.0.0.1', '::1')) { return $false }
    return $true
  } catch { return $false }
}
$script:TunnelRecoveryTrack = @{}
function Try-RecoverTunnelControlPlane([object]$Item,[object]$Process,[bool]$Ready,[string]$Exe,[object]$Probe) {
  if ($null -eq $Probe) { return }
  $profile = [string]$Item.Profile
  if ($Probe.status -eq 'ok') {
    [void]$script:TunnelRecoveryTrack.Remove($profile)
    return
  }
  if ($Probe.status -ne 'degraded' -or -not $Process -or -not $Ready) {
    [void]$script:TunnelRecoveryTrack.Remove($profile)
    return
  }
  $pidNumber = [int]$Process.ProcessId
  $fingerprint = "$($Probe.category)/$($Probe.http)"
  $now = [DateTimeOffset]::UtcNow
  $track = $script:TunnelRecoveryTrack[$profile]
  if (-not $track -or $track.pid -ne $pidNumber -or $track.kind -ne $fingerprint) {
    $script:TunnelRecoveryTrack[$profile] = [pscustomobject]@{ pid=$pidNumber; kind=$fingerprint; since=$now }
    return
  }
  $attempts = @(Get-RcTunnelRecoveryAttempts $VarDir $profile)
  $shouldRestart = Test-RcTunnelRecoveryDecision -Status ([string]$Probe.status) -Category ([string]$Probe.category) -HttpStatus ([int]$Probe.http) -FirstSeenUtc ([DateTimeOffset]$track.since) -NowUtc $now -AttemptsUtc $attempts
  if (-not $shouldRestart) { return }
  try {
    $confirm = Invoke-RestMethod "http://127.0.0.1:$($Item.HealthPort)/health/control-plane" -TimeoutSec 2 -ErrorAction Stop
    if ($confirm.status -ne 'degraded' -or [string]$confirm.details.failure_category -ne [string]$Probe.category -or [int]$confirm.details.http_status -ne [int]$Probe.http) { return }
  } catch { return }
  if (-not (Test-RcTunnelRecoveryOwnership $Process $Exe $profile ([int]$Item.HealthPort))) {
    Write-SupervisorLog "TUNNEL_CONTROL_PLANE_RECOVERY_SKIPPED profile=$profile reason=OWNER_UNVERIFIED"
    [void]$script:TunnelRecoveryTrack.Remove($profile)
    return
  }
  $recent = @($attempts | Where-Object { ($now - [DateTimeOffset]::Parse($_)).TotalHours -lt 2 })
  Save-RcTunnelRecoveryAttempts $VarDir $profile @($recent + $now.ToString('o'))
  Write-SupervisorLog "TUNNEL_CONTROL_PLANE_RESTART_REQUESTED profile=$profile pid=$pidNumber category=$($Probe.category) http=$($Probe.http)"
  Stop-Process -Id $pidNumber -ErrorAction Stop
  [void]$script:TunnelRecoveryTrack.Remove($profile)
}
