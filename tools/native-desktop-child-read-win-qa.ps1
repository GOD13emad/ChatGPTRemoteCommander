# QA ONLY: report the Win32 Desktop assigned by the OS at process creation.
# No screenshot, SetThreadDesktop, SwitchDesktop, mouse or keyboard input.
[CmdletBinding()]
param([Parameter(Mandatory)][string]$OutputPath)
$ErrorActionPreference='Stop'
$src=@'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class RcWinChildDesktopReadQa {
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint tid);
 [DllImport("user32.dll")] public static extern IntPtr GetProcessWindowStation();
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 public static extern bool GetUserObjectInformationW(IntPtr h,int n,
      StringBuilder b,int len,out int needed);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 public static extern IntPtr CreateWindowExW(uint exStyle,string className,
   string title,uint style,int x,int y,int width,int height,
   IntPtr parent,IntPtr menu,IntPtr instance,IntPtr param);
 [DllImport("user32.dll",SetLastError=true)]
 public static extern bool DestroyWindow(IntPtr window);
 [DllImport("user32.dll",SetLastError=true)]
 public static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 public static bool TryCreateAndDestroyHiddenWindow(out uint ownerPid,
   out int createError,out bool destroyed){
   ownerPid=0;createError=0;destroyed=false;
   // Style=0 deliberately omits WS_VISIBLE. No ShowWindow or focus.
   IntPtr window=CreateWindowExW(0,"STATIC","RC QA Hidden Window",
     0,0,0,32,32,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
   if(window==IntPtr.Zero){createError=Marshal.GetLastWin32Error();return false;}
   GetWindowThreadProcessId(window,out ownerPid);
   // Keep the window resident for a bounded desktop-scoped host enumeration.
   // No message injection, focus or visual activation occurs.
   System.Threading.Thread.Sleep(2600);
   destroyed=DestroyWindow(window);
   return true;
 }
 public static string ObjectName(IntPtr h){
   if(h==IntPtr.Zero)return "<unavailable>";
   var b=new StringBuilder(256);int needed;
   if(!GetUserObjectInformationW(h,2,b,b.Capacity*2,out needed))
     return "WIN32_ERROR:"+Marshal.GetLastWin32Error();
   return b.ToString();
 }
}
'@
Add-Type -TypeDefinition $src -ErrorAction Stop
[uint32]$windowOwnerPid=0
[int]$windowCreateError=0
[bool]$windowDestroyed=$false
$windowCreated=[RcWinChildDesktopReadQa]::TryCreateAndDestroyHiddenWindow(
  [ref]$windowOwnerPid,[ref]$windowCreateError,[ref]$windowDestroyed)
$details=[ordered]@{
  schema=1
  pid=[Diagnostics.Process]::GetCurrentProcess().Id
  sessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId
  station=[RcWinChildDesktopReadQa]::ObjectName([RcWinChildDesktopReadQa]::GetProcessWindowStation())
  desktop=[RcWinChildDesktopReadQa]::ObjectName([RcWinChildDesktopReadQa]::GetThreadDesktop([RcWinChildDesktopReadQa]::GetCurrentThreadId()))
  inputNotSent=$true
  hiddenWindowCreated=$windowCreated
  hiddenWindowDestroyed=$windowDestroyed
  hiddenWindowOwnerPid=$windowOwnerPid
  hiddenWindowCreateError=$windowCreateError
  windowsNotShown=$true
}
[IO.File]::WriteAllText($OutputPath,($details|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
