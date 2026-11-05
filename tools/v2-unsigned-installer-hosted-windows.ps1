# Explicit disposable GitHub-hosted Windows only. Never run on owner desktops.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or
   $env:GITHUB_REPOSITORY -ne 'GOD13emad/ChatGPTRemoteCommander' -or
   $env:RUNNER_OS -ne 'Windows'){throw 'V2_QA_HOSTED_WINDOWS_ONLY_DENY'}
$sha='823cf44f3f63710bbf44a2a69490fef96445a676325041da2e46cb3d04f49076'
$url='https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/download/commander-v2.1.50-unsigned-qa.readonlyfix.20261105/Commander-V2-Windows-x64.exe'
$download=Join-Path $env:RUNNER_TEMP 'Commander-V2-Windows-x64-unsigned-qa.exe'
if(Test-Path -LiteralPath $download){throw 'V2_QA_DOWNLOAD_COLLISION'}
function InstallEntries {
 $keys=@('HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
   'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
   'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
 return @(Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue |
   Where-Object {
     if($_.PSObject.Properties.Match('DisplayName').Count -ne 1){return $false}
     $_.DisplayName -eq 'Commander V2' -or $_.DisplayName -eq 'Commander V2 Workspace Preview'
   })
}
function RunOwned([string]$binary,[string]$arguments,[int]$timeoutMs) {
 $p=[Diagnostics.Process]::new()
 $p.StartInfo.FileName=$binary
 $p.StartInfo.Arguments=$arguments
 $p.StartInfo.UseShellExecute=$false
 if(!$p.Start()){throw 'V2_QA_PROCESS_NOT_STARTED'}
 try {
  if(!$p.WaitForExit($timeoutMs)){
   try{$p.Kill($true)}catch{}
   throw 'V2_QA_PROCESS_TIMEOUT'
  }
  if($p.ExitCode -ne 0){throw "V2_QA_PROCESS_EXIT_$($p.ExitCode)"}
 }finally{$p.Dispose()}
}
if(@(InstallEntries).Count -ne 0){throw 'V2_EXISTING_DESKTOP_REGISTRATION_DENY'}
Invoke-WebRequest -Uri $url -OutFile $download -MaximumRedirection 8 -TimeoutSec 300
if((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha){
 throw 'V2_QA_DOWNLOAD_SHA_MISMATCH'
}
Write-Output 'V2_WINDOWS_INSTALLER_SHA_PASS'
RunOwned $download '/S' 240000
$records=@()
for($i=0;$i -lt 36;$i++){
 $records=@(InstallEntries)
 if($records.Count -gt 0){break}
 Start-Sleep -Seconds 2
}
if($records.Count -ne 1){throw "V2_WINDOWS_ONE_REGISTRATION_EXPECTED_$($records.Count)"}
$record=$records[0]
if([string]$record.DisplayVersion -ne '2.1.50'){throw 'V2_WINDOWS_VERSION_MISMATCH'}
$uninstall=[string]$record.UninstallString
if($uninstall -match '^\s*"([^"]+\.exe)"(?:\s.*)?$'){$uninstaller=$Matches[1]}
elseif($uninstall -match '^\s*([A-Za-z]:\\.+\.exe)\s*$'){$uninstaller=$Matches[1]}
else {throw 'V2_WINDOWS_UNINSTALL_STRING_NOT_VERIFIED'}
if(!(Test-Path -LiteralPath $uninstaller -PathType Leaf)){throw 'V2_WINDOWS_UNINSTALLER_MISSING'}
if((Split-Path -Leaf $uninstaller) -notmatch '^Uninstall.*\.exe$'){throw 'V2_WINDOWS_UNINSTALLER_NAME_INVALID'}
$allowed=([IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs'))).TrimEnd('\')+'\'
if(!([IO.Path]::GetFullPath($uninstaller)).StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){
 throw 'V2_WINDOWS_PERUSER_INSTALL_LOCATION_NOT_VERIFIED'
}
$manifest=Join-Path (Split-Path $uninstaller -Parent) 'resources\commander-v2-workspace\MANIFEST.json'
if(!(Test-Path -LiteralPath $manifest -PathType Leaf) -or
 (Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash.ToLowerInvariant() -ne
 '1202e46e59162946452a255b03db98de77bd7bf81b978e3a1c867d2490937c64'){
 throw 'V2_WINDOWS_INSTALLED_MANIFEST_MISMATCH'
}
Write-Output 'V2_WINDOWS_SINGLE_USER_INSTALL_PASS'
RunOwned $uninstaller '/S' 180000
for($i=0;$i -lt 36;$i++){
 if(@(InstallEntries).Count -eq 0){break}
 Start-Sleep -Seconds 2
}
if(@(InstallEntries).Count -ne 0){throw 'V2_WINDOWS_UNINSTALL_REGISTRATION_REMAINS'}
if(Test-Path -LiteralPath $uninstaller){throw 'V2_WINDOWS_UNINSTALL_BINARY_REMAINS'}
Write-Output 'V2_HOSTED_WINDOWS_INSTALL_UNINSTALL_PASS'
