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
if(-not $InstallRoot){$InstallRoot=Join-Path $env:LOCALAPPDATA 'Programs\Remote Commander'}
$InstallRoot=[IO.Path]::GetFullPath($InstallRoot)
$VersionDir=Join-Path $InstallRoot ("v"+$Version)
$Current=Join-Path $InstallRoot 'current'
$StartMenu=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Remote Commander'
$Reg='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\RemoteCommander'

New-Item -ItemType Directory -Force -Path $VersionDir,$StartMenu | Out-Null
Copy-Item -Path (Join-Path $SourceDir '*') -Destination $VersionDir -Recurse -Force -ErrorAction Stop

if(Test-Path -LiteralPath $Current){Remove-Item -LiteralPath $Current -Force -Recurse}
New-Item -ItemType Junction -Path $Current -Target $VersionDir | Out-Null

$Wsh=New-Object -ComObject WScript.Shell
$Shortcut=$Wsh.CreateShortcut((Join-Path $StartMenu 'Remote Commander.lnk'))
$Shortcut.TargetPath=Join-Path $Current 'RemoteCommander.exe'
$Shortcut.WorkingDirectory=$Current
$Shortcut.IconLocation=(Join-Path $Current 'RemoteCommander.exe')+',0'
$Shortcut.Description='Remote Commander dashboard'
$Shortcut.Save()

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
New-ItemProperty -Path $Reg -Name DisplayIcon -Value ((Join-Path $Current 'RemoteCommander.exe')+',0') -PropertyType String -Force | Out-Null
New-ItemProperty -Path $Reg -Name UninstallString -Value ('"'+(Get-Command pwsh.exe).Source+'" -NoProfile -File "'+$Uninstall+'"') -PropertyType String -Force | Out-Null
New-ItemProperty -Path $Reg -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $Reg -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null

$Check=Join-Path $StartMenu 'Remote Commander.lnk'
if(-not (Test-Path -LiteralPath $Check -PathType Leaf)){throw 'Start Menu shortcut was not created'}
Write-Output "REMOTE_COMMANDER_DESKTOP_INSTALL_PASS version=$Version install=$InstallRoot shortcut=$Check"
