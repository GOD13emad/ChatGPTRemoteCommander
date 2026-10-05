param(
  [string]$SourceDir = '',
  [string]$InstallRoot = ''
)
$ErrorActionPreference='Stop'
$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Version=((Get-Content (Join-Path $RepoRoot 'package.json') -Raw | ConvertFrom-Json).version)
if(-not $SourceDir){$SourceDir=Join-Path $RepoRoot 'dist\desktop\remote-commander-windows-x64'}
$SourceDir=[IO.Path]::GetFullPath($SourceDir)
$SourceExe=Join-Path $SourceDir 'RemoteCommander.exe'
if(-not (Test-Path -LiteralPath $SourceExe -PathType Leaf)){throw "Desktop build missing: $SourceExe"}
foreach($tool in @('profile-manager-windows.ps1','operations-monitor-windows.ps1','admin-runtime-windows.ps1')){
  if(-not(Test-Path -LiteralPath (Join-Path $SourceDir $tool) -PathType Leaf)){throw "Desktop tool missing: $tool"}
}
if(-not $InstallRoot){$InstallRoot=Join-Path $env:LOCALAPPDATA 'Programs\Remote Commander'}
$InstallRoot=[IO.Path]::GetFullPath($InstallRoot)
$Entries = Get-ChildItem -LiteralPath $SourceDir -File -Recurse | ForEach-Object {
  $rel=[IO.Path]::GetRelativePath($SourceDir,$_.FullName).Replace('\','/')
  $h=(Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
  "$rel|$h"
} | Sort-Object
$Manifest=$Entries -join "`n"
$PackageSha=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Manifest))).ToLowerInvariant()
$VersionDir=Join-Path $InstallRoot (("v"+$Version+"-")+$PackageSha.Substring(0,12))
$Current=Join-Path $InstallRoot 'current'
$StartMenu=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Remote Commander'
$Reg='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\RemoteCommander'

New-Item -ItemType Directory -Force -Path $VersionDir,$StartMenu | Out-Null
Copy-Item -Path (Join-Path $SourceDir '*') -Destination $VersionDir -Recurse -Force -ErrorAction Stop

if(Test-Path -LiteralPath $Current){Remove-Item -LiteralPath $Current -Force -Recurse}
New-Item -ItemType Junction -Path $Current -Target $VersionDir | Out-Null

$Wsh=New-Object -ComObject WScript.Shell
$Icon=(Join-Path $Current 'RemoteCommander.exe')+',0'
function New-RcShortcut([string]$Name,[string]$Target,[string]$Arguments,[string]$Description){
  $shortcutPath=Join-Path $StartMenu ($Name+'.lnk')
  $s=$Wsh.CreateShortcut($shortcutPath)
  $s.TargetPath=$Target
  $s.Arguments=$Arguments
  $s.WorkingDirectory=$Current
  $s.IconLocation=$Icon
  $s.Description=$Description
  $s.Save()
  if(-not(Test-Path -LiteralPath $shortcutPath -PathType Leaf)){throw "Start Menu shortcut was not created: $Name"}
  return $shortcutPath
}
$DashboardShortcut=New-RcShortcut 'Remote Commander' (Join-Path $Current 'RemoteCommander.exe') '' 'Remote Commander dashboard'
$Pwsh=(Get-Command pwsh.exe -ErrorAction Stop).Source
$ProfileShortcut=New-RcShortcut 'Remote Commander Profiles & Access' $Pwsh ('-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $Current 'profile-manager-windows.ps1')+'"') 'Remote Commander profile and access manager'
$MonitorShortcut=New-RcShortcut 'Remote Commander Operations Monitor' $Pwsh ('-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $Current 'operations-monitor-windows.ps1')+'"') 'Remote Commander projects and operations monitor'
$AdminShortcut=New-RcShortcut 'Remote Commander Admin Runtime' $Pwsh ('-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $Current 'admin-runtime-windows.ps1')+'"') 'Remote Commander elevated runtime manager'

$Uninstall=Join-Path $InstallRoot 'uninstall.ps1'
$UninstallText=@"
`$ErrorActionPreference='Stop'
`$StartMenu=Join-Path `$env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Remote Commander'
Remove-Item -LiteralPath `$StartMenu -Recurse -Force -ErrorAction SilentlyContinue
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

Write-Output "REMOTE_COMMANDER_DESKTOP_INSTALL_PASS version=$Version install=$InstallRoot shortcuts=4 dashboard=$DashboardShortcut profiles=$ProfileShortcut monitor=$MonitorShortcut admin=$AdminShortcut"
