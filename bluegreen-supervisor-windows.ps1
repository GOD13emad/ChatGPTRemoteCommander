[CmdletBinding()]
param(
  [ValidateRange(2,300)][int]$IntervalSeconds = 5,
  [string]$ManagedStatePath = '',
  [switch]$Once,
  [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Base = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander'
$ControlRoot = Join-Path $Base 'control'
$ReleaseRoot = Join-Path $Base 'releases'
$InstanceRoot = Join-Path $Base 'instances'
$RegistryPath = 'HKCU:\Software\ChatGPTRemoteCommander\BlueGreen'
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunName = 'ChatGPTRemoteCommander'
$LogPath = Join-Path $ControlRoot 'logs\supervisor.log'
$RuntimePath = Join-Path $ControlRoot 'supervisor-runtime.json'
$NamePattern = '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
$ScriptPath = [IO.Path]::GetFullPath($PSCommandPath)
$ManagedOverride = if([string]::IsNullOrWhiteSpace($ManagedStatePath)){''}else{[IO.Path]::GetFullPath($ManagedStatePath)}

function Write-SafeLog([string]$Code, [string]$Detail = '') {
  if ($Detail -match '(?i)(tunnel_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+|api[_ -]?key\s*[=:]\s*\S+)') { throw 'SECRET_IN_LOG_REFUSED' }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null
  Add-Content -LiteralPath $LogPath -Value "$(Get-Date -Format o) $Code $Detail" -Encoding utf8
}

function Read-Json([string]$Path, [string]$Code) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "${Code}_MISSING" }
  try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json }
  catch { throw "${Code}_INVALID" }
}
function Write-JsonAtomic([string]$Path,$Value){$temp="$Path.tmp-$PID-$([guid]::NewGuid().ToString('N'))";$bytes=[Text.UTF8Encoding]::new($false).GetBytes((($Value|ConvertTo-Json -Depth 8)+"`n"));$stream=[IO.FileStream]::new($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough);try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()};Move-Item -LiteralPath $temp -Destination $Path -Force}
function Write-SupervisorRuntime([string]$State,[string]$ManagedPath){$self=Get-Process -Id $PID -ErrorAction Stop;Write-JsonAtomic $RuntimePath ([ordered]@{schema=1;role='bluegreen-supervisor';pid=$PID;processStartTimeUtc=$self.StartTime.ToUniversalTime().ToString('o');executablePath=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName;scriptPath=$ScriptPath;managedStatePath=[IO.Path]::GetFullPath($ManagedPath);intervalSeconds=$IntervalSeconds;state=$State;heartbeatAt=(Get-Date).ToUniversalTime().ToString('o')})}
function Remove-OwnedSupervisorRuntime{if(-not(Test-Path -LiteralPath $RuntimePath -PathType Leaf)){return};try{$marker=Read-Json $RuntimePath 'SUPERVISOR_RUNTIME';if([int]$marker.pid-eq$PID-and[string]$marker.processStartTimeUtc-eq(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')){Remove-Item -LiteralPath $RuntimePath -Force}}catch{}}

function Get-Sha256([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }

function Assert-ControlIntegrity {
  $manifest = Read-Json (Join-Path $ControlRoot 'control-manifest.json') 'CONTROL_MANIFEST'
  $required=@('src/router.mjs','src/router-state.mjs','src/transport-guard.mjs','tools/router-control.mjs','bluegreen-windows.ps1','bluegreen-supervisor-windows.ps1','RUN_BLUEGREEN.ps1')
  if ([int]$manifest.schema -ne 1 -or @($manifest.files).Count -ne $required.Count) { throw 'CONTROL_MANIFEST_INVALID' }
  $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($item in @($manifest.files)) {
    $relative=([string]$item.path).Replace('\','/')
    if($relative -notin $required -or -not $seen.Add($relative)){throw 'CONTROL_MANIFEST_FILE_SET_INVALID'}
    $target = [IO.Path]::GetFullPath((Join-Path $ControlRoot $relative))
    if (-not $target.StartsWith([IO.Path]::GetFullPath($ControlRoot).TrimEnd('\') + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'CONTROL_MANIFEST_PATH_INVALID' }
    if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or (Get-Sha256 $target) -ne [string]$item.sha256) { throw 'CONTROL_INTEGRITY_MISMATCH' }
  }
  $selfRecord = @($manifest.files | Where-Object { $_.path -eq 'bluegreen-supervisor-windows.ps1' })
  if ($selfRecord.Count -ne 1 -or (Get-Sha256 $ScriptPath) -ne [string]$selfRecord[0].sha256) { throw 'SUPERVISOR_SELF_INTEGRITY_MISMATCH' }
}

function Assert-ReleaseManifestExact([string]$Root, $Record) {
  $expected=[Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach($entry in @($Record.files)){
    $relative=([string]$entry.path).Replace('\','/').TrimStart('/')
    if([string]::IsNullOrWhiteSpace($relative)-or $relative -match '(^|/)\.\.(/|$)'-or $expected.ContainsKey($relative)){throw 'RELEASE_MANIFEST_PATH_INVALID'}
    $expected.Add($relative,$entry)
  }
  $actual=@(Get-ChildItem -LiteralPath $Root -File -Recurse -Force)
  if($actual.Count -ne $expected.Count){throw 'RELEASE_FILE_SET_MISMATCH'}
  foreach($file in $actual){
    if(($file.Attributes -band [IO.FileAttributes]::ReparsePoint)-or $file.LinkType){throw 'RELEASE_FILE_LINK_REFUSED'}
    $relative=[IO.Path]::GetRelativePath($Root,$file.FullName).Replace('\','/')
    if(-not $expected.ContainsKey($relative)){throw 'RELEASE_EXTRA_FILE'}
    $entry=$expected[$relative]
    if([int64]$entry.bytes -ne [int64]$file.Length -or [string]$entry.sha256 -ne (Get-Sha256 $file.FullName)){throw 'RELEASE_FILE_INTEGRITY_MISMATCH'}
  }
}

function Assert-ReleaseIntegrity($Backend) {
  $releasePath = [IO.Path]::GetFullPath([string]$Backend.projectDir)
  $releasePrefix = [IO.Path]::GetFullPath($ReleaseRoot).TrimEnd('\') + '\'
  if (-not $releasePath.StartsWith($releasePrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'BACKEND_RELEASE_PATH_INVALID' }
  if ([IO.Path]::GetFullPath((Split-Path -Parent $releasePath)) -ne [IO.Path]::GetFullPath($ReleaseRoot)) { throw 'BACKEND_RELEASE_NOT_DIRECT_CHILD' }
  $expectedLeaf = "$($Backend.version)-$(([string]$Backend.commit).Substring(0,12))"
  if ([IO.Path]::GetFileName($releasePath) -ne $expectedLeaf) { throw 'BACKEND_RELEASE_NAME_MISMATCH' }
  $record = Read-Json (Join-Path $ControlRoot "release-records\$expectedLeaf.json") 'RELEASE_RECORD'
  $releaseItem = Get-Item -LiteralPath $releasePath -Force -ErrorAction Stop
  if ($releaseItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'RELEASE_REPARSE_POINT_REFUSED' }
  if (Get-ChildItem -LiteralPath $releasePath -Directory -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | Select-Object -First 1) { throw 'RELEASE_NESTED_REPARSE_POINT_REFUSED' }
  if ([int]$record.schema -ne 1 -or @($record.files).Count -eq 0 -or [string]$record.version -ne [string]$Backend.version -or [string]$record.commit -ne [string]$Backend.commit) { throw 'RELEASE_RECORD_IDENTITY_MISMATCH' }
  Assert-ReleaseManifestExact $releasePath $record
}

function Assert-UnderBase([string]$Path) {
  $basePath = [IO.Path]::GetFullPath($Base).TrimEnd('\') + '\'
  $full = [IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith($basePath,[StringComparison]::OrdinalIgnoreCase)) { throw 'MANAGED_PATH_OUTSIDE_BASE' }
  return $full
}

function Get-ManagedPath {
  if($ManagedOverride){return Assert-UnderBase $ManagedOverride}
  $value = (Get-ItemProperty -Path $RegistryPath -Name ManagedStatePath -ErrorAction Stop).ManagedStatePath
  return Assert-UnderBase ([string]$value)
}

function Assert-RegistryAuthority([string]$ManagedPath) {
  if($ManagedOverride){if([IO.Path]::GetFullPath($ManagedPath)-ne$ManagedOverride){throw 'MANAGED_OVERRIDE_MISMATCH'};if($Once){return}}
  $run = (Get-ItemProperty -Path $RunKey -Name $RunName -ErrorAction Stop).$RunName
  if ([string]$run -notmatch [regex]::Escape($ScriptPath) -or [string]$run -notmatch [regex]::Escape([IO.Path]::GetFullPath($ManagedPath)) -or [string]$run -notmatch '(?i)-IntervalSeconds\s+(?:"?5"?)(?:\s|$)') { throw 'SUPERVISOR_RUN_REGISTRATION_MISMATCH' }
  $others = @((Get-ItemProperty -Path $RunKey).PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' -and $_.Name -ne $RunName -and [string]$_.Value -match 'ChatGPTRemoteCommander' })
  if ($others.Count) { throw 'MULTIPLE_AUTOSTART_ENTRIES_REFUSED' }
  if ([IO.Path]::GetFullPath((Get-ManagedPath)) -ne [IO.Path]::GetFullPath($ManagedPath)) { throw 'MANAGED_REGISTRY_MISMATCH' }
}

function Assert-ManagedState($Managed) {
  if ([int]$Managed.schema -ne 1 -or [IO.Path]::GetFullPath([string]$Managed.base) -ne [IO.Path]::GetFullPath($Base) -or
      [IO.Path]::GetFullPath([string]$Managed.controlRoot) -ne [IO.Path]::GetFullPath($ControlRoot)) { throw 'MANAGED_AUTHORITY_MISMATCH' }
  $profiles = @{}; $ports = @{}
  foreach ($instance in @($Managed.instances)) {
    $profile = [string]$instance.profile
    if ($profile -notmatch $NamePattern -or $profile -match '\.\.' -or $profiles.ContainsKey($profile)) { throw 'MANAGED_INSTANCE_PROFILE_INVALID' }
    $profiles[$profile] = $true
    $stateDir = Assert-UnderBase ([string]$instance.stateDir)
    if ($stateDir -ne [IO.Path]::GetFullPath((Join-Path $InstanceRoot $profile))) { throw 'MANAGED_INSTANCE_STATE_PATH_MISMATCH' }
    $expectedPaths = @{
      configPath=(Join-Path $stateDir 'config.json'); pointerPath=(Join-Path $stateDir 'active-backend.json')
      routerConfigPath=(Join-Path $stateDir 'router.json'); routerRuntimePath=(Join-Path $stateDir 'router-runtime.json')
    }
    foreach ($key in $expectedPaths.Keys) {
      if ([IO.Path]::GetFullPath([string]$instance.$key) -ne [IO.Path]::GetFullPath([string]$expectedPaths[$key])) { throw 'MANAGED_INSTANCE_PATH_MISMATCH' }
    }
    if (-not (Test-Path -LiteralPath ([string]$instance.configPath) -PathType Leaf) -or (Get-Sha256 ([string]$instance.configPath)) -ne [string]$instance.configSha256) { throw 'MANAGED_CONFIG_HASH_MISMATCH' }
    $instancePorts = @([int]$instance.stablePort) + @($instance.backendPorts | ForEach-Object { [int]$_ })
    if (@($instance.backendPorts).Count -ne 2 -or @($instancePorts | Select-Object -Unique).Count -ne 3) { throw 'MANAGED_PORT_SET_INVALID' }
    foreach ($port in $instancePorts) { if ($port -lt 1024 -or $port -gt 65535 -or $ports.ContainsKey($port)) { throw 'MANAGED_PORT_CONFLICT' }; $ports[$port]=$true }
  }
  $tunnelProfiles=@{};$healthPorts=@{}
  foreach ($tunnel in @($Managed.tunnelProfiles)) {
    $profile=[string]$tunnel.profile
    if ($profile -notmatch $NamePattern -or $profile -match '\.\.' -or $tunnelProfiles.ContainsKey($profile)) { throw 'MANAGED_TUNNEL_PROFILE_INVALID' }
    $tunnelProfiles[$profile]=$true
    if (-not $profiles.ContainsKey([string]$tunnel.instanceProfile)) { throw 'MANAGED_TUNNEL_INSTANCE_UNKNOWN' }
    $expectedProfileDir=[IO.Path]::GetFullPath((Join-Path $env:APPDATA 'tunnel-client'))
    if ([IO.Path]::GetFullPath([string]$tunnel.profileDir) -ne $expectedProfileDir -or
        [IO.Path]::GetFullPath([string]$tunnel.yamlPath) -ne [IO.Path]::GetFullPath((Join-Path $expectedProfileDir "$profile.yaml")) -or
        [IO.Path]::GetFullPath([string]$tunnel.credentialPath) -ne [IO.Path]::GetFullPath((Join-Path $Base "credentials\$profile.dpapi"))) { throw 'MANAGED_TUNNEL_PATH_MISMATCH' }
    if ([int]$tunnel.routerPort -ne [int](@($Managed.instances | Where-Object profile -eq $tunnel.instanceProfile)[0].stablePort)) { throw 'MANAGED_TUNNEL_ROUTER_PORT_MISMATCH' }
    $health=[int]$tunnel.healthPort;if($health -lt 1024 -or $health -gt 65535 -or $ports.ContainsKey($health) -or $healthPorts.ContainsKey($health)){throw 'MANAGED_TUNNEL_HEALTH_PORT_CONFLICT'};$healthPorts[$health]=$true
    if (-not (Test-Path -LiteralPath ([string]$tunnel.yamlPath) -PathType Leaf) -or (Get-Sha256 ([string]$tunnel.yamlPath)) -ne [string]$tunnel.yamlSha256 -or
        -not (Test-Path -LiteralPath ([string]$tunnel.credentialPath) -PathType Leaf)) { throw 'MANAGED_TUNNEL_IDENTITY_DRIFT' }
  }
  if ($profiles.Count -eq 0 -or $tunnelProfiles.Count -eq 0) { throw 'MANAGED_INVENTORY_EMPTY' }
  $clientPath=Assert-UnderBase ([string]$Managed.tunnelClient.path)
  if (-not $clientPath.StartsWith([IO.Path]::GetFullPath($ControlRoot).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) -or
      -not (Test-Path -LiteralPath $clientPath -PathType Leaf) -or (Get-Sha256 $clientPath) -ne [string]$Managed.tunnelClient.sha256) { throw 'MANAGED_TUNNEL_CLIENT_INVALID' }
  return $Managed
}

function Get-Health([int]$Port) {
  try { return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3 }
  catch { return $null }
}

function Test-BackendIdentity($Health, $Backend) {
  if (-not $Health -or -not $Health.ok -or -not $Health.backend) { return $false }
  foreach ($key in @('profile','version','configSha256','commit','slotId','projectDir','port')) {
    if ([string]$Health.backend.$key -ne [string]$Backend.$key) { return $false }
  }
  return $true
}

function Get-RouterExpected($Instance) {
  $configPath = Assert-UnderBase ([string]$Instance.routerConfigPath)
  $runtimePath = Assert-UnderBase ([string]$Instance.routerRuntimePath)
  $config = Read-Json $configPath 'ROUTER_CONFIG'
  $expectedRouterId = "router-$($Instance.profile)"
  if ([int]$config.schema -ne 1 -or [string]$config.routerId -ne $expectedRouterId -or [string]$config.host -ne '127.0.0.1' -or
      [int]$config.port -ne [int]$Instance.stablePort -or [string]$config.profile -ne [string]$Instance.profile -or
      [IO.Path]::GetFullPath([string]$config.pointerPath) -ne [IO.Path]::GetFullPath([string]$Instance.pointerPath) -or
      [IO.Path]::GetFullPath([string]$config.runtimeStatePath) -ne [IO.Path]::GetFullPath($runtimePath)) {
    throw 'ROUTER_CONFIG_AUTHORITY_MISMATCH'
  }
  return [pscustomobject]@{
    role='router'; routerId=$expectedRouterId; profile=[string]$Instance.profile
    port=[int]$Instance.stablePort; configSha256=(Get-Sha256 $configPath); projectDir=$ControlRoot
  }
}

function Test-RouterHealthIdentity($Health, $Expected, $Pointer) {
  if (-not $Health -or -not $Health.ok -or -not $Health.router) { return $false }
  foreach ($key in @('routerId','profile','port','configSha256')) {
    if ([string]$Health.router.$key -ne [string]$Expected.$key) { return $false }
  }
  if ([int]$Health.generation -ne [int]$Pointer.generation) { return $false }
  return (Test-SameBackendIdentity $Health.backend $Pointer.backend)
}

function Test-SameBackendIdentity($Left, $Right) {
  if (-not $Left -or -not $Right) { return $false }
  foreach ($key in @('profile','version','configSha256','commit','slotId','projectDir','port')) {
    if ([string]$Left.$key -ne [string]$Right.$key) { return $false }
  }
  return $true
}

function Get-SlotPaths($Instance, [string]$SlotId) {
  if ($SlotId -notmatch $NamePattern -or $SlotId -match '\.\.') { throw 'SLOT_ID_INVALID' }
  $root = Join-Path ([string]$Instance.stateDir) "slots\$SlotId"
  return [pscustomobject]@{ root=$root; runtimeState=(Join-Path $root 'runtime.json'); auditLog=(Join-Path $root 'audit.jsonl'); drainFile=(Join-Path $root 'drain'); stdout=(Join-Path $root 'backend.out.log'); stderr=(Join-Path $root 'backend.err.log') }
}

function Assert-ListenerOwned([int]$Port, [string]$MarkerPath, $Expected, [string]$Role) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) { return $false }
  $marker = Read-Json $MarkerPath "${Role}_RUNTIME_MARKER"
  if ([int]$marker.pid -ne [int]$listener.OwningProcess) { throw "${Role}_UNKNOWN_LISTENER" }
  if ($Role -eq 'BACKEND') {
    if (-not (Test-BackendIdentity ([pscustomobject]@{ok=$true;backend=$marker.backend}) $Expected)) { throw 'BACKEND_MARKER_IDENTITY_MISMATCH' }
  } else {
    if ([string]$marker.role -ne [string]$Expected.role -or [string]$marker.routerId -ne [string]$Expected.routerId -or
        [string]$marker.profile -ne [string]$Expected.profile -or [int]$marker.port -ne $Port -or
        [string]$marker.configSha256 -ne [string]$Expected.configSha256 -or
        [IO.Path]::GetFullPath([string]$marker.projectDir) -ne [IO.Path]::GetFullPath([string]$Expected.projectDir)) {
      throw 'ROUTER_MARKER_IDENTITY_MISMATCH'
    }
  }
  return $true
}

function Ensure-Backend($Instance, $Pointer) {
  $backend = $Pointer.backend
  $health = Get-Health ([int]$backend.port)
  $slot = Get-SlotPaths $Instance ([string]$backend.slotId)
  if (Test-BackendIdentity $health $backend) {
    if (-not (Assert-ListenerOwned ([int]$backend.port) $slot.runtimeState $backend 'BACKEND')) { throw 'BACKEND_HEALTH_WITHOUT_OWNED_LISTENER' }
    return
  }
  if (Assert-ListenerOwned ([int]$backend.port) $slot.runtimeState $backend 'BACKEND') { throw 'OWNED_BACKEND_UNHEALTHY_FAIL_CLOSED' }
  if (Get-NetTCPConnection -State Listen -LocalPort ([int]$backend.port) -ErrorAction SilentlyContinue) { throw 'BACKEND_UNKNOWN_LISTENER' }
  Assert-ReleaseIntegrity $backend
  if ((Get-Sha256 ([string]$Instance.configPath)) -ne [string]$backend.configSha256) { throw 'BACKEND_CONFIG_HASH_DRIFT' }
  if ([IO.Path]::GetFullPath([string]$backend.projectDir) -notlike ([IO.Path]::GetFullPath((Join-Path $Base 'releases')) + '\*')) { throw 'BACKEND_RELEASE_PATH_INVALID' }
  New-Item -ItemType Directory -Force -Path $slot.root | Out-Null
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $environment = @{
    REMOTE_COMMANDER_CONFIG=[string]$Instance.configPath; REMOTE_COMMANDER_LISTEN_PORT=[string]$backend.port
    REMOTE_COMMANDER_RUNTIME_STATE=$slot.runtimeState; REMOTE_COMMANDER_AUDIT_LOG=$slot.auditLog
    REMOTE_COMMANDER_DRAIN_FILE=$slot.drainFile; REMOTE_COMMANDER_RELEASE_COMMIT=[string]$backend.commit
    REMOTE_COMMANDER_SLOT_ID=[string]$backend.slotId; REMOTE_COMMANDER_GUI_STOP_FILE=(Join-Path $ControlRoot 'GUI_STOP')
  }
  $process = Start-Process -FilePath $node -ArgumentList @((Join-Path ([string]$backend.projectDir) 'src\server-v0.3.mjs')) -WorkingDirectory ([string]$backend.projectDir) -WindowStyle Hidden -PassThru -Environment $environment -RedirectStandardOutput $slot.stdout -RedirectStandardError $slot.stderr
  $ready = $false
  try {
    foreach ($i in 1..60) {
      Start-Sleep -Milliseconds 250
      if (Test-BackendIdentity (Get-Health ([int]$backend.port)) $backend) {
        if (-not (Assert-ListenerOwned ([int]$backend.port) $slot.runtimeState $backend 'BACKEND')) { throw 'BACKEND_HEALTH_WITHOUT_OWNED_LISTENER' }
        $marker = Read-Json $slot.runtimeState 'BACKEND_RUNTIME_MARKER'
        if ([int]$marker.pid -ne [int]$process.Id) { throw 'BACKEND_SPAWN_PID_MISMATCH' }
        $ready = $true
        Write-SafeLog 'BACKEND_READY' "profile=$($backend.profile) pid=$($process.Id) port=$($backend.port)"
        return
      }
      if ($process.HasExited) { break }
    }
    throw 'BACKEND_START_FAILED'
  } finally {
    if (-not $ready -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  }
}

function Get-RouterHealth([int]$Port) {
  try { return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/router/health" -TimeoutSec 3 }
  catch { return $null }
}

function Ensure-Router($Instance, $Pointer) {
  $expected = Get-RouterExpected $Instance
  $health = Get-RouterHealth ([int]$Instance.stablePort)
  if (Test-RouterHealthIdentity $health $expected $Pointer) {
    if (-not (Assert-ListenerOwned ([int]$Instance.stablePort) ([string]$Instance.routerRuntimePath) $expected 'ROUTER')) { throw 'ROUTER_HEALTH_WITHOUT_OWNED_LISTENER' }
    return
  }
  if (Assert-ListenerOwned ([int]$Instance.stablePort) ([string]$Instance.routerRuntimePath) $expected 'ROUTER') { throw 'OWNED_ROUTER_UNHEALTHY_FAIL_CLOSED' }
  if (Get-NetTCPConnection -State Listen -LocalPort ([int]$Instance.stablePort) -ErrorAction SilentlyContinue) { throw 'ROUTER_UNKNOWN_LISTENER' }
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $out = Join-Path ([string]$Instance.stateDir) 'router.out.log'; $err = Join-Path ([string]$Instance.stateDir) 'router.err.log'
  $environment = @{ REMOTE_COMMANDER_ROUTER_CONFIG=[string]$Instance.routerConfigPath }
  $process = Start-Process -FilePath $node -ArgumentList @((Join-Path $ControlRoot 'src\router.mjs')) -WorkingDirectory $ControlRoot -WindowStyle Hidden -PassThru -Environment $environment -RedirectStandardOutput $out -RedirectStandardError $err
  $ready = $false
  try {
    foreach ($i in 1..60) {
      Start-Sleep -Milliseconds 250
      $health=Get-RouterHealth ([int]$Instance.stablePort)
      if (Test-RouterHealthIdentity $health $expected $Pointer) {
        if (-not (Assert-ListenerOwned ([int]$Instance.stablePort) ([string]$Instance.routerRuntimePath) $expected 'ROUTER')) { throw 'ROUTER_HEALTH_WITHOUT_OWNED_LISTENER' }
        $marker = Read-Json ([string]$Instance.routerRuntimePath) 'ROUTER_RUNTIME_MARKER'
        if ([int]$marker.pid -ne [int]$process.Id) { throw 'ROUTER_SPAWN_PID_MISMATCH' }
        $ready = $true
        Write-SafeLog 'ROUTER_READY' "profile=$($Instance.profile) pid=$($process.Id) port=$($Instance.stablePort)"
        return
      }
      if ($process.HasExited) { break }
    }
    throw 'ROUTER_START_FAILED'
  } finally {
    if (-not $ready -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  }
}

function Test-TunnelReady([int]$Port) {
  try { $r=Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/readyz" -TimeoutSec 3; return ($r.StatusCode -eq 200 -and $r.Content.Trim() -eq 'ready') }
  catch { return $false }
}

function Assert-TunnelListenerOwned($Process, [int]$Port) {
  if (-not (Test-TunnelReady $Port)) { return $false }
  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -First 1
  if (-not $listener -or [int]$listener.OwningProcess -ne [int]$Process.ProcessId) { throw 'TUNNEL_HEALTH_LISTENER_OWNERSHIP_MISMATCH' }
  return $true
}

function Get-TunnelProcess([string]$Profile, [string]$Exe, [string]$ProfileDir) {
  $expected=[IO.Path]::GetFullPath($Exe);$rx='--profile(?:=|\s+)["'']?'+[regex]::Escape($Profile)+'["'']?(?:\s|$)';$dirRx='--profile-dir(?:=|\s+)["'']?'+[regex]::Escape([IO.Path]::GetFullPath($ProfileDir))+'["'']?(?:\s|$)'
  return @(Get-CimInstance Win32_Process -Filter "Name='tunnel-client.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath([string]$_.ExecutablePath) -eq $expected -and $_.CommandLine -match $rx -and $_.CommandLine -match $dirRx })
}

function Ensure-Tunnel($Tunnel, $TunnelClient) {
  if ((Get-Sha256 ([string]$TunnelClient.path)) -ne [string]$TunnelClient.sha256) { throw 'TUNNEL_CLIENT_HASH_MISMATCH' }
  if (-not (Test-Path -LiteralPath ([string]$Tunnel.yamlPath) -PathType Leaf) -or -not (Test-Path -LiteralPath ([string]$Tunnel.credentialPath) -PathType Leaf)) { throw 'TUNNEL_ENROLLMENT_MISSING' }
  if ((Get-Sha256 ([string]$Tunnel.yamlPath)) -ne [string]$Tunnel.yamlSha256) { throw 'TUNNEL_YAML_IDENTITY_DRIFT' }
  $processes = @(Get-TunnelProcess ([string]$Tunnel.profile) ([string]$TunnelClient.path) ([string]$Tunnel.profileDir))
  if ($processes.Count -gt 1) { throw 'MULTIPLE_TUNNEL_PROCESSES' }
  if ($processes.Count -eq 1) { if (Assert-TunnelListenerOwned $processes[0] ([int]$Tunnel.healthPort)) { return }; throw 'TUNNEL_PROCESS_UNHEALTHY_FAIL_CLOSED' }
  if (Get-NetTCPConnection -State Listen -LocalPort ([int]$Tunnel.healthPort) -ErrorAction SilentlyContinue) { throw 'TUNNEL_HEALTH_UNKNOWN_LISTENER' }
  $secure = ConvertTo-SecureString (Get-Content -LiteralPath ([string]$Tunnel.credentialPath) -Raw)
  $plain = [Net.NetworkCredential]::new('', $secure).Password
  try {
    if ([string]::IsNullOrWhiteSpace($plain)) { throw 'TUNNEL_CREDENTIAL_EMPTY' }
    $log = Join-Path $ControlRoot "logs\tunnel-$($Tunnel.profile).log"
    $psi = [Diagnostics.ProcessStartInfo]::new();$psi.FileName=[string]$TunnelClient.path;$psi.WorkingDirectory=$ControlRoot;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
    foreach($arg in @('run','--profile',[string]$Tunnel.profile,'--profile-dir',[string]$Tunnel.profileDir,'--log.file',$log)){[void]$psi.ArgumentList.Add($arg)}
    $psi.Environment['CONTROL_PLANE_API_KEY']=$plain;[void]$psi.Environment.Remove('OPENAI_API_KEY')
    $started=[Diagnostics.Process]::Start($psi);$ready=$false
    try {
      foreach($i in 1..80){Start-Sleep -Milliseconds 250;if(Assert-TunnelListenerOwned ([pscustomobject]@{ProcessId=$started.Id}) ([int]$Tunnel.healthPort)){$ready=$true;Write-SafeLog 'TUNNEL_READY' "profile=$($Tunnel.profile) pid=$($started.Id) healthPort=$($Tunnel.healthPort)";return};if($started.HasExited){break}}
      throw 'TUNNEL_START_FAILED'
    } finally { if(-not $ready -and -not $started.HasExited){Stop-Process -Id $started.Id -Force -ErrorAction SilentlyContinue} }
  } finally { $plain=$null;$secure=$null }
}

function Invoke-Iteration($Managed) {
  foreach ($instance in @($Managed.instances)) {
    $pointer = Read-Json ([string]$instance.pointerPath) 'ROUTER_POINTER'
    Ensure-Backend $instance $pointer
    Ensure-Router $instance $pointer
  }
  foreach ($tunnel in @($Managed.tunnelProfiles)) { Ensure-Tunnel $tunnel $Managed.tunnelClient }
}

if ($SelfTest) {
  [pscustomobject]@{ok=$true;script='bluegreen-supervisor-windows';order=@('backend','router','tunnel');failClosedUnknownListener=$true;secretsLogged=$false}|ConvertTo-Json -Compress
  exit 0
}

$managedPath = Get-ManagedPath
$managed = Assert-ManagedState (Read-Json $managedPath 'MANAGED_STATE')
Assert-ControlIntegrity
Assert-RegistryAuthority $managedPath
$created=$false;$mutex=[Threading.Mutex]::new($false,'Local\ChatGPTRemoteCommanderBlueGreenSupervisor',[ref]$created)
if(-not $created){exit 0}
try {
  Write-SafeLog 'SUPERVISOR_STARTED' "pid=$PID"
  do {
    try { Invoke-Iteration $managed;if(-not$Once){Write-SupervisorRuntime 'healthy' $managedPath} }
    catch { if(-not$Once){Write-SupervisorRuntime 'degraded' $managedPath};Write-SafeLog 'SUPERVISOR_ITERATION_FAIL' $_.Exception.Message; if($Once){throw} }
    if(-not $Once){Start-Sleep -Seconds $IntervalSeconds}
  } while(-not $Once)
} finally {
  if(-not$Once){Remove-OwnedSupervisorRuntime}
  Write-SafeLog 'SUPERVISOR_STOPPED'
  try{$mutex.ReleaseMutex()}catch{};$mutex.Dispose()
}
