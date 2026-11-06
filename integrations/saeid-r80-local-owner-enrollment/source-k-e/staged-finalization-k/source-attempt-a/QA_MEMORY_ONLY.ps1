param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Fixture)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$tokens=$null;$parseErrors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($Source,[ref]$tokens,[ref]$parseErrors);if($parseErrors.Count){throw 'SOURCE_PARSE'}
$allowed=@('Stop-K','Select-KRollbackPlan','Canonical-KSddl','Assert-KDefinition')
foreach($name in $allowed){$f=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true));if($f.Count -ne 1){throw 'FUNCTION_BINDING'};Invoke-Expression $f[0].Extent.Text}
$pass=0;$errors=@();function Test-K([string]$name,[scriptblock]$body){try{&$body;$script:pass++}catch{$script:errors+=($name+':'+$_.Exception.Message)}}
function Need-K([bool]$v){if(-not $v){throw 'QA_ASSERTION'}}
Test-K 'partial-no-intent-absent' {Need-K ((Select-KRollbackPlan $false $false $false $false $false 0 0) -ceq 'ALREADY_DEACTIVATED')}
Test-K 'partial-intent-only-absent' {Need-K ((Select-KRollbackPlan $true $false $false $false $false 0 0) -ceq 'ALREADY_DEACTIVATED')}
Test-K 'partial-plan-only-absent' {Need-K ((Select-KRollbackPlan $true $true $false $false $false 0 0) -ceq 'ALREADY_DEACTIVATED')}
foreach($flags in @(@($false,$true,$true),@($true,$false,$true),@($true,$true,$false))){$f=$flags;Test-K 'present-missing-proof-denied' {try{$null=Select-KRollbackPlan $f[0] $f[1] $f[2] $true $true 3 0;throw 'DENIAL_MISSING'}catch{Need-K ($_.Exception.Message -ne 'DENIAL_MISSING')}}}
Test-K 'changed-definition-denied' {try{$null=Select-KRollbackPlan $true $true $true $true $false 3 0;throw 'DENIAL_MISSING'}catch{Need-K ($_.Exception.Message -ne 'DENIAL_MISSING')}}
foreach($state in @(0,2,4,9)){$s=$state;Test-K 'active-unknown-no-stop' {try{$null=Select-KRollbackPlan $true $true $true $true $true $s 0;throw 'DENIAL_MISSING'}catch{Need-K ($_.Exception.Message -ne 'DENIAL_MISSING')}}}
Test-K 'instance-no-stop' {try{$null=Select-KRollbackPlan $true $true $true $true $true 3 1;throw 'DENIAL_MISSING'}catch{Need-K ($_.Exception.Message -ne 'DENIAL_MISSING')}}
foreach($state in @(1,3)){$s=$state;Test-K 'exact-idle-owned-removal-selected' {Need-K ((Select-KRollbackPlan $true $true $true $true $true $s 0) -ceq 'REMOVE_EXACT_IDLE_K_TASK')}}
$fixtureData=[IO.File]::ReadAllText($Fixture)|ConvertFrom-Kson
$service=New-Object -ComObject 'Schedule.Service';$service.Connect()
$native=$service.NewTask(0)
Test-K 'actual-memory-COM-corrected-XML' {$native.XmlText=$fixtureData.xml;Assert-KDefinition $native $native.XmlText $fixtureData.description $fixtureData.host $fixtureData.system}
Test-K 'native-SYSTEM-logon5' {Need-K ([int]$native.Principal.LogonType -eq 5);$sid=([Security.Principal.NTAccount]::new([string]$native.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value;Need-K ($sid -ceq 'S-1-5-18')}
$oldHr=$null
Test-K 'actual-memory-COM-old-invalid-schema-denied' {try{$old=$service.NewTask(0);$old.XmlText=$fixtureData.oldXml;throw 'DENIAL_MISSING'}catch{$x=$_.Exception;while($null -ne $x.InnerException){$x=$x.InnerException};$script:oldHr=[int]$x.HResult;Need-K ($script:oldHr -eq -2147216616)}}
Test-K 'changed-action-denied' {$changed=$service.NewTask(0);$changed.XmlText=$fixtureData.xml.Replace('--serve-once','--other');try{Assert-KDefinition $changed $changed.XmlText $fixtureData.description $fixtureData.host $fixtureData.system;throw 'DENIAL_MISSING'}catch{Need-K ($_.Exception.Message -ne 'DENIAL_MISSING')}}
Test-K 'changed-hardterminate-denied' {$changed=$service.NewTask(0);$changed.XmlText=$fixtureData.xml.Replace('<AllowHardTerminate>false','<AllowHardTerminate>true');try{Assert-KDefinition $changed $changed.XmlText $fixtureData.description $fixtureData.host $fixtureData.system;throw 'DENIAL_MISSING'}catch{Need-K ($_.Exception.Message -ne 'DENIAL_MISSING')}}
Test-K 'canonical-exact-SDDL-only' {$expected='O:BAG:BAD:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGX;;;'+$fixtureData.owner+')';Need-K ((Canonical-KSddl $expected) -ceq (Canonical-KSddl $expected));Need-K ((Canonical-KSddl $expected) -cne (Canonical-KSddl ($expected.Replace('GRGX','GA'))))}
@{schema='r80-k-actual-memory-com-and-partial-rollback-qa-v1';pass=$pass;fail=$errors.Count;errors=$errors;invalidLegacyHResult=$oldHr;taskRegistered=$false;taskStarted=$false;taskEnumerated=$false;installedStageOpened=$false}|ConvertTo-Kson -Compress
if($errors.Count){exit 2}
