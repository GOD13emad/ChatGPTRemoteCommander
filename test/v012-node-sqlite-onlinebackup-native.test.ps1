# Bounded Windows CI proof for Node built-in SQLite consistent snapshot with uncommitted WAL writer.
# No real Commander profile is touched.
$ErrorActionPreference='Stop'
if($env:OS -ne 'Windows_NT'){throw 'V012_SQLITE_FIXTURE_WINDOWS_ONLY'}
$script=Join-Path (Split-Path -Parent $PSScriptRoot) 'tools\v012-sqlite-onlinebackup-qa.mjs'
if(-not (Test-Path -LiteralPath $script -PathType Leaf)){throw 'V012_SQLITE_QA_SCRIPT_MISSING'}
$who=[Security.Principal.WindowsIdentity]::GetCurrent().User
$parent=Join-Path $env:LOCALAPPDATA 'CommanderV2\migration-private'
function Assert-Private([string]$p){
  $a=Get-Acl -LiteralPath $p -ErrorAction Stop
  if(-not $a.AreAccessRulesProtected -or
    $a.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $who.Value -or
    @($a.Access).Count -ne 1 -or
    $a.Access[0].IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $who.Value){
    throw 'V012_SQLITE_QA_PRIVATE_ACL_NOT_PROVED'
  }
}
function Set-Private([string]$p,[bool]$folder){
  $a=Get-Acl -LiteralPath $p
  $a.SetAccessRuleProtection($true,$false)
  foreach($rule in @($a.Access)){[void]$a.RemoveAccessRuleSpecific($rule)}
  $a.SetOwner($who)
  $inh=if($folder){
    [Security.AccessControl.InheritanceFlags]::ObjectInherit -bor [Security.AccessControl.InheritanceFlags]::ContainerInherit
  }else{[Security.AccessControl.InheritanceFlags]::None}
  $rule=[Security.AccessControl.FileSystemAccessRule]::new($who,[Security.AccessControl.FileSystemRights]::FullControl,$inh,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
  [void]$a.AddAccessRule($rule)
  Set-Acl -LiteralPath $p -AclObject $a -ErrorAction Stop
  Assert-Private $p
}
if(Test-Path -LiteralPath $parent){Assert-Private $parent}
else{
  [void](New-Item -ItemType Directory -Path $parent -Force -ErrorAction Stop)
  Set-Private $parent $true
}
$dest=Join-Path $parent ('v012-sqlite-fixture-'+[guid]::NewGuid().ToString('N'))
if(Test-Path -LiteralPath $dest){throw 'V012_SQLITE_QA_COLLISION'}
[void](New-Item -ItemType Directory -Path $dest -ErrorAction Stop)
try{
  Set-Private $dest $true
  & node $script fixture $dest
  if($LASTEXITCODE -ne 0){throw 'V012_SQLITE_QA_NODE_FAILED'}
  $receiptFile=Join-Path $dest 'receipt.json'
  Set-Private $receiptFile $false
  $r=(Get-Content -LiteralPath $receiptFile -Raw)|ConvertFrom-Json
  if($r.schema -ne 1 -or $r.mode -ne 'fixture' -or
     $r.sqliteIntegrity -ne 'PASS' -or
     $r.disposableRestore -ne 'PASS' -or
     $r.sqliteOnlineBackup -ne 'PASS' -or
     $r.sourceModifiedByTool -ne $false -or
     $r.fullOwnerStateCovered -ne $false -or
     $r.installedCutoverAuthorized -ne $false){
    throw 'V012_SQLITE_QA_RECEIPT_SCOPE_MISMATCH'
  }
  $rem=@(Get-ChildItem -LiteralPath $dest -Force -ErrorAction Stop)
  if($rem.Count -ne 1 -or $rem[0].Name -ne 'receipt.json'){
    throw 'V012_SQLITE_QA_SOURCE_WAL_BACKUP_NOT_CLEANED'
  }
  'V012_NODE_SQLITE_WAL_FIXTURE_PASS uncommittedRowsExcluded=True integrity=PASS offlineRestore=PASS privateACL=PASS'
}finally{
  if(Test-Path -LiteralPath $dest){
    Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction Stop
  }
  if(Test-Path -LiteralPath $dest){throw 'V012_SQLITE_QA_FIXTURE_REMAINS'}
}
