$ErrorActionPreference='Stop'
$source=Join-Path (Split-Path -Parent $PSScriptRoot) 'handoff-user-session-windows.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if(@($errors).Count -ne 0){throw 'HANDOFF_PARSER_FAILURE'}
$func=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-CommanderBusy'},$true)
if($null -eq $func){throw 'MISSING_BUSY_FUNCTION'}
. ([scriptblock]::Create($func.Extent.Text))
function Invoke-RestMethod {throw 'status transport unavailable'}
$offline=Get-CommanderBusy
if($offline.known -ne $false -or $offline.active -ne -1 -or $offline.leases -ne -1){throw 'OFFLINE_NOT_FAIL_CLOSED'}
function Invoke-RestMethod {return [pscustomobject]@{result=[pscustomobject]@{structuredContent=[pscustomobject]@{concurrency=[pscustomobject]@{};durableWorkflows=[pscustomobject]@{schedulerState=[pscustomobject]@{}}}}}}
$missing=Get-CommanderBusy
if($missing.known -ne $false){throw 'MISSING_NOT_FAIL_CLOSED'}
function Invoke-RestMethod {return [pscustomobject]@{result=[pscustomobject]@{structuredContent=[pscustomobject]@{concurrency=[pscustomobject]@{activeOperations=0};durableWorkflows=[pscustomobject]@{schedulerState=[pscustomobject]@{currentLeases=0}}}}}}
$idle=Get-CommanderBusy
if(-not $idle.known -or $idle.active -ne 0 -or $idle.leases -ne 0){throw 'VALID_IDLE_REJECTED'}
function Invoke-RestMethod {return [pscustomobject]@{result=[pscustomobject]@{structuredContent=[pscustomobject]@{concurrency=[pscustomobject]@{activeOperations=2};durableWorkflows=[pscustomobject]@{schedulerState=[pscustomobject]@{currentLeases=1}}}}}}
$busy=Get-CommanderBusy
if(-not $busy.known -or $busy.active -ne 2 -or $busy.leases -ne 1){throw 'BUSY_COUNTS_CORRUPTED'}
function Invoke-RestMethod {return [pscustomobject]@{result=[pscustomobject]@{structuredContent=[pscustomobject]@{concurrency=[pscustomobject]@{activeOperations=-1};durableWorkflows=[pscustomobject]@{schedulerState=[pscustomobject]@{currentLeases=0}}}}}}
$negative=Get-CommanderBusy
if($negative.known -ne $false){throw 'NEGATIVE_BUSY_ACCEPTED'}
'HANDOFF_IDLE_GUARD_PASS'
