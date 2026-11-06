param([Parameter(Mandatory=$true)][ValidateSet('inspect','finalize','rollback')][string]$Operation)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$script:phase='HelperStart'
function Stop-J([string]$code){$e=[InvalidOperationException]::new($code);$e.Data['code']=$code;throw $e}
function Select-JRollbackPlan([bool]$HasIntent,[bool]$HasPrepared,[bool]$HasRegistration,[bool]$TaskPresent,[bool]$Matches,[int]$TaskState,[int]$Instances){
 if(-not $TaskPresent){return 'ALREADY_DEACTIVATED'}
 if(-not($HasIntent -and $HasPrepared -and $HasRegistration)){Stop-J 'J_TASK_OWNERSHIP_EVIDENCE_REQUIRED'}
 if(-not $Matches){Stop-J 'J_TASK_CHANGED_OR_UNKNOWN'}
 if(($TaskState -ne 1 -and $TaskState -ne 3) -or $Instances -ne 0){Stop-J 'J_TASK_ACTIVE_OR_UNKNOWN_NO_STOP'}
 return 'REMOVE_EXACT_IDLE_J_TASK'
}
function Canonical-JSddl([string]$s){$d=[Security.AccessControl.RawSecurityDescriptor]::new($s);$b=New-Object byte[] $d.BinaryLength;$d.GetBinaryForm($b,0);return [Convert]::ToBase64String($b)}
function Assert-JDefinition($definition,[string]$xml,[string]$description,[string]$hostPath,[string]$system){
 $settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit;$settings.XmlResolver=$null
 $reader=[Xml.XmlReader]::Create([IO.StringReader]::new($xml),$settings);$actual=[Xml.XmlDocument]::new();$actual.XmlResolver=$null
 try{$actual.Load($reader)}finally{$reader.Dispose()}
 $ns=[Xml.XmlNamespaceManager]::new($actual.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
 function Value-J([string]$p){$n=$actual.SelectSingleNode($p,$ns);if($null -eq $n){Stop-J 'J_TASK_XML_NODE_MISSING'};return $n.InnerText}
 if((Value-J '/t:Task/t:RegistrationInfo/t:Description') -cne $description){Stop-J 'J_TASK_DESCRIPTION_CHANGED'}
 if($actual.SelectNodes('/t:Task/t:Triggers/*',$ns).Count -ne 0 -or $actual.SelectNodes('/t:Task/t:Actions/*',$ns).Count -ne 1 -or $actual.SelectNodes('/t:Task/t:Principals/t:Principal',$ns).Count -ne 1){Stop-J 'J_TASK_COUNTS_CHANGED'}
 if($actual.SelectSingleNode('/t:Task/t:Principals/t:Principal',$ns).GetAttribute('id') -cne 'System' -or $actual.SelectSingleNode('/t:Task/t:Actions',$ns).GetAttribute('Context') -cne 'System'){Stop-J 'J_TASK_CONTEXT_CHANGED'}
 if((Value-J '/t:Task/t:Actions/t:Exec/t:Command') -cne $hostPath -or (Value-J '/t:Task/t:Actions/t:Exec/t:Arguments') -cne '--serve-once' -or (Value-J '/t:Task/t:Actions/t:Exec/t:WorkingDirectory') -cne $system){Stop-J 'J_TASK_ACTION_CHANGED'}
 $nativeUser=[string]$definition.Principal.UserId
 $nativeSid=if($nativeUser.StartsWith('S-1-',[StringComparison]::OrdinalIgnoreCase)){([Security.Principal.SecurityIdentifier]::new($nativeUser)).Value}else{([Security.Principal.NTAccount]::new($nativeUser)).Translate([Security.Principal.SecurityIdentifier]).Value}
 if($nativeSid -cne 'S-1-5-18' -or [int]$definition.Principal.LogonType -ne 5 -or [int]$definition.Principal.RunLevel -ne 1){Stop-J 'J_TASK_NATIVE_PRINCIPAL_CHANGED'}
 # ServiceAccount is the COM enum5, not a valid Task XML LogonType value.
 $logon=$actual.SelectSingleNode('/t:Task/t:Principals/t:Principal/t:LogonType',$ns)
 if($null -ne $logon){Stop-J 'J_TASK_XML_LOGON_NODE_FORBIDDEN'}
 foreach($p in @(@('MultipleInstancesPolicy','IgnoreNew'),@('AllowStartOnDemand','true'),@('Enabled','true'),@('AllowHardTerminate','false'),@('StartWhenAvailable','false'),@('WakeToRun','false'),@('ExecutionTimeLimit','PT2M'),@('DisallowStartIfOnBatteries','false'),@('StopIfGoingOnBatteries','false'),@('RunOnlyIfNetworkAvailable','false'),@('Hidden','false'))){if((Value-J ('/t:Task/t:Settings/t:'+$p[0])) -cne $p[1]){Stop-J 'J_TASK_SETTINGS_CHANGED'}}
 if($actual.SelectNodes('/t:Task/t:Settings/t:RestartOnFailure',$ns).Count -ne 0){Stop-J 'J_TASK_RESTART_FORBIDDEN'}
}
try{
 $program=[Environment]::GetFolderPath('ProgramFiles')+'\ChatGPTRemoteCommander\owner-auth';$state=[Environment]::GetFolderPath('CommonApplicationData')+'\ChatGPTRemoteCommander\owner-auth';$taskName='ChatGPTRemoteCommanderOwnerIssuerV1'
 $script:phase='ReadIOwner';$original=[IO.File]::ReadAllText($state+'\enrollment.intent.json')|ConvertFrom-Json
 $id=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=[Security.Principal.WindowsPrincipal]::new($id)
 if($id.User.Value -cne $original.ownerSid -or -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){Stop-J 'J_SAME_OWNER_ADMIN_REQUIRED'}
 $script:phase='ConnectTaskService';$service=New-Object -ComObject 'Schedule.Service';$service.Connect();$folder=$service.GetFolder('\')
 function Existing-JTask{try{return $folder.GetTask($taskName)}catch{$x=$_.Exception;while($null -ne $x.InnerException){$x=$x.InnerException};if($x.HResult -eq -2147024894){return $null};throw}}
 if($Operation -ceq 'inspect'){if($null -eq (Existing-JTask)){'{"status":"TASK_ABSENT_NO_MUTATION"}'}else{'{"status":"TASK_PRESENT_STOP_NO_MUTATION"}'};exit 0}
 if($Operation -ceq 'rollback' -and $null -eq (Existing-JTask)){'{"status":"TASK_ABSENT_DEACTIVATED_FILES_KEYS_PRESERVED"}';exit 0}
 $script:phase='ReadJInputs';if(-not([IO.File]::Exists($state+'\finalization-j.intent.json') -and [IO.File]::Exists($state+'\task-j.prepared.json'))){Stop-J 'J_TASK_OWNERSHIP_EVIDENCE_REQUIRED'}
 $intent=[IO.File]::ReadAllText($state+'\finalization-j.intent.json')|ConvertFrom-Json;$prepared=[IO.File]::ReadAllText($state+'\task-j.prepared.json')|ConvertFrom-Json
 if($intent.ownerSid -cne $original.ownerSid -or $intent.enrollmentId -cne $original.enrollmentId -or $intent.bundleSha256 -cne $original.bundleSha256){Stop-J 'J_ORIGINAL_BINDING_CHANGED'}
 if($prepared.jId -cne $intent.jId -or $prepared.bundleSha256 -cne $intent.bundleSha256 -or $prepared.ownerSid -cne $intent.ownerSid -or $prepared.enrollmentId -cne $intent.enrollmentId -or $prepared.taskName -cne ('\'+$taskName)){Stop-J 'J_PREPARED_BINDING'}
 $description='Remote Commander owner selftest issuer J; bundle='+$intent.bundleSha256+'; enrollment='+$intent.enrollmentId+'; finalization='+$intent.jId
 $sddl='O:BAG:BAD:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGX;;;'+$intent.ownerSid+')';if($prepared.sddl -cne $sddl){Stop-J 'J_SDDL_INPUT_CHANGED'}
 function Verify-JTask($task){Assert-JDefinition $task.Definition $task.Xml $description ($program+'\CommanderNativeIssuer.exe') ([Environment]::SystemDirectory);if((Canonical-JSddl ($task.GetSecurityDescriptor(7))) -cne (Canonical-JSddl $sddl)){Stop-J 'J_TASK_SDDL_CHANGED'};return $true}
 if($Operation -ceq 'finalize'){
  $script:phase='RequireTaskAbsent';if($null -ne (Existing-JTask)){Stop-J 'J_TASK_ALREADY_EXISTS_NO_OVERWRITE'}
  $script:phase='InMemoryDefinition';$definition=$service.NewTask(0);$definition.XmlText=$prepared.xml;Assert-JDefinition $definition $definition.XmlText $description ($program+'\CommanderNativeIssuer.exe') ([Environment]::SystemDirectory)
  $script:phase='CreateOnlyTask';$task=$folder.RegisterTask($taskName,$prepared.xml,18,'SYSTEM',$null,5,$sddl)
  $script:phase='ReadbackTask';$task=Existing-JTask;if($null -eq $task){Stop-J 'J_TASK_READBACK_ABSENT_UNCERTAIN'};$null=Verify-JTask $task
  if([int]$task.State -ne 3 -or [int]$task.GetInstances(0).Count -ne 0){Stop-J 'J_NEW_TASK_NOT_IDLE_NO_STOP'}
  @{schema='RC_OWNER_J_TASK_ATTESTED_V1';status='TASK_CREATED_ATTESTED_NOT_STARTED';taskName='\'+$taskName;jId=$intent.jId;xml=$task.Xml;sddl=$task.GetSecurityDescriptor(7);nativeSystemSid='S-1-5-18';nativeLogonType=[int]$task.Definition.Principal.LogonType;started=$false}|ConvertTo-Json -Compress
 }else{
  $script:phase='RollbackInspect';$task=Existing-JTask;$matches=$false;$taskState=0;$instances=0
  if($null -ne $task){$taskState=[int]$task.State;$instances=[int]$task.GetInstances(0).Count;$null=Verify-JTask $task;$matches=$true}
  $plan=Select-JRollbackPlan $true $true ([IO.File]::Exists($state+'\task-j.registration.intent.json')) ($null -ne $task) $matches $taskState $instances
  if($plan -ceq 'ALREADY_DEACTIVATED'){'{"status":"TASK_ABSENT_DEACTIVATED_FILES_KEYS_PRESERVED"}';exit 0}
  $script:phase='RollbackRecheck';$task=Existing-JTask;if($null -eq $task){'{"status":"TASK_ABSENT_DEACTIVATED_FILES_KEYS_PRESERVED"}';exit 0};$null=Verify-JTask $task;$null=Select-JRollbackPlan $true $true $true $true $true ([int]$task.State) ([int]$task.GetInstances(0).Count)
  $script:phase='DeleteExactIdleTask';$folder.DeleteTask($taskName,0)
  $script:phase='RollbackReadback';if($null -ne (Existing-JTask)){Stop-J 'J_TASK_DELETE_UNCERTAIN_NO_RETRY'}
  '{"status":"TASK_REMOVED_FILES_KEYS_PRESERVED"}'
 }
}catch{
 $top=$_.Exception;$primary=$top;while($null -ne $primary.InnerException){$primary=$primary.InnerException};$code='J_TASK_COM_OR_HELPER_FAILURE';if($null -ne $top.Data['code']){$code=[string]$top.Data['code']}
 $hr=[int]$primary.HResult;$u=[BitConverter]::ToUInt32([BitConverter]::GetBytes($hr),0)
 $out=@{schema='RC_OWNER_J_HELPER_ERROR_V1';code=$code;phase=$script:phase;hresult=$hr;hresultHex=('0x'+$u.ToString('X8'));exceptionType=$primary.GetType().Name;automaticRetryAllowed=$false}
 [Console]::Error.WriteLine(($out|ConvertTo-Json -Compress));exit 2
}
