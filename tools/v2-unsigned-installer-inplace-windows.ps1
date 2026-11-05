# Real same-semver V2 QA replacement/rollback, disposable GitHub Windows only.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or
   $env:GITHUB_REPOSITORY -ne 'GOD13emad/ChatGPTRemoteCommander' -or
   $env:RUNNER_OS -ne 'Windows'){throw 'V2_WINDOWS_REPLACE_NOT_HOSTED_DENY'}
$base='https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/download'
$oldurl="$base/commander-v2.1.50-unsigned-qa.20261105/Commander-V2-Windows-x64.exe"
$newurl="$base/commander-v2.1.50-unsigned-qa.readonlyfix.20261105/Commander-V2-Windows-x64.exe"
$oldsha='58f6ae3e10e56f1effb030ef929ab78c2de0623204e370efce8b80c4779caa65'
$newsha='823cf44f3f63710bbf44a2a69490fef96445a676325041da2e46cb3d04f49076'
$old=Join-Path $env:RUNNER_TEMP 'v2-previous-unsigned-qa.exe'
$new=Join-Path $env:RUNNER_TEMP 'v2-readonlyfix-unsigned-qa.exe'
function Entries {
 $keys=@('HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
 return @(Get-ItemProperty -Path $keys -EA SilentlyContinue | Where-Object {
  if($_.PSObject.Properties.Match('DisplayName').Count -ne 1){return $false}
  $_.DisplayName -eq 'Commander V2' -or $_.DisplayName -eq 'Commander V2 Workspace Preview'
 })
}
function RunOwned([string]$binary,[string]$arguments,[int]$timeoutMs){
 $p=[Diagnostics.Process]::new()
 $p.StartInfo.FileName=$binary
 $p.StartInfo.Arguments=$arguments
 $p.StartInfo.UseShellExecute=$false
 if(!$p.Start()){throw 'V2_WINDOWS_REPLACE_PROCESS_NOT_STARTED'}
 try {
  if(!$p.WaitForExit($timeoutMs)){try{$p.Kill($true)}catch{};throw 'V2_WINDOWS_REPLACE_TIMEOUT'}
  if($p.ExitCode -ne 0){throw "V2_WINDOWS_REPLACE_EXIT_$($p.ExitCode)"}
 }finally{$p.Dispose()}
}
function VerifyOne {
 $records=@()
 for($i=0;$i -lt 30;$i++){
  $records=@(Entries)
  if($records.Count -gt 0){break}
  Start-Sleep -Milliseconds 750
 }
 if($records.Count -ne 1){throw "V2_WINDOWS_REPLACE_REGISTRATION_COUNT_$($records.Count)"}
 $record=$records[0]
 if([string]$record.DisplayVersion -ne '2.1.50'){throw 'V2_WINDOWS_REPLACE_VERSION'}
 $uninstall=[string]$record.UninstallString
 if($uninstall -match '^\s*"([^"]+\.exe)"(?:\s.*)?$'){$binary=$Matches[1]}
 elseif($uninstall -match '^\s*([A-Za-z]:\\.+\.exe)\s*$'){$binary=$Matches[1]}
 else {throw 'V2_WINDOWS_REPLACE_UNINSTALL_PATH_UNTRUSTED'}
 if(!(Test-Path -LiteralPath $binary -PathType Leaf)){throw 'V2_WINDOWS_REPLACE_UNINSTALLER_MISSING'}
 if((Split-Path -Leaf $binary) -notmatch '^Uninstall.*\.exe$'){throw 'V2_WINDOWS_REPLACE_UNINSTALLER_NAME'}
 $allowed=([IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs'))).TrimEnd('\')+'\'
 if(!([IO.Path]::GetFullPath($binary)).StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){
  throw 'V2_WINDOWS_REPLACE_UNINSTALLER_OUTSIDE_USER_ROOT'
 }
 $manifest=Join-Path (Split-Path $binary -Parent) 'resources\commander-v2-workspace\MANIFEST.json'
 if(!(Test-Path -LiteralPath $manifest)){throw 'V2_WINDOWS_REPLACE_MANIFEST_MISSING'}
 return @{manifest=$manifest;uninstaller=$binary}
}
if(@(Entries).Count -ne 0){throw 'V2_WINDOWS_REPLACE_DIRTY_RUNNER_DENY'}
if((Test-Path -LiteralPath $old) -or (Test-Path -LiteralPath $new)){throw 'V2_WINDOWS_REPLACE_DOWNLOAD_PATH_COLLISION'}
Invoke-WebRequest -Uri $oldurl -OutFile $old -MaximumRedirection 8 -TimeoutSec 300
Invoke-WebRequest -Uri $newurl -OutFile $new -MaximumRedirection 8 -TimeoutSec 300
if((Get-FileHash $old -Algorithm SHA256).Hash.ToLowerInvariant() -ne $oldsha -or
   (Get-FileHash $new -Algorithm SHA256).Hash.ToLowerInvariant() -ne $newsha){
 throw 'V2_WINDOWS_REPLACE_DOWNLOAD_SHA'
}
Write-Output 'V2_REPLACE_WINDOWS_BOTH_RELEASES_SHA_PASS'
RunOwned $old '/S' 240000
$prior=VerifyOne
$originalManifest=(Get-FileHash $prior.manifest -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Output 'V2_REPLACE_WINDOWS_OLD_PACKAGE_INSTALLED'
RunOwned $new '/S' 240000
$updated=VerifyOne
$expectedManifest='1202e46e59162946452a255b03db98de77bd7bf81b978e3a1c867d2490937c64'
$updatedManifest=(Get-FileHash $updated.manifest -Algorithm SHA256).Hash.ToLowerInvariant()
if($updatedManifest -ne $expectedManifest -or $originalManifest -eq $updatedManifest){
 throw 'V2_WINDOWS_REPLACE_READONLYFIX_NOT_APPLIED'
}
Write-Output 'V2_REPLACE_WINDOWS_INPLACE_READONLYFIX_PASS'
RunOwned $old '/S' 240000
$reverted=VerifyOne
if((Get-FileHash $reverted.manifest -Algorithm SHA256).Hash.ToLowerInvariant() -ne $originalManifest){
 throw 'V2_WINDOWS_REPLACE_ROLLBACK_MANIFEST_MISMATCH'
}
Write-Output 'V2_REPLACE_WINDOWS_DISPOSABLE_ROLLBACK_PASS'
RunOwned $reverted.uninstaller '/S' 180000
for($i=0;$i -lt 40;$i++){
 if(@(Entries).Count -eq 0){break}
 Start-Sleep -Milliseconds 750
}
if(@(Entries).Count -ne 0){throw 'V2_WINDOWS_REPLACE_FINAL_REGISTRATION_REMAINS'}
if(Test-Path -LiteralPath $reverted.uninstaller){throw 'V2_WINDOWS_REPLACE_FINAL_BINARY_REMAINS'}
Write-Output 'V2_REPLACE_WINDOWS_FINAL_UNINSTALL_PASS'
