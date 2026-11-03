# Disposable owner WinForms QA. Does not modify any running Commander service.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Worker,[switch]$ForcePane,[switch]$ForceWin32,[switch]$ViaBridge,[switch]$SimulateUiaUnsupported,[switch]$ViaOwnerWorker)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $Worker
if(-not (Test-Path -LiteralPath $Worker -PathType Leaf)){throw 'QA_WORKER_MISSING'}
$ready=Join-Path $root 'fixture-ready.json'
$proof=Join-Path $root 'fixture-effect.txt'
Remove-Item -LiteralPath $ready,$proof -Force -ErrorAction SilentlyContinue
$fixture=$null
try {
 $fixtureArgs=@(
  '-NoLogo','-NoProfile','-NonInteractive','-File',('"' + $Worker + '"'),
  '-Mode','Fixture','-ReadyPath',('"' + $ready + '"'),
  '-ProofPath',('"' + $proof + '"')
 )
 if($ForcePane){$fixtureArgs+= '-PanelAccessibility'}
 $fixture=Start-Process -FilePath 'pwsh.exe' -ArgumentList $fixtureArgs -WindowStyle Hidden -PassThru
 $deadline=[Diagnostics.Stopwatch]::StartNew()
 while(-not (Test-Path -LiteralPath $ready) -and $deadline.Elapsed.TotalSeconds -lt 8) {
  if($fixture.HasExited){throw ('QA_FIXTURE_EXITED_'+$fixture.ExitCode)}
  Start-Sleep -Milliseconds 80
 }
 if(-not (Test-Path -LiteralPath $ready)){throw 'QA_FIXTURE_TIMEOUT'}
 $identity=Get-Content -LiteralPath $ready -Raw | ConvertFrom-Json
 if($identity.pid -ne $fixture.Id){throw 'QA_FIXTURE_PID_MISMATCH'}
 $json=$identity|ConvertTo-Json -Compress
 $probeRaw=$json | & pwsh.exe -NoLogo -NoProfile -NonInteractive -File $Worker -Mode Probe
 if($LASTEXITCODE -ne 0){throw ('QA_NATIVE_PROBE_FAILED '+($probeRaw|Out-String))}
 $probe=$probeRaw|ConvertFrom-Json
 if(-not $probe.ok -or -not $probe.win32Bound -or $probe.name -cne 'Apply' -or
   [string]$probe.elementHandle -notmatch '^[1-9][0-9]+$'){throw 'QA_PROBE_BAD_RESULT'}
 if($ViaBridge -or $ViaOwnerWorker) {
  $script=Join-Path (Join-Path $root 'test') $(if($ViaOwnerWorker){'v2-windows-owner-gui-worker-live.mjs'}else{'v2-windows-native-bridge-live.mjs'})
  $bridgeArgs=@($script,[string]$identity.pid,[string]$identity.hwnd,
    [string]$identity.startTicks,[string]$identity.title,$proof,$Worker)
  if($SimulateUiaUnsupported){$bridgeArgs+='simulate-uia-unsupported'}
  $resultRaw=& node @bridgeArgs
  if($LASTEXITCODE -ne 0){throw ('QA_V2_BRIDGE_FAILED '+($resultRaw|Out-String))}
  if(-not (Test-Path $proof) -or ((Get-Content -LiteralPath $proof -Raw) -cne 'APPLY_CLICKED')) {
   throw 'QA_V2_BRIDGE_INDEPENDENT_PROOF_MISSING'
  }
  if($fixture.HasExited){throw 'QA_V2_BRIDGE_FIXTURE_EXITED'}
  $resultRaw
  return
 }
 $method=if($ForceWin32){'win32'}elseif($probe.uiaInvokeAvailable){'uia'}else{'win32'}
 $payload=[ordered]@{
  schema=1;pid=[int]$identity.pid;hwnd=[string]$identity.hwnd;
  startTicks=[string]$identity.startTicks;title=[string]$identity.title;
  elementHandle=[string]$probe.elementHandle;method=$method
 }|ConvertTo-Json -Compress
 $effectRaw=$payload | & pwsh.exe -NoLogo -NoProfile -NonInteractive -File $Worker -Mode Invoke
 if($LASTEXITCODE -ne 0){throw ('QA_NATIVE_INVOKE_FAILED '+($effectRaw|Out-String))}
 $effect=$effectRaw|ConvertFrom-Json
 if(-not $effect.ok -or $effect.effect -cne 'DISPATCHED'){throw 'QA_NATIVE_EFFECT_INVALID'}
 $seen=$false
 for($i=0;$i -lt 25;$i++){
  if((Test-Path $proof) -and ((Get-Content -LiteralPath $proof -Raw) -ceq 'APPLY_CLICKED')){
   $seen=$true;break
  }
  Start-Sleep -Milliseconds 80
 }
 if(-not $seen){throw 'QA_INDEPENDENT_PROOF_MISSING'}
 if($fixture.HasExited){throw 'QA_POST_EFFECT_WINDOW_EXITED'}
 [pscustomobject]@{
  status='WINDOWS_NATIVE_QA_PASS';method=$method;forcePane=[bool]$ForcePane;forceWin32=[bool]$ForceWin32;
  uiaInvokeAvailable=[bool]$probe.uiaInvokeAvailable;
  ownerProcessVerified=$true;independentProof='APPLY_CLICKED';
  foregroundInputUsed=$false;processStayedAlive=$true;
  session=[Diagnostics.Process]::GetCurrentProcess().SessionId;
 }|ConvertTo-Json -Compress
}finally{
 if($fixture -and -not $fixture.HasExited){
  Stop-Process -Id $fixture.Id -Force -ErrorAction SilentlyContinue
  try{$fixture.WaitForExit(1500)|Out-Null}catch{}
 }
}
