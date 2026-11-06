using System.Buffers.Binary;using System.Diagnostics;using System.IO.Pipes;using System.Runtime.InteropServices;using System.Security.AccessControl;using System.Security.Principal;using System.Text;using System.Text.Json;using Microsoft.Win32.SafeHandles;using CommanderOwnerConsent;using CommanderNativeIssuer;
namespace CommanderOwnerProxy;
internal sealed class ClientTransport
{
    internal bool EffectMayHaveOccurred{get;private set;}internal bool TaskLaunchAttempted{get;private set;}internal bool TaskLaunchConfirmed{get;private set;}
    internal bool LauncherCleanupConfirmed{get;private set;}=true;internal bool LauncherCleanupUncertain{get;private set;}
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]private static extern bool WaitNamedPipeW(string name,uint timeout);
    private static bool PipeAbsent()
    {if(WaitNamedPipeW(@"\\.\pipe\"+ClientPolicy.PipeName,0))return false;var error=Marshal.GetLastWin32Error();ConsentCore.Need(error is 2 or 3,"CLIENT_PIPE_BUSY_OR_UNCERTAIN_NO_RETRY");return true;}
    private static bool OsTrusted(string sid)=>sid is "S-1-5-18" or "S-1-5-32-544" or "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
    private static void ProtectSystemTool(string path)
    {
        WindowsGuard.NoReparse(path);var file=new FileInfo(path).GetAccessControl(AccessControlSections.Owner|AccessControlSections.Access);ConsentCore.Need(OsTrusted(file.GetOwner(typeof(SecurityIdentifier))?.Value??""),"CLIENT_SYSTEM_TOOL_OWNER");var writes=FileSystemRights.Write|FileSystemRights.Delete|FileSystemRights.ChangePermissions|FileSystemRights.TakeOwnership;
        foreach(FileSystemAccessRule rule in file.GetAccessRules(true,true,typeof(SecurityIdentifier)))if(rule.AccessControlType==AccessControlType.Allow&&(rule.FileSystemRights&writes)!=0)ConsentCore.Need(OsTrusted(rule.IdentityReference.Value),"CLIENT_SYSTEM_TOOL_WRITABLE");
        for(var parent=Path.GetDirectoryName(path);!string.IsNullOrEmpty(parent);parent=Path.GetDirectoryName(parent)){var acl=new DirectoryInfo(parent).GetAccessControl(AccessControlSections.Access);foreach(FileSystemAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier)))if(rule.AccessControlType==AccessControlType.Allow&&(rule.FileSystemRights&FileSystemRights.DeleteSubdirectoriesAndFiles)!=0)ConsentCore.Need(OsTrusted(rule.IdentityReference.Value),"CLIENT_SYSTEM_TOOL_PARENT_DELETE");if(Path.GetPathRoot(parent)==parent)break;}
    }
    private async Task StartFixedTask(ClientPolicy policy,bool admin,CancellationToken cancellation)
    {
        policy.Revalidate(admin);ConsentCore.Need(!TaskLaunchAttempted,"CLIENT_TASK_ONCE_ONLY");var tool=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"schtasks.exe");ProtectSystemTool(tool);using var held=new FileStream(tool,FileMode.Open,FileAccess.Read,FileShare.Read);ProtectSystemTool(tool);
        var info=new ProcessStartInfo(tool){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=Environment.GetFolderPath(Environment.SpecialFolder.System),RedirectStandardOutput=true,RedirectStandardError=true};foreach(var x in new[]{"/run","/TN",ClientPolicy.TaskName})info.ArgumentList.Add(x);info.Environment.Clear();info.Environment["SystemRoot"]=Environment.GetFolderPath(Environment.SpecialFolder.Windows);info.Environment["WINDIR"]=info.Environment["SystemRoot"];info.Environment["PATH"]=Environment.GetFolderPath(Environment.SpecialFolder.System);info.Environment["PATHEXT"]=".COM;.EXE;.BAT;.CMD";
        TaskLaunchAttempted=true;LauncherCleanupConfirmed=false;LauncherCleanupUncertain=true;using var process=Process.Start(info)??throw new ConsentFault("CLIENT_TASK_START_UNCERTAIN_NO_RETRY");var owned=new OwnedLauncher(process,tool);
        try{using var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancellation);timeout.CancelAfter(TimeSpan.FromSeconds(6));await Task.WhenAll(process.StandardOutput.BaseStream.CopyToAsync(Stream.Null,timeout.Token),process.StandardError.BaseStream.CopyToAsync(Stream.Null,timeout.Token),process.WaitForExitAsync(timeout.Token));ConsentCore.Need(process.ExitCode==0,"CLIENT_TASK_START_NOT_CONFIRMED_NO_RETRY");TaskLaunchConfirmed=true;}
        finally{LauncherCleanupConfirmed=owned.StopOnlyOwnedLauncher();LauncherCleanupUncertain=!LauncherCleanupConfirmed;}
        ConsentCore.Need(LauncherCleanupConfirmed,"CLIENT_LAUNCHER_CLEANUP_UNCERTAIN_NO_RETRY");
    }
    internal async Task<byte[]> Send(ClientPolicy policy,bool admin,Request request,byte[] bytes,CancellationToken cancellation)
    {
        policy.DemandRequest(request,admin);policy.Revalidate(admin);
        // A missing fixed pipe permits one fixed bootstrap-attested task start.
        // Busy/access-denied/ambiguous states never cause a second launcher or request.
        if(PipeAbsent())await StartFixedTask(policy,admin,cancellation);
        using var pipe=new NamedPipeClientStream(".",ClientPolicy.PipeName,PipeDirection.InOut,PipeOptions.Asynchronous,TokenImpersonationLevel.Identification,HandleInheritability.None);
        using(var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancellation)){timeout.CancelAfter(TimeSpan.FromSeconds(5));await pipe.ConnectAsync(timeout.Token);}
        using var peer=ServerPeer.Capture(pipe,policy,admin);peer.Revalidate();policy.DemandRequest(request,admin);
        using(var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancellation)){timeout.CancelAfter(TimeSpan.FromSeconds(5));EffectMayHaveOccurred=true;await WriteFrame(pipe,bytes,timeout.Token);}
        peer.Revalidate(allowOneShotExit:true);byte[] reply;using(var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancellation)){timeout.CancelAfter(TimeSpan.FromSeconds(5));reply=await ReadFrame(pipe,timeout.Token);}
        // The one-shot host may exit just after its complete response. Retain the
        // original authenticated stream/process/token/image; never reconnect.
        peer.Revalidate(allowOneShotExit:true);ValidateReply(reply,request.Id,peer.ObservedExitCode);return reply;
    }
    internal static async Task<byte[]> ReadFrame(Stream stream,CancellationToken token)
    {var header=new byte[4];await stream.ReadExactlyAsync(header,token);var count=BinaryPrimitives.ReadUInt32LittleEndian(header);ConsentCore.Need(count is >0 and <=IssuerProtocol.MaxFrameBytes,"CLIENT_RESPONSE_FRAME_BOUND");var body=new byte[count];await stream.ReadExactlyAsync(body,token);return body;}
    internal static async Task WriteFrame(Stream stream,byte[] bytes,CancellationToken token)
    {ConsentCore.Need(bytes.Length is >0 and <=IssuerProtocol.MaxFrameBytes,"CLIENT_REQUEST_FRAME_BOUND");var h=new byte[4];BinaryPrimitives.WriteUInt32LittleEndian(h,(uint)bytes.Length);await stream.WriteAsync(h,token);await stream.WriteAsync(bytes,token);await stream.FlushAsync(token);}
    internal static void ValidateReply(byte[] bytes,string id,uint? serverExit=null)
    {
        using var d=ConsentCore.Strict(bytes);var e=d.RootElement;ConsentCore.Need(e.GetProperty("version").GetInt32()==1&&ConsentCore.Text(e,"id",36)==id,"CLIENT_RESPONSE_CORRELATION");var ok=e.GetProperty("ok").GetBoolean();ConsentCore.Need(serverExit!=2||!ok,"CLIENT_SERVER_ERROR_EXIT_NOT_SUCCESS");if(ok){ConsentCore.Fields(e,"version","id","ok","result");ConsentCore.Need(e.GetProperty("result").ValueKind==JsonValueKind.Object,"CLIENT_RESPONSE_RESULT");}else{ConsentCore.Fields(e,"version","id","ok","code","automaticRetryAllowed");ConsentCore.Text(e,"code",96);ConsentCore.Need(!e.GetProperty("automaticRetryAllowed").GetBoolean(),"CLIENT_SERVER_RETRY_DENIED");}
    }
}
// Only the just-created, held schtasks launcher process is eligible for this
// bounded cleanup. The scheduled SYSTEM task/issuer is never a descendant
// target, enumerated, reopened by PID, cancelled or terminated here.
internal sealed class OwnedLauncher
{
    private readonly Process process;private readonly SafeProcessHandle handle;private readonly long creation;private readonly string image;
    [DllImport("kernel32.dll",SetLastError=true)]private static extern bool GetProcessTimes(SafeProcessHandle process,out long creation,out long exit,out long kernel,out long user);
    [DllImport("kernel32.dll")]private static extern uint WaitForSingleObject(SafeProcessHandle process,uint timeout);
    [DllImport("kernel32.dll",SetLastError=true)]private static extern bool TerminateProcess(SafeProcessHandle process,uint exitCode);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]private static extern bool QueryFullProcessImageNameW(SafeProcessHandle process,uint flags,StringBuilder name,ref uint size);
    internal OwnedLauncher(Process owned,string expectedImage)
    {process=owned;handle=process.SafeHandle;image=Path.GetFullPath(expectedImage);ConsentCore.Need(GetProcessTimes(handle,out creation,out _,out _,out _)&&ImagePath().Equals(image,StringComparison.OrdinalIgnoreCase),"CLIENT_OWN_LAUNCHER_IDENTITY_REQUIRED");}
    private string ImagePath(){var name=new StringBuilder(32768);uint n=(uint)name.Capacity;ConsentCore.Need(QueryFullProcessImageNameW(handle,0,name,ref n),"CLIENT_OWN_LAUNCHER_IMAGE_QUERY");return Path.GetFullPath(name.ToString());}
    internal bool StopOnlyOwnedLauncher()
    {try{ConsentCore.Need(GetProcessTimes(handle,out var current,out _,out _,out _)&&current==creation,"CLIENT_OWN_LAUNCHER_GENERATION_CHANGED");var wait=WaitForSingleObject(handle,0);if(wait==0)return true;ConsentCore.Need(wait==258&&ImagePath().Equals(image,StringComparison.OrdinalIgnoreCase),"CLIENT_OWN_LAUNCHER_IDENTITY_CHANGED");if(!TerminateProcess(handle,0xe0800001))return WaitForSingleObject(handle,0)==0;return WaitForSingleObject(handle,2000)==0;}catch{return false;}}
}
