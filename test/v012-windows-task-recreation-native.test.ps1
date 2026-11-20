# Disposable current-owner Windows Task Scheduler registration/restore probe.
# Does NOT modify any existing Remote Commander task or run an action.
$ErrorActionPreference='Stop'
if($env:OS -ne 'Windows_NT'){throw 'V012_TASK_QA_WINDOWS_ONLY'}
$taskName='V012-Scoped-Owner-QA-'+[guid]::NewGuid().ToString('N')
$registered=$false
$passed=$false
try {
  if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){
    throw 'V012_TASK_QA_NAME_COLLISION'
  }
  $who=[Security.Principal.WindowsIdentity]::GetCurrent().Name
  $action=New-ScheduledTaskAction -Execute $env:ComSpec -Argument '/c exit 0'
  $principal=New-ScheduledTaskPrincipal -UserId $who -LogonType Interactive -RunLevel Limited
  $settings=New-ScheduledTaskSettingsSet -Disable
  $plan=New-ScheduledTask -Action $action -Principal $principal -Settings $settings
  [void](Register-ScheduledTask -TaskName $taskName -InputObject $plan -ErrorAction Stop)
  $registered=$true
  $original=Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  if($original.Settings.Enabled -or @($original.Triggers|Where-Object {$_ -ne $null}).Count -ne 0) {
    throw 'V012_TASK_QA_ORIGINAL_NOT_DISABLED'
  }
  $xml=Export-ScheduledTask -TaskName $taskName -ErrorAction Stop
  [xml]$parsed=$xml
  $values=@($parsed.SelectNodes("//*[local-name()='Settings']/*[local-name()='Enabled']")|
      Where-Object {$_ -ne $null})
  if($values.Count -ne 1 -or $values[0].InnerText -ne 'false') {
    throw 'V012_TASK_QA_XML_NOT_DISABLED'
  }
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
  $registered=$false
  [void](Register-ScheduledTask -TaskName $taskName -Xml $xml -ErrorAction Stop)
  $registered=$true
  $restored=Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $actions=@($restored.Actions|Where-Object {$_ -ne $null})
  if($restored.Settings.Enabled -or
     @($restored.Triggers|Where-Object {$_ -ne $null}).Count -ne 0 -or
     $actions.Count -ne 1 -or
     $actions[0].Arguments -ne '/c exit 0') {
    throw 'V012_TASK_QA_RESTORED_NOT_EQUIVALENT'
  }
  $passed=$true
}finally {
  # Reconcile the exact unique disposable task before attempting cleanup.
  # Do not touch any pre-existing Commander production task.
  # Reconcile before every removal attempt; retry only an identical, verified
  # disabled/no-trigger fixture task if the Scheduler has not settled yet.
  for($attempt=0;$attempt -lt 3;$attempt++){
    $found=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if($null -eq $found){break}
    $actions=@($found.Actions|Where-Object {$_ -ne $null})
    if($found.Settings.Enabled -or
       @($found.Triggers|Where-Object {$_ -ne $null}).Count -ne 0 -or
       $actions.Count -ne 1 -or $actions[0].Arguments -ne '/c exit 0'){
      throw 'V012_TASK_QA_CLEANUP_IDENTITY_CHANGED'
    }
    try {Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop}
    catch {
      if($attempt -eq 2 -and
         (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)){
        throw 'V012_TASK_QA_CLEANUP_BLOCKED'
      }
    }
    Start-Sleep -Milliseconds 220
  }
  if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){
    throw 'V012_TASK_QA_RESIDUAL_TASK'
  }
}
if(-not $passed){throw 'V012_TASK_QA_NOT_PASSED'}
'V012_WINDOWS_DISPOSABLE_TASK_RECREATE_PASS taskDisabled=True noTriggers=True cleanup=True productionTasksUntouched=True'
