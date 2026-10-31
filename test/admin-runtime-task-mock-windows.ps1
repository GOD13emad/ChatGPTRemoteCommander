param([string]$SourcePath='')
$ErrorActionPreference='Stop'
$src=if($SourcePath){[IO.Path]::GetFullPath($SourcePath)}else{Join-Path (Split-Path -Parent $PSScriptRoot) 'desktop\admin-runtime-windows.ps1'}
if(-not(Test-Path -LiteralPath $src -PathType Leaf)){throw 'SOURCE_MISSING'}
$qa=Join-Path ([IO.Path]::GetTempPath()) ('rc-admin-probe-mock-'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($qa) | Out-Null
$hash=(Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash
$source=[IO.File]::ReadAllText($src)
$allTok=$null;$allErr=$null
[Management.Automation.Language.Parser]::ParseFile($src,[ref]$allTok,[ref]$allErr)|Out-Null
if($allErr.Count){throw 'SOURCE_PARSE_FAILED'}
$match=[regex]::Match($source,'(?s)function Install-ElevatedRuntime \{.*?(?=\r?\nfunction Remove-ElevatedRuntime \{)')
if(-not $match.Success){throw 'INSTALL_FN_NOT_FOUND'}
$script:TaskName='ChatGPTRemoteCommander-ElevatedRuntime'
$script:CoreRoot=$qa
$script:Entry=Join-Path $qa 'test-entry.ps1'
[IO.File]::WriteAllText($script:Entry,'# isolated fixture')
$script:AdminDir=Join-Path $qa 'isolated-admin-mock'
$script:StateFile=Join-Path $script:AdminDir 'state.json'
$script:ProbeFile=Join-Path $script:AdminDir 'last-entry.json'
$script:RunKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$script:RunName='ChatGPTRemoteCommander'
$script:Tasks=@{}
$script:Events=[System.Collections.Generic.List[string]]::new()
$script:ProbeBehavior='success'
$script:Foreign=$false
$script:LegacyRun=$false
function Test-Elevated {return $true}
function Get-PwshPath {return 'C:\Program Files\PowerShell\7\pwsh.exe'}
function Get-RunState {return [pscustomobject]@{present=[bool]$script:LegacyRun;value=if($script:LegacyRun){'legacy-test'}else{$null}}}
function Get-TaskState {
 if($script:Foreign){return [pscustomobject]@{installed=$true;valid=$false;taskName=$script:TaskName}}
 if($script:Tasks.ContainsKey($script:TaskName)){return [pscustomobject]@{installed=$true;valid=$true;taskName=$script:TaskName}}
 return [pscustomobject]@{installed=$false;valid=$false;taskName=$script:TaskName}
}
function Write-JsonAtomic([string]$Path,[object]$Value){
 [IO.Directory]::CreateDirectory((Split-Path -Parent $Path))|Out-Null
 [IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
}
function Read-Json([string]$Path){
 if(-not(Test-Path -LiteralPath $Path)){return $null}
 return Get-Content -LiteralPath $Path -Raw|ConvertFrom-Json
}
function New-ScheduledTaskAction {
 param([string]$Execute,[string]$Argument,[string]$WorkingDirectory)
 return [pscustomobject]@{Execute=$Execute;Arguments=$Argument;WorkingDirectory=$WorkingDirectory}
}
function New-ScheduledTaskTrigger {param([switch]$AtLogOn,[string]$User);return [pscustomobject]@{AtLogOn=$AtLogOn;User=$User}}
function New-ScheduledTaskPrincipal {param([string]$UserId,[string]$LogonType,[string]$RunLevel)
 return [pscustomobject]@{UserId=(($UserId -split '\\')[-1]);LogonType=$LogonType;RunLevel=$RunLevel}
}
function New-ScheduledTaskSettingsSet {param([switch]$StartWhenAvailable,[string]$MultipleInstances,[timespan]$ExecutionTimeLimit)
 return [pscustomobject]@{StartWhenAvailable=$StartWhenAvailable;MultipleInstances=$MultipleInstances}
}
function Register-ScheduledTask {
 param([string]$TaskName,$Action,$Trigger,$Principal,$Settings,[switch]$Force)
 if($script:Tasks.ContainsKey($TaskName)){throw 'SIMULATED_TASK_CONFLICT'}
 $script:Events.Add('REGISTER:'+ $TaskName)
 $script:Tasks[$TaskName]=[pscustomobject]@{Actions=@($Action);Triggers=@($Trigger);Principal=$Principal}
}
function Get-ScheduledTask {param([string]$TaskName)
 if($script:Tasks.ContainsKey($TaskName)){return $script:Tasks[$TaskName]}
 return $null
}
function Unregister-ScheduledTask {param([string]$TaskName,[switch]$Confirm)
 $script:Events.Add('UNREGISTER:'+ $TaskName)
 [void]$script:Tasks.Remove($TaskName)
}
function Start-ScheduledTask {param([string]$TaskName)
 $script:Events.Add('START:'+ $TaskName)
 if($TaskName -eq $script:TaskName){throw 'QA_PRODUCTION_START_FORBIDDEN'}
 if(-not $script:Tasks.ContainsKey($TaskName)){throw 'QA_PROBE_NOT_REGISTERED'}
 $user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
 $obj=[ordered]@{at=(Get-Date).ToUniversalTime().ToString('o');elevated=($script:ProbeBehavior -eq 'success');probeOnly=$true;user=$user;appRoot=$script:CoreRoot}
 [IO.File]::WriteAllText($script:ProbeFile,($obj|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
}
function Start-Sleep {param([int]$Milliseconds);return}
try{
$owner=[regex]::Match($source,'(?s)function Test-TaskOwnerSID\(.*?(?=\r?\nfunction Get-TaskState \{)')
if(-not $owner.Success){throw 'SID_HELPER_MISSING'}
Invoke-Expression $owner.Value
$current=[Security.Principal.WindowsIdentity]::GetCurrent()
$short=($current.Name -split '\\')[-1]
if(-not(Test-TaskOwnerSID $current.Name) -or -not(Test-TaskOwnerSID $short) -or
   -not(Test-TaskOwnerSID $current.User.Value) -or
   (Test-TaskOwnerSID 'NT AUTHORITY\LOCAL SERVICE')){throw 'SID_HELPER_ALIAS_TEST_FAILED'}
'CASE0_PASS: SID_NORMALIZATION_FULL_SHORT_SID_NEGATIVE'
$timestampFn=[regex]::Match($source,'(?s)function Test-ProbeFreshness\(.*?(?=\r?\nfunction Get-TaskState \{)')
if(-not $timestampFn.Success){throw 'TIMESTAMP_HELPER_MISSING'}
Invoke-Expression $timestampFn.Value
$record='{"at":"2026-10-31T00:59:14.1234567Z"}' | ConvertFrom-Json
$before=[DateTimeOffset]::Parse('2026-10-31T00:59:13.0000000Z')
$after=[DateTimeOffset]::Parse('2026-10-31T00:59:16.0000000Z')
if($record.at -isnot [DateTime] -or
   -not(Test-ProbeFreshness $record.at $before) -or
   (Test-ProbeFreshness $record.at $after) -or
   (Test-ProbeFreshness '10/31/2026 00:59:14' $before) -or
   (Test-ProbeFreshness $null $before) -or
   (Test-ProbeFreshness ([DateTime]::SpecifyKind([datetime]$record.at,[DateTimeKind]::Unspecified)) $before)){
  throw 'UTC_TIMESTAMP_FRESHNESS_TEST_FAILED'
}
'CASE0B_PASS: UTC_TYPED_RECEIPT_AND_STALE_REJECTION'
Invoke-Expression $match.Value
$null=Install-ElevatedRuntime
if(-not $script:Tasks.ContainsKey($script:TaskName)){throw 'CASE1_NO_PRODUCTION_REGISTER'}
if(@($script:Events|Where-Object{$_ -eq 'START:'+ $script:TaskName}).Count -gt 0){throw 'CASE1_PRODUCTION_STARTED'}
if(@($script:Tasks.Keys|Where-Object{$_ -like '*-Probe-*'}).Count -gt 0){throw 'CASE1_ORPHAN_PROBE'}
$ev=@($script:Events)
$probeRetire=@($ev|Where-Object{$_ -like 'UNREGISTER:*-Probe-*'})[0]
$prodRegister='REGISTER:'+$script:TaskName
if($ev.IndexOf($probeRetire) -lt 0 -or $ev.IndexOf($prodRegister) -le $ev.IndexOf($probeRetire)){throw 'CASE1_BAD_ORDER'}
'CASE1_PASS: PROBE_ONLY_REGISTER_RETIRE_PRODUCTION_REGISTER_NO_START'
$before=$script:Events.Count
$null=Install-ElevatedRuntime
if($script:Events.Count -ne $before){throw 'CASE2_DUPLICATE_EFFECT'}
'CASE2_PASS: IDEMPOTENT_ALREADY_INSTALLED'
$script:LegacyRun=$true
$before=$script:Events.Count
$blocked=$false
try{$null=Install-ElevatedRuntime}catch{if($_.Exception.Message -eq 'ADMIN_RUNTIME_DUAL_AUTOSTART_CONFLICT'){$blocked=$true}else{throw}}
if(-not $blocked -or $script:Events.Count -ne $before){throw 'CASE2B_DUAL_STARTUP_NOT_BLOCKED'}
$script:LegacyRun=$false
'CASE2B_PASS: VALID_TASK_WITH_LEGACY_STARTUP_FAILS_CLOSED'
[void]$script:Tasks.Remove($script:TaskName)
$script:Foreign=$true;$before=$script:Events.Count
$denied=$false
try{$null=Install-ElevatedRuntime}catch{if($_.Exception.Message -eq 'ADMIN_RUNTIME_TASK_CONFLICT'){$denied=$true}else{throw}}
if(-not $denied -or $script:Events.Count -ne $before){throw 'CASE3_FOREIGN_TASK_MUTATION'}
'CASE3_PASS: FOREIGN_TASK_REJECTED_NO_MUTATION'
$script:Foreign=$false;$script:ProbeBehavior='denied';$before=$script:Events.Count
$failed=$false
try{$null=Install-ElevatedRuntime}catch{if($_.Exception.Message -eq 'ADMIN_RUNTIME_ELEVATED_PROBE_FAILED'){$failed=$true}else{throw}}
if(-not $failed){throw 'CASE4_PROBE_DENIAL_NOT_REJECTED'}
if($script:Tasks.Count -ne 0){throw 'CASE4_TASK_LEAK'}
if(@($script:Events|Where-Object{$_ -eq 'START:'+$script:TaskName}).Count -gt 0){throw 'CASE4_PRODUCTION_START'}
'CASE4_PASS: DENIED_PROBE_NO_PRODUCTION_CLEANUP'
"QA_PASS seven cases; SHA256=$hash"
}finally{
  $canonical=[IO.Path]::GetFullPath($qa)
  $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
  if(-not $canonical.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or
     -not (Split-Path $canonical -Leaf).StartsWith('rc-admin-probe-mock-')){
    throw 'QA_CLEANUP_SCOPE_REJECTED'
  }
  Remove-Item -LiteralPath $canonical -Recurse -Force -ErrorAction Stop
}
