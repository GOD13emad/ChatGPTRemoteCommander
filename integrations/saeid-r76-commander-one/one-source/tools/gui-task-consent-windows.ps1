[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][int]$OwnerPid,
  [Parameter(Mandatory=$true)][int]$TargetPid,
  [Parameter(Mandatory=$true)][long]$WindowId,
  [Parameter(Mandatory=$true)][ValidateSet('window_click','browser_click','browser_attach','native_set_value','native_invoke')][string]$Operation,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$RequestDigest,
  [Parameter(Mandatory=$true)][ValidateLength(1,100)][string]$TargetControl,
  [ValidateRange(10,90)][int]$TimeoutSeconds=45
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not $IsWindows){throw 'CONSENT_WINDOWS_ONLY'}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CommanderTaskWindowIdentity {
  [DllImport("user32.dll", SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
}
'@
$self=Get-Process -Id $PID -ErrorAction Stop
$owner=Get-Process -Id $OwnerPid -ErrorAction Stop
if($self.SessionId -le 0 -or $owner.SessionId -ne $self.SessionId){throw 'CONSENT_OWNER_SESSION_MISMATCH'}
if(-not [Security.Principal.WindowsIdentity]::GetCurrent().IsAuthenticated){throw 'CONSENT_OWNER_NOT_AUTHENTICATED'}
$targetProcess=Get-Process -Id $TargetPid -ErrorAction Stop
# The approved window must belong to the SAME interactive Windows principal and session.
if($targetProcess.SessionId -ne $self.SessionId){throw 'CONSENT_OWNER_SESSION_MISMATCH'}
$targetCim=Get-CimInstance Win32_Process -Filter ("ProcessId="+$TargetPid) -ErrorAction Stop
$sidInfo=Invoke-CimMethod -InputObject $targetCim -MethodName GetOwnerSid -ErrorAction Stop
if([int]$sidInfo.ReturnValue -ne 0 -or [string]$sidInfo.Sid -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value){throw 'CONSENT_TARGET_OWNER_MISMATCH'}
$handle=[IntPtr]::new($WindowId)
function Test-ExactWindow {
  if(-not [CommanderTaskWindowIdentity]::IsWindow($handle)){return $false}
  if(-not [CommanderTaskWindowIdentity]::IsWindowVisible($handle)){return $false}
  [uint32]$actual=0
  [void][CommanderTaskWindowIdentity]::GetWindowThreadProcessId($handle,[ref]$actual)
  return $actual -eq [uint32]$TargetPid
}
if(-not(Test-ExactWindow)){throw 'CONSENT_WINDOW_MISMATCH'}
$actionName=@{
 window_click='Click a control in this window'
 browser_click='Click an element in this browser window'
 browser_attach='Attach to an existing browser window'
 native_set_value='Set text in this exact browser editor'
 native_invoke='Invoke one control in this exact browser window'
}[$Operation]
$form=[Windows.Forms.Form]::new()
$form.Text='Commander - Native task authorization'
$form.StartPosition='CenterScreen'
$form.FormBorderStyle='FixedDialog'
$form.MaximizeBox=$false
$form.MinimizeBox=$false
$form.ShowInTaskbar=$true
$form.TopMost=$true
$form.Width=610
$form.Height=300
$head=[Windows.Forms.Label]::new()
$head.Left=18;$head.Top=18;$head.Width=555;$head.Height=36
$head.Text='Authorize ONE task-scoped action in your current Windows session?'
$form.Controls.Add($head)
$detail=[Windows.Forms.Label]::new()
$detail.Left=18;$detail.Top=62;$detail.Width=555;$detail.Height=108
$detail.Text="Application: $($targetProcess.ProcessName)    PID: $TargetPid"+[Environment]::NewLine+
  "Window HWND: $WindowId    Action: $actionName"+[Environment]::NewLine+
  "Control: $TargetControl"+[Environment]::NewLine+
  "Task ID hash: $($RequestDigest.Substring(0,12))   Expires automatically"
$form.Controls.Add($detail)
$warn=[Windows.Forms.Label]::new()
$warn.Left=18;$warn.Top=169;$warn.Width=555;$warn.Height=26
$warn.Text='No administrator rights requested. Deny is the default. No automatic approval.'
$form.Controls.Add($warn)
$accept=[Windows.Forms.Button]::new()
$accept.Left=306;$accept.Top=200;$accept.Width=124;$accept.Height=34
$accept.Text='Approve once'
$deny=[Windows.Forms.Button]::new()
$deny.Left=442;$deny.Top=200;$deny.Width=125;$deny.Height=34
$deny.Text='Deny'
$form.Controls.Add($accept);$form.Controls.Add($deny)
$form.CancelButton=$deny
$state=@{approved=$false;denied=$false;timedOut=$false}
$accept.Add_Click({
  $state.approved=$true
  $form.DialogResult=[Windows.Forms.DialogResult]::OK
  $form.Close()
})
$deny.Add_Click({
  $state.denied=$true
  $form.DialogResult=[Windows.Forms.DialogResult]::Cancel
  $form.Close()
})
$watch=[Diagnostics.Stopwatch]::StartNew()
$timer=[Windows.Forms.Timer]::new()
$timer.Interval=250
$timer.Add_Tick({
 if($watch.Elapsed.TotalSeconds -ge $TimeoutSeconds){
   $state.timedOut=$true
   $form.DialogResult=[Windows.Forms.DialogResult]::Cancel
   $form.Close()
 }
})
$timer.Start()
try{[void]$form.ShowDialog()}finally{$timer.Stop();$timer.Dispose();$form.Dispose();$watch.Stop()}
$windowStillMatches=Test-ExactWindow
$granted=$state.approved -and -not $state.denied -and -not $state.timedOut -and $windowStillMatches
$status=if(-not $windowStillMatches){'WINDOW_MISMATCH'}elseif($granted){'APPROVED'}elseif($state.timedOut){'EXPIRED'}else{'DENIED'}
[ordered]@{
 status=$status
 approved=[bool]$granted
 parentPid=$OwnerPid
 targetPid=$TargetPid
 windowId=$WindowId
 operation=$Operation
 requestDigest=$RequestDigest
 sessionId=[int]$self.SessionId
 ownerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 elapsedMs=[long]$watch.ElapsedMilliseconds
 approvedAtEpochMs=if($granted){[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}else{0}
}|ConvertTo-Json -Compress -Depth 3
