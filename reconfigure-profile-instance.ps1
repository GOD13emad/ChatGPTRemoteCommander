param(
  [Parameter(Mandatory=$true)][string]$Profile,
  [string[]]$AllowedRoot = @(),
  [switch]$PowerMode,
  [switch]$StandardMode,
  [switch]$GuiControl,
  [switch]$DisableGuiControl,
  [string[]]$EnableCapability = @(),
  [string[]]$DisableCapability = @(),
  [ValidateRange(5,120)][int]$WaitSeconds = 45,
  [ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedConfigSha256
)
$ErrorActionPreference='Stop'
if($PowerMode -and $StandardMode){throw '-PowerMode and -StandardMode are mutually exclusive.'}
if($GuiControl -and $DisableGuiControl){throw '-GuiControl and -DisableGuiControl are mutually exclusive.'}
if($GuiControl -and $StandardMode){throw '-GuiControl cannot be combined with -StandardMode.'}
if($Profile -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -or $Profile -match '\.\.' -or $Profile -in @('.','..')){throw 'Invalid profile name.'}
if(@($EnableCapability | Where-Object { $DisableCapability -contains $_ }).Count -gt 0){throw 'The same capability cannot be both enabled and disabled.'}

$Root=Split-Path -Parent $MyInvocation.MyCommand.Path
$Tool=Join-Path $Root 'tools\reconfigure-profile-instance.mjs'
$StateDir=Join-Path $env:LOCALAPPDATA "ChatGPTRemoteCommander\instances\$Profile"
$node=(Get-Command node.exe -ErrorAction Stop).Source
if(-not(Test-Path -LiteralPath $Tool -PathType Leaf)){throw 'reconfigure-profile-instance.mjs is missing.'}

$args=@($Tool,'--profile',$Profile)
foreach($r in $AllowedRoot){$args+=@('--root',$r)}
if($PowerMode){$args+='--power'}
if($StandardMode){$args+='--standard'}
if($GuiControl){$args+='--gui'}
if($DisableGuiControl){$args+='--gui-off'}
foreach($cap in $EnableCapability){$args+=@('--enable-capability',$cap)}
foreach($cap in $DisableCapability){$args+=@('--disable-capability',$cap)}
if($ExpectedConfigSha256){$args+=@('--expected-config-sha256',$ExpectedConfigSha256.ToLowerInvariant())}
$json=& $node @args
if($LASTEXITCODE -ne 0){throw 'Profile reconfiguration generator failed.'}
try{$result=$json|ConvertFrom-Json}catch{throw 'Profile reconfiguration returned invalid JSON.'}
if(-not $result.supervisorRecycleRequired){
  Write-Host "PROFILE_RECONFIGURE_PASS profile=$Profile changed=false configSha256=$($result.newConfigSha256)"
  exit 0
}

function Test-Expected([string]$Sha){
  try{
    $h=Invoke-RestMethod "http://127.0.0.1:$($result.mcpPort)/health" -TimeoutSec 2
    return [bool]($h.ok -and [string]$h.configSha256 -eq $Sha -and [string]$h.instance.profile -eq $Profile)
  }catch{return $false}
}
# Restore only if this invocation's newly-installed policy is still current.
# The same per-profile lock used by Node must cover all rollback writes.
function Restore-ProfileBackupIfStillCurrent(
  [string]$ProfileState,
  [string]$BackupDir,
  [string]$ProfileName,
  [string]$OriginalSha256,
  [string]$ExpectedLiveSha256
){
  $state=[IO.Path]::GetFullPath($ProfileState)
  $backup=[IO.Path]::GetFullPath($BackupDir)
  $backupsRoot=[IO.Path]::GetFullPath((Join-Path $state 'backups'))
  $prefix=$backupsRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if(-not $backup.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){
    throw 'PROFILE_RECONFIGURE_ROLLBACK_BACKUP_SCOPE_INVALID'
  }
  $oldConfig=Join-Path $backup 'config.json'
  $oldRecord=Join-Path $backup 'instance.json'
  $config=Join-Path $state 'config.json'
  $record=Join-Path $state 'instance.json'
  foreach($file in @($oldConfig,$oldRecord,$config,$record)){
    if(-not(Test-Path -LiteralPath $file -PathType Leaf) -or
       (Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint){
      throw 'PROFILE_RECONFIGURE_ROLLBACK_FILE_INVALID'
    }
  }
  $oldRecordData=Get-Content -LiteralPath $oldRecord -Raw|ConvertFrom-Json
  if([string]$oldRecordData.profile -ne $ProfileName -or
     [string]$oldRecordData.configSha256 -ne $OriginalSha256 -or
     (Get-FileHash -LiteralPath $oldConfig -Algorithm SHA256).Hash -ne $OriginalSha256){
    throw 'PROFILE_RECONFIGURE_ROLLBACK_BACKUP_MISMATCH'
  }
  $lockPath=Join-Path $state '.profile-reconfigure.lock'
  $lock=$null
  try{
    try{
      $lock=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,
        [IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    }catch [IO.IOException]{
      throw 'PROFILE_RECONFIGURE_ROLLBACK_BUSY'
    }
    $currentRecord=Get-Content -LiteralPath $record -Raw|ConvertFrom-Json
    $currentHash=(Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash
    if($currentHash -ne $ExpectedLiveSha256 -or
       [string]$currentRecord.configSha256 -ne $ExpectedLiveSha256 -or
       [string]$currentRecord.profile -ne $ProfileName){
      throw 'PROFILE_RECONFIGURE_ROLLBACK_STALE_POLICY'
    }
    $stamp=[Guid]::NewGuid().ToString('N')
    $tempConfig=Join-Path $state ('.config.rollback-'+$stamp)
    $tempRecord=Join-Path $state ('.instance.rollback-'+$stamp)
    try{
      [IO.File]::WriteAllBytes($tempConfig,[IO.File]::ReadAllBytes($oldConfig))
      [IO.File]::WriteAllBytes($tempRecord,[IO.File]::ReadAllBytes($oldRecord))
      # Atomic, same-directory rename for each independently validated file.
      [IO.File]::Move($tempConfig,$config,$true)
      [IO.File]::Move($tempRecord,$record,$true)
    }finally{
      Remove-Item -LiteralPath $tempConfig,$tempRecord -Force -ErrorAction SilentlyContinue
    }
    if((Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash -ne $OriginalSha256){
      throw 'PROFILE_RECONFIGURE_ROLLBACK_WRITE_UNVERIFIED'
    }
  }finally{
    if($lock){
      $lock.Dispose()
      Remove-Item -LiteralPath $lockPath -Force -ErrorAction Stop
    }
  }
}

foreach($i in 1..$WaitSeconds){
  Start-Sleep -Seconds 1
  if(Test-Expected $result.newConfigSha256){
    $caps=@($result.capabilityProfile.grantedCapabilities) -join ','
    Write-Host "PROFILE_RECONFIGURE_PASS profile=$Profile changed=true mcpPort=$($result.mcpPort) power=$($result.powerMode) gui=$($result.guiControl) capabilities=$caps configSha256=$($result.newConfigSha256) backup=$($result.backupDir)"
    exit 0
  }
}

Restore-ProfileBackupIfStillCurrent -ProfileState $StateDir -BackupDir $result.backupDir -ProfileName $Profile -OriginalSha256 $result.oldConfigSha256 -ExpectedLiveSha256 $result.newConfigSha256
foreach($i in 1..$WaitSeconds){
  Start-Sleep -Seconds 1
  if(Test-Expected $result.oldConfigSha256){throw "PROFILE_RECONFIGURE_ROLLED_BACK profile=$Profile reason=new-instance-timeout"}
}
throw "PROFILE_RECONFIGURE_ROLLBACK_UNVERIFIED profile=$Profile"
