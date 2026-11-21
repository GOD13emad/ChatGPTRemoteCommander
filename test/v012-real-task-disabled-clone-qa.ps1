param([Parameter(Mandatory=$true)][string]$SnapshotId)
# Current-account exact saved-task XML registration QA. Never execute the task.
$ErrorActionPreference='Stop'
if($SnapshotId -notmatch '^v012-taskxml-[a-f0-9]{32}$'){throw 'V012_TASK_CLONE_INVALID_RECEIPT_ID'}
$root=Join-Path $env:LOCALAPPDATA ("CommanderV2\migration-private\"+$SnapshotId)
$receipt=(Get-Content -LiteralPath (Join-Path $root 'receipt.json') -Raw)|ConvertFrom-Json
$manifest=(Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw)|ConvertFrom-Json
if($receipt.taskCount -ne @($manifest.entries).Count -or $receipt.originalTasksModified -ne $false){
  throw 'V012_TASK_CLONE_MANIFEST_MISMATCH'
}
$me=[Security.Principal.WindowsIdentity]::GetCurrent()
$qaName='V012-ActualXML-Disabled-'+[guid]::NewGuid().ToString('N')
$registered=$false
$beforeHash=$null;$sourceItem=$null
try{
  if(Get-ScheduledTask -TaskName $qaName -ErrorAction SilentlyContinue){
    throw 'V012_TASK_CLONE_NAME_COLLISION'
  }
  foreach($entry in $manifest.entries){
    $candidate=Get-ScheduledTask -TaskName $entry.taskName -TaskPath $entry.taskPath -ErrorAction Stop
    $principal=$candidate.Principal
    if($principal.UserId -notin @($me.User.Value,$me.Name,$env:USERNAME) -or
       [string]$principal.LogonType -ne 'Interactive' -or
       [string]$principal.RunLevel -notin @('Limited','Highest')){continue}
    $origActions=@($candidate.Actions|Where-Object {$_ -ne $null})
    if($origActions.Count -ne 1){continue}
    $file=Join-Path $root $entry.file
    $data=[IO.File]::ReadAllBytes($file)
    $savedHash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($data)).ToLowerInvariant()
    if($savedHash -ne $entry.sha256){throw 'V012_TASK_CLONE_SNAPSHOT_HASH_CHANGED'}
    $live=Export-ScheduledTask -TaskName $entry.taskName -TaskPath $entry.taskPath -ErrorAction Stop
    $liveHash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($live))).ToLowerInvariant()
    if($liveHash -ne $savedHash){continue}
    $beforeHash=$liveHash
    $sourceItem=$entry
    break
  }
  if($null -eq $sourceItem){throw 'V012_TASK_CLONE_NO_STABLE_USER_INTERACTIVE_TASK'}
  [xml]$xml=[Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes((Join-Path $root $sourceItem.file)))
  $ns=$xml.DocumentElement.NamespaceURI
  $rootNode=$xml.DocumentElement
  $triggers=$rootNode.SelectSingleNode("*[local-name()='Triggers']")
  if($null -eq $triggers){
    $triggers=$xml.CreateElement('Triggers',$ns)
    [void]$rootNode.AppendChild($triggers)
  }
  $triggers.RemoveAll()
  # A saved elevated owner-interactive task may be used as a source, but
  # the disposable QA clone must run with least privilege. The original
  # task and its security principal are never modified by this test.
  $principalNode=$rootNode.SelectSingleNode("*[local-name()='Principals']/*[local-name()='Principal']")
  if($null -eq $principalNode){throw 'V012_TASK_CLONE_PRINCIPAL_REQUIRED'}
  $runLevel=$principalNode.SelectSingleNode("*[local-name()='RunLevel']")
  if($null -eq $runLevel){
    $runLevel=$xml.CreateElement('RunLevel',$ns)
    [void]$principalNode.AppendChild($runLevel)
  }
  $runLevel.InnerText='LeastPrivilege'
  $settings=$rootNode.SelectSingleNode("*[local-name()='Settings']")
  if($null -eq $settings){throw 'V012_TASK_CLONE_NO_SETTINGS'}
  foreach($entry in @(@('Enabled','false'),@('AllowStartOnDemand','false'))){
    $node=$settings.SelectSingleNode("*[local-name()='"+$entry[0]+"']")
    if($null -eq $node){$node=$xml.CreateElement($entry[0],$ns);[void]$settings.AppendChild($node)}
    $node.InnerText=$entry[1]
  }
  $uri=$rootNode.SelectSingleNode("*[local-name()='RegistrationInfo']/*[local-name()='URI']")
  if($null -ne $uri){$uri.InnerText='\'+$qaName}
  $trCount=@($rootNode.SelectNodes("*[local-name()='Triggers']/*")).Count
  $enabled=$settings.SelectSingleNode("*[local-name()='Enabled']").InnerText
  $demand=$settings.SelectSingleNode("*[local-name()='AllowStartOnDemand']").InnerText
  if($trCount -ne 0 -or $enabled -ne 'false' -or $demand -ne 'false'){
    throw 'V012_TASK_CLONE_XML_SAFETY_PRECONDITION'
  }
  [void](Register-ScheduledTask -TaskName $qaName -Xml $xml.OuterXml -ErrorAction Stop)
  $registered=$true
  $clone=Get-ScheduledTask -TaskName $qaName -ErrorAction Stop
  $actions=@($clone.Actions|Where-Object {$_ -ne $null})
  if([string]$clone.Principal.RunLevel -ne 'Limited' -or
     [string]$clone.Principal.LogonType -ne 'Interactive' -or
     $clone.Settings.Enabled -or $clone.Settings.AllowStartOnDemand -or
     @($clone.Triggers|Where-Object {$_ -ne $null}).Count -ne 0 -or
     $actions.Count -ne 1 -or
     $actions[0].Execute -ne $origActions[0].Execute -or
     $actions[0].Arguments -ne $origActions[0].Arguments){
    throw 'V012_TASK_CLONE_RESTORED_NOT_DISABLED_OR_ACTION_DIFFERED'
  }
  'V012_REAL_XML_DISABLED_CLONE_REGISTER_PASS actionParity=True triggers=0 enabled=False onDemand=False'
}finally{
  $found=Get-ScheduledTask -TaskName $qaName -ErrorAction SilentlyContinue
  if($null -ne $found){
    if($found.Settings.Enabled -or
       @($found.Triggers|Where-Object {$_ -ne $null}).Count -ne 0){
       throw 'V012_TASK_CLONE_SAFETY_CHANGED_REFUSE_CLEANUP'
    }
    Unregister-ScheduledTask -TaskName $qaName -Confirm:$false -ErrorAction Stop
  }
  if(Get-ScheduledTask -TaskName $qaName -ErrorAction SilentlyContinue){
    throw 'V012_TASK_CLONE_RESIDUAL'
  }
  if($null -ne $sourceItem -and $null -ne $beforeHash){
    $reExport=Export-ScheduledTask -TaskName $sourceItem.taskName -TaskPath $sourceItem.taskPath -ErrorAction Stop
    $afterHash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($reExport))).ToLowerInvariant()
    if($beforeHash -ne $afterHash){throw 'V012_TASK_CLONE_SOURCE_CONFIG_CHANGED'}
  }
  'V012_REAL_XML_CLONE_RETIRED_PASS originalConfigUnchanged=True'
}
