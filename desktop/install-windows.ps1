param(
  [string]$SourceDir = '',
  [string]$InstallRoot = '',
  [ValidateSet('Core','ControlMonitoring')][string]$Mode = 'ControlMonitoring',
  [switch]$StageOnly,
  [switch]$NoPublicIntegration,
  [ValidateSet('None','AfterBaselineMove','AfterCandidateMove')][string]$TestFailurePoint='None'
)
$ErrorActionPreference='Stop'
$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Version=((Get-Content (Join-Path $RepoRoot 'package.json') -Raw | ConvertFrom-Json).version)
if(-not $SourceDir){$SourceDir=Join-Path $RepoRoot 'dist\desktop\remote-commander-windows-x64'}
$SourceDir=[IO.Path]::GetFullPath($SourceDir)
$SourceExe=Join-Path $SourceDir 'RemoteCommander.exe'
if(-not (Test-Path -LiteralPath $SourceExe -PathType Leaf)){throw "Desktop build missing: $SourceExe"}

$required=@('profile-manager-windows.ps1','profile-enrollment-windows.ps1')
if($Mode -eq 'ControlMonitoring'){$required+=@('operations-monitor-windows.ps1','admin-runtime-windows.ps1')}
foreach($tool in $required){
  if(-not(Test-Path -LiteralPath (Join-Path $SourceDir $tool) -PathType Leaf)){throw "Desktop tool missing: $tool"}
}

if(-not $InstallRoot){$InstallRoot=Join-Path $env:LOCALAPPDATA 'Programs\Remote Commander'}
$InstallRoot=[IO.Path]::GetFullPath($InstallRoot)
$selected=@('RemoteCommander.exe','profile-manager-windows.ps1','profile-enrollment-windows.ps1')
if($Mode -eq 'ControlMonitoring'){$selected+=@('operations-monitor-windows.ps1','admin-runtime-windows.ps1')}
$Entries = $selected | ForEach-Object {
  $full=Join-Path $SourceDir $_
  $h=(Get-FileHash -Algorithm SHA256 -LiteralPath $full).Hash.ToLowerInvariant()
  "$_|$h"
} | Sort-Object
$Manifest=$Entries -join "`n"
$PackageSha=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Manifest))).ToLowerInvariant()
$VersionDir=Join-Path $InstallRoot (("v"+$Version+"-")+$PackageSha.Substring(0,12))
$Current=Join-Path $InstallRoot 'current'
$StartMenu=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Remote Commander'
$Reg='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\RemoteCommander'

