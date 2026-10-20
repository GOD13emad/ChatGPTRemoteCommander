# PRIVATE WINDOWS QA. Child creates one HIDDEN Win32 STATIC window on its
# assigned Desktop, then waits for the parent's stop event. No input, focus,
# screenshot, active desktop switches, application launch or user interaction.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$StopEvent,
  [Parameter(Mandatory)][int]$ParentPid
)
$ErrorActionPreference='Stop'
if(-not $IsWindows -or $ParentPid -le 0 -or
   $StopEvent -notmatch '^Local\\RcQaDesktopStop_[a-f0-9]{32}$'){
  throw 'QA_CHILD_ARGUMENT_REJECTED'
}
$code=@'
using System;
using System.Runtime.InteropServices;
public static class RcQaLiveDesktopChild {
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 public static extern IntPtr CreateWindowExW(uint ex,string cls,string title,
   uint style,int x,int y,int width,int height,IntPtr parent,IntPtr menu,
   IntPtr instance,IntPtr param);
 [DllImport("user32.dll",SetLastError=true)]
 public static extern bool DestroyWindow(IntPtr hwnd);
}
'@
Add-Type -TypeDefinition $code
$h=[RcQaLiveDesktopChild]::CreateWindowExW(0,'STATIC',
    'RC QA Persistent Hidden Window',0,0,0,32,32,
    [IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero)
if($h -eq [IntPtr]::Zero){throw 'QA_CHILD_WINDOW_CREATION_FAILED'}
try{
  $signal=[Threading.EventWaitHandle]::OpenExisting($StopEvent)
  try{
    $start=[Diagnostics.Stopwatch]::StartNew()
    while($start.ElapsedMilliseconds -lt 70000){
      if($signal.WaitOne(250)){break}
      try{
        if([Diagnostics.Process]::GetProcessById($ParentPid).HasExited){break}
      }catch{break}
    }
  }finally{$signal.Dispose()}
}finally{
  if(-not [RcQaLiveDesktopChild]::DestroyWindow($h)){
    throw 'QA_CHILD_WINDOW_CLEANUP_FAILED'
  }
}
