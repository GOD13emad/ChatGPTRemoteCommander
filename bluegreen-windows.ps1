[CmdletBinding()]
param(
  [string]$CandidateRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path),
  [string]$ExpectedCommit = '',
  [string]$LegacyRoot = (Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\app'),
  [ValidateSet('Auto','Bootstrap','Update')][string]$Mode = 'Auto',
  [switch]$PlanOnly,
  [switch]$SelfTest,
  [switch]$NonInteractive,
  [string]$DeadlineUtc = '',
  [ValidateRange(30,1800)][int]$TimeoutSeconds = 600,
  [int]$SelfTestDecoyPid = 0,
  [string]$SelfTestLegacyFilePath = '',
  [string]$SelfTestLegacyDirectoryPath = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Base = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander'
$ReleaseRoot = Join-Path $Base 'releases'
$ControlRoot = Join-Path $Base 'control'
$InstanceRoot = Join-Path $Base 'instances'
$EvidenceRoot = Join-Path $Base 'evidence'
$ManagedPath = Join-Path $ControlRoot 'managed.json'
$BootstrapJournalPath = Join-Path $ControlRoot 'bootstrap-transaction.json'
$LegacyCleanupJournalPath=Join-Path $ControlRoot 'legacy-cleanup.json';$UpdateJournalPath=Join-Path $ControlRoot 'update-transaction.json'
$RegistryPath = 'HKCU:\Software\ChatGPTRemoteCommander\BlueGreen'
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunName = 'ChatGPTRemoteCommander'
$ProfileRoot=Join-Path $env:APPDATA 'tunnel-client';$CommitPattern='^[0-9a-fA-F]{40}$'
$NamePattern='^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$';$Script:Plan=[Collections.Generic.List[object]]::new()
$Script:LegacySupervisorAuthority = $null
$Deadline=if($DeadlineUtc){try{[DateTimeOffset]::Parse($DeadlineUtc).UtcDateTime}catch{throw 'UPGRADE_DEADLINE_INVALID'}}else{[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)}
function Assert-Deadline{if([DateTime]::UtcNow-gt$Deadline){throw 'UPGRADE_DEADLINE_EXCEEDED'}}
function Write-Status([string]$Code, [string]$Detail = '') {
  if ($Detail -match '(?i)(tunnel_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+|api[_ -]?key\s*[=:]\s*\S+)') { throw 'SECRET_IN_LOG_REFUSED' }
  $line = if ($Detail) { "$Code $Detail" } else { $Code }
  Write-Host $line
}
function Add-Plan([string]$Phase, [string]$Action, [string]$Target) {
  $Script:Plan.Add([pscustomobject]@{ phase=$Phase; action=$Action; target=$Target })
}
function Assert-Name([string]$Value, [string]$Label) {
  if ($Value -notmatch $NamePattern -or $Value -match '\.\.' -or $Value -in @('.','..')) { throw "${Label}_INVALID" }
}
function Resolve-ExactDirectory([string]$Value, [string]$Label) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "${Label}_REQUIRED" }
  $item = Get-Item -LiteralPath $Value -Force -ErrorAction Stop
  if (-not $item.PSIsContainer -or $item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "${Label}_INVALID" }
  return [IO.Path]::GetFullPath($item.FullName).TrimEnd('\')
}
function Assert-PathUnder([string]$Parent, [string]$Child, [string]$Code) {
  $p = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  $c = [IO.Path]::GetFullPath($Child)
  if (-not $c.StartsWith($p, [StringComparison]::OrdinalIgnoreCase)) { throw $Code }
  return $c
}
function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Write-JsonAtomic([string]$Path, $Value) {
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $temp = "$Path.tmp-$PID-$([guid]::NewGuid().ToString('N'))"
  $bytes=[Text.UTF8Encoding]::new($false).GetBytes((($Value|ConvertTo-Json -Depth 20)+"`n"));$stream=[IO.FileStream]::new($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough);try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
  Move-Item -LiteralPath $temp -Destination $Path -Force
}
function Write-RawAtomic([string]$Path,[string]$Value){$temp="$Path.tmp-$PID-$([guid]::NewGuid().ToString('N'))";$bytes=[Text.UTF8Encoding]::new($false).GetBytes($Value);$stream=[IO.FileStream]::new($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough);try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()};Move-Item -LiteralPath $temp -Destination $Path -Force}
function Read-Json([string]$Path, [string]$Code) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "${Code}_MISSING" }
  try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json }
  catch { throw "${Code}_INVALID" }
}
function Resolve-BootstrapDisposition([bool]$JournalExists,[string]$JournalPhase,[bool]$CleanupJournalExists,[bool]$ManagedExists){
  if(-not$JournalExists){return $(if($ManagedExists){'managed'}else{'bootstrap-new'})}
  $phase=if([string]::IsNullOrWhiteSpace($JournalPhase)){if($CleanupJournalExists){'stable-accepted'}else{'prepared'}}else{$JournalPhase}
  if($phase-notin@('prepared','stable-accepted')){throw 'BOOTSTRAP_TRANSACTION_PHASE_INVALID'}
  if($phase-eq'stable-accepted'-or$CleanupJournalExists){if(-not$ManagedExists){throw 'BOOTSTRAP_ACCEPTED_MANAGED_STATE_MISSING'};return 'managed-recover-accepted'}
  return 'bootstrap-recover-premanaged'
}
function Split-WindowsCommandLine([string]$CommandLine){
  if(-not('RemoteCommanderCommandLineNative'-as[type])){Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class RemoteCommanderCommandLineNative{[DllImport("shell32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern IntPtr CommandLineToArgvW(string c,out int n);[DllImport("kernel32.dll")]public static extern IntPtr LocalFree(IntPtr p);}' }
  $count=0;$pointer=[RemoteCommanderCommandLineNative]::CommandLineToArgvW($CommandLine,[ref]$count);if($pointer-eq[IntPtr]::Zero){throw 'COMMAND_LINE_TOKENIZE_FAILED'}
  try{$tokens=@();foreach($index in 0..($count-1)){$tokens+=[Runtime.InteropServices.Marshal]::PtrToStringUni([Runtime.InteropServices.Marshal]::ReadIntPtr($pointer,$index*[IntPtr]::Size))};return $tokens}finally{[void][RemoteCommanderCommandLineNative]::LocalFree($pointer)}
}
function Test-TokenListExact($Actual,$Expected){if(@($Actual).Count-ne@($Expected).Count){return $false};for($i=0;$i-lt@($Expected).Count;$i++){if(-not[string]::Equals([string]$Actual[$i],[string]$Expected[$i],[StringComparison]::OrdinalIgnoreCase)){return $false}};return $true}
function Get-PowerShellIdentitySet([string]$Script,[string]$Executable,[string[]]$Arguments){
  $mentions=@();$exact=@();foreach($process in @(Get-CimInstance Win32_Process -Filter "Name='pwsh.exe' OR Name='powershell.exe'" -ErrorAction SilentlyContinue)){if(-not$process.CommandLine){continue};try{$tokens=@(Split-WindowsCommandLine ([string]$process.CommandLine));$rest=@($tokens|Select-Object -Skip 1);if(@($rest|Where-Object{[string]::Equals([string]$_,$Script,[StringComparison]::OrdinalIgnoreCase)}).Count){$mentions+=$process;if($process.ExecutablePath-and[IO.Path]::GetFullPath([string]$process.ExecutablePath)-eq[IO.Path]::GetFullPath($Executable)-and(Test-TokenListExact $rest $Arguments)){$exact+=$process}}}catch{}}
  return [pscustomobject]@{mentions=@($mentions);exact=@($exact)}
}
function Get-StableSupervisorSpec{$script=[IO.Path]::GetFullPath((Join-Path $ControlRoot 'bluegreen-supervisor-windows.ps1'));$exe=(Get-Command pwsh.exe -ErrorAction Stop).Source;$arguments=@('-NoLogo','-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',$script,'-ManagedStatePath',[IO.Path]::GetFullPath($ManagedPath),'-IntervalSeconds','5');return [pscustomobject]@{script=$script;executable=$exe;arguments=$arguments;runtime=(Join-Path $ControlRoot 'supervisor-runtime.json')}}
function Assert-StableSupervisorRuntime([switch]$ForOwnedStop){
  $spec=Get-StableSupervisorSpec;$set=Get-PowerShellIdentitySet $spec.script $spec.executable $spec.arguments;if($set.mentions.Count-ne$set.exact.Count){throw 'STABLE_SUPERVISOR_PROCESS_IDENTITY_UNKNOWN'};if($set.exact.Count-ne 1){throw 'STABLE_SUPERVISOR_PROCESS_COUNT_INVALID'};$marker=Read-Json $spec.runtime 'STABLE_SUPERVISOR_RUNTIME';$process=Get-Process -Id ([int]$marker.pid) -ErrorAction Stop
  if([int]$set.exact[0].ProcessId-ne[int]$marker.pid-or[int]$marker.schema-ne 1-or[string]$marker.role-ne'bluegreen-supervisor'-or[IO.Path]::GetFullPath([string]$marker.executablePath)-ne[IO.Path]::GetFullPath($spec.executable)-or[IO.Path]::GetFullPath([string]$marker.scriptPath)-ne$spec.script-or[IO.Path]::GetFullPath([string]$marker.managedStatePath)-ne[IO.Path]::GetFullPath($ManagedPath)-or[int]$marker.intervalSeconds-ne 5-or[string]$marker.processStartTimeUtc-ne$process.StartTime.ToUniversalTime().ToString('o')-or(-not$ForOwnedStop-and([string]$marker.state-ne'healthy'-or[DateTimeOffset]::Parse([string]$marker.heartbeatAt).UtcDateTime-lt[DateTime]::UtcNow.AddSeconds(-20)))){throw 'STABLE_SUPERVISOR_RUNTIME_IDENTITY_UNPROVEN'}
  return $set.exact[0]
}
function Get-LegacySupervisorSpec([string]$RunValue,[string]$LegacyScript){$tokens=@(Split-WindowsCommandLine $RunValue);if($tokens.Count-lt 3){throw 'LEGACY_SUPERVISOR_REGISTRY_COMMAND_INVALID'};$exe=if([IO.Path]::IsPathRooted([string]$tokens[0])){[IO.Path]::GetFullPath([string]$tokens[0])}else{(Get-Command ([string]$tokens[0]) -ErrorAction Stop).Source};$args=@($tokens|Select-Object -Skip 1);$fileIndex=-1;for($index=0;$index-lt$args.Count;$index++){if([string]::Equals([string]$args[$index],'-File',[StringComparison]::OrdinalIgnoreCase)){$fileIndex=$index;break}};if($fileIndex-lt 0-or$fileIndex+1-ge$args.Count-or-not[string]::Equals([IO.Path]::GetFullPath([string]$args[$fileIndex+1]),$LegacyScript,[StringComparison]::OrdinalIgnoreCase)-or[IO.Path]::GetFileName($exe)-notin@('pwsh.exe','powershell.exe')){throw 'LEGACY_SUPERVISOR_REGISTRY_COMMAND_INVALID'};return [pscustomobject]@{script=$LegacyScript;executable=$exe;arguments=$args}}
function Invoke-Git([string[]]$Arguments) {
  $git = (Get-Command git.exe -ErrorAction Stop).Source
  $output = & $git @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "GIT_FAILED exit=$LASTEXITCODE" }
  return @($output)
}
function Invoke-NpmGate([string]$Root, [string[]]$Arguments, [string]$Gate) {
  Assert-Deadline
  Write-Status 'GATE_START' $Gate
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  & $npm @Arguments --prefix $Root | ForEach-Object { Write-Host ([string]$_) }
  if ($LASTEXITCODE -ne 0) { throw "GATE_FAILED name=$Gate exit=$LASTEXITCODE" }
  Assert-Deadline
  Write-Status 'GATE_PASS' $Gate
}
function Invoke-GuiNativeGate($Managed,[string]$ReleasePath,[bool]$Bootstrap){
  if(Test-Path -LiteralPath (Join-Path $ControlRoot 'GUI_STOP')){throw 'GUI_NATIVE_GATE_BLOCKED_BY_OWNER_STOP'}
  $leases=[Collections.Generic.List[object]]::new();$gateError=$null;$releaseError=$null;$oldStop=$env:REMOTE_COMMANDER_GUI_STOP_FILE
  try{$env:REMOTE_COMMANDER_GUI_STOP_FILE=Join-Path $ControlRoot 'GUI_STOP';foreach($instance in @($Managed.instances)){$port=if($Bootstrap){[int]$instance.stablePort}else{[int](Read-Json ([string]$instance.pointerPath) 'ROUTER_POINTER').backend.port};$lease=Invoke-Rpc $port 'gui_session_begin' @{ttlSeconds=120};if([string]::IsNullOrWhiteSpace([string]$lease.lease)){throw 'GUI_MAINTENANCE_LEASE_INVALID'};$leases.Add([pscustomobject]@{port=$port;lease=[string]$lease.lease})};Invoke-NpmGate $ReleasePath @('run','test:gui-native') 'gui-native-maintenance-leased'}catch{$gateError=$_}
  finally{if($null-eq$oldStop){Remove-Item Env:REMOTE_COMMANDER_GUI_STOP_FILE -ErrorAction SilentlyContinue}else{$env:REMOTE_COMMANDER_GUI_STOP_FILE=$oldStop};foreach($entry in @($leases|Select-Object -Reverse)){try{[void](Invoke-Rpc ([int]$entry.port) 'gui_session_end' @{lease=[string]$entry.lease})}catch{$releaseError=$_}}}
  if($releaseError){throw "GUI_MAINTENANCE_LEASE_RELEASE_FAILED $($releaseError.Exception.Message)"};if($gateError){throw $gateError};Write-Status 'GUI_NATIVE_GATE_PASS' "profiles=$($leases.Count)"
}
function Invoke-Rpc([int]$Port, [string]$Name, $Arguments = @{}) {
  $body = @{ jsonrpc='2.0'; id=1; method='tools/call'; params=@{ name=$Name; arguments=$Arguments } } | ConvertTo-Json -Depth 20 -Compress
  $response = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/mcp" -ContentType 'application/json' -Body $body -TimeoutSec 30
  if ($response.error) { throw "RPC_PROTOCOL_ERROR tool=$Name" }
  if ($response.result.isError) { throw "RPC_TOOL_ERROR tool=$Name code=$($response.result.content[0].text)" }
  return $response.result.structuredContent
}
function Invoke-ToolsList([int]$Port) {
  $body = @{ jsonrpc='2.0'; id=2; method='tools/list' } | ConvertTo-Json -Compress
  $response = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/mcp" -ContentType 'application/json' -Body $body -TimeoutSec 30
  if ($response.error) { throw 'TOOLS_LIST_FAILED' }
  return @($response.result.tools)
}
function Get-Health([int]$Port) {
  return Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
}
function Test-TunnelReady([int]$Port) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/readyz" -TimeoutSec 3
    return ($r.StatusCode -eq 200 -and $r.Content.Trim() -eq 'ready')
  } catch { return $false }
}
function Get-ProfileValue([string]$Path, [string]$Pattern) {
  $raw = Get-Content -LiteralPath $Path -Raw
  $match = [regex]::Match($raw, $Pattern)
  if (-not $match.Success) { return 0 }
  return [int]$match.Groups[1].Value
}
function Get-FreeBackendPorts([Collections.Generic.HashSet[int]]$Reserved) {
  $found = @()
  foreach ($port in 50000..59999) {
    if ($Reserved.Contains($port)) { continue }
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { continue }
    [void]$Reserved.Add($port); $found += $port
    if ($found.Count -eq 2) { return $found }
  }
  throw 'BACKEND_PORTS_UNAVAILABLE'
}
function Get-LegacyInventory {
  $legacyRoot = Resolve-ExactDirectory $LegacyRoot 'LEGACY_ROOT'
  if ([IO.Path]::GetFullPath($legacyRoot) -eq [IO.Path]::GetFullPath($Base)) { throw 'LEGACY_ROOT_MUST_NOT_EQUAL_BASE' }
  [void](Assert-PathUnder $Base $legacyRoot 'LEGACY_ROOT_OUTSIDE_BASE')
  $trackedStatus = @(Invoke-Git @('-C',$legacyRoot,'status','--porcelain=v1','--untracked-files=no'))
  if (@($trackedStatus | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count) { throw 'LEGACY_TRACKED_TREE_DIRTY' }
  if (-not (Test-Path -LiteralPath $ProfileRoot -PathType Container)) { throw 'TUNNEL_PROFILE_ROOT_MISSING' }
  $tunnels = @()
  $instanceByPort = @{}
  $reserved = [Collections.Generic.HashSet[int]]::new()
  foreach ($yaml in Get-ChildItem -LiteralPath $ProfileRoot -Filter '*.yaml' -File) {
    $profile = [IO.Path]::GetFileNameWithoutExtension($yaml.Name)
    Assert-Name $profile 'TUNNEL_PROFILE'
    $stablePort = Get-ProfileValue $yaml.FullName 'url:\s*["'']?http://127\.0\.0\.1:(\d+)/mcp'
    $healthPort = Get-ProfileValue $yaml.FullName 'listen_addr:\s*["'']?127\.0\.0\.1:(\d+)'
    if ($stablePort -lt 1024 -or $healthPort -lt 1024) { continue }
    [void]$reserved.Add($stablePort); [void]$reserved.Add($healthPort)
    $instanceProfile = if ($stablePort -eq 47831) { 'default' } else { $profile }
    $credential = Join-Path $Base "credentials\$profile.dpapi"
    if (-not (Test-Path -LiteralPath $credential -PathType Leaf)) { throw "CREDENTIAL_MISSING profile=$profile" }
    $tunnels += [pscustomobject]@{
      profile=$profile; instanceProfile=$instanceProfile; yamlPath=$yaml.FullName
      yamlSha256=(Get-Sha256 $yaml.FullName); profileDir=$ProfileRoot; credentialPath=$credential
      healthPort=$healthPort; routerPort=$stablePort
    }
    if (-not $instanceByPort.ContainsKey($stablePort)) {
      if ($instanceProfile -eq 'default') {
        $sourceConfig = if (Test-Path (Join-Path $legacyRoot 'config.local.json')) { Join-Path $legacyRoot 'config.local.json' } else { Join-Path $legacyRoot 'config.json' }
        $legacyMarker = Join-Path $legacyRoot 'var\mcp-runtime.json'
      } else {
        $sourceConfig = Join-Path $InstanceRoot "$instanceProfile\config.json"
        $legacyMarker = Join-Path $InstanceRoot "$instanceProfile\mcp-runtime.json"
      }
      if (-not (Test-Path -LiteralPath $sourceConfig -PathType Leaf)) { throw "INSTANCE_CONFIG_MISSING profile=$instanceProfile" }
      $raw = [IO.File]::ReadAllText($sourceConfig)
      $sha = (Get-FileHash -LiteralPath $sourceConfig -Algorithm SHA256).Hash.ToLowerInvariant()
      $cfg = $raw | ConvertFrom-Json
      if ([int]$cfg.port -ne $stablePort) { throw "INSTANCE_PORT_MISMATCH profile=$instanceProfile" }
      $ports = Get-FreeBackendPorts $reserved
      $stateDir = Join-Path $InstanceRoot $instanceProfile
      $instanceByPort[$stablePort] = [pscustomobject]@{
        profile=$instanceProfile; stablePort=$stablePort; configPath=(Join-Path $stateDir 'config.json')
        sourceConfigPath=$sourceConfig; configSha256=$sha; stateDir=$stateDir
        pointerPath=(Join-Path $stateDir 'active-backend.json'); routerConfigPath=(Join-Path $stateDir 'router.json')
        routerRuntimePath=(Join-Path $stateDir 'router-runtime.json'); backendPorts=@($ports)
        legacyMarkerPath=$legacyMarker; legacyProjectDir=$legacyRoot
      }
    } elseif ($instanceByPort[$stablePort].profile -ne $instanceProfile) { throw "INSTANCE_PROFILE_CONFLICT port=$stablePort" }
  }
  if ($tunnels.Count -eq 0 -or $instanceByPort.Count -eq 0) { throw 'MANAGED_INVENTORY_EMPTY' }
  return [pscustomobject]@{
    schema=1; base=$Base; controlRoot=$ControlRoot; legacyRoot=$legacyRoot; generatedAt=(Get-Date).ToUniversalTime().ToString('o')
    instances=@($instanceByPort.Values | Sort-Object stablePort)
    tunnelProfiles=@($tunnels | Sort-Object profile)
    tunnelClient=$null
  }
}
function Assert-ManagedState($Managed) {
  if ([int]$Managed.schema -ne 1) { throw 'MANAGED_SCHEMA_INVALID' }
  if ([IO.Path]::GetFullPath([string]$Managed.base) -ne [IO.Path]::GetFullPath($Base) -or [IO.Path]::GetFullPath([string]$Managed.controlRoot) -ne [IO.Path]::GetFullPath($ControlRoot)) { throw 'MANAGED_BASE_MISMATCH' }
  $profiles = @{}; $ports=@{}
  foreach ($instance in @($Managed.instances)) {
    $profile=[string]$instance.profile; Assert-Name $profile 'INSTANCE_PROFILE'
    if ($profiles.ContainsKey($profile)) { throw 'MANAGED_INSTANCE_DUPLICATE' }; $profiles[$profile] = $true
    $stateDir=Assert-PathUnder $InstanceRoot ([string]$instance.stateDir) 'MANAGED_STATE_PATH_OUTSIDE_INSTANCES'
    if([IO.Path]::GetFullPath($stateDir)-ne[IO.Path]::GetFullPath((Join-Path $InstanceRoot $profile))){throw 'MANAGED_INSTANCE_STATE_PATH_MISMATCH'}
    $expected=@{configPath=(Join-Path $stateDir 'config.json');pointerPath=(Join-Path $stateDir 'active-backend.json');routerConfigPath=(Join-Path $stateDir 'router.json');routerRuntimePath=(Join-Path $stateDir 'router-runtime.json')}
    foreach ($key in $expected.Keys) {
      if([IO.Path]::GetFullPath([string]$instance.$key)-ne[IO.Path]::GetFullPath([string]$expected[$key])){throw 'MANAGED_INSTANCE_PATH_MISMATCH'}
    }
    if(-not(Test-Path -LiteralPath ([string]$instance.configPath) -PathType Leaf)-or(Get-Sha256 ([string]$instance.configPath))-ne[string]$instance.configSha256){throw 'MANAGED_CONFIG_HASH_MISMATCH'}
    $instancePorts=@([int]$instance.stablePort)+@($instance.backendPorts|ForEach-Object{[int]$_})
    if(@($instance.backendPorts).Count-ne 2-or@($instancePorts|Select-Object -Unique).Count-ne 3){throw 'MANAGED_BACKEND_PORTS_INVALID'}
    foreach($port in $instancePorts){if($port-lt 1024-or$port-gt 65535-or$ports.ContainsKey($port)){throw 'MANAGED_PORT_CONFLICT'};$ports[$port]=$true}
  }
  $tunnelNames=@{};$healthPorts=@{}
  foreach ($tunnel in @($Managed.tunnelProfiles)) {
    $tunnelName=[string]$tunnel.profile;Assert-Name $tunnelName 'TUNNEL_PROFILE'
    if($tunnelNames.ContainsKey($tunnelName)){throw 'MANAGED_TUNNEL_DUPLICATE'};$tunnelNames[$tunnelName]=$true
    if (-not $profiles.ContainsKey([string]$tunnel.instanceProfile)) { throw 'TUNNEL_INSTANCE_UNKNOWN' }
    if ([string]$tunnel.yamlPath -match '(?i)tunnel_[A-Za-z0-9_-]+') { throw 'TUNNEL_SECRET_IN_REGISTRY' }
    if([IO.Path]::GetFullPath([string]$tunnel.profileDir)-ne[IO.Path]::GetFullPath($ProfileRoot)-or
       [IO.Path]::GetFullPath([string]$tunnel.yamlPath)-ne[IO.Path]::GetFullPath((Join-Path $ProfileRoot "$tunnelName.yaml"))-or
       [IO.Path]::GetFullPath([string]$tunnel.credentialPath)-ne[IO.Path]::GetFullPath((Join-Path $Base "credentials\$tunnelName.dpapi"))){throw 'MANAGED_TUNNEL_PATH_MISMATCH'}
    $targetInstance=@($Managed.instances|Where-Object profile -eq $tunnel.instanceProfile);if($targetInstance.Count-ne 1-or[int]$tunnel.routerPort-ne[int]$targetInstance[0].stablePort){throw 'MANAGED_TUNNEL_ROUTER_PORT_MISMATCH'}
    $health=[int]$tunnel.healthPort;if($health-lt 1024-or$health-gt 65535-or$ports.ContainsKey($health)-or$healthPorts.ContainsKey($health)){throw 'MANAGED_TUNNEL_HEALTH_PORT_CONFLICT'};$healthPorts[$health]=$true
    if (-not (Test-Path -LiteralPath ([string]$tunnel.yamlPath) -PathType Leaf) -or
        (Get-Sha256 ([string]$tunnel.yamlPath)) -ne [string]$tunnel.yamlSha256 -or -not(Test-Path -LiteralPath ([string]$tunnel.credentialPath) -PathType Leaf)) { throw 'TUNNEL_YAML_IDENTITY_DRIFT' }
  }
  if($profiles.Count-eq 0-or$tunnelNames.Count-eq 0){throw 'MANAGED_INVENTORY_EMPTY'}
  if ($Managed.tunnelClient) {
    $clientPath = Assert-PathUnder $Base ([string]$Managed.tunnelClient.path) 'TUNNEL_CLIENT_PATH_OUTSIDE_BASE'
    if(-not $clientPath.StartsWith([IO.Path]::GetFullPath($ControlRoot).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'TUNNEL_CLIENT_PATH_OUTSIDE_CONTROL'}
    if (-not (Test-Path -LiteralPath $clientPath -PathType Leaf)) { throw 'TUNNEL_CLIENT_MISSING' }
    if ((Get-Sha256 $clientPath) -ne ([string]$Managed.tunnelClient.sha256).ToLowerInvariant()) { throw 'TUNNEL_CLIENT_HASH_MISMATCH' }
  }
  return $Managed
}
function Read-BootstrapJournalRecord($Authority){$journal=Read-Json $BootstrapJournalPath 'BOOTSTRAP_TRANSACTION';$phase=if($journal.PSObject.Properties.Name-contains'phase'){[string]$journal.phase}else{''};if([int]$journal.schema-ne 1-or[string]$journal.commit-ne[string]$Authority.commit-or[string]$journal.releaseName-ne[string]$Authority.name-or($phase-and$phase-notin@('prepared','stable-accepted'))){throw 'BOOTSTRAP_TRANSACTION_AUTHORITY_MISMATCH'};return $journal}
function Read-BootstrapJournal($Authority){$journal=Read-BootstrapJournalRecord $Authority;$phase=if($journal.PSObject.Properties.Name-contains'phase'){[string]$journal.phase}else{'prepared'};if($phase-ne'prepared'){throw 'BOOTSTRAP_PREMANAGED_PHASE_REQUIRED'};$managed=Assert-ManagedState $journal.managed;if([IO.Path]::GetFullPath([string]$managed.legacyRoot)-ne[IO.Path]::GetFullPath($LegacyRoot)-or[string]$journal.legacyRegistry.runValue-notmatch[regex]::Escape((Join-Path $LegacyRoot 'autostart-windows.ps1'))){throw 'BOOTSTRAP_TRANSACTION_LEGACY_ROOT_MISMATCH'};Write-Status 'BOOTSTRAP_TRANSACTION_REUSED' "commit=$($Authority.commit)";return $managed}
function Set-BootstrapStableAccepted($Authority){$journal=Read-BootstrapJournalRecord $Authority;$phase=if($journal.PSObject.Properties.Name-contains'phase'){[string]$journal.phase}else{'prepared'};if($phase-ne'prepared'){throw 'BOOTSTRAP_STABLE_ACCEPTANCE_PHASE_INVALID'};$journal|Add-Member -NotePropertyName phase -NotePropertyValue 'stable-accepted' -Force;$journal|Add-Member -NotePropertyName stableAcceptedAt -NotePropertyValue ((Get-Date).ToUniversalTime().ToString('o')) -Force;Write-JsonAtomic $BootstrapJournalPath $journal}
function Remove-BootstrapJournalAfterManagedProof($Managed){Assert-ManagedServiceHealthy $Managed;if(Test-Path -LiteralPath $LegacyCleanupJournalPath){throw 'BOOTSTRAP_FINALIZE_CLEANUP_JOURNAL_PRESENT'};if($Managed.PSObject.Properties.Name-contains'legacyRoot'){throw 'BOOTSTRAP_FINALIZE_LEGACY_REFERENCE_PRESENT'};Remove-Item -LiteralPath $BootstrapJournalPath -Force -ErrorAction Stop;if(Test-Path -LiteralPath $BootstrapJournalPath){throw 'BOOTSTRAP_TRANSACTION_FINALIZE_FAILED'}}
function Get-SourceAuthority {
  $root = Resolve-ExactDirectory $CandidateRoot 'CANDIDATE_ROOT'
  if ($ExpectedCommit -notmatch $CommitPattern) { throw 'EXPECTED_COMMIT_INVALID' }
  $top = (Invoke-Git @('-C',$root,'rev-parse','--show-toplevel') | Select-Object -Last 1).Trim()
  if ([IO.Path]::GetFullPath($top).TrimEnd('\') -ne $root) { throw 'CANDIDATE_ROOT_NOT_GIT_ROOT' }
  $commit = (Invoke-Git @('-C',$root,'rev-parse','--verify',"$ExpectedCommit^{commit}") | Select-Object -Last 1).Trim().ToLowerInvariant()
  if ($commit -ne $ExpectedCommit.ToLowerInvariant()) { throw 'EXPECTED_COMMIT_MISMATCH' }
  $head = (Invoke-Git @('-C',$root,'rev-parse','HEAD') | Select-Object -Last 1).Trim().ToLowerInvariant()
  if ($head -ne $commit) { throw 'CANDIDATE_HEAD_NOT_EXPECTED_COMMIT' }
  $trackedStatus = @(Invoke-Git @('-C',$root,'status','--porcelain=v1','--untracked-files=no'))
  if (@($trackedStatus | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count) { throw 'CANDIDATE_TRACKED_TREE_DIRTY' }
  $shallow = ((Invoke-Git @('-C',$root,'rev-parse','--is-shallow-repository') | Select-Object -Last 1).Trim() -eq 'true')
  $historyDepth = [int]((Invoke-Git @('-C',$root,'rev-list','--count','HEAD') | Select-Object -Last 1).Trim())
  $packageRaw = (Invoke-Git @('-C',$root,'show',"$commit`:package.json") -join "`n")
  $version = [string](($packageRaw | ConvertFrom-Json).version)
  if ($version -notmatch '^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$') { throw 'RELEASE_VERSION_INVALID' }
  $name = "$version-$($commit.Substring(0,12))"
  return [pscustomobject]@{ root=$root; commit=$commit; version=$version; name=$name; releasePath=(Join-Path $ReleaseRoot $name); shallow=$shallow; historyDepth=$historyDepth; historyCoverage=if($shallow){'UNPROVEN_SHALLOW'}else{'LOCAL_HISTORY'} }
}
function Assert-ReleaseManifestExact([string]$Root, $Record, [string]$Code) {
  $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  $rootItem = Get-Item -LiteralPath $rootPath -Force -ErrorAction Stop
  if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "${Code}_ROOT_REPARSE_POINT" }
  if (Get-ChildItem -LiteralPath $rootPath -Directory -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint -or $_.LinkType } | Select-Object -First 1) { throw "${Code}_DIRECTORY_LINK_REFUSED" }
  $expected = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in @($Record.files)) {
    $relative = ([string]$entry.path).Replace('\','/').TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($relative) -or $relative -match '(^|/)\.\.(/|$)' -or $expected.ContainsKey($relative)) { throw "${Code}_MANIFEST_PATH_INVALID" }
    $expected.Add($relative,$entry)
  }
  $actual = @(Get-ChildItem -LiteralPath $rootPath -File -Recurse -Force)
  if ($actual.Count -ne $expected.Count) { throw "${Code}_FILE_SET_MISMATCH" }
  foreach ($file in $actual) {
    if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.LinkType) { throw "${Code}_FILE_LINK_REFUSED" }
    $relative = [IO.Path]::GetRelativePath($rootPath,$file.FullName).Replace('\','/')
    if (-not $expected.ContainsKey($relative)) { throw "${Code}_EXTRA_FILE" }
    $entry = $expected[$relative]
    if ([int64]$entry.bytes -ne [int64]$file.Length -or [string]$entry.sha256 -ne (Get-Sha256 $file.FullName)) { throw "${Code}_FILE_INTEGRITY_MISMATCH" }
  }
}
function Prepare-Release($Authority) {
  Add-Plan 'release' 'git archive exact commit' $Authority.releasePath
  if ($PlanOnly) { return $Authority.releasePath }
  New-Item -ItemType Directory -Force -Path $ReleaseRoot,(Join-Path $ControlRoot 'release-records') | Out-Null
  $recordPath = Join-Path $ControlRoot "release-records\$($Authority.name).json"
  if (Test-Path -LiteralPath $Authority.releasePath -PathType Container) {
    $record = Read-Json $recordPath 'RELEASE_RECORD'
    if ([string]$record.commit -ne $Authority.commit -or [string]$record.version -ne $Authority.version) { throw 'RELEASE_IDENTITY_CONFLICT' }
    Assert-ReleaseManifestExact $Authority.releasePath $record 'RELEASE_INTEGRITY'
    return $Authority.releasePath
  }
  $stage = Join-Path $Base "staging\$([guid]::NewGuid().ToString('N'))"
  $validation = Join-Path $stage 'validation'
  $archive = Join-Path $stage 'release.zip'
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  try {
    [void](Invoke-Git @('-C',$Authority.root,'archive','--format=zip',"--output=$archive",$Authority.commit))
    Expand-Archive -LiteralPath $archive -DestinationPath $validation -Force
    Invoke-NpmGate $validation @('run','check') 'check'
    Invoke-NpmGate $validation @('test') 'test'
    Invoke-NpmGate $Authority.root @('run','audit') 'audit-source-history'
    $finalStage = Join-Path $stage 'final'
    Expand-Archive -LiteralPath $archive -DestinationPath $finalStage -Force
    $files = @(Get-ChildItem -LiteralPath $finalStage -File -Recurse | Sort-Object FullName | ForEach-Object {
      [pscustomobject]@{ path=[IO.Path]::GetRelativePath($finalStage,$_.FullName); sha256=(Get-Sha256 $_.FullName); bytes=$_.Length }
    })
    Assert-ReleaseManifestExact $finalStage ([pscustomobject]@{files=$files}) 'RELEASE_CREATED'
    Write-JsonAtomic $recordPath ([ordered]@{ schema=1; version=$Authority.version; commit=$Authority.commit; archiveSha256=(Get-Sha256 $archive); shallow=[bool]$Authority.shallow; historyDepth=[int]$Authority.historyDepth; historyCoverage=[string]$Authority.historyCoverage; files=$files })
    foreach ($file in Get-ChildItem -LiteralPath $finalStage -File -Recurse) { $file.IsReadOnly = $true }
    Move-Item -LiteralPath $finalStage -Destination $Authority.releasePath
    return $Authority.releasePath
  } finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  }
}
function Initialize-PersistentConfigs($Managed) {
  foreach ($instance in @($Managed.instances)) {
    New-Item -ItemType Directory -Force -Path $instance.stateDir,(Join-Path $instance.stateDir 'slots') | Out-Null
    if (Test-Path -LiteralPath $instance.configPath -PathType Leaf) {
      if ((Get-Sha256 $instance.configPath) -ne [string]$instance.configSha256) { throw "PERSISTENT_CONFIG_DRIFT profile=$($instance.profile)" }
    } else {
      $bytes = [IO.File]::ReadAllBytes([string]$instance.sourceConfigPath)
      $temporary="$($instance.configPath).new-$PID-$([guid]::NewGuid().ToString('N'))"
      [IO.File]::WriteAllBytes($temporary, $bytes)
      if ((Get-Sha256 $temporary) -ne [string]$instance.configSha256) { Remove-Item -LiteralPath $temporary -Force; throw 'PERSISTENT_CONFIG_COPY_FAILED' }
      Move-Item -LiteralPath $temporary -Destination ([string]$instance.configPath)
    }
  }
}
function Install-StableControl($ReleasePath, $Managed, $Authority) {
  Add-Plan 'control' 'install stable router/supervisor/tunnel client' $ControlRoot
  if ($PlanOnly) { return }
  New-Item -ItemType Directory -Force -Path (Join-Path $ControlRoot 'src'),(Join-Path $ControlRoot 'tools'),(Join-Path $ControlRoot 'logs') | Out-Null
  $controlFiles = @('src\router.mjs','src\router-state.mjs','src\transport-guard.mjs','tools\router-control.mjs','bluegreen-windows.ps1','bluegreen-supervisor-windows.ps1','RUN_BLUEGREEN.ps1')
  $existingControl = Test-Path -LiteralPath (Join-Path $ControlRoot 'control-manifest.json') -PathType Leaf
  $manifestFiles = @()
  foreach ($relative in $controlFiles) {
    $source = Join-Path $ReleasePath $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "CONTROL_SOURCE_MISSING file=$relative" }
    $target = Join-Path $ControlRoot $relative
    $sourceSha = Get-Sha256 $source
    if (Test-Path -LiteralPath $target -PathType Leaf) {
      if ((Get-Sha256 $target) -ne $sourceSha) { throw "CONTROL_REVISION_CHANGE_REFUSED file=$relative" }
    } else {
      if ($existingControl) { throw "CONTROL_FILE_MISSING_FAIL_CLOSED file=$relative" }
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
      $temporary = "$target.new-$PID-$([guid]::NewGuid().ToString('N'))"
      Copy-Item -LiteralPath $source -Destination $temporary
      if ((Get-Sha256 $temporary) -ne $sourceSha) { Remove-Item -LiteralPath $temporary -Force; throw 'CONTROL_COPY_HASH_MISMATCH' }
      Move-Item -LiteralPath $temporary -Destination $target
    }
    $manifestFiles += [pscustomobject]@{ path=$relative; sha256=$sourceSha }
  }
  $controlManifestPath = Join-Path $ControlRoot 'control-manifest.json'
  if ($existingControl) {
    $currentManifest = Read-Json $controlManifestPath 'CONTROL_MANIFEST'
    if ([int]$currentManifest.schema -ne 1 -or @($currentManifest.files).Count -ne $controlFiles.Count) { throw 'CONTROL_MANIFEST_FILE_SET_INVALID' }
    $seenControl=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($item in @($currentManifest.files)) {
      $relative=([string]$item.path).Replace('/','\')
      if($relative -notin $controlFiles -or -not $seenControl.Add($relative)){throw 'CONTROL_MANIFEST_FILE_SET_INVALID'}
      $target = Assert-PathUnder $ControlRoot (Join-Path $ControlRoot $relative) 'CONTROL_MANIFEST_PATH_INVALID'
      if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or (Get-Sha256 $target) -ne [string]$item.sha256) { throw 'CONTROL_MANIFEST_INTEGRITY_FAILED' }
    }
  } else {
    Write-JsonAtomic $controlManifestPath ([ordered]@{ schema=1; version=$Authority.version; commit=$Authority.commit; files=$manifestFiles })
  }
  $legacyGuiStop=Join-Path $LegacyRoot 'var\GUI_STOP';$stableGuiStop=Join-Path $ControlRoot 'GUI_STOP'
  if(Test-Path -LiteralPath $legacyGuiStop -PathType Leaf){$item=Assert-LegacyFileSafe $legacyGuiStop;if(-not(Test-Path -LiteralPath $stableGuiStop)){[IO.File]::WriteAllBytes($stableGuiStop,[IO.File]::ReadAllBytes($legacyGuiStop))};if((Get-Sha256 $stableGuiStop)-ne(Get-Sha256 $legacyGuiStop)){throw 'GUI_STOP_MIGRATION_HASH_MISMATCH'};Write-Status 'GUI_STOP_MIGRATED' 'owner stop remains active at stable control path'}
  if (-not $Managed.tunnelClient) {
    $legacyStatePath = Join-Path $LegacyRoot 'var\tunnel-client.json'
    $state = Read-Json $legacyStatePath 'TUNNEL_CLIENT_STATE'
    $sourceExe = [IO.Path]::GetFullPath([string]$state.path)
    if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf) -or (Get-Sha256 $sourceExe) -ne ([string]$state.sha256).ToLowerInvariant()) { throw 'TUNNEL_CLIENT_SOURCE_HASH_MISMATCH' }
    $destDir = Join-Path $ControlRoot "tunnel-client\$($state.version)-$(([string]$state.sha256).Substring(0,12))"
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    $destExe = Join-Path $destDir 'tunnel-client.exe'
    Copy-Item -LiteralPath $sourceExe -Destination $destExe -Force
    if ((Get-Sha256 $destExe) -ne ([string]$state.sha256).ToLowerInvariant()) { throw 'TUNNEL_CLIENT_STABLE_HASH_MISMATCH' }
    $stableState = [ordered]@{ schema=1; version=[string]$state.version; path=$destExe; sha256=([string]$state.sha256).ToLowerInvariant() }
    Write-JsonAtomic (Join-Path $ControlRoot 'tunnel-client.json') $stableState
    $Managed.tunnelClient = [pscustomobject]@{
      schema=1; version=[string]$state.version; path=$destExe
      sha256=([string]$state.sha256).ToLowerInvariant(); legacyPath=$sourceExe
    }
  }
}
function Get-SlotPaths($Instance, [string]$SlotId) {
  Assert-Name $SlotId 'SLOT_ID'
  $root = Join-Path ([string]$Instance.stateDir) "slots\$SlotId"
  return [pscustomobject]@{
    root=$root; runtimeState=(Join-Path $root 'runtime.json'); auditLog=(Join-Path $root 'audit.jsonl')
    drainFile=(Join-Path $root 'drain'); stdout=(Join-Path $root 'backend.out.log'); stderr=(Join-Path $root 'backend.err.log')
  }
}
function Start-CandidateBackend($Instance, $Authority, [string]$ReleasePath, [string]$SlotId, [int]$Port) {
  $slot = Get-SlotPaths $Instance $SlotId
  if ($PlanOnly) { Add-Plan 'candidate' "start profile=$($Instance.profile) slot=$SlotId port=$Port" $ReleasePath; return $null }
  New-Item -ItemType Directory -Force -Path $slot.root | Out-Null
  if (Test-Path -LiteralPath $slot.drainFile) { Remove-Item -LiteralPath $slot.drainFile -Force }
  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) { throw "CANDIDATE_PORT_OCCUPIED_UNKNOWN port=$Port pid=$($listener.OwningProcess)" }
  if ((Get-Sha256 $Instance.configPath) -ne [string]$Instance.configSha256) { throw 'CANDIDATE_CONFIG_HASH_DRIFT' }
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $environment = @{
    REMOTE_COMMANDER_CONFIG=[string]$Instance.configPath; REMOTE_COMMANDER_LISTEN_PORT=[string]$Port
    REMOTE_COMMANDER_RUNTIME_STATE=$slot.runtimeState; REMOTE_COMMANDER_AUDIT_LOG=$slot.auditLog
    REMOTE_COMMANDER_DRAIN_FILE=$slot.drainFile; REMOTE_COMMANDER_RELEASE_COMMIT=$Authority.commit
    REMOTE_COMMANDER_SLOT_ID=$SlotId; REMOTE_COMMANDER_GUI_STOP_FILE=(Join-Path $ControlRoot 'GUI_STOP')
  }
  $process = Start-Process -FilePath $node -ArgumentList @((Join-Path $ReleasePath 'src\server-v0.3.mjs')) -WorkingDirectory $ReleasePath -WindowStyle Hidden -PassThru -Environment $environment -RedirectStandardOutput $slot.stdout -RedirectStandardError $slot.stderr
  foreach ($i in 1..80) {
    Assert-Deadline
    Start-Sleep -Milliseconds 250
    if ($process.HasExited) { break }
    try {
      $health = Get-Health $Port
      if ($health.ok -and [string]$health.backend.profile -eq [string]$Instance.profile -and [string]$health.backend.version -eq [string]$Authority.version -and [string]$health.backend.commit -eq $Authority.commit -and [string]$health.backend.slotId -eq $SlotId -and [int]$health.backend.port -eq $Port -and [int]$health.backendPort -eq $Port -and [int]$health.advertisedPort -eq [int]$Instance.stablePort -and [string]$health.backend.configSha256 -eq [string]$Instance.configSha256 -and [IO.Path]::GetFullPath([string]$health.backend.projectDir) -eq [IO.Path]::GetFullPath($ReleasePath)) {
        $marker = Read-Json $slot.runtimeState 'CANDIDATE_RUNTIME_MARKER'
        $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -First 1
        if ([int]$listener.OwningProcess -ne [int]$process.Id -or [int]$marker.pid -ne [int]$process.Id -or
            -not (Test-SameBackend $marker.backend $health.backend)) { throw 'CANDIDATE_RUNTIME_OWNERSHIP_MISMATCH' }
        return $health.backend
      }
    } catch {}
  }
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  throw "CANDIDATE_START_FAILED profile=$($Instance.profile)"
}
function Assert-UpgradeSafe([int]$Port, [switch]$RequireDrain) {
  $status = Invoke-Rpc $Port 'upgrade_status'
  if ($RequireDrain -and $status.draining -ne $true) { throw 'DRAIN_FENCE_NOT_ACTIVE' }
  if (-not $RequireDrain -and $status.draining -eq $true) { throw 'UNEXPECTED_DRAIN_FENCE' }
  if ([int]$status.activeCalls -ne 0 -or [int]$status.activeMutations -ne 0 -or [int]$status.lockStats.activeOperations -ne 0 -or [int]$status.lockStats.queued -ne 0) { throw 'BACKEND_MUTATION_NOT_DRAINED' }
  if ([int]$status.terminals.running -ne 0) { throw 'BACKEND_TERMINAL_NOT_DRAINED' }
  if ($status.gui.leased -or $status.gui.busy -or $status.gui.uncertain -or $status.gui.frame) { throw 'BACKEND_GUI_NOT_DRAINED' }
  if ([int]$status.workflows.running -ne 0 -or [int]$status.workflows.uncertain -ne 0) { throw 'BACKEND_WORKFLOW_NOT_DRAINED' }
  return $status
}
function Test-PolicyBlocks([object[]]$Patterns, [string[]]$Samples) {
  foreach ($sample in $Samples) {
    $blocked = $false
    foreach ($pattern in $Patterns) {
      try { if ($sample -match [string]$pattern) { $blocked = $true; break } }
      catch { throw 'POWER_BLOCK_PATTERN_INVALID' }
    }
    if (-not $blocked) { return $false }
  }
  return $true
}
function Invoke-CandidateRuntimeGates($Instance, $Backend, [string]$ReleasePath) {
  $port = [int]$Backend.port
  $config = Read-Json ([string]$Instance.configPath) 'CANDIDATE_CONFIG'
  $system = Invoke-Rpc $port 'system_status'
  if ([string]$system.role -ne 'backend' -or [string]$system.version -ne [string]$Backend.version -or
      [string]$system.releaseCommit -ne [string]$Backend.commit -or [string]$system.slotId -ne [string]$Backend.slotId -or
      [string]$system.configSha256 -ne [string]$Instance.configSha256 -or [int]$system.backend.port -ne $port -or [int]$system.backendPort -ne $port -or [int]$system.advertisedPort -ne [int]$Instance.stablePort -or
      [IO.Path]::GetFullPath([string]$system.projectDir) -ne [IO.Path]::GetFullPath($ReleasePath) -or
      -not (Test-SameBackend $system.backend $Backend)) { throw 'CANDIDATE_SYSTEM_IDENTITY_FAILED' }
  $hasInstance = $config.PSObject.Properties.Name -contains 'instance'
  $expectedProfile = if ($hasInstance -and $config.instance.profile) { [string]$config.instance.profile } else { 'default' }
  $expectedIsolated = if ($hasInstance) { [bool]$config.instance.isolated } else { $false }
  if ([string]$system.instance.profile -ne $expectedProfile -or [bool]$system.instance.isolated -ne $expectedIsolated -or
      [string]$system.instance.profile -ne [string]$Instance.profile) { throw 'CANDIDATE_INSTANCE_IDENTITY_FAILED' }
  if ($system.durableWorkflows.enabled -ne $true) { throw 'CANDIDATE_DURABLE_WORKFLOWS_REQUIRED' }
  if ($system.powerMode.enabled -ne $true -or $system.powerMode.fullFilesystem -ne $true -or
      $system.powerMode.allowPermanentDelete -ne $false -or $system.guiControl.enabled -ne $true) {
    throw 'CANDIDATE_SYSTEM_POLICY_FAILED'
  }
  $names = @(Invoke-ToolsList $port | ForEach-Object name)
  foreach ($required in @('system_status','upgrade_status','power_status','gui_status')) { if ($required -notin $names) { throw "CANDIDATE_TOOL_MISSING name=$required" } }
  $requiredGui = @('gui_status','gui_session_begin','gui_session_renew','gui_session_end','gui_screenshot','gui_cursor_position','gui_list_windows','gui_mouse_move','gui_mouse_delta','gui_mouse_scroll','gui_mouse_click','gui_mouse_drag','gui_type_text','gui_key_press','gui_focus_window')
  foreach ($required in $requiredGui) { if ($required -notin $names) { throw "CANDIDATE_GUI_TOOL_MISSING name=$required" } }
  $guiToolCount = @($names | Where-Object { $_ -like 'gui_*' }).Count
  if ($names.Count -lt 48 -or $guiToolCount -lt 15) { throw "CANDIDATE_TOOL_COUNT_REGRESSION total=$($names.Count) gui=$guiToolCount" }
  [void](Invoke-Rpc $port 'workflow_status')
  $power = Invoke-Rpc $port 'power_status'
  if ($power.enabled -ne $true -or $power.fullFilesystem -ne $true -or $power.allowPermanentDelete -ne $false -or
      $power.guiControl.enabled -ne $true) { throw 'CANDIDATE_POWER_STATUS_POLICY_FAILED' }
  $patterns = @($power.blockedShellPatterns)
  if (-not (Test-PolicyBlocks $patterns @('shutdown.exe /s /t 0','Restart-Computer','logoff.exe'))) {
    throw 'CANDIDATE_POWER_GUARDS_MISSING'
  }
  $gui = Invoke-Rpc $port 'gui_status'
  if ($gui.leased -or $gui.busy -or $gui.uncertain) { throw 'CANDIDATE_GUI_COORDINATION_UNSAFE' }
  [void](Assert-UpgradeSafe $port)
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  & $node (Join-Path $ReleasePath 'tools\doctor.mjs') --url "http://127.0.0.1:$port/mcp" --expected-device ([string]$system.deviceName) --expected-version ([string]$system.version) --config ([string]$Instance.configPath) --json
  if ($LASTEXITCODE -ne 0) { throw 'CANDIDATE_DOCTOR_FAILED' }
  Write-Status 'CANDIDATE_GATES_PASS' "profile=$($Instance.profile) port=$port tools=$($names.Count) guiTools=$guiToolCount"
}
function Assert-LegacySafe($Instance) {
  $port = [int]$Instance.stablePort
  $system = Invoke-Rpc $port 'system_status'
  if ([int]$system.concurrency.activeOperations -ne 0 -or [int]$system.concurrency.queued -ne 0 -or
      [int]$system.concurrency.activeCalls -ne 0 -or [int]$system.concurrency.activeMutations -ne 0) { throw 'LEGACY_ACTIVE_OPERATIONS' }
  $gui = Invoke-Rpc $port 'gui_status'
  if ($gui.leased -or $gui.busy -or $gui.uncertain) { throw 'LEGACY_GUI_BUSY' }
  if ($system.durableWorkflows.enabled) {
    [void](Invoke-Rpc $port 'workflow_status')
    $list = Invoke-Rpc $port 'workflow_list'
    foreach ($workflow in @($list.workflows)) {
      $resume = Invoke-Rpc $port 'workflow_resume' @{ id=[string]$workflow.id }
      if (@($resume.unresolved).Count -gt 0 -or @($resume.blockers).Count -gt 0) { throw 'LEGACY_WORKFLOW_UNRESOLVED' }
      $pending = @($resume.state.steps | Where-Object { $_.status -eq 'pending' })
      if ($pending.Count -gt 0 -and $resume.readyForNextStep -ne $true) { throw 'LEGACY_WORKFLOW_NOT_READY' }
    }
  }
  $marker = Read-Json ([string]$Instance.legacyMarkerPath) 'LEGACY_RUNTIME_MARKER'
  $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop | Select-Object -First 1
  if ([int]$marker.pid -ne [int]$listener.OwningProcess -or [int]$marker.port -ne $port -or [string]$marker.instance.profile -ne [string]$Instance.profile -or [IO.Path]::GetFullPath([string]$marker.projectDir) -ne [IO.Path]::GetFullPath([string]$Instance.legacyProjectDir)) { throw 'LEGACY_OWNERSHIP_MISMATCH' }
  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($marker.pid)" -ErrorAction Stop)
  if ($children.Count -gt 0) { throw 'LEGACY_BACKEND_CHILD_TERMINAL_PRESENT' }
}
function Get-TunnelProcess([string]$Profile, [string]$Exe, [string]$ProfileDir) {
  $escaped = [regex]::Escape($Profile); $expected = [IO.Path]::GetFullPath($Exe)
  $rx = '--profile(?:=|\s+)["'']?' + $escaped + '["'']?(?:\s|$)';$dirRx='--profile-dir(?:=|\s+)["'']?'+[regex]::Escape([IO.Path]::GetFullPath($ProfileDir))+'["'']?(?:\s|$)'
  return @(Get-CimInstance Win32_Process -Filter "Name='tunnel-client.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -and [IO.Path]::GetFullPath([string]$_.ExecutablePath) -eq $expected -and $_.CommandLine -match $rx -and $_.CommandLine -match $dirRx
  })
}
function Stop-ExactTunnelProfiles($Managed) {
  $executables = @([string]$Managed.tunnelClient.path)
  if ($Managed.tunnelClient.PSObject.Properties.Name -contains 'legacyPath' -and $Managed.tunnelClient.legacyPath) {
    $executables += [string]$Managed.tunnelClient.legacyPath
  }
  $executables = @($executables | ForEach-Object { [IO.Path]::GetFullPath($_) } | Select-Object -Unique)
  foreach ($exe in $executables) {
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'TUNNEL_CLIENT_OWNED_BINARY_MISSING' }
    if ((Get-Sha256 $exe) -ne [string]$Managed.tunnelClient.sha256) { throw 'TUNNEL_CLIENT_OWNED_BINARY_HASH_MISMATCH' }
  }
  foreach ($tunnel in @($Managed.tunnelProfiles)) {
    $processes = @($executables | ForEach-Object { @(Get-TunnelProcess ([string]$tunnel.profile) $_ ([string]$tunnel.profileDir)) } | Where-Object { $_ })
    if ($processes.Count -gt 1) { throw "MULTIPLE_TUNNEL_PROCESSES profile=$($tunnel.profile)" }
    if ($processes.Count -eq 1) { Stop-Process -Id ([int]$processes[0].ProcessId) -Force -ErrorAction Stop }
    foreach ($i in 1..40) { if (-not (Test-TunnelReady ([int]$tunnel.healthPort))) { break }; Start-Sleep -Milliseconds 250 }
    if (Test-TunnelReady ([int]$tunnel.healthPort)) { throw "TUNNEL_ADMISSION_FENCE_FAILED profile=$($tunnel.profile)" }
  }
}
function Stop-LegacySupervisor {
  $legacy = [IO.Path]::GetFullPath((Join-Path $LegacyRoot 'autostart-windows.ps1'))
  if (-not (Test-Path -LiteralPath $legacy -PathType Leaf)) { throw 'LEGACY_SUPERVISOR_SCRIPT_MISSING' }
  $runValue = (Get-ItemProperty -Path $RunKey -Name $RunName -ErrorAction Stop).$RunName
  $spec=Get-LegacySupervisorSpec ([string]$runValue) $legacy
  $bgExists=Test-Path -LiteralPath $RegistryPath;$bgManaged=$null;$bgManagedExists=$false
  if($bgExists){$bg=Get-ItemProperty -Path $RegistryPath -ErrorAction Stop;if($bg.PSObject.Properties.Name -contains 'ManagedStatePath'){$bgManagedExists=$true;$bgManaged=[string]$bg.ManagedStatePath}}
  $Script:LegacySupervisorAuthority = [pscustomobject]@{script=$legacy;runValue=[string]$runValue;blueGreenExisted=$bgExists;managedExisted=$bgManagedExists;managedValue=$bgManaged}
  $set=Get-PowerShellIdentitySet $spec.script $spec.executable $spec.arguments;if($set.mentions.Count-ne$set.exact.Count){throw 'LEGACY_SUPERVISOR_PROCESS_IDENTITY_UNKNOWN'};if($set.exact.Count-gt 1){throw 'MULTIPLE_LEGACY_SUPERVISORS'}
  if($set.exact.Count-eq 1){$pidToStop=[int]$set.exact[0].ProcessId;Stop-Process -Id $pidToStop -Force -ErrorAction Stop;foreach($i in 1..40){if(-not(Get-Process -Id $pidToStop -ErrorAction SilentlyContinue)){return};Start-Sleep -Milliseconds 250};throw 'LEGACY_SUPERVISOR_STOP_TIMEOUT'}
}
function Start-LegacySupervisorRollback($Managed) {
  if (-not $Script:LegacySupervisorAuthority) { throw 'LEGACY_SUPERVISOR_ROLLBACK_AUTHORITY_MISSING' }
  $current = (Get-ItemProperty -Path $RunKey -Name $RunName -ErrorAction Stop).$RunName
  if ([string]$current -ne [string]$Script:LegacySupervisorAuthority.runValue) { throw 'LEGACY_SUPERVISOR_ROLLBACK_REGISTRY_DRIFT' }
  $spec=Get-LegacySupervisorSpec ([string]$current) ([string]$Script:LegacySupervisorAuthority.script);$set=Get-PowerShellIdentitySet $spec.script $spec.executable $spec.arguments;if($set.mentions.Count-ne$set.exact.Count){throw 'LEGACY_SUPERVISOR_PROCESS_IDENTITY_UNKNOWN'};if($set.exact.Count-gt 1){throw 'MULTIPLE_LEGACY_SUPERVISORS'};if(-not$set.exact.Count){Start-Process -FilePath $spec.executable -ArgumentList $spec.arguments -WindowStyle Hidden|Out-Null;foreach($i in 1..40){$set=Get-PowerShellIdentitySet $spec.script $spec.executable $spec.arguments;if($set.mentions.Count-ne$set.exact.Count){throw 'LEGACY_SUPERVISOR_PROCESS_IDENTITY_UNKNOWN'};if($set.exact.Count-eq 1){break};Start-Sleep -Milliseconds 250};if($set.exact.Count-ne 1){throw 'LEGACY_SUPERVISOR_ROLLBACK_START_FAILED'}}
  foreach ($instance in @($Managed.instances)) {
    $ready = $false
    foreach ($i in 1..80) { Start-Sleep -Milliseconds 250; try { if ((Get-Health ([int]$instance.stablePort)).ok) { $ready=$true; break } } catch {} }
    if (-not $ready) { throw "LEGACY_BACKEND_ROLLBACK_FAILED profile=$($instance.profile)" }
    Wait-TunnelsForInstance $Managed ([string]$instance.profile)
  }
}
function Restore-LegacyRegistry{
  $a=$Script:LegacySupervisorAuthority;if(-not$a){throw 'LEGACY_REGISTRY_ROLLBACK_AUTHORITY_MISSING'};$current=(Get-ItemProperty -Path $RunKey -Name $RunName -ErrorAction Stop).$RunName;$stable=Join-Path $ControlRoot 'bluegreen-supervisor-windows.ps1';if([string]$current-ne[string]$a.runValue-and[string]$current-notmatch[regex]::Escape($stable)){throw 'LEGACY_REGISTRY_ROLLBACK_RUN_DRIFT'};Set-ItemProperty -Path $RunKey -Name $RunName -Value ([string]$a.runValue)
  if($a.managedExisted){New-Item -Path $RegistryPath -Force|Out-Null;New-ItemProperty -Path $RegistryPath -Name ManagedStatePath -Value ([string]$a.managedValue) -PropertyType String -Force|Out-Null}else{Remove-ItemProperty -Path $RegistryPath -Name ManagedStatePath -ErrorAction SilentlyContinue;if(-not$a.blueGreenExisted-and(Test-Path -LiteralPath $RegistryPath)){Remove-Item -LiteralPath $RegistryPath -Force}}
  if([string](Get-ItemProperty -Path $RunKey -Name $RunName -ErrorAction Stop).$RunName-ne[string]$a.runValue){throw 'LEGACY_REGISTRY_ROLLBACK_VERIFY_FAILED'}
}
function Stop-OwnedBackend([string]$MarkerPath, $ExpectedBackend) {
  $marker = Read-Json $MarkerPath 'BACKEND_RUNTIME_MARKER'
  $listener = Get-NetTCPConnection -State Listen -LocalPort ([int]$ExpectedBackend.port) -ErrorAction Stop | Select-Object -First 1
  if ([int]$marker.pid -ne [int]$listener.OwningProcess -or [int]$marker.backend.port -ne [int]$ExpectedBackend.port -or [string]$marker.backend.profile -ne [string]$ExpectedBackend.profile -or [string]$marker.backend.commit -ne [string]$ExpectedBackend.commit -or [string]$marker.backend.slotId -ne [string]$ExpectedBackend.slotId -or [IO.Path]::GetFullPath([string]$marker.backend.projectDir) -ne [IO.Path]::GetFullPath([string]$ExpectedBackend.projectDir)) { throw 'BACKEND_STOP_OWNERSHIP_MISMATCH' }
  Stop-Process -Id ([int]$marker.pid) -Force -ErrorAction Stop
  foreach ($i in 1..40) { if (-not (Get-NetTCPConnection -State Listen -LocalPort ([int]$ExpectedBackend.port) -ErrorAction SilentlyContinue)) { return }; Start-Sleep -Milliseconds 250 }
  throw 'BACKEND_STOP_TIMEOUT'
}
function Stop-OwnedBackendIfRunning([string]$MarkerPath, $ExpectedBackend) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort ([int]$ExpectedBackend.port) -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) { return }
  Stop-OwnedBackend $MarkerPath $ExpectedBackend
}
function Test-SameBackend($Left, $Right) {
  if (-not $Left -or -not $Right) { return $false }
  foreach ($key in @('profile','version','configSha256','commit','slotId','projectDir','port')) {
    if ([string]$Left.$key -ne [string]$Right.$key) { return $false }
  }
  return $true
}
function Stop-InactiveCandidates($Managed, $Candidates) {
  foreach ($instance in @($Managed.instances)) {
    $candidate = $Candidates[[string]$instance.profile]
    if (-not $candidate) { continue }
    $isActive = $false
    if (Test-Path -LiteralPath ([string]$instance.pointerPath) -PathType Leaf) {
      try { $isActive = Test-SameBackend (Read-Json ([string]$instance.pointerPath) 'ROUTER_POINTER').backend $candidate }
      catch { throw "CANDIDATE_CLEANUP_POINTER_UNVERIFIED profile=$($instance.profile)" }
    }
    if (-not $isActive) {
      $slot = Get-SlotPaths $instance ([string]$candidate.slotId)
      Stop-OwnedBackendIfRunning $slot.runtimeState $candidate
      Write-Status 'CANDIDATE_CLEANUP_PASS' "profile=$($instance.profile) slot=$($candidate.slotId)"
    }
  }
}
function Recover-PreManagedBootstrapArtifacts($Managed) {
  $journal=Read-Json $BootstrapJournalPath 'BOOTSTRAP_TRANSACTION';$legacySupervisor=[IO.Path]::GetFullPath((Join-Path $LegacyRoot 'autostart-windows.ps1'));$runValue=(Get-ItemProperty -Path $RunKey -Name $RunName -ErrorAction Stop).$RunName;$stableSupervisor=Join-Path $ControlRoot 'bluegreen-supervisor-windows.ps1'
  if([string]$runValue-notmatch[regex]::Escape($legacySupervisor)-and[string]$runValue-notmatch[regex]::Escape($stableSupervisor)){throw 'PREMANAGED_RECOVERY_REGISTRY_UNKNOWN'}
  $stableState=(Test-Path -LiteralPath $ManagedPath)-or([string]$runValue-match[regex]::Escape($stableSupervisor));$recovered=@{}
  foreach($instance in @($Managed.instances)){
    if(Test-Path -LiteralPath ([string]$instance.pointerPath)){$stableState=$true;$pointer=Read-Json ([string]$instance.pointerPath) 'PREMANAGED_POINTER';$backend=$pointer.backend;$expectedPort=if([string]$backend.slotId-eq'blue'){[int]$instance.backendPorts[0]}elseif([string]$backend.slotId-eq'green'){[int]$instance.backendPorts[1]}else{0};if([string]$backend.profile-ne[string]$instance.profile-or[string]$backend.configSha256-ne[string]$instance.configSha256-or[string]$backend.commit-ne[string]$journal.commit-or[int]$backend.port-ne$expectedPort-or[IO.Path]::GetFullPath((Split-Path -Parent ([string]$backend.projectDir)))-ne[IO.Path]::GetFullPath($ReleaseRoot)){throw 'PREMANAGED_POINTER_IDENTITY_UNPROVEN'};$recovered[[string]$instance.profile]=$backend};if(Test-Path -LiteralPath ([string]$instance.routerConfigPath)){$stableState=$true}
    foreach($slotId in @('blue','green')){
      $port=if($slotId-eq'blue'){[int]$instance.backendPorts[0]}else{[int]$instance.backendPorts[1]}
      $listener=Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue|Select-Object -First 1
      if(-not $listener){continue}
      $slot=Get-SlotPaths $instance $slotId
      $marker=Read-Json $slot.runtimeState 'PREMANAGED_RUNTIME_MARKER'
      $backend=$marker.backend
      if([int]$marker.pid-ne[int]$listener.OwningProcess-or[string]$backend.profile-ne[string]$instance.profile-or
         [string]$backend.configSha256-ne[string]$instance.configSha256-or[int]$backend.port-ne$port-or[string]$backend.slotId-ne$slotId-or
         [string]$backend.commit-ne[string]$journal.commit-or[IO.Path]::GetFullPath((Split-Path -Parent ([string]$backend.projectDir)))-ne[IO.Path]::GetFullPath($ReleaseRoot)){
        throw 'PREMANAGED_RECOVERY_LISTENER_OWNERSHIP_UNPROVEN'
      }
      $leaf="$($backend.version)-$(([string]$backend.commit).Substring(0,12))"
      if([IO.Path]::GetFileName([string]$backend.projectDir)-ne$leaf){throw 'PREMANAGED_RECOVERY_RELEASE_NAME_MISMATCH'}
      $record=Read-Json (Join-Path $ControlRoot "release-records\$leaf.json") 'PREMANAGED_RELEASE_RECORD'
      if([int]$record.schema-ne 1-or[string]$record.version-ne[string]$backend.version-or[string]$record.commit-ne[string]$backend.commit){throw 'PREMANAGED_RECOVERY_RELEASE_IDENTITY_MISMATCH'}
      Assert-ReleaseManifestExact ([string]$backend.projectDir) $record 'PREMANAGED_RELEASE'
      if($recovered.ContainsKey([string]$instance.profile)-and-not(Test-SameBackend $recovered[[string]$instance.profile] $backend)){throw 'PREMANAGED_MULTIPLE_CANDIDATES'};$recovered[[string]$instance.profile]=$backend
    }
  }
  if($stableState){Stop-BootstrapStableRuntime $Managed $recovered;$Script:LegacySupervisorAuthority=[pscustomobject]@{script=$legacySupervisor;runValue=[string]$journal.legacyRegistry.runValue;blueGreenExisted=[bool]$journal.legacyRegistry.blueGreenExisted;managedExisted=[bool]$journal.legacyRegistry.managedExisted;managedValue=[string]$journal.legacyRegistry.managedValue};Restore-LegacyRegistry;foreach($instance in @($Managed.instances)){foreach($path in @($instance.pointerPath,$instance.routerConfigPath,$instance.routerRuntimePath)){if(Test-Path -LiteralPath $path){Remove-Item -LiteralPath $path -Force}}};if(Test-Path -LiteralPath $ManagedPath){Remove-Item -LiteralPath $ManagedPath -Force};Start-LegacySupervisorRollback $Managed}else{$Script:LegacySupervisorAuthority=[pscustomobject]@{script=$legacySupervisor;runValue=[string]$journal.legacyRegistry.runValue};foreach($profile in $recovered.Keys){$backend=$recovered[$profile];$instance=@($Managed.instances|Where-Object profile -eq $profile)[0];$slot=Get-SlotPaths $instance ([string]$backend.slotId);Stop-OwnedBackend $slot.runtimeState $backend};Start-LegacySupervisorRollback $Managed}
  Write-Status 'PREMANAGED_RECOVERY_ATTESTED' 'journal port plan reused; stale owned candidate/control state recovered; legacy service verified'
}
function Stop-LegacyBackend($Instance) {
  $marker = Read-Json ([string]$Instance.legacyMarkerPath) 'LEGACY_RUNTIME_MARKER'
  $listener = Get-NetTCPConnection -State Listen -LocalPort ([int]$Instance.stablePort) -ErrorAction Stop | Select-Object -First 1
  if ([int]$marker.pid -ne [int]$listener.OwningProcess -or [int]$marker.port -ne [int]$Instance.stablePort -or [string]$marker.instance.profile -ne [string]$Instance.profile -or [IO.Path]::GetFullPath([string]$marker.projectDir) -ne [IO.Path]::GetFullPath([string]$Instance.legacyProjectDir)) { throw 'LEGACY_STOP_OWNERSHIP_MISMATCH' }
  Stop-Process -Id ([int]$marker.pid) -Force -ErrorAction Stop
  foreach ($i in 1..40) { if (-not (Get-NetTCPConnection -State Listen -LocalPort ([int]$Instance.stablePort) -ErrorAction SilentlyContinue)) { return }; Start-Sleep -Milliseconds 250 }
  throw 'LEGACY_BACKEND_STOP_TIMEOUT'
}
function Write-RouterConfig($Instance) {
  $config = [ordered]@{ schema=1; routerId="router-$($Instance.profile)"; host='127.0.0.1'; port=[int]$Instance.stablePort; profile=[string]$Instance.profile; pointerPath=[string]$Instance.pointerPath; runtimeStatePath=[string]$Instance.routerRuntimePath; healthTimeoutMs=3000; upstreamTimeoutMs=660000 }
  Write-JsonAtomic ([string]$Instance.routerConfigPath) $config
}
function Invoke-RouterControl($Instance, [string]$Command, [int]$ExpectedGeneration, $Backend) {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $tool = Join-Path $ControlRoot 'tools\router-control.mjs'
  $old = $env:REMOTE_COMMANDER_ROUTER_CONFIG
  try {
    $env:REMOTE_COMMANDER_ROUTER_CONFIG = [string]$Instance.routerConfigPath
    $args = @($tool,$Command,'--expected-generation',[string]$ExpectedGeneration,'--profile',[string]$Backend.profile,'--version',[string]$Backend.version,'--config-sha256',[string]$Backend.configSha256,'--commit',[string]$Backend.commit,'--slot-id',[string]$Backend.slotId,'--project-dir',[string]$Backend.projectDir,'--port',[string]$Backend.port)
    $raw = & $node @args
    if ($LASTEXITCODE -ne 0) { throw "ROUTER_CONTROL_FAILED command=$Command" }
    return ($raw | ConvertFrom-Json)
  } finally {
    if ($null -eq $old) { Remove-Item Env:REMOTE_COMMANDER_ROUTER_CONFIG -ErrorAction SilentlyContinue } else { $env:REMOTE_COMMANDER_ROUTER_CONFIG=$old }
  }
}
function Invoke-StableSupervisorPreflight{$script=Join-Path $ControlRoot 'bluegreen-supervisor-windows.ps1';$pwsh=(Get-Command pwsh.exe -ErrorAction Stop).Source;&$pwsh -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -ManagedStatePath $ManagedPath -Once;if($LASTEXITCODE-ne 0){throw "STABLE_SUPERVISOR_PREFLIGHT_FAILED exit=$LASTEXITCODE"}}
function Start-StableSupervisor {
  $spec=Get-StableSupervisorSpec;New-Item -Path $RegistryPath,$RunKey -Force|Out-Null;New-ItemProperty -Path $RegistryPath -Name ManagedStatePath -Value $ManagedPath -PropertyType String -Force|Out-Null
  $command="`"$($spec.executable)`" -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$($spec.script)`" -ManagedStatePath `"$ManagedPath`" -IntervalSeconds 5";New-ItemProperty -Path $RunKey -Name $RunName -Value $command -PropertyType String -Force|Out-Null
  $others=@((Get-ItemProperty -Path $RunKey).PSObject.Properties|Where-Object{$_.Name-notmatch'^PS'-and$_.Name-ne$RunName-and[string]$_.Value-match'ChatGPTRemoteCommander'});if($others.Count){throw 'MULTIPLE_AUTOSTART_ENTRIES_REFUSED'}
  $set=Get-PowerShellIdentitySet $spec.script $spec.executable $spec.arguments;if($set.mentions.Count-ne$set.exact.Count){throw 'STABLE_SUPERVISOR_PROCESS_IDENTITY_UNKNOWN'};if($set.exact.Count-gt 1){throw 'MULTIPLE_STABLE_SUPERVISORS'};if(-not$set.exact.Count){Start-Process -FilePath $spec.executable -ArgumentList $spec.arguments -WindowStyle Hidden|Out-Null}
  foreach($i in 1..120){Assert-Deadline;try{return Assert-StableSupervisorRuntime}catch{Start-Sleep -Milliseconds 250}};throw 'STABLE_SUPERVISOR_CONTINUOUS_START_FAILED'
}
function Stop-BootstrapStableRuntime($Managed,$Candidates){
  $spec=Get-StableSupervisorSpec;$set=Get-PowerShellIdentitySet $spec.script $spec.executable $spec.arguments;if($set.mentions.Count-ne$set.exact.Count){throw 'STABLE_SUPERVISOR_PROCESS_IDENTITY_UNKNOWN'};if($set.exact.Count-gt 1){throw 'MULTIPLE_STABLE_SUPERVISORS'};if($set.exact.Count-eq 1){$owned=Assert-StableSupervisorRuntime -ForOwnedStop;Stop-Process -Id ([int]$owned.ProcessId) -Force -ErrorAction Stop}elseif(Test-Path -LiteralPath $spec.runtime){$marker=Read-Json $spec.runtime 'STABLE_SUPERVISOR_RUNTIME';if([string]$marker.role-ne'bluegreen-supervisor'-or[IO.Path]::GetFullPath([string]$marker.scriptPath)-ne$spec.script-or(Get-Process -Id ([int]$marker.pid) -ErrorAction SilentlyContinue)){throw 'STABLE_SUPERVISOR_STALE_MARKER_UNPROVEN'};Remove-Item -LiteralPath $spec.runtime -Force};Stop-ExactTunnelProfiles $Managed
  foreach($instance in @($Managed.instances)){$listener=Get-NetTCPConnection -State Listen -LocalPort ([int]$instance.stablePort) -ErrorAction SilentlyContinue|Select-Object -First 1;if($listener){$marker=Read-Json ([string]$instance.routerRuntimePath) 'ROUTER_RUNTIME_MARKER';$config=Read-Json ([string]$instance.routerConfigPath) 'ROUTER_CONFIG';if([int]$marker.pid-ne[int]$listener.OwningProcess-or[string]$marker.role-ne'router'-or[string]$marker.routerId-ne[string]$config.routerId-or[string]$marker.profile-ne[string]$instance.profile-or[int]$marker.port-ne[int]$instance.stablePort-or[string]$marker.configSha256-ne(Get-Sha256 ([string]$instance.routerConfigPath))-or[IO.Path]::GetFullPath([string]$marker.projectDir)-ne[IO.Path]::GetFullPath($ControlRoot)){throw 'BOOTSTRAP_ROUTER_ROLLBACK_OWNERSHIP_UNPROVEN'};Stop-Process -Id ([int]$marker.pid) -Force -ErrorAction Stop}}
  foreach($instance in @($Managed.instances)){$candidate=$Candidates[[string]$instance.profile];if($candidate){$slot=Get-SlotPaths $instance ([string]$candidate.slotId);Stop-OwnedBackendIfRunning $slot.runtimeState $candidate}}
}
function Wait-RouterHealthy($Instance, $Backend,[switch]$Recovery) {
  foreach ($i in 1..80) {
    if(-not$Recovery){Assert-Deadline}
    Start-Sleep -Milliseconds 250
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($Instance.stablePort)/router/health" -TimeoutSec 3
      $pointer=Read-Json ([string]$Instance.pointerPath) 'ROUTER_POINTER';$config=Read-Json ([string]$Instance.routerConfigPath) 'ROUTER_CONFIG';$sha=Get-Sha256 ([string]$Instance.routerConfigPath)
      if($health.ok-and(Test-SameBackend $health.backend $Backend)-and(Test-SameBackend $pointer.backend $Backend)-and[int]$health.generation-eq[int]$pointer.generation-and[string]$health.router.routerId-eq[string]$config.routerId-and[string]$health.router.profile-eq[string]$Instance.profile-and[int]$health.router.port-eq[int]$Instance.stablePort-and[string]$health.router.configSha256-eq$sha){return $health}
    } catch {}
  }
  throw "ROUTER_HEALTH_TIMEOUT profile=$($Instance.profile)"
}
function Wait-TunnelsForInstance($Managed, [string]$InstanceProfile,[switch]$Recovery) {
  foreach ($tunnel in @($Managed.tunnelProfiles | Where-Object instanceProfile -eq $InstanceProfile)) {
    if ((Get-Sha256 ([string]$tunnel.yamlPath)) -ne [string]$tunnel.yamlSha256) { throw 'TUNNEL_YAML_IDENTITY_DRIFT' }
    $executables = @([string]$Managed.tunnelClient.path)
    if ($Managed.tunnelClient.PSObject.Properties.Name -contains 'legacyPath') { $executables += [string]$Managed.tunnelClient.legacyPath }
    $processes = @($executables | Select-Object -Unique | ForEach-Object { @(Get-TunnelProcess ([string]$tunnel.profile) $_ ([string]$tunnel.profileDir)) } | Where-Object { $_ })
    if ($processes.Count -ne 1) { throw "TUNNEL_PROCESS_OWNERSHIP_FAILED profile=$($tunnel.profile) count=$($processes.Count)" }
    $ready = $false
    foreach ($i in 1..80) {
      if(-not$Recovery){Assert-Deadline}
      if (Test-TunnelReady ([int]$tunnel.healthPort)) {
        $listener = Get-NetTCPConnection -State Listen -LocalPort ([int]$tunnel.healthPort) -ErrorAction Stop | Select-Object -First 1
        if ([int]$listener.OwningProcess -ne [int]$processes[0].ProcessId) { throw 'TUNNEL_HEALTH_LISTENER_OWNERSHIP_MISMATCH' }
        $ready = $true; break
      }
      Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { throw "TUNNEL_VERIFY_FAILED profile=$($tunnel.profile)" }
  }
}
function Wait-OldInflightZero($Instance, [int]$Generation, [string]$SlotId,[switch]$Recovery) {
  $key = "${Generation}:$SlotId"
  foreach ($i in 1..120) {
    if(-not$Recovery){Assert-Deadline}
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($Instance.stablePort)/router/health" -TimeoutSec 3
    $value = $health.inFlight.byBackend.PSObject.Properties[$key]
    if (-not $value -or [int]$value.Value -eq 0) { return }
    Start-Sleep -Milliseconds 500
  }
  throw 'ROUTER_OLD_INFLIGHT_TIMEOUT'
}
function Save-RemovalEvidence($OldBackend, [string]$MarkerPath, [string]$PointerPath) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  $dir = Join-Path $EvidenceRoot "retired-$stamp-$($OldBackend.slotId)"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Copy-Item -LiteralPath $MarkerPath -Destination (Join-Path $dir 'runtime.json')
  Copy-Item -LiteralPath $PointerPath -Destination (Join-Path $dir 'pointer.json')
  $record = [ordered]@{ schema=1; backend=$OldBackend; capturedAt=(Get-Date).ToUniversalTime().ToString('o'); markerSha256=(Get-Sha256 (Join-Path $dir 'runtime.json')); pointerSha256=(Get-Sha256 (Join-Path $dir 'pointer.json')) }
  Write-JsonAtomic (Join-Path $dir 'evidence.json') $record
  $zip = "$dir.zip"; Compress-Archive -Path (Join-Path $dir '*') -DestinationPath $zip -CompressionLevel Optimal
  if (-not (Test-Path -LiteralPath $zip -PathType Leaf)) { throw 'RETIREMENT_EVIDENCE_PACKAGING_FAILED' }
  Remove-Item -LiteralPath $dir -Recurse -Force
  return $zip
}
function Remove-ValidatedOldRelease($Managed, $OldBackend) {
  foreach ($instance in @($Managed.instances)) {
    $pointer = Read-Json ([string]$instance.pointerPath) 'ROUTER_POINTER'
    if ([IO.Path]::GetFullPath([string]$pointer.backend.projectDir) -eq [IO.Path]::GetFullPath([string]$OldBackend.projectDir)) { return }
  }
  $target = Assert-PathUnder $ReleaseRoot ([string]$OldBackend.projectDir) 'OLD_RELEASE_PATH_INVALID'
  if (-not (Test-Path -LiteralPath $target -PathType Container)) { return }
  if ([IO.Path]::GetFullPath((Split-Path -Parent $target)) -ne [IO.Path]::GetFullPath($ReleaseRoot)) { throw 'OLD_RELEASE_NOT_DIRECT_CHILD' }
  $expectedLeaf = "$($OldBackend.version)-$(([string]$OldBackend.commit).Substring(0,12))"
  if ([IO.Path]::GetFileName($target) -ne $expectedLeaf) { throw 'OLD_RELEASE_NAME_MISMATCH' }
  $rootItem = Get-Item -LiteralPath $ReleaseRoot -Force
  $targetItem = Get-Item -LiteralPath $target -Force
  if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($targetItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'OLD_RELEASE_REPARSE_POINT_REFUSED' }
  if (Get-ChildItem -LiteralPath $target -Directory -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | Select-Object -First 1) { throw 'OLD_RELEASE_NESTED_REPARSE_POINT_REFUSED' }
  $record = Read-Json (Join-Path $ControlRoot "release-records\$expectedLeaf.json") 'OLD_RELEASE_RECORD'
  if ([int]$record.schema -ne 1 -or [string]$record.version -ne [string]$OldBackend.version -or [string]$record.commit -ne [string]$OldBackend.commit) { throw 'OLD_RELEASE_RECORD_IDENTITY_MISMATCH' }
  Assert-ReleaseManifestExact $target $record 'OLD_RELEASE_MANIFEST'
  $live = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($target) })
  if ($live.Count) { throw 'OLD_RELEASE_PROCESS_REFERENCE_PRESENT' }
  Remove-Item -LiteralPath $target -Recurse -Force
  if (Test-Path -LiteralPath $target) { throw 'OLD_RELEASE_DELETE_UNVERIFIED' }
}
function Assert-ManagedServiceHealthy($Managed,[switch]$Recovery) {
  foreach ($instance in @($Managed.instances)) {
    $pointer = Read-Json ([string]$instance.pointerPath) 'ROUTER_POINTER'
    $backend = $pointer.backend
    $health = Get-Health ([int]$backend.port)
    if (-not $health.ok -or -not (Test-SameBackend $health.backend $backend)) { throw 'MANAGED_BACKEND_HEALTH_IDENTITY_FAILED' }
    $slot = Get-SlotPaths $instance ([string]$backend.slotId)
    $marker = Read-Json $slot.runtimeState 'BACKEND_RUNTIME_MARKER'
    $listener = Get-NetTCPConnection -State Listen -LocalPort ([int]$backend.port) -ErrorAction Stop | Select-Object -First 1
    if ([int]$marker.pid -ne [int]$listener.OwningProcess -or -not (Test-SameBackend $marker.backend $backend)) { throw 'MANAGED_BACKEND_OWNERSHIP_FAILED' }
    Invoke-CandidateRuntimeGates $instance $backend ([string]$backend.projectDir)
    $routerHealth = Wait-RouterHealthy $instance $backend -Recovery:$Recovery
    $routerConfig = Read-Json ([string]$instance.routerConfigPath) 'ROUTER_CONFIG'
    $routerMarker = Read-Json ([string]$instance.routerRuntimePath) 'ROUTER_RUNTIME_MARKER'
    $routerListener = Get-NetTCPConnection -State Listen -LocalPort ([int]$instance.stablePort) -ErrorAction Stop | Select-Object -First 1
    $routerSha = Get-Sha256 ([string]$instance.routerConfigPath)
    if ([int]$routerMarker.pid -ne [int]$routerListener.OwningProcess -or [string]$routerMarker.role -ne 'router' -or
        [string]$routerMarker.routerId -ne [string]$routerConfig.routerId -or [string]$routerMarker.profile -ne [string]$instance.profile -or
        [int]$routerMarker.port -ne [int]$instance.stablePort -or [string]$routerMarker.configSha256 -ne $routerSha -or
        [IO.Path]::GetFullPath([string]$routerMarker.projectDir) -ne [IO.Path]::GetFullPath($ControlRoot) -or
        [string]$routerHealth.router.configSha256 -ne $routerSha -or [string]$routerHealth.router.routerId -ne [string]$routerConfig.routerId) {
      throw 'MANAGED_ROUTER_OWNERSHIP_FAILED'
    }
    $workflows = Invoke-Rpc ([int]$backend.port) 'workflow_list'
    foreach ($workflow in @($workflows.workflows)) {
      $resume = Invoke-Rpc ([int]$backend.port) 'workflow_resume' @{id=[string]$workflow.id}
      if (@($resume.blockers).Count -or @($resume.unresolved).Count) { throw 'MANAGED_WORKFLOW_UNRESOLVED' }
      $pending = @($resume.state.steps | Where-Object status -eq 'pending')
      if ($pending.Count -and $resume.readyForNextStep -ne $true) { throw 'MANAGED_WORKFLOW_NOT_READY' }
    }
    Wait-TunnelsForInstance $Managed ([string]$instance.profile) -Recovery:$Recovery
  }
  [void](Assert-StableSupervisorRuntime)
}
function Get-HardLinkCount([string]$Path){if(-not('RemoteCommanderFileIdentityNative'-as[type])){Add-Type -TypeDefinition 'using System;using System.IO;using System.ComponentModel;using System.Runtime.InteropServices;public static class RemoteCommanderFileIdentityNative{[StructLayout(LayoutKind.Sequential)]struct Info{public uint Attributes;public long CreationTime;public long AccessTime;public long WriteTime;public uint VolumeSerial;public uint SizeHigh;public uint SizeLow;public uint NumberOfLinks;public uint IndexHigh;public uint IndexLow;}[DllImport("kernel32.dll",SetLastError=true)]static extern bool GetFileInformationByHandle(IntPtr h,out Info i);public static uint LinkCount(string p){using(FileStream s=new FileStream(p,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)){Info i;if(!GetFileInformationByHandle(s.SafeFileHandle.DangerousGetHandle(),out i))throw new Win32Exception(Marshal.GetLastWin32Error());return i.NumberOfLinks;}}}' };try{return [uint32][RemoteCommanderFileIdentityNative]::LinkCount($Path)}catch{throw "LEGACY_FILE_HARDLINK_COUNT_UNPROVEN $($_.Exception.Message)"}}
function Get-StreamCount([string]$Path){if(-not('RemoteCommanderStreamIdentityNative'-as[type])){Add-Type -TypeDefinition 'using System;using System.ComponentModel;using System.Runtime.InteropServices;public static class RemoteCommanderStreamIdentityNative{[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct Data{public long Size;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=296)]public string Name;}[DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr FindFirstStreamW(string p,int level,out Data data,uint flags);[DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool FindNextStreamW(IntPtr h,out Data data);[DllImport("kernel32.dll")]static extern bool FindClose(IntPtr h);public static int Count(string p){Data d;IntPtr h=FindFirstStreamW(p,0,out d,0);if(h==new IntPtr(-1))throw new Win32Exception(Marshal.GetLastWin32Error());int n=1;try{while(FindNextStreamW(h,out d))n++;int e=Marshal.GetLastWin32Error();if(e!=38)throw new Win32Exception(e);return n;}finally{FindClose(h);}}}' };try{return [int][RemoteCommanderStreamIdentityNative]::Count($Path)}catch{throw "LEGACY_STREAM_COUNT_UNPROVEN $($_.Exception.Message)"}}
function Get-DirectoryAlternateStreamCount([string]$Path){if(-not('RemoteCommanderDirectoryStreamNative'-as[type])){Add-Type -TypeDefinition 'using System;using System.ComponentModel;using System.Runtime.InteropServices;public static class RemoteCommanderDirectoryStreamNative{[DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr CreateFileW(string p,uint access,uint share,IntPtr sec,uint creation,uint flags,IntPtr template);[DllImport("kernel32.dll",SetLastError=true)]static extern bool BackupRead(IntPtr h,IntPtr buffer,uint bytes,out uint read,bool abort,bool security,ref IntPtr context);[DllImport("kernel32.dll",SetLastError=true)]static extern bool BackupSeek(IntPtr h,uint low,uint high,out uint lowDone,out uint highDone,ref IntPtr context);[DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr h);public static int Count(string p){IntPtr h=CreateFileW(p,0x80000000,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero);if(h==new IntPtr(-1))throw new Win32Exception(Marshal.GetLastWin32Error());IntPtr context=IntPtr.Zero;IntPtr header=Marshal.AllocHGlobal(20);uint read=0;int count=0;try{while(true){if(!BackupRead(h,header,20,out read,false,false,ref context))throw new Win32Exception(Marshal.GetLastWin32Error());if(read==0)break;if(read!=20)throw new InvalidOperationException("BACKUP_STREAM_HEADER_TRUNCATED");uint id=(uint)Marshal.ReadInt32(header,0);long size=Marshal.ReadInt64(header,8);uint name=(uint)Marshal.ReadInt32(header,16);if(id==4)count++;if(name>0){IntPtr n=Marshal.AllocHGlobal((int)name);try{if(!BackupRead(h,n,name,out read,false,false,ref context)||read!=name)throw new Win32Exception(Marshal.GetLastWin32Error());}finally{Marshal.FreeHGlobal(n);}}if(size>0){uint lo,hi;if(!BackupSeek(h,(uint)size,(uint)((ulong)size>>32),out lo,out hi,ref context)||lo!=(uint)size||hi!=(uint)((ulong)size>>32))throw new Win32Exception(Marshal.GetLastWin32Error());}}return count;}finally{BackupRead(h,IntPtr.Zero,0,out read,true,false,ref context);Marshal.FreeHGlobal(header);CloseHandle(h);}}}' };try{return [int][RemoteCommanderDirectoryStreamNative]::Count($Path)}catch{throw "LEGACY_DIRECTORY_STREAM_COUNT_UNPROVEN $($_.Exception.Message)"}}
function Assert-LegacyFileSafe([string]$Path){$item=Get-Item -LiteralPath $Path -Force -ErrorAction Stop;if($item.Attributes-band[IO.FileAttributes]::ReparsePoint){throw 'LEGACY_FILE_LINK_REFUSED'};if((Get-StreamCount $item.FullName)-ne 1){throw 'LEGACY_FILE_ALTERNATE_STREAM_REFUSED'};if((Get-HardLinkCount $item.FullName)-ne 1){throw 'LEGACY_FILE_HARDLINK_REFUSED'};if($item.LinkType){throw 'LEGACY_FILE_LINK_REFUSED'};return $item}
function Assert-LegacyDirectorySafe([string]$Path){$item=Get-Item -LiteralPath $Path -Force -ErrorAction Stop;if(-not$item.PSIsContainer-or($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-or$item.LinkType){throw 'LEGACY_DIRECTORY_LINK_REFUSED'};if((Get-StreamCount $item.FullName)-ne 1-or(Get-DirectoryAlternateStreamCount $item.FullName)-ne 0){throw 'LEGACY_DIRECTORY_ALTERNATE_STREAM_REFUSED'};return $item}
function Prepare-LegacyRetirement($Managed) {
  $legacy = Resolve-ExactDirectory $LegacyRoot 'LEGACY_CLEANUP_ROOT'
  [void](Assert-LegacyDirectorySafe $legacy);foreach($directory in @(Get-ChildItem -LiteralPath $legacy -Directory -Recurse -Force)){[void](Assert-LegacyDirectorySafe $directory.FullName)}
  if ([IO.Path]::GetFullPath($legacy) -eq [IO.Path]::GetFullPath($Base)) { throw 'LEGACY_ROOT_MUST_NOT_EQUAL_BASE' }
  [void](Assert-PathUnder $Base $legacy 'LEGACY_CLEANUP_OUTSIDE_BASE')
  $trackedStatus = @(Invoke-Git @('-C',$legacy,'status','--porcelain=v1','--untracked-files=no'))
  if (@($trackedStatus | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count) { throw 'LEGACY_TRACKED_TREE_DIRTY' }
  $head = (Invoke-Git @('-C',$legacy,'rev-parse','HEAD') | Select-Object -Last 1).Trim().ToLowerInvariant()
  if ($head -notmatch $CommitPattern) { throw 'LEGACY_HEAD_INVALID' }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  $stage = Join-Path $EvidenceRoot "legacy-production-$stamp"
  $preserved = Join-Path $EvidenceRoot "preserved-legacy-untracked-$stamp"
  $preservedGit = Join-Path $EvidenceRoot "preserved-legacy-git-$stamp"
  $preservedManifest = "$preserved.manifest.json"
  $artifact = Join-Path $stage 'tracked-source.zip'
  New-Item -ItemType Directory -Force -Path $stage,$preserved,$preservedGit | Out-Null
  try {
    [void](Invoke-Git @('-C',$legacy,'archive','--format=zip',"--output=$artifact",$head))
    $trackedSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $tracked = @()
    foreach ($relative in @(Invoke-Git @('-C',$legacy,'-c','core.quotePath=false','ls-files'))) {
      if ([string]::IsNullOrWhiteSpace($relative)) { continue }
      $relative = ([string]$relative).Replace('/','\')
      if ($relative -match '[\r\n\0]') { throw 'LEGACY_TRACKED_FILENAME_UNSUPPORTED' }
      [void]$trackedSet.Add($relative)
      $file = [IO.Path]::GetFullPath((Join-Path $legacy $relative))
      if (-not $file.StartsWith($legacy.TrimEnd('\') + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'LEGACY_TRACKED_PATH_ESCAPE' }
      $item = Assert-LegacyFileSafe $file
      $tracked += [pscustomobject]@{ path=$relative; bytes=$item.Length; sha256=(Get-Sha256 $file) }
    }
    $gitRoot = Join-Path $legacy '.git'
    $gitItem=Get-Item -LiteralPath $gitRoot -Force -ErrorAction Stop;if(-not$gitItem.PSIsContainer-or($gitItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-or$gitItem.LinkType){throw 'LEGACY_GIT_DIRECTORY_INVALID'}
    if(Get-ChildItem -LiteralPath $gitRoot -Directory -Recurse -Force|Where-Object{($_.Attributes-band[IO.FileAttributes]::ReparsePoint)-or$_.LinkType}|Select-Object -First 1){throw 'LEGACY_GIT_DIRECTORY_LINK_REFUSED'}
    $gitFiles=@();foreach($file in @(Get-ChildItem -LiteralPath $gitRoot -File -Recurse -Force)){$item=Assert-LegacyFileSafe $file.FullName;$relative=[IO.Path]::GetRelativePath($gitRoot,$file.FullName);$destination=[IO.Path]::GetFullPath((Join-Path $preservedGit $relative));if(-not$destination.StartsWith([IO.Path]::GetFullPath($preservedGit).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'LEGACY_GIT_PRESERVE_PATH_ESCAPE'};New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination)|Out-Null;Copy-Item -LiteralPath $file.FullName -Destination $destination;if((Get-Item -LiteralPath $destination).Length-ne$item.Length-or(Get-Sha256 $destination)-ne(Get-Sha256 $file.FullName)){throw 'LEGACY_GIT_PRESERVE_VERIFY_FAILED'};$gitFiles += [pscustomobject]@{path=$relative;bytes=$item.Length;sha256=(Get-Sha256 $file.FullName)}}
    $bundle=Join-Path $stage 'git-history.bundle';[void](Invoke-Git @('-C',$legacy,'bundle','create',$bundle,'--all'));[void](Invoke-Git @('bundle','verify',$bundle));$bundleSha=Get-Sha256 $bundle
    $allDirectories = @(Get-ChildItem -LiteralPath $legacy -Directory -Recurse -Force | Where-Object { -not $_.FullName.StartsWith($gitRoot + '\',[StringComparison]::OrdinalIgnoreCase) -and $_.FullName -ne $gitRoot })
    if ($allDirectories | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $_.LinkType } | Select-Object -First 1) { throw 'LEGACY_UNTRACKED_DIRECTORY_LINK_REFUSED' }
    $allFiles = @(Get-ChildItem -LiteralPath $legacy -File -Recurse -Force | Where-Object { -not $_.FullName.StartsWith($gitRoot + '\',[StringComparison]::OrdinalIgnoreCase) -and $_.FullName -ne $gitRoot })
    $extras = @()
    foreach ($file in $allFiles) {
      [void](Assert-LegacyFileSafe $file.FullName)
      $relative = [IO.Path]::GetRelativePath($legacy,$file.FullName)
      if ($relative -match '(^|[\\/])\.\.([\\/]|$)' -or [IO.Path]::IsPathRooted($relative)) { throw 'LEGACY_UNTRACKED_PATH_ESCAPE' }
      if ($trackedSet.Contains($relative)) { continue };if($extras.Count%250-eq 0){Write-Status 'LEGACY_PRESERVE_PROGRESS' "copied=$($extras.Count)"}
      $destination = [IO.Path]::GetFullPath((Join-Path $preserved $relative))
      if (-not $destination.StartsWith([IO.Path]::GetFullPath($preserved).TrimEnd('\') + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'LEGACY_PRESERVE_PATH_ESCAPE' }
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
      Copy-Item -LiteralPath $file.FullName -Destination $destination
      $sha = Get-Sha256 $file.FullName
      if ((Get-Item -LiteralPath $destination).Length -ne $file.Length -or (Get-Sha256 $destination) -ne $sha) { throw 'LEGACY_PRESERVE_COPY_VERIFY_FAILED' }
      $extras += [pscustomobject]@{ path=$relative; bytes=$file.Length; sha256=$sha }
    }
    $evidence = [ordered]@{
      schema=1; legacyRoot=$legacy; head=$head; trackedGitStatus='clean'; capturedAt=(Get-Date).ToUniversalTime().ToString('o')
      trackedArchiveSha256=(Get-Sha256 $artifact);gitBundleSha256=$bundleSha;trackedFiles=$tracked;preservedUntrackedRoot=$preserved;preservedFiles=$extras;preservedGitRoot=$preservedGit;preservedGitFiles=$gitFiles
    }
    Write-JsonAtomic (Join-Path $stage 'evidence.json') $evidence
    Write-JsonAtomic $preservedManifest ([ordered]@{schema=1;legacyRoot=$legacy;head=$head;files=$extras;gitRoot=$preservedGit;gitFiles=$gitFiles;gitBundleSha256=$bundleSha})
    $zip = Join-Path $EvidenceRoot "legacy-production-$stamp.zip"
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
    if (-not (Test-Path -LiteralPath $zip -PathType Leaf)) { throw 'LEGACY_EVIDENCE_PACKAGE_FAILED' }
    return [pscustomobject]@{legacy=$legacy;head=$head;evidenceZip=$zip;preservedRoot=$preserved;preservedGitRoot=$preservedGit;preservedManifest=$preservedManifest;tracked=$tracked;extras=$extras;gitFiles=$gitFiles}
  } finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  }
}
function Finalize-LegacyRemoval($Managed, $Retirement,[switch]$Resume) {
  $legacy=[IO.Path]::GetFullPath([string]$Retirement.legacy);if($legacy-ne[IO.Path]::GetFullPath($LegacyRoot)){throw 'LEGACY_CLEANUP_JOURNAL_ROOT_MISMATCH'}
  $gitRoot=Join-Path $legacy '.git';$expectedFiles=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase);$expectedGit=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach($entry in @($Retirement.tracked)+@($Retirement.extras)){if(-not$expectedFiles.Add([string]$entry.path)){throw 'SERVICE_ACTIVE_CLEANUP_INCOMPLETE_DUPLICATE_PATH'}};foreach($entry in @($Retirement.gitFiles)){if(-not$expectedGit.Add([string]$entry.path)){throw 'SERVICE_ACTIVE_CLEANUP_INCOMPLETE_DUPLICATE_GIT_PATH'}}
  $assertExact={
    if(-not(Test-Path -LiteralPath $legacy -PathType Container)){if($Resume){return};throw 'SERVICE_ACTIVE_CLEANUP_INCOMPLETE_LEGACY_ROOT_MISSING'}
    [void](Assert-LegacyDirectorySafe $legacy);foreach($directory in @(Get-ChildItem -LiteralPath $legacy -Directory -Recurse -Force)){[void](Assert-LegacyDirectorySafe $directory.FullName)}
    foreach($entry in @($Retirement.tracked)+@($Retirement.extras)){$source=[IO.Path]::GetFullPath((Join-Path $legacy ([string]$entry.path)));if(-not$source.StartsWith($legacy.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)-or((Test-Path -LiteralPath $source -PathType Leaf)-and((Assert-LegacyFileSafe $source).Length-ne[int64]$entry.bytes-or(Get-Sha256 $source)-ne[string]$entry.sha256))-or(-not$Resume-and-not(Test-Path -LiteralPath $source -PathType Leaf))){throw 'SERVICE_ACTIVE_CLEANUP_INCOMPLETE_SOURCE_DRIFT'}}
    foreach($entry in @($Retirement.extras)){$copy=Join-Path ([string]$Retirement.preservedRoot) ([string]$entry.path);if(-not(Test-Path -LiteralPath $copy -PathType Leaf)-or(Assert-LegacyFileSafe $copy).Length-ne[int64]$entry.bytes-or(Get-Sha256 $copy)-ne[string]$entry.sha256){throw 'SERVICE_ACTIVE_CLEANUP_INCOMPLETE_PRESERVE_DRIFT'}}
    foreach($entry in @($Retirement.gitFiles)){$source=Join-Path $gitRoot ([string]$entry.path);$copy=Join-Path ([string]$Retirement.preservedGitRoot) ([string]$entry.path);if(-not(Test-Path -LiteralPath $copy -PathType Leaf)-or(Assert-LegacyFileSafe $copy).Length-ne[int64]$entry.bytes-or(Get-Sha256 $copy)-ne[string]$entry.sha256-or((Test-Path -LiteralPath $source -PathType Leaf)-and((Assert-LegacyFileSafe $source).Length-ne[int64]$entry.bytes-or(Get-Sha256 $source)-ne[string]$entry.sha256))-or(-not$Resume-and-not(Test-Path -LiteralPath $source -PathType Leaf))){throw 'SERVICE_ACTIVE_CLEANUP_INCOMPLETE_GIT_DRIFT'}}
    $current=@(Get-ChildItem -LiteralPath $legacy -File -Recurse -Force|Where-Object{-not$_.FullName.StartsWith($gitRoot+'\',[StringComparison]::OrdinalIgnoreCase)-and$_.FullName-ne$gitRoot});$currentGit=if(Test-Path -LiteralPath $gitRoot){@(Get-ChildItem -LiteralPath $gitRoot -File -Recurse -Force)}else{@()};if(((-not$Resume)-and($current.Count-ne$expectedFiles.Count-or$currentGit.Count-ne$expectedGit.Count))-or$current.Count-gt$expectedFiles.Count-or$currentGit.Count-gt$expectedGit.Count){throw 'SERVICE_ACTIVE_CLEANUP_INCOMPLETE_SOURCE_DRIFT'};foreach($file in $current){if(-not$expectedFiles.Contains([IO.Path]::GetRelativePath($legacy,$file.FullName))){throw 'SERVICE_ACTIVE_CLEANUP_INCOMPLETE_SOURCE_DRIFT'}};foreach($file in $currentGit){if(-not$expectedGit.Contains([IO.Path]::GetRelativePath($gitRoot,$file.FullName))){throw 'SERVICE_ACTIVE_CLEANUP_INCOMPLETE_GIT_DRIFT'}}
  }
  &$assertExact
  $live=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Where-Object{($_.ExecutablePath-and [IO.Path]::GetFullPath([string]$_.ExecutablePath).StartsWith($legacy.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase))-or($_.CommandLine-and [string]$_.CommandLine-match[regex]::Escape($legacy))})
  if($live.Count){throw 'SERVICE_ACTIVE_CLEANUP_INCOMPLETE_PROCESS_REFERENCE'}
  $registryReferences=@((Get-ItemProperty -Path $RunKey).PSObject.Properties|Where-Object{$_.Name-notmatch'^PS'-and[string]$_.Value-match[regex]::Escape($legacy)})
  if($registryReferences.Count){throw 'SERVICE_ACTIVE_CLEANUP_INCOMPLETE_AUTOSTART_REFERENCE'}
  foreach($instance in @($Managed.instances)){if([IO.Path]::GetFullPath([string](Read-Json ([string]$instance.pointerPath) 'ROUTER_POINTER').backend.projectDir)-eq$legacy){throw 'SERVICE_ACTIVE_CLEANUP_INCOMPLETE_ROUTER_REFERENCE'}}
  if([IO.Path]::GetFullPath([string]$Managed.tunnelClient.path).StartsWith($legacy.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'SERVICE_ACTIVE_CLEANUP_INCOMPLETE_TUNNEL_REFERENCE'}
  if(-not$Resume){Write-JsonAtomic $LegacyCleanupJournalPath ([ordered]@{schema=1;phase='prepared';createdAt=(Get-Date).ToUniversalTime().ToString('o');retirement=$Retirement})}
  try{&$assertExact;if(Test-Path -LiteralPath $legacy){Remove-Item -LiteralPath $legacy -Recurse -Force};if(Test-Path -LiteralPath $legacy){throw 'LEGACY_DELETE_UNVERIFIED'}}catch{throw "SERVICE_ACTIVE_CLEANUP_INCOMPLETE_DELETE $($_.Exception.Message)"}
  foreach($instance in @($Managed.instances)){foreach($name in @('sourceConfigPath','legacyMarkerPath','legacyProjectDir')){[void]$instance.PSObject.Properties.Remove($name)}};[void]$Managed.PSObject.Properties.Remove('legacyRoot');[void]$Managed.tunnelClient.PSObject.Properties.Remove('legacyPath');Write-JsonAtomic $ManagedPath $Managed;Remove-Item -LiteralPath $LegacyCleanupJournalPath -Force -ErrorAction Stop;if(Test-Path -LiteralPath $LegacyCleanupJournalPath){throw 'LEGACY_CLEANUP_JOURNAL_FINALIZE_FAILED'}
  Write-Status 'LEGACY_PRODUCTION_ARCHIVE_DELETE_PASS' "head=$($Retirement.head) evidence=$($Retirement.evidenceZip) preserved=$($Retirement.preservedRoot)"
}
function Invoke-Bootstrap($Managed, $Authority, [string]$ReleasePath, $Candidates) {
  Assert-Deadline
  Write-Status 'LEGACY_BOOTSTRAP_NEAR_ZERO_DOWNTIME' 'stateful zero downtime is not claimed'
  $legacyFenced = $false
  $stableAccepted = $false
  $retirement = $null
  $createdControlFiles = [Collections.Generic.List[string]]::new()
  try {
    Stop-LegacySupervisor
    $legacyFenced = $true
    Stop-ExactTunnelProfiles $Managed
    foreach ($instance in @($Managed.instances)) { Assert-LegacySafe $instance }
    foreach ($instance in @($Managed.instances)) { Stop-LegacyBackend $instance }
    $retirement = Prepare-LegacyRetirement $Managed
    Assert-Deadline
    foreach ($instance in @($Managed.instances)) {
      if (Test-Path -LiteralPath ([string]$instance.routerConfigPath) -or Test-Path -LiteralPath ([string]$instance.pointerPath)) { throw 'BOOTSTRAP_STALE_CONTROL_FILE' }
      Write-RouterConfig $instance
      $createdControlFiles.Add([string]$instance.routerConfigPath)
      $candidate = $Candidates[[string]$instance.profile]
      [void](Invoke-RouterControl $instance 'init' 0 $candidate)
      $createdControlFiles.Add([string]$instance.pointerPath)
    }
    Write-JsonAtomic $ManagedPath $Managed
    $createdControlFiles.Add($ManagedPath)
    Invoke-StableSupervisorPreflight
    foreach ($instance in @($Managed.instances)) {
      $candidate = $Candidates[[string]$instance.profile]
      [void](Wait-RouterHealthy $instance $candidate)
      Wait-TunnelsForInstance $Managed ([string]$instance.profile)
    }
    Start-StableSupervisor
    foreach($instance in @($Managed.instances)){$candidate=$Candidates[[string]$instance.profile];[void](Wait-RouterHealthy $instance $candidate);Wait-TunnelsForInstance $Managed ([string]$instance.profile)}
    [void](Assert-StableSupervisorRuntime)
    Assert-Deadline
    Set-BootstrapStableAccepted $Authority
    $stableAccepted = $true
    Assert-Deadline
    Finalize-LegacyRemoval $Managed $retirement
  } catch {
    $original = $_
    if ($legacyFenced -and -not $stableAccepted) {
      try {
        foreach($instance in @($Managed.instances)){$candidate=$Candidates[[string]$instance.profile];if(Test-Path -LiteralPath ([string]$instance.pointerPath)){$pointer=Read-Json ([string]$instance.pointerPath) 'BOOTSTRAP_ROLLBACK_POINTER';if(-not(Test-SameBackend $pointer.backend $candidate)){throw 'BOOTSTRAP_ROLLBACK_POINTER_IDENTITY_UNKNOWN'};if(-not$createdControlFiles.Contains([string]$instance.pointerPath)){$createdControlFiles.Add([string]$instance.pointerPath)}};if(Test-Path -LiteralPath ([string]$instance.routerConfigPath)){$config=Read-Json ([string]$instance.routerConfigPath) 'BOOTSTRAP_ROLLBACK_ROUTER_CONFIG';if([string]$config.profile-ne[string]$instance.profile-or[int]$config.port-ne[int]$instance.stablePort-or[IO.Path]::GetFullPath([string]$config.pointerPath)-ne[IO.Path]::GetFullPath([string]$instance.pointerPath)){throw 'BOOTSTRAP_ROLLBACK_ROUTER_CONFIG_UNKNOWN'};if(-not$createdControlFiles.Contains([string]$instance.routerConfigPath)){$createdControlFiles.Add([string]$instance.routerConfigPath)}}};if(Test-Path -LiteralPath $ManagedPath){[void](Assert-ManagedState (Read-Json $ManagedPath 'BOOTSTRAP_ROLLBACK_MANAGED'));if(-not$createdControlFiles.Contains($ManagedPath)){$createdControlFiles.Add($ManagedPath)}}
        Stop-BootstrapStableRuntime $Managed $Candidates
        foreach($instance in @($Managed.instances)){if(Test-Path -LiteralPath ([string]$instance.routerRuntimePath)){$createdControlFiles.Add([string]$instance.routerRuntimePath)}}
        Restore-LegacyRegistry
        foreach ($path in @($createdControlFiles | Select-Object -Reverse)) {
          if ([IO.Path]::GetFullPath($path) -eq [IO.Path]::GetFullPath($ManagedPath)) { [void](Assert-PathUnder $ControlRoot $path 'BOOTSTRAP_ROLLBACK_PATH_INVALID') }
          else { [void](Assert-PathUnder $InstanceRoot $path 'BOOTSTRAP_ROLLBACK_PATH_INVALID') }
          if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force }
          if (Test-Path -LiteralPath $path) { throw 'BOOTSTRAP_ROLLBACK_ARTIFACT_DELETE_FAILED' }
        }
        Start-LegacySupervisorRollback $Managed
      } catch { throw "BOOTSTRAP_FAILED_ARTIFACT_ROLLBACK_UNPROVEN original=$($original.Exception.Message) cleanup=$($_.Exception.Message)" }
      throw "BOOTSTRAP_FAILED_LEGACY_ROLLBACK_PASS original=$($original.Exception.Message)"
    }
    if($stableAccepted){if($original.Exception.Message-like'SERVICE_ACTIVE_CLEANUP_INCOMPLETE*'){throw $original};throw "SERVICE_ACTIVE_CLEANUP_INCOMPLETE $($original.Exception.Message)"}
    throw "BOOTSTRAP_FAILED_ROLLBACK_UNPROVEN original=$($original.Exception.Message)"
  }
}
function Remove-UpdateJournalAfterManagedProof($Managed,[switch]$Recovery){
  Assert-ManagedServiceHealthy $Managed -Recovery:$Recovery
  Remove-Item -LiteralPath $UpdateJournalPath -Force -ErrorAction Stop
  if(Test-Path -LiteralPath $UpdateJournalPath){throw 'UPDATE_TRANSACTION_FINALIZE_FAILED'}
}
function Recover-UpdateTransaction($Managed){
  $journal=Read-Json $UpdateJournalPath 'UPDATE_TRANSACTION'
  if([int]$journal.schema-ne 1-or[string]$journal.phase-notin@('prepared','accepted')){throw 'UPDATE_TRANSACTION_INVALID'}
  $entries=@();$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach($record in @($journal.entries)){
    $profile=[string]$record.instance.profile;$matches=@($Managed.instances|Where-Object profile -eq $profile)
    if(-not$seen.Add($profile)-or$matches.Count-ne 1-or[IO.Path]::GetFullPath([string]$matches[0].pointerPath)-ne[IO.Path]::GetFullPath([string]$record.instance.pointerPath)-or-not(Test-SameBackend $record.pointer.backend $record.old)-or[string]$record.old.profile-ne$profile-or[string]$record.candidate.profile-ne$profile-or[string]$record.candidate.commit-ne[string]$journal.commit){throw 'UPDATE_TRANSACTION_IDENTITY_INVALID'}
    $entries+=[pscustomobject]@{instance=$matches[0];old=$record.old;candidate=$record.candidate;pointer=$record.pointer;oldSlot=(Get-SlotPaths $matches[0] ([string]$record.old.slotId))}
  }
  if($entries.Count-ne@($Managed.instances).Count){throw 'UPDATE_TRANSACTION_PROFILE_SET_INVALID'}
  if([string]$journal.phase-eq'prepared'){
    $rollbackError=$null
    foreach($entry in @($entries|Select-Object -Reverse)){
      try{
        $current=Read-Json ([string]$entry.instance.pointerPath) 'UPDATE_RECOVERY_POINTER'
        if(Test-SameBackend $current.backend $entry.candidate){$candidateGeneration=[int]$current.generation;[void](Invoke-RouterControl $entry.instance 'switch' $candidateGeneration $entry.old);[void](Wait-RouterHealthy $entry.instance $entry.old -Recovery);Wait-OldInflightZero $entry.instance $candidateGeneration ([string]$entry.candidate.slotId) -Recovery}
        elseif(Test-SameBackend $current.backend $entry.old){[void](Wait-RouterHealthy $entry.instance $entry.old -Recovery)}
        else{throw 'UPDATE_RECOVERY_POINTER_UNKNOWN'}
        Wait-TunnelsForInstance $Managed ([string]$entry.instance.profile) -Recovery;[void](Assert-UpgradeSafe ([int]$entry.old.port) -RequireDrain)
      }catch{if(-not$rollbackError){$rollbackError=$_}}
    }
    foreach($entry in $entries){Remove-Item -LiteralPath $entry.oldSlot.drainFile -Force -ErrorAction SilentlyContinue}
    if(-not$rollbackError){try{foreach($entry in $entries){$slot=Get-SlotPaths $entry.instance ([string]$entry.candidate.slotId);Stop-OwnedBackendIfRunning $slot.runtimeState $entry.candidate};Remove-UpdateJournalAfterManagedProof $Managed -Recovery}catch{$rollbackError=$_}}
    if($rollbackError){throw "UPDATE_RECOVERY_ROLLBACK_UNPROVEN $($rollbackError.Exception.Message)"}
  }else{
    foreach($entry in $entries){$current=Read-Json ([string]$entry.instance.pointerPath) 'UPDATE_RECOVERY_POINTER';if(-not(Test-SameBackend $current.backend $entry.candidate)){throw 'UPDATE_RECOVERY_ACCEPTED_POINTER_DRIFT'};[void](Wait-RouterHealthy $entry.instance $entry.candidate -Recovery);Wait-TunnelsForInstance $Managed ([string]$entry.instance.profile) -Recovery;if(Get-NetTCPConnection -State Listen -LocalPort ([int]$entry.old.port) -ErrorAction SilentlyContinue){[void](Save-RemovalEvidence $entry.old $entry.oldSlot.runtimeState ([string]$entry.instance.pointerPath));Stop-OwnedBackend $entry.oldSlot.runtimeState $entry.old};Remove-ValidatedOldRelease $Managed $entry.old;Remove-Item -LiteralPath $entry.oldSlot.drainFile -Force -ErrorAction SilentlyContinue}
    try{Remove-UpdateJournalAfterManagedProof $Managed -Recovery}catch{throw "UPDATE_RECOVERY_ACCEPTED_FINALIZE_UNPROVEN $($_.Exception.Message)"}
  }
  Write-Status 'UPDATE_TRANSACTION_RECOVERY_PASS' "phase=$($journal.phase) profiles=$($entries.Count)"
}
function Invoke-Update($Managed, $Authority, [string]$ReleasePath, $Candidates) {
  $tx=[Collections.Generic.List[object]]::new();foreach($instance in @($Managed.instances)){$pointer=Read-Json ([string]$instance.pointerPath) 'ROUTER_POINTER';$old=$pointer.backend;$tx.Add([pscustomobject]@{instance=$instance;pointer=$pointer;old=$old;candidate=$Candidates[[string]$instance.profile];oldSlot=(Get-SlotPaths $instance ([string]$old.slotId));switched=$null;stopped=$false})}
  Write-JsonAtomic $UpdateJournalPath ([ordered]@{schema=1;phase='prepared';commit=$Authority.commit;createdAt=(Get-Date).ToUniversalTime().ToString('o');entries=$tx})
  try{
    foreach($entry in $tx){Assert-Deadline;New-Item -ItemType Directory -Force -Path $entry.oldSlot.root|Out-Null;[IO.File]::WriteAllText($entry.oldSlot.drainFile,"drain`n",[Text.UTF8Encoding]::new($false));foreach($i in 1..120){Assert-Deadline;try{[void](Assert-UpgradeSafe ([int]$entry.old.port) -RequireDrain);break}catch{if($i-eq 120){throw};Start-Sleep -Milliseconds 500}}}
    foreach($entry in $tx){Assert-Deadline;$entry.switched=Invoke-RouterControl $entry.instance 'switch' ([int]$entry.pointer.generation) $entry.candidate;[void](Wait-RouterHealthy $entry.instance $entry.candidate);Wait-TunnelsForInstance $Managed ([string]$entry.instance.profile)}
    foreach($entry in $tx){Wait-OldInflightZero $entry.instance ([int]$entry.pointer.generation) ([string]$entry.old.slotId)}
    Assert-Deadline
    Write-JsonAtomic $UpdateJournalPath ([ordered]@{schema=1;phase='accepted';commit=$Authority.commit;acceptedAt=(Get-Date).ToUniversalTime().ToString('o');entries=$tx})
  }catch{
    $original=$_;$rollbackError=$null
    foreach($entry in @($tx|Select-Object -Reverse)){try{$current=Read-Json ([string]$entry.instance.pointerPath) 'ROUTER_POINTER';if(Test-SameBackend $current.backend $entry.candidate){$candidateGeneration=[int]$current.generation;$rollback=Invoke-RouterControl $entry.instance 'switch' $candidateGeneration $entry.old;[void](Wait-RouterHealthy $entry.instance $entry.old -Recovery);Wait-OldInflightZero $entry.instance $candidateGeneration ([string]$entry.candidate.slotId) -Recovery;Write-Status 'CUTOVER_ROLLBACK_PASS' "profile=$($entry.instance.profile) generation=$($rollback.generation)"}elseif(Test-SameBackend $current.backend $entry.old){[void](Wait-RouterHealthy $entry.instance $entry.old -Recovery)}else{throw 'ROLLBACK_POINTER_IDENTITY_UNKNOWN'};Wait-TunnelsForInstance $Managed ([string]$entry.instance.profile) -Recovery;[void](Assert-UpgradeSafe ([int]$entry.old.port) -RequireDrain)}catch{if(-not$rollbackError){$rollbackError=$_}}}
    foreach($entry in $tx){Remove-Item -LiteralPath $entry.oldSlot.drainFile -Force -ErrorAction SilentlyContinue}
    if(-not$rollbackError){try{Stop-InactiveCandidates $Managed $Candidates;Remove-UpdateJournalAfterManagedProof $Managed -Recovery}catch{$rollbackError=$_}}
    if($rollbackError){throw "UPDATE_FAILED_ROLLBACK_UNPROVEN original=$($original.Exception.Message) rollback=$($rollbackError.Exception.Message)"};throw "UPDATE_FAILED_ROLLBACK_PASS original=$($original.Exception.Message)"
  }
  try{Assert-Deadline;foreach($entry in $tx){$current=Read-Json ([string]$entry.instance.pointerPath) 'ROUTER_POINTER';if(-not(Test-SameBackend $current.backend $entry.candidate)){throw 'RETIREMENT_POINTER_IDENTITY_DRIFT'};[void](Save-RemovalEvidence $entry.old $entry.oldSlot.runtimeState ([string]$entry.instance.pointerPath));Stop-OwnedBackendIfRunning $entry.oldSlot.runtimeState $entry.old;$entry.stopped=$true};foreach($entry in $tx){Remove-ValidatedOldRelease $Managed $entry.old};Write-JsonAtomic $ManagedPath $Managed;Remove-UpdateJournalAfterManagedProof $Managed}catch{$retire=$_;throw "SERVICE_ACTIVE_RETIREMENT_INCOMPLETE $($retire.Exception.Message)"}finally{foreach($entry in $tx){Remove-Item -LiteralPath $entry.oldSlot.drainFile -Force -ErrorAction SilentlyContinue}}
}
if ($SelfTest) {
  Assert-Name 'default' 'SELFTEST_NAME'
  if ((Assert-PathUnder $Base (Join-Path $Base 'instances\default') 'SELFTEST_PATH') -notmatch 'instances') { throw 'SELFTEST_PATH_FAILED' }
  function Get-SelfTestScalarPath{Write-Status 'SELFTEST_PROGRESS' 'pipeline isolation';return (Join-Path $Base 'scalar-path')}
  $scalarPath=Get-SelfTestScalarPath
  if($scalarPath-is[array]-or[string]$scalarPath-ne[string](Join-Path $Base 'scalar-path')){throw 'SELFTEST_STATUS_PIPELINE_CONTAMINATION'}
  $matrix=@(
    (Resolve-BootstrapDisposition $false '' $false $false),
    (Resolve-BootstrapDisposition $false '' $false $true),
    (Resolve-BootstrapDisposition $true 'prepared' $false $true),
    (Resolve-BootstrapDisposition $true 'stable-accepted' $false $true),
    (Resolve-BootstrapDisposition $true 'prepared' $true $true)
  )
  if(($matrix-join ',')-ne'bootstrap-new,managed,bootstrap-recover-premanaged,managed-recover-accepted,managed-recover-accepted'){throw 'SELFTEST_BOOTSTRAP_CRASH_MATRIX_FAILED'}
  $decoyRejected=$null;if($SelfTestDecoyPid){$spec=Get-StableSupervisorSpec;$target=Get-CimInstance Win32_Process -Filter "ProcessId=$SelfTestDecoyPid" -ErrorAction Stop;$tokens=@(Split-WindowsCommandLine ([string]$target.CommandLine));if(-not@($tokens|Where-Object{[string]::Equals([string]$_,$spec.script,[StringComparison]::OrdinalIgnoreCase)}).Count){throw "SELFTEST_SUPERVISOR_DECOY_TOKEN_MISSING tokens=$($tokens-join '|') expected=$($spec.script)"};$set=Get-PowerShellIdentitySet $spec.script $spec.executable $spec.arguments;$mentioned=@($set.mentions|Where-Object ProcessId -eq $SelfTestDecoyPid).Count;$matched=@($set.exact|Where-Object ProcessId -eq $SelfTestDecoyPid).Count;if(-not$mentioned-or$matched){throw "SELFTEST_SUPERVISOR_DECOY_NOT_REJECTED pid=$SelfTestDecoyPid mentioned=$mentioned exact=$matched"};$decoyRejected=$true}
  $hardlinkRejected=$null;if($SelfTestLegacyFilePath){try{[void](Assert-LegacyFileSafe $SelfTestLegacyFilePath);throw 'SELFTEST_HARDLINK_WAS_ACCEPTED'}catch{if($_.Exception.Message-ne'LEGACY_FILE_HARDLINK_REFUSED'){throw};$hardlinkRejected=$true}}
  $directoryAdsRejected=$null;if($SelfTestLegacyDirectoryPath){try{[void](Assert-LegacyDirectorySafe $SelfTestLegacyDirectoryPath);throw 'SELFTEST_DIRECTORY_ADS_WAS_ACCEPTED'}catch{if($_.Exception.Message-ne'LEGACY_DIRECTORY_ALTERNATE_STREAM_REFUSED'){throw};$directoryAdsRejected=$true}}
  [pscustomobject]@{ ok=$true; script='bluegreen-windows'; schema=1; planOnly=[bool]$PlanOnly; statusPipelineIsolated=$true;bootstrapCrashBoundaryMatrix=$true;supervisorDecoyRejected=$decoyRejected;hardlinkRejected=$hardlinkRejected;directoryAdsRejected=$directoryAdsRejected;markers=@('git-archive','persistent-config','drain-cas','ownership-stop','rollback-cas','evidence-before-delete') } | ConvertTo-Json -Compress
  exit 0
}
$engineMutex=$null;if(-not$PlanOnly){$engineMutex=[Threading.Mutex]::new($false,'Local\ChatGPTRemoteCommanderBlueGreenEngine');try{$engineLocked=$engineMutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$engineLocked=$true};if(-not$engineLocked){throw 'BLUE_GREEN_ENGINE_ALREADY_RUNNING'}};$authority=Get-SourceAuthority
$cleanupJournalPending=Test-Path -LiteralPath $LegacyCleanupJournalPath -PathType Leaf
$bootstrapJournalExists=Test-Path -LiteralPath $BootstrapJournalPath -PathType Leaf;$managedExists=Test-Path -LiteralPath $ManagedPath -PathType Leaf;$bootstrapJournalRecord=$null;$bootstrapJournalPhase=''
if($bootstrapJournalExists){$bootstrapJournalRecord=Read-BootstrapJournalRecord $authority;if($bootstrapJournalRecord.PSObject.Properties.Name-contains'phase'){$bootstrapJournalPhase=[string]$bootstrapJournalRecord.phase}}
$bootstrapDisposition=Resolve-BootstrapDisposition $bootstrapJournalExists $bootstrapJournalPhase $cleanupJournalPending $managedExists
$bootstrapJournalPending=$bootstrapDisposition-eq'bootstrap-recover-premanaged';$bootstrapAcceptedPending=$bootstrapDisposition-eq'managed-recover-accepted';$bootstrap=$bootstrapDisposition-in@('bootstrap-new','bootstrap-recover-premanaged')
if ($Mode -eq 'Bootstrap' -and -not $bootstrap -and -not $bootstrapAcceptedPending) { throw 'BOOTSTRAP_ALREADY_COMPLETED' }
if ($Mode -eq 'Update' -and $bootstrap) { throw 'UPDATE_REQUIRES_MANAGED_STATE' }
$managed = if($bootstrapJournalPending){Read-BootstrapJournal $authority}elseif($bootstrap){Get-LegacyInventory}else{Assert-ManagedState (Read-Json $ManagedPath 'MANAGED_STATE')}
if (-not $bootstrap -and $managed.PSObject.Properties.Name -contains 'legacyRoot' -and
    [IO.Path]::GetFullPath([string]$managed.legacyRoot) -ne [IO.Path]::GetFullPath($LegacyRoot)) { throw 'LEGACY_ROOT_AUTHORITY_MISMATCH' }
