using System.Security.Cryptography;using System.Text.Json;using CommanderOwnerConsent;
namespace CommanderNativeIssuer;
internal sealed record PeerRule(string Role,string ImagePath,string Sha256);
internal sealed class HostPolicy
{
    internal readonly string OwnerSid,ProgramRoot,HostSha256;internal readonly int OwnerSessionId;internal readonly PeerRule[] Peers;internal readonly byte[] Bytes;
    private HostPolicy(byte[] bytes,string programRoot)
    {
        Bytes=bytes;ProgramRoot=programRoot;using var d=ConsentCore.Strict(bytes);var e=d.RootElement;ConsentCore.Fields(e,"schema","ownerSid","ownerSessionId","hostSha256","nativePolicySha256","oauthPolicySha256","peers");ConsentCore.Need(ConsentCore.Text(e,"schema")=="RC_NATIVE_ISSUER_HOST_V1","HOST_POLICY_SCHEMA");OwnerSid=ConsentCore.Text(e,"ownerSid");_ = new System.Security.Principal.SecurityIdentifier(OwnerSid);OwnerSessionId=e.GetProperty("ownerSessionId").GetInt32();ConsentCore.Need(OwnerSessionId>0,"HOST_OWNER_SESSION_REQUIRED");HostSha256=Hash(e,"hostSha256");Hash(e,"nativePolicySha256");Hash(e,"oauthPolicySha256");var a=e.GetProperty("peers");ConsentCore.Need(a.ValueKind==JsonValueKind.Array&&a.GetArrayLength() is >0 and <=4,"HOST_PEER_ENROLLMENT_REQUIRED");var peers=new List<PeerRule>();var paths=new HashSet<string>(StringComparer.OrdinalIgnoreCase);foreach(var p in a.EnumerateArray()){ConsentCore.Fields(p,"role","imageName","sha256");var role=ConsentCore.Text(p,"role");ConsentCore.Need(role is "oauth-proxy" or "owner-admin","HOST_PEER_ROLE");var name=ConsentCore.Text(p,"imageName",100);ConsentCore.Need(System.Text.RegularExpressions.Regex.IsMatch(name,"^[A-Za-z][A-Za-z0-9_-]{0,80}\\.exe$"),"HOST_PEER_IMAGE_NAME");var path=Path.Combine(programRoot,name);ConsentCore.Need(paths.Add(path),"HOST_DUPLICATE_PEER");peers.Add(new(role,path,Hash(p,"sha256")));}Peers=peers.ToArray();
    }
    private static string Hash(JsonElement e,string name){var h=ConsentCore.Text(e,name,64);ConsentCore.Need(System.Text.RegularExpressions.Regex.IsMatch(h,"^[a-f0-9]{64}$"),"HOST_PIN_FORMAT");return h;}
    internal static HostPolicy LoadProtected()
    {
        RequireSystem();var program=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"ChatGPTRemoteCommander","owner-auth");var state=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"ChatGPTRemoteCommander","owner-auth");WindowsGuard.Protected(program,true);WindowsGuard.Protected(state,true);using var f=WindowsGuard.OpenProtected(Path.Combine(state,"issuer-host-policy.json"),32768);var bytes=WindowsGuard.Read(f);var policy=new HostPolicy(bytes,program);using var d=ConsentCore.Strict(bytes);using var n=WindowsGuard.OpenProtected(Path.Combine(state,"policy.json"),32768);using var o=WindowsGuard.OpenProtected(Path.Combine(state,"oauth-policy.json"),32768);var nb=WindowsGuard.Read(n);var ob=WindowsGuard.Read(o);ConsentCore.Need(Convert.ToHexString(SHA256.HashData(nb)).ToLowerInvariant()==Hash(d.RootElement,"nativePolicySha256")&&Convert.ToHexString(SHA256.HashData(ob)).ToLowerInvariant()==Hash(d.RootElement,"oauthPolicySha256"),"HOST_SOURCE_POLICY_PINS");using var nd=ConsentCore.Strict(nb);ConsentCore.Need(ConsentCore.Text(nd.RootElement,"ownerSid")==policy.OwnerSid,"HOST_NATIVE_OWNER_BINDING");var current=Environment.ProcessPath??"";ConsentCore.Need(Path.GetFullPath(current).Equals(Path.Combine(program,"CommanderNativeIssuer.exe"),StringComparison.OrdinalIgnoreCase),"HOST_PROTECTED_IMAGE_PATH");using var image=NativeImage.OpenPinned(current,policy.HostSha256,program);return policy;
    }
    internal static void RequireSystem(){var s=WindowsGuard.Inspect();ConsentCore.Need(s.Sid=="S-1-5-18"&&s.Elevated&&s.Administrator&&s.IntegrityRid>=16384&&s.SessionId==0,"HOST_SYSTEM_TOKEN_REQUIRED");}
    internal void Revalidate()
    {RequireSystem();var state=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"ChatGPTRemoteCommander","owner-auth");using var f=WindowsGuard.OpenProtected(Path.Combine(state,"issuer-host-policy.json"),32768);ConsentCore.Need(WindowsGuard.Read(f).SequenceEqual(Bytes),"HOST_POLICY_CHANGED");}
}
internal static class NativeImage
{
    internal static FileStream OpenPinned(string path,string expected,string programRoot)
    {
        ConsentCore.Need(Path.GetDirectoryName(Path.GetFullPath(path))!.Equals(Path.GetFullPath(programRoot),StringComparison.OrdinalIgnoreCase),"PEER_PROTECTED_IMAGE_DIRECTORY");WindowsGuard.Protected(programRoot,true);var file=WindowsGuard.OpenProtected(path,64*1024*1024);
        try{var bytes=WindowsGuard.Read(file);ConsentCore.Need(Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()==expected,"NATIVE_IMAGE_PIN");ValidateNativePe(bytes);return file;}catch{file.Dispose();throw;}
    }
    internal static void ValidateNativePe(byte[] b)
    {
        ConsentCore.Need(b.Length>=512&&b[0]==77&&b[1]==90,"NATIVE_IMAGE_MZ");var pe=BitConverter.ToInt32(b,0x3c);ConsentCore.Need(pe>=64&&pe+264<b.Length&&BitConverter.ToUInt32(b,pe)==0x4550,"NATIVE_IMAGE_PE");var opt=pe+24;ConsentCore.Need(BitConverter.ToUInt16(b,opt)==0x20b,"NATIVE_IMAGE_X64");ConsentCore.Need(BitConverter.ToUInt64(b,opt+112+14*8)==0,"NATIVE_IMAGE_CLR_FORBIDDEN");var rva=BitConverter.ToUInt32(b,opt+112+10*8);var size=BitConverter.ToUInt32(b,opt+112+10*8+4);ConsentCore.Need(size>=80,"NATIVE_IMAGE_LOADCONFIG");var count=BitConverter.ToUInt16(b,pe+6);var sections=opt+BitConverter.ToUInt16(b,pe+20);var offset=-1;for(var i=0;i<count;i++){var s=sections+i*40;ConsentCore.Need(s+40<=b.Length,"NATIVE_IMAGE_SECTIONS");var vs=BitConverter.ToUInt32(b,s+8);var va=BitConverter.ToUInt32(b,s+12);var rs=BitConverter.ToUInt32(b,s+16);var raw=BitConverter.ToUInt32(b,s+20);if(rva>=va&&(ulong)rva<(ulong)va+Math.Max(vs,rs))offset=checked((int)(raw+rva-va));}ConsentCore.Need(offset>=0&&offset+80<=b.Length&&BitConverter.ToUInt16(b,offset+78)==0x800,"NATIVE_IMAGE_SYSTEM32_REQUIRED");
    }
}