# R203: immutable update candidate, exactly one current, rollback alias until
# native owner acceptance. Private fault injection is development-root-only.
if($StageOnly -and ($NoPublicIntegration -or $TestFailurePoint -ne 'None')){throw 'R203_STAGE_ONLY_MODE_MIX'}
if($TestFailurePoint -ne 'None' -and -not $NoPublicIntegration){throw 'R203_FAULT_INJECTION_REQUIRES_ISOLATION'}
$developmentBase=[IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'source\repos')).TrimEnd([char]'\')+'\'
if($NoPublicIntegration){
  if(-not $PSBoundParameters.ContainsKey('InstallRoot') -or
     -not $InstallRoot.StartsWith($developmentBase,[StringComparison]::OrdinalIgnoreCase)){
    throw 'R203_ISOLATED_ROOT_OUTSIDE_DEVELOPMENT'
  }
}
# R198: Stage-Only is a narrowly scoped DEVELOPMENT installation. Never change
# a live current pointer, shortcuts, HKCU uninstall entry, or a prior version.
if($StageOnly){
  if(-not $PSBoundParameters.ContainsKey('InstallRoot')){throw 'R198_EXPLICIT_DEV_INSTALL_ROOT_REQUIRED'}
  $developmentBase=[IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'source\repos')).TrimEnd([char]'\')+'\'
  if(-not $InstallRoot.StartsWith($developmentBase,[StringComparison]::OrdinalIgnoreCase)){throw 'R198_STAGE_ROOT_OUTSIDE_DEVELOPMENT'}
  if(Test-Path -LiteralPath $InstallRoot){throw 'R198_STAGE_ROOT_MUST_BE_NEW'}
}
$priorCurrent=$null
$priorTarget=''
$pending=Join-Path $InstallRoot ('current.pending-'+$PackageSha.Substring(0,12))
$rollback=Join-Path $InstallRoot ('current.rollback-'+$PackageSha.Substring(0,12))
$failed=Join-Path $InstallRoot ('current.failed-'+$PackageSha.Substring(0,12))
$stage=Join-Path $InstallRoot ('.stage-v'+$Version+'-'+$PackageSha.Substring(0,12))
if(-not $StageOnly){
  $priorCurrent=Get-Item -LiteralPath $Current -Force -ErrorAction SilentlyContinue
  if($null -ne $priorCurrent){
    if($priorCurrent.LinkType -cne 'Junction'){throw 'R203_UNKNOWN_CURRENT_NOT_JUNCTION'}
    $priorTarget=[IO.Path]::GetFullPath([string](@($priorCurrent.Target)[0]))
    $inside=$InstallRoot.TrimEnd([char]'\')+'\'
    if(-not $priorTarget.StartsWith($inside,[StringComparison]::OrdinalIgnoreCase) -or
       -not(Test-Path -LiteralPath $priorTarget -PathType Container) -or
       -not(Test-Path -LiteralPath (Join-Path $priorTarget 'product-install.json') -PathType Leaf)){
      throw 'R203_CURRENT_TARGET_NOT_OWNED_INSTALL'
    }
  }
  if(Test-Path -LiteralPath $VersionDir){
    if($null -ne $priorCurrent -and
       $priorTarget.Equals($VersionDir,[StringComparison]::OrdinalIgnoreCase)){
      foreach($name in $selected){
        $installedFile=Join-Path $VersionDir $name
        if(-not(Test-Path $installedFile -PathType Leaf) -or
           (Get-FileHash $installedFile -Algorithm SHA256).Hash -cne (Get-FileHash (Join-Path $SourceDir $name) -Algorithm SHA256).Hash){
          throw 'R203_ALREADY_CURRENT_FILE_HASH_DRIFT'
        }
      }
      Write-Output ('REMOTE_COMMANDER_UI_ALREADY_CURRENT_VERIFIED version='+$Version+' root='+$VersionDir)
      return
    }
    throw 'R203_VERSION_PATH_ALREADY_EXISTS_NO_OVERWRITE'
  }
  foreach($p in @($stage,$pending,$rollback,$failed)){
    if(Test-Path -LiteralPath $p){throw ('R203_UNRESOLVED_PRIOR_TRANSACTION_'+$p)}
  }
}
if($StageOnly){
  New-Item -ItemType Directory -Path $VersionDir -ErrorAction Stop|Out-Null
  $payloadDir=$VersionDir
}else{
  New-Item -ItemType Directory -Path $InstallRoot -Force -ErrorAction Stop|Out-Null
  New-Item -ItemType Directory -Path $stage -ErrorAction Stop|Out-Null
  $payloadDir=$stage
}
foreach($name in $selected){
  Copy-Item -LiteralPath (Join-Path $SourceDir $name) -Destination (Join-Path $payloadDir $name) -ErrorAction Stop
}
foreach($name in $selected){
  if((Get-FileHash (Join-Path $payloadDir $name) -Algorithm SHA256).Hash -cne
     (Get-FileHash (Join-Path $SourceDir $name) -Algorithm SHA256).Hash){
    throw ('R203_STAGED_PAYLOAD_SHA_MISMATCH_'+$name)
  }
}
$InstallManifest=[ordered]@{
  schema=1
  product='Remote Commander'
  version=$Version
  mode=$Mode
  controlMonitoring=($Mode -eq 'ControlMonitoring')
  profilesUi=$true
  browserBundled=$false
  installedAt=(Get-Date).ToUniversalTime().ToString('o')
}
[IO.File]::WriteAllText((Join-Path $payloadDir 'product-install.json'),(($InstallManifest|ConvertTo-Json -Depth 4)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
if($StageOnly){
  $stamp=[ordered]@{schema=1;revision='R198';status='STAGED_ONLY_NO_LIVE_INTEGRATION';sourceVersion=$Version;sourceManifestSHA256=$PackageSha;installRoot=$InstallRoot;versionDir=$VersionDir;currentPointerChanged=$false;startMenuChanged=$false;registryChanged=$false;sourceModified=$false}
  [IO.File]::WriteAllText((Join-Path $VersionDir 'STAGE_R198.json'),(($stamp|ConvertTo-Json -Depth 5)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
  Write-Output ('REMOTE_COMMANDER_UI_STAGE_ONLY_PASS version='+$Version+' root='+$VersionDir)
  return
}

# Commit immutable verified payload, then exchange only the current Junction.
# The prior binary directory is NOT copied, deleted, or made another active install.
Move-Item -LiteralPath $stage -Destination $VersionDir -ErrorAction Stop
New-Item -ItemType Junction -Path $pending -Target $VersionDir -ErrorAction Stop|Out-Null
$baselineMoved=$false
try{
  if($null -ne $priorCurrent){
    Move-Item -LiteralPath $Current -Destination $rollback -ErrorAction Stop
    $baselineMoved=$true
  }
  if($TestFailurePoint -eq 'AfterBaselineMove'){throw 'R203_SYNTHETIC_AFTER_BASELINE_MOVE'}
  Move-Item -LiteralPath $pending -Destination $Current -ErrorAction Stop
  if($TestFailurePoint -eq 'AfterCandidateMove'){throw 'R203_SYNTHETIC_AFTER_CANDIDATE_MOVE'}
  $check=Get-Item -LiteralPath $Current -Force -ErrorAction Stop
  if($check.LinkType -cne 'Junction' -or
     -not ([IO.Path]::GetFullPath([string](@($check.Target)[0]))).Equals($VersionDir,[StringComparison]::OrdinalIgnoreCase)){
    throw 'R203_CURRENT_COMMIT_POINTER_INVALID'
  }
}catch{
  $originalError=$_.Exception.Message
  try{
    $newLink=Get-Item -LiteralPath $Current -Force -ErrorAction SilentlyContinue
    if($null -ne $newLink){
      if($newLink.LinkType -cne 'Junction' -or
         -not([IO.Path]::GetFullPath([string](@($newLink.Target)[0]))).Equals($VersionDir,[StringComparison]::OrdinalIgnoreCase)){
        throw 'R203_UNRECOGNIZED_POINTER_DURING_ROLLBACK'
      }
      Move-Item -LiteralPath $Current -Destination $failed -ErrorAction Stop
    }
    if($baselineMoved){
      Move-Item -LiteralPath $rollback -Destination $Current -ErrorAction Stop
      $restored=Get-Item -LiteralPath $Current -Force -ErrorAction Stop
      if($restored.LinkType -cne 'Junction' -or
         -not([IO.Path]::GetFullPath([string](@($restored.Target)[0]))).Equals($priorTarget,[StringComparison]::OrdinalIgnoreCase)){
        throw 'R203_RESTORED_BASELINE_POINTER_MISMATCH'
      }
    }
  }catch{
    throw ('R203_TRANSACTION_DEGRADED_ROLLBACK_UNRESOLVED: '+$_.Exception.Message+'; original='+$originalError)
  }
  throw ('R203_SWAP_ABORTED_BASELINE_PRESERVED: '+$originalError)
}
if($NoPublicIntegration){
  Write-Output ('REMOTE_COMMANDER_UI_PRIVATE_TRANSACTION_PASS version='+$Version+' current='+$Current+' rollback='+$rollback)
  return
}

$Wsh=New-Object -ComObject WScript.Shell
$Icon=(Join-Path $Current 'RemoteCommander.exe')+',0'
$DashboardShortcut=Join-Path $StartMenu 'Remote Commander.lnk'
$s=$Wsh.CreateShortcut($DashboardShortcut)
$s.TargetPath=Join-Path $Current 'RemoteCommander.exe'
$s.Arguments=''
$s.WorkingDirectory=$Current
$s.IconLocation=$Icon
$s.Description='Remote Commander'
$s.Save()
if(-not(Test-Path -LiteralPath $DashboardShortcut -PathType Leaf)){throw 'Remote Commander Start Menu shortcut was not created.'}

# Historical internal tools are implementation details, not separate Start Menu applications.
foreach($legacy in @(
  'Remote Commander Profiles & Access.lnk',
  'Remote Commander Operations Monitor.lnk',
  'Remote Commander Admin Runtime.lnk'
)){
  Remove-Item -LiteralPath (Join-Path $StartMenu $legacy) -Force -ErrorAction SilentlyContinue
}

$Pwsh=(Get-Command pwsh.exe -ErrorAction Stop).Source
$Uninstall=Join-Path $InstallRoot 'uninstall.ps1'
# R219: An uninstaller must never blindly delete the versioned installation
# root, especially while a current Junction, rollback alias, unknown files
# or user-owned state may still exist. Updating is transactional in place.
# Until a separate independently approved exact-manifest retirement tool passes,
# the registered Uninstall entry fails BEFORE changing files/registry/shortcuts.
$UninstallText=@"
#requires -Version 7.0
`$ErrorActionPreference='Stop'
throw 'R219_UNINSTALL_REFUSED_NO_ACCEPTED_RETIREMENT_PLAN: Use transactional in-place Update. Explicit manifest, profile continuity, active-process, rollback and owner-acceptance evidence are required for a future safe uninstall; NOTHING WAS DELETED.'
"@
[IO.File]::WriteAllText($Uninstall,$UninstallText,(New-Object Text.UTF8Encoding($false)))

New-Item -Path $Reg -Force | Out-Null
New-ItemProperty -Path $Reg -Name DisplayName -Value 'Remote Commander' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $Reg -Name DisplayVersion -Value $Version -PropertyType String -Force | Out-Null
New-ItemProperty -Path $Reg -Name Publisher -Value 'Remote Commander' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $Reg -Name InstallLocation -Value $InstallRoot -PropertyType String -Force | Out-Null
New-ItemProperty -Path $Reg -Name DisplayIcon -Value $Icon -PropertyType String -Force | Out-Null
New-ItemProperty -Path $Reg -Name UninstallString -Value ('"'+$Pwsh+'" -NoProfile -File "'+$Uninstall+'"') -PropertyType String -Force | Out-Null
New-ItemProperty -Path $Reg -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $Reg -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null

Write-Output "REMOTE_COMMANDER_DESKTOP_INSTALL_PASS version=$Version mode=$Mode install=$InstallRoot shortcuts=1 dashboard=$DashboardShortcut"