$legacyCleanupPending = -not $bootstrap -and (($managed.PSObject.Properties.Name -contains 'legacyRoot') -or $cleanupJournalPending)
$releasePath=if($PlanOnly){Add-Plan 'release' 'git archive exact commit; validation deferred to execution' $authority.releasePath;$authority.releasePath}else{Prepare-Release $authority}
if ($PlanOnly) {
  foreach ($instance in @($managed.instances)) { Add-Plan 'instance' "candidate on inactive alternating port; config SHA remains $($instance.configSha256)" ([string]$instance.profile) }
  Add-Plan 'cutover' 'drain -> wait safe -> CAS switch -> verify -> rollback CAS on failure -> old in-flight zero -> ownership stop -> evidence -> delete' $ManagedPath
  [pscustomobject]@{ ok=$true; mode=if($bootstrap){'legacy-bootstrap-near-zero'}else{'blue-green-update'}; statefulZeroDowntimeClaimed=$false; authority=$authority; plan=$Script:Plan } | ConvertTo-Json -Depth 12
  exit 0
}
if ($legacyCleanupPending) {
  Assert-ManagedServiceHealthy $managed
  if($cleanupJournalPending){$cleanupJournal=Read-Json $LegacyCleanupJournalPath 'LEGACY_CLEANUP_JOURNAL';if([int]$cleanupJournal.schema-ne 1){throw 'LEGACY_CLEANUP_JOURNAL_SCHEMA_INVALID'};Finalize-LegacyRemoval $managed $cleanupJournal.retirement -Resume}else{if(-not(Test-Path -LiteralPath $LegacyRoot -PathType Container)){throw 'SERVICE_ACTIVE_CLEANUP_INCOMPLETE_LEGACY_ROOT_MISSING'};$retirement=Prepare-LegacyRetirement $managed;Finalize-LegacyRemoval $managed $retirement}
  $managed = Assert-ManagedState (Read-Json $ManagedPath 'MANAGED_STATE')
}
if($bootstrapAcceptedPending){$managed=Assert-ManagedState (Read-Json $ManagedPath 'MANAGED_STATE');Remove-BootstrapJournalAfterManagedProof $managed;Assert-Deadline;Write-Status 'BOOTSTRAP_ACCEPTED_RECOVERY_PASS' "commit=$($authority.commit)";$engineMutex.ReleaseMutex();$engineMutex.Dispose();Write-Status 'BLUE_GREEN_PASS' "commit=$($authority.commit) version=$($authority.version) mode=legacy-bootstrap-recovery";exit 0}
if(-not$bootstrap-and(Test-Path -LiteralPath $UpdateJournalPath -PathType Leaf)){Recover-UpdateTransaction $managed;$managed=Assert-ManagedState (Read-Json $ManagedPath 'MANAGED_STATE')}
if ($bootstrap) { Initialize-PersistentConfigs $managed }
Install-StableControl $releasePath $managed $authority
Assert-ManagedState $managed | Out-Null
if($bootstrap-and-not$bootstrapJournalPending){$run=(Get-ItemProperty -Path $RunKey -Name $RunName -ErrorAction Stop).$RunName;$bgExists=Test-Path $RegistryPath;$bgManaged=$null;$bgManagedExists=$false;if($bgExists){$bg=Get-ItemProperty -Path $RegistryPath;if($bg.PSObject.Properties.Name-contains'ManagedStatePath'){$bgManagedExists=$true;$bgManaged=[string]$bg.ManagedStatePath}};Write-JsonAtomic $BootstrapJournalPath ([ordered]@{schema=1;phase='prepared';commit=$authority.commit;releaseName=$authority.name;createdAt=(Get-Date).ToUniversalTime().ToString('o');managed=$managed;legacyRegistry=[ordered]@{runValue=[string]$run;blueGreenExisted=$bgExists;managedExisted=$bgManagedExists;managedValue=$bgManaged}})}
if ($bootstrapJournalPending) { Recover-PreManagedBootstrapArtifacts $managed }
Invoke-GuiNativeGate $managed $releasePath $bootstrap
$candidates = @{}
try {
  foreach ($instance in @($managed.instances)) {
    if ((Get-Sha256 ([string]$instance.configPath)) -ne [string]$instance.configSha256) { throw "CONFIG_HASH_DRIFT profile=$($instance.profile)" }
    $slotId = if ($bootstrap) { 'blue' } else {
      $pointer = Read-Json ([string]$instance.pointerPath) 'ROUTER_POINTER'
      if ([string]$pointer.backend.slotId -eq 'blue') { 'green' } else { 'blue' }
    }
    $port = if ($slotId -eq 'blue') { [int]$instance.backendPorts[0] } else { [int]$instance.backendPorts[1] }
    $backend = Start-CandidateBackend $instance $authority $releasePath $slotId $port
    $candidates[[string]$instance.profile] = $backend
    Invoke-CandidateRuntimeGates $instance $backend $releasePath
  }
  if ($bootstrap) { Invoke-Bootstrap $managed $authority $releasePath $candidates;$managed=Assert-ManagedState (Read-Json $ManagedPath 'MANAGED_STATE');Remove-BootstrapJournalAfterManagedProof $managed }
  else { Invoke-Update $managed $authority $releasePath $candidates; Start-StableSupervisor }
} catch {
  $original = $_
  try { Stop-InactiveCandidates $managed $candidates }
  catch { throw "BLUE_GREEN_FAILED_CLEANUP_UNPROVEN original=$($original.Exception.Message) cleanup=$($_.Exception.Message)" }
  throw $original
}
Assert-Deadline;$engineMutex.ReleaseMutex();$engineMutex.Dispose();Write-Status 'BLUE_GREEN_PASS' "commit=$($authority.commit) version=$($authority.version) mode=$(if($bootstrap){'legacy-bootstrap-near-zero'}else{'blue-green-update'})"
