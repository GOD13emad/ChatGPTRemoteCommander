param(
  [string]$OwnerUserProfile = 'C:\Users\Aa.Emad',
  [ValidateRange(30,900)][int]$WaitSeconds = 300
)
$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $MyInvocation.MyCommand.Path
$OwnerUserProfile=[IO.Path]::GetFullPath($OwnerUserProfile)
$OwnerLocal=Join-Path $OwnerUserProfile 'AppData\Local'
$OwnerRoaming=Join-Path $OwnerUserProfile 'AppData\Roaming'
$VarDir=Join-Path $Root 'var'
$ProfileDir=Join-Path $OwnerRoaming 'tunnel-client'
$log=Join-Path $VarDir 'boot-handoff.log'
New-Item -ItemType Directory -Force -Path $VarDir | Out-Null

function Write-HandoffLog([string]$Message){
  Add-Content -LiteralPath $log -Value ("$(Get-Date -Format o) $Message") -Encoding utf8
}
function Test-SystemOwner($Process){
  try {
    $owner=Invoke-CimMethod -InputObject $Process -MethodName GetOwner -ErrorAction Stop
    return ([string]$owner.User -ieq 'SYSTEM')
  } catch { return $false }
}
function Get-CommanderBusy {
  try {
    $body=@{jsonrpc='2.0';id=1;method='tools/call';params=@{name='system_status';arguments=@{}}}|ConvertTo-Json -Depth 8 -Compress
    $r=Invoke-RestMethod -Uri 'http://127.0.0.1:47831/mcp' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 3
    $s=$r.result.structuredContent
    if($r.result.isError -or -not$s -or -not$s.concurrency -or
       ($null -eq $s.concurrency.activeOperations) -or ($null -eq $s.concurrency.queued) -or -not$s.durableWorkflows -or
       -not$s.durableWorkflows.schedulerState -or
       $null -eq $s.durableWorkflows.schedulerState.currentLeases){
      throw 'HANDOFF_BUSY_STATE_UNVERIFIED'
    }
    $active=[int]$s.concurrency.activeOperations
    $queued=[int]$s.concurrency.queued
    $leases=[int]$s.durableWorkflows.schedulerState.currentLeases
    if($active -lt 0 -or $queued -lt 0 -or $leases -lt 0){throw 'HANDOFF_BUSY_STATE_INVALID'}
    foreach($tool in @('gui_status','browser_status')){
      $probeBody=@{jsonrpc='2.0';id=2;method='tools/call';params=@{name=$tool;arguments=@{}}}|ConvertTo-Json -Depth 8 -Compress
      $probe=Invoke-RestMethod -Uri 'http://127.0.0.1:47831/mcp' -Method Post -ContentType 'application/json' -Body $probeBody -TimeoutSec 3
      $flags=$probe.result.structuredContent
      if($probe.result.isError -or -not$flags){throw 'HANDOFF_RESOURCE_STATE_UNVERIFIED'}
      if($tool -eq 'gui_status'){
        if($null -eq$flags.leased -or $null -eq$flags.busy){throw 'HANDOFF_GUI_STATE_UNVERIFIED'}
        if($flags.leased -or $flags.busy){$leases++}
      } else {
        if($null -eq$flags.active -or $null -eq$flags.busy -or
           $null -eq$flags.leased -or $null -eq$flags.uncertain){
          throw 'HANDOFF_BROWSER_STATE_UNVERIFIED'
        }
        if($flags.active -or $flags.busy -or $flags.leased -or $flags.uncertain){$leases++}
      }
    }
    return [pscustomobject]@{active=$active;queued=$queued;leases=$leases}
  } catch {
    # Losing status can never authorize terminating the running SYSTEM core.
    return [pscustomobject]@{active=1;queued=1;leases=1}
  }
}
function Stop-ExactProcess($Process,[string]$Label){
  if(-not(Test-SystemOwner $Process)){return}
  try {
    Stop-Process -Id ([int]$Process.ProcessId) -Force -ErrorAction Stop
    Write-HandoffLog "STOPPED $Label pid=$($Process.ProcessId)"
  } catch {
    Write-HandoffLog "STOP_FAILED $Label pid=$($Process.ProcessId) type=$($_.Exception.GetType().Name)"
  }
}

