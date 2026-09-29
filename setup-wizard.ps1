param(
  [switch]$PowerMode,
  [switch]$StandardMode,
  [switch]$GuiControl,
  [switch]$SkipPrerequisites,
  [switch]$SkipInstall,
  [switch]$SkipConnect,
  [switch]$SkipPlugin,
  [string]$TunnelId = '',
  [string]$AppId = '',
  [string]$Profile = 'chatgpt-remote-commander',
  [string]$DeviceName = $env:COMPUTERNAME,
  [string]$PluginOutputDirectory = ''
)
$ErrorActionPreference='Stop'
if($PowerMode -and $StandardMode){throw 'Choose only one of -PowerMode or -StandardMode.'}
if($GuiControl -and -not $PowerMode){throw '-GuiControl requires -PowerMode.'}
if(-not $PowerMode -and -not $StandardMode){
  if([Environment]::UserInteractive){
    Write-Host 'Choose installation mode:'
    Write-Host '  1) Standard — restricted project/file access'
    Write-Host '  2) Full / Power — trusted-machine shell/filesystem/process access'
    Write-Host '  3) Full / Power + GUI — also enable guarded desktop control'
    $choice=Read-Host 'Mode [1]'
    switch($choice){
      '2' {$PowerMode=$true}
      '3' {$PowerMode=$true;$GuiControl=$true}
      default {$StandardMode=$true}
    }
  }else{$StandardMode=$true}
}

$StateRoot=Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander'
$InstallRoot=Join-Path $StateRoot 'app'
$WizardState=Join-Path $StateRoot 'onboarding'
New-Item -ItemType Directory -Force -Path $WizardState | Out-Null
$ScriptRoot=if($MyInvocation.MyCommand.Path){Split-Path -Parent $MyInvocation.MyCommand.Path}else{(Get-Location).Path}
$Temp=$null

