using Microsoft.Win32.SafeHandles;using System.IO.Pipes;using System.Runtime.InteropServices;using System.Security.Principal;using System.Text;using CommanderOwnerConsent;
namespace CommanderNativeIssuer;
internal sealed class KernelPeer:IDisposable
{
    private readonly NamedPipeServerStream pipe;private readonly SafeProcessHandle process;private readonly SafeAccessTokenHandle token;private readonly FileStream image;private readonly uint pid;private readonly long created;private readonly string path;private readonly HostPolicy policy;private readonly PeerRule rule;private readonly bool elevated,administrator;private readonly int integrity;
    private KernelPeer(NamedPipeServerStream p,SafeProcessHandle processHandle,SafeAccessTokenHandle tokenHandle,FileStream pinnedImage,uint processId,long creation,string imagePath,HostPolicy hostPolicy,PeerRule peerRule,bool elevation,bool admin,int level)
    {pipe=p;process=processHandle;token=tokenHandle;image=pinnedImage;pid=processId;created=creation;path=imagePath;policy=hostPolicy;rule=peerRule;elevated=elevation;administrator=admin;integrity=level;}
    [DllImport("kernel32.dll",SetLastError=true)]private static extern bool GetNamedPipeClientProcessId(SafePipeHandle handle,out uint processId);
    [DllImport("kernel32.dll",SetLastError=true)]private static extern SafeProcessHandle OpenProcess(uint access,bool inherit,uint processId);
    [DllImport("kernel32.dll",SetLastError=true)]private static extern bool GetProcessTimes(SafeProcessHandle process,out long creation,out long exit,out long kernel,out long user);
    [DllImport("kernel32.dll",SetLastError=true)]private static extern uint WaitForSingleObject(SafeProcessHandle process,uint milliseconds);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]private static extern bool QueryFullProcessImageNameW(SafeProcessHandle process,uint flags,StringBuilder name,ref uint length);
    [DllImport("advapi32.dll",SetLastError=true)]private static extern bool OpenProcessToken(SafeProcessHandle process,uint access,out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll",SetLastError=true)]private static extern bool GetTokenInformation(SafeAccessTokenHandle token,int kind,nint data,int size,out int needed);
    [DllImport("advapi32.dll",SetLastError=true)]private static extern nint GetSidSubAuthorityCount(nint sid);
    [DllImport("advapi32.dll",SetLastError=true)]private static extern nint GetSidSubAuthority(nint sid,uint index);
    private static int Integer(SafeAccessTokenHandle token,int kind){var p=Marshal.AllocHGlobal(4);try{ConsentCore.Need(GetTokenInformation(token,kind,p,4,out var size)&&size==4,"PEER_TOKEN_QUERY");return Marshal.ReadInt32(p);}finally{Marshal.FreeHGlobal(p);}}
    private static int Integrity(SafeAccessTokenHandle token)
    {GetTokenInformation(token,25,0,0,out var size);ConsentCore.Need(size is >0 and <=4096,"PEER_TOKEN_INTEGRITY_SIZE");var p=Marshal.AllocHGlobal(size);try{ConsentCore.Need(GetTokenInformation(token,25,p,size,out _),"PEER_TOKEN_INTEGRITY");var sid=Marshal.ReadIntPtr(p);var count=Marshal.ReadByte(GetSidSubAuthorityCount(sid));ConsentCore.Need(count>0,"PEER_TOKEN_SID");return Marshal.ReadInt32(GetSidSubAuthority(sid,(uint)count-1));}finally{Marshal.FreeHGlobal(p);}}
    private static string ImagePath(SafeProcessHandle process){var s=new StringBuilder(32768);uint n=(uint)s.Capacity;ConsentCore.Need(QueryFullProcessImageNameW(process,0,s,ref n),"PEER_IMAGE_QUERY");return Path.GetFullPath(s.ToString());}
    private sealed record PipeFacts(string Sid,bool Elevated,bool Administrator,int Integrity,int Session);
    private static PipeFacts PipeIdentity(NamedPipeServerStream pipe)
    {PipeFacts? facts=null;pipe.RunAsClient(()=>{using var identity=WindowsIdentity.GetCurrent(true);ConsentCore.Need(identity!=null&&identity.ImpersonationLevel>=TokenImpersonationLevel.Identification,"PIPE_IMPERSONATION_REQUIRED");var actual=identity??throw new ConsentFault("PIPE_IDENTITY_REQUIRED");facts=new(actual.User?.Value??"",Integer(actual.AccessToken,20)!=0,new WindowsPrincipal(actual).IsInRole(WindowsBuiltInRole.Administrator),Integrity(actual.AccessToken),Integer(actual.AccessToken,12));});HostPolicy.RequireSystem();return facts??throw new ConsentFault("PIPE_IDENTITY_REQUIRED");}
    internal static KernelPeer Authenticate(NamedPipeServerStream pipe,HostPolicy policy)
    {
        HostPolicy.RequireSystem();uint pid=0;ConsentCore.Need(pipe.IsConnected&&GetNamedPipeClientProcessId(pipe.SafePipeHandle,out pid),"PEER_KERNEL_PID_REQUIRED");var process=OpenProcess(0x00101000,false,pid);SafeAccessTokenHandle? token=null;FileStream? image=null;
        try
        {
            long created=0;ConsentCore.Need(!process.IsInvalid&&WaitForSingleObject(process,0)==258&&GetProcessTimes(process,out created,out _,out _,out _),"PEER_PROCESS_NOT_LIVE");ConsentCore.Need(OpenProcessToken(process,0x000a,out token),"PEER_TOKEN_OPEN");var actualToken=token??throw new ConsentFault("PEER_TOKEN_OPEN");using var identity=new WindowsIdentity(actualToken.DangerousGetHandle());var sid=identity.User?.Value;var pipeIdentity=PipeIdentity(pipe);ConsentCore.Need(sid==policy.OwnerSid&&pipeIdentity.Sid==sid&&pipeIdentity.Session==policy.OwnerSessionId&&Integer(actualToken,12)==policy.OwnerSessionId,"PEER_OWNER_SESSION_BINDING");var path=ImagePath(process);var matches=policy.Peers.Where(x=>x.ImagePath.Equals(path,StringComparison.OrdinalIgnoreCase)).ToArray();ConsentCore.Need(matches.Length==1,"PEER_IMAGE_NOT_ENROLLED");var role=matches[0];image=NativeImage.OpenPinned(path,role.Sha256,policy.ProgramRoot);var elevated=Integer(actualToken,20)!=0;var admin=new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);var integrity=Integrity(actualToken);var peer=new KernelPeer(pipe,process,actualToken,image,pid,created,path,policy,role,elevated,admin,integrity);peer.Revalidate();return peer;
        }
        catch{image?.Dispose();token?.Dispose();process.Dispose();throw;}
    }
    internal void Revalidate()
    {
        policy.Revalidate();var pipeIdentity=PipeIdentity(pipe);ConsentCore.Need(pipe.IsConnected&&GetNamedPipeClientProcessId(pipe.SafePipeHandle,out var current)&&current==pid&&WaitForSingleObject(process,0)==258&&GetProcessTimes(process,out var creation,out _,out _,out _)&&creation==created&&ImagePath(process).Equals(path,StringComparison.OrdinalIgnoreCase)&&pipeIdentity.Sid==policy.OwnerSid&&pipeIdentity.Session==policy.OwnerSessionId&&Integer(token,12)==policy.OwnerSessionId,"PEER_IDENTITY_CHANGED");
    }
    internal void Demand(string action)
    {
        Revalidate();var allowed=rule.Role=="owner-admin"?action is "authorize" or "exchange" or "state" or "revoke":action is "authorize" or "exchange" or "state";
        ConsentCore.Need(allowed,"PEER_ACTION_NOT_ALLOWED");if(rule.Role=="owner-admin"){var actualPipeToken=PipeIdentity(pipe);ConsentCore.Need(elevated&&administrator&&integrity>=12288&&actualPipeToken.Elevated&&actualPipeToken.Administrator&&actualPipeToken.Integrity>=12288,"PEER_OWNER_ELEVATION_REQUIRED");}
    }
    public void Dispose(){image.Dispose();token.Dispose();process.Dispose();}
}
