using CommanderOwnerConsent;
using System.Text.Json;
namespace CommanderOwnerBootstrap;
internal sealed class Bundle:IDisposable
{
    internal readonly string OwnerSid,ManifestHash;internal readonly int Session;internal readonly Dictionary<string,string> Hashes=[];internal readonly Dictionary<string,FileStream> Files=[];
    internal Bundle(string root,string expected)
    {
        ConsentCore.Need(System.Text.RegularExpressions.Regex.IsMatch(expected,"^[a-f0-9]{64}$"),"BUNDLE_PIN_FORMAT");root=Path.GetFullPath(root);WindowsGuard.NoReparse(root);
        try{
            var f=Open(Path.Combine(root,"BUNDLE.json"),32768);Files.Add("BUNDLE.json",f);var bytes=WindowsGuard.Read(f);ManifestHash=BootstrapPolicy.Hex(bytes);ConsentCore.Need(ManifestHash==expected,"BUNDLE_PIN");using var d=ConsentCore.Strict(bytes);var e=d.RootElement;
            ConsentCore.Fields(e,"schema","ownerSid","ownerSessionId","bootstrapSha256","images","hostSourceRevision","scope");
            ConsentCore.Need(ConsentCore.Text(e,"schema")=="RC_OWNER_BOOTSTRAP_BUNDLE_V1"&&ConsentCore.Text(e,"scope")=="no-project-selftest-only"&&ConsentCore.Text(e,"hostSourceRevision")=="r80-protected-empty-journal-fix","BUNDLE_SCOPE");
            OwnerSid=ConsentCore.Text(e,"ownerSid");Session=e.GetProperty("ownerSessionId").GetInt32();ConsentCore.Need(Session>0,"BUNDLE_OWNER_SESSION");_ =new System.Security.Principal.SecurityIdentifier(OwnerSid);
            var images=e.GetProperty("images");ConsentCore.Fields(images,BootstrapPolicy.Images);
            foreach(var name in BootstrapPolicy.Images){var h=ConsentCore.Text(images,name,64);ConsentCore.Need(System.Text.RegularExpressions.Regex.IsMatch(h,"^[a-f0-9]{64}$"),"BUNDLE_IMAGE_PIN_FORMAT");var image=Open(Path.Combine(root,name),64*1024*1024);Files.Add(name,image);var raw=WindowsGuard.Read(image);ConsentCore.Need(BootstrapPolicy.Hex(raw)==h,"BUNDLE_IMAGE_HASH");Pe(raw);Hashes.Add(name,h);}
            ConsentCore.Need(Hashes["CommanderOwnerConsent.exe"]==BootstrapPolicy.FrozenConsent&&Hashes["CommanderNativeIssuer.exe"]==BootstrapPolicy.FrozenHost,"FROZEN_RUNTIME_PIN");
            var self=Open(Environment.ProcessPath??"",64*1024*1024);Files.Add("CommanderOwnerBootstrap.exe",self);var own=WindowsGuard.Read(self);ConsentCore.Need(BootstrapPolicy.Hex(own)==ConsentCore.Text(e,"bootstrapSha256",64),"BOOTSTRAP_SELF_PIN");Pe(own);
        }catch{Dispose();throw;}
    }
    private static FileStream Open(string path,int max){WindowsGuard.NoReparse(path);var f=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read);try{ConsentCore.Need(f.Length is >0&&f.Length<=max,"BUNDLE_FILE_SIZE");return f;}catch{f.Dispose();throw;}}
    internal static void Pe(byte[] b)
    {
        ConsentCore.Need(b.Length>=512&&b[0]==77&&b[1]==90,"NATIVE_MZ");var pe=BitConverter.ToInt32(b,0x3c);ConsentCore.Need(pe>=64&&pe+264<b.Length&&BitConverter.ToUInt32(b,pe)==0x4550,"NATIVE_PE");var opt=pe+24;ConsentCore.Need(BitConverter.ToUInt16(b,opt)==0x20b&&BitConverter.ToUInt64(b,opt+112+14*8)==0,"NATIVE_CLR_FORBIDDEN");var rva=BitConverter.ToUInt32(b,opt+112+10*8);var size=BitConverter.ToUInt32(b,opt+112+10*8+4);ConsentCore.Need(size>=80,"NATIVE_LOADCONFIG");var count=BitConverter.ToUInt16(b,pe+6);var sections=opt+BitConverter.ToUInt16(b,pe+20);var offset=-1;for(var i=0;i<count;i++){var s=sections+i*40;ConsentCore.Need(s+40<=b.Length,"NATIVE_SECTIONS");var vs=BitConverter.ToUInt32(b,s+8);var va=BitConverter.ToUInt32(b,s+12);var rs=BitConverter.ToUInt32(b,s+16);var raw=BitConverter.ToUInt32(b,s+20);if(rva>=va&&(ulong)rva<(ulong)va+Math.Max(vs,rs))offset=checked((int)(raw+rva-va));}ConsentCore.Need(offset>=0&&offset+80<=b.Length&&BitConverter.ToUInt16(b,offset+78)==0x800,"NATIVE_SYSTEM32_REQUIRED");
    }
    public void Dispose(){foreach(var f in Files.Values)f.Dispose();Files.Clear();}
}
