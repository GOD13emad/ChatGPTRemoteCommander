$ErrorActionPreference='Stop'
$testDir=Join-Path $env:TEMP ("rc-backend-stdio-"+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $testDir|Out-Null
$runner=Join-Path $testDir 'runner.ps1'
$runnerBody=@'
$ErrorActionPreference='Stop'
$child=Start-Process -FilePath 'pwsh.exe' -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 60') -WindowStyle Hidden -PassThru
Write-Output ("CHILD_PID="+$child.Id)
'@
[IO.File]::WriteAllText($runner,$runnerBody,[Text.UTF8Encoding]::new($false))
$psi=[Diagnostics.ProcessStartInfo]::new()
$psi.FileName='pwsh.exe'
$psi.UseShellExecute=$false
$psi.CreateNoWindow=$true
$psi.RedirectStandardOutput=$true
$psi.RedirectStandardError=$true
foreach($a in @('-NoLogo','-NoProfile','-NonInteractive','-File',$runner)){[void]$psi.ArgumentList.Add($a)}
$p=[Diagnostics.Process]::Start($psi)
$childPid=$null
try{
  $stdoutTask=$p.StandardOutput.ReadToEndAsync()
  $stderrTask=$p.StandardError.ReadToEndAsync()
  if(-not $p.WaitForExit(5000)){throw 'BACKEND_STDIO_PARENT_PROCESS_HANG'}
  if(-not $stdoutTask.Wait(5000)){throw 'BACKEND_STDIO_PIPE_HELD_OPEN'}
  if(-not $stderrTask.Wait(5000)){throw 'BACKEND_STDERR_PIPE_HELD_OPEN'}
  $stdout=$stdoutTask.Result
  $stderr=$stderrTask.Result
  if($p.ExitCode-ne0){throw "BACKEND_STDIO_RUNNER_FAIL exit=$($p.ExitCode) stderr=$stderr"}
  if($stdout-notmatch 'CHILD_PID=(\d+)'){throw 'BACKEND_STDIO_CHILD_PID_MISSING'}
  $childPid=[int]$matches[1]
  if(-not(Get-Process -Id $childPid -ErrorAction SilentlyContinue)){throw 'BACKEND_STDIO_CHILD_NOT_ALIVE'}
  'BACKEND_STDIO_DETACH_PASS'
}finally{
  if($childPid){Stop-Process -Id $childPid -Force -ErrorAction SilentlyContinue}
  try{Remove-Item -LiteralPath $testDir -Recurse -Force -ErrorAction Stop}catch{}
}
