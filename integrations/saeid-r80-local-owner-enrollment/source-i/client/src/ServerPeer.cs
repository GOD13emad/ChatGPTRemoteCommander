using Microsoft.Win32.SafeHandles;using System.IO.Pipes;using System.Runtime.InteropServices;using System.Security.Principal;using System.Text;using CommanderOwnerConsent;using CommanderNativeIssuer;
namespace CommanderOwnerProxy;
internal sealed class ServerPeer:IDisposable
{
    private readonly NamedPipeClientStream pipe;private readonly SafeProcessHandle process;private readonly SafeAccessTokenHandle token;private readonly FileStream image;private readonly uint pid;private readonly long created;private readonly string path;private readonly ClientPolicy policy;private readonly bool admin;
    internal uint? ObservedExitCode{get;private set;}
    private ServerPeer(NamedPipeClientStream p,SafeProcessHandle ph,SafeAccessTokenHandle th,FileStream ih,uint id,long generation,string name,ClientPolicy cp,bool elevatedRole){pipe=p;process=ph;token=th;image=ih;pid=id;created=generation;path=name;policy=cp;admin=elevatedRole;}
    [DllImport("kernel32.dll",SetLastError=true)]private static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe,out uint pid);
    [DllImport("kernel32.dll",SetLastError=true)]private static extern bool GetNamedPipeServerSessionId(SafePipeHandle pipe,out uint session);
    [DllImport("kernel32.dll",SetLastError=true)]private static extern SafeProcessHandle OpenProcess(uint access,bool inherit,uint pid);
    [DllImport("kernel32.dll",SetLastError=true)]private static extern bool GetProcessTimes(SafeProcessHandle process,out long creation,out long exit,out long kernel,out long user);
    [DllImport("kernel32.dll")]private static extern uint WaitForSingleObject(SafeProcessHandle process,uint timeout);
    [DllImport("kernel32.dll",SetLastError=true)]private static extern bool GetExitCodeProcess(SafeProcessHandle process,out uint code);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]private static extern bool QueryFullProcessImageNameW(SafeProcessHandle process,uint flags,StringBuilder name,ref uint size);
    [DllImport("advapi32.dll",SetLastError=true)]private static extern bool OpenProcessToken(SafeProcessHandle process,uint access,out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll",SetLastError=true)]private static extern bool GetTokenInformation(SafeAccessTokenHandle token,int kind,nint data,int size,out int needed);
    [DllImport("advapi32.dll")]private static extern nint GetSidSubAuthorityCount(nint sid);
    [DllImport("advapi32.dll")]private static extern nint GetSidSubAuthority(nint sid,uint index);
    private static int Integer(SafeAccessTokenHandle token,int kind){var p=Marshal.AllocHGlobal(4);try{ConsentCore.Need(GetTokenInformation(token,kind,p,4,out var n)&&n==4,"SERVER_TOKEN_QUERY_DENIED");return Marshal.ReadInt32(p);}finally{Marshal.FreeHGlobal(p);}}
    private static (string Sid,int Integrity) TokenIdentity(SafeAccessTokenHandle token)
    {
        string sid="";int integrity=0;foreach(var kind in new[]{1,25}){GetTokenInformation(token,kind,0,0,out var n);ConsentCore.Need(n is >0 and <=4096,"SERVER_TOKEN_SIZE");var p=Marshal.AllocHGlobal(n);try{ConsentCore.Need(GetTokenInformation(token,kind,p,n,out _),"SERVER_TOKEN_QUERY_DENIED");var psid=Marshal.ReadIntPtr(p);if(kind==1)sid=new SecurityIdentifier(psid).Value;else{var count=Marshal.ReadByte(GetSidSubAuthorityCount(psid));ConsentCore.Need(count>0,"SERVER_TOKEN_INTEGRITY_SID");integrity=Marshal.ReadInt32(GetSidSubAuthority(psid,(uint)count-1));}}finally{Marshal.FreeHGlobal(p);}}return(sid,integrity);
    }
    private static string ImagePath(SafeProcessHandle p){var s=new StringBuilder(32768);uint n=(uint)s.Capacity;ConsentCore.Need(QueryFullProcessImageNameW(p,0,s,ref n),"SERVER_IMAGE_QUERY_DENIED");return Path.GetFullPath(s.ToString());}
    internal static ServerPeer Capture(NamedPipeClientStream pipe,ClientPolicy policy,bool admin)
    {
        policy.Revalidate(admin);uint pid=0;ConsentCore.Need(pipe.IsConnected&&GetNamedPipeServerProcessId(pipe.SafePipeHandle,out pid),"SERVER_KERNEL_PID_REQUIRED");var process=OpenProcess(0x00101000,false,pid);SafeAccessTokenHandle? token=null;FileStream? image=null;
        try{long created=0;ConsentCore.Need(!process.IsInvalid&&WaitForSingleObject(process,0)==258&&GetProcessTimes(process,out created,out _,out _,out _),"SERVER_PROCESS_NOT_LIVE");ConsentCore.Need(OpenProcessToken(process,0x0008,out token),"SERVER_TOKEN_QUERY_DENIED");var actual=token??throw new ConsentFault("SERVER_TOKEN_QUERY_DENIED");var path=ImagePath(process);ConsentCore.Need(path.Equals(Path.Combine(policy.ProgramRoot,"CommanderNativeIssuer.exe"),StringComparison.OrdinalIgnoreCase),"SERVER_PROTECTED_IMAGE_BINDING");image=NativeImage.OpenPinned(path,policy.HostSha256,policy.ProgramRoot);var peer=new ServerPeer(pipe,process,actual,image,pid,created,path,policy,admin);peer.Revalidate();return peer;}catch{image?.Dispose();token?.Dispose();process.Dispose();throw;}
    }
    internal void Revalidate(bool allowOneShotExit=false)
    {
        policy.Revalidate(admin);var facts=TokenIdentity(token);ConsentCore.Need(GetProcessTimes(process,out var creation,out _,out _,out _)&&creation==created&&ImagePath(process).Equals(path,StringComparison.OrdinalIgnoreCase),"SERVER_KERNEL_GENERATION_CHANGED");var wait=WaitForSingleObject(process,0);
        if(wait==258){if(!allowOneShotExit)ConsentCore.Need(pipe.IsConnected&&GetNamedPipeServerProcessId(pipe.SafePipeHandle,out var current)&&current==pid&&GetNamedPipeServerSessionId(pipe.SafePipeHandle,out var session)&&session==0,"SERVER_PIPE_IDENTITY_CHANGED");}
        else{uint exit=uint.MaxValue;ConsentCore.Need(allowOneShotExit&&wait==0&&GetExitCodeProcess(process,out exit)&&exit is 0 or 2,"SERVER_EXIT_BEFORE_COMPLETE_REPLY");ObservedExitCode=exit;}
        ConsentCore.Need(facts.Sid=="S-1-5-18"&&facts.Integrity>=16384&&Integer(token,20)!=0&&Integer(token,12)==0,"SERVER_REAL_SYSTEM_SESSION_REQUIRED");
    }
    public void Dispose(){image.Dispose();token.Dispose();process.Dispose();}
}
