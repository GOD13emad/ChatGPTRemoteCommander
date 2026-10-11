# R216: isolated native Windows update/rollback gate; hosted CI only.
# No real installation, elevation, browser profile access, uninstall, or executable launch.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$installer=Join-Path $repo 'desktop\install-windows.ps1'
if($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows'){throw 'R216_HOSTED_WINDOWS_ONLY'}
if(-not(Test-Path -LiteralPath $installer -PathType Leaf)){throw 'R216_INSTALLER_MISSING'}
$dev=Join-Path $env:USERPROFILE 'source\repos'
New-Item -ItemType Directory -Path $dev -Force|Out-Null
$root=Join-Path $dev ('RC_UI_R216_'+[guid]::NewGuid().ToString('N'))
if(Test-Path -LiteralPath $root){throw 'R216_CASE_ROOT_NOT_NEW'}
New-Item -ItemType Directory -Path $root|Out-Null
function Check([bool]$ok,[string]$why){if(-not $ok){throw ('R216_ASSERT_'+$why)}}
function NewFixture([string]$where,[string]$label){
  $p=Join-Path $where ('source-'+$label)
  New-Item -ItemType Directory -Path $p|Out-Null
  foreach($name in @('RemoteCommander.exe','profile-manager-windows.ps1','profile-enrollment-windows.ps1','operations-monitor-windows.ps1','admin-runtime-windows.ps1')){
    [IO.File]::WriteAllText((Join-Path $p $name),('R216_NOT_EXECUTABLE_'+$label+'_'+$name+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
  }
  return $p
}
function InvokeInstaller([string]$source,[string]$dest,[string]$fault='None',[bool]$private=$true){
  $psi=[Diagnostics.ProcessStartInfo]::new()
  $psi.FileName=(Get-Command pwsh.exe -ErrorAction Stop).Source
  $psi.UseShellExecute=$false
  $psi.RedirectStandardOutput=$true
  $psi.RedirectStandardError=$true
  foreach($s in @('-NoLogo','-NoProfile','-NonInteractive','-File',$installer,'-SourceDir',$source,'-InstallRoot',$dest,'-Mode','ControlMonitoring')){[void]$psi.ArgumentList.Add([string]$s)}
  if($private){[void]$psi.ArgumentList.Add('-NoPublicIntegration')}
  if($fault -ne 'None'){[void]$psi.ArgumentList.Add('-TestFailurePoint');[void]$psi.ArgumentList.Add($fault)}
  $proc=[Diagnostics.Process]::new()
  $proc.StartInfo=$psi
  Check ($proc.Start()) 'CHILD_NOT_STARTED'
  $stdout=$proc.StandardOutput.ReadToEnd()
  $stderr=$proc.StandardError.ReadToEnd()
  if(-not $proc.WaitForExit(30000)){
    try{$proc.Kill($true)}catch{}
    throw 'R216_CHILD_TIMEOUT'
  }
  return [pscustomobject]@{code=$proc.ExitCode;out=($stdout+[Environment]::NewLine+$stderr)}
}
function CurrentTarget([string]$dir){
  $e=Get-Item -LiteralPath (Join-Path $dir 'current') -Force -ErrorAction Stop
  Check ($e.LinkType -ceq 'Junction') 'CURRENT_NOT_JUNCTION'
  $t=[IO.Path]::GetFullPath([string](@($e.Target)[0]))
  Check ($t.StartsWith(($dir.TrimEnd('\')+'\'),[StringComparison]::OrdinalIgnoreCase)) 'POINTER_OUTSIDE_FIXTURE'
  return $t
}
function PublicFingerprint {
  $shortcut=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Remote Commander\Remote Commander.lnk'
  $hash=if(Test-Path -LiteralPath $shortcut -PathType Leaf){(Get-FileHash -LiteralPath $shortcut -Algorithm SHA256).Hash}else{'ABSENT'}
  $reg=Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\RemoteCommander' -ErrorAction SilentlyContinue
  $fields=if($reg){@{DisplayName=$reg.DisplayName;DisplayVersion=$reg.DisplayVersion;InstallLocation=$reg.InstallLocation;UninstallString=$reg.UninstallString}}else{$null}
  return (ConvertTo-Json -InputObject @{shortcutSHA=$hash;uninstall=$fields} -Depth 4 -Compress)
}
function NewCase([string]$name){
  $p=Join-Path $root $name
  New-Item -ItemType Directory -Path $p|Out-Null
  return [pscustomobject]@{dir=$p;install=(Join-Path $p 'install');a=(NewFixture $p 'A');b=(NewFixture $p 'B')}
}
$publicBefore=PublicFingerprint
$cases=0
foreach($fault in @('AfterBaselineMove','AfterCandidateMove')){
  $c=NewCase ('rollback-'+$fault)
  $start=InvokeInstaller $c.a $c.install
  Check ($start.code -eq 0 -and $start.out.Contains('REMOTE_COMMANDER_UI_PRIVATE_TRANSACTION_PASS')) ('FIRST_INSTALL_'+$fault)
  $baseline=CurrentTarget $c.install
  $failed=InvokeInstaller $c.b $c.install $fault
  Check ($failed.code -ne 0 -and $failed.out.Contains('R203_SWAP_ABORTED_BASELINE_PRESERVED')) ('EXPECTED_ROLLBACK_'+$fault)
  Check ((CurrentTarget $c.install).Equals($baseline,[StringComparison]::OrdinalIgnoreCase)) ('BASELINE_RESTORED_'+$fault)
  Check (Test-Path -LiteralPath (Join-Path $baseline 'RemoteCommander.exe') -PathType Leaf) ('BASELINE_PRESERVED_'+$fault)
  $cases++
}
$c=NewCase 'success-and-hash'
$first=InvokeInstaller $c.a $c.install
Check ($first.code -eq 0) 'FIRST_INSTALL'
$baseline=CurrentTarget $c.install
$update=InvokeInstaller $c.b $c.install
Check ($update.code -eq 0 -and $update.out.Contains('REMOTE_COMMANDER_UI_PRIVATE_TRANSACTION_PASS')) 'NATIVE_UPDATE'
$current=CurrentTarget $c.install
Check (-not $current.Equals($baseline,[StringComparison]::OrdinalIgnoreCase)) 'NOT_UPGRADED'
Check (Test-Path -LiteralPath (Join-Path $baseline 'product-install.json') -PathType Leaf) 'PRIOR_PAYLOAD_MISSING'
$recovery=@(Get-ChildItem -LiteralPath $c.install -Force|Where-Object{$_.Name -like 'current.rollback-*'})
Check ($recovery.Count -eq 1 -and $recovery[0].LinkType -ceq 'Junction') 'ROLLBACK_ALIAS_COUNT'
Check (([IO.Path]::GetFullPath([string](@($recovery[0].Target)[0]))).Equals($baseline,[StringComparison]::OrdinalIgnoreCase)) 'ROLLBACK_TARGET'
$repeat=InvokeInstaller $c.b $c.install
Check ($repeat.code -eq 0 -and $repeat.out.Contains('REMOTE_COMMANDER_UI_ALREADY_CURRENT_VERIFIED')) 'IDEMPOTENCE'
Check ((CurrentTarget $c.install).Equals($current,[StringComparison]::OrdinalIgnoreCase)) 'IDEMPOTENT_POINTER'
[IO.File]::AppendAllText((Join-Path $current 'RemoteCommander.exe'),'R216_TEST_TAMPER')
$drift=InvokeInstaller $c.b $c.install
Check ($drift.code -ne 0 -and $drift.out.Contains('R203_ALREADY_CURRENT_FILE_HASH_DRIFT')) 'HASH_DRIFT_REJECTED'
Check ((CurrentTarget $c.install).Equals($current,[StringComparison]::OrdinalIgnoreCase)) 'DRIFT_POINTER'
$cases++
$c=NewCase 'fault-without-private-mode'
$guard=InvokeInstaller $c.a $c.install 'AfterBaselineMove' $false
Check ($guard.code -ne 0 -and $guard.out.Contains('R203_FAULT_INJECTION_REQUIRES_ISOLATION')) 'PUBLIC_FAULT_GUARD'
Check (-not(Test-Path -LiteralPath $c.install)) 'PUBLIC_FAULT_CREATED_INSTALL'
$cases++
Check ((PublicFingerprint) -ceq $publicBefore) 'PUBLIC_SHORTCUT_OR_HKCU_MUTATED'
Write-Output ('R216_WINDOWS_NATIVE_ISOLATED_PASS cases='+$cases+' root='+$root+' publicChanges=0 browserProfilesRead=0')
