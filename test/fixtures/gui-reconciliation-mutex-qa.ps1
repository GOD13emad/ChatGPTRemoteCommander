# Fixture only: Global\ QA mutex, synthetic pending file, one owned child.
# No real GUI dispatch, native incident, service, or production mutex accessed.
$ErrorActionPreference='Stop'
$name='Global\ChatGPTRemoteCommander.GuiCoord.QA.'+[guid]::NewGuid().ToString('N')
$root=Join-Path $env:TEMP ('rc-gui-mutex-fixture-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $root
$original=Join-Path $root 'pending.json'
$ready=Join-Path $root 'ready'
$exitMarker=Join-Path $root 'crash-worker'
$worker=Join-Path $root 'owned-worker.ps1'
[IO.File]::WriteAllText($original,'{"schema":"rc-gui-pending-input-v1","status":"PENDING_NATIVE_EFFECT","tool":"gui_focus_window","id":"fixture-only-keep-unknown","startedUtc":"2026-10-18T00:00:00Z"}'+[Environment]::NewLine)
$expected=(Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash
$code=@'
param([string]$name,[string]$ready,[string]$exitMarker)
$ErrorActionPreference='Stop'
$m=[Threading.Mutex]::new($false,$name)
if(-not $m.WaitOne(0)){exit 42}
[IO.File]::WriteAllText($ready,[string]$PID)
while($true) {
  if(Test-Path -LiteralPath $exitMarker) {
    # A self-terminated QA child simulates an unacknowledged worker crash.
    [Environment]::Exit(37)
  }
  Start-Sleep -Milliseconds 50
}
'@
[IO.File]::WriteAllText($worker,$code)
$anchor=[Threading.Mutex]::new($false,$name)
$child=$null
$acquired=$false
$abandoned=$false
try {
  $start=[Diagnostics.ProcessStartInfo]::new()
  $start.FileName=(Get-Command pwsh -ErrorAction Stop).Source
  $start.UseShellExecute=$false
  $start.CreateNoWindow=$true
  $start.RedirectStandardError=$true
  foreach($arg in @('-NoLogo','-NoProfile','-NonInteractive','-File',$worker,$name,$ready,$exitMarker)) {
    [void]$start.ArgumentList.Add($arg)
  }
  $child=[Diagnostics.Process]::Start($start)
  if($null -eq $child){throw 'QA_CHILD_FAILED_TO_START'}
  $seen=$false
  for($i=0;$i -lt 100;$i++){
    if(Test-Path -LiteralPath $ready){$seen=$true;break}
    if($child.HasExited){throw ('QA_CHILD_EARLY_EXIT:'+ $child.ExitCode)}
    Start-Sleep -Milliseconds 70
  }
  if(-not $seen){throw 'QA_CHILD_READY_TIMEOUT'}
  $whileHeld=$anchor.WaitOne(0)
  if($whileHeld){$anchor.ReleaseMutex();throw 'GLOBAL_MUTEX_EXCLUSION_BROKEN'}
  if((Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash -ne $expected){throw 'PENDING_CHANGED_BEFORE_CRASH'}
  [IO.File]::WriteAllText($exitMarker,'only-test-worker-self-exits')
  if(-not $child.WaitForExit(6000)){throw 'QA_CHILD_EXIT_TIMEOUT'}
  if($child.ExitCode -ne 37){throw ('UNEXPECTED_QA_EXIT:'+ $child.ExitCode)}
  try{
    $acquired=$anchor.WaitOne(1300)
  } catch [Threading.AbandonedMutexException]{
    $abandoned=$true
    $acquired=$true
  }
  if(-not $acquired){throw 'MUTEX_NOT_REACQUIRED'}
  $preserved=((Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash -eq $expected)
  if(-not $preserved){throw 'PENDING_CHANGED_AFTER_CRASH'}
  [pscustomobject]@{
    fixtureOnly=$true
    deniedWhileHeld=(!$whileHeld)
    nativeAbandonmentObserved=$abandoned
    mutexAcquiredAfterChildCrash=$acquired
    pendingEvidencePreserved=$preserved
    noProductionMutexTouched=$true
    noProductionIncidentTouched=$true
    crossSessionCoverageNotTested=$true
    noNativeOutcomeProved=$true
  } | ConvertTo-Json -Compress
} finally {
  if($acquired){try{$anchor.ReleaseMutex()} catch {}}
  $anchor.Dispose()
  if($child){
    if(-not $child.HasExited){try{$child.Kill();$child.WaitForExit(1500)|Out-Null} catch {}}
    $child.Dispose()
  }
  if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}
}
