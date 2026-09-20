param(
  [Parameter(Mandatory=$true)][string]$Profile,
  [string[]]$AllowedRoot = @(),
  [switch]$PowerMode,
  [switch]$StandardMode,
  [switch]$GuiControl,
  [switch]$DisableGuiControl,
  [ValidateRange(5,120)][int]$WaitSeconds = 45
)
$ErrorActionPreference='Stop'
if($PowerMode -and $StandardMode){throw '-PowerMode and -StandardMode are mutually exclusive.'}
if($GuiControl -and $DisableGuiControl){throw '-GuiControl and -DisableGuiControl are mutually exclusive.'}
if($GuiControl -and $StandardMode){throw '-GuiControl cannot be combined with -StandardMode.'}
if($Profile -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -or $Profile -match '\.\.' -or $Profile -in @('.','..')){throw 'Invalid profile name.'}

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
foreach($i in 1..$WaitSeconds){
  Start-Sleep -Seconds 1
  if(Test-Expected $result.newConfigSha256){
    Write-Host "PROFILE_RECONFIGURE_PASS profile=$Profile changed=true mcpPort=$($result.mcpPort) power=$($result.powerMode) gui=$($result.guiControl) configSha256=$($result.newConfigSha256) backup=$($result.backupDir)"
    exit 0
  }
}

$backup=[IO.Path]::GetFullPath([string]$result.backupDir)
$expectedPrefix=[IO.Path]::GetFullPath((Join-Path $StateDir 'backups'))
if(-not $backup.StartsWith($expectedPrefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Profile reconfiguration timeout and backup path is not trusted.'}
$oldConfig=Join-Path $backup 'config.json';$oldRecord=Join-Path $backup 'instance.json'
if(-not(Test-Path $oldConfig -PathType Leaf) -or -not(Test-Path $oldRecord -PathType Leaf)){throw 'Profile reconfiguration timeout and rollback backup is incomplete.'}
$record=Get-Content $oldRecord -Raw|ConvertFrom-Json
if([string]$record.configSha256 -ne [string]$result.oldConfigSha256){throw 'Profile reconfiguration timeout and rollback record hash mismatches.'}
if((Get-FileHash $oldConfig -Algorithm SHA256).Hash.ToLowerInvariant() -ne [string]$result.oldConfigSha256){throw 'Profile reconfiguration timeout and rollback config hash mismatches.'}
Copy-Item $oldConfig (Join-Path $StateDir 'config.json') -Force
Copy-Item $oldRecord (Join-Path $StateDir 'instance.json') -Force
foreach($i in 1..$WaitSeconds){
  Start-Sleep -Seconds 1
  if(Test-Expected $result.oldConfigSha256){throw "PROFILE_RECONFIGURE_ROLLED_BACK profile=$Profile reason=new-instance-timeout"}
}
throw "PROFILE_RECONFIGURE_ROLLBACK_UNVERIFIED profile=$Profile"
