#requires -Version 7.0
param([Parameter(Mandatory=$true)][string]$ExpectedCommit)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not $IsWindows -or $env:CI -ne 'true' -or -not $env:RUNNER_TEMP -or -not $env:GITHUB_WORKSPACE){throw 'R173_WINDOWS_CI_ONLY'}
if($ExpectedCommit -notmatch '^[0-9a-f]{40}$'){throw 'R173_EXACT_COMMIT_REQUIRED'}
$Source=[IO.Path]::GetFullPath($env:GITHUB_WORKSPACE)
$Root=Join-Path ([IO.Path]::GetFullPath($env:RUNNER_TEMP)) 'remote-commander-rollback-r173'
$Install=Join-Path $Root 'INSTALL'
$Baseline='362375c464948be3001b307650c13fc3353ed05b'
$OldLocal=[string]$env:LOCALAPPDATA
$OldRoaming=[string]$env:APPDATA
$Started=[DateTime]::UtcNow
$Ports=[System.Collections.Generic.HashSet[int]]::new()
[void]$Ports.Add(47831)
$script:Stages=@()
$Failure=$null
function Assert-Head([string]$Dir,[string]$Want){
  $got=(& git.exe -C $Dir rev-parse HEAD).Trim()
  if($LASTEXITCODE -ne 0 -or $got -ne $Want){throw ('R173_HEAD_MISMATCH_'+$Dir+'_'+$got)}
}
function Readback([string]$Name,[string]$Sha,[string]$Version){
  $route=Join-Path $Root 'STATE\ChatGPTRemoteCommander\routing\default.json'
  if(-not(Test-Path -LiteralPath $route -PathType Leaf)){throw ('R173_NO_ROUTE_'+$Name)}
  $state=Get-Content $route -Raw|ConvertFrom-Json
  if($state.profile -ne 'default' -or $state.active.commit -ne $Sha -or $state.active.version -ne $Version){throw ('R173_ROUTE_WRONG_'+$Name)}
  foreach($p in @($state.active.port,$state.previous.port)){
    if($null -ne $p -and [int]$p -gt 0){[void]$Ports.Add([int]$p)}
  }
  Copy-Item $route (Join-Path $Root ('ROUTE_'+$Name+'.json')) -ErrorAction Stop
  $health=Invoke-RestMethod 'http://127.0.0.1:47831/health' -TimeoutSec 6
  if($health.ok -ne $true -or [string]$health.version -ne $Version){throw ('R173_HEALTH_WRONG_'+$Name)}
  [IO.File]::WriteAllText((Join-Path $Root ('HEALTH_'+$Name+'.json')),(ConvertTo-Json $health -Depth 12)+[Environment]::NewLine)
  Write-Output ('R173_'+$Name+'_IDENTITY_PASS')
}
function Update([string]$Name,[string]$Sha){
  $file=Join-Path $Root ($Name+'.log')
  & pwsh.exe '-NoProfile' '-NonInteractive' '-File' (Join-Path $Source 'auto-update-windows.ps1') '-InstallDir' $Install '-SourceRef' $Sha '-ExpectedCommit' $Sha '-TargetProfile' 'default' '-Force' *> $file
  $exitCode=[int]$LASTEXITCODE
  $f=Join-Path $Root 'STATE\ChatGPTRemoteCommander\last-update.json'
  $result=if(Test-Path $f){Get-Content $f -Raw|ConvertFrom-Json}else{$null}
  $status=if($null -ne $result){[string]$result.status}else{'MISSING'}
  $script:Stages+=@{name=$Name;exit=$exitCode;status=$status;logSHA=(Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant()}
  Write-Output ('R173_'+$Name+'_EXIT='+$exitCode+'_STATUS='+$status)
  if($exitCode -ne 0 -or $status -ne 'PROMOTED'){throw ('R173_'+$Name+'_NOT_ACCEPTED')}
}
function Cleanup {
  $killed=@()
  foreach($port in @($Ports)){
    $listen=@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    foreach($row in $listen){
      $id=[int]$row.OwningProcess
      if($id -le 0 -or $killed -contains $id){continue}
      $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$id) -ErrorAction SilentlyContinue
      if($null -eq $p){continue}
      $name=[IO.Path]::GetFileName([string]$p.ExecutablePath)
      $args=[string]$p.CommandLine
      if($name -ne 'node.exe' -or $args -notmatch 'src[/\\](server-v0\.3|stable-router)\.mjs' -or $p.CreationDate.ToUniversalTime() -lt $Started.AddSeconds(-5)){
        throw ('R173_UNOWNED_LISTENER_port_'+$port+'_pid_'+$id)
      }
      Stop-Process -Id $id -ErrorAction Stop
      $killed+= $id
    }
  }
  Start-Sleep -Seconds 2
  $rem=@()
  foreach($port in @($Ports)){$rem+=@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)}
  return @{pass=($rem.Count -eq 0);remaining=$rem.Count;stoppedPids=$killed;guardedPorts=@($Ports)}
}
if((Get-NetTCPConnection -State Listen -LocalPort 47831 -ErrorAction SilentlyContinue)){throw 'R173_CANONICAL_PORT_IN_USE'}
if(Test-Path $Root -or (Test-Path (Join-Path $OldLocal 'ChatGPTRemoteCommander'))){throw 'R173_NOT_ISOLATED'}
Assert-Head $Source $ExpectedCommit
if((Get-Content (Join-Path $Source 'package.json') -Raw|ConvertFrom-Json).version -ne '0.10.21'){throw 'R173_CANDIDATE_VERSION'}
New-Item -ItemType Directory -Path (Join-Path $Root 'STATE'),(Join-Path $Root 'ROAMING') -ErrorAction Stop|Out-Null
& git.exe -c core.autocrlf=false clone --depth 1 --branch v0.10.20 https://github.com/GOD13emad/ChatGPTRemoteCommander.git $Install | Out-Host
if($LASTEXITCODE -ne 0){throw 'R173_CLONE_FAIL'}
Assert-Head $Install $Baseline
$changed=@(git -C $Install status --porcelain --untracked-files=no)
if($changed.Count -gt 0){
  if($changed.Count -ne 1 -or $changed[0] -ne ' M enable-boot-recovery.ps1'){throw 'R173_UNKNOWN_OLD_DIRTY'}
  & git.exe -C $Install diff --cached --quiet --;if($LASTEXITCODE){throw 'R173_STAGED_CHANGE'}
  & git.exe -C $Install diff --ignore-space-at-eol --quiet --;if($LASTEXITCODE){throw 'R173_SEMANTIC_CHANGE'}
  Write-Output 'R173_HISTORIC_EOL_ONLY_ACCEPTED'
}
$c=Get-Content (Join-Path $Source 'config.json') -Raw|ConvertFrom-Json
$c.allowedRoots=@($Source)
$c.autoUpdate.enabled=$true
$c.powerMode.enabled=$false
$c.powerMode.guiControl.enabled=$false
$c.powerMode.browserControl.enabled=$false
$c.asyncOperations.enabled=$true
[IO.File]::WriteAllText((Join-Path $Install 'config.local.json'),(ConvertTo-Json $c -Depth 30)+[Environment]::NewLine)
$env:LOCALAPPDATA=Join-Path $Root 'STATE'
$env:APPDATA=Join-Path $Root 'ROAMING'
try {
  Update 'PROMOTE' $ExpectedCommit
  Assert-Head $Install $ExpectedCommit
  Readback 'PROMOTE' $ExpectedCommit '0.10.21'
  Update 'ROLLBACK' $Baseline
  Assert-Head $Install $Baseline
  Readback 'ROLLBACK' $Baseline '0.10.20'
}catch{$Failure=$_.Exception.Message}
finally{
  $env:LOCALAPPDATA=$OldLocal
  $env:APPDATA=$OldRoaming
  $clean=$null
  try{$clean=Cleanup}catch{$Failure=if($Failure){$Failure+' | '+$_.Exception.Message}else{$_.Exception.Message}}
  $pass=($null -eq $Failure -and $script:Stages.Count -eq 2 -and $null -ne $clean -and $clean.pass)
  $rec=[ordered]@{
    schema=1;revision='R173';status=if($pass){'PASS_WINDOWS_REAL_PROMOTION_ROLLBACK_ZERO_OWNED'}else{'FAIL_CLOSED_WINDOWS_RELEASE_ROLLBACK'}
    candidateHead=$ExpectedCommit;baselineHead=$Baseline;stages=$script:Stages;cleanup=$clean
    error=$Failure;isolatedGithubRunner=$true;ownerMachineTouched=$false
    startedUtc=$Started.ToString('o');finishedUtc=[DateTime]::UtcNow.ToString('o')
    nativeOwnerUIAndSigning='OPEN'
  }
  $dest=Join-Path $Root 'RETURN_R173.json'
  [IO.File]::WriteAllText($dest,(ConvertTo-Json $rec -Depth 12)+[Environment]::NewLine)
  Write-Output ('R173_FINAL='+$rec.status+' receiptSHA='+(Get-FileHash $dest -Algorithm SHA256).Hash)
  if(-not $pass){throw ('R173_FAIL_CLOSED '+$Failure)}
}
