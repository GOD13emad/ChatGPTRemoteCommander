# Owner-only launcher for the ONE routed Commander release; never run from SYSTEM/Session 0.
param([ValidatePattern('^[A-Za-z0-9_.-]{1,64}$')][string]$Profile='default',[switch]$PreflightOnly)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$session=(Get-Process -Id $PID).SessionId
if($identity.IsSystem -or $session -le 0){throw 'OWNER_INTERACTIVE_SESSION_REQUIRED'}
$root=Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander'
$ownerDir=Join-Path $root 'owner-workspace-v1'
$routePath=Join-Path (Join-Path $root 'routing') ($Profile+'.json')
$ownerConfigPath=Join-Path $ownerDir 'config.json'
if(!(Test-Path -LiteralPath $routePath -PathType Leaf) -or
   !(Test-Path -LiteralPath $ownerConfigPath -PathType Leaf)){throw 'OWNER_ROUTING_UNAVAILABLE'}
$route=Get-Content -LiteralPath $routePath -Raw|ConvertFrom-Json
$cfg=Get-Content -LiteralPath $ownerConfigPath -Raw|ConvertFrom-Json
if($cfg.schema -ne 1 -or $cfg.host -ne '127.0.0.1' -or
   $cfg.ownerName -ne $identity.Name -or $cfg.port -lt 1024 -or $cfg.port -gt 65535 -or
   ![IO.Path]::IsPathRooted([string]$cfg.authFile) -or
   ![string]::Equals([IO.Path]::GetDirectoryName($cfg.authFile),$ownerDir,[StringComparison]::OrdinalIgnoreCase)){
 throw 'OWNER_CONFIG_BOUNDARY_INVALID'
}
$releaseRoot=[IO.Path]::GetFullPath((Join-Path $root 'releases')).TrimEnd('\')
$project=[IO.Path]::GetFullPath([string]$route.active.projectDir).TrimEnd('\')
if(![string]::Equals([IO.Path]::GetDirectoryName($project),$releaseRoot,[StringComparison]::OrdinalIgnoreCase)){
 throw 'OWNER_RELEASE_OUTSIDE_ROUTED_ROOT'
}
$releaseItem=Get-Item -LiteralPath $project -ErrorAction Stop
if(!$releaseItem.PSIsContainer -or ($releaseItem.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'OWNER_RELEASE_UNTRUSTED_LINK'}
$entry=Join-Path $project 'tools\workspace-owner-broker.mjs'
$nodeFile=Join-Path $project 'src\workspace-tools.mjs'
$configPath=[IO.Path]::GetFullPath([string]$route.active.configPath)
$parent=[IO.Path]::GetDirectoryName($configPath)
$runtimesRoot=[IO.Path]::GetFullPath((Join-Path $root 'runtimes')).TrimEnd('\')
$profileFolder=[IO.Path]::GetFileName($parent)
$runtimeFolder=[IO.Path]::GetDirectoryName($parent)
$runtimeFolderName=[IO.Path]::GetFileName($runtimeFolder)
$runtimeFolderParent=[IO.Path]::GetDirectoryName($runtimeFolder)
$inRelease=[string]::Equals($parent,$project,[StringComparison]::OrdinalIgnoreCase)
$inCanonicalRuntime=(
 [string]::Equals($runtimeFolderParent,$runtimesRoot,[StringComparison]::OrdinalIgnoreCase) -and
 [string]::Equals($profileFolder,$Profile,[StringComparison]::OrdinalIgnoreCase) -and
 $runtimeFolderName -match '^[A-Za-z0-9_.-]{1,100}$' -and
 [string]::Equals([IO.Path]::GetFileName($configPath),'config.json',[StringComparison]::OrdinalIgnoreCase)
)
if(!$inRelease -and !$inCanonicalRuntime){throw 'OWNER_ROUTED_CONFIG_OUTSIDE_TRUSTED_ROOTS'}
if($inCanonicalRuntime){
 foreach($dir in @($runtimesRoot,$runtimeFolder,$parent)){
  $item=Get-Item -LiteralPath $dir -ErrorAction Stop
  if(!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){
   throw 'OWNER_RUNTIME_CONFIG_PATH_UNTRUSTED_LINK'
  }
 }
}
foreach($file in @($entry,$nodeFile,$configPath,$cfg.authFile)){
 $item=Get-Item -LiteralPath $file -ErrorAction Stop
 if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'OWNER_SOURCE_UNTRUSTED_LINK'}
}
if([string]$route.active.configSha256 -notmatch '^[0-9a-fA-F]{64}$' -or
   (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash -ne [string]$route.active.configSha256){
 throw 'OWNER_ROUTE_CONFIG_HASH_MISMATCH'
}
$secret=(Get-Content -LiteralPath $cfg.authFile -Raw).Trim()
if($secret -notmatch '^[a-f0-9]{64}$'){throw 'OWNER_AUTH_INVALID'}
$secret=$null
$cua=Join-Path $root 'adapters\cua-driver\v0.38.0\cua-driver.exe'
if(!(Test-Path -LiteralPath $cua -PathType Leaf) -or
  ((& $cua --version) -ne 'cua-driver 0.38.0')){throw 'OWNER_CUA_VERSION_UNVERIFIED'}
$node=(Get-Command node.exe -ErrorAction Stop).Source
if($PreflightOnly){
 [pscustomobject]@{ok=$true;action='PREFLIGHT_ONLY';owner=$identity.Name;
  session=$session;profile=$Profile;release=[IO.Path]::GetFileName($project);
  sourceInRoutedRelease=$true;userProfilePreserved=$true;inputDispatched=$false}|
  ConvertTo-Json -Compress
 return
}
$existing=@(Get-CimInstance Win32_Process -Filter "Name='cua-driver.exe'" |
 Where-Object{$_.SessionId -eq $session -and $_.ExecutablePath -eq $cua -and
               $_.CommandLine -like '*rc-workspace-cua-v038*'})
if($existing.Count -gt 0){throw 'OWNER_CUA_INSTANCE_ALREADY_RUNNING_NO_RESTART'}
try{$r=Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:"+$cfg.port+"/health") -TimeoutSec 2 -ErrorAction Stop
 if($r.StatusCode -eq 200){throw 'OWNER_WORKSPACE_BROKER_ALREADY_RUNNING_NO_RESTART'}
}catch{
 if($_.Exception.Message -eq 'OWNER_WORKSPACE_BROKER_ALREADY_RUNNING_NO_RESTART'){throw}
}
$env:RC_WORKSPACE_OWNER_CONFIG=$ownerConfigPath
$env:RC_WORKSPACE_CUA_OWNER_PIPE='1'
$socket='\\.\pipe\rc-workspace-cua-v038'
$driver=$null
try{
 $driver=Start-Process -FilePath $cua -ArgumentList @('serve','--socket',$socket,
   '--no-overlay','--permission-mode','standard','--grant','existing-profile') -WindowStyle Hidden -PassThru
 Start-Sleep -Seconds 2
 if($driver.HasExited){throw 'OWNER_CUA_START_FAILED'}
 $probe=& $cua call --socket $socket list_windows '{}'
 if($LASTEXITCODE -ne 0 -or $null -eq (($probe|Out-String|ConvertFrom-Json).windows)){
  throw 'OWNER_CUA_READINESS_FAILED'
 }
 & $node $entry
 if($LASTEXITCODE -ne 0){throw 'OWNER_BROKER_EXIT_FAILED'}
}finally{
 if($driver -and -not $driver.HasExited){Stop-Process -Id $driver.Id -ErrorAction SilentlyContinue}
}
