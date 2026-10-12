#requires -Version 7.0
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# CI-only synthetic assertions for a pure identity verifier: never touches owner machines.
if($env:CI -ne 'true' -or -not $env:RUNNER_TEMP -or -not $env:GITHUB_WORKSPACE){throw 'R224_CI_ONLY'}
$scriptFile=Join-Path $env:GITHUB_WORKSPACE 'desktop\install-windows.ps1'
$src=Get-Content -LiteralPath $scriptFile -Raw -Encoding UTF8
$start=$src.IndexOf('function Assert-R224LegacyUiBaseline {')
$end=$src.IndexOf('# R224_LEGACY_VERIFIER_END',$start)
if($start -lt 0 -or $end -le $start){throw 'R224_HELPER_NOT_FOUND'}
$functionText=$src.Substring($start,$end-$start)
$tokens=$null;$errors=$null
[Management.Automation.Language.Parser]::ParseInput($functionText,[ref]$tokens,[ref]$errors)|Out-Null
if(@($errors).Count){throw 'R224_HELPER_PARSE_FAILED'}
. ([ScriptBlock]::Create($functionText))
$root=Join-Path $env:RUNNER_TEMP 'ui-legacy-r224'
if(Test-Path -LiteralPath $root){throw 'R224_NO_BLIND_RERUN'}
$names=@('RemoteCommander.exe','profile-manager-windows.ps1','operations-monitor-windows.ps1','admin-runtime-windows.ps1')
$expectedName='v0.10.14-d06f2162b54b'
$legacy=Join-Path $root $expectedName
New-Item -ItemType Directory -Path $legacy -ErrorAction Stop|Out-Null
$hashes=@{}
foreach($n in $names){
  $file=Join-Path $legacy $n
  [IO.File]::WriteAllText($file,('R224_SYNTHETIC_ONLY_'+$n),[Text.UTF8Encoding]::new($false))
  $hashes[$n]=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
}
function Accept-R224 {return (Assert-R224LegacyUiBaseline -LegacyRoot $legacy -InstallBase $root -ExpectedName $expectedName -ExpectedHashes $hashes)}
function Reject-R224([string]$id){
  $rejected=$false
  try{$null=Accept-R224}catch{$rejected=$true}
  if(-not $rejected){throw ('R224_NEGATIVE_TEST_DID_NOT_FAIL_'+$id)}
  Write-Output ('R224_'+$id+'_NEGATIVE_PASS')
}
try{
 if(-not(Accept-R224)){throw 'R224_POSITIVE_UNVERIFIED'}
 Write-Output 'R224_EXACT_4_FILE_BASELINE_POSITIVE_PASS'
 $unknown=Join-Path $legacy 'unrecognized-user.txt'
 [IO.File]::WriteAllText($unknown,'PRESERVE_USER_FILE',[Text.UTF8Encoding]::new($false))
 Reject-R224 'ADDITIONAL_UNKNOWN_USER_DATA'
 if([IO.File]::ReadAllText($unknown) -ne 'PRESERVE_USER_FILE'){throw 'R224_FIXTURE_DATA_MUTATED'}
 Remove-Item -LiteralPath $unknown -Force
 $changed=Join-Path $legacy $names[0]
 [IO.File]::AppendAllText($changed,'ALTERED')
 Reject-R224 'SHA_CHANGED'
 [IO.File]::WriteAllText($changed,('R224_SYNTHETIC_ONLY_'+$names[0]),[Text.UTF8Encoding]::new($false))
 if(-not(Accept-R224)){throw 'R224_RESTORE_FIXTURE_FAILED'}
 $unexpectedDir=Join-Path $legacy 'unknown-settings'
 New-Item -ItemType Directory -Path $unexpectedDir|Out-Null
 Reject-R224 'UNRECOGNIZED_DIRECTORY'
 Remove-Item -LiteralPath $unexpectedDir -Force
 $wrongRoot=$false
 try{$null=Assert-R224LegacyUiBaseline -LegacyRoot $legacy -InstallBase $root -ExpectedName 'v0.10.13-unapproved' -ExpectedHashes $hashes}catch{$wrongRoot=$true}
 if(-not $wrongRoot){throw 'R224_WRONG_ROOT_ACCEPTED'}
 Write-Output 'R224_WRONG_VERSION_PATH_NEGATIVE_PASS'
 if(-not(Accept-R224)){throw 'R224_FINAL_POSITIVE_FAILED'}
 Write-Output 'R224_FIVE_CASES_PASS_NO_OWNER_MUTATION'
}finally{
 $temp=[IO.Path]::GetFullPath($env:RUNNER_TEMP)
 $actual=[IO.Path]::GetFullPath($root)
 if($actual -ne (Join-Path $temp 'ui-legacy-r224')){throw 'R224_FIXTURE_DELETE_GUARD'}
 Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop
}
