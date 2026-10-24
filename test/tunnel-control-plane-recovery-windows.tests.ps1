$ErrorActionPreference='Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'tools\tunnel-control-plane-recovery-windows.ps1')
$now=[DateTimeOffset]::Parse('2026-10-24T10:00:00Z')
$age=$now.AddSeconds(-121)
$short=$now.AddSeconds(-119)
$pass=0
function Check($actual,$expected,$label) {if($actual -ne $expected){throw "FAIL:$label expected=$expected actual=$actual"};$script:pass++}
Check (Test-RcTunnelRecoveryDecision 'ok' 'http_error' 403 $age $now @()) $false 'ok'
Check (Test-RcTunnelRecoveryDecision 'degraded' 'http_error' 403 $short $now @()) $false 'transient'
Check (Test-RcTunnelRecoveryDecision 'degraded' 'http_error' 403 $age $now @()) $true '403'
Check (Test-RcTunnelRecoveryDecision 'degraded' 'network_error' 0 $age $now @()) $true 'network'
Check (Test-RcTunnelRecoveryDecision 'degraded' 'auth_error' 403 $age $now @()) $false 'auth'
Check (Test-RcTunnelRecoveryDecision 'degraded' 'http_error' 401 $age $now @()) $false '401'
Check (Test-RcTunnelRecoveryDecision 'degraded' 'http_error' 403 $age $now @($now.AddMinutes(-10).ToString('o'))) $false 'cooldown'
Check (Test-RcTunnelRecoveryDecision 'degraded' 'http_error' 403 $age $now @($now.AddMinutes(-17).ToString('o'))) $true 'cooldown_expired'
Check (Test-RcTunnelRecoveryDecision 'degraded' 'http_error' 403 $age $now @($now.AddMinutes(-16).ToString('o'),$now.AddMinutes(-35).ToString('o'),$now.AddMinutes(-65).ToString('o'))) $false 'max_retries'
Check (Test-RcTunnelRecoveryDecision 'degraded' 'http_error' 403 $age $now @('invalid')) $false 'corrupt_timestamp'
Check (Test-RcTunnelRecoveryDecision 'degraded' 'http_error' 403 $age $now @($now.AddMinutes(1).ToString('o'))) $false 'future_timestamp'
$temp=Join-Path $env:TEMP ("rc-recovery-"+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $temp | Out-Null
try {
  Save-RcTunnelRecoveryAttempts $temp 'test' @($now.ToString('o'))
  Check (@(Get-RcTunnelRecoveryAttempts $temp 'test').Count) 1 'persist'
  Check (Test-RcTunnelRecoveryOwnership ([pscustomobject]@{ProcessId=0}) 'none' 'none' 47832) $false 'bad_pid'
} finally {Remove-Item $temp -Recurse -Force}
$exe=Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\app\tools\tunnel-client-v0.0.15-windows-amd64\tunnel-client.exe'
$p=@(Get-Process tunnel-client -ErrorAction SilentlyContinue | Where-Object{$_.Path -eq $exe})
if($p.Count -eq 1) {
  $proc=Get-CimInstance Win32_Process -Filter ("ProcessId="+$p[0].Id)
  Check (Test-RcTunnelRecoveryOwnership $proc $exe 'chatgpt-remote-commander' 47832) $true 'owned_tunnel'
  Check (Test-RcTunnelRecoveryOwnership $proc $exe 'wrongprofile' 47832) $false 'wrong_profile'
  Check (Test-RcTunnelRecoveryOwnership $proc $exe 'chatgpt-remote-commander' 47833) $false 'wrong_port'
}
"PASS=$pass"
