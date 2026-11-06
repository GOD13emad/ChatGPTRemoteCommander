param([Parameter(Mandatory=$true)][ValidateSet('apply','rollback')][string]$Operation)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$taskName='ChatGPTRemoteCommanderOwnerIssuerV1'
$program=[Environment]::GetFolderPath('ProgramFiles')+'\ChatGPTRemoteCommander\owner-auth'
$state=[Environment]::GetFolderPath('CommonApplicationData')+'\ChatGPTRemoteCommander\owner-auth'
$enrollment=[IO.File]::ReadAllText($state+'\enrollment.intent.json')|ConvertFrom-Json
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
if($identity.User.Value -ne $enrollment.ownerSid -or -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'TASK_SAME_OWNER_ADMIN_REQUIRED'}
$sddl='O:BAG:BAD:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGX;;;'+$enrollment.ownerSid+')'
$hostPath=$program+'\CommanderNativeIssuer.exe'
$system=[Environment]::SystemDirectory
$description='Remote Commander owner selftest issuer; bundle='+$enrollment.bundleSha256+'; enrollment='+$enrollment.enrollmentId
$hasRegistration=[IO.File]::Exists($state+'\task.registration.intent.json')
$prepared=$null
if([IO.File]::Exists($state+'\task.prepared.json')){
    $prepared=[IO.File]::ReadAllText($state+'\task.prepared.json')|ConvertFrom-Json
    if($prepared.schema -cne 'RC_OWNER_TASK_PREPARED_V1' -or $prepared.ownerSid -cne $enrollment.ownerSid -or $prepared.bundleSha256 -cne $enrollment.bundleSha256 -or $prepared.enrollmentId -cne $enrollment.enrollmentId -or $prepared.taskName -cne ('\'+$taskName) -or $prepared.sddl -cne $sddl){throw 'TASK_PREPARATION_BINDING'}
}
if($hasRegistration){
    if($null -eq $prepared){throw 'TASK_REGISTRATION_WITHOUT_PREPARATION'}
    $registration=[IO.File]::ReadAllText($state+'\task.registration.intent.json')|ConvertFrom-Json
    $hasher=[Security.Cryptography.SHA256]::Create()
    try{$preparedHash=[BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($state+'\task.prepared.json'))).Replace('-','').ToLowerInvariant()}finally{$hasher.Dispose()}
    if($registration.schema -cne 'RC_OWNER_TASK_REGISTRATION_INTENT_V1' -or $registration.ownerSid -cne $enrollment.ownerSid -or $registration.bundleSha256 -cne $enrollment.bundleSha256 -or $registration.enrollmentId -cne $enrollment.enrollmentId -or $registration.preparedSha256 -cne $preparedHash){throw 'TASK_REGISTRATION_INTENT_BINDING'}
}
$service=New-Object -ComObject 'Schedule.Service'
$service.Connect()
$folder=$service.GetFolder('\')
function Get-Existing {
    try { return $folder.GetTask($taskName) }
    catch { $errorObject=$_.Exception;while($null -ne $errorObject.InnerException){$errorObject=$errorObject.InnerException};if($errorObject.HResult -eq -2147024894){return $null}; throw }
}
function Canonical-Sddl([string]$value){$sd=[Security.AccessControl.RawSecurityDescriptor]::new($value);$b=New-Object byte[] $sd.BinaryLength;$sd.GetBinaryForm($b,0);return [Convert]::ToBase64String($b)}
function Select-RollbackPlan([bool]$HasRegistrationIntent,[bool]$TaskPresent,[bool]$MatchesPrepared,[int]$TaskState){
    if(-not $TaskPresent){return 'ALREADY_DEACTIVATED'}
    if(-not $HasRegistrationIntent){throw 'TASK_UNOWNED_NO_REGISTRATION_INTENT'}
    if(-not $MatchesPrepared){throw 'TASK_CHANGED_OR_UNKNOWN_ROLLBACK_DENIED'}
    if($TaskState -ne 1 -and $TaskState -ne 3){throw 'TASK_ACTIVE_OR_STATE_UNKNOWN_NO_STOP'}
    return 'REMOVE_EXACT_IDLE_TASK'
}
function Verify-Task($task){
    [xml]$actual=$task.Xml
    $ns=[Xml.XmlNamespaceManager]::new($actual.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
    function V([string]$path){return $actual.SelectSingleNode($path,$ns).InnerText}
    if((V '/t:Task/t:RegistrationInfo/t:Description') -cne $description){throw 'TASK_UNIQUE_ENROLLMENT_DESCRIPTION'}
    if($actual.SelectNodes('/t:Task/t:Triggers/*',$ns).Count -ne 0 -or $actual.SelectNodes('/t:Task/t:Actions/*',$ns).Count -ne 1){throw 'TASK_TRIGGER_OR_ACTION_COUNT'}
    if($actual.SelectNodes('/t:Task/t:Principals/t:Principal',$ns).Count -ne 1 -or $actual.SelectSingleNode('/t:Task/t:Principals/t:Principal',$ns).GetAttribute('id') -cne 'System' -or $actual.SelectSingleNode('/t:Task/t:Actions',$ns).GetAttribute('Context') -cne 'System'){throw 'TASK_PRINCIPAL_OR_CONTEXT_COUNT'}
    if((V '/t:Task/t:Actions/t:Exec/t:Command') -cne $hostPath -or (V '/t:Task/t:Actions/t:Exec/t:Arguments') -cne '--serve-once' -or (V '/t:Task/t:Actions/t:Exec/t:WorkingDirectory') -cne $system){throw 'TASK_FIXED_ACTION_CHANGED'}
    if((V '/t:Task/t:Principals/t:Principal/t:UserId') -ne 'S-1-5-18' -or (V '/t:Task/t:Principals/t:Principal/t:LogonType') -ne 'ServiceAccount' -or (V '/t:Task/t:Principals/t:Principal/t:RunLevel') -ne 'HighestAvailable'){throw 'TASK_PRINCIPAL_CHANGED'}
    foreach($pair in @(@('MultipleInstancesPolicy','IgnoreNew'),@('AllowStartOnDemand','true'),@('Enabled','true'),@('AllowHardTerminate','false'),@('StartWhenAvailable','false'),@('WakeToRun','false'),@('ExecutionTimeLimit','PT2M'),@('DisallowStartIfOnBatteries','false'),@('StopIfGoingOnBatteries','false'),@('RunOnlyIfNetworkAvailable','false'),@('Hidden','false'))){if((V ('/t:Task/t:Settings/t:'+ $pair[0])) -ne $pair[1]){throw 'TASK_SETTINGS_CHANGED'}}
    if($actual.SelectNodes('/t:Task/t:Settings/t:RestartOnFailure',$ns).Count -ne 0){throw 'TASK_RESTART_FORBIDDEN'}
    $actualSddl=$task.GetSecurityDescriptor(7)
    if((Canonical-Sddl $actualSddl) -cne (Canonical-Sddl $sddl)){throw 'TASK_SDDL_CHANGED'}
    return @{xml=$task.Xml;sddl=$actualSddl}
}
if($Operation -eq 'apply'){
    if(-not $hasRegistration -or $null -eq $prepared){throw 'TASK_PREPARATION_AND_INTENT_REQUIRED'}
    if($null -ne (Get-Existing)){throw 'TASK_ALREADY_EXISTS_NO_OVERWRITE'}
    $xml=$prepared.xml
    $null=$folder.RegisterTask($taskName,$xml,17,'SYSTEM',$null,5,$sddl)
    $task=$folder.RegisterTask($taskName,$xml,18,'SYSTEM',$null,5,$sddl)
    $verified=Verify-Task $task
    $verified['schema']='RC_OWNER_TASK_ATTESTED_V1';$verified['taskName']='\'+$taskName;$verified['started']=$false
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($verified|ConvertTo-Json -Compress))
    $f=[IO.FileStream]::new($state+'\task.attested.json',[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough)
    if($f.Length -ne 0){$f.Dispose();throw 'TASK_RECEIPT_ALREADY_POPULATED'}
    try{$f.Write($bytes,0,$bytes.Length);$f.Flush($true)}finally{$f.Dispose()}
    '{"status":"TASK_CREATED_ATTESTED_NOT_STARTED"}'
}else{
    $task=Get-Existing
    $matches=$false;$taskState=0
    if($null -ne $task){
        $taskState=[int]$task.State
        if($hasRegistration -and $null -ne $prepared){$null=Verify-Task $task;$matches=$true}
    }
    $decision=Select-RollbackPlan $hasRegistration ($null -ne $task) $matches $taskState
    if($decision -eq 'ALREADY_DEACTIVATED'){'{"status":"TASK_ABSENT_DEACTIVATED_FILES_AND_KEYS_PRESERVED"}';exit 0}
    # Re-read exact task and idle state immediately before the sole delete.
    $task=Get-Existing;if($null -eq $task){'{"status":"TASK_ABSENT_DEACTIVATED_FILES_AND_KEYS_PRESERVED"}';exit 0}
    $null=Verify-Task $task
    $null=Select-RollbackPlan $hasRegistration $true $true ([int]$task.State)
    $folder.DeleteTask($taskName,0)
    if($null -ne (Get-Existing)){throw 'TASK_DELETE_UNCERTAIN_NO_RETRY'}
    '{"status":"TASK_REMOVED_FILES_AND_KEYS_PRESERVED"}'
}
