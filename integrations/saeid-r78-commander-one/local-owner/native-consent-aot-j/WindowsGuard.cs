// SOURCE CANDIDATE. No enrollment, UAC auto-launch, HTTP listener or arbitrary sign endpoint.
// The future protected broker must write pending transactions. Owner-writable
// configs/keys are deliberately refused even when the application says FULL_POWER.
using Microsoft.Win32.SafeHandles;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace CommanderOwnerConsent;

internal static class WindowsGuard
{
    // WindowsPrincipal.IsInRole duplicates a primary token to query membership.
    // Query-only OpenProcessToken cannot support that read-only operation.
    private const uint TokenQueryAndDuplicate=0x0008|0x0002;
    [DllImport("advapi32.dll",SetLastError=true)] private static extern bool OpenProcessToken(nint process,uint access,out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll",SetLastError=true)] private static extern bool GetTokenInformation(SafeAccessTokenHandle token,int kind,nint data,int size,out int needed);
    [DllImport("advapi32.dll",SetLastError=true)] private static extern nint GetSidSubAuthority(nint sid,uint subAuthority);
    // GetSidSubAuthorityCount returns PUCHAR (not a value); see its native declaration.
    [DllImport("advapi32.dll",EntryPoint="GetSidSubAuthorityCount",SetLastError=true)] private static extern nint GetSidSubAuthorityCountPtr(nint sid);
    internal sealed record TokenState(string Sid,bool Elevated,int ElevationType,bool Administrator,int IntegrityRid,int SessionId);
    internal static TokenState Inspect()
    {
        ConsentCore.Need(OperatingSystem.IsWindows(),"WINDOWS_REQUIRED");
        ConsentCore.Need(OpenProcessToken(Process.GetCurrentProcess().Handle,TokenQueryAndDuplicate,out var token),"TOKEN_OPEN_FAILED");
        using(token)using(var identity=new WindowsIdentity(token.DangerousGetHandle()))
        {
            int Integer(int kind) {nint p=Marshal.AllocHGlobal(4);try{ConsentCore.Need(GetTokenInformation(token,kind,p,4,out var n)&&n==4,"TOKEN_QUERY_FAILED");return Marshal.ReadInt32(p);}finally{Marshal.FreeHGlobal(p);}}
            GetTokenInformation(token,25,0,0,out var size);ConsentCore.Need(size is >0 and <=4096,"TOKEN_INTEGRITY_SIZE");
            var buffer=Marshal.AllocHGlobal(size);int integrity;
            try{ConsentCore.Need(GetTokenInformation(token,25,buffer,size,out _),"TOKEN_INTEGRITY_FAILED");var sid=Marshal.ReadIntPtr(buffer);var count=Marshal.ReadByte(GetSidSubAuthorityCountPtr(sid));ConsentCore.Need(count>0,"TOKEN_INTEGRITY_SID");integrity=Marshal.ReadInt32(GetSidSubAuthority(sid,(uint)count-1));}
            finally{Marshal.FreeHGlobal(buffer);}
            return new(identity.User?.Value??"",Integer(20)!=0,Integer(18),new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator),integrity,Process.GetCurrentProcess().SessionId);
        }
    }
    internal static void RequireOwner(TokenState s,string ownerSid)
    {ConsentCore.Need(s.Elevated&&s.ElevationType==2&&s.Administrator&&s.IntegrityRid>=12288&&s.SessionId>0&&s.Sid==ownerSid&&s.Sid!="S-1-5-18","SAME_OWNER_REAL_UAC_TOKEN_REQUIRED");}
    private static bool TrustedSid(string s)=>s is "S-1-5-18" or "S-1-5-32-544";
    internal static void NoReparse(string path)
    {
        var full=Path.GetFullPath(path);for(var p=full;!string.IsNullOrEmpty(p);p=Path.GetDirectoryName(p))
        {ConsentCore.Need((File.GetAttributes(p)&FileAttributes.ReparsePoint)==0,"REPARSE_PATH_DENIED");if(Path.GetPathRoot(p)==p)break;}
    }
    internal static void Protected(string path,bool directory)
    {
        NoReparse(path);
        FileSystemSecurity acl=directory?new DirectoryInfo(path).GetAccessControl(AccessControlSections.Owner|AccessControlSections.Access):new FileInfo(path).GetAccessControl(AccessControlSections.Owner|AccessControlSections.Access);
        ConsentCore.Need(TrustedSid(acl.GetOwner(typeof(SecurityIdentifier))?.Value??""),"PROTECTED_OWNER_REQUIRED");
        ConsentCore.Need(acl.AreAccessRulesProtected,"PROTECTED_DACL_REQUIRED");
        var write=FileSystemRights.Write|FileSystemRights.Delete|FileSystemRights.DeleteSubdirectoriesAndFiles|FileSystemRights.ChangePermissions|FileSystemRights.TakeOwnership;
        foreach(FileSystemAccessRule r in acl.GetAccessRules(true,true,typeof(SecurityIdentifier)))
            if(r.AccessControlType==AccessControlType.Allow&&(r.FileSystemRights&write)!=0)ConsentCore.Need(TrustedSid(r.IdentityReference.Value),"UNTRUSTED_WRITE_ACL");
        // A protected child's DACL is insufficient when an ordinary account
        // has DELETE_CHILD on a parent. Check that independent deletion route.
        for(var parent=Path.GetDirectoryName(Path.GetFullPath(path));!string.IsNullOrEmpty(parent);parent=Path.GetDirectoryName(parent))
        {var a=new DirectoryInfo(parent).GetAccessControl(AccessControlSections.Access);foreach(FileSystemAccessRule r in a.GetAccessRules(true,true,typeof(SecurityIdentifier)))if(r.AccessControlType==AccessControlType.Allow&&(r.FileSystemRights&FileSystemRights.DeleteSubdirectoriesAndFiles)!=0)ConsentCore.Need(TrustedSid(r.IdentityReference.Value),"UNTRUSTED_PARENT_DELETE_ACL");if(Path.GetPathRoot(parent)==parent)break;}
    }
    internal static FileStream OpenProtected(string path,int maxBytes,bool confidential=false)
    {
        Protected(path,false);var f=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read);
        try{ConsentCore.Need(f.Length is >0&&f.Length<=maxBytes,"PROTECTED_FILE_SIZE");Protected(path,false);if(confidential){var acl=new FileInfo(path).GetAccessControl(AccessControlSections.Access);foreach(FileSystemAccessRule r in acl.GetAccessRules(true,true,typeof(SecurityIdentifier)))if(r.AccessControlType==AccessControlType.Allow)ConsentCore.Need(TrustedSid(r.IdentityReference.Value),"PRIVATE_KEY_DACL_REQUIRED");}return f;}catch{f.Dispose();throw;}
    }
    internal static byte[] Read(FileStream f) {f.Position=0;using var m=new MemoryStream();f.CopyTo(m);return m.ToArray();}
}

