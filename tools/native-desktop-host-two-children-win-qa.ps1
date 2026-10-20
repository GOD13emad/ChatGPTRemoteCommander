# PRIVATE QA ONLY. Creates two temporary Win32 Desktop objects, launches two
# read-only PowerShell child probes via STARTUPINFO.lpDesktop, waits, closes
# private handles. Never SwitchDesktop, SetThreadDesktop, SendInput or focus.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
if(-not $IsWindows){throw 'WINDOWS_ONLY'}
$session=[Diagnostics.Process]::GetCurrentProcess().SessionId
if($session -eq 0){throw 'QA_NONINTERACTIVE_SESSION_REJECTED'}
$childScript=Join-Path $PSScriptRoot 'native-desktop-child-read-win-qa.ps1'
if(-not (Test-Path -LiteralPath $childScript)){throw 'CHILD_PROBE_MISSING'}
$exe=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
$cs=@'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;

public static class RcQaWinDesktopHost
{
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  private static extern IntPtr CreateDesktopW(string name,IntPtr device,IntPtr mode,
      uint flags,uint access,IntPtr security);
  [DllImport("user32.dll",SetLastError=true)]
  private static extern bool CloseDesktop(IntPtr hDesk);
  [DllImport("user32.dll",SetLastError=true)]
  private static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  private static extern bool GetUserObjectInformationW(IntPtr h,int idx,
      StringBuilder buf,int size,out int needed);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  private static extern bool CreateProcessW(string app,StringBuilder command,
      IntPtr procAttrs,IntPtr threadAttrs,bool inherit,uint flags,IntPtr env,
      string cwd,ref STARTUPINFO si,out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll",SetLastError=true)]
  private static extern uint WaitForSingleObject(IntPtr process,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)]
  private static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll",SetLastError=true)]
  private static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll",SetLastError=true)]
  private static extern bool CloseHandle(IntPtr h);
  [UnmanagedFunctionPointer(CallingConvention.Winapi)]
  private delegate bool WindowEnumerator(IntPtr hwnd,IntPtr data);
  [DllImport("user32.dll",SetLastError=true)]
  private static extern bool EnumDesktopWindows(IntPtr desktop,WindowEnumerator callback,IntPtr data);
  [DllImport("user32.dll",SetLastError=true)]
  private static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  private static extern int GetWindowTextW(IntPtr hwnd,StringBuilder text,int maxCount);
  private static string QaTitle="RC QA Hidden Window";
  // Enumerate the named non-input desktop passed as an explicit HDESK;
  // never enumerate active WinSta0\Default or arbitrary user windows.
  private static List<uint> ObserveQaWindowOwners(IntPtr desktop,out int error){
    var owners=new List<uint>();
    var callback=new WindowEnumerator((hwnd,extra)=>{
      uint owner;
      GetWindowThreadProcessId(hwnd,out owner);
      if(owner==0)return true;
      var title=new StringBuilder(256);
      if(GetWindowTextW(hwnd,title,title.Capacity)>0&&title.ToString()==QaTitle)
        owners.Add(owner);
      return true;
    });
    bool ok=EnumDesktopWindows(desktop,callback,IntPtr.Zero);
    error=ok?0:Marshal.GetLastWin32Error();
    GC.KeepAlive(callback);
    return owners;
  }

  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  private struct STARTUPINFO {
    public uint cb;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpReserved;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpDesktop;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpTitle;
    public uint dwX,dwY,dwXSize,dwYSize,dwXCountChars,dwYCountChars,dwFillAttribute,dwFlags;
    public ushort wShowWindow,cbReserved2;
    public IntPtr lpReserved2,hStdInput,hStdOutput,hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  private struct PROCESS_INFORMATION {
    public IntPtr hProcess,hThread;
    public uint dwProcessId,dwThreadId;
  }
  public sealed class Outcome {
    public string name {get;set;}
    public string outputPath {get;set;}
    public bool created {get;set;}
    public bool desktopClosed {get;set;}
    public uint childPid {get;set;}
    public uint exitCode {get;set;}
    public bool desktopEnumerationSucceeded {get;set;}
    public bool ownWindowObserved {get;set;}
    public string observedQaWindowPids {get;set;}
    public string error {get;set;}
  }
  public static string StationName(){
    IntPtr station=GetProcessWindowStation();
    var buf=new StringBuilder(256);int count;
    if(station==IntPtr.Zero||!GetUserObjectInformationW(station,2,buf,buf.Capacity*2,out count))
      return "WIN32_ERROR:"+Marshal.GetLastWin32Error();
    return buf.ToString();
  }
  public static Outcome One(string name,string exe,string script,string output,string cwd){
    var result=new Outcome{name=name,outputPath=output};
    IntPtr desktop=IntPtr.Zero;
    IntPtr process=IntPtr.Zero,thread=IntPtr.Zero;
    try{
      desktop=CreateDesktopW(name,IntPtr.Zero,IntPtr.Zero,0,0x0002|0x0001|0x0080,IntPtr.Zero);
      if(desktop==IntPtr.Zero){
        result.error="CREATE_DESKTOP:"+Marshal.GetLastWin32Error();return result;
      }
      result.created=true;
      // Restrict child to the named non-input desktop. No desktop switch.
      var si=new STARTUPINFO();
      si.cb=(uint)Marshal.SizeOf(typeof(STARTUPINFO));
      si.lpDesktop="WinSta0\\"+name;
      var cmd=new StringBuilder("\""+exe+"\" -NoLogo -NoProfile -NonInteractive -File \""+script+
        "\" -OutputPath \""+output+"\"");
      PROCESS_INFORMATION pi;
      // No console visible, no inherited HANDLEs, no shell interpretation.
      bool started=CreateProcessW(exe,cmd,IntPtr.Zero,IntPtr.Zero,false,
        0x08000000,IntPtr.Zero,cwd,ref si,out pi);
      if(!started){result.error="CREATE_PROCESS:"+Marshal.GetLastWin32Error();return result;}
      process=pi.hProcess;thread=pi.hThread;result.childPid=pi.dwProcessId;
      // The child keeps its hidden Win32 STATIC window alive briefly.
      // Observe it from THIS host thread through the explicit private HDESK.
      // This is genuine cross-process window enumeration, not mock DOM/frame.
      for(int attempt=0;attempt<43;attempt++){
        int enumError=0;
        var owners=ObserveQaWindowOwners(desktop,out enumError);
        if(enumError!=0){
          result.error="ENUM_DESKTOP:"+enumError;break;
        }
        result.desktopEnumerationSucceeded=true;
        result.observedQaWindowPids=String.Join(",",owners);
        if(owners.Contains(result.childPid)){
          result.ownWindowObserved=true;
          break;
        }
        Thread.Sleep(80);
      }
      uint wait=WaitForSingleObject(process,14000);
      if(wait!=0){
        result.error="CHILD_WAIT:"+wait;
        TerminateProcess(process,124);
        WaitForSingleObject(process,2000);
        return result;
      }
      uint exit;
      if(!GetExitCodeProcess(process,out exit)){result.error="GET_EXIT:"+Marshal.GetLastWin32Error();return result;}
      result.exitCode=exit;
      if(exit!=0)result.error="CHILD_EXIT:"+exit;
      return result;
    }catch(Exception e){
      result.error="QA_HOST:"+e.GetType().Name;
      return result;
    }finally{
      if(thread!=IntPtr.Zero)CloseHandle(thread);
      if(process!=IntPtr.Zero)CloseHandle(process);
      if(desktop!=IntPtr.Zero)result.desktopClosed=CloseDesktop(desktop);
    }
  }
  public static Outcome[] Two(string exe,string script,string outA,string outB,string cwd){
    string a="RcQaHost_"+Guid.NewGuid().ToString("N");
    string b="RcQaHost_"+Guid.NewGuid().ToString("N");
    var ta=Task.Run(()=>One(a,exe,script,outA,cwd));
    var tb=Task.Run(()=>One(b,exe,script,outB,cwd));
    if(!Task.WaitAll(new Task[]{ta,tb},19000))
      throw new InvalidOperationException("QA_TASK_WAIT_TIMEOUT");
    return new Outcome[]{ta.Result,tb.Result};
  }
}
'@
Add-Type -TypeDefinition $cs -ErrorAction Stop
$station=[RcQaWinDesktopHost]::StationName()
if($station -ne 'WinSta0'){throw "QA_REJECT_NONINTERACTIVE_STATION:$station"}
$dir=Join-Path ([IO.Path]::GetTempPath()) ("rc_win_desktop_host_qa_"+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dir -ErrorAction Stop | Out-Null
try{
  $f1=Join-Path $dir 'A.json'
  $f2=Join-Path $dir 'B.json'
  $outcomes=[RcQaWinDesktopHost]::Two($exe,$childScript,$f1,$f2,$PSScriptRoot)
  $children=@()
  foreach($record in $outcomes){
    $payload=$null
    if(Test-Path -LiteralPath $record.outputPath){
      $payload=Get-Content -LiteralPath $record.outputPath -Raw | ConvertFrom-Json
    }
    $children+=@([ordered]@{
      requestedDesktop=$record.name;desktopCreated=$record.created
      desktopHandleClosed=$record.desktopClosed;pid=$record.childPid
      childExitCode=$record.exitCode;error=$record.error;reported=$payload
      desktopEnumerationSucceeded=$record.desktopEnumerationSucceeded
      ownWindowObserved=$record.ownWindowObserved
      observedQaWindowPids=$record.observedQaWindowPids
      matched=($null -ne $payload -and $payload.desktop -eq $record.name -and
        $payload.hiddenWindowCreated -and $payload.hiddenWindowDestroyed -and
        $payload.hiddenWindowOwnerPid -eq $record.childPid -and $payload.windowsNotShown -and
        $record.desktopEnumerationSucceeded -and $record.ownWindowObserved -and
        $record.observedQaWindowPids -eq "$($record.childPid)")
    })
  }
  [ordered]@{
    schema=1;sessionId=$session;station=$station
    noSwitchDesktop=$true;noUserInput=$true
    children=$children
    pass=($children.Count -eq 2 -and
      @($children|Where-Object {-not $_.matched -or -not $_.desktopHandleClosed -or -not $_.desktopCreated}).Count -eq 0)
  }|ConvertTo-Json -Depth 7 -Compress
}finally{
  # Only removes the dedicated QA directory with two known observation files.
  $unexpected=@(Get-ChildItem -LiteralPath $dir -Force | Where-Object {$_.Name -notin @('A.json','B.json')})
  if($unexpected.Count -eq 0){
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction Stop
  }else{
    throw 'UNEXPECTED_QA_OUTPUT_FILES_LEFT_FOR_REVIEW'
  }
}
