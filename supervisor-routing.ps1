$RoutingRoot = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\routing'
$UpdateStateRoot = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander'
New-Item -ItemType Directory -Force -Path $RoutingRoot | Out-Null
$script:NextAutoUpdateCheck = Get-Date

function Get-RouteState([string]$Profile) {
  if (-not (Test-ProfileName $Profile)) { throw "invalid route profile $Profile" }
  $file = Join-Path $RoutingRoot "$Profile.json"
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $null }
  $state = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
  if ([int]$state.schema -ne 1 -or [string]$state.profile -ne $Profile -or [int]$state.generation -lt 1) { throw "invalid route state $Profile" }
  $active = $state.active
  if (-not $active -or [int]$active.port -lt 1024 -or [int]$active.port -gt 65535) { throw "invalid active route $Profile" }
  foreach ($key in @('version','commit','configSha256','configPath','projectDir')) {
    if ([string]::IsNullOrWhiteSpace([string]$active.$key)) { throw "route active field missing $Profile/$key" }
  }
  if ([string]$active.commit -notmatch '^[0-9a-f]{40}$' -or [string]$active.configSha256 -notmatch '^[0-9a-f]{64}$') { throw "invalid route hashes $Profile" }
  if (-not (Test-Path -LiteralPath ([string]$active.configPath) -PathType Leaf) -or -not (Test-Path -LiteralPath ([string]$active.projectDir) -PathType Container)) { throw "route path missing $Profile" }
  return [pscustomobject]@{ File=$file; State=$state; Active=$active }
}

function Test-RouterReady([int]$Port,[string]$Profile,[string]$ExpectedSourceSha='') {
  try {
    $status = Invoke-RestMethod "http://127.0.0.1:$Port/router/status" -TimeoutSec 2
    if(-not($status.ok -and $status.router -and [string]$status.state.profile -eq $Profile)){return $false}
    if($ExpectedSourceSha -and [string]$status.sourceSha256 -ne $ExpectedSourceSha){return $false}
    return $true
  } catch { return $false }
}

function Stop-OwnedRouter([string]$Profile,[int]$CanonicalPort,[string]$RouteFile,[int]$ListenerPid) {
  $runtime=Join-Path $RoutingRoot "$Profile.runtime.json"
  if(-not(Test-Path -LiteralPath $runtime -PathType Leaf)){throw "router runtime marker missing $Profile"}
  $marker=Get-Content -LiteralPath $runtime -Raw|ConvertFrom-Json
  if([int]$marker.pid-ne $ListenerPid -or [int]$marker.port-ne $CanonicalPort -or [string]$marker.host-ne '127.0.0.1' -or
      [IO.Path]::GetFullPath([string]$marker.stateFile)-ne [IO.Path]::GetFullPath($RouteFile)){throw "router ownership mismatch $Profile"}
  $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$ListenerPid" -ErrorAction SilentlyContinue
  if(-not $proc -or [string]$proc.CommandLine -notmatch 'stable-router\.mjs'){throw "router process identity mismatch $Profile"}
  Stop-Process -Id $ListenerPid -Force -ErrorAction Stop
  foreach($i in 1..40){
    Start-Sleep -Milliseconds 100
    if(-not(Get-NetTCPConnection -State Listen -LocalPort $CanonicalPort -ErrorAction SilentlyContinue)){return}
  }
  throw "router recycle port did not clear $Profile"
}

function Stop-OwnedRoutedBackend($Route,[int]$ListenerPid) {
  $cfg = Get-Content -LiteralPath ([string]$Route.Active.configPath) -Raw | ConvertFrom-Json
  $markerFile = [string]$cfg.runtimeState
  if (-not $markerFile -or -not (Test-Path -LiteralPath $markerFile -PathType Leaf)) { throw "routed runtime marker missing $($Route.State.profile)" }
  $marker = Get-Content -LiteralPath $markerFile -Raw | ConvertFrom-Json
  if ([int]$marker.pid -ne $ListenerPid -or [int]$marker.port -ne [int]$Route.Active.port -or
      [string]$marker.instance.profile -ne [string]$Route.State.profile -or
      [IO.Path]::GetFullPath([string]$marker.projectDir) -ne [IO.Path]::GetFullPath([string]$Route.Active.projectDir)) {
    throw "routed backend ownership mismatch $($Route.State.profile)"
  }
  Stop-Process -Id $ListenerPid -Force -ErrorAction Stop
}

