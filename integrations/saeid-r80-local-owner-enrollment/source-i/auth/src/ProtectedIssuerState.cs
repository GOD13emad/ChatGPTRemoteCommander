// Source-only protected transaction store; no listener, generic signing or token issuance.
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace CommanderOwnerConsent;

public sealed record PendingSummary(string RequestId,string RequestDigest,long ExpiresAt,string Status,bool ReusedExisting);
public sealed record ConsumedSummary(string RequestId,string Status,string GrantId,bool TokenIssued);

public sealed class ProtectedIssuerState : IDisposable
{
    private readonly string root;private readonly byte[] policy;private readonly ECDsa publicKey;private readonly bool fixture;
    private const int MaxRows=4096,MaxBytes=4*1024*1024;
    private sealed record Row(int Sequence,string Previous,string Hash,string Kind,string RequestId,string RequestKey,string InputDigest,string Bound,string ReceiptId,long At);
    private ProtectedIssuerState(string path,byte[] bytes,string publicPem,bool fixtureMode)
    {root=path;policy=bytes.ToArray();fixture=fixtureMode;using var p=ConsentCore.Strict(policy);ConsentCore.ValidatePolicy(p.RootElement);publicKey=ECDsa.Create();publicKey.ImportFromPem(publicPem);ConsentCore.Need(publicKey.ExportParameters(false).Curve.Oid.Value=="1.2.840.10045.3.1.7","ISSUER_CONSENT_PUBLIC_KEY_ALGORITHM");ConsentCore.Need(Convert.ToHexString(SHA256.HashData(publicKey.ExportSubjectPublicKeyInfo())).ToLowerInvariant()==ConsentCore.Text(p.RootElement,"signingPublicKeySpkiSha256"),"ISSUER_CONSENT_PUBLIC_KEY_PIN");}
    // No root, identity, policy, verifier or key is accepted from a public request.
    public static ProtectedIssuerState OpenProtected()
    {
        var path=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"ChatGPTRemoteCommander","owner-auth");
        WindowsGuard.Protected(path,true);foreach(var part in new[]{"pending","events","receipts"})WindowsGuard.Protected(Path.Combine(path,part),true);
        using var file=WindowsGuard.OpenProtected(Path.Combine(path,"policy.json"),32768);var bytes=WindowsGuard.Read(file);using var p=ConsentCore.Strict(bytes);ConsentCore.ValidatePolicy(p.RootElement);RequireAuthority(p.RootElement);
        using var key=WindowsGuard.OpenProtected(Path.Combine(path,"consent-public.pem"),4096);
        return new(path,bytes,Encoding.UTF8.GetString(WindowsGuard.Read(key)),false);
    }
#if ISSUER_STORE_FIXTURE_TEST
    internal static ProtectedIssuerState OpenFixture(string path,byte[] bytes,string publicPem)
    {Directory.CreateDirectory(path);foreach(var part in new[]{"pending","events","receipts"})Directory.CreateDirectory(Path.Combine(path,part));return new(path,bytes,publicPem,true);}
    internal string? CrashAt;
    private void FixtureCrash(string stage){if(CrashAt==stage)Environment.Exit(71);}
