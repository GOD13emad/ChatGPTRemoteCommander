param([Parameter(Mandatory=$true)][string]$Script)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($Script,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'TASK_SCRIPT_PARSE_FAILURE'}
$functions=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Select-RollbackPlan'},$true))
if($functions.Count -ne 1){throw 'EXACT_PRODUCTION_SELECTOR_REQUIRED'}
# Import only the exact production decision function AST. Never execute the
# outer script, COM creation, task query or any protected file access.
. ([scriptblock]::Create($functions[0].Extent.Text))
$cases=@(
 @('intent-only-before-preparation',$false,$false,$false,0,'ALREADY_DEACTIVATED'),
 @('prepared-before-registration-intent',$false,$false,$false,0,'ALREADY_DEACTIVATED'),
 @('registration-intent-before-register',$true,$false,$false,0,'ALREADY_DEACTIVATED'),
 @('crash-after-register-before-attested',$true,$true,$true,3,'REMOVE_EXACT_IDLE_TASK'),
 @('attested-before-client-policy',$true,$true,$true,3,'REMOVE_EXACT_IDLE_TASK'),
 @('client-policy-before-completion',$true,$true,$true,3,'REMOVE_EXACT_IDLE_TASK'),
 @('completed-idle',$true,$true,$true,3,'REMOVE_EXACT_IDLE_TASK'),
 @('disabled-exact-owned',$true,$true,$true,1,'REMOVE_EXACT_IDLE_TASK'),
 @('already-deleted-no-repeat',$true,$false,$false,0,'ALREADY_DEACTIVATED'),
 @('unknown-no-registration',$false,$true,$true,3,'DENY'),
 @('changed-definition',$true,$true,$false,3,'DENY'),
 @('changed-sddl',$true,$true,$false,3,'DENY'),
 @('running-no-stop',$true,$true,$true,4,'DENY'),
 @('queued-no-stop',$true,$true,$true,2,'DENY'),
 @('unknown-task-state',$true,$true,$true,0,'DENY')
)
$pass=0;$rows=@()
foreach($c in $cases){
 $got=$null;$denied=$false
 try{$got=Select-RollbackPlan ([bool]$c[1]) ([bool]$c[2]) ([bool]$c[3]) ([int]$c[4])}
 catch{$denied=$true}
 if(($c[5] -eq 'DENY' -and $denied) -or (-not $denied -and $got -ceq $c[5])){$pass++}else{throw ('PARTIAL_SELECTION_FAILED_'+$c[0])}
 $rows+=@{name=$c[0];decision=$c[5]}
}
@{schema='RC_PARTIAL_ROLLBACK_PRODUCTION_SELECTOR_QA_V1';pass=$pass;fail=0;cases=$rows;outerScriptExecuted=$false;comCreated=$false;taskQueriedOrChanged=$false;uacOpened=$false}|ConvertTo-Json -Depth 5 -Compress
