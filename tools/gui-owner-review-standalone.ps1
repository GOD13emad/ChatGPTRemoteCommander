[CmdletBinding()]
param([switch]$Report,[string]$CoreRoot='')
# OWNER-LOCAL REVIEW ONLY. No unattended/command-line approval mode.
# Preserves historical UNKNOWN evidence. Does not restart, kill or replay jobs.
$ErrorActionPreference='Stop'
$root=if([string]::IsNullOrWhiteSpace($CoreRoot)){[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))}else{[IO.Path]::GetFullPath($CoreRoot)}
$inspect=Join-Path $root 'tools/gui-owner-recovery-inspect.mjs'
$node=(Get-Command node.exe -ErrorAction Stop).Source
function Get-Review { $r=& $node $inspect; if($LASTEXITCODE-ne0){throw 'READ_ONLY_PREFLIGHT_FAILED'}; return ($r|ConvertFrom-Json) }
if($Report){Get-Review|ConvertTo-Json -Depth 6;exit 0}
if(-not[Environment]::UserInteractive -or [Diagnostics.Process]::GetCurrentProcess().SessionId-eq0){throw 'LOCAL_INTERACTIVE_REVIEW_REQUIRED'}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form=[Windows.Forms.Form]::new()
$form.Text='بازیابی کنترل صفحهٔ Commander'
$form.Size=[Drawing.Size]::new(700,455)
$form.RightToLeft='Yes';$form.RightToLeftLayout=$true;$form.StartPosition='CenterScreen'
$form.Font=[Drawing.Font]::new('Segoe UI',11)
$body=[Windows.Forms.TextBox]::new();$body.Multiline=$true;$body.ReadOnly=$true
$body.Location=[Drawing.Point]::new(20,20);$body.Size=[Drawing.Size]::new(640,205)
$form.Controls.Add($body)
$normal=[Windows.Forms.CheckBox]::new();$normal.Text='کنترل دستی ویندوز عادی است و ورودی گیر نکرده است.'
$normal.Location=[Drawing.Point]::new(20,235);$normal.Size=[Drawing.Size]::new(640,35)
$form.Controls.Add($normal)
$unknown=[Windows.Forms.CheckBox]::new();$unknown.Text='نتیجهٔ کلیک قدیمی نامعلوم بماند؛ فقط فرمان تازه مجاز شود.'
$unknown.Location=[Drawing.Point]::new(20,275);$unknown.Size=[Drawing.Size]::new(640,35)
$form.Controls.Add($unknown)
$button=[Windows.Forms.Button]::new();$button.Text='بررسی کردم؛ اجازهٔ فرمان تازه';$button.Enabled=$false
$button.Location=[Drawing.Point]::new(210,330);$button.Size=[Drawing.Size]::new(300,45)
$form.Controls.Add($button)
try{
  $script:initial=Get-Review
  $body.Text="رویداد: $($initial.incidentTool)`r`nتاریخ: $($initial.startedUtc)`r`nنتیجهٔ تاریخی: نامعلوم؛ بدون تکرار`r`nآمادگی: $($initial.reason)`r`nاین اقدام برنامه‌ها را متوقف نمی‌کند و سابقهٔ کلیک را پاک نمی‌کند."
}catch{$body.Text='پیش‌نیازها آماده نیستند؛ هیچ تغییری انجام نشد.';$script:initial=$null}
$update={ $button.Enabled=($null-ne$script:initial -and $initial.ready -eq $true -and $normal.Checked -and $unknown.Checked) }
$normal.Add_CheckedChanged($update);$unknown.Add_CheckedChanged($update)
$button.Add_Click({
  $mutex=$null;$owned=$false;$stream=$null
  try{
    $button.Enabled=$false
    $fresh=Get-Review
    if(-not$fresh.ready -or $fresh.sourceSha256-ne$initial.sourceSha256 -or
       $fresh.incidentSha256-ne$initial.incidentSha256 -or
       $fresh.routeSha256-ne$initial.routeSha256){throw 'STATE_CHANGED_STOP'}
    $mutex=[Threading.Mutex]::new($false,'Local\ChatGPTRemoteCommander.GuiInput')
    try{$owned=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$owned=$true;throw 'NATIVE_MUTEX_UNCERTAIN'}
    if(-not$owned){throw 'GUI_BUSY_STOP'}
    if(Test-Path -LiteralPath $fresh.stopFile){throw 'LOCAL_STOP_PRESERVED'}
    $freshLocked=Get-Review
    # This process now owns GuiInput. A separate read-only native helper must
    # report the mutex busy; that is expected self-contention, not owner approval.
    # The earlier full readiness was proved before locking. Re-check its exact
    # source/route/config/incident identity and current admission while locked.
    if($freshLocked.guiReason-ne'GUI_INCIDENT_REVIEW_REQUIRED' -or
       $freshLocked.guiBusy-ne$false -or $freshLocked.guiLeased-ne$false -or
       $freshLocked.stopPresent-ne$false -or
       $freshLocked.sourceSha256-ne$fresh.sourceSha256 -or
       $freshLocked.configSha256-ne$fresh.configSha256 -or
       $freshLocked.incidentSha256-ne$fresh.incidentSha256 -or
       $freshLocked.routeSha256-ne$fresh.routeSha256){throw 'LOCKED_STATE_CHANGED_STOP'}
    $epoch=[guid]::NewGuid().ToString()
    $receipt=Join-Path (Split-Path $fresh.incidentFile -Parent) 'gui-owner-recovery-v1-026.json'
    if($receipt-ne$fresh.reviewReceiptPath){throw 'REVIEW_RECEIPT_SCOPE'}
    $record=[ordered]@{schema='rc-gui-owner-recovery-v1';decision='OWNER_REVIEWED_FRESH_INPUT_ONLY';
      historicalOutcome='UNKNOWN_NO_REPLAY';noReplay=$true;reviewMethod='LOCAL_INTERACTIVE_BUTTON';
      host=$fresh.host;user=$fresh.user;sourceRoot=$root;sourceSha256=$fresh.sourceSha256;
      reviewUiPath=$PSCommandPath;reviewUiSha256=(Get-FileHash -LiteralPath $PSCommandPath).Hash.ToLowerInvariant();
      epoch=$epoch;incidentId=$fresh.incidentId;incidentTool=$fresh.incidentTool;
      incidentSha256=$fresh.incidentSha256;reviewedUtc=[DateTime]::UtcNow.ToString('o');
      quiescence=@{nativeMutexAcquired=$true;guiBusy=$false;guiLeased=$false}}
    $bytes=[Text.Encoding]::UTF8.GetBytes(($record|ConvertTo-Json -Depth 6 -Compress)+[Environment]::NewLine)
    $stream=[IO.File]::Open($receipt,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    $stream.Write($bytes,0,$bytes.Length);$stream.Flush($true);$stream.Dispose();$stream=$null
    # Physical review grants fresh input only. Every local STOP remains authoritative.
    if(Test-Path -LiteralPath $fresh.stopFile){throw 'LOCAL_STOP_APPEARED_REVIEW_REQUIRES_RECONCILIATION'}
    $body.Text='بررسی مالک ثبت شد. سابقهٔ کلیک قدیمی حفظ شده است. آزمون تصویر و ورودی تازه هنوز لازم است.'
    $normal.Enabled=$false;$unknown.Enabled=$false
  }catch{$body.Text='بازیابی کامل نشد؛ خودکار تکرار نکنید. خطا: '+$_.Exception.Message}
  finally{if($stream){$stream.Dispose()};if($owned){$mutex.ReleaseMutex()};if($mutex){$mutex.Dispose()}}
})
[void]$form.ShowDialog()
