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
$escaped=[Security.SecurityElement]::Escape($hostPath)
$cwd=[Security.SecurityElement]::Escape($system)
$xml='<?xml version="1.0" encoding="UTF-16"?><Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><RegistrationInfo><Description>Remote Commander owner selftest issuer; on demand only; no project execution</Description></RegistrationInfo><Triggers/><Principals><Principal id="System"><UserId>S-1-5-18</UserId><LogonType>ServiceAccount</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>false</AllowHardTerminate><StartWhenAvailable>false</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>false</Hidden><WakeToRun>false</WakeToRun><ExecutionTimeLimit>PT2M</ExecutionTimeLimit></Settings><Actions Context="System"><Exec><Command>'+$escaped+'</Command><Arguments>--serve-once</Arguments><WorkingDirectory>'+$cwd+'</WorkingDirectory></Exec></Actions></Task>'
$service=New-Object -ComObject 'Schedule.Service'
$service.Connect()
$folder=$service.GetFolder('\')
function Get-Existing {
    try { return $folder.GetTask($taskName) }
    catch { if($_.Exception.HResult -eq -2147024894){return $null}; throw }
}
function Canonical-Sddl([string]$value){$sd=[Security.AccessControl.RawSecurityDescriptor]::new($value);$b=New-Object byte[] $sd.BinaryLength;$sd.GetBinaryForm($b,0);return [Convert]::ToBase64String($b)}
function Verify-Task($task){
    [xml]$actual=$task.Xml
    $ns=[Xml.XmlNamespaceManager]::new($actual.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
    function V([string]$path){return $actual.SelectSingleNode($path,$ns).InnerText}
    if($actual.SelectNodes('/t:Task/t:Triggers/*',$ns).Count -ne 0 -or $actual.SelectNodes('/t:Task/t:Actions/*',$ns).Count -ne 1){throw 'TASK_TRIGGER_OR_ACTION_COUNT'}
    if((V '/t:Task/t:Actions/t:Exec/t:Command') -cne $hostPath -or (V '/t:Task/t:Actions/t:Exec/t:Arguments') -cne '--serve-once' -or (V '/t:Task/t:Actions/t:Exec/t:WorkingDirectory') -cne $system){throw 'TASK_FIXED_ACTION_CHANGED'}
    if((V '/t:Task/t:Principals/t:Principal/t:UserId') -ne 'S-1-5-18' -or (V '/t:Task/t:Principals/t:Principal/t:LogonType') -ne 'ServiceAccount' -or (V '/t:Task/t:Principals/t:Principal/t:RunLevel') -ne 'HighestAvailable'){throw 'TASK_PRINCIPAL_CHANGED'}
    foreach($pair in @(@('MultipleInstancesPolicy','IgnoreNew'),@('AllowStartOnDemand','true'),@('Enabled','true'),@('AllowHardTerminate','false'),@('StartWhenAvailable','false'),@('WakeToRun','false'),@('ExecutionTimeLimit','PT2M'))){if((V ('/t:Task/t:Settings/t:'+ $pair[0])) -ne $pair[1]){throw 'TASK_SETTINGS_CHANGED'}}
    if($actual.SelectNodes('/t:Task/t:Settings/t:RestartOnFailure',$ns).Count -ne 0){throw 'TASK_RESTART_FORBIDDEN'}
    $actualSddl=$task.GetSecurityDescriptor(7)
    if((Canonical-Sddl $actualSddl) -cne (Canonical-Sddl $sddl)){throw 'TASK_SDDL_CHANGED'}
    return @{xml=$task.Xml;sddl=$actualSddl}
}
if($Operation -eq 'apply'){
    if($null -ne (Get-Existing)){throw 'TASK_ALREADY_EXISTS_NO_OVERWRITE'}
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
    $record=[IO.File]::ReadAllText($state+'\task.attested.json')|ConvertFrom-Json
    $task=Get-Existing;if($null -eq $task){throw 'TASK_MISSING_RECONCILE_NO_RETRY'}
    $verified=Verify-Task $task
    if($verified.xml -cne $record.xml -or $verified.sddl -cne $record.sddl){throw 'TASK_CHANGED_ROLLBACK_DENIED'}
    if($task.State -eq 4 -or $task.State -eq 2){throw 'TASK_ACTIVE_ROLLBACK_DENIED_NO_STOP'}
    $folder.DeleteTask($taskName,0)
    if($null -ne (Get-Existing)){throw 'TASK_DELETE_UNCERTAIN_NO_RETRY'}
    '{"status":"TASK_REMOVED_FILES_AND_KEYS_PRESERVED"}'
}
