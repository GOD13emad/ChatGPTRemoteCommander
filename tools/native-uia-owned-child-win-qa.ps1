# QA ONLY. This process is launched by the bounded Desktop host INTO its own
# non-active WinSta0 Desktop. Never switches desktop, injects input or inspects user windows.
[CmdletBinding()]
param([Parameter(Mandatory)][string]$StopEvent,
      [Parameter(Mandatory)][int]$ParentPid)
$ErrorActionPreference='Stop'
if(-not $IsWindows -or $ParentPid -le 0 -or
   $StopEvent -notmatch '^Local\\RcQaDesktopStop_[a-f0-9]{32}$'){
  throw 'QA_UIA_CHILD_ARGUMENT_DENIED'
}
$src=@'
using System;
using System.Runtime.InteropServices;
public static class RcQaOwnedUiaChild {
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  public static extern IntPtr CreateWindowExW(uint ex,string cls,string title,
    uint style,int x,int y,int width,int height,IntPtr parent,IntPtr menu,
    IntPtr instance,IntPtr param);
  [DllImport("user32.dll",SetLastError=true)]
  public static extern bool DestroyWindow(IntPtr hwnd);
}
'@
Add-Type -TypeDefinition $src -ErrorAction Stop
$h=[RcQaOwnedUiaChild]::CreateWindowExW(0,'STATIC',
 'RC QA Persistent Hidden Window',0,0,0,32,32,
 [IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero)
if($h -eq [IntPtr]::Zero){throw 'QA_UIA_CHILD_WINDOW_FAILED'}
try {
  $receipt=$env:RC_QA_UIA_RECEIPT_DIR
  if($receipt){
    $root=[IO.Path]::GetFullPath($receipt)
    $temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if(-not $root.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($root) -notmatch '^rcqa-uia-owned-[A-Za-z0-9]{6,24}$' -or
      -not (Test-Path -LiteralPath $root -PathType Container)){
      throw 'QA_UIA_RECEIPT_ROOT_DENIED'
    }
    Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
    $helper=@'
using System;
using System.Threading.Tasks;
using System.Windows.Automation;
public static class RcQaManagedUiaOwnWindow {
  public static string ReadOwned(IntPtr hwnd,int pid) {
    var t=Task.Run(()=>{
      var e=AutomationElement.FromHandle(hwnd);
      if(e==null)throw new Exception("QA_UIA_NULL_ELEMENT");
      var c=e.Current;
      if(c.ProcessId!=pid||c.Name!="RC QA Persistent Hidden Window")
        throw new Exception("QA_UIA_UNEXPECTED_ELEMENT");
      return c.Name;
    });
    if(!t.Wait(4500))throw new Exception("QA_UIA_INSPECTION_TIMEOUT");
    return t.Result;
  }
}
'@
    Add-Type -TypeDefinition $helper -ReferencedAssemblies 'UIAutomationClient' -ErrorAction Stop
    $title=[RcQaManagedUiaOwnWindow]::ReadOwned($h,$PID)
    $info=[ordered]@{
      schema=1;pid=$PID;titleVerified=($title -eq 'RC QA Persistent Hidden Window');
      uiaElementVerified=$true;effectMode='observation-only';
      noPhysicalInput=$true
    }
    $json=($info|ConvertTo-Json -Compress)
    $file=Join-Path $root ('uia-'+$PID+'.json')
    $bytes=[Text.Encoding]::UTF8.GetBytes($json)
    $stream=[IO.File]::Open($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}
    finally{$stream.Dispose()}
  }
  $event=[Threading.EventWaitHandle]::OpenExisting($StopEvent)
  try {
    $watch=[Diagnostics.Stopwatch]::StartNew()
    while($watch.ElapsedMilliseconds -lt 70000){
      if($event.WaitOne(250)){break}
      try{if([Diagnostics.Process]::GetProcessById($ParentPid).HasExited){break}}
      catch{break}
    }
  }finally{$event.Dispose()}
}finally{
  if(-not [RcQaOwnedUiaChild]::DestroyWindow($h)){
    throw 'QA_UIA_CHILD_DESTROY_FAILED'
  }
}
