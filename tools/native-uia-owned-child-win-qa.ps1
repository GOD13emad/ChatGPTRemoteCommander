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
    # Entirely synthetic single-line EDIT control on this worker's own inactive Desktop.
    # No caller-supplied target, focus, keyboard, mouse, desktop switch, or raw text receipt.
    if($env:RC_QA_UIA_VALUE_MODE -eq '1'){
      $sourceValue=@'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Automation;
public static class RcQaOwnedValuePattern {
 [StructLayout(LayoutKind.Sequential)]
 struct Msg {
   public IntPtr hwnd; public uint message; public IntPtr wParam,lParam;
   public uint time; public int x,y; public uint privateData;
 }
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern IntPtr CreateWindowExW(uint ex,string cls,string title,uint style,
   int x,int y,int width,int height,IntPtr parent,IntPtr menu,
   IntPtr instance,IntPtr param);
 [DllImport("user32.dll",SetLastError=true)]
 static extern bool DestroyWindow(IntPtr hwnd);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern int GetWindowTextW(IntPtr hwnd,StringBuilder b,int capacity);
 [DllImport("user32.dll")]
 static extern bool PeekMessageW(out Msg m,IntPtr hwnd,uint first,uint last,uint remove);
 [DllImport("user32.dll")]
 static extern bool TranslateMessage(ref Msg m);
 [DllImport("user32.dll")]
 static extern IntPtr DispatchMessageW(ref Msg m);
 public static bool ChangeOwnedEdit(IntPtr parent,int pid) {
   // WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_AUTOHSCROLL;
   IntPtr edit=CreateWindowExW(0,"EDIT","",0x50010080,0,0,28,20,
      parent,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
   if(edit==IntPtr.Zero)throw new Exception("QA_UIA_EDIT_CREATE_FAILED");
   try{
     string expected="RC_QA_VALUE_"+pid;
     Task<bool> action=Task.Run(()=>{
       var element=AutomationElement.FromHandle(edit);
       if(element==null||element.Current.ProcessId!=pid)
         throw new Exception("QA_UIA_EDIT_TARGET_MISMATCH");
       object pattern;
       if(!element.TryGetCurrentPattern(ValuePattern.Pattern,out pattern))
         throw new Exception("QA_UIA_VALUE_PATTERN_UNSUPPORTED");
       var value=(ValuePattern)pattern;
       if(value.Current.IsReadOnly||!element.Current.IsEnabled)
         throw new Exception("QA_UIA_VALUE_NOT_WRITABLE");
       value.SetValue(expected);
       return value.Current.Value==expected;
     });
     var elapsed=Stopwatch.StartNew();
     while(!action.IsCompleted&&elapsed.ElapsedMilliseconds<6500){
       Msg msg;
       while(PeekMessageW(out msg,IntPtr.Zero,0,0,1)){
         TranslateMessage(ref msg);DispatchMessageW(ref msg);
       }
       Task.Delay(8).Wait();
     }
     if(!action.IsCompleted)throw new Exception("QA_UIA_VALUE_TIMEOUT");
     if(!action.GetAwaiter().GetResult())
       throw new Exception("QA_UIA_READBACK_MISMATCH");
     var b=new StringBuilder(128);
     if(GetWindowTextW(edit,b,b.Capacity)<1||b.ToString()!=expected)
       throw new Exception("QA_UIA_NATIVE_READBACK_MISMATCH");
     return true;
   }finally{
     if(!DestroyWindow(edit))throw new Exception("QA_UIA_EDIT_DESTROY_FAILED");
   }
 }
}
'@
      Add-Type -TypeDefinition $sourceValue -ReferencedAssemblies 'UIAutomationClient','UIAutomationTypes' -ErrorAction Stop
      try{
        $nativeValueVerified=[RcQaOwnedValuePattern]::ChangeOwnedEdit($h,$PID)
      }catch{
        # Test-owned bounded receipt; no command, target text, token or native user data.
        $e=$_.Exception.GetBaseException()
        $msg=($e.GetType().Name+':'+$e.Message)
        if($msg.Length -gt 250){$msg=$msg.Substring(0,250)}
        $fail=Join-Path $root ('uia-fail-'+$PID+'.txt')
        [IO.File]::WriteAllText($fail,$msg)
        throw
      }
    }
    $title=[RcQaManagedUiaOwnWindow]::ReadOwned($h,$PID)
    $info=[ordered]@{
      schema=1;pid=$PID;titleVerified=($title -eq 'RC QA Persistent Hidden Window');
      uiaElementVerified=$true;effectMode='observation-only';
      noPhysicalInput=$true
    }
    if($env:RC_QA_UIA_VALUE_MODE -eq '1'){
      $info.effectMode='synthetic-valuepattern-only'
      $info.valuePatternVerified=$nativeValueVerified
      $info.nativeReadbackVerified=$nativeValueVerified
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
}catch{
  if($env:RC_QA_UIA_VALUE_MODE -eq '1' -and $root -and
     (Test-Path -LiteralPath $root -PathType Container)){
    $e=$_.Exception
    $detail=($e.GetType().Name+':'+$e.Message)
    if($detail.Length -gt 400){$detail=$detail.Substring(0,400)}
    [IO.File]::WriteAllText((Join-Path $root ('uia-fail-'+$PID+'.txt')),$detail)
  }
  throw
}finally{
  if(-not [RcQaOwnedUiaChild]::DestroyWindow($h)){
    throw 'QA_UIA_CHILD_DESTROY_FAILED'
  }
}
