# Native Windows UI Automation semantic executor. No CUA, SendInput, focus or admin bypass.
# Based on standard Windows UIAutomation InvokePattern; called within the exact owner session.
[CmdletBinding()]
param(
 [Parameter(Mandatory)][ValidateSet('Observe','Invoke')][string]$Operation,
 [Parameter(Mandatory)][ValidateRange(1,2147483647)][int]$TargetPid,
 [Parameter(Mandatory)][ValidateRange(1,9223372036854775807)][long]$WindowHandle,
 [ValidateRange(1,100)][int]$MaxElements=70,
 [string]$Fingerprint='',
 [string]$ControlName='',
 [string]$RequestId='',
 [string]$ExplicitUserAuthorization=''
)
$ErrorActionPreference='Stop'
function Refuse([string]$code){throw $code}
if(-not $IsWindows){Refuse 'AGENTOS_WINDOWS_REQUIRED'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if($identity.IsSystem -or (Get-Process -Id $PID).SessionId -eq 0){Refuse 'AGENTOS_INTERACTIVE_OWNER_REQUIRED'}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if(-not ('RcAgentOSWindows' -as [type])){
 Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RcAgentOSWindows {
 [DllImport("user32.dll", SetLastError=true)]
 public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
 [DllImport("user32.dll")]
 public static extern IntPtr GetForegroundWindow();
}
'@
}
function Get-ForegroundEvidence([IntPtr]$before,[IntPtr]$after){
 if($before -eq [IntPtr]::Zero -or $after -eq [IntPtr]::Zero){
  return @{state='UNOBSERVABLE';touched=$null}
 }
 $changed=$before -ne $after
 return @{state=$(if($changed){'CHANGED'}else{'PRESERVED'});touched=$changed}
}
$foregroundBefore=[RcAgentOSWindows]::GetForegroundWindow()
$nativePid=[uint32]0
$hwnd=[IntPtr]$WindowHandle
[void][RcAgentOSWindows]::GetWindowThreadProcessId($hwnd,[ref]$nativePid)
if($nativePid -ne $TargetPid){Refuse 'AGENTOS_EXACT_WINDOW_PID_MISMATCH'}
$root=[System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if($null -eq $root -or $root.Current.ProcessId -ne $TargetPid){Refuse 'AGENTOS_WINDOW_OWNER_INVALID'}
if($root.Current.IsPassword){Refuse 'AGENTOS_PROTECTED_TARGET'}
$children=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
if($children.Count -gt 3000){Refuse 'AGENTOS_ACCESSIBILITY_TREE_OVERSIZED'}
function Fingerprint([System.Windows.Automation.AutomationElement]$element){
 $c=$element.Current
 $id=@($element.GetRuntimeId()) -join '.'
 $key="$TargetPid|$WindowHandle|$id|$($c.AutomationId)|$($c.ControlType.ProgrammaticName)|$($c.Name)"
 $hasher=[System.Security.Cryptography.SHA256]::Create()
 try{
  $bytes=$hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($key))
  return [Convert]::ToHexString($bytes).Substring(0,24).ToLowerInvariant()
 }finally{$hasher.Dispose()}
}
$elements=[System.Collections.Generic.List[object]]::new()
$matchedControls=[System.Collections.Generic.List[object]]::new()
for($i=0;$i -lt $children.Count;$i++){
 $element=$children.Item($i)
 try{
  $c=$element.Current
  if($c.ProcessId -ne $TargetPid -or $c.IsPassword){continue}
  $kind=[string]$c.ControlType.ProgrammaticName
  $name=[string]$c.Name
  if($name.Length -gt 150){$name=$name.Substring(0,150)}
  $automationId=[string]$c.AutomationId
  $pattern=$null
  $canInvoke=$element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)
  if(-not $canInvoke -and $Operation -eq 'Observe'){continue}
  $finger=Fingerprint $element
  if($Operation -eq 'Observe'){
   if($elements.Count -lt $MaxElements){
    $elements.Add([pscustomobject]@{name=$name;automationId=$automationId;controlType=$kind;enabled=[bool]$c.IsEnabled;fingerprint=$finger;invokeAvailable=[bool]$canInvoke})
   }
  }elseif($finger -ceq $Fingerprint -and $name -ceq $ControlName -and $canInvoke -and $c.IsEnabled){
   $matchedControls.Add([pscustomobject]@{element=$element;pattern=$pattern})
  }
 }catch [System.Windows.Automation.ElementNotAvailableException]{continue}
}
if($Operation -eq 'Observe'){
 $foregroundEvidence=Get-ForegroundEvidence $foregroundBefore ([RcAgentOSWindows]::GetForegroundWindow())
 [pscustomobject]@{ok=$true;mode='NATIVE_UIA_OBSERVE';provider='windows-uia-native';pid=$TargetPid;windowHandle=$WindowHandle;totalScanned=$children.Count;elements=$elements.ToArray();truncated=$elements.Count -ge $MaxElements;principal=$identity.Name;foregroundStatus=$foregroundEvidence.state;foregroundTouched=$foregroundEvidence.touched;physicalInputTouched=$false}|ConvertTo-Json -Depth 6 -Compress
 exit 0
}
if($RequestId -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' -or
 $ExplicitUserAuthorization.Trim().Length -lt 12 -or
 $Fingerprint -cnotmatch '^[a-f0-9]{24}$' -or $ControlName.Length -eq 0){
 Refuse 'AGENTOS_EXPLICIT_MUTATION_CONTRACT_REQUIRED'
}
if($matchedControls.Count -ne 1){Refuse 'AGENTOS_FRESH_EXACT_UIA_ELEMENT_REQUIRED'}
# UIA InvokePattern can indirectly activate an application's window.
# Measure visible foreground before and after rather than claim no focus impact.
$foregroundImmediatelyBefore=[RcAgentOSWindows]::GetForegroundWindow()
([System.Windows.Automation.InvokePattern]$matchedControls[0].pattern).Invoke()
Start-Sleep -Milliseconds 130
$foregroundEvidence=Get-ForegroundEvidence $foregroundImmediatelyBefore ([RcAgentOSWindows]::GetForegroundWindow())
[pscustomobject]@{ok=$true;mode='NATIVE_UIA_INVOKE';provider='windows-uia-native';pid=$TargetPid;windowHandle=$WindowHandle;requestId=$RequestId;controlName=$ControlName;invocationIssued=$true;userGoalVerified=$false;foregroundStatus=$foregroundEvidence.state;foregroundTouched=$foregroundEvidence.touched;physicalInputTouched=$false}|ConvertTo-Json -Compress
