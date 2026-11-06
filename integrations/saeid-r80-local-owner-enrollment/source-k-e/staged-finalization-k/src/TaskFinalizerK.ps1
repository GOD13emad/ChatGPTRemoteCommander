param([Parameter(Mandatory=$true)][ValidateSet('roots','inspect','finalize','rollback')][string]$Operation,[Parameter(Mandatory=$true)][string]$ExpectedProgramRoot,[Parameter(Mandatory=$true)][string]$ExpectedStateRoot)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$script:phase='HelperStart'
function Stop-K([string]$code){$e=[InvalidOperationException]::new($code);$e.Data['code']=$code;throw $e}
function Select-KRollbackPlan([bool]$HasIntent,[bool]$HasPrepared,[bool]$HasRegistration,[bool]$TaskPresent,[bool]$Matches,[int]$TaskState,[int]$Instances){
 if(-not $TaskPresent){return 'ALREADY_DEACTIVATED'}
 if(-not($HasIntent -and $HasPrepared -and $HasRegistration)){Stop-K 'K_TASK_OWNERSHIP_EVIDENCE_REQUIRED'}
 if(-not $Matches){Stop-K 'K_TASK_CHANGED_OR_UNKNOWN'}
 if(($TaskState -ne 1 -and $TaskState -ne 3) -or $Instances -ne 0){Stop-K 'K_TASK_ACTIVE_OR_UNKNOWN_NO_STOP'}
 return 'REMOVE_EXACT_IDLE_K_TASK'
}
function Canonical-KSddl([string]$s){$d=[Security.AccessControl.RawSecurityDescriptor]::new($s);$b=New-Object byte[] $d.BinaryLength;$d.GetBinaryForm($b,0);return [Convert]::ToBase64String($b)}
function Get-KRoots([string]$expectedProgram,[string]$expectedState){
 $p=[Environment]::GetFolderPath('ProgramFiles');$s=[Environment]::GetFolderPath('CommonApplicationData')
 foreach($root in @($p,$s,$expectedProgram,$expectedState)){if([string]::IsNullOrWhiteSpace($root) -or -not [IO.Path]::IsPathRooted($root) -or $root.Contains('%') -or $root -notmatch '^[A-Za-z]:\\'){Stop-K 'K_KNOWN_FOLDER_ROOT_REQUIRED'}}
 $program=[IO.Path]::GetFullPath($p+'\ChatGPTRemoteCommander\owner-auth');$state=[IO.Path]::GetFullPath($s+'\ChatGPTRemoteCommander\owner-auth')
 if(-not $program.Equals([IO.Path]::GetFullPath($expectedProgram),[StringComparison]::OrdinalIgnoreCase) -or -not $state.Equals([IO.Path]::GetFullPath($expectedState),[StringComparison]::OrdinalIgnoreCase)){Stop-K 'K_NATIVE_CHILD_ROOT_DISAGREEMENT'}
 return @{programRoot=$program;stateRoot=$state}
}
function Assert-KDefinition($definition,[string]$xml,[string]$description,[string]$hostPath,[string]$system){
 $settings=[Xml.XmlReaderSettings]::new();$settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit;$settings.XmlResolver=$null
 $reader=[Xml.XmlReader]::Create([IO.StringReader]::new($xml),$settings);$actual=[Xml.XmlDocument]::new();$actual.XmlResolver=$null
 try{$actual.Load($reader)}finally{$reader.Dispose()}
 $ns=[Xml.XmlNamespaceManager]::new($actual.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
 function Value-K([string]$p){$n=$actual.SelectSingleNode($p,$ns);if($null -eq $n){Stop-K 'K_TASK_XML_NODE_MISSING'};return $n.InnerText}
 if((Value-K '/t:Task/t:RegistrationInfo/t:Description') -cne $description){Stop-K 'K_TASK_DESCRIPTION_CHANGED'}
 if($actual.SelectNodes('/t:Task/t:Triggers/*',$ns).Count -ne 0 -or $actual.SelectNodes('/t:Task/t:Actions/*',$ns).Count -ne 1 -or $actual.SelectNodes('/t:Task/t:Principals/t:Principal',$ns).Count -ne 1){Stop-K 'K_TASK_COUNTS_CHANGED'}
 if($actual.SelectSingleNode('/t:Task/t:Principals/t:Principal',$ns).GetAttribute('id') -cne 'System' -or $actual.SelectSingleNode('/t:Task/t:Actions',$ns).GetAttribute('Context') -cne 'System'){Stop-K 'K_TASK_CONTEXT_CHANGED'}
 if((Value-K '/t:Task/t:Actions/t:Exec/t:Command') -cne $hostPath -or (Value-K '/t:Task/t:Actions/t:Exec/t:Arguments') -cne '--serve-once' -or (Value-K '/t:Task/t:Actions/t:Exec/t:WorkingDirectory') -cne $system){Stop-K 'K_TASK_ACTION_CHANGED'}
 $nativeUser=[string]$definition.Principal.UserId
 $nativeSid=if($nativeUser.StartsWith('S-1-',[StringComparison]::OrdinalIgnoreCase)){([Security.Principal.SecurityIdentifier]::new($nativeUser)).Value}else{([Security.Principal.NTAccount]::new($nativeUser)).Translate([Security.Principal.SecurityIdentifier]).Value}
 if($nativeSid -cne 'S-1-5-18' -or [int]$definition.Principal.LogonType -ne 5 -or [int]$definition.Principal.RunLevel -ne 1){Stop-K 'K_TASK_NATIVE_PRINCIPAL_CHANGED'}
 # ServiceAccount is the COM enum5, not a valid Task XML LogonType value.
 $logon=$actual.SelectSingleNode('/t:Task/t:Principals/t:Principal/t:LogonType',$ns)
 if($null -ne $logon){Stop-K 'K_TASK_XML_LOGON_NODE_FORBIDDEN'}
 foreach($p in @(@('MultipleInstancesPolicy','IgnoreNew'),@('AllowStartOnDemand','true'),@('Enabled','true'),@('AllowHardTerminate','false'),@('StartWhenAvailable','false'),@('WakeToRun','false'),@('ExecutionTimeLimit','PT2M'),@('DisallowStartIfOnBatteries','false'),@('StopIfGoingOnBatteries','false'),@('RunOnlyIfNetworkAvailable','false'),@('Hidden','false'))){if((Value-K ('/t:Task/t:Settings/t:'+$p[0])) -cne $p[1]){Stop-K 'K_TASK_SETTINGS_CHANGED'}}
 if($actual.SelectNodes('/t:Task/t:Settings/t:RestartOnFailure',$ns).Count -ne 0){Stop-K 'K_TASK_RESTART_FORBIDDEN'}
}
try{
 $script:phase='KnownFolderRoots';$roots=Get-KRoots $ExpectedProgramRoot $ExpectedStateRoot;$program=$roots.programRoot;$state=$roots.stateRoot;$taskName='ChatGPTRemoteCommanderOwnerIssuerV1'
 if($Operation -ceq 'roots'){@{schema='RC_OWNER_K_ROOT_AGREEMENT_V1';status='NATIVE_CHILD_ROOTS_AGREE';programRoot=$program;stateRoot=$state;protectedFilesOpened=$false;taskApiCalled=$false}|ConvertTo-Json -Compress;exit 0}
 $script:phase='ReadIOwner';$original=[IO.File]::ReadAllText($state+'\enrollment.intent.json')|ConvertFrom-Json
 $id=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=[Security.Principal.WindowsPrincipal]::new($id)
 if($id.User.Value -cne $original.ownerSid -or -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){Stop-K 'K_SAME_OWNER_ADMIN_REQUIRED'}
 $script:phase='ConnectTaskService';$service=New-Object -ComObject 'Schedule.Service';$service.Connect();$folder=$service.GetFolder('\')
 function Existing-KTask{try{return $folder.GetTask($taskName)}catch{$x=$_.Exception;while($null -ne $x.InnerException){$x=$x.InnerException};if($x.HResult -eq -2147024894){return $null};throw}}
 if($Operation -ceq 'inspect'){if($null -eq (Existing-KTask)){'{"status":"TASK_ABSENT_NO_MUTATION"}'}else{'{"status":"TASK_PRESENT_STOP_NO_MUTATION"}'};exit 0}
 if($Operation -ceq 'rollback' -and $null -eq (Existing-KTask)){'{"status":"TASK_ABSENT_DEACTIVATED_FILES_KEYS_PRESERVED"}';exit 0}
 $script:phase='ReadKInputs';if(-not([IO.File]::Exists($state+'\finalization-k.intent.json') -and [IO.File]::Exists($state+'\task-k.prepared.json'))){Stop-K 'K_TASK_OWNERSHIP_EVIDENCE_REQUIRED'}
 $intent=[IO.File]::ReadAllText($state+'\finalization-k.intent.json')|ConvertFrom-Json;$prepared=[IO.File]::ReadAllText($state+'\task-k.prepared.json')|ConvertFrom-Json
 if($intent.ownerSid -cne $original.ownerSid -or $intent.enrollmentId -cne $original.enrollmentId -or $intent.bundleSha256 -cne $original.bundleSha256){Stop-K 'K_ORIGINAL_BINDING_CHANGED'}
 if($prepared.kId -cne $intent.kId -or $prepared.bundleSha256 -cne $intent.bundleSha256 -or $prepared.ownerSid -cne $intent.ownerSid -or $prepared.enrollmentId -cne $intent.enrollmentId -or $prepared.taskName -cne ('\'+$taskName)){Stop-K 'K_PREPARED_BINDING'}
 $description='Remote Commander owner selftest issuer K; bundle='+$intent.bundleSha256+'; enrollment='+$intent.enrollmentId+'; finalization='+$intent.kId
 $sddl='O:BAG:BAD:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGX;;;'+$intent.ownerSid+')';if($prepared.sddl -cne $sddl){Stop-K 'K_SDDL_INPUT_CHANGED'}
 function Verify-KTask($task){Assert-KDefinition $task.Definition $task.Xml $description ($program+'\CommanderNativeIssuer.exe') ([Environment]::SystemDirectory);if((Canonical-KSddl ($task.GetSecurityDescriptor(7))) -cne (Canonical-KSddl $sddl)){Stop-K 'K_TASK_SDDL_CHANGED'};return $true}
 if($Operation -ceq 'finalize'){
  $script:phase='RequireTaskAbsent';if($null -ne (Existing-KTask)){Stop-K 'K_TASK_ALREADY_EXISTS_NO_OVERWRITE'}
  $script:phase='InMemoryDefinition';$definition=$service.NewTask(0);$definition.XmlText=$prepared.xml;Assert-KDefinition $definition $definition.XmlText $description ($program+'\CommanderNativeIssuer.exe') ([Environment]::SystemDirectory)
  $script:phase='CreateOnlyTask';$task=$folder.RegisterTask($taskName,$prepared.xml,18,'SYSTEM',$null,5,$sddl)
  $script:phase='ReadbackTask';$task=Existing-KTask;if($null -eq $task){Stop-K 'K_TASK_READBACK_ABSENT_UNCERTAIN'};$null=Verify-KTask $task
  if([int]$task.State -ne 3 -or [int]$task.GetInstances(0).Count -ne 0){Stop-K 'K_NEW_TASK_NOT_IDLE_NO_STOP'}
  @{schema='RC_OWNER_K_TASK_ATTESTED_V1';status='TASK_CREATED_ATTESTED_NOT_STARTED';taskName='\'+$taskName;kId=$intent.kId;xml=$task.Xml;sddl=$task.GetSecurityDescriptor(7);nativeSystemSid='S-1-5-18';nativeLogonType=[int]$task.Definition.Principal.LogonType;started=$false}|ConvertTo-Json -Compress
 }else{
  $script:phase='RollbackInspect';$task=Existing-KTask;$matches=$false;$taskState=0;$instances=0
  if($null -ne $task){$taskState=[int]$task.State;$instances=[int]$task.GetInstances(0).Count;$null=Verify-KTask $task;$matches=$true}
  $plan=Select-KRollbackPlan $true $true ([IO.File]::Exists($state+'\task-k.registration.intent.json')) ($null -ne $task) $matches $taskState $instances
  if($plan -ceq 'ALREADY_DEACTIVATED'){'{"status":"TASK_ABSENT_DEACTIVATED_FILES_KEYS_PRESERVED"}';exit 0}
  $script:phase='RollbackRecheck';$task=Existing-KTask;if($null -eq $task){'{"status":"TASK_ABSENT_DEACTIVATED_FILES_KEYS_PRESERVED"}';exit 0};$null=Verify-KTask $task;$null=Select-KRollbackPlan $true $true $true $true $true ([int]$task.State) ([int]$task.GetInstances(0).Count)
  $script:phase='DeleteExactIdleTask';$folder.DeleteTask($taskName,0)
  $script:phase='RollbackReadback';if($null -ne (Existing-KTask)){Stop-K 'K_TASK_DELETE_UNCERTAIN_NO_RETRY'}
  '{"status":"TASK_REMOVED_FILES_KEYS_PRESERVED"}'
 }
}catch{
 $top=$_.Exception;$primary=$top;while($null -ne $primary.InnerException){$primary=$primary.InnerException};$code='K_TASK_COM_OR_HELPER_FAILURE';if($null -ne $top.Data['code']){$code=[string]$top.Data['code']}
 $hr=[int]$primary.HResult;$u=[BitConverter]::ToUInt32([BitConverter]::GetBytes($hr),0)
 $out=@{schema='RC_OWNER_K_HELPER_ERROR_V1';code=$code;phase=$script:phase;hresult=$hr;hresultHex=('0x'+$u.ToString('X8'));exceptionType=$primary.GetType().Name;automaticRetryAllowed=$false}
 [Console]::Error.WriteLine(($out|ConvertTo-Json -Compress));exit 2
}
