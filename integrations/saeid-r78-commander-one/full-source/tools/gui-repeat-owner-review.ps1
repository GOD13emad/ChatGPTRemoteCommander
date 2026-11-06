[CmdletBinding()]
param([switch]$Report)
# Physical-owner form only. No unattended approval, reset, replay or process kill.
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$inspect=Join-Path $PSScriptRoot 'gui-repeat-owner-inspect.mjs'
$node=(Get-Command node.exe -ErrorAction Stop).Source
function Get-Review { $text=& $node $inspect; if($LASTEXITCODE-ne0){throw 'READ_ONLY_PREFLIGHT_FAILED'}; $text|ConvertFrom-Json }
if($Report){Get-Review|ConvertTo-Json -Depth 10;exit 0}
if(-not[Environment]::UserInteractive -or [Diagnostics.Process]::GetCurrentProcess().SessionId-eq0){throw 'LOCAL_INTERACTIVE_REVIEW_REQUIRED'}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form=[Windows.Forms.Form]::new();$form.Text='بازیابی کنترل ورودی Commander — تأیید همین رویداد'
$form.Size=[Drawing.Size]::new(760,470);$form.RightToLeft='Yes';$form.RightToLeftLayout=$true
$form.StartPosition='CenterScreen';$form.Font=[Drawing.Font]::new('Segoe UI',11)
$body=[Windows.Forms.TextBox]::new();$body.Multiline=$true;$body.ReadOnly=$true;$body.Location=[Drawing.Point]::new(20,20);$body.Size=[Drawing.Size]::new(700,215);$form.Controls.Add($body)
$normal=[Windows.Forms.CheckBox]::new();$normal.Text='کنترل دستی عادی است و هیچ کلید یا دکمه‌ای گیر نکرده است.';$normal.Location=[Drawing.Point]::new(20,245);$normal.Size=[Drawing.Size]::new(700,35);$form.Controls.Add($normal)
$unknown=[Windows.Forms.CheckBox]::new();$unknown.Text='نتیجهٔ قبلی نامعلوم بماند؛ فقط بخش کنترل ورودی برای فرمان تازه آماده شود.';$unknown.Location=[Drawing.Point]::new(20,285);$unknown.Size=[Drawing.Size]::new(700,35);$form.Controls.Add($unknown)
$button=[Windows.Forms.Button]::new();$button.Text='بررسی کردم؛ آماده‌سازی کنترل برای فرمان تازه';$button.Enabled=$false;$button.Location=[Drawing.Point]::new(170,340);$button.Size=[Drawing.Size]::new(420,45);$form.Controls.Add($button)
try{$script:initial=Get-Review;$body.Text="رویداد فعلی: $($initial.proposal.incidentId)`r`nفرمان: $($initial.proposal.incidentTool)`r`nآمادگی: $($initial.reason)`r`nهیچ کلیک، کلید، خروج یا کار قبلی تکرار نمی‌شود. فقط کمک‌پردازهٔ کنترل ورودی در بررسی بعدی دوباره آماده می‌شود؛ هسته و پروژه‌ها متوقف نمی‌شوند."}catch{$script:initial=$null;$body.Text='پیش‌نیازها آماده نیست؛ هیچ تغییری انجام نشد.'}
$update={$button.Enabled=($null-ne$script:initial -and $initial.ready -eq $true -and $normal.Checked -and $unknown.Checked)}
$normal.Add_CheckedChanged($update);$unknown.Add_CheckedChanged($update)
$button.Add_Click({
 $mutex=$null;$owned=$false;$stream=$null
 try{
  $button.Enabled=$false;$fresh=Get-Review
  if(-not$fresh.ready -or ($fresh.proposal|ConvertTo-Json -Compress)-ne($initial.proposal|ConvertTo-Json -Compress) -or $fresh.routeSha256-ne$initial.routeSha256 -or $fresh.configSha256-ne$initial.configSha256 -or $fresh.planSha256-ne$initial.planSha256){throw 'STATE_CHANGED_STOP'}
  $mutex=[Threading.Mutex]::new($false,'Local\ChatGPTRemoteCommander.GuiInput')
  try{$owned=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$owned=$true;throw 'NATIVE_MUTEX_UNCERTAIN'}
  if(-not$owned){throw 'GUI_BUSY_STOP'}
  $locked=Get-Review
  if($locked.guiBusy-ne$false -or $locked.guiLeased-ne$false -or $locked.guiReason-ne'GUI_INCIDENT_REVIEW_REQUIRED' -or $locked.stopPresent -or $locked.liveIncidentId-ne$fresh.proposal.incidentId -or ($locked.proposal|ConvertTo-Json -Compress)-ne($fresh.proposal|ConvertTo-Json -Compress) -or $locked.routeSha256-ne$fresh.routeSha256 -or $locked.configSha256-ne$fresh.configSha256 -or $locked.planSha256-ne$fresh.planSha256){throw 'LOCKED_STATE_CHANGED_STOP'}
  $x=$fresh.proposal
  $record=[ordered]@{schema='rc-gui-repeat-owner-review-v2';decision='OWNER_REVIEWED_FRESH_INPUT_ONLY';historicalOutcome='UNKNOWN_NO_REPLAY';noReplay=$true;reviewMethod='LOCAL_INTERACTIVE_BUTTON';deliberateGuiHelperRestart=$true;host=$x.host;user=$x.user;sourceRoot=$x.sourceRoot;sourceSha256=$x.sourceSha256;incidentId=$x.incidentId;incidentTool=$x.incidentTool;incidentFile=$x.incidentFile;incidentSha256=$x.incidentSha256;parentEpoch=$x.parentEpoch;parentReviewSha256=$x.parentReviewSha256;epoch=[guid]::NewGuid().ToString();reviewedUtc=[DateTime]::UtcNow.ToString('o');quiescence=@{nativeMutexAcquired=$true;guiBusy=$false;guiLeased=$false}}
  [void][IO.Directory]::CreateDirectory((Split-Path -Parent $x.receiptFile))
  $bytes=[Text.Encoding]::UTF8.GetBytes(($record|ConvertTo-Json -Depth 7 -Compress)+[Environment]::NewLine)
  $stream=[IO.File]::Open($x.receiptFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  $stream.Write($bytes,0,$bytes.Length);$stream.Flush($true);$stream.Dispose();$stream=$null
  $normal.Enabled=$false;$unknown.Enabled=$false
  $body.Text='بررسی مالک برای همین رویداد ثبت شد. نتیجهٔ قبلی نامعلوم و غیرقابل‌تکرار ماند. کنترل ورودی باید با ابزار وضعیت بررسی شود؛ آزمون ورودی واقعی هنوز انجام نشده است.'
 }catch{$body.Text='بازیابی کامل نشد؛ خودکار تکرار نکنید. خطا: '+$_.Exception.Message}
 finally{if($stream){$stream.Dispose()};if($owned){$mutex.ReleaseMutex()};if($mutex){$mutex.Dispose()}}
})
[void]$form.ShowDialog()