#endif
    private static void RequireAuthority(JsonElement p)
    {
        var s=WindowsGuard.Inspect();
        if(s.Sid=="S-1-5-18")ConsentCore.Need(s.Elevated&&s.Administrator&&s.IntegrityRid>=16384,"SYSTEM_TOKEN_REQUIRED");
        else WindowsGuard.RequireOwner(s,ConsentCore.Text(p,"ownerSid"));
    }
    private void Authority()
    {
        if(fixture)
        {
#if ISSUER_STORE_FIXTURE_TEST
            return;
#else
            throw new ConsentFault("FIXTURE_AUTHORITY_NOT_IN_PRODUCTION");
#endif
        }
        using var p=ConsentCore.Strict(policy);RequireAuthority(p.RootElement);WindowsGuard.Protected(root,true);
        using var f=WindowsGuard.OpenProtected(Path.Combine(root,"policy.json"),32768);ConsentCore.Need(WindowsGuard.Read(f).SequenceEqual(policy),"ENROLLMENT_POLICY_CHANGED");
    }
    private FileStream Create(string path)
    {
#if ISSUER_STORE_FIXTURE_TEST
        if(fixture)return new(path,FileMode.CreateNew,FileAccess.ReadWrite,FileShare.None,4096,FileOptions.WriteThrough);
#endif
        var a=new FileSecurity();var admin=new SecurityIdentifier("S-1-5-32-544");var system=new SecurityIdentifier("S-1-5-18");a.SetOwner(admin);a.SetAccessRuleProtection(true,false);a.AddAccessRule(new FileSystemAccessRule(admin,FileSystemRights.FullControl,AccessControlType.Allow));a.AddAccessRule(new FileSystemAccessRule(system,FileSystemRights.FullControl,AccessControlType.Allow));
        return new FileInfo(path).Create(FileMode.CreateNew,FileSystemRights.FullControl,FileShare.None,4096,FileOptions.WriteThrough,a);
    }
    private FileStream Lock()
    {
        Authority();var path=Path.Combine(root,"writer.lock");
        try{return Create(path);}catch(IOException){if(!fixture)WindowsGuard.Protected(path,false);return new(path,FileMode.Open,FileAccess.ReadWrite,FileShare.None,4096,FileOptions.WriteThrough);}
    }
    private byte[] Read(string path,int max)
    {
        if(!fixture){if(Path.GetFileName(path)=="issuer.journal")return ProtectedJournal.Read(root,"issuer.journal",max,EnrollmentHash);using var f=WindowsGuard.OpenProtected(path,max);return WindowsGuard.Read(f);}
        var b=File.ReadAllBytes(path);ConsentCore.Need(b.Length<=max,"STORE_FILE_CAPACITY");return b;
    }
    private static byte[] Json(Action<Utf8JsonWriter> action)
    {using var m=new MemoryStream();using(var w=new Utf8JsonWriter(m,new(){Encoder=JavaScriptEncoder.UnsafeRelaxedJsonEscaping})){w.WriteStartObject();action(w);w.WriteEndObject();}return m.ToArray();}
    private static string Text(JsonElement e,string name,int max=4096)=>ConsentCore.Text(e,name,max);
    private string EnrollmentHash=>Convert.ToHexString(SHA256.HashData(policy)).ToLowerInvariant();
    private void InitializeOrRequireJournal()
    {
        var journal=Path.Combine(root,"issuer.journal");var marker=Path.Combine(root,"issuer.initialized");var head=Path.Combine(root,"issuer.head.json");
        if(!File.Exists(journal))
        {
            ConsentCore.Need(!File.Exists(marker)&&!File.Exists(head),"JOURNAL_MISSING_REVIEW_REQUIRED");
            var bytes=Json(w=>{w.WriteString("schema","RC_ISSUER_INITIALIZED_V1");w.WriteString("journalId",ConsentCore.B64(RandomNumberGenerator.GetBytes(32)));w.WriteString("enrollmentSha256",EnrollmentHash);});
            using(var f=Create(marker)){f.Write(bytes);f.Flush(true);}using(var f=Create(journal)){f.Flush(true);}WriteHead(0,new string('0',64));
        }
        ConsentCore.Need(File.Exists(marker)&&File.Exists(head),"JOURNAL_ANCHOR_MISSING_REVIEW_REQUIRED");
        using var d=ConsentCore.Strict(Read(marker,2048));var e=d.RootElement;ConsentCore.Fields(e,"schema","journalId","enrollmentSha256");ConsentCore.Need(Text(e,"schema")=="RC_ISSUER_INITIALIZED_V1"&&Text(e,"enrollmentSha256")==EnrollmentHash,"ISSUER_ENROLLMENT_POLICY_CHANGED");
    }
    private void WriteHead(int sequence,string hash)
    {
        using var d=ConsentCore.Strict(Read(Path.Combine(root,"issuer.initialized"),2048));var id=Text(d.RootElement,"journalId");
        var bytes=Json(w=>{w.WriteString("schema","RC_ISSUER_HEAD_V1");w.WriteString("journalId",id);w.WriteNumber("sequence",sequence);w.WriteString("hash",hash);});
        var temporary=Path.Combine(root,"head-next-"+ConsentCore.B64(RandomNumberGenerator.GetBytes(16))+".json");using(var f=Create(temporary)){f.Write(bytes);f.Flush(true);}
        File.Move(temporary,Path.Combine(root,"issuer.head.json"),true);
    }
    private List<Row> Rows()
    {
        InitializeOrRequireJournal();var path=Path.Combine(root,"issuer.journal");
        var raw=Read(path,MaxBytes);ConsentCore.Need(raw.Length==0||raw[^1]==10,"JOURNAL_PARTIAL_TAIL_REVIEW_REQUIRED");
        var rows=new List<Row>();var previous=new string('0',64);
        var lines=new UTF8Encoding(false,true).GetString(raw).Split('\n');
        foreach(var line in lines.Take(Math.Max(0,lines.Length-1)))
        {
            ConsentCore.Need(line.Length>0,"JOURNAL_EMPTY_FRAME");
            using var d=ConsentCore.Strict(Encoding.UTF8.GetBytes(line));var e=d.RootElement;ConsentCore.Fields(e,"sequence","previous","hash","payload");
            var seq=e.GetProperty("sequence").GetInt32();var prev=Text(e,"previous");var hash=Text(e,"hash");var payload=e.GetProperty("payload");ConsentCore.Fields(payload,"kind","requestId","requestKey","inputDigest","bound","receiptId","at");
            var bytes=Encoding.UTF8.GetBytes(payload.GetRawText());var expected=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(seq+"\n"+prev+"\n").Concat(bytes).ToArray())).ToLowerInvariant();
            ConsentCore.Need(seq==rows.Count+1&&prev==previous&&hash==expected,"JOURNAL_INTEGRITY_REVIEW_REQUIRED");
            var row=new Row(seq,prev,hash,Text(payload,"kind"),Text(payload,"requestId"),Text(payload,"requestKey"),Text(payload,"inputDigest"),Text(payload,"bound",16384),Text(payload,"receiptId"),payload.GetProperty("at").GetInt64());
            var earlier=rows.Where(x=>x.RequestId==row.RequestId).ToArray();
            if(row.Kind=="BEGIN_PREPARED")ConsentCore.Need(earlier.Length==0&&!rows.Any(x=>x.RequestKey==row.RequestKey)&&row.ReceiptId=="none","JOURNAL_BEGIN_TRANSITION");
            else
            {
                ConsentCore.Need(earlier.Length>0,"JOURNAL_TRANSITION_WITHOUT_BEGIN");var first=earlier[0];var last=earlier[^1];
                ConsentCore.Need(row.RequestKey==first.RequestKey&&row.InputDigest==first.InputDigest&&row.Bound==first.Bound,"JOURNAL_BINDING_DRIFT");
                var valid=row.Kind switch{"PENDING_COMMITTED"=>last.Kind=="BEGIN_PREPARED"&&row.ReceiptId=="none","CONSUME_PREPARED"=>last.Kind=="PENDING_COMMITTED"&&!rows.Any(x=>x.ReceiptId==row.ReceiptId),"CONSENT_CONSUMED"=>last.Kind=="CONSUME_PREPARED"&&row.ReceiptId==last.ReceiptId,"OWNER_DENIED"=>last.Kind=="PENDING_COMMITTED"&&row.ReceiptId=="none","REVOKED"=>last.Kind!="REVOKED"&&row.ReceiptId=="none",_=>false};
                ConsentCore.Need(valid,"JOURNAL_INVALID_TRANSITION");
            }
            rows.Add(row);previous=hash;
            ConsentCore.Need(rows.Count<=MaxRows,"JOURNAL_ROW_CAPACITY");
        }
        using var anchor=ConsentCore.Strict(Read(Path.Combine(root,"issuer.initialized"),2048));using var head=ConsentCore.Strict(Read(Path.Combine(root,"issuer.head.json"),2048));var h=head.RootElement;ConsentCore.Fields(h,"schema","journalId","sequence","hash");
        ConsentCore.Need(Text(h,"schema")=="RC_ISSUER_HEAD_V1"&&Text(h,"journalId")==Text(anchor.RootElement,"journalId")&&h.GetProperty("sequence").GetInt32()==rows.Count&&Text(h,"hash")==previous,"JOURNAL_HEAD_MISMATCH_REVIEW_REQUIRED");return rows;
    }
    private void Append(List<Row> rows,string kind,Row binding,string receiptId="none")
    {
        var payload=Json(w=>{w.WriteString("kind",kind);w.WriteString("requestId",binding.RequestId);w.WriteString("requestKey",binding.RequestKey);w.WriteString("inputDigest",binding.InputDigest);w.WriteString("bound",binding.Bound);w.WriteString("receiptId",receiptId);w.WriteNumber("at",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());});
        var seq=rows.Count+1;var prev=rows.Count==0?new string('0',64):rows[^1].Hash;var hash=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(seq+"\n"+prev+"\n").Concat(payload).ToArray())).ToLowerInvariant();
        var frame=Json(w=>{w.WriteNumber("sequence",seq);w.WriteString("previous",prev);w.WriteString("hash",hash);w.WritePropertyName("payload");w.WriteRawValue(payload,false);}).Concat(new byte[]{10}).ToArray();
        var path=Path.Combine(root,"issuer.journal");using var f=File.Exists(path)?new FileStream(path,FileMode.Open,FileAccess.ReadWrite,FileShare.None,4096,FileOptions.WriteThrough):Create(path);
        ConsentCore.Need(seq<=MaxRows&&f.Length+frame.Length<=MaxBytes,"JOURNAL_CAPACITY");f.Seek(0,SeekOrigin.End);f.Write(frame);f.Flush(true);
