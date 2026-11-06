param([Parameter(Mandatory=$true)][string]$PlanPath,[Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedPlanSha256)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class R80KVisibility{
[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);
[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
}
'@
$d='G:\CodexWork\RemoteCommander_ConnectionRecovery_20261027\commander-one-owner-enrollment-r80\00_DELIVERY'
if([IO.Path]::GetFullPath($PlanPath) -ne (Join-Path $d 'LIVE_K_READY_FINALIZE_PLAN.json')){throw 'EXACT_PLAN_REQUIRED'}
$planPin=[IO.File]::Open($PlanPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
if($planPin.Length -le 0 -or $planPin.Length -gt 1048576){throw 'PLAN_SIZE'}
$raw=[byte[]]::new([int]$planPin.Length);$planPin.ReadExactly($raw)
$planSha=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($raw)).ToLowerInvariant()
if($planSha -ne $ExpectedPlanSha256){throw 'PLAN_CHANGED'}
$plan=[Text.UTF8Encoding]::new($false,$true).GetString($raw)|ConvertFrom-Json
if($plan.schema -ne 'r80-reviewed-staged-finalization-k-plan-v1' -or $plan.mode -ne '--finalize-staged'){throw 'EXACT_FINALIZATION_MODE'}
if([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne $plan.ownerSid -or [Diagnostics.Process]::GetCurrentProcess().SessionId -ne $plan.ownerSessionId){throw 'OWNER_SESSION_CHANGED'}
if($plan.ownerSid -notmatch '^S-1-5-21-[0-9-]+$' -or $plan.imageSha256 -notmatch '^[a-f0-9]{64}$'){throw 'EXACT_SAFE_ARGS'}
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function Baseline {foreach($x in $plan.baselineFiles){if((Hash $x.path) -ne $x.sha256){throw 'CORE_BASELINE_DRIFT'}}}
function Once([string]$n,$o){$b=[Text.Encoding]::UTF8.GetBytes(($o|ConvertTo-Json -Depth 12));$f=[IO.FileStream]::new((Join-Path $d $n),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read,4096,[IO.FileOptions]::WriteThrough);try{$f.Write($b,0,$b.Length);$f.Flush($true)}finally{$f.Dispose()}}
Baseline
$old=Get-Content -LiteralPath (Join-Path $d 'LIVE_I_ENROLLMENT_RECEIPT.json') -Raw|ConvertFrom-Json
if($old.state -ne 'APPLY_NONZERO_RECONCILE_NO_RETRY' -or $old.details.exitCode -ne 2){throw 'I_NOT_RECONCILED'}
$priorJ=Get-Content -LiteralPath (Join-Path $d 'LIVE_J_FINALIZE_RECEIPT.json') -Raw|ConvertFrom-Json
if($priorJ.state -ne 'STOP_RECONCILE_NO_RETRY' -or $priorJ.details.exitCode -ne 2 -or $priorJ.details.nativeOutcome.phase -ne 'ReadIOwner' -or $priorJ.details.nativeOutcome.hresultHex -ne '0x80070003'){throw 'J_NOT_RECONCILED_EXACT_FAILURE'}

$outcomePath='C:\ProgramData\ChatGPTRemoteCommander\owner-auth\finalization-k.outcome.json'
$clientPath='C:\Program Files\ChatGPTRemoteCommander\owner-auth\client-policy.json'
if((Test-Path -LiteralPath $outcomePath) -or (Test-Path -LiteralPath $clientPath)){throw 'EXISTING_K_OR_CLIENT_POLICY_RECONCILE'}
$schedule=New-Object -ComObject Schedule.Service;$schedule.Connect();$folder=$schedule.GetFolder('\')
$present=$false;try{$null=$folder.GetTask('ChatGPTRemoteCommanderOwnerIssuerV1');$present=$true}catch{$e=$_.Exception;while($e.InnerException){$e=$e.InnerException};if($e.HResult -ne -2147024894){throw 'TASK_EXISTENCE_UNKNOWN'}}
if($present){throw 'TASK_ALREADY_PRESENT_RECONCILE'}
$imagePin=[IO.File]::Open($plan.imagePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
$heldSha=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($imagePin)).ToLowerInvariant();$imagePin.Position=0
if($heldSha -ne $plan.imageSha256){throw 'HELD_K_IMAGE_CHANGED'}
$form=[Windows.Forms.Form]::new();$form.Text='Commander — تکمیل مرحلهٔ ورود محلی';$form.Size=[Drawing.Size]::new(700,360);$form.StartPosition='CenterScreen';$form.RightToLeft='Yes';$form.RightToLeftLayout=$true;$form.Font=[Drawing.Font]::new('Tahoma',10)
$label=[Windows.Forms.Label]::new();$label.Dock='Top';$label.Height=90;$label.Padding=[Windows.Forms.Padding]::new(14);$label.Text='فقط مرحلهٔ باقی‌ماندهٔ مؤلفهٔ ورود تکمیل می‌شود. فایل‌ها و کلیدهای قبلی حفظ می‌شوند. نسخهٔ فعال و کارهای جاری تغییر نمی‌کنند. تأیید مدیر ویندوز را خودتان بررسی کنید.';$form.Controls.Add($label)
$log=[Windows.Forms.TextBox]::new();$log.Dock='Fill';$log.Multiline=$true;$log.ReadOnly=$true;$log.BackColor=[Drawing.Color]::White;$log.ScrollBars='Vertical';$form.Controls.Add($log);$log.BringToFront()
$close=[Windows.Forms.Button]::new();$close.Dock='Bottom';$close.Height=38;$close.Text='بستن گزارش';$close.Enabled=$false;$close.Add_Click({$form.Close()});$form.Controls.Add($close)
$open=[Windows.Forms.Button]::new();$open.Dock='Bottom';$open.Height=46;$open.Text='آماده‌ام؛ درخواست مدیر ویندوز را باز کن';$open.Enabled=$false;$open.Add_Click({$open.Enabled=$false;Note 'OWNER_READY_CLICK' 'آمادگی محلی ثبت شد؛ یک درخواست تازه باز می‌شود.';$timer.Start()});$form.Controls.Add($open)
$events=[Collections.Generic.List[object]]::new();$script:child=$null;$script:started=$false;$script:finished=$false
function Note([string]$code,[string]$text){$events.Add(@{utc=[DateTime]::UtcNow.ToString('o');code=$code});$log.AppendText($text+[Environment]::NewLine)}
function Finish([string]$state,$details){if($script:finished){return};$script:finished=$true;$timer.Stop();$baseline='UNCHANGED';try{Baseline}catch{$baseline='DRIFT_REQUIRES_RECONCILIATION';$state='BASELINE_DRIFT_FAIL_CLOSED_NO_RETRY'}
 Once 'LIVE_K_READY_FINALIZE_RECEIPT.json' @{schema='r80-staged-finalization-parent-receipt-v1';utc=[DateTime]::UtcNow.ToString('o');state=$state;details=$details;baseline=$baseline;imageSha256=$plan.imageSha256;planSha256=$planSha;events=$events.ToArray();automaticRetryAllowed=$false;coreInstalled=$false;projectJobsStoppedOrReplayed=$false;realOwnerLogin='UNPROVEN'}
 $close.Enabled=$true;$imagePin.Dispose();$planPin.Dispose();Note 'RECEIPT_SAVED' 'رسید ثبت شد. آزمون واقعی ورود، مرحلهٔ بعد است.'
}
$timer=[Windows.Forms.Timer]::new();$timer.Interval=400
$timer.Add_Tick({
 if(-not $script:started){$script:started=$true;try{
  Baseline
  Once 'LIVE_K_READY_FINALIZE_INTENT.json' @{schema='r80-k-staged-finalization-intent-v1';utc=[DateTime]::UtcNow.ToString('o');imageSha256=$plan.imageSha256;planSha256=$planSha;mode='--finalize-staged';scope='no-project-selftest-only';oldApplyReplayed=$false;automaticRetryAllowed=$false}
  Note 'OWNER_UAC' 'درخواست مدیر ویندوز اکنون باز می‌شود؛ بررسی و تأیید با شماست.'
  $psi=[Diagnostics.ProcessStartInfo]::new($plan.imagePath);$psi.UseShellExecute=$true;$psi.Verb='runas';$psi.WindowStyle='Hidden';$psi.WorkingDirectory=$d;$psi.Arguments='--finalize-staged '+$plan.ownerSid+' '+$plan.imageSha256
  $script:child=[Diagnostics.Process]::Start($psi);if($null -eq $script:child){throw 'PROCESS_HANDLE_MISSING_RECONCILE'}
  Once 'LIVE_K_READY_FINALIZE_PROCESS.json' @{pid=$script:child.Id;startUtc=$script:child.StartTime.ToUniversalTime().ToString('o');imageSha256=$plan.imageSha256;automaticRetryAllowed=$false}
  Note 'HELD_NATIVE_PROCESS' 'تکمیل مرحله در حال انجام است؛ هیچ کار قبلی اجرا نمی‌شود.'
 }catch{$top=$_.Exception;$primary=$top;while($primary.InnerException){$primary=$primary.InnerException};$win32=$null;if($primary -is [ComponentModel.Win32Exception]){$win32=$primary.NativeErrorCode};Finish 'STOP_RECONCILE_NO_RETRY' @{errorType=$top.GetType().FullName;primaryType=$primary.GetType().FullName;primaryHresult=('0x'+([uint32]([int64]$primary.HResult -band 4294967295)).ToString('X8'));nativeErrorCode=$win32;reason=if($primary.Message -match '^[A-Z_]+$'){$primary.Message}else{'SANITIZED_OPERATOR_REVIEW_REQUIRED'}}}}
 elseif($script:child -and $script:child.HasExited){
  $exit=$script:child.ExitCode;$ownPid=$script:child.Id;$script:child.Dispose();$script:child=$null;$outcome=$null;$taskProof=$null;$state='STOP_RECONCILE_NO_RETRY'
  try{
   if(Test-Path -LiteralPath $outcomePath){$outcome=Get-Content -LiteralPath $outcomePath -Raw|ConvertFrom-Json;if($outcome.schema -ne 'RC_OWNER_K_OUTCOME_V1'){throw 'OUTCOME_SCHEMA'}}
   if($exit -eq 0 -and $null -ne $outcome -and $outcome.status -eq 'COMPLETE'){
    $task=$folder.GetTask('ChatGPTRemoteCommanderOwnerIssuerV1');$definition=$task.Definition
    if([int]$task.State -ne 3){throw 'TASK_NOT_IDLE_READY_NO_TEST_START'}
    if([int]$definition.Principal.LogonType -ne 5 -or $definition.Triggers.Count -ne 0 -or $definition.Actions.Count -ne 1 -or $definition.Actions.Item(1).Path -ne 'C:\Program Files\ChatGPTRemoteCommander\owner-auth\CommanderNativeIssuer.exe' -or $definition.Actions.Item(1).Arguments -ne '--serve-once'){throw 'TASK_READBACK_MISMATCH'}
    if(-not (Test-Path -LiteralPath $clientPath)){throw 'CLIENT_POLICY_ABSENT'}
    $taskProof=@{path=$task.Path;state=[int]$task.State;logonType=[int]$definition.Principal.LogonType;clientPolicySha256=(Hash $clientPath);triggerCount=$definition.Triggers.Count;taskRunRequestedByParent=$false}
    $state='PASS_STAGED_AUTH_COMPONENT_FINALIZED_OWNER_E2E_PENDING';Note 'COMPONENT_READY' 'مؤلفهٔ ورود آماده شد؛ آزمون واقعی ورود هنوز انجام نشده است.'
   }else{Note 'NATIVE_FAILURE' 'تکمیل مرحله تأیید نشد؛ اجرای دوباره مجاز نیست.'}
   Finish $state @{exitCode=$exit;pid=$ownPid;nativeOutcome=$outcome;taskReadback=$taskProof;privateKeysReadByParent=$false}
  }catch{Finish 'POST_READBACK_UNPROVEN_RECONCILE_NO_RETRY' @{exitCode=$exit;pid=$ownPid;nativeOutcome=$outcome;errorType=$_.Exception.GetType().FullName;reason=if($_.Exception.Message -match '^[A-Z_]+$'){$_.Exception.Message}else{'SANITIZED_POST_VALIDATION_FAILURE'}}}
 }
})
$form.Add_FormClosing({if(-not $script:finished){$_.Cancel=$true;Note 'WAIT_FOR_OUTCOME' 'تا ثبت نتیجه، پنجره باز می‌ماند؛ هیچ فرآیندی متوقف نمی‌شود.'}})
$form.Add_Shown({[void][R80KVisibility]::ShowWindow($form.Handle,5);if(-not [R80KVisibility]::IsWindowVisible($form.Handle)){Finish 'UI_NOT_VISIBLE_NO_ACTION' @{uacOpened=$false};return};Note 'UI_VISIBLE_AWAITING_LOCAL_READY' 'درخواست قبلی پایان یافته است. هر زمان آماده بودید، دکمهٔ آمادگی را بزنید؛ سپس تأیید مدیر ویندوز را بررسی کنید.';$open.Enabled=$true})
[Windows.Forms.Application]::Run($form)
