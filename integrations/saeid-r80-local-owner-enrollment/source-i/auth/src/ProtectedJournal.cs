using System.Text;
using System.Text.Json;
namespace CommanderOwnerConsent;
internal static class ProtectedJournal
{
    // Dedicated journal reader. Policy/key/receipt readers still require >0.
    internal static byte[] Read(string root,string name,int max,string enrollment)
    {
        Role(name,max);var baseRoot=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"ChatGPTRemoteCommander","owner-auth");
        var expected=name=="issuer.journal"?baseRoot:Path.Combine(baseRoot,"oauth-exchange");
        ConsentCore.Need(Path.GetFullPath(root).Equals(expected,StringComparison.OrdinalIgnoreCase),"JOURNAL_FIXED_ROLE_PATH");
        WindowsGuard.Protected(root,true);var path=Path.Combine(root,name);WindowsGuard.Protected(path,false);
        using var file=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read);
        WindowsGuard.Protected(path,false);
        return ReadHeld(file,name,max,enrollment,(leaf,bound)=>{using var f=WindowsGuard.OpenProtected(Path.Combine(root,leaf),bound);return WindowsGuard.Read(f);});
    }
    private static void Role(string name,int max)=>ConsentCore.Need(name=="issuer.journal"&&max==4*1024*1024||name=="exchange.journal"&&max==8*1024*1024,"JOURNAL_FIXED_ROLE_SIZE");
    private static byte[] ReadHeld(FileStream file,string name,int max,string enrollment,Func<string,int,byte[]> anchor)
    {
        Role(name,max);ConsentCore.Need(file.Length>=0&&file.Length<=max,"JOURNAL_FILE_SIZE");file.Position=0;using var m=new MemoryStream();file.CopyTo(m);var bytes=m.ToArray();ConsentCore.Need(bytes.Length<=max,"JOURNAL_FILE_SIZE");
        if(bytes.Length>0){ConsentCore.Need(bytes[^1]==10,"JOURNAL_PARTIAL_TAIL_REVIEW_REQUIRED");return bytes;}
        // Only a genuine initial state can authorize a zero-byte journal.
        if(name=="issuer.journal")
        {
            using var a=ConsentCore.Strict(anchor("issuer.initialized",2048));using var h=ConsentCore.Strict(anchor("issuer.head.json",2048));var e=a.RootElement;var head=h.RootElement;
            ConsentCore.Fields(e,"schema","journalId","enrollmentSha256");ConsentCore.Fields(head,"schema","journalId","sequence","hash");
            var id=ConsentCore.Text(e,"journalId",43);ConsentCore.Need(System.Text.RegularExpressions.Regex.IsMatch(id,"^[A-Za-z0-9_-]{43}$")&&ConsentCore.Text(e,"schema")=="RC_ISSUER_INITIALIZED_V1"&&ConsentCore.Text(e,"enrollmentSha256")==enrollment&&ConsentCore.Text(head,"schema")=="RC_ISSUER_HEAD_V1"&&ConsentCore.Text(head,"journalId")==id&&head.GetProperty("sequence").GetInt32()==0&&ConsentCore.Text(head,"hash")==new string('0',64),"EMPTY_NONINITIAL_ISSUER_REVIEW_REQUIRED");
        }
        else
        {
            ConsentCore.Need(Encoding.UTF8.GetString(anchor("exchange.initialized",128))==enrollment,"EMPTY_EXCHANGE_ENROLLMENT");
            using var h=ConsentCore.Strict(anchor("exchange.head",2048));var e=h.RootElement;ConsentCore.Fields(e,"sequence","hash","enrollment");
            ConsentCore.Need(e.GetProperty("sequence").GetInt32()==0&&ConsentCore.Text(e,"hash")==new string('0',64)&&ConsentCore.Text(e,"enrollment")==enrollment,"EMPTY_NONINITIAL_EXCHANGE_REVIEW_REQUIRED");
        }
        return bytes;
    }
#if R80_BOUNDARY_FIXTURE
    // Fixture path bypasses ONLY production ACL/root authority, not the file,
    // length, sharing, tail or anchor-validation code. Absent in production.
    internal static byte[] ReadBoundaryFixture(string root,string name,int max,string enrollment)
    {using var file=new FileStream(Path.Combine(root,name),FileMode.Open,FileAccess.Read,FileShare.Read);return ReadHeld(file,name,max,enrollment,(leaf,bound)=>{var b=File.ReadAllBytes(Path.Combine(root,leaf));ConsentCore.Need(b.Length>0&&b.Length<=bound,"FIXTURE_ANCHOR_SIZE");return b;});}
#endif
}
