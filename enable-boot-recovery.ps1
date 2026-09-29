param(
  [string]$OwnerUserProfile = $env:USERPROFILE,
  [string]$BootTaskName = 'ChatGPTRemoteCommander-BootRecovery',
  [string]$HandoffTaskName = 'ChatGPTRemoteCommander-UserSessionHandoff',
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'

function Test-Elevated {
  $id=[Security.Principal.WindowsIdentity]::GetCurrent()
  $p=[Security.Principal.WindowsPrincipal]::new($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
if (-not (Test-Elevated)) { throw 'BOOT_RECOVERY_ELEVATION_REQUIRED' }
if ([Security.Principal.WindowsIdentity]::GetCurrent().IsSystem) { throw 'BOOT_RECOVERY_RUN_AS_OWNER_ADMIN_REQUIRED' }

$SourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$OwnerUserProfile = [IO.Path]::GetFullPath($OwnerUserProfile)
if ([IO.Path]::GetFullPath($env:USERPROFILE) -ne $OwnerUserProfile) {
  throw 'BOOT_RECOVERY_OWNER_PROFILE_MUST_MATCH_CURRENT_USER'
}
$OwnerLocal = Join-Path $OwnerUserProfile 'AppData\Local'
$OwnerRoaming = Join-Path $OwnerUserProfile 'AppData\Roaming'
$StableRoot = Join-Path $OwnerLocal 'ChatGPTRemoteCommander\app'
$stableSupervisor = Join-Path $StableRoot 'autostart-windows.ps1'
$stableHandoff = Join-Path $StableRoot 'handoff-user-session-windows.ps1'
$Root = if((Test-Path -LiteralPath $stableSupervisor -PathType Leaf) -and (Test-Path -LiteralPath $stableHandoff -PathType Leaf)){$StableRoot}else{$SourceRoot}
$CredDir = Join-Path $OwnerLocal 'ChatGPTRemoteCommander\credentials'
$ProfileDir = Join-Path $OwnerRoaming 'tunnel-client'
$VarDir = Join-Path $Root 'var'
New-Item -ItemType Directory -Force -Path $VarDir | Out-Null
$Supervisor = Join-Path $Root 'autostart-windows.ps1'
$Handoff = Join-Path $Root 'handoff-user-session-windows.ps1'
foreach($p in @($CredDir,$ProfileDir,$Supervisor,$Handoff)){
  if(-not(Test-Path -LiteralPath $p)){throw "BOOT_RECOVERY_REQUIRED_PATH_MISSING $p"}
}

$pwsh = (Get-Command pwsh.exe -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$ownerIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$ownerName = $ownerIdentity.Name

function Set-MachineCredentialAcl([string]$Path) {
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true,$false)
  $inherit=[Security.AccessControl.InheritanceFlags]::None
  $prop=[Security.AccessControl.PropagationFlags]::None
  $allow=[Security.AccessControl.AccessControlType]::Allow
  foreach($sidText in @('S-1-5-18','S-1-5-32-544')){
    $sid=[Security.Principal.SecurityIdentifier]::new($sidText)
    $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,$prop,$allow)
    [void]$acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Convert-OneCredential([string]$Profile) {
  if($Profile -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -or $Profile -match '\.\.' -or $Profile -in @('.','..')){
    throw "BOOT_RECOVERY_INVALID_PROFILE $Profile"
  }
  $source=Join-Path $CredDir "$Profile.dpapi"
  if(-not(Test-Path -LiteralPath $source -PathType Leaf)){throw "BOOT_RECOVERY_SOURCE_CREDENTIAL_MISSING $Profile"}
  $target=Join-Path $CredDir "$Profile.machine.dpapi"
  $secure=$null
  $plain=$null
  $bytes=$null
  $cipher=$null
  try {
    $secure=ConvertTo-SecureString (Get-Content -LiteralPath $source -Raw)
    $plain=[System.Net.NetworkCredential]::new('',$secure).Password
    if([string]::IsNullOrWhiteSpace($plain)){throw "BOOT_RECOVERY_SOURCE_CREDENTIAL_EMPTY $Profile"}
    $bytes=[Text.Encoding]::UTF8.GetBytes($plain)
    $cipher=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
    $encoded=[Convert]::ToBase64String($cipher)
    $tmp="$target.tmp-$PID"
    [IO.File]::WriteAllText($tmp,$encoded+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
    Set-MachineCredentialAcl $tmp
    $roundCipher=[Convert]::FromBase64String((Get-Content -LiteralPath $tmp -Raw).Trim())
    $roundClear=[Security.Cryptography.ProtectedData]::Unprotect($roundCipher,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
    try {
      $round=[Text.Encoding]::UTF8.GetString($roundClear)
      if($round -ne $plain){throw "BOOT_RECOVERY_MACHINE_CREDENTIAL_VERIFY_FAIL $Profile"}
    } finally {
      if($roundCipher){[Array]::Clear($roundCipher,0,$roundCipher.Length)}
      if($roundClear){[Array]::Clear($roundClear,0,$roundClear.Length)}
      $round=$null
    }
    Move-Item -LiteralPath $tmp -Destination $target -Force
    Set-MachineCredentialAcl $target
    return $target
  } finally {
    if($bytes){[Array]::Clear($bytes,0,$bytes.Length)}
    if($cipher){[Array]::Clear($cipher,0,$cipher.Length)}
    $plain=$null
    $secure=$null
  }
}

$profiles=@()
foreach($file in Get-ChildItem -LiteralPath $ProfileDir -Filter '*.yaml' -File){
  $profile=[IO.Path]::GetFileNameWithoutExtension($file.Name)
  if($profile -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -and $profile -notmatch '\.\.' -and $profile -notin @('.','..')){
    $profiles += $profile
  }
}
$profiles=@($profiles | Sort-Object -Unique)
if($profiles.Count -lt 1){throw 'BOOT_RECOVERY_NO_TUNNEL_PROFILES'}
$machineFiles=@()
foreach($profile in $profiles){$machineFiles += Convert-OneCredential $profile}

$probeName=$BootTaskName+'-Probe'
$probeResult=Join-Path $VarDir 'boot-recovery-system-probe.json'
Remove-Item -LiteralPath $probeResult -Force -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $probeName -Confirm:$false -ErrorAction SilentlyContinue
$probeArgs='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -SelfTest -CredentialSelfTest -CredentialScope LocalMachine -BootCore -OwnerUserProfile "{1}" -SelfTestOutput "{2}" -NodePath "{3}" -NpmPath "{4}"' -f $Supervisor,$OwnerUserProfile,$probeResult,$node,$npm
$probeAction=New-ScheduledTaskAction -Execute $pwsh -Argument $probeArgs -WorkingDirectory $Root
$systemPrincipal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$probeSettings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName $probeName -Action $probeAction -Principal $systemPrincipal -Settings $probeSettings -Force | Out-Null
try {
  Start-ScheduledTask -TaskName $probeName
  $deadline=(Get-Date).AddSeconds(20)
  while((Get-Date)-lt$deadline -and -not(Test-Path -LiteralPath $probeResult)){Start-Sleep -Milliseconds 250}
  if(-not(Test-Path -LiteralPath $probeResult)){
    $probeInfo=Get-ScheduledTaskInfo -TaskName $probeName -ErrorAction SilentlyContinue
    $probeState=(Get-ScheduledTask -TaskName $probeName -ErrorAction SilentlyContinue).State
    $lastResult=if($probeInfo){[int64]$probeInfo.LastTaskResult}else{-1}
    throw "BOOT_RECOVERY_SYSTEM_PROBE_NO_RESULT state=$probeState lastTaskResult=$lastResult"
  }
  $probe=Get-Content -LiteralPath $probeResult -Raw | ConvertFrom-Json
  if(-not $probe.ok -or -not $probe.bootCore -or [string]$probe.credentialScope -ne 'LocalMachine'){
    $detail=if($probe.PSObject.Properties.Name -contains 'error' -and -not [string]::IsNullOrWhiteSpace([string]$probe.error)){[string]$probe.error}else{'unspecified'}
    throw "BOOT_RECOVERY_SYSTEM_PROBE_FAIL error=$detail"
  }
  if(@($probe.profiles | Where-Object {-not $_.credentialReady}).Count -gt 0){throw 'BOOT_RECOVERY_SYSTEM_CREDENTIAL_PROBE_FAIL'}
} finally {
  Unregister-ScheduledTask -TaskName $probeName -Confirm:$false -ErrorAction SilentlyContinue
}

$bootArgs='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -CredentialScope LocalMachine -BootCore -OwnerUserProfile "{1}" -NodePath "{2}" -NpmPath "{3}"' -f $Supervisor,$OwnerUserProfile,$node,$npm
$bootAction=New-ScheduledTaskAction -Execute $pwsh -Argument $bootArgs -WorkingDirectory $Root
$bootTrigger=New-ScheduledTaskTrigger -AtStartup
$bootSettings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 20 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $BootTaskName -Action $bootAction -Trigger $bootTrigger -Principal $systemPrincipal -Settings $bootSettings -Force | Out-Null

$handoffArgs='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -OwnerUserProfile "{1}"' -f $Handoff,$OwnerUserProfile
$handoffAction=New-ScheduledTaskAction -Execute $pwsh -Argument $handoffArgs -WorkingDirectory $Root
$handoffTrigger=New-ScheduledTaskTrigger -AtLogOn -User $ownerName
$handoffSettings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 12 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Minutes 12) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $HandoffTaskName -Action $handoffAction -Trigger $handoffTrigger -Principal $systemPrincipal -Settings $handoffSettings -Force | Out-Null

$runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
New-Item -Path $runKey -Force | Out-Null
$logonCommand='"{0}" -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{1}"' -f $pwsh,$Supervisor
New-ItemProperty -Path $runKey -Name 'ChatGPTRemoteCommander' -Value $logonCommand -PropertyType String -Force | Out-Null

if(-not $NoStart){
  Start-ScheduledTask -TaskName $BootTaskName
}

[ordered]@{
  ok=$true
  bootTask=$BootTaskName
  handoffTask=$HandoffTaskName
  owner=$ownerName
  ownerUserProfile=$OwnerUserProfile
  credentialScope='LocalMachine'
  machineCredentialCount=$machineFiles.Count
  systemProbe=$true
  autoAdminLogonRequired=$false
  plaintextCredentialPersisted=$false
  rebootPerformed=$false
  started=(-not $NoStart)
}|ConvertTo-Json -Compress
