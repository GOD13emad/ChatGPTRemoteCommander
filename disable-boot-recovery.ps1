param(
  [string]$OwnerUserProfile = $env:USERPROFILE,
  [string]$BootTaskName = 'ChatGPTRemoteCommander-BootRecovery',
  [string]$HandoffTaskName = 'ChatGPTRemoteCommander-UserSessionHandoff',
  [string]$BackupRetentionTaskName = 'ChatGPTRemoteCommander-BackupRetention',
  [switch]$KeepMachineCredentials
)
$ErrorActionPreference='Stop'
$id=[Security.Principal.WindowsIdentity]::GetCurrent()
$p=[Security.Principal.WindowsPrincipal]::new($id)
if(-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
  throw 'BOOT_RECOVERY_ELEVATION_REQUIRED'
}
$OwnerUserProfile=[IO.Path]::GetFullPath($OwnerUserProfile)
$credDir=Join-Path $OwnerUserProfile 'AppData\Local\ChatGPTRemoteCommander\credentials'

foreach($name in @($BackupRetentionTaskName,$HandoffTaskName,$BootTaskName)){
  try{Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue}catch{}
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
}
if(-not $KeepMachineCredentials -and (Test-Path -LiteralPath $credDir)){
  Get-ChildItem -LiteralPath $credDir -Filter '*.machine.dpapi' -File -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction Stop
}

[ordered]@{
  ok=$true
  bootTaskRemoved=(-not [bool](Get-ScheduledTask -TaskName $BootTaskName -ErrorAction SilentlyContinue))
  handoffTaskRemoved=(-not [bool](Get-ScheduledTask -TaskName $HandoffTaskName -ErrorAction SilentlyContinue))
  backupRetentionTaskRemoved=(-not [bool](Get-ScheduledTask -TaskName $BackupRetentionTaskName -ErrorAction SilentlyContinue))
  machineCredentialsKept=[bool]$KeepMachineCredentials
  currentUserCredentialsPreserved=$true
  autoAdminLogonChanged=$false
  rebootPerformed=$false
}|ConvertTo-Json -Compress
