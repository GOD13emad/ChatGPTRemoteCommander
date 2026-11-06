param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Fixture)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$tokens=$null;$parseErrors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($Source,[ref]$tokens,[ref]$parseErrors);if($parseErrors.Count){throw 'SOURCE_PARSE'}
$allowed=@('Stop-J','Select-JRollbackPlan','Canonical-JSddl','Assert-JDefinition')
foreach($name in $allowed){$f=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true));if($f.Count -ne 1){throw 'FUNCTION_BINDING'};Invoke-Expression $f[0].Extent.Text}
$pass=0;$errors=@();function Test-J([string]$name,[scriptblock]$body){try{&$body;$script:pass++}catch{$script:errors+=($name+':'+$_.Exception.Message)}}
function Need-J([bool]$v){if(-not $v){throw 'QA_ASSERTION'}}
Test-J 'partial-no-intent-absent' {Need-J ((Select-JRollbackPlan $false $false $false $false $false 0 0) -ceq 'ALREADY_DEACTIVATED')}
Test-J 'partial-intent-only-absent' {Need-J ((Select-JRollbackPlan $true $false $false $false $false 0 0) -ceq 'ALREADY_DEACTIVATED')}
Test-J 'partial-plan-only-absent' {Need-J ((Select-JRollbackPlan $true $true $false $false $false 0 0) -ceq 'ALREADY_DEACTIVATED')}
foreach($flags in @(@($false,$true,$true),@($true,$false,$true),@($true,$true,$false))){$f=$flags;Test-J 'present-missing-proof-denied' {try{$null=Select-JRollbackPlan $f[0] $f[1] $f[2] $true $true 3 0;throw 'DENIAL_MISSING'}catch{Need-J ($_.Exception.Message -ne 'DENIAL_MISSING')}}}
Test-J 'changed-definition-denied' {try{$null=Select-JRollbackPlan $true $true $true $true $false 3 0;throw 'DENIAL_MISSING'}catch{Need-J ($_.Exception.Message -ne 'DENIAL_MISSING')}}
foreach($state in @(0,2,4,9)){$s=$state;Test-J 'active-unknown-no-stop' {try{$null=Select-JRollbackPlan $true $true $true $true $true $s 0;throw 'DENIAL_MISSING'}catch{Need-J ($_.Exception.Message -ne 'DENIAL_MISSING')}}}
Test-J 'instance-no-stop' {try{$null=Select-JRollbackPlan $true $true $true $true $true 3 1;throw 'DENIAL_MISSING'}catch{Need-J ($_.Exception.Message -ne 'DENIAL_MISSING')}}
foreach($state in @(1,3)){$s=$state;Test-J 'exact-idle-owned-removal-selected' {Need-J ((Select-JRollbackPlan $true $true $true $true $true $s 0) -ceq 'REMOVE_EXACT_IDLE_J_TASK')}}
$fixtureData=[IO.File]::ReadAllText($Fixture)|ConvertFrom-Json
$service=New-Object -ComObject 'Schedule.Service';$service.Connect()
$native=$service.NewTask(0)
Test-J 'actual-memory-COM-corrected-XML' {$native.XmlText=$fixtureData.xml;Assert-JDefinition $native $native.XmlText $fixtureData.description $fixtureData.host $fixtureData.system}
Test-J 'native-SYSTEM-logon5' {Need-J ([int]$native.Principal.LogonType -eq 5);$sid=([Security.Principal.NTAccount]::new([string]$native.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value;Need-J ($sid -ceq 'S-1-5-18')}
$oldHr=$null
Test-J 'actual-memory-COM-old-invalid-schema-denied' {try{$old=$service.NewTask(0);$old.XmlText=$fixtureData.oldXml;throw 'DENIAL_MISSING'}catch{$x=$_.Exception;while($null -ne $x.InnerException){$x=$x.InnerException};$script:oldHr=[int]$x.HResult;Need-J ($script:oldHr -eq -2147216616)}}
Test-J 'changed-action-denied' {$changed=$service.NewTask(0);$changed.XmlText=$fixtureData.xml.Replace('--serve-once','--other');try{Assert-JDefinition $changed $changed.XmlText $fixtureData.description $fixtureData.host $fixtureData.system;throw 'DENIAL_MISSING'}catch{Need-J ($_.Exception.Message -ne 'DENIAL_MISSING')}}
Test-J 'changed-hardterminate-denied' {$changed=$service.NewTask(0);$changed.XmlText=$fixtureData.xml.Replace('<AllowHardTerminate>false','<AllowHardTerminate>true');try{Assert-JDefinition $changed $changed.XmlText $fixtureData.description $fixtureData.host $fixtureData.system;throw 'DENIAL_MISSING'}catch{Need-J ($_.Exception.Message -ne 'DENIAL_MISSING')}}
Test-J 'canonical-exact-SDDL-only' {$expected='O:BAG:BAD:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGX;;;'+$fixtureData.owner+')';Need-J ((Canonical-JSddl $expected) -ceq (Canonical-JSddl $expected));Need-J ((Canonical-JSddl $expected) -cne (Canonical-JSddl ($expected.Replace('GRGX','GA'))))}
@{schema='r80-j-actual-memory-com-and-partial-rollback-qa-v1';pass=$pass;fail=$errors.Count;errors=$errors;invalidLegacyHResult=$oldHr;taskRegistered=$false;taskStarted=$false;taskEnumerated=$false;installedStageOpened=$false}|ConvertTo-Json -Compress
if($errors.Count){exit 2}
