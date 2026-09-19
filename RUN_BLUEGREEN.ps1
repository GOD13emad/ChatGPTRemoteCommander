[CmdletBinding()]
param(
  [string]$CandidateRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path),
  [string]$ExpectedCommit = '',
  [string]$LegacyRoot = (Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\app'),
  [ValidateSet('Auto','Bootstrap','Update')][string]$Mode = 'Auto',
  [switch]$PlanOnly,
  [switch]$SelfTest,
  [switch]$NonInteractive,
  [switch]$Worker,
  [string]$ReceiptPath = '',
  [string]$DeadlineUtc = '',
  [ValidateRange(30,1800)][int]$TimeoutSeconds = 600
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Engine = Join-Path $PSScriptRoot 'bluegreen-windows.ps1'
if (-not (Test-Path -LiteralPath $Engine -PathType Leaf)) { throw 'BLUE_GREEN_ENGINE_MISSING' }

function Get-EngineArguments {
  $values = [Collections.Generic.List[string]]::new()
  foreach ($value in @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',$Engine,'-CandidateRoot',$CandidateRoot,'-ExpectedCommit',$ExpectedCommit,'-LegacyRoot',$LegacyRoot,'-Mode',$Mode,'-TimeoutSeconds',[string]$TimeoutSeconds,'-NonInteractive')) {
    $values.Add([string]$value)
  }
  if ($PlanOnly) { $values.Add('-PlanOnly') }
  if ($SelfTest) { $values.Add('-SelfTest') }
  if($DeadlineUtc){$values.Add('-DeadlineUtc');$values.Add($DeadlineUtc)}
  return $values.ToArray()
}

function Write-ReceiptAtomic([string]$Path,[Collections.IDictionary]$Value) {
  $temp="$Path.tmp-$PID-$([guid]::NewGuid().ToString('N'))"
  $bytes=[Text.UTF8Encoding]::new($false).GetBytes((($Value|ConvertTo-Json -Depth 12)+"`n"));$stream=[IO.FileStream]::new($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough);try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
  foreach($i in 1..40){try{Move-Item -LiteralPath $temp -Destination $Path -Force;return}catch{if($i-eq 40){throw};Start-Sleep -Milliseconds 50}}
}

function New-Process([string]$File,[string[]]$Arguments,[bool]$Redirect=$false,[string]$WorkingDirectory=$PSScriptRoot) {
  $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$File;$psi.WorkingDirectory=$WorkingDirectory;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
  foreach($argument in $Arguments){[void]$psi.ArgumentList.Add($argument)}
  if($Redirect){$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true}
  $process=[Diagnostics.Process]::new();$process.StartInfo=$psi;$process.EnableRaisingEvents=$true
  if(-not$process.Start()){throw 'BLUE_GREEN_PROCESS_START_FAILED'}
  return $process
}

$pwsh = (Get-Command pwsh.exe -ErrorAction Stop).Source
$engineArguments = Get-EngineArguments
if($Worker){
  if([string]::IsNullOrWhiteSpace($ReceiptPath)-or-not(Test-Path -LiteralPath $ReceiptPath -PathType Leaf)){throw 'BLUE_GREEN_WORKER_RECEIPT_INVALID'}
  $receipt=Get-Content -LiteralPath $ReceiptPath -Raw|ConvertFrom-Json -AsHashtable;$CandidateRoot=[string]$receipt.operationCandidateRoot;$DeadlineUtc=[string]$receipt.deadlineAt;$engineArguments=Get-EngineArguments;$receipt.state='running';$receipt.phase='waiting-launcher-exit';$receipt.workerPid=$PID;$receipt.startedAt=(Get-Date).ToUniversalTime().ToString('o');$receipt.heartbeatAt=$receipt.startedAt;Write-ReceiptAtomic $ReceiptPath $receipt
  $process=$null;$outStream=$null;$errStream=$null
  try{
    foreach($i in 1..300){$launcher=Get-Process -Id ([int]$receipt.launcherPid) -ErrorAction SilentlyContinue;if(-not$launcher-or$launcher.StartTime.ToUniversalTime().ToString('o')-ne[string]$receipt.launcherStartedAt){break};Start-Sleep -Milliseconds 100;if($i-eq 300){throw 'LAUNCHER_EXIT_TIMEOUT'}};Start-Sleep -Seconds 1;$receipt.phase='engine-start';$receipt.heartbeatAt=(Get-Date).ToUniversalTime().ToString('o');Write-ReceiptAtomic $ReceiptPath $receipt
    $receipt.phase='engine-spawn';Write-ReceiptAtomic $ReceiptPath $receipt;$process=New-Process $pwsh $engineArguments $true $CandidateRoot;$receipt.phase='engine-spawned';Write-ReceiptAtomic $ReceiptPath $receipt;$stdout=[string]$receipt.stdoutLog;$stderr=[string]$receipt.stderrLog;$outStream=[IO.FileStream]::new($stdout,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::Read,4096,[IO.FileOptions]::WriteThrough);$errStream=[IO.FileStream]::new($stderr,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::Read,4096,[IO.FileOptions]::WriteThrough);$outTask=$process.StandardOutput.BaseStream.CopyToAsync($outStream);$errTask=$process.StandardError.BaseStream.CopyToAsync($errStream)
    while(-not$process.HasExited){Start-Sleep -Seconds 2;$process.Refresh();$receipt.heartbeatAt=(Get-Date).ToUniversalTime().ToString('o');$receipt.deadlineExceeded=([DateTime]::Compare([DateTime]::UtcNow,[DateTimeOffset]::Parse([string]$receipt.deadlineAt).UtcDateTime)-gt 0);if(Test-Path -LiteralPath $stdout){$line=Get-Content -LiteralPath $stdout -Tail 1 -ErrorAction SilentlyContinue;if($line-match'^([A-Z][A-Z0-9_-]+)'){$receipt.phase=$Matches[1]}};Write-ReceiptAtomic $ReceiptPath $receipt}
    $process.WaitForExit();$outTask.GetAwaiter().GetResult();$errTask.GetAwaiter().GetResult();$outStream.Flush($true);$errStream.Flush($true);$outStream.Dispose();$errStream.Dispose();$outStream=$null;$errStream=$null;$engineExitCode=$process.ExitCode;$deadlineExceeded=[DateTime]::UtcNow-gt[DateTimeOffset]::Parse([string]$receipt.deadlineAt).UtcDateTime;$exitCode=if($engineExitCode-eq 0-and$deadlineExceeded){124}else{$engineExitCode};$candidate=[IO.Path]::GetFullPath([string]$receipt.operationCandidateRoot);$operation=[IO.Path]::GetFullPath((Split-Path -Parent $ReceiptPath));if([IO.Path]::GetFullPath((Split-Path -Parent $candidate))-ne$operation){throw 'WORKER_CANDIDATE_CLEANUP_PATH_INVALID'};$item=Get-Item -LiteralPath $candidate -Force;if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-or$item.LinkType-or(Get-ChildItem -LiteralPath $candidate -Recurse -Force|Where-Object{($_.Attributes-band[IO.FileAttributes]::ReparsePoint)-or$_.LinkType}|Select-Object -First 1)){throw 'WORKER_CANDIDATE_CLEANUP_LINK_REFUSED'};Set-Location -LiteralPath $operation;[Environment]::CurrentDirectory=$operation;Remove-Item -LiteralPath $candidate -Recurse -Force;if(Test-Path -LiteralPath $candidate){throw 'WORKER_CANDIDATE_CLEANUP_FAILED'};$receipt.stagingCleaned=$true;$receipt.engineExitCode=$engineExitCode;$receipt.exitCode=$exitCode;$receipt.deadlineExceeded=$deadlineExceeded;$receipt.state=if($exitCode-eq 0){'succeeded'}else{'failed'};if($engineExitCode-eq 0-and$deadlineExceeded){$receipt.errorCode='ENGINE_SUCCEEDED_AFTER_DEADLINE'};$receipt.phase='final';$receipt.finishedAt=(Get-Date).ToUniversalTime().ToString('o');$receipt.heartbeatAt=$receipt.finishedAt;Write-ReceiptAtomic $ReceiptPath $receipt;exit $exitCode
  }catch{if($outStream){$outStream.Dispose()};if($errStream){$errStream.Dispose()};[IO.File]::AppendAllText((Join-Path (Split-Path -Parent $ReceiptPath) 'worker-error.log'),($_|Out-String));$receipt.state='failed';$receipt.phase='worker-error';$receipt.errorCode='WORKER_EXECUTION_FAILED';$receipt.finishedAt=(Get-Date).ToUniversalTime().ToString('o');$receipt.heartbeatAt=$receipt.finishedAt;Write-ReceiptAtomic $ReceiptPath $receipt;exit 1}
}
if($NonInteractive-and-not$SelfTest-and-not$PlanOnly){
  $operationId=[guid]::NewGuid().ToString('N');$operationRoot=Join-Path $env:LOCALAPPDATA "ChatGPTRemoteCommander\control\operations\$operationId";New-Item -ItemType Directory -Force -Path $operationRoot|Out-Null;$operationCandidate=Join-Path $operationRoot 'candidate';$git=(Get-Command git.exe -ErrorAction Stop).Source;&$git clone --quiet --no-local --no-hardlinks --no-checkout -- $CandidateRoot $operationCandidate;if($LASTEXITCODE-ne 0){throw 'OPERATION_CANDIDATE_CLONE_FAILED'};&$git -C $operationCandidate checkout --quiet --detach $ExpectedCommit;if($LASTEXITCODE-ne 0){throw 'OPERATION_CANDIDATE_CHECKOUT_FAILED'};$commit=(&$git -C $operationCandidate rev-parse HEAD).Trim().ToLowerInvariant();if($commit-ne$ExpectedCommit.ToLowerInvariant()){throw 'OPERATION_CANDIDATE_COMMIT_MISMATCH'};$tree=(&$git -C $operationCandidate rev-parse 'HEAD^{tree}').Trim().ToLowerInvariant();$ReceiptPath=Join-Path $operationRoot 'receipt.json';$created=(Get-Date).ToUniversalTime();$launcherStarted=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o');$receipt=[ordered]@{schema=1;operationId=$operationId;state='accepted';phase='queued';createdAt=$created.ToString('o');heartbeatAt=$created.ToString('o');deadlineAt=$created.AddSeconds($TimeoutSeconds).ToString('o');deadlineExceeded=$false;launcherPid=$PID;launcherStartedAt=$launcherStarted;sourceCandidateRoot=[IO.Path]::GetFullPath($CandidateRoot);operationCandidateRoot=$operationCandidate;operationCommit=$commit;operationTree=$tree;expectedCommit=$ExpectedCommit;mode=$Mode;receiptPath=$ReceiptPath;stdoutLog=(Join-Path $operationRoot 'engine.out.log');stderrLog=(Join-Path $operationRoot 'engine.err.log')};Write-ReceiptAtomic $ReceiptPath $receipt
  $operationRunner=Join-Path $operationCandidate 'RUN_BLUEGREEN.ps1';if(-not(Test-Path -LiteralPath $operationRunner -PathType Leaf)){throw 'OPERATION_RUNNER_MISSING'};$args=[Collections.Generic.List[string]]::new();foreach($value in @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',$operationRunner,'-CandidateRoot',$operationCandidate,'-ExpectedCommit',$ExpectedCommit,'-LegacyRoot',$LegacyRoot,'-Mode',$Mode,'-TimeoutSeconds',[string]$TimeoutSeconds,'-NonInteractive','-Worker','-ReceiptPath',$ReceiptPath,'-DeadlineUtc',[string]$receipt.deadlineAt)){$args.Add([string]$value)}
  try{$workerProcess=New-Process $pwsh $args.ToArray() $false $operationCandidate}catch{$receipt.state='failed';$receipt.phase='worker-launch';$receipt.errorCode='WORKER_LAUNCH_FAILED';$receipt.finishedAt=(Get-Date).ToUniversalTime().ToString('o');Write-ReceiptAtomic $ReceiptPath $receipt;throw};$receipt|ConvertTo-Json -Depth 8 -Compress;exit 0
}
if ($NonInteractive -or $SelfTest -or -not [Environment]::UserInteractive) {
  & $pwsh @engineArguments
  exit $LASTEXITCODE
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

$form = [Windows.Forms.Form]::new()
$form.Text = 'ارتقای امن ChatGPT Remote Commander'
$form.Width = 820
$form.Height = 560
$form.StartPosition = 'CenterScreen'
$form.RightToLeft = 'Yes'
$form.RightToLeftLayout = $true
$form.Font = [Drawing.Font]::new('Segoe UI',10)

$title = [Windows.Forms.Label]::new()
$title.Dock = 'Top'
$title.Height = 58
$title.Padding = [Windows.Forms.Padding]::new(12)
$title.TextAlign = 'MiddleRight'
$title.Text = 'در حال اجرای کنترل‌های ایمنی و ارتقای آبی/سبز…'

$log = [Windows.Forms.RichTextBox]::new()
$log.Dock = 'Fill'
$log.ReadOnly = $true
$log.RightToLeft = 'No'
$log.BackColor = [Drawing.Color]::FromArgb(24,24,24)
$log.ForeColor = [Drawing.Color]::Gainsboro
$log.Font = [Drawing.Font]::new('Consolas',9)

$close = [Windows.Forms.Button]::new()
$close.Dock = 'Bottom'
$close.Height = 44
$close.Text = 'بستن'
$close.Enabled = $false
$close.Add_Click({ $form.Close() })

$form.Controls.Add($log)
$form.Controls.Add($title)
$form.Controls.Add($close)
[void]$form.Handle

$psi = [Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $pwsh
foreach ($argument in $engineArguments) { [void]$psi.ArgumentList.Add($argument) }
$psi.WorkingDirectory = $PSScriptRoot
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$process = [Diagnostics.Process]::new()
$process.StartInfo = $psi
$process.EnableRaisingEvents = $true

$append = {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return }
  [void]$form.BeginInvoke([Action]{ $log.AppendText($Text + [Environment]::NewLine); $log.ScrollToCaret() })
}
$process.add_OutputDataReceived({ param($sender,$eventArgs) & $append $eventArgs.Data })
$process.add_ErrorDataReceived({ param($sender,$eventArgs) & $append $eventArgs.Data })
$process.add_Exited({
  $code = $process.ExitCode
  [void]$form.BeginInvoke([Action]{
    if ($code -eq 0) { $title.Text='پایان موفق: همه دروازه‌های اجراشده عبور کردند.'; $title.ForeColor=[Drawing.Color]::DarkGreen }
    else { $title.Text="توقف ایمن: اجرا با کد $code متوقف شد. گزارش بالا را نگه دارید."; $title.ForeColor=[Drawing.Color]::DarkRed }
    $close.Enabled=$true
  })
})
$form.Add_FormClosing({
  param($sender,$eventArgs)
  if (-not $process.HasExited) {
    $eventArgs.Cancel = $true
    $title.Text = 'عملیات هنوز در حال اجراست؛ برای جلوگیری از اجرای رهاشده، پنجره بسته نمی‌شود.'
    $title.ForeColor = [Drawing.Color]::DarkOrange
  }
})

if (-not $process.Start()) { throw 'BLUE_GREEN_RUNNER_START_FAILED' }
$process.BeginOutputReadLine()
$process.BeginErrorReadLine()
[void]$form.ShowDialog()
if (-not $process.HasExited) { throw 'BLUE_GREEN_WINDOW_CLOSED_WHILE_RUNNING' }
exit $process.ExitCode