function Get-LatestAsset([string]$Name,[string]$Destination){
  $base='https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download'
  Invoke-WebRequest -Uri "$base/$Name" -OutFile $Destination -TimeoutSec 180
}
function Resolve-Installer {
  $adj=Join-Path $ScriptRoot 'install.ps1'
  if(Test-Path -LiteralPath $adj -PathType Leaf){return $adj}
  $script:Temp=Join-Path ([IO.Path]::GetTempPath()) ('remote-commander-setup-'+[guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $script:Temp | Out-Null
  $installer=Join-Path $script:Temp 'install.ps1'
  $sums=Join-Path $script:Temp 'SHA256SUMS.txt'
  Get-LatestAsset 'install.ps1' $installer
  Get-LatestAsset 'SHA256SUMS.txt' $sums
  $line=Get-Content -LiteralPath $sums | Where-Object {$_ -match '\sinstall\.ps1$'} | Select-Object -First 1
  if(-not $line){throw 'Latest release checksum manifest does not list install.ps1.'}
  $expected=($line -split '\s+')[0].ToLowerInvariant()
  $actual=(Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
  if($actual -ne $expected){throw 'Downloaded install.ps1 checksum mismatch.'}
  return $installer
}
function Get-TunnelHealthPort([string]$Name){
  $profileFile=Join-Path (Join-Path $env:APPDATA 'tunnel-client') ($Name+'.yaml')
  if(-not(Test-Path -LiteralPath $profileFile -PathType Leaf)){return 0}
  $raw=Get-Content -LiteralPath $profileFile -Raw
  $m=[regex]::Match($raw,'listen_addr:\s*["'']?127\.0\.0\.1:(\d+)')
  if($m.Success){return [int]$m.Groups[1].Value}
  return 0
}

try{
  Write-Host "Remote Commander setup wizard — device=$DeviceName profile=$Profile"
  Write-Host ("Mode: "+($(if($PowerMode){'Full/Power'}else{'Standard'})))
  if(-not $SkipInstall){
    $installer=Resolve-Installer
    $args=@('-StartServer')
    if(-not $SkipPrerequisites){$args+='-InstallPrerequisites'}
    if($PowerMode){$args+='-PowerMode'}
    if($GuiControl){$args+='-GuiControl'}
    & $installer @args
    if($LASTEXITCODE -and $LASTEXITCODE -ne 0){throw "Remote Commander installer failed: $LASTEXITCODE"}
  }
  if(-not(Test-Path -LiteralPath (Join-Path $InstallRoot 'package.json') -PathType Leaf)){throw "Installed Remote Commander not found at $InstallRoot"}

  $health=Invoke-RestMethod -Uri 'http://127.0.0.1:47831/health' -TimeoutSec 4
  if(-not $health.ok){throw 'Remote Commander health check failed after installation.'}

  $tunnelReady=$false
  if(-not $SkipConnect){
    $connect=Join-Path $InstallRoot 'connect-chatgpt.ps1'
    if(-not(Test-Path -LiteralPath $connect -PathType Leaf)){throw 'Installed connect-chatgpt.ps1 is missing.'}
    $params=@{Profile=$Profile}
    if(-not[string]::IsNullOrWhiteSpace($TunnelId)){$params.TunnelId=$TunnelId}
    Write-Host ''
    Write-Host 'Tunnel enrollment follows. Runtime API key entry stays in the local hidden prompt and is never written into the Plugin ZIP.'
    & $connect @params
    if($LASTEXITCODE -and $LASTEXITCODE -ne 0){throw "Tunnel enrollment failed: $LASTEXITCODE"}
  }
  $healthPort=Get-TunnelHealthPort $Profile
  if($healthPort -gt 0){
    try{$tunnelReady=((Invoke-WebRequest -Uri "http://127.0.0.1:$healthPort/readyz" -UseBasicParsing -TimeoutSec 3).Content.Trim() -eq 'ready')}catch{$tunnelReady=$false}
  }

  $pluginResult=$null
  $pluginStatus='SKIPPED'
  if(-not $SkipPlugin){
    $suggested="Remote Commander · $DeviceName"
    Write-Host ''
    Write-Host "Suggested ChatGPT custom app name: $suggested"
    Write-Host 'Create/verify the custom app with Connection=Tunnel, run Scan Tools, then use its exact App ID.'
    if([string]::IsNullOrWhiteSpace($AppId) -and [Environment]::UserInteractive){
      $AppId=Read-Host 'Paste the registered App ID (asdk_app_/connector_/templated_apps_ or plugin_ technical id), or press Enter to finish later'
    }
    if(-not[string]::IsNullOrWhiteSpace($AppId)){
      $builder=Join-Path $InstallRoot 'build-device-plugin.ps1'
      if(-not(Test-Path -LiteralPath $builder -PathType Leaf)){throw 'Installed build-device-plugin.ps1 is missing; update Remote Commander.'}
      $bp=@{AppId=$AppId;DeviceName=$DeviceName;Profile=$Profile}
      if(-not[string]::IsNullOrWhiteSpace($PluginOutputDirectory)){$bp.OutputDirectory=$PluginOutputDirectory}
      $lines=& $builder @bp
      if($LASTEXITCODE -and $LASTEXITCODE -ne 0){throw "Plugin ZIP generation failed: $LASTEXITCODE"}
      $jsonLine=@($lines | Where-Object {$_ -is [string] -and $_.TrimStart().StartsWith('{')}) | Select-Object -First 1
      if($jsonLine){$pluginResult=$jsonLine|ConvertFrom-Json}
      $pluginStatus='READY'
    }else{
      $pluginStatus='WAITING_APP_ID'
    }
  }

  $state=[ordered]@{
    schema=1
    completedAt=(Get-Date).ToUniversalTime().ToString('o')
    platform='windows'
    deviceName=$DeviceName
    profile=$Profile
    mode=if($PowerMode){'FULL_POWER'}else{'STANDARD'}
    version=[string]$health.version
    mcpHealthy=[bool]$health.ok
    tunnelReady=$tunnelReady
    pluginStatus=$pluginStatus
    pluginName=if($pluginResult){[string]$pluginResult.pluginName}else{$null}
    pluginZip=if($pluginResult){[string]$pluginResult.zip}else{$null}
    pluginSha256=if($pluginResult){[string]$pluginResult.sha256}else{$null}
    secretsPersistedInWizardState=$false
    rebootPerformed=$false
  }
  $statePath=Join-Path $WizardState 'latest.json'
  [IO.File]::WriteAllText($statePath,(($state|ConvertTo-Json -Depth 8)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
  Write-Host ''
  Write-Host "SETUP_MACHINE_PASS version=$($state.version) mcp=true tunnel=$tunnelReady mode=$($state.mode)"
  if($pluginStatus -eq 'READY'){
    Write-Host "SETUP_FINAL_PASS plugin=$($state.pluginName) zip=$($state.pluginZip)"
  }elseif($pluginStatus -eq 'WAITING_APP_ID'){
    Write-Host 'SETUP_WAITING_APP_ID machine/tunnel are ready. After ChatGPT creates/scans the custom app, rerun this wizard with -SkipInstall -SkipConnect -AppId "<APP_ID>".'
  }
}finally{
  if($Temp -and (Test-Path -LiteralPath $Temp)){Remove-Item -LiteralPath $Temp -Recurse -Force -ErrorAction SilentlyContinue}
}
