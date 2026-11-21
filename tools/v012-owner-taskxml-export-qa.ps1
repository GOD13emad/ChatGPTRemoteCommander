# QA-only native Windows exact task configuration export to current-owner private storage.
# Never unregister, modify or start any existing task.
$ErrorActionPreference='Stop'
$ErrorView='ConciseView'
function Stop-V012([string]$code){throw "V012_TASK_BACKUP_$code"}
function Private([string]$file,[bool]$directory,[Security.Principal.SecurityIdentifier]$sid){
  $a=Get-Acl -LiteralPath $file -ErrorAction Stop
  $a.SetAccessRuleProtection($true,$false)
  foreach($old in @($a.Access)){[void]$a.RemoveAccessRuleSpecific($old)}
  $a.SetOwner($sid)
  $inherit=if($directory){[Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit}else{[Security.AccessControl.InheritanceFlags]::None}
  $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
  [void]$a.AddAccessRule($rule)
  Set-Acl -LiteralPath $file -AclObject $a -ErrorAction Stop
  $check=Get-Acl -LiteralPath $file -ErrorAction Stop
  if(-not $check.AreAccessRulesProtected -or @($check.Access).Count -ne 1 -or
     $check.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or
     $check.Access[0].IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){
     Stop-V012 'PRIVATE_ACL_NOT_PROVED'
  }
}
if($env:OS -ne 'Windows_NT'){Stop-V012 'WINDOWS_ONLY'}
$who=[Security.Principal.WindowsIdentity]::GetCurrent().User
$parent=Join-Path $env:LOCALAPPDATA 'CommanderV2\migration-private'
$pa=Get-Acl -LiteralPath $parent -ErrorAction Stop
if(-not $pa.AreAccessRulesProtected -or @($pa.Access).Count -ne 1 -or
  $pa.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $who.Value){
  Stop-V012 'PARENT_NOT_OWNER_PRIVATE'
}
$matching=@(Get-ScheduledTask -ErrorAction Stop|Where-Object {$_.TaskName -match '(?i)ChatGPT|Commander|Tunnel'}|Sort-Object TaskPath,TaskName)
if($matching.Count -lt 1 -or $matching.Count -gt 30){Stop-V012 'TASK_COUNT_NOT_BOUNDED'}
$id='v012-taskxml-'+[guid]::NewGuid().ToString('N')
$dest=Join-Path $parent $id
if(Test-Path -LiteralPath $dest){Stop-V012 'DESTINATION_COLLISION'}
$created=$false
try{
  [void](New-Item -ItemType Directory -Path $dest -ErrorAction Stop)
  $created=$true
  Private $dest $true $who
  $files=[System.Collections.Generic.List[object]]::new()
  [long]$total=0
  $index=0
  foreach($task in $matching){
    $index++
    $filename=('task-{0:D3}.xml' -f $index)
    $file=Join-Path $dest $filename
    $xml=Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction Stop
    if([string]::IsNullOrWhiteSpace($xml)){Stop-V012 'EMPTY_XML'}
    [xml]$parse=$xml
    if(@($parse.SelectNodes("//*[local-name()='Task']")).Count -ne 1){Stop-V012 'INVALID_XML'}
    $bytes=[Text.Encoding]::UTF8.GetBytes($xml)
    [IO.File]::WriteAllBytes($file,$bytes)
    Private $file $false $who
    $digest=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
    $reread=[IO.File]::ReadAllBytes($file)
    if([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($reread)).ToLowerInvariant() -ne $digest){
      Stop-V012 'XML_READBACK_MISMATCH'
    }
    $fresh=Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction Stop
    if([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($fresh))).ToLowerInvariant() -ne $digest){
      Stop-V012 'CONFIG_CHANGED_DURING_EXPORT'
    }
    $files.Add([ordered]@{
      file=$filename
      taskName=$task.TaskName
      taskPath=$task.TaskPath
      originalState=[string]$task.State
      bytes=$bytes.Length
      sha256=$digest
    })
    $total+=$bytes.Length
  }
  $manifest=[ordered]@{schema=1;scope='matching-current-owner-Commander-TaskScheduler';entries=@($files.ToArray());files=$files.Count;bytes=$total}
  $manifestJson=ConvertTo-Json -InputObject $manifest -Depth 9 -Compress
  $manifestFile=Join-Path $dest 'manifest.json'
  [IO.File]::WriteAllText($manifestFile,$manifestJson,[Text.UTF8Encoding]::new($false))
  Private $manifestFile $false $who
  $manifestHash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($manifestJson))).ToLowerInvariant()
  $reloaded=Get-Content -LiteralPath $manifestFile -Raw|ConvertFrom-Json
  if(@($reloaded.entries).Count -ne $files.Count){Stop-V012 'MANIFEST_READBACK_MISMATCH'}
  $receipt=[ordered]@{
    schema=1;snapshotId=$id;taskCount=$files.Count;xmlBytes=$total;
    manifestSha256=$manifestHash;originalTaskConfigsExported='PASS';
    privateOwnerOnlyDacl='PASS';xmlReadback='PASS';
    originalTasksModified=$false;liveTaskRestoreTested=$false;
    fullV012RollbackProved=$false;releaseAuthorized=$false
  }
  $receiptFile=Join-Path $dest 'receipt.json'
  [IO.File]::WriteAllText($receiptFile,(ConvertTo-Json -InputObject $receipt -Depth 5 -Compress),[Text.UTF8Encoding]::new($false))
  Private $receiptFile $false $who
  $complete=Get-Content -LiteralPath $receiptFile -Raw|ConvertFrom-Json
  if($complete.manifestSha256 -ne $manifestHash){Stop-V012 'RECEIPT_MISMATCH'}
  $created=$false
  'V012_TASK_CONFIG_EXPORT_RECEIPT='+((ConvertTo-Json -InputObject $receipt -Compress -Depth 5))
}catch{
  $e=$_.Exception.Message
  if($created -and (Test-Path -LiteralPath $dest)){
    Remove-Item -LiteralPath $dest -Force -Recurse -ErrorAction SilentlyContinue
  }
  if($e -like 'V012_TASK_BACKUP_*'){[Console]::Error.WriteLine($e)}
  else{[Console]::Error.WriteLine('V012_TASK_BACKUP_FAILED')}
  exit 2
}
