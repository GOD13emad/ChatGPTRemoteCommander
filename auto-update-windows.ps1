param(
  [string]$InstallDir = '',
  [string]$SourceRef = '',
  [string]$ExpectedCommit = '',
  [switch]$Force,
  [switch]$PowerMode,
  [switch]$StandardMode,
  [switch]$GuiControl,
  [switch]$DisableGuiControl,
  [string[]]$DisableCapability = @(),
  [string[]]$EnableCapability = @(),
  [switch]$SelfTest,
  [switch]$NoPromote,
  [ValidateRange(5,300)][int]$DrainTimeoutSeconds = 60
)
$ErrorActionPreference='Stop'
if($PowerMode -and $StandardMode){throw 'PowerMode and StandardMode are mutually exclusive.'}
if($GuiControl -and $DisableGuiControl){throw 'GuiControl and DisableGuiControl are mutually exclusive.'}
if($GuiControl -and $StandardMode){throw 'GuiControl cannot be combined with StandardMode.'}

$Repo='https://github.com/GOD13emad/ChatGPTRemoteCommander.git'
$StateRoot=Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander'
if([string]::IsNullOrWhiteSpace($InstallDir)){ $InstallDir=Join-Path $StateRoot 'app' }
$InstallDir=[IO.Path]::GetFullPath($InstallDir)
$ReleaseRoot=Join-Path $StateRoot 'releases'
$RoutingRoot=Join-Path $StateRoot 'routing'
$RuntimeRoot=Join-Path $StateRoot 'runtimes'
$InstanceRoot=Join-Path $StateRoot 'instances'
$ProfileDir=Join-Path $env:APPDATA 'tunnel-client'
$LogDir=Join-Path $StateRoot 'update-logs'
$ResultFile=Join-Path $StateRoot 'last-update.json'
New-Item -ItemType Directory -Force -Path $ReleaseRoot,$RoutingRoot,$RuntimeRoot,$LogDir | Out-Null

