using System.Diagnostics;using System.Runtime.InteropServices;using System.Security.AccessControl;using System.Security.Principal;using System.Text;using System.Text.Json;using System.Runtime.ExceptionServices;using CommanderOwnerConsent;using CommanderNativeIssuer;using CommanderOwnerProxy;
namespace CommanderOwnerAcceptance;
internal static class ProbeIO
{
    internal const string PrivateRoot=@"G:\CodexWork\RC1R80OwnerProbe";
    internal static bool CleanupUncertain{get;private set;}
    [StructLayout(LayoutKind.Sequential)]private struct SA{internal int Length;internal nint Descriptor;internal int Inherit;}
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text,int revision,out nint descriptor,out uint size);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]private static extern bool CreateDirectoryW(string name,ref SA security);
    [DllImport("kernel32.dll")]private static extern nint LocalFree(nint pointer);
    private static void CreateDirectoryExact(string path,string sddl)
    {ConsentCore.Need(!Directory.Exists(path)&&!File.Exists(path),"PROBE_TARGET_ALREADY_EXISTS_NO_REPLAY");WindowsGuard.NoReparse(Path.GetDirectoryName(path)!);ConsentCore.Need(ConvertStringSecurityDescriptorToSecurityDescriptor(sddl,1,out var sd,out _),"PROBE_DACL_FORMAT");try{var sa=new SA{Length=Marshal.SizeOf<SA>(),Descriptor=sd};ConsentCore.Need(CreateDirectoryW(path,ref sa),"PROBE_DIRECTORY_CREATE_EXCLUSIVE");}finally{LocalFree(sd);}}
    internal static void NewPrivate(string owner)
    {CreateDirectoryExact(PrivateRoot,"O:"+owner+"D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;"+owner+")");Private(PrivateRoot,owner,true);}
    internal static void Private(string path,string owner,bool directory=false)
    {WindowsGuard.NoReparse(path);FileSystemSecurity acl=directory?new DirectoryInfo(path).GetAccessControl(AccessControlSections.Owner|AccessControlSections.Access):new FileInfo(path).GetAccessControl(AccessControlSections.Owner|AccessControlSections.Access);ConsentCore.Need(acl.GetOwner(typeof(SecurityIdentifier))?.Value==owner&&acl.AreAccessRulesProtected,"PROBE_OWNER_PRIVATE_DACL");foreach(FileSystemAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier)))if(rule.AccessControlType==AccessControlType.Allow)ConsentCore.Need(rule.IdentityReference.Value==owner||rule.IdentityReference.Value=="S-1-5-18","PROBE_PRIVATE_DATA_ACL");}
    internal static FileStream ReadPrivate(string name,string owner)
    {ConsentCore.Need(name is "seed.json" or "prepared.json","PROBE_FIXED_PRIVATE_INPUT");Private(PrivateRoot,owner,true);var path=Path.Combine(PrivateRoot,name);Private(path,owner);var f=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read);try{ConsentCore.Need(f.Length is >0 and <=32768,"PROBE_PRIVATE_INPUT_BOUND");Private(path,owner);return f;}catch{f.Dispose();throw;}}
    internal static void WritePrivate(string name,byte[] data,string owner)
    {ConsentCore.Need(name is "seed.json" or "prepared.json" or "verify.intent.json" or "complete.intent.json" or "exchange.intent.json" or "state.intent.json" or "result.json" or "failure.json","PROBE_FIXED_PRIVATE_OUTPUT");Private(PrivateRoot,owner,true);var acl=Acl(owner,false);WriteNew(Path.Combine(PrivateRoot,name),data,acl);Private(Path.Combine(PrivateRoot,name),owner);}
    private static FileSecurity Acl(string owner,bool admin)
    {var acl=new FileSecurity();acl.SetOwner(new SecurityIdentifier(admin?"S-1-5-32-544":owner));acl.SetAccessRuleProtection(true,false);foreach(var sid in admin?new[]{"S-1-5-18","S-1-5-32-544"}:new[]{"S-1-5-18",owner})acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid),FileSystemRights.FullControl,AccessControlType.Allow));if(admin)acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(owner),FileSystemRights.ReadAndExecute,AccessControlType.Allow));return acl;}
    private static void WriteNew(string path,byte[] data,FileSecurity acl)
    {ConsentCore.Need(data.Length is >0 and <=32768,"PROBE_OUTPUT_BOUND");using var f=new FileInfo(path).Create(FileMode.CreateNew,FileSystemRights.FullControl,FileShare.None,4096,FileOptions.WriteThrough,acl);f.Write(data);f.Flush(true);}
    internal static void NewProtected(ProbeAuthority a)
    {a.Revalidate();WindowsGuard.RequireOwner(WindowsGuard.Inspect(),a.OwnerSid);WindowsGuard.Protected(a.StateRoot,true);CreateDirectoryExact(a.AcceptanceRoot,"O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;;GRGX;;;"+a.OwnerSid+")");WindowsGuard.Protected(a.AcceptanceRoot,true);}
    internal static void WriteProtected(string name,byte[] data,ProbeAuthority a)
    {ConsentCore.Need(name is "approve.intent.json" or "assertion.json" or "denied.json","PROBE_FIXED_ADMIN_OUTPUT");a.Revalidate();WindowsGuard.RequireOwner(WindowsGuard.Inspect(),a.OwnerSid);WindowsGuard.Protected(a.AcceptanceRoot,true);WriteNew(Path.Combine(a.AcceptanceRoot,name),data,Acl(a.OwnerSid,true));WindowsGuard.Protected(Path.Combine(a.AcceptanceRoot,name),false);}
    internal static async Task<byte[]> Rpc(ProbeAuthority a,byte[] request,CancellationToken cancellation)
    {a.Revalidate();var image=Path.Combine(a.ProgramRoot,ClientPolicy.ProxyName);using var held=NativeImage.OpenPinned(image,a.ClientPolicy.ProxySha256,a.ProgramRoot);var result=await Child(image,new[]{"--rpc"},request,30000,cancellation);if(result.Exit!=0){using var error=ConsentCore.Strict(result.Error);var code=ConsentCore.Text(error.RootElement,"code",128);ConsentCore.Need(System.Text.RegularExpressions.Regex.IsMatch(code,"^[A-Z0-9_]{1,128}$"),"PROBE_PROXY_ERROR_SHAPE");throw new ConsentFault("PROBE_PROXY_"+code);}ConsentCore.Need(result.Error.Length==0,"PROBE_PROXY_UNEXPECTED_STDERR");using var d=ConsentCore.Strict(result.Output);using var rd=ConsentCore.Strict(request);var e=d.RootElement;ConsentCore.Need(e.GetProperty("version").GetInt32()==1&&ConsentCore.Text(e,"id")==ConsentCore.Text(rd.RootElement,"id"),"PROBE_RPC_CORRELATION");ConsentCore.Need(e.GetProperty("ok").GetBoolean(),"PROBE_HOST_REJECTED_NO_RETRY");ConsentCore.Fields(e,"version","id","ok","result");return Encoding.UTF8.GetBytes(e.GetProperty("result").GetRawText());}
    internal static async Task Consent(ProbeAuthority a,string requestId,CancellationToken cancellation)
    {a.Revalidate();WindowsGuard.RequireOwner(WindowsGuard.Inspect(),a.OwnerSid);var image=Path.Combine(a.ProgramRoot,"CommanderOwnerConsent.exe");using var held=NativeImage.OpenPinned(image,ProbeAuthority.ConsentPin,a.ProgramRoot);var result=await Child(image,new[]{"--request",requestId},null,90000,cancellation);ConsentCore.Need(result.Exit==0,"PROBE_CONSENT_HELPER_FAILED_NO_RETRY");}
    private sealed record ChildResult(int Exit,byte[] Output,byte[] Error);
    private static async Task<byte[]> Bounded(Stream stream,int max,CancellationToken cancellation)
    {using var m=new MemoryStream();var b=new byte[4096];while(true){var n=await stream.ReadAsync(b,cancellation);if(n==0)break;ConsentCore.Need(m.Length+n<=max,"PROBE_CHILD_OUTPUT_BOUND");m.Write(b,0,n);}return m.ToArray();}
    private static async Task<ChildResult> Child(string image,string[] args,byte[]? input,int timeoutMs,CancellationToken cancellation)
    {
        var info=new ProcessStartInfo(image){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=Environment.SystemDirectory,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true};foreach(var arg in args)info.ArgumentList.Add(arg);info.Environment.Clear();info.Environment["SystemRoot"]=Environment.GetFolderPath(Environment.SpecialFolder.Windows);info.Environment["WINDIR"]=info.Environment["SystemRoot"];info.Environment["PATH"]=Environment.SystemDirectory;
        using var process=Process.Start(info)??throw new ConsentFault("PROBE_OWN_CHILD_START_UNCERTAIN");var own=new ProbeChild(process,image);using var deadline=CancellationTokenSource.CreateLinkedTokenSource(cancellation);deadline.CancelAfter(timeoutMs);Exception? primary=null;ChildResult? result=null;bool cleaned;
        try{var stdout=Bounded(process.StandardOutput.BaseStream,32768,deadline.Token);var stderr=Bounded(process.StandardError.BaseStream,16384,deadline.Token);if(input!=null)await process.StandardInput.BaseStream.WriteAsync(input,deadline.Token);process.StandardInput.Close();await process.WaitForExitAsync(deadline.Token);result=new(process.ExitCode,await stdout,await stderr);}catch(Exception e){primary=e;}
        finally{cleaned=own.ReapOnlyOwned();if(!cleaned)CleanupUncertain=true;}
        if(primary!=null)ExceptionDispatchInfo.Capture(primary).Throw();ConsentCore.Need(cleaned,"PROBE_OWN_CHILD_CLEANUP_UNCERTAIN");return result??throw new ConsentFault("PROBE_OWN_CHILD_RESULT_UNKNOWN");
    }
    private sealed class ProbeChild
    {
        private readonly Microsoft.Win32.SafeHandles.SafeProcessHandle handle;private readonly string path;private readonly long generation;
        [DllImport("kernel32.dll",SetLastError=true)]private static extern bool GetProcessTimes(Microsoft.Win32.SafeHandles.SafeProcessHandle p,out long creation,out long exit,out long kernel,out long user);
        [DllImport("kernel32.dll")]private static extern uint WaitForSingleObject(Microsoft.Win32.SafeHandles.SafeProcessHandle p,uint wait);
        [DllImport("kernel32.dll",SetLastError=true)]private static extern bool TerminateProcess(Microsoft.Win32.SafeHandles.SafeProcessHandle p,uint code);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]private static extern bool QueryFullProcessImageNameW(Microsoft.Win32.SafeHandles.SafeProcessHandle p,uint flags,StringBuilder name,ref uint size);
        internal ProbeChild(Process child,string expected){handle=child.SafeHandle;path=Path.GetFullPath(expected);ConsentCore.Need(GetProcessTimes(handle,out generation,out _,out _,out _)&&PathOf()==path,"PROBE_OWN_CHILD_CAPTURE");}
        private string PathOf(){var b=new StringBuilder(32768);uint n=(uint)b.Capacity;ConsentCore.Need(QueryFullProcessImageNameW(handle,0,b,ref n),"PROBE_OWN_CHILD_PATH");return Path.GetFullPath(b.ToString());}
        internal bool ReapOnlyOwned(){try{ConsentCore.Need(GetProcessTimes(handle,out var created,out _,out _,out _)&&created==generation,"PROBE_OWN_CHILD_GENERATION");var wait=WaitForSingleObject(handle,0);if(wait==0)return true;ConsentCore.Need(wait==258&&PathOf()==path,"PROBE_OWN_CHILD_IDENTITY_CHANGED");if(!TerminateProcess(handle,0xe0800003))return WaitForSingleObject(handle,0)==0;return WaitForSingleObject(handle,2000)==0;}catch{return false;}}
    }
}