#if ISSUER_STORE_FIXTURE_TEST
        FixtureCrash("AFTER_JOURNAL_APPEND_BEFORE_HEAD");
#endif
        WriteHead(seq,hash);rows.Add(binding with{Sequence=seq,Previous=prev,Hash=hash,Kind=kind,ReceiptId=receiptId});
    }
    private static Row First(List<Row> rows,string requestId)=>rows.FirstOrDefault(x=>x.RequestId==requestId&&x.Kind=="BEGIN_PREPARED")??throw new ConsentFault("UNKNOWN_REQUEST");
    private static string Last(List<Row> rows,string requestId)=>rows.Last(x=>x.RequestId==requestId).Kind;
    private static byte[] Bound(Row r)=>Convert.FromBase64String(r.Bound);
    private static string Digest(byte[] b)=>ConsentCore.Digest(b);
    private static int ReservedFrameLength(Row binding)
    {
        var payload=Json(w=>{w.WriteString("kind","PENDING_COMMITTED");w.WriteString("requestId",binding.RequestId);w.WriteString("requestKey",binding.RequestKey);w.WriteString("inputDigest",binding.InputDigest);w.WriteString("bound",binding.Bound);w.WriteString("receiptId",new string('A',43));w.WriteNumber("at",long.MaxValue);});
        var frame=Json(w=>{w.WriteNumber("sequence",MaxRows);w.WriteString("previous",new string('0',64));w.WriteString("hash",new string('0',64));w.WritePropertyName("payload");w.WriteRawValue(payload,false);});
        ConsentCore.Need(frame.Length<=32768,"JOURNAL_FRAME_CAPACITY");return frame.Length+1;
    }
    private byte[] Pending(Row row)=>Json(w=>{w.WriteString("schema","RC_OWNER_PENDING_V1");w.WritePropertyName("bound");w.WriteRawValue(Bound(row),false);w.WriteString("requestDigest",Digest(Bound(row)));});
    public PendingSummary Begin(byte[] untrustedRequest)
    {
        using var gate=Lock();var rows=Rows();using var d=ConsentCore.Strict(untrustedRequest);var e=d.RootElement;
        ConsentCore.Fields(e,"response_type","client_id","redirect_uri","resource","code_challenge_method","code_challenge","state","grant_policy_id");
        ConsentCore.Need(Text(e,"response_type")=="code"&&Text(e,"code_challenge_method")=="S256","AUTHORIZATION_CODE_S256_REQUIRED");
        var state=Text(e,"state",1024);ConsentCore.Need(state.Length>=16,"STATE_LENGTH");
        var challenge=Text(e,"code_challenge",43);ConsentCore.Need(System.Text.RegularExpressions.Regex.IsMatch(challenge,"^[A-Za-z0-9_-]{43}$"),"PKCE_CHALLENGE_REQUIRED");
        var client=Text(e,"client_id",512);var redirect=Text(e,"redirect_uri",512);var resource=Text(e,"resource",512);var grantId=Text(e,"grant_policy_id",96);
        var canonical=Json(w=>{foreach(var n in new[]{"response_type","client_id","redirect_uri","resource","code_challenge_method","code_challenge","state","grant_policy_id"})w.WriteString(n,Text(e,n));});
        var requestKey=Digest(Json(w=>{w.WriteString("clientId",client);w.WriteString("state",state);}));var inputDigest=Digest(canonical);
        var previous=rows.FirstOrDefault(x=>x.RequestKey==requestKey);
        if(previous!=null)
        {
            ConsentCore.Need(previous.InputDigest==inputDigest,"CLIENT_STATE_BINDING_CHANGED");ConsentCore.Need(Last(rows,previous.RequestId)=="PENDING_COMMITTED","REQUEST_CONSUMED_OR_RECONCILIATION_REQUIRED");
            var existing=Pending(previous);ConsentCore.Need(Read(Path.Combine(root,"pending",previous.RequestId+".json"),32768).SequenceEqual(existing),"PENDING_DISK_MISMATCH");
            using var p0=ConsentCore.Strict(policy);var bound0=ConsentCore.ValidatePending(existing,p0.RootElement,previous.RequestId,DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            return new(previous.RequestId,bound0.RequestDigest,bound0.ExpiresAt,"PENDING",true);
        }
        using var p=ConsentCore.Strict(policy);var policyJson=p.RootElement;
        ConsentCore.Need(resource==Text(policyJson,"resource"),"RESOURCE_BINDING");
        var clients=policyJson.GetProperty("clients").EnumerateArray().Where(c=>Text(c,"clientId")==client).ToArray();ConsentCore.Need(clients.Length==1&&clients[0].GetProperty("redirectUris").EnumerateArray().Any(x=>x.GetString()==redirect),"CLIENT_REDIRECT_BINDING");
        var grants=policyJson.GetProperty("grantCatalog").EnumerateArray().Where(g=>Text(g,"grantPolicyId")==grantId).ToArray();ConsentCore.Need(grants.Length==1,"GRANT_POLICY_BINDING");
        var requestId=ConsentCore.B64(RandomNumberGenerator.GetBytes(32));var nonce=ConsentCore.B64(RandomNumberGenerator.GetBytes(32));var expires=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()+120000;
        var grant=grants[0].GetProperty("grant");
        var bound=Json(w=>{w.WriteString("issuer",Text(policyJson,"issuer"));w.WriteString("resource",resource);w.WriteString("ownerId",Text(policyJson,"ownerId"));w.WriteString("enrollmentEpoch",Text(policyJson,"enrollmentEpoch"));w.WriteString("requestId",requestId);w.WriteString("nonce",nonce);w.WriteNumber("expiresAt",expires);w.WriteString("clientId",client);w.WriteString("redirectUri",redirect);w.WriteString("challenge",challenge);w.WriteString("state",state);w.WriteString("grantPolicyId",grantId);w.WritePropertyName("grant");w.WriteStartObject();w.WriteString("profileId",Text(grant,"profileId"));w.WriteString("rootPolicyId",Text(grant,"rootPolicyId"));foreach(var set in new[]{"actions","scopes"}){w.WritePropertyName(set);w.WriteStartArray();foreach(var x in grant.GetProperty(set).EnumerateArray().Select(v=>v.GetString()!).Order(StringComparer.Ordinal))w.WriteStringValue(x);w.WriteEndArray();}w.WriteEndObject();});
        var binding=new Row(0,"","","BEGIN_PREPARED",requestId,requestKey,inputDigest,Convert.ToBase64String(bound),"none",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        // Fixed conservative reservation for begin+consume+revoke (5 frames).
        // No side effect occurs if capacity is insufficient.
        var begun=rows.Where(x=>x.Kind=="BEGIN_PREPARED").ToArray();ConsentCore.Need(begun.Length<128,"ISSUER_TRANSACTION_CAPACITY");
        long reserveRows=5,reserveBytes=5L*ReservedFrameLength(binding);
        foreach(var old in begun){var remaining=5-rows.Count(x=>x.RequestId==old.RequestId);ConsentCore.Need(remaining>=0,"JOURNAL_TRANSITION_CAPACITY");reserveRows+=remaining;reserveBytes+=remaining*(long)ReservedFrameLength(old);}
        ConsentCore.Need(rows.Count+reserveRows<=MaxRows,"ISSUER_ROWS_RESERVED");
        var journal=Path.Combine(root,"issuer.journal");ConsentCore.Need((File.Exists(journal)?new FileInfo(journal).Length:0)+reserveBytes<=MaxBytes,"ISSUER_BYTES_RESERVED");
        var pending=Pending(binding);ConsentCore.ValidatePending(pending,policyJson,requestId,DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());Append(rows,"BEGIN_PREPARED",binding);
#if ISSUER_STORE_FIXTURE_TEST
        FixtureCrash("AFTER_PREPARED");
#endif
        using(var f=Create(Path.Combine(root,"pending",requestId+".json"))){f.Write(pending);f.Flush(true);}
#if ISSUER_STORE_FIXTURE_TEST
        FixtureCrash("AFTER_PENDING_FILE");
#endif
        Append(rows,"PENDING_COMMITTED",binding);return new(requestId,Digest(bound),expires,"PENDING",false);
    }
    public ConsumedSummary ConsumeNativeReceipt(string requestId)
    {
        using var gate=Lock();var rows=Rows();var row=First(rows,requestId);ConsentCore.Need(Last(rows,requestId)=="PENDING_COMMITTED","REQUEST_CONSUMED_OR_RECONCILIATION_REQUIRED");
        using var p=ConsentCore.Strict(policy);var pending=Pending(row);ConsentCore.Need(Read(Path.Combine(root,"pending",requestId+".json"),32768).SequenceEqual(pending),"PENDING_DISK_MISMATCH");var bound=ConsentCore.ValidatePending(pending,p.RootElement,requestId,DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        using var d=ConsentCore.Strict(Read(Path.Combine(root,"receipts",requestId+".json"),32768));var e=d.RootElement;
        if(e.TryGetProperty("status",out var status))
        {
            ConsentCore.Fields(e,"status","requestId","requestDigest","automaticRetryAllowed");ConsentCore.Need(status.GetString()=="OWNER_DENIED_OR_TIMEOUT"&&Text(e,"requestId")==requestId&&Text(e,"requestDigest")==bound.RequestDigest&&e.GetProperty("automaticRetryAllowed").ValueKind==JsonValueKind.False,"NATIVE_DENIAL_BINDING");
            Append(rows,"OWNER_DENIED",row);return new(requestId,"OWNER_DENIED_TOKEN_NOT_ISSUED",bound.GrantId,false);
        }
        ConsentCore.Fields(e,"statement","signature");var s=e.GetProperty("statement");ConsentCore.Fields(s,"kind","issuer","ownerId","enrollmentEpoch","receiptId","requestDigest","grantId","issuedAt","expiresAt");
        var now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();var at=s.GetProperty("issuedAt").GetInt64();var exp=s.GetProperty("expiresAt").GetInt64();var receiptId=Text(s,"receiptId",43);
        ConsentCore.Need(Text(s,"kind")=="approve"&&Text(s,"issuer")==bound.Issuer&&Text(s,"ownerId")==bound.OwnerId&&Text(s,"enrollmentEpoch")==bound.Epoch&&Text(s,"requestDigest")==bound.RequestDigest&&Text(s,"grantId")==bound.GrantId&&at>=now-120000&&at<=now&&exp>now&&exp<=now+120000&&exp<=bound.ExpiresAt,"NATIVE_RECEIPT_BINDING");
        ConsentCore.Need(System.Text.RegularExpressions.Regex.IsMatch(receiptId,"^[A-Za-z0-9_-]{43}$")&&!rows.Any(x=>x.ReceiptId==receiptId),"RECEIPT_REPLAY");
        var message=Encoding.UTF8.GetBytes("RC_OWNER_OAUTH_CONSENT_V1\n"+s.GetRawText());var signature=Convert.FromBase64String(Text(e,"signature",128).Replace('-','+').Replace('_','/').PadRight((Text(e,"signature",128).Length+3)/4*4,'='));
        ConsentCore.Need(publicKey.VerifyData(message,signature,HashAlgorithmName.SHA256,DSASignatureFormat.Rfc3279DerSequence),"NATIVE_RECEIPT_SIGNATURE");
        Append(rows,"CONSUME_PREPARED",row,receiptId);
#if ISSUER_STORE_FIXTURE_TEST
        FixtureCrash("AFTER_CONSUME_PREPARED");
#endif
        Append(rows,"CONSENT_CONSUMED",row,receiptId);return new(requestId,"CONSENT_CONSUMED_TOKEN_NOT_ISSUED",bound.GrantId,false);
    }
    public void Revoke(string requestId)
    {using var gate=Lock();var rows=Rows();var row=First(rows,requestId);ConsentCore.Need(Last(rows,requestId)!="REVOKED","ALREADY_REVOKED");Append(rows,"REVOKED",row);}
    public string ReadStatus(string requestId)
    {using var gate=Lock();return Last(Rows(),requestId);}
    public void Dispose()=>publicKey.Dispose();
}
