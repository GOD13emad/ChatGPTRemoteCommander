# QA ONLY. Safe Win32 Desktop object probe; no SwitchDesktop, SendInput,
# SetThreadDesktop, window focus, screenshots, service install, or production use.
# A desktop object is NOT an isolated Windows user session or VM.
[CmdletBinding()]
param(
    [switch] $CreateTwoTemporaryDesktops
)
$ErrorActionPreference='Stop'
if(-not $IsWindows){ throw 'QA_WINDOWS_ONLY' }
if([Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0){
    throw 'QA_SESSION_ZERO_NOT_INTERACTIVE'
}
$src=@'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class RcWindowsDesktopObjectQa
{
    [DllImport("user32.dll", SetLastError=true)]
    private static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", SetLastError=true)]
    private static extern IntPtr GetThreadDesktop(uint dwThreadId);
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool GetUserObjectInformationW(IntPtr handle, int index,
        StringBuilder buffer, int capacityBytes, out int required);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern IntPtr CreateDesktopW(string name, IntPtr device,
        IntPtr devMode, uint flags, uint desiredAccess, IntPtr securityAttributes);
    [DllImport("user32.dll", SetLastError=true)]
    private static extern bool CloseDesktop(IntPtr desktop);

    private const uint DESKTOP_CREATEWINDOW = 0x0002;
    private const uint DESKTOP_READOBJECTS = 0x0001;
    private const uint DESKTOP_WRITEOBJECTS = 0x0080;
    public static string NameOf(IntPtr obj)
    {
        if(obj==IntPtr.Zero)return "<unavailable>";
        var buf=new StringBuilder(512);
        int required=0;
        if(!GetUserObjectInformationW(obj,2,buf,buf.Capacity*2,out required))
            return "WIN32_ERROR:"+Marshal.GetLastWin32Error();
        return buf.ToString();
    }
    public static string StationName(){return NameOf(GetProcessWindowStation());}
    public static string ThreadDesktopName(){
        return NameOf(GetThreadDesktop(GetCurrentThreadId()));
    }
    public static string ProbeTemporary(string name)
    {
        string result="UNKNOWN";
        var thread=new Thread(()=>{
            // Desktop objects remain invisible. Never call SwitchDesktop.
            var handle=CreateDesktopW(name,IntPtr.Zero,IntPtr.Zero,0,
                DESKTOP_CREATEWINDOW|DESKTOP_READOBJECTS|DESKTOP_WRITEOBJECTS,IntPtr.Zero);
            if(handle==IntPtr.Zero){
                result="CREATE_FAILED:"+Marshal.GetLastWin32Error();
                return;
            }
            string actual=NameOf(handle);
            bool closed=CloseDesktop(handle);
            result=actual+"|close="+closed.ToString()+
                (closed?"":"|closeError="+Marshal.GetLastWin32Error());
        });
        thread.IsBackground=true;
        thread.Start();
        if(!thread.Join(5000))return "PROBE_THREAD_TIMEOUT";
        return result;
    }
}
'@
Add-Type -TypeDefinition $src -ErrorAction Stop
$sessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId
$station=[RcWindowsDesktopObjectQa]::StationName()
$threadDesktop=[RcWindowsDesktopObjectQa]::ThreadDesktopName()
$results=[ordered]@{
    schema=1; platform='windows'; sessionId=$sessionId;
    station=$station; threadDesktop=$threadDesktop;
    inputNotSent=$true; switchDesktopNeverCalled=$true;
    created=@()
}
if($CreateTwoTemporaryDesktops){
    if($station -ne 'WinSta0'){
        throw "QA_REJECT_NONINTERACTIVE_STATION:$station"
    }
    for($i=0;$i -lt 2;$i++){
        $name=('RcQaDesk_'+[Guid]::NewGuid().ToString('N'))
        $out=[RcWindowsDesktopObjectQa]::ProbeTemporary($name)
        $results.created+=@([ordered]@{name=$name;actual=$out})
    }
}
$results | ConvertTo-Json -Depth 6 -Compress
