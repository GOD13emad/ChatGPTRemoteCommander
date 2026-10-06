param(
  [string]$SourceDir = '',
  [string]$InstallRoot = '',
  [ValidateSet('Core','ControlMonitoring')][string]$Mode = 'ControlMonitoring'
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

New-Item -ItemType Directory -Force -Path $VersionDir,$StartMenu | Out-Null
foreach($name in $selected){
  Copy-Item -LiteralPath (Join-Path $SourceDir $name) -Destination (Join-Path $VersionDir $name) -Force -ErrorAction Stop
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
[IO.File]::WriteAllText((Join-Path $VersionDir 'product-install.json'),(($InstallManifest|ConvertTo-Json -Depth 4)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))

if(Test-Path -LiteralPath $Current){Remove-Item -LiteralPath $Current -Force -Recurse}
New-Item -ItemType Junction -Path $Current -Target $VersionDir | Out-Null

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
$UninstallText=@"
`$ErrorActionPreference='Stop'
`$StartMenu=Join-Path `$env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Remote Commander'
foreach(`$name in @(
  'Remote Commander.lnk',
  'Remote Commander Profiles & Access.lnk',
  'Remote Commander Operations Monitor.lnk',
  'Remote Commander Admin Runtime.lnk'
)){
  Remove-Item -LiteralPath (Join-Path `$StartMenu `$name) -Force -ErrorAction SilentlyContinue
}
if((Test-Path `$StartMenu) -and -not(Get-ChildItem `$StartMenu -Force -ErrorAction SilentlyContinue)){
  Remove-Item -LiteralPath `$StartMenu -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\RemoteCommander' -Recurse -Force -ErrorAction SilentlyContinue
`$selfRoot='$($InstallRoot.Replace("'","''"))'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/c',"timeout /t 1 /nobreak >nul & rmdir /s /q `"`$selfRoot`"" -WindowStyle Hidden
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
