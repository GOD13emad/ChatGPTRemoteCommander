param([Parameter(Mandatory)][string]$Source)
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($Source,[ref]$tokens,[ref]$errors)
if(@($errors).Count -ne 0){throw 'SOURCE_PARSE_FAILED'}
$fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-TunnelProcess'},$true)
if(-not $fn){throw 'PROCESS_FUNCTION_MISSING'}
. ([scriptblock]::Create($fn.Extent.Text))
$runtime='C:\Trusted\Runtime\tunnel-client-runtime.exe'
$full='C:\Trusted\Legacy\tunnel-client.exe'
$other='C:\Untrusted\tunnel-client-runtime.exe'
$script:records=@(
 [pscustomobject]@{Name='tunnel-client-runtime.exe';ExecutablePath=$other;CommandLine=('"'+$other+'" run --profile alpha');ProcessId=105},
 [pscustomobject]@{Name='tunnel-client-runtime.exe';ExecutablePath=$runtime;CommandLine=('"'+$runtime+'" run --profile beta');ProcessId=106},
 [pscustomobject]@{Name='tunnel-client-runtime.exe';ExecutablePath=$runtime;CommandLine=('"'+$runtime+'" run --profile alpha');ProcessId=201},
 [pscustomobject]@{Name='tunnel-client.exe';ExecutablePath=$full;CommandLine=('"'+$full+'" run --profile alpha');ProcessId=202}
)
$script:filterSeen=''
function Get-CimInstance {
 param([Parameter(Position=0)][string]$ClassName,[string]$Filter)
 if($ClassName -ne 'Win32_Process'){throw 'WRONG_CLASS'}
 $script:filterSeen=$Filter
 $m=[regex]::Match($Filter,"^Name='([^']+)'$")
 if(-not $m.Success){throw 'UNSAFE_FILTER'}
 $name=$m.Groups[1].Value
 return @($script:records|Where-Object{$_.Name -eq $name})
}
$one=Get-TunnelProcess 'alpha' $runtime
if($null -eq $one -or $one.ProcessId -ne 201 -or $script:filterSeen -ne "Name='tunnel-client-runtime.exe'"){throw 'RUNTIME_IDENTITY_BAD'}
$two=Get-TunnelProcess 'alpha' $full
if($null -eq $two -or $two.ProcessId -ne 202 -or $script:filterSeen -ne "Name='tunnel-client.exe'"){throw 'FULL_IDENTITY_BAD'}
$none=Get-TunnelProcess 'gamma' $runtime
if($null -ne $none){throw 'OTHER_PROFILE_ACCEPTED'}
$alien=Get-TunnelProcess 'alpha' 'C:\Other\tunnel-client-runtime.exe'
if($null -ne $alien){throw 'OTHER_PATH_ACCEPTED'}
$rejected=$false
try{$null=Get-TunnelProcess 'alpha' 'C:\Other\unsupported.exe'}catch{$rejected=$true}
if(-not $rejected){throw 'UNSUPPORTED_EXECUTABLE_ACCEPTED'}
'EXACT_RUNTIME_PROCESS_MATCH_PASS'
