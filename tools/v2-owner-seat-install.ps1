# V2 user-native owner worker bootstrap, independent of active V1.
# Install requires a logged-in owner's genuine Windows InteractiveToken.
# No password, credential-store access, token transfer, S4U, or session takeover.
param([ValidateSet('Status','Install')][string]$Mode='Status')
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){
 throw 'V2_OWNER_INSTALL_WINDOWS_REQUIRED'
}
$taskName='ChatGPTRemoteCommander-V2-OwnerSeat'
$dst='C:\ProgramData\ChatGPTRemoteCommander\V2OwnerSeat'
$sourceRoot=Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceAgent=Join-Path $sourceRoot 'v2-owner-seat-agent.mjs'
$sourceLauncher=Join-Path $sourceRoot 'v2-owner-seat-launch.ps1'
$dstAgent=Join-Path $dst 'v2-owner-seat-agent.mjs'
$dstLauncher=Join-Path $dst 'v2-owner-seat-launch.ps1'
$console=(Get-CimInstance Win32_ComputerSystem).UserName
if(!$console){throw 'V2_OWNER_NO_LOGGED_IN_CONSOLE'}
$account=New-Object Security.Principal.NTAccount($console)
$sid=$account.Translate([Security.Principal.SecurityIdentifier]).Value
$profile=Get-CimInstance Win32_UserProfile -Filter "SID='$sid'"
if(!$profile -or !$profile.LocalPath){throw 'V2_OWNER_PROFILE_NOT_FOUND'}
$heartbeatFile=Join-Path $profile.LocalPath 'AppData\Local\ChatGPTRemoteCommander\V2OwnerSeat\latest.json'
$task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
function report {
 $snap=if(Test-Path -LiteralPath $heartbeatFile){
  try{Get-Content -LiteralPath $heartbeatFile -Raw|ConvertFrom-Json}catch{$null}
 }else{$null}
 $fresh=$false
 if($snap -and $snap.role -eq 'V2_OWNER_INTERACTIVE_SESSION_WORKER' -and
    $snap.canExecuteUserActions -eq $false -and $snap.credentialsRead -eq $false){
  try{$seconds=([DateTimeOffset]::UtcNow-([DateTimeOffset]$snap.observedAt)).TotalSeconds;
      $fresh=($seconds -ge 0 -and $seconds -lt 90)}catch{}
 }
 $codeMatch=(Test-Path $dstAgent -PathType Leaf) -and
  (Test-Path $sourceAgent -PathType Leaf) -and
  ((Get-FileHash $dstAgent -Algorithm SHA256).Hash -eq
   (Get-FileHash $sourceAgent -Algorithm SHA256).Hash)
 $launcherMatch=(Test-Path $dstLauncher -PathType Leaf) -and
  (Test-Path $sourceLauncher -PathType Leaf) -and
  ((Get-FileHash $dstLauncher -Algorithm SHA256).Hash -eq
   (Get-FileHash $sourceLauncher -Algorithm SHA256).Hash)
 [pscustomobject]@{
  schema=1;taskPresent=[bool]$task;
  taskState=if($task){$task.State.ToString()}else{'NOT_INSTALLED'};
  nativeOwnerPrincipal=if($task){$task.Principal.UserId}else{$null};
  interactiveToken=($task -and $task.Principal.LogonType.ToString() -eq 'Interactive');
  limitedRunLevel=($task -and $task.Principal.RunLevel.ToString() -eq 'Limited');
  deployedAgentMatchesSource=[bool]$codeMatch;
  deployedLauncherMatchesSource=[bool]$launcherMatch;
  ownerHeartbeatFresh=$fresh;
  ownerSessionId=if($snap){$snap.sessionId}else{$null};
  loginVerified=$false;chatAuthorized=$false;
  readyForNativeOwnerHandshake=($task -and $fresh -and $codeMatch -and $launcherMatch);
  readyForBrowserAutomation=$false
 }|ConvertTo-Json -Compress
}
if($Mode -eq 'Status'){report;return}
if($task -or (Test-Path -LiteralPath $dst)){
 throw 'V2_OWNER_INSTALL_ALREADY_EXISTS_USE_STATUS'
}
if(!(Test-Path -LiteralPath $sourceAgent -PathType Leaf) -or
   !(Test-Path -LiteralPath $sourceLauncher -PathType Leaf)){
 throw 'V2_OWNER_INSTALL_SOURCE_MISSING'
}
$explorer=@(Get-Process explorer -ErrorAction SilentlyContinue|
 Where-Object {$_.SessionId -ge 1})
if($explorer.Count -lt 1){throw 'V2_OWNER_INTERACTIVE_DESKTOP_REQUIRED'}
$created=$false;$registered=$false
try{
 New-Item -ItemType Directory -Path $dst -ErrorAction Stop|Out-Null;$created=$true
 $acl=Get-Acl $dst
 $acl.SetAccessRuleProtection($true,$false)
 foreach($rule in @($acl.Access)){$acl.RemoveAccessRuleSpecific($rule)|Out-Null}
 foreach($record in @(
  @([Security.Principal.SecurityIdentifier]::new('S-1-5-18'),'FullControl'),
  @([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'),'FullControl'),
  @([Security.Principal.SecurityIdentifier]::new($sid),'ReadAndExecute')
 )){
  $rule=New-Object Security.AccessControl.FileSystemAccessRule(
   $record[0],[Security.AccessControl.FileSystemRights]::$($record[1]),
   'ContainerInherit,ObjectInherit','None','Allow'
  )
  $acl.AddAccessRule($rule)
 }
 Set-Acl -Path $dst -AclObject $acl
 Copy-Item $sourceAgent $dstAgent -ErrorAction Stop
 Copy-Item $sourceLauncher $dstLauncher -ErrorAction Stop
 foreach($pair in @(@($sourceAgent,$dstAgent),@($sourceLauncher,$dstLauncher))){
  if((Get-FileHash $pair[0] -Algorithm SHA256).Hash -ne
     (Get-FileHash $pair[1] -Algorithm SHA256).Hash){throw 'V2_OWNER_COPY_DRIFT'}
 }
 $action=New-ScheduledTaskAction -Execute "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument ('-NoProfile -NonInteractive -File "'+$dstLauncher+'" -ExpectedOwnerSid '+$sid)
 $principal=New-ScheduledTaskPrincipal -UserId $console -LogonType Interactive -RunLevel Limited
 $trigger=New-ScheduledTaskTrigger -AtLogOn -User $console
 $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries
 Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Trigger $trigger -Settings $settings -ErrorAction Stop|Out-Null
 $registered=$true
 Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
 Start-Sleep -Seconds 5
 $task=Get-ScheduledTask -TaskName $taskName
 $proof=if(Test-Path $heartbeatFile){Get-Content $heartbeatFile -Raw|ConvertFrom-Json}else{$null}
 if($task.State -ne 'Running' -or !$proof -or
  $proof.canExecuteUserActions -ne $false -or $proof.credentialsRead -ne $false){
  throw 'V2_OWNER_INSTALL_ACCEPTANCE_FAILED'
 }
 report
}catch{
 if($registered){Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue}
 if($created){Remove-Item -LiteralPath $dst -Recurse -Force -ErrorAction SilentlyContinue}
 throw
}
