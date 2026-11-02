# Scoped native Windows accessibility QA worker (candidate, NOT public MCP).
# JSON stdin for Probe/Invoke. Runs only in the selected interactive owner
# session. No global mouse/keyboard, focus, browser profiles or elevation.
[CmdletBinding()]
param(
 [ValidateSet('Probe','Invoke','Fixture')][string]$Mode='Probe',
 [string]$ReadyPath,
 [string]$ProofPath,
 [switch]$PanelAccessibility
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ScopedNativeWindow {
 public delegate bool EnumChildProc(IntPtr hwnd,IntPtr param);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr child);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd,StringBuilder s,int max);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd,StringBuilder s,int max);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hwnd,EnumChildProc cb,IntPtr state);
 [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SendMessageTimeout(
    IntPtr hwnd,uint message,IntPtr wparam,IntPtr lparam,uint flags,uint timeout,out IntPtr response);
 public static string Title(IntPtr h){var b=new StringBuilder(300);GetWindowText(h,b,b.Capacity);return b.ToString();}
 public static string Class(IntPtr h){var b=new StringBuilder(300);GetClassName(h,b,b.Capacity);return b.ToString();}
}
public sealed class ScopedNoActivateForm : System.Windows.Forms.Form {
 protected override bool ShowWithoutActivation {get{return true;}}
 protected override System.Windows.Forms.CreateParams CreateParams {
  get {var p=base.CreateParams;p.ExStyle|=0x08000000;return p;}
 }
}
'@ -ReferencedAssemblies @('System.Windows.Forms','System.Drawing','System.ComponentModel.Primitives','System.Runtime','System.Drawing.Primitives')
function Refuse([string]$code) { throw $code }
function FixedWindow([object]$r) {
 if($null -eq $r -or $r.schema -ne 1 -or $r.pid -isnot [long] -and $r.pid -isnot [int]) { Refuse 'QA_REQUEST_INVALID' }
 if($r.pid -lt 1 -or [string]$r.hwnd -notmatch '^[1-9][0-9]{0,18}$' -or
    [string]$r.startTicks -notmatch '^[1-9][0-9]{0,19}$' -or
    -not ($r.title -is [string]) -or $r.title.Length -lt 4 -or $r.title.Length -gt 180) {
    Refuse 'QA_TARGET_IDENTITY_INVALID'
 }
 $process=[Diagnostics.Process]::GetProcessById([int]$r.pid)
 if($process.SessionId -ne [Diagnostics.Process]::GetCurrentProcess().SessionId -or
    $process.SessionId -le 0 -or
    $process.StartTime.ToUniversalTime().Ticks.ToString() -cne [string]$r.startTicks) {
  Refuse 'QA_OWNER_SESSION_OR_GENERATION_MISMATCH'
 }
 $hwnd=[IntPtr]::new([long]::Parse([string]$r.hwnd))
 [uint32]$windowOwnerPid=0
 [void][ScopedNativeWindow]::GetWindowThreadProcessId($hwnd,[ref]$windowOwnerPid)
 if(-not [ScopedNativeWindow]::IsWindow($hwnd) -or $windowOwnerPid -ne $r.pid -or
    -not [ScopedNativeWindow]::IsWindowVisible($hwnd) -or
    [ScopedNativeWindow]::Title($hwnd) -cne $r.title) {
  Refuse 'QA_OWNER_WINDOW_CHANGED'
 }
 return $hwnd
}
function ResolveButton([IntPtr]$hwnd,[object]$r) {
 $found=[Collections.Generic.List[IntPtr]]::new()
 $callback=[ScopedNativeWindow+EnumChildProc]{
  param([IntPtr]$child,[IntPtr]$unused)
  [uint32]$windowOwnerPid=0
  [void][ScopedNativeWindow]::GetWindowThreadProcessId($child,[ref]$windowOwnerPid)
  $klass=[ScopedNativeWindow]::Class($child)
  $label=[ScopedNativeWindow]::Title($child)
  if($windowOwnerPid -eq [uint32]$r.pid -and $klass -match '^(Button|WindowsForms10\.BUTTON\.)' -and
    $label -ceq 'Apply' -and [ScopedNativeWindow]::IsWindowVisible($child)) {
    $found.Add($child)
  }
  return $true
 }
 [void][ScopedNativeWindow]::EnumChildWindows($hwnd,$callback,[IntPtr]::Zero)
 if($found.Count -ne 1) { Refuse 'QA_BUTTON_NOT_UNIQUE' }
 return $found[0]
}
function Inspect([object]$r) {
 $window=FixedWindow $r
 $button=ResolveButton $window $r
 [bool]$uiaInvoke=$false
 try {
  $el=[System.Windows.Automation.AutomationElement]::FromHandle($button)
  $pattern=$null
  if($null -ne $el) {
   $uiaInvoke=$el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)
  }
 } catch { $uiaInvoke=$false }
 return [ordered]@{
  ok=$true; schema=1; pid=[int]$r.pid; hwnd=[string]$r.hwnd;
  elementHandle=$button.ToInt64().ToString(); role='button';name='Apply';
  uiaInvokeAvailable=$uiaInvoke; win32Bound=$true; targetBound=$true
 }
}
if($Mode -eq 'Fixture') {
 if(-not $ReadyPath -or -not $ProofPath -or -not [IO.Path]::IsPathRooted($ReadyPath) -or
    -not [IO.Path]::IsPathRooted($ProofPath)) { Refuse 'QA_FIXTURE_PATH_REQUIRED' }
 $form=[ScopedNoActivateForm]::new()
 $form.Text='Commander V2 Native QA'
 $form.Width=320;$form.Height=180;$form.ShowInTaskbar=$false
 $button=[System.Windows.Forms.Button]::new()
 $button.Text='Apply';$button.Width=110;$button.Height=40
 if($PanelAccessibility){$button.AccessibleRole=[System.Windows.Forms.AccessibleRole]::Pane}
 $button.Location=[Drawing.Point]::new(30,30)
 $button.Add_Click({[IO.File]::WriteAllText($ProofPath,'APPLY_CLICKED')})
 $form.Controls.Add($button)
 $form.Show()
 $process=[Diagnostics.Process]::GetCurrentProcess()
 $ready=[ordered]@{
  schema=1;pid=$process.Id;hwnd=$form.Handle.ToInt64().ToString();
  startTicks=$process.StartTime.ToUniversalTime().Ticks.ToString();
  title=$form.Text
 }
 [IO.File]::WriteAllText($ReadyPath,($ready|ConvertTo-Json -Compress))
 [System.Windows.Forms.Application]::Run($form)
 exit 0
}
$raw=[Console]::In.ReadToEnd()
if([string]::IsNullOrWhiteSpace($raw) -or $raw.Length -gt 4000){Refuse 'QA_REQUEST_INVALID'}
$r=$raw|ConvertFrom-Json -ErrorAction Stop
$observation=Inspect $r
if($Mode -eq 'Probe') {
 $observation|ConvertTo-Json -Compress -Depth 6
 exit 0
}
if($Mode -ne 'Invoke' -or [string]$r.elementHandle -cne [string]$observation.elementHandle -or
   [string]$r.method -notin @('uia','win32')) {
 Refuse 'QA_INVOKE_SELECTION_INVALID'
}
$element=[IntPtr]::new([long]::Parse($observation.elementHandle))
if(-not [ScopedNativeWindow]::IsChild([IntPtr]::new([long]::Parse($r.hwnd)),$element)){
 Refuse 'QA_ELEMENT_NOT_IN_OWNER_WINDOW'
}
if($r.method -eq 'uia') {
 if(-not $observation.uiaInvokeAvailable){Refuse 'QA_UIA_INVOKE_NOT_SUPPORTED'}
 $uia=[System.Windows.Automation.AutomationElement]::FromHandle($element)
 $pattern=$null
 if(-not $uia.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) {
  Refuse 'QA_UIA_PATTERN_CHANGED'
 }
 ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
} else {
 # BM_CLICK is window-targeted and does not use SendInput or steal focus.
 [IntPtr]$response=[IntPtr]::Zero
 $ret=[ScopedNativeWindow]::SendMessageTimeout($element,0x00F5,[IntPtr]::Zero,
  [IntPtr]::Zero,0x0002,900,[ref]$response)
 if($ret -eq [IntPtr]::Zero) {Refuse 'QA_WIN32_EFFECT_UNCERTAIN'}
}
[ordered]@{ok=$true;schema=1;effect='DISPATCHED';method=$r.method;targetBound=$true}|
 ConvertTo-Json -Compress