$deadline=(Get-Date).AddSeconds($WaitSeconds)
do {
  $busy=Get-CommanderBusy
  if($busy.active -eq 0 -and $busy.queued -eq 0 -and $busy.leases -eq 0){break}
  Write-HandoffLog "WAIT_BUSY active=$($busy.active) leases=$($busy.leases)"
  Start-Sleep -Seconds 5
} while((Get-Date)-lt$deadline)
if($busy.active -ne 0 -or $busy.queued -ne 0 -or $busy.leases -ne 0){
  Write-HandoffLog "HANDOFF_DEFERRED_BUSY active=$($busy.active) leases=$($busy.leases)"
  exit 75
}

$ownerEsc=[regex]::Escape($OwnerUserProfile)
$supervisors=@(Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -and $_.CommandLine -match 'autostart-windows\.ps1' -and
  $_.CommandLine -match '(?:^|\s)-BootCore(?:\s|$)' -and
  $_.CommandLine -match $ownerEsc
})
foreach($p in $supervisors){Stop-ExactProcess $p 'boot-supervisor'}
Start-Sleep -Milliseconds 500

$stableAppRoot=Join-Path (Join-Path $OwnerUserProfile 'AppData\Local') 'ChatGPTRemoteCommander\app'
$pin=Join-Path $stableAppRoot 'var\tunnel-client.json'
$expectedTunnel=$null
if(Test-Path -LiteralPath $pin -PathType Leaf){
  try{$expectedTunnel=[IO.Path]::GetFullPath([string](Get-Content -LiteralPath $pin -Raw|ConvertFrom-Json).path)}catch{}
}
if($expectedTunnel){
  $tunnels=@(Get-CimInstance Win32_Process -Filter "Name='tunnel-client.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -and [IO.Path]::GetFullPath([string]$_.ExecutablePath) -eq $expectedTunnel -and
    $_.CommandLine -match '--profile(?:=|\s+)'
  })
  foreach($p in $tunnels){Stop-ExactProcess $p 'system-tunnel'}
}

$commanderPattern='ChatGPTRemoteCommander'
$nodes=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -and $_.CommandLine -match $commanderPattern -and
  $_.CommandLine -match '(?:server-v0\.3\.mjs|stable-router\.mjs)'
})
foreach($p in $nodes){Stop-ExactProcess $p 'system-mcp'}
Start-Sleep -Seconds 1

function Test-Ready([int]$Port){
  if($Port-le0){return $false}
  try{
    $r=Invoke-WebRequest -Uri "http://127.0.0.1:$Port/readyz" -UseBasicParsing -TimeoutSec 2
    return ($r.StatusCode-eq200 -and $r.Content.Trim()-eq'ready')
  }catch{return $false}
}
function ManagedHealthPorts {
  $ports=@()
  if(Test-Path -LiteralPath $ProfileDir){
    foreach($f in Get-ChildItem -LiteralPath $ProfileDir -Filter '*.yaml' -File -ErrorAction SilentlyContinue){
      $text=Get-Content -LiteralPath $f.FullName -Raw
      $m=[regex]::Match($text,'listen_addr:\s*["'']?127\.0\.0\.1:(\d+)')
      if($m.Success){$ports += [int]$m.Groups[1].Value}
    }
  }
  return @($ports|Sort-Object -Unique)
}

$recoverDeadline=(Get-Date).AddSeconds(75)
$ok=$false
do{
  $mcp=$false
  try{$h=Invoke-RestMethod 'http://127.0.0.1:47831/health' -TimeoutSec 2;$mcp=[bool]($h.ok -and $h.name-eq'chatgpt-remote-commander')}catch{}
  $ports=ManagedHealthPorts
  $tunnelOk=($ports.Count-gt0)
  foreach($port in $ports){if(-not(Test-Ready $port)){$tunnelOk=$false;break}}
  if($mcp -and $tunnelOk){$ok=$true;break}
  Start-Sleep -Seconds 2
}while((Get-Date)-lt$recoverDeadline)

if($ok){
  Write-HandoffLog 'USER_SESSION_HANDOFF_PASS'
  exit 0
}
Write-HandoffLog 'USER_SESSION_HANDOFF_RECOVERY_PENDING'
exit 76