function Log([string]$Message){
  $line="$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath (Join-Path $LogDir 'auto-update.log') -Value $line -Encoding utf8
  if(-not $SelfTest){ Write-Host $Message }
}
function Atomic-Json([string]$Path,[object]$Value){
  $tmp="$Path.tmp-$PID"
  [IO.File]::WriteAllText($tmp,($Value|ConvertTo-Json -Depth 30)+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}
function Test-ProfileName([string]$Name){
  return ($Name -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -and $Name -notmatch '\.\.' -and $Name -notin @('.','..'))
}
function Get-RoutePath([string]$Profile){ Join-Path $RoutingRoot "$Profile.json" }
function Read-Json([string]$Path){ Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json }
function Get-PrimaryConfig {
  $route=Get-RoutePath 'default'
  if(Test-Path $route){
    $r=Read-Json $route
    if($r.active.configPath -and (Test-Path -LiteralPath $r.active.configPath)){ return [IO.Path]::GetFullPath([string]$r.active.configPath) }
  }
  $local=Join-Path $InstallDir 'config.local.json'
  if(Test-Path -LiteralPath $local){ return $local }
  return (Join-Path $InstallDir 'config.json')
}
function Invoke-Mcp([int]$Port,[string]$Name,[hashtable]$Arguments=@{}){
  $body=@{jsonrpc='2.0';id=1;method='tools/call';params=@{name=$Name;arguments=$Arguments}}|ConvertTo-Json -Depth 20 -Compress
  $r=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/mcp" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 30
  if($r.error){ throw "MCP_RPC_ERROR $($r.error.message)" }
  if($r.result.isError){ throw "MCP_TOOL_ERROR $Name $($r.result.content[0].text)" }
  return $r.result.structuredContent
}
function Wait-Health([int]$Port,[string]$Version,[string]$ConfigSha,[string]$Profile,[int]$Seconds=30){
  foreach($i in 1..($Seconds*2)){
    try{
      $h=Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2
      if($h.ok -and [string]$h.version -eq $Version -and [string]$h.configSha256 -eq $ConfigSha -and [string]$h.instance.profile -eq $Profile){ return $h }
    }catch{}
    Start-Sleep -Milliseconds 500
  }
  throw "CANDIDATE_HEALTH_TIMEOUT profile=$Profile port=$Port"
}
function Get-FreePort([System.Collections.Generic.HashSet[int]]$Used){
  foreach($p in 48831..51999){
    if($Used.Contains($p)){ continue }
    if(-not(Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue)){
      [void]$Used.Add($p);return $p
    }
  }
  throw 'NO_PRIVATE_BACKEND_PORT'
}
function Get-LatestTag {
  if($SourceRef){ return $SourceRef }
  $release=Invoke-RestMethod 'https://api.github.com/repos/GOD13emad/ChatGPTRemoteCommander/releases/latest' -Headers @{'User-Agent'='ChatGPTRemoteCommander-Updater'} -TimeoutSec 20
  if($release.draft -or $release.prerelease){ throw 'LATEST_RELEASE_NOT_STABLE' }
  $tag=[string]$release.tag_name
  if($tag -notmatch '^v\d+\.\d+\.\d+$'){ throw 'LATEST_RELEASE_TAG_INVALID' }
  return $tag
}
function Stage-Release([string]$Ref){
  $tmp=Join-Path $ReleaseRoot ("stage-{0}-{1}" -f ($Ref -replace '[^A-Za-z0-9._-]','_'),$PID)
  if(Test-Path $tmp){Remove-Item $tmp -Recurse -Force}
  New-Item -ItemType Directory -Path $tmp|Out-Null
  & git.exe -C $tmp init | Out-Null
  if($LASTEXITCODE-ne 0){throw 'STAGE_GIT_INIT'}
  & git.exe -C $tmp remote add origin $Repo
  & git.exe -C $tmp fetch --depth 1 --no-tags origin $Ref
  if($LASTEXITCODE-ne 0){throw 'STAGE_GIT_FETCH'}
  $commit=(& git.exe -C $tmp rev-parse 'FETCH_HEAD^{commit}').Trim().ToLowerInvariant()
  if($commit -notmatch '^[0-9a-f]{40}$'){throw 'STAGE_COMMIT_INVALID'}
  if($ExpectedCommit -and $commit-ne $ExpectedCommit.ToLowerInvariant()){throw 'STAGE_EXPECTED_COMMIT_MISMATCH'}
  & git.exe -C $tmp checkout --detach $commit | Out-Null
  if($LASTEXITCODE-ne 0){throw 'STAGE_CHECKOUT'}
  $pkg=Read-Json (Join-Path $tmp 'package.json')
  $version=[string]$pkg.version
  if($Ref -match '^v(\d+\.\d+\.\d+)$' -and $Matches[1]-ne $version){throw 'STAGE_TAG_VERSION_MISMATCH'}
  $final=Join-Path $ReleaseRoot ("v{0}-{1}" -f $version,$commit.Substring(0,12))
  if(Test-Path $final){
    $head=(& git.exe -C $final rev-parse HEAD 2>$null).Trim().ToLowerInvariant()
    if($head-ne $commit){throw 'RELEASE_DIRECTORY_COLLISION'}
    Remove-Item $tmp -Recurse -Force
  }else{
    Move-Item $tmp $final
  }
  return [pscustomobject]@{Ref=$Ref;Commit=$commit;Version=$version;Dir=$final}
}
function Run-Gate([string]$Candidate,[string]$Name,[string[]]$CommandArgs){
  Log "GATE_START $Name"
  if(-not $CommandArgs -or $CommandArgs.Count -lt 1){throw "GATE_ARGUMENTS_MISSING $Name"}
  & npm.cmd @CommandArgs
  if($LASTEXITCODE-ne 0){throw "GATE_FAIL $Name"}
  Log "GATE_PASS $Name"
}
function Start-Backend([string]$ProjectDir,[string]$ConfigPath,[string]$StateDir){
  New-Item -ItemType Directory -Force -Path $StateDir|Out-Null
  $node=(Get-Command node.exe -ErrorAction Stop).Source
  $psi=[Diagnostics.ProcessStartInfo]::new()
  $psi.FileName=$node
  $psi.WorkingDirectory=$ProjectDir
  $psi.UseShellExecute=$false
  $psi.CreateNoWindow=$true
  [void]$psi.ArgumentList.Add((Join-Path $ProjectDir 'src\server-v0.3.mjs'))
  $psi.Environment['REMOTE_COMMANDER_CONFIG']=$ConfigPath
  return [Diagnostics.Process]::Start($psi)
}
function Get-Targets {
  $items=@()
  $primary=Get-PrimaryConfig
  $items+=[pscustomobject]@{Profile='default';CanonicalPort=47831;ExistingConfig=$primary;RoutePath=(Get-RoutePath 'default');InstanceDir=(Join-Path $InstanceRoot 'default')}
  if(Test-Path $InstanceRoot){
    foreach($profileDir in Get-ChildItem -LiteralPath $InstanceRoot -Directory -ErrorAction SilentlyContinue){
      $recordFile=Join-Path $profileDir.FullName 'instance.json'
      if(-not(Test-Path -LiteralPath $recordFile -PathType Leaf)){continue}
      try{
        $record=Read-Json $recordFile
        $profile=[string]$record.profile
        if(-not(Test-ProfileName $profile) -or $profile-eq 'default' -or $record.enabled-ne $true){continue}
        if($profileDir.Name-ne $profile){throw "PROFILE_DIRECTORY_MISMATCH expected=$profile actual=$($profileDir.Name)"}
        $route=Get-RoutePath $profile
        $cfg=[string]$record.configPath
        if(Test-Path $route){
          $rr=Read-Json $route
          if($rr.active.configPath -and (Test-Path -LiteralPath $rr.active.configPath)){$cfg=[string]$rr.active.configPath}
        }
        $items+=[pscustomobject]@{Profile=$profile;CanonicalPort=[int]$record.mcpPort;ExistingConfig=$cfg;RoutePath=$route;InstanceDir=$profileDir.FullName}
      }catch{throw "TARGET_DISCOVERY_FAIL $recordFile $($_.Exception.Message)"}
    }
  }
  return @($items|Sort-Object CanonicalPort,Profile)
}
function Start-Router([int]$CanonicalPort,[string]$RoutePath,[string]$RouterSource,[string]$Profile){
  try{
    $st=Invoke-RestMethod "http://127.0.0.1:$CanonicalPort/router/status" -TimeoutSec 2
    if($st.ok -and $st.router){return $null}
  }catch{}
  $listener=Get-NetTCPConnection -State Listen -LocalPort $CanonicalPort -ErrorAction SilentlyContinue|Select-Object -First 1
  if($listener){throw "ROUTER_PORT_OCCUPIED profile=$Profile port=$CanonicalPort pid=$($listener.OwningProcess)"}
  $node=(Get-Command node.exe -ErrorAction Stop).Source
  $runtime=Join-Path $RoutingRoot "$Profile.runtime.json"
  $psi=[Diagnostics.ProcessStartInfo]::new()
  $psi.FileName=$node;$psi.WorkingDirectory=$StateRoot;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  foreach($x in @($RouterSource,'--listen-port',[string]$CanonicalPort,'--state-file',$RoutePath,'--runtime-file',$runtime)){[void]$psi.ArgumentList.Add($x)}
  $p=[Diagnostics.Process]::Start($psi)
  foreach($i in 1..40){
    Start-Sleep -Milliseconds 250
    try{$st=Invoke-RestMethod "http://127.0.0.1:$CanonicalPort/router/status" -TimeoutSec 1;if($st.ok -and $st.router){return $p}}catch{}
    if($p.HasExited){break}
  }
  if(-not $p.HasExited){Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue}
  throw "ROUTER_START_FAIL profile=$Profile"
}
function Stop-OwnedDirect([object]$Target){
  $listener=Get-NetTCPConnection -State Listen -LocalPort $Target.CanonicalPort -ErrorAction SilentlyContinue|Select-Object -First 1
  if(-not $listener){return $null}
  $marker=if($Target.Profile-eq 'default'){Join-Path $InstallDir 'var\mcp-runtime.json'}else{Join-Path $Target.InstanceDir 'mcp-runtime.json'}
  if(-not(Test-Path -LiteralPath $marker)){throw "DIRECT_MARKER_MISSING profile=$($Target.Profile)"}
  $m=Read-Json $marker
  if([int]$m.pid-ne [int]$listener.OwningProcess -or [int]$m.port-ne $Target.CanonicalPort -or [string]$m.instance.profile-ne $Target.Profile){throw "DIRECT_OWNERSHIP_MISMATCH profile=$($Target.Profile)"}
  Stop-Process -Id $listener.OwningProcess -Force
  foreach($i in 1..40){Start-Sleep -Milliseconds 100;if(-not(Get-NetTCPConnection -State Listen -LocalPort $Target.CanonicalPort -ErrorAction SilentlyContinue)){return $m}}
  throw "DIRECT_STOP_TIMEOUT profile=$($Target.Profile)"
}
function Write-InitialRoute([object]$Target,[object]$Candidate){
  $state=[ordered]@{
    schema=1;profile=$Target.Profile;generation=1
    active=[ordered]@{port=$Candidate.Port;version=$Candidate.Version;commit=$Candidate.Commit;configSha256=$Candidate.ConfigSha;configPath=$Candidate.ConfigPath;projectDir=$Candidate.ProjectDir}
    previous=$null;updatedAt=(Get-Date).ToUniversalTime().ToString('o')
  }
  Atomic-Json $Target.RoutePath $state
}
function Switch-Route([object]$Target,[object]$Candidate){
  $state=Read-Json $Target.RoutePath
  & node.exe (Join-Path $Candidate.ProjectDir 'tools\router-switch.mjs') --state $Target.RoutePath --expected-generation ([string]$state.generation) --profile $Target.Profile --port ([string]$Candidate.Port) --version $Candidate.Version --commit $Candidate.Commit --config-sha $Candidate.ConfigSha --config-path $Candidate.ConfigPath --project-dir $Candidate.ProjectDir
  if($LASTEXITCODE-ne 0){throw "ROUTER_SWITCH_FAIL profile=$($Target.Profile)"}
}
function Verify-Canonical([object]$Target,[object]$Candidate){
  $status=Invoke-Mcp $Target.CanonicalPort 'system_status'
  if([string]$status.version-ne $Candidate.Version -or [string]$status.configSha256-ne $Candidate.ConfigSha -or [string]$status.instance.profile-ne $Target.Profile){throw "CANONICAL_VERIFY_FAIL profile=$($Target.Profile)"}
}
function Verify-Tunnels {
  if(-not(Test-Path $ProfileDir)){return}
  foreach($f in Get-ChildItem -LiteralPath $ProfileDir -Filter '*.yaml' -File -ErrorAction SilentlyContinue){
    $raw=Get-Content -LiteralPath $f.FullName -Raw
    $m=[regex]::Match($raw,'listen_addr:\s*["'']?127\.0\.0\.1:(\d+)')
    if(-not $m.Success){continue}
    $port=[int]$m.Groups[1].Value
    $ready=$false
    foreach($i in 1..20){try{$x=Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/readyz" -TimeoutSec 1;if($x.StatusCode-eq 200 -and $x.Content.Trim()-eq 'ready'){$ready=$true;break}}catch{};Start-Sleep -Milliseconds 250}
    if(-not $ready){throw "TUNNEL_NOT_READY profile=$([IO.Path]::GetFileNameWithoutExtension($f.Name)) port=$port"}
  }
}
function Stop-OldBackend([object]$Active){
  if(-not $Active -or -not $Active.configPath){return}
  try{
    $cfg=Read-Json ([string]$Active.configPath)
    $marker=[string]$cfg.runtimeState
    if(-not $marker -or -not(Test-Path -LiteralPath $marker)){return}
    $m=Read-Json $marker
    $listener=Get-NetTCPConnection -State Listen -LocalPort ([int]$Active.port) -ErrorAction SilentlyContinue|Select-Object -First 1
    if($listener -and [int]$listener.OwningProcess-eq [int]$m.pid -and [string]$m.projectDir-eq [string]$Active.projectDir){Stop-Process -Id $m.pid -Force -ErrorAction Stop}
  }catch{Log "OLD_BACKEND_STOP_WARN $($_.Exception.Message)"}
}
function Drain-Previous([object]$Target,[object]$OldActive){
  if(-not $OldActive){return}
  $deadline=(Get-Date).AddSeconds($DrainTimeoutSeconds)
  while((Get-Date)-lt $deadline){
    try{
      $st=Invoke-RestMethod "http://127.0.0.1:$($Target.CanonicalPort)/router/status" -TimeoutSec 2
      $n=0
      if($st.inflightByPort.PSObject.Properties.Name -contains ([string]$OldActive.port)){$n=[int]$st.inflightByPort.([string]$OldActive.port)}
      if($n-eq 0){Stop-OldBackend $OldActive;return}
    }catch{}
    Start-Sleep -Milliseconds 250
  }
  throw "DRAIN_TIMEOUT profile=$($Target.Profile)"
}
function Promote-Control([string]$Commit,[string]$Ref){
  $dirty=& git.exe -C $InstallDir status --porcelain --untracked-files=no
  if($LASTEXITCODE-ne 0){throw 'CONTROL_GIT_STATUS_FAIL'}
  if($dirty){throw 'CONTROL_TRACKED_DIRTY'}
  & git.exe -C $InstallDir fetch --no-tags origin $Ref
  if($LASTEXITCODE-ne 0){throw 'CONTROL_FETCH_FAIL'}
  $resolved=(& git.exe -C $InstallDir rev-parse 'FETCH_HEAD^{commit}').Trim().ToLowerInvariant()
  if($resolved-ne $Commit){throw 'CONTROL_COMMIT_MISMATCH'}
  & git.exe -C $InstallDir checkout --detach --force $Commit | Out-Null
  if($LASTEXITCODE-ne 0){throw 'CONTROL_CHECKOUT_FAIL'}
}
function Recycle-ControlSupervisor {
  $runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  $runValue=(Get-ItemProperty -Path $runKey -Name 'ChatGPTRemoteCommander' -ErrorAction SilentlyContinue).ChatGPTRemoteCommander
  $rootPattern=[regex]::Escape($InstallDir)
  $existing=@(Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'autostart-windows\.ps1' -and $_.CommandLine -match $rootPattern })
  if(-not $runValue -and $existing.Count -eq 0){return}
  foreach($proc in $existing){
    try{Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop;Log "SUPERVISOR_RECYCLE_STOP pid=$($proc.ProcessId)"}catch{Log "SUPERVISOR_RECYCLE_STOP_WARN pid=$($proc.ProcessId) $($_.Exception.Message)"}
  }
  $script=Join-Path $InstallDir 'autostart-windows.ps1'
  if(-not(Test-Path -LiteralPath $script -PathType Leaf)){throw 'SUPERVISOR_SCRIPT_MISSING_AFTER_PROMOTION'}
  $pwsh=(Get-Command pwsh.exe -ErrorAction Stop).Source
  $proc=Start-Process -FilePath $pwsh -ArgumentList @('-NoLogo','-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',$script) -WindowStyle Hidden -PassThru
  foreach($i in 1..40){
    Start-Sleep -Milliseconds 250
    if(-not $proc.HasExited){
      try{
        $h=Invoke-RestMethod 'http://127.0.0.1:47831/health' -TimeoutSec 1
        if($h.ok){Log "SUPERVISOR_RECYCLE_PASS pid=$($proc.Id)";return}
      }catch{}
    }else{break}
  }
  throw 'SUPERVISOR_RECYCLE_FAIL'
}

function Cleanup-Releases {
  $active=@{}
  foreach($f in Get-ChildItem -LiteralPath $RoutingRoot -Filter '*.json' -File -ErrorAction SilentlyContinue){
    if($f.Name -like '*.runtime.json'){continue}
    try{$r=Read-Json $f.FullName;if($r.active.projectDir){$active[[IO.Path]::GetFullPath([string]$r.active.projectDir).ToLowerInvariant()]=$true}}catch{}
  }
  foreach($d in Get-ChildItem -LiteralPath $ReleaseRoot -Directory -ErrorAction SilentlyContinue){
    $key=[IO.Path]::GetFullPath($d.FullName).ToLowerInvariant()
    if(-not $active.ContainsKey($key)){Remove-Item -LiteralPath $d.FullName -Recurse -Force -ErrorAction SilentlyContinue}
  }
}
if($SelfTest){
  [pscustomobject]@{ok=$true;installDir=$InstallDir;stateRoot=$StateRoot;releaseRoot=$ReleaseRoot;routingRoot=$RoutingRoot}|ConvertTo-Json -Compress
  exit 0
}

$created=$false
$mutex=[Threading.Mutex]::new($false,'Local\ChatGPTRemoteCommanderAutoUpdater',[ref]$created)
if(-not $created){Log 'AUTO_UPDATE_ALREADY_RUNNING';exit 0}

$candidates=@();$routeBackups=@{};$initialDirect=@{};$cutoverCommitted=$false;$report=[ordered]@{startedAt=(Get-Date).ToUniversalTime().ToString('o');status='RUNNING';gates=@();profiles=@()}
try{
  $primaryConfig=Read-Json (Get-PrimaryConfig)
  if(-not $Force -and $primaryConfig.autoUpdate.enabled-ne $true){Log 'AUTO_UPDATE_DISABLED';$report.status='DISABLED';Atomic-Json $ResultFile $report;exit 0}
  $ref=Get-LatestTag
  $stage=Stage-Release $ref
  $report.ref=$ref;$report.commit=$stage.Commit;$report.version=$stage.Version
  $currentStatus=$null
  try{$currentStatus=Invoke-Mcp 47831 'system_status'}catch{}
  if(-not $Force -and $currentStatus -and [string]$currentStatus.version-eq $stage.Version){
    $route=Get-RoutePath 'default'
    if(Test-Path $route){
      $rs=Read-Json $route
      if([string]$rs.active.commit-eq $stage.Commit){
        $controlHead=''
        try{$controlHead=(& git.exe -C $InstallDir rev-parse HEAD).Trim().ToLowerInvariant()}catch{}
        if($controlHead-ne $stage.Commit){
          Log "AUTO_UPDATE_MAINTENANCE controlHead=$controlHead target=$($stage.Commit)"
          foreach($rf in Get-ChildItem -LiteralPath $RoutingRoot -Filter '*.json' -File -ErrorAction SilentlyContinue){
            if($rf.Name -like '*.runtime.json'){continue}
            try{
              $rr=Read-Json $rf.FullName
              $cfg=Read-Json ([string]$rr.active.configPath)
              $wfDir=[string]$cfg.durableWorkflows.directory
              if($wfDir){
                & node.exe (Join-Path $stage.Dir 'tools\finalize-workflow-schema.mjs') --directory $wfDir
                if($LASTEXITCODE-ne 0){throw "MAINTENANCE_SCHEMA_FINALIZE_FAIL profile=$($rr.profile)"}
              }
            }catch{throw}
          }
          Promote-Control $stage.Commit $ref
          Recycle-ControlSupervisor
          Cleanup-Releases
          $report.status='MAINTENANCE_REPAIRED';$report.completedAt=(Get-Date).ToUniversalTime().ToString('o')
          Atomic-Json $ResultFile $report
          Log "AUTO_UPDATE_MAINTENANCE_PASS version=$($stage.Version)"
          exit 0
        }
        Cleanup-Releases
        Log "AUTO_UPDATE_CURRENT version=$($stage.Version)"
        $report.status='CURRENT';Atomic-Json $ResultFile $report;exit 0
      }
    }
  }

  Push-Location $stage.Dir
  try{
    Run-Gate $stage.Dir 'check' @('run','check')
    Run-Gate $stage.Dir 'test' @('test')
    Run-Gate $stage.Dir 'audit' @('run','audit')
    if($primaryConfig.powerMode.enabled-eq $true -and $primaryConfig.powerMode.guiControl.enabled-eq $true){
      Run-Gate $stage.Dir 'gui-native' @('run','test:gui-native')
    }
  }finally{Pop-Location}

  $targets=Get-Targets
  $used=[System.Collections.Generic.HashSet[int]]::new()
  foreach($t in $targets){[void]$used.Add([int]$t.CanonicalPort)}
  if(Test-Path $ProfileDir){
    foreach($f in Get-ChildItem $ProfileDir -Filter '*.yaml' -File -ErrorAction SilentlyContinue){
      $raw=Get-Content $f.FullName -Raw
      foreach($rx in @('listen_addr:\s*["'']?127\.0\.0\.1:(\d+)','url:\s*["'']?http://127\.0\.0\.1:(\d+)/mcp')){
        $m=[regex]::Match($raw,$rx);if($m.Success){[void]$used.Add([int]$m.Groups[1].Value)}
      }
    }
  }
  $device=if($currentStatus){[string]$currentStatus.deviceName}else{$env:COMPUTERNAME}
  foreach($t in $targets){
    $port=Get-FreePort $used
    $stateDir=Join-Path $RuntimeRoot (Join-Path $stage.Commit $t.Profile)
    New-Item -ItemType Directory -Force -Path $stateDir|Out-Null
    $existingPolicy=Read-Json $t.ExistingConfig
    $liveWorkflowDir=[string]$existingPolicy.durableWorkflows.directory
    $backupDir=Join-Path $StateRoot (Join-Path 'update-backups' (Join-Path $stage.Commit $t.Profile))
    $shadowWorkflowDir=Join-Path $backupDir 'workflow-shadow'
    New-Item -ItemType Directory -Force -Path $backupDir|Out-Null
    Copy-Item -LiteralPath $t.ExistingConfig -Destination (Join-Path $backupDir 'config.before.json') -Force
    if($liveWorkflowDir){
      & node.exe (Join-Path $stage.Dir 'tools\copy-workflow-store.mjs') --source-dir $liveWorkflowDir --dest-dir $shadowWorkflowDir
      if($LASTEXITCODE-ne 0){throw "WORKFLOW_SHADOW_COPY_FAIL profile=$($t.Profile)"}
    }

    $cfg=Join-Path $stateDir 'diagnostic-config.json'
    $buildArgs=@((Join-Path $stage.Dir 'tools\build-candidate-config.mjs'),'--default',(Join-Path $stage.Dir 'config.json'),'--existing',$t.ExistingConfig,'--output',$cfg,'--profile-id',$t.Profile,'--port',[string]$port,'--state-dir',$stateDir,'--workflow-dir',$shadowWorkflowDir)
    if($PowerMode){$buildArgs+=@('--mode','full')}elseif($StandardMode){$buildArgs+=@('--mode','standard')}else{$buildArgs+=@('--mode','preserve')}
    if($GuiControl){$buildArgs+=@('--gui','on')}elseif($DisableGuiControl){$buildArgs+=@('--gui','off')}
    foreach($cap in $DisableCapability){$buildArgs+=@('--disable-capability',$cap)}
    foreach($cap in $EnableCapability){$buildArgs+=@('--enable-capability',$cap)}
    & node.exe @buildArgs
    if($LASTEXITCODE-ne 0){throw "CANDIDATE_CONFIG_FAIL profile=$($t.Profile)"}
    $sha=(Get-FileHash -LiteralPath $cfg -Algorithm SHA256).Hash.ToLowerInvariant()
    $p=Start-Backend $stage.Dir $cfg $stateDir
    $h=Wait-Health $port $stage.Version $sha $t.Profile
    & node.exe (Join-Path $stage.Dir 'tools\doctor.mjs') --url "http://127.0.0.1:$port/mcp" --expected-device $device --expected-version $stage.Version --config $cfg --json
    if($LASTEXITCODE-ne 0){throw "CANDIDATE_DOCTOR_FAIL profile=$($t.Profile)"}
    $status=Invoke-Mcp $port 'system_status'
    $expected=Read-Json $cfg
    if($expected.capabilityProfile.tier-eq 'FULL_POWER'){
      if($status.capabilityProfile.tier-ne 'FULL_POWER' -or $status.capabilityProfile.autoEnableNewCapabilities-ne $true){throw "FULL_POWER_PROFILE_FAIL profile=$($t.Profile)"}
      $disabled=@($expected.capabilityProfile.disabledCapabilities)
      if(-not($disabled -contains 'filesystem.full') -and $status.powerMode.fullFilesystem-ne $true){throw 'FULL_POWER_FILESYSTEM_FAIL'}
      if(-not($disabled -contains 'shell.execute') -and $status.powerMode.allowShell-ne $true){throw 'FULL_POWER_SHELL_FAIL'}
      if(-not($disabled -contains 'process.control') -and $status.powerMode.allowProcessControl-ne $true){throw 'FULL_POWER_PROCESS_FAIL'}
      if(-not($disabled -contains 'filesystem.permanent_delete') -and $status.powerMode.allowPermanentDelete-ne $true){throw 'FULL_POWER_DELETE_FAIL'}
      [void](Invoke-Mcp $port 'file_info' @{path=$env:TEMP})
      [void](Invoke-Mcp $port 'system_info')
      [void](Invoke-Mcp $port 'list_processes')
      if(-not($disabled -contains 'shell.execute')){
        $shell=Invoke-Mcp $port 'run_shell' @{command='Write-Output RC_AUTOUPDATE_SHELL_PASS';timeoutMs=10000}
        if([string]$shell.stdout -notmatch 'RC_AUTOUPDATE_SHELL_PASS'){throw 'FULL_POWER_SHELL_E2E_FAIL'}
      }
      if($expected.powerMode.guiControl.enabled-eq $true){[void](Invoke-Mcp $port 'gui_status')}
    }
    if($expected.durableWorkflows.enabled-eq $true){
      $wf=Invoke-Mcp $port 'workflow_health'
      if($wf.ok-ne $true -or [string]$wf.databaseIntegrity-ne 'ok'){throw "WORKFLOW_HEALTH_FAIL profile=$($t.Profile)"}
    }

    # Diagnostic backend passed on a shadow store. Rebuild against the live durable
    # store while its DB is still v1-compatible, then run identity/doctor once more.
    if($p -and -not $p.HasExited){Stop-Process -Id $p.Id -Force -ErrorAction Stop}
    foreach($i in 1..40){Start-Sleep -Milliseconds 100;if(-not(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)){break}}
    $finalCfg=Join-Path $stateDir 'config.json'
    $finalArgs=@((Join-Path $stage.Dir 'tools\build-candidate-config.mjs'),'--default',(Join-Path $stage.Dir 'config.json'),'--existing',$t.ExistingConfig,'--output',$finalCfg,'--profile-id',$t.Profile,'--port',[string]$port,'--state-dir',$stateDir)
    if($liveWorkflowDir){$finalArgs+=@('--workflow-dir',$liveWorkflowDir)}
    if($PowerMode){$finalArgs+=@('--mode','full')}elseif($StandardMode){$finalArgs+=@('--mode','standard')}else{$finalArgs+=@('--mode','preserve')}
    if($GuiControl){$finalArgs+=@('--gui','on')}elseif($DisableGuiControl){$finalArgs+=@('--gui','off')}
    foreach($cap in $DisableCapability){$finalArgs+=@('--disable-capability',$cap)}
    foreach($cap in $EnableCapability){$finalArgs+=@('--enable-capability',$cap)}
    & node.exe @finalArgs
    if($LASTEXITCODE-ne 0){throw "FINAL_CONFIG_FAIL profile=$($t.Profile)"}
    $finalSha=(Get-FileHash -LiteralPath $finalCfg -Algorithm SHA256).Hash.ToLowerInvariant()
    $p=Start-Backend $stage.Dir $finalCfg $stateDir
    [void](Wait-Health $port $stage.Version $finalSha $t.Profile)
    & node.exe (Join-Path $stage.Dir 'tools\doctor.mjs') --url "http://127.0.0.1:$port/mcp" --expected-device $device --expected-version $stage.Version --config $finalCfg --json
    if($LASTEXITCODE-ne 0){throw "FINAL_CANDIDATE_DOCTOR_FAIL profile=$($t.Profile)"}
    if((Read-Json $finalCfg).durableWorkflows.enabled-eq $true){
      $wf=Invoke-Mcp $port 'workflow_health'
      if($wf.ok-ne $true -or [string]$wf.databaseIntegrity-ne 'ok'){throw "FINAL_WORKFLOW_HEALTH_FAIL profile=$($t.Profile)"}
    }
    $c=[pscustomobject]@{Profile=$t.Profile;CanonicalPort=$t.CanonicalPort;Port=$port;Version=$stage.Version;Commit=$stage.Commit;ConfigSha=$finalSha;ConfigPath=$finalCfg;ProjectDir=$stage.Dir;Process=$p;Target=$t;WorkflowDir=$liveWorkflowDir;BackupDir=$backupDir}
    $candidates+=$c
    $report.profiles+=@{profile=$t.Profile;candidatePort=$port;configSha256=$finalSha;doctor='PASS';hardware='PASS';shadowStore='PASS';liveStoreCompatibility='PASS'}
  }

  if($NoPromote){
    foreach($c in $candidates){
      try{
        if($c.Process -and -not $c.Process.HasExited){
          $listener=Get-NetTCPConnection -State Listen -LocalPort $c.Port -ErrorAction SilentlyContinue|Select-Object -First 1
          $cfg=Read-Json $c.ConfigPath
          $markerFile=[string]$cfg.runtimeState
          $marker=if($markerFile -and (Test-Path -LiteralPath $markerFile -PathType Leaf)){Read-Json $markerFile}else{$null}
          if($listener -and $marker -and [int]$listener.OwningProcess-eq [int]$c.Process.Id -and [int]$marker.pid-eq [int]$c.Process.Id -and [int]$marker.port-eq [int]$c.Port -and [string]$marker.instance.profile-eq [string]$c.Profile){
            Stop-Process -Id $c.Process.Id -Force -ErrorAction Stop
          }else{
            throw "CANDIDATE_CLEANUP_OWNERSHIP_MISMATCH profile=$($c.Profile)"
          }
        }
      }catch{throw}
    }
    $report.status='CANDIDATE_PASS';$report.completedAt=(Get-Date).ToUniversalTime().ToString('o')
    Atomic-Json $ResultFile $report
    Log 'AUTO_UPDATE_CANDIDATE_PASS'
    exit 0
  }

  foreach($c in $candidates){
    $t=$c.Target
    if(Test-Path $t.RoutePath){
      $routeBackups[$t.Profile]=Get-Content -LiteralPath $t.RoutePath -Raw
      Switch-Route $t $c
    }else{
      $initialDirect[$t.Profile]=Stop-OwnedDirect $t
      Write-InitialRoute $t $c
      [void](Start-Router $t.CanonicalPort $t.RoutePath (Join-Path $stage.Dir 'src\stable-router.mjs') $t.Profile)
    }
  }

  foreach($c in $candidates){Verify-Canonical $c.Target $c}
  Verify-Tunnels
  $cutoverCommitted=$true
  $report.cutoverCommittedAt=(Get-Date).ToUniversalTime().ToString('o')

  foreach($c in $candidates){
    if($routeBackups.ContainsKey($c.Profile)){
      $old=($routeBackups[$c.Profile]|ConvertFrom-Json).active
      Drain-Previous $c.Target $old
    }
  }

  foreach($c in $candidates){
    if($c.WorkflowDir){
      & node.exe (Join-Path $stage.Dir 'tools\finalize-workflow-schema.mjs') --directory $c.WorkflowDir
      if($LASTEXITCODE-ne 0){throw "WORKFLOW_SCHEMA_FINALIZE_FAIL profile=$($c.Profile)"}
      $wf=Invoke-Mcp $c.CanonicalPort 'workflow_health'
      if([int]$wf.databaseSchemaVersion-ne 2){throw "WORKFLOW_SCHEMA_FINALIZE_VERIFY_FAIL profile=$($c.Profile)"}
    }
  }

  Promote-Control $stage.Commit $ref
  Recycle-ControlSupervisor
  Cleanup-Releases
  $report.status='PROMOTED';$report.completedAt=(Get-Date).ToUniversalTime().ToString('o')
  Atomic-Json $ResultFile $report
  Log "AUTO_UPDATE_PASS version=$($stage.Version) commit=$($stage.Commit)"
}catch{
  $report.status='FAILED';$report.error=$_.Exception.Message;$report.completedAt=(Get-Date).ToUniversalTime().ToString('o')
  try{Atomic-Json $ResultFile $report}catch{}
  Log "AUTO_UPDATE_FAIL $($_.Exception.Message)"
  if(-not $cutoverCommitted){
    foreach($c in $candidates){try{if($c.Process -and -not $c.Process.HasExited){Stop-Process -Id $c.Process.Id -Force -ErrorAction SilentlyContinue}}catch{}}
    foreach($profile in @($routeBackups.Keys)){
      try{[IO.File]::WriteAllText((Get-RoutePath $profile),[string]$routeBackups[$profile],[Text.UTF8Encoding]::new($false))}catch{}
    }
  }else{
    $report.status='PROMOTED_MAINTENANCE_REQUIRED'
    try{Atomic-Json $ResultFile $report}catch{}
    Log 'AUTO_UPDATE_POST_COMMIT_MAINTENANCE_REQUIRED'
  }
  throw
}finally{
  try{$mutex.ReleaseMutex()}catch{}
  $mutex.Dispose()
}
