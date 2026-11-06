using System.Security.AccessControl;using System.Security.Cryptography;using System.Security.Principal;using System.Text;using System.Text.Json;
namespace CommanderOwnerConsent;
internal sealed class ExchangeJournal(string root,string enrollmentHash,bool fixture)
{
    internal static byte[] Json(Action<Utf8JsonWriter> f){using var m=new MemoryStream();using(var w=new Utf8JsonWriter(m,new(){Encoder=System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping})){w.WriteStartObject();f(w);w.WriteEndObject();}return m.ToArray();}
    private FileStream Create(string p)
    {
#if OAUTH_EXCHANGE_FIXTURE_TEST
        if(fixture)return new(p,FileMode.CreateNew,FileAccess.ReadWrite,FileShare.None,4096,FileOptions.WriteThrough);
#endif
        var a=new FileSecurity();var admin=new SecurityIdentifier("S-1-5-32-544");var system=new SecurityIdentifier("S-1-5-18");a.SetOwner(admin);a.SetAccessRuleProtection(true,false);foreach(var sid in new[]{admin,system})a.AddAccessRule(new(sid,FileSystemRights.FullControl,AccessControlType.Allow));return new FileInfo(p).Create(FileMode.CreateNew,FileSystemRights.FullControl,FileShare.None,4096,FileOptions.WriteThrough,a);
    }
    internal FileStream Lock()
    {var p=Path.Combine(root,"exchange.lock");try{return Create(p);}catch(IOException){if(!fixture)WindowsGuard.Protected(p,false);return new(p,FileMode.Open,FileAccess.ReadWrite,FileShare.None,4096,FileOptions.WriteThrough);}}
    private byte[] Read(string p,int max){if(!fixture){if(Path.GetFileName(p)=="exchange.journal")return ProtectedJournal.Read(root,"exchange.journal",max,enrollmentHash);using var f=WindowsGuard.OpenProtected(p,max);return WindowsGuard.Read(f);}var b=File.ReadAllBytes(p);ConsentCore.Need(b.Length<=max,"EXCHANGE_STATE_SIZE");return b;}
    private void Head(int sequence,string hash)
    {var b=Json(w=>{w.WriteNumber("sequence",sequence);w.WriteString("hash",hash);w.WriteString("enrollment",enrollmentHash);});var p=Path.Combine(root,"head-next-"+ConsentCore.B64(RandomNumberGenerator.GetBytes(16))+".json");using(var f=Create(p)){f.Write(b);f.Flush(true);}File.Move(p,Path.Combine(root,"exchange.head"),true);}
    internal List<JsonElement> Rows()
    {
        var p=Path.Combine(root,"exchange.journal");var anchor=Path.Combine(root,"exchange.initialized");var head=Path.Combine(root,"exchange.head");
        if(!File.Exists(p)){ConsentCore.Need(!File.Exists(anchor)&&!File.Exists(head),"EXCHANGE_JOURNAL_MISSING_REVIEW");using(var f=Create(anchor)){f.Write(Encoding.UTF8.GetBytes(enrollmentHash));f.Flush(true);}using(var f=Create(p)){f.Flush(true);}Head(0,new string('0',64));}
        ConsentCore.Need(File.Exists(anchor)&&File.Exists(head),"EXCHANGE_ANCHOR_MISSING_REVIEW");ConsentCore.Need(Encoding.UTF8.GetString(Read(anchor,128))==enrollmentHash,"EXCHANGE_ENROLLMENT_CHANGED");
        var bytes=Read(p,8*1024*1024);ConsentCore.Need(bytes.Length==0||bytes[^1]==10,"EXCHANGE_PARTIAL_TAIL_REVIEW");var rows=new List<JsonElement>();var previous=new string('0',64);
        var lines=new UTF8Encoding(false,true).GetString(bytes).Split('\n');foreach(var line in lines.Take(lines.Length-1))
        {
            ConsentCore.Need(line.Length>0,"EXCHANGE_EMPTY_FRAME");using var d=ConsentCore.Strict(Encoding.UTF8.GetBytes(line));var e=d.RootElement;ConsentCore.Fields(e,"sequence","previous","hash","payload");var seq=e.GetProperty("sequence").GetInt32();var payload=e.GetProperty("payload");var raw=Encoding.UTF8.GetBytes(payload.GetRawText());var digest=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(seq+"\n"+previous+"\n").Concat(raw).ToArray())).ToLowerInvariant();ConsentCore.Need(seq==rows.Count+1&&e.GetProperty("previous").GetString()==previous&&e.GetProperty("hash").GetString()==digest,"EXCHANGE_CHAIN_REVIEW");rows.Add(payload.Clone());previous=digest;ConsentCore.Need(rows.Count<=1024,"EXCHANGE_CAPACITY");
        }
        using var h=ConsentCore.Strict(Read(head,1024));ConsentCore.Fields(h.RootElement,"sequence","hash","enrollment");ConsentCore.Need(h.RootElement.GetProperty("sequence").GetInt32()==rows.Count&&h.RootElement.GetProperty("hash").GetString()==previous&&h.RootElement.GetProperty("enrollment").GetString()==enrollmentHash,"EXCHANGE_HEAD_REVIEW");return rows;
    }
    internal void Reserve(List<JsonElement> rows,int count=5)
    {var p=Path.Combine(root,"exchange.journal");ConsentCore.Need(rows.Count+count<=1024&&new FileInfo(p).Length+count*32769L<=8*1024*1024,"EXCHANGE_CAPACITY_RESERVED");}
    internal void Append(List<JsonElement> rows,byte[] payload)
    {
        using var previous=ConsentCore.Strict(Read(Path.Combine(root,"exchange.head"),1024));var hash=previous.RootElement.GetProperty("hash").GetString()!;var seq=rows.Count+1;var digest=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(seq+"\n"+hash+"\n").Concat(payload).ToArray())).ToLowerInvariant();var frame=Json(w=>{w.WriteNumber("sequence",seq);w.WriteString("previous",hash);w.WriteString("hash",digest);w.WritePropertyName("payload");w.WriteRawValue(payload,false);});ConsentCore.Need(frame.Length<=32768,"EXCHANGE_FRAME_CAPACITY");using(var f=new FileStream(Path.Combine(root,"exchange.journal"),FileMode.Open,FileAccess.Write,FileShare.None,4096,FileOptions.WriteThrough)){f.Seek(0,SeekOrigin.End);f.Write(frame);f.WriteByte(10);f.Flush(true);}Head(seq,digest);using var doc=ConsentCore.Strict(payload);rows.Add(doc.RootElement.Clone());
    }
}
