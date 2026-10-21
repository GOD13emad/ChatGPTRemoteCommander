// QA ONLY. Retained Win32 desktop-object host, two private hidden windows,
// observation-only current-SID named pipe, bounded lifetime and clean close.
// This does NOT implement authenticated ChatGPT sessions, isolated credentials,
// pixel capture, mouse/keyboard/focus changes or native action dispatch.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

public static class RcQaRetainedDesktopPipeHost
{
  const uint WAIT_OBJECT_0=0;
  const uint WAIT_TIMEOUT=0x102;
  const string QaTitle="RC QA Persistent Hidden Window";
  const uint DesktopAccess=0x0001|0x0002|0x0040|0x0080;

  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  static extern IntPtr CreateDesktopW(string name,IntPtr device,IntPtr mode,
    uint flags,uint access,IntPtr security);
  [DllImport("user32.dll",SetLastError=true)]
  static extern bool CloseDesktop(IntPtr hDesk);
  [DllImport("user32.dll",SetLastError=true)]
  static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  static extern bool GetUserObjectInformationW(IntPtr h,int index,
    StringBuilder str,int length,out int required);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  static extern bool CreateProcessW(string exe,StringBuilder cmd,IntPtr pa,
    IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,
    ref STARTUPINFO si,out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll",SetLastError=true)]
  static extern bool GetNamedPipeClientProcessId(SafePipeHandle handle,out uint pid);
  [DllImport("kernel32.dll",SetLastError=true)]
  static extern bool GetNamedPipeClientSessionId(SafePipeHandle handle,out uint session);
  [DllImport("kernel32.dll",SetLastError=true)]
  static extern uint WaitForSingleObject(IntPtr h,uint milliseconds);
  [DllImport("kernel32.dll",SetLastError=true)]
  static extern bool TerminateProcess(IntPtr h,uint exitCode);
  [DllImport("kernel32.dll",SetLastError=true)]
  static extern bool CloseHandle(IntPtr h);
  [UnmanagedFunctionPointer(CallingConvention.Winapi)]
  delegate bool EnumFn(IntPtr hwnd,IntPtr context);
  [DllImport("user32.dll",SetLastError=true)]
  static extern bool EnumDesktopWindows(IntPtr hDesk,EnumFn callback,IntPtr context);
  [DllImport("user32.dll",SetLastError=true)]
  static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint ownerPid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  static extern int GetWindowTextW(IntPtr hwnd,StringBuilder buffer,int count);

  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
  struct STARTUPINFO {
    public uint cb;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpReserved;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpDesktop;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpTitle;
    public uint x,y,xsize,ysize,xchars,ychars,fill,flags;
    public ushort show,reserved;
    public IntPtr reserved2,stdin,stdout,stderr;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION {
    public IntPtr process,thread;
    public uint pid,tid;
  }
  sealed class Workspace {
    public string name="",desktopName="";
    public IntPtr desktop=IntPtr.Zero,process=IntPtr.Zero;
    public uint pid=0;
    public EventWaitHandle stop=null;
  }

  static string StationName(){
    var b=new StringBuilder(256);
    int required;
    var ptr=GetProcessWindowStation();
    if(ptr==IntPtr.Zero||!GetUserObjectInformationW(ptr,2,b,b.Capacity*2,out required))
      throw new InvalidOperationException("QA_NO_WINDOW_STATION");
    return b.ToString();
  }
  static Workspace StartOne(string label,string exe,string script,int hostPid,string workingDir){
    var w=new Workspace();
    w.name=label;
    w.desktopName="RcQaPersist_"+Guid.NewGuid().ToString("N");
    try{
      w.desktop=CreateDesktopW(w.desktopName,IntPtr.Zero,IntPtr.Zero,0,
        DesktopAccess,IntPtr.Zero);
      if(w.desktop==IntPtr.Zero)
        throw new InvalidOperationException("CREATE_DESKTOP_"+Marshal.GetLastWin32Error());
      string stopName="Local\\RcQaDesktopStop_"+Guid.NewGuid().ToString("N");
      w.stop=new EventWaitHandle(false,EventResetMode.ManualReset,stopName);
      var si=new STARTUPINFO();
      si.cb=(uint)Marshal.SizeOf(typeof(STARTUPINFO));
      si.lpDesktop="WinSta0\\"+w.desktopName;
      // User data cannot influence the executable, desktop, args or script.
      var cmd=new StringBuilder("\""+exe+"\" -NoLogo -NoProfile -NonInteractive -File \""+
        script+"\" -StopEvent \""+stopName+"\" -ParentPid "+hostPid);
      PROCESS_INFORMATION pi;
      bool ok=CreateProcessW(exe,cmd,IntPtr.Zero,IntPtr.Zero,false,
        0x08000000,IntPtr.Zero,workingDir,ref si,out pi);
      if(!ok)throw new InvalidOperationException("CREATE_CHILD_"+Marshal.GetLastWin32Error());
      w.process=pi.process; w.pid=pi.pid;
      CloseHandle(pi.thread);
      return w;
    }catch{
      CleanupOne(w);
      throw;
    }
  }
  static void CleanupOne(Workspace w){
    try{w.stop?.Set();}catch{}
    if(w.process!=IntPtr.Zero){
      try{
        if(WaitForSingleObject(w.process,2500)!=WAIT_OBJECT_0){
          TerminateProcess(w.process,124);
          WaitForSingleObject(w.process,2500);
        }
      }catch{}
      CloseHandle(w.process);
      w.process=IntPtr.Zero;
    }
    try{w.stop?.Dispose();}catch{}
    if(w.desktop!=IntPtr.Zero){
      if(!CloseDesktop(w.desktop))
        Console.Error.WriteLine("QA_CLOSE_DESKTOP_FAILED");
      w.desktop=IntPtr.Zero;
    }
  }
  static int[] Owners(Workspace w){
    if(w.process==IntPtr.Zero||WaitForSingleObject(w.process,0)!=WAIT_TIMEOUT)
      throw new InvalidOperationException("QA_WORKER_NOT_RUNNING");
    var found=new List<int>();
    var callback=new EnumFn((hwnd,ctx)=>{
      uint pid;
      GetWindowThreadProcessId(hwnd,out pid);
      var title=new StringBuilder(128);
      if(pid!=0&&GetWindowTextW(hwnd,title,title.Capacity)>0&&
        title.ToString()==QaTitle)found.Add((int)pid);
      return true;
    });
    bool success=EnumDesktopWindows(w.desktop,callback,IntPtr.Zero);
    GC.KeepAlive(callback);
    if(!success)throw new InvalidOperationException("QA_ENUM_FAILED_"+Marshal.GetLastWin32Error());
    return found.ToArray();
  }
  static bool Ready(Workspace w){
    try{
      var owners=Owners(w);
      return owners.Length==1&&owners[0]==(int)w.pid;
    }catch{return false;}
  }
  static string Details(Workspace w){
    var owners=Owners(w);
    bool isolated=owners.Length==1&&owners[0]==(int)w.pid;
    return "{\"workspace\":\""+w.name+"\",\"desktop\":\""+w.desktopName+
      "\",\"pid\":"+w.pid+",\"windowCount\":"+owners.Length+
      ",\"ownWindow\":"+(isolated?"true":"false")+
      ",\"effectMode\":\"observation-only\"}";
  }
  static string Response(string command,Workspace[] work,int sessionId,uint clientPid,uint clientSession){
    if(command=="peer")return "{\"ok\":true,\"transport\":\"win32-named-pipe\",\"clientPid\":"+clientPid+",\"clientSession\":"+clientSession+"}";
    if(command=="observeA")return "{\"ok\":true,\"hostSession\":"+sessionId+
      ",\"result\":"+Details(work[0])+"}";
    if(command=="observeB")return "{\"ok\":true,\"hostSession\":"+sessionId+
      ",\"result\":"+Details(work[1])+"}";
    if(command=="status"){
      return "{\"ok\":true,\"hostSession\":"+sessionId+",\"workers\":["+
        Details(work[0])+","+Details(work[1])+"]}";
    }
    return "{\"ok\":false,\"code\":\"QA_COMMAND_DENIED\"}";
  }

  public static int Run(string pipeName,string pwsh,string childScript,int ttlMs){
    if(!Regex.IsMatch(pipeName??"","^rc_qa_desk_[a-f0-9]{32}$")||
       ttlMs<1000||ttlMs>60000||!File.Exists(pwsh)||!File.Exists(childScript))
      throw new InvalidOperationException("QA_HOST_ARGUMENT_INVALID");
    int sessionId=Process.GetCurrentProcess().SessionId;
    if(sessionId==0||StationName()!="WinSta0")
      throw new InvalidOperationException("QA_NONINTERACTIVE_REJECTED");
    Workspace[] workers=new Workspace[2];
    try{
      string cwd=Path.GetDirectoryName(childScript);
      int hostPid=Process.GetCurrentProcess().Id;
      // Two separate desktop creation threads, each with its own private HDESK.
      var a=Task.Run(()=>StartOne("A",pwsh,childScript,hostPid,cwd));
      var b=Task.Run(()=>StartOne("B",pwsh,childScript,hostPid,cwd));
      try{Task.WaitAll(new Task[]{a,b},12000);}
      catch(AggregateException){throw;}
      workers[0]=a.IsCompletedSuccessfully?a.Result:null;
      workers[1]=b.IsCompletedSuccessfully?b.Result:null;
      if(workers[0]==null||workers[1]==null)
        throw new InvalidOperationException("QA_START_TIMEOUT");
      var readyTimer=Stopwatch.StartNew();
      while(readyTimer.ElapsedMilliseconds<9000){
        if(Ready(workers[0])&&Ready(workers[1]))break;
        Thread.Sleep(80);
      }
      if(!Ready(workers[0])||!Ready(workers[1]))
        throw new InvalidOperationException("QA_CHILD_NOT_READY");
      Console.WriteLine("{\"ready\":true,\"hostPid\":"+hostPid+
        ",\"sessionId\":"+sessionId+",\"pipe\":\""+pipeName+"\"}");
      Console.Out.Flush();
      var elapsed=Stopwatch.StartNew();
      bool done=false;
      while(!done&&elapsed.ElapsedMilliseconds<ttlMs){
        int remaining=ttlMs-(int)elapsed.ElapsedMilliseconds;
        using(var pipe=new NamedPipeServerStream(pipeName,PipeDirection.InOut,1,
          PipeTransmissionMode.Byte,PipeOptions.CurrentUserOnly)){
          using(var cancel=new CancellationTokenSource()){
            cancel.CancelAfter(Math.Min(remaining,8000));
            try{pipe.WaitForConnectionAsync(cancel.Token).GetAwaiter().GetResult();}
            catch(OperationCanceledException){continue;}
          }
          // OS-reported peer identity. CurrentUserOnly is necessary but not
          // sufficient to bind a particular process/session to a request.
          // This only attests a transport peer, NEVER a ChatGPT conversation.
          uint clientPid,clientSession;
          if(!GetNamedPipeClientProcessId(pipe.SafePipeHandle,out clientPid)||
             !GetNamedPipeClientSessionId(pipe.SafePipeHandle,out clientSession)||
             clientPid==0||clientSession!=(uint)sessionId)continue;
          try{
            using(var reader=new StreamReader(pipe,Encoding.UTF8,false,1024,true))
            using(var writer=new StreamWriter(pipe,new UTF8Encoding(false),1024,true)){
              writer.AutoFlush=true;
              string cmd;
              using(var cancel=new CancellationTokenSource(1800)){
                try{cmd=reader.ReadLineAsync(cancel.Token).GetAwaiter().GetResult();}
                catch(OperationCanceledException){continue;}
              }
              // A disconnected client cannot crash the limited QA host.
              if(string.IsNullOrEmpty(cmd))continue;
              if(cmd=="shutdown"){
                writer.WriteLine("{\"ok\":true,\"stopping\":true}");
                done=true;
              }else{
                string reply;
                try{reply=Response(cmd,workers,sessionId,clientPid,clientSession);}
                catch{reply="{\"ok\":false,\"code\":\"QA_WORKER_UNAVAILABLE\"}";}
                writer.WriteLine(reply);
              }
            }
          }catch(IOException){
            // Broken pipe: deny the request and continue accepting peers.
            continue;
          }catch(ObjectDisposedException){continue;}
        }
      }
      return 0;
    }finally{
      foreach(var w in workers)if(w!=null)CleanupOne(w);
    }
  }
}