function Start-RoutedBackend($Route) {
  $profile = [string]$Route.State.profile
  $port = [int]$Route.Active.port
  if (Test-McpHealth $port ([string]$Route.Active.configSha256) $profile) { return }
  $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    Stop-OwnedRoutedBackend $Route ([int]$listener.OwningProcess)
    Write-SupervisorLog "ROUTED_BACKEND_RECYCLE profile=$profile oldPid=$($listener.OwningProcess) port=$port"
  }
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $server = Join-Path ([string]$Route.Active.projectDir) 'src\server-v0.3.mjs'
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName=$node;$psi.WorkingDirectory=[string]$Route.Active.projectDir;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  [void]$psi.ArgumentList.Add($server)
  $psi.Environment['REMOTE_COMMANDER_CONFIG']=[string]$Route.Active.configPath
  $p=[Diagnostics.Process]::Start($psi)
  foreach($i in 1..40){
    Start-Sleep -Milliseconds 500
    if(Test-McpHealth $port ([string]$Route.Active.configSha256) $profile){Write-SupervisorLog "ROUTED_BACKEND_READY profile=$profile pid=$($p.Id) port=$port";return}
    if($p.HasExited){break}
  }
  if(-not $p.HasExited){Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue}
  throw "routed backend readiness failed $profile"
}

function Start-RouterForRoute($Route,[int]$CanonicalPort) {
  $profile=[string]$Route.State.profile
  $router=Join-Path $Root 'src\stable-router.mjs'
  if(-not(Test-Path -LiteralPath $router -PathType Leaf)){$router=Join-Path ([string]$Route.Active.projectDir) 'src\stable-router.mjs'}
  $expectedSha=(Get-FileHash -LiteralPath $router -Algorithm SHA256).Hash.ToLowerInvariant()
  if(Test-RouterReady $CanonicalPort $profile $expectedSha){return}
  $listener=Get-NetTCPConnection -State Listen -LocalPort $CanonicalPort -ErrorAction SilentlyContinue|Select-Object -First 1
  if($listener){
    Stop-OwnedRouter $profile $CanonicalPort $Route.File ([int]$listener.OwningProcess)
    Write-SupervisorLog "ROUTER_RECYCLE_SOURCE_DRIFT profile=$profile oldPid=$($listener.OwningProcess) port=$CanonicalPort expectedSha=$expectedSha"
  }
  $runtime=Join-Path $RoutingRoot "$profile.runtime.json"
  $node=(Get-Command node.exe -ErrorAction Stop).Source
  $psi=[Diagnostics.ProcessStartInfo]::new()
  $psi.FileName=$node;$psi.WorkingDirectory=$UpdateStateRoot;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  foreach($x in @($router,'--listen-port',[string]$CanonicalPort,'--state-file',$Route.File,'--runtime-file',$runtime)){[void]$psi.ArgumentList.Add($x)}
  $p=[Diagnostics.Process]::Start($psi)
  foreach($i in 1..40){
    Start-Sleep -Milliseconds 250
    if(Test-RouterReady $CanonicalPort $profile $expectedSha){Write-SupervisorLog "ROUTER_READY profile=$profile pid=$($p.Id) port=$CanonicalPort sourceSha=$expectedSha";return}
    if($p.HasExited){break}
  }
  if(-not $p.HasExited){Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue}
  throw "router readiness failed $profile"
}

function Ensure-RoutedProfile([string]$Profile,[int]$CanonicalPort) {
  $route=Get-RouteState $Profile
  if(-not $route){return $false}
  Start-RoutedBackend $route
  Start-RouterForRoute $route $CanonicalPort
  if(-not(Test-McpHealth $CanonicalPort ([string]$route.Active.configSha256) $Profile)){throw "canonical routed MCP unhealthy $Profile"}
  return $true
}

function Get-ActivePrimaryConfig {
  $route=Get-RouteState 'default'
  if($route){return [string]$route.Active.configPath}
  $local=Join-Path $Root 'config.local.json'
  if(Test-Path -LiteralPath $local){return $local}
  return (Join-Path $Root 'config.json')
}

function Start-AutoUpdateIfDue {
  if((Get-Date)-lt $script:NextAutoUpdateCheck){return}
  $config=Get-Content -LiteralPath (Get-ActivePrimaryConfig) -Raw|ConvertFrom-Json
  $minutes=[int]($config.autoUpdate.intervalMinutes ?? 15)
  if($minutes-lt 1){$minutes=15}
  $script:NextAutoUpdateCheck=(Get-Date).AddMinutes($minutes)
  if($config.autoUpdate.enabled-ne $true){return}
  $scriptPath=Join-Path $Root 'auto-update-windows.ps1'
  if(-not(Test-Path -LiteralPath $scriptPath -PathType Leaf)){Write-SupervisorLog 'AUTO_UPDATE_SCRIPT_MISSING';return}
  $pwsh=(Get-Command pwsh.exe -ErrorAction Stop).Source
  Start-Process -FilePath $pwsh -ArgumentList @('-NoLogo','-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',$scriptPath,'-InstallDir',$Root) -WindowStyle Hidden | Out-Null
  Write-SupervisorLog "AUTO_UPDATE_CHECK_STARTED next=$($script:NextAutoUpdateCheck.ToString('o'))"
}
