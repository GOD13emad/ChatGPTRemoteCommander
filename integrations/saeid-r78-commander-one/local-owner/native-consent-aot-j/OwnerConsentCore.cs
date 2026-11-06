// SOURCE CANDIDATE. This core is not an enrollment or a generic signing API.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Encodings.Web;
using System.Text.RegularExpressions;

namespace CommanderOwnerConsent;

internal sealed class ConsentFault(string code) : Exception(code) { }
internal sealed record ApprovedRequest(string RequestId,string RequestDigest,string GrantId,string Issuer,string OwnerId,string Epoch,
    string ClientId,string RedirectUri,string Resource,string Profile,string RootPolicy,string[] Actions,string[] Scopes,long ExpiresAt,byte[] SourceBytes);

internal static class ConsentCore
{
    internal static void Need(bool value,string code) { if (!value) throw new ConsentFault(code); }
    internal static string B64(byte[] x)=>Convert.ToBase64String(x).TrimEnd('=').Replace('+','-').Replace('/','_');
    internal static string Digest(byte[] x)=>B64(SHA256.HashData(x));
    internal static JsonDocument Strict(byte[] bytes)
    {
        Need(bytes.Length is > 0 and <= 32768,"JSON_SIZE");
        var d=JsonDocument.Parse(bytes,new JsonDocumentOptions {MaxDepth=12,AllowTrailingCommas=false,CommentHandling=JsonCommentHandling.Disallow});
        try { Unique(d.RootElement); return d; } catch {d.Dispose();throw;}
    }
    private static void Unique(JsonElement e)
    {
        if(e.ValueKind==JsonValueKind.Object) {var seen=new HashSet<string>(StringComparer.Ordinal); foreach(var p in e.EnumerateObject()){Need(seen.Add(p.Name),"DUPLICATE_JSON_PROPERTY");Unique(p.Value);}}
        else if(e.ValueKind==JsonValueKind.Array) foreach(var v in e.EnumerateArray()) Unique(v);
    }
    internal static void Fields(JsonElement e,params string[] fields)
    { Need(e.ValueKind==JsonValueKind.Object&&e.EnumerateObject().Select(p=>p.Name).Order(StringComparer.Ordinal).SequenceEqual(fields.Order(StringComparer.Ordinal)),"JSON_SCHEMA"); }
    internal static string Text(JsonElement e,string name,int max=512)
    { var v=e.GetProperty(name); Need(v.ValueKind==JsonValueKind.String,"TEXT_REQUIRED");var s=v.GetString()!;Need(s.Length is >0&&s.Length<=max&&!s.Any(char.IsControl),"INVALID_TEXT");return s; }
    private static string Id(JsonElement e,string name) {var s=Text(e,name,96);Need(Regex.IsMatch(s,"^[a-z][a-z0-9_.:-]{0,95}$",RegexOptions.CultureInvariant),"INVALID_ID");return s;}
    private static string Opaque(JsonElement e,string name) {var s=Text(e,name,43);Need(Regex.IsMatch(s,"^[A-Za-z0-9_-]{43}$",RegexOptions.CultureInvariant),"INVALID_OPAQUE");return s;}
    private static string[] Ids(JsonElement e,string name)
    {
        var a=e.GetProperty(name);Need(a.ValueKind==JsonValueKind.Array&&a.GetArrayLength() is >0 and <=32,"INVALID_SET");
        var values=a.EnumerateArray().Select(x=>x.GetString()??"").ToArray();
        Need(values.All(x=>Regex.IsMatch(x,"^[a-z][a-z0-9_.:-]{0,95}$",RegexOptions.CultureInvariant))&&values.Distinct(StringComparer.Ordinal).Count()==values.Length,"INVALID_SET");
        return values.Order(StringComparer.Ordinal).ToArray();
    }
    internal static void ValidatePolicy(JsonElement p)
    {
        Fields(p,"schema","issuer","resource","ownerId","ownerSid","enrollmentEpoch","helperSha256","signingPublicKeySpkiSha256","clients","grantCatalog");
        Need(Text(p,"schema")=="RC_OWNER_CONSENT_POLICY_V1","POLICY_SCHEMA");Id(p,"ownerId");Id(p,"enrollmentEpoch");
        Need(Regex.IsMatch(Text(p,"ownerSid"),"^S-1-5-21-[0-9-]+$",RegexOptions.CultureInvariant),"OWNER_SID_POLICY");
        foreach(var k in new[]{"helperSha256","signingPublicKeySpkiSha256"})Need(Regex.IsMatch(Text(p,k),"^[a-f0-9]{64}$",RegexOptions.CultureInvariant),"PIN_FORMAT");
        foreach(var k in new[]{"issuer","resource"})Https(Text(p,k));
        Need(string.IsNullOrEmpty(new Uri(Text(p,"issuer")).Query),"ISSUER_QUERY_DENIED");
        var clients=p.GetProperty("clients");Need(clients.ValueKind==JsonValueKind.Array&&clients.GetArrayLength() is >0 and <=8,"CLIENT_POLICY");
        var seen=new HashSet<string>(StringComparer.Ordinal);
        foreach(var c in clients.EnumerateArray()) {Fields(c,"clientId","redirectUris");Need(seen.Add(Text(c,"clientId")),"DUPLICATE_CLIENT");var u=c.GetProperty("redirectUris");Need(u.ValueKind==JsonValueKind.Array&&u.GetArrayLength() is >0 and <=8,"CLIENT_POLICY");foreach(var r in u.EnumerateArray())Https(r.GetString()??"");}
        var grants=p.GetProperty("grantCatalog");Need(grants.ValueKind==JsonValueKind.Array&&grants.GetArrayLength() is >0 and <=32,"GRANT_POLICY");seen.Clear();
        foreach(var g in grants.EnumerateArray()){Fields(g,"grantPolicyId","grant");Need(seen.Add(Id(g,"grantPolicyId")),"DUPLICATE_GRANT");var v=g.GetProperty("grant");Fields(v,"profileId","rootPolicyId","actions","scopes");Id(v,"profileId");Id(v,"rootPolicyId");Ids(v,"actions");Ids(v,"scopes");}
    }
    private static void Https(string u) {Need(Uri.TryCreate(u,UriKind.Absolute,out var v)&&v.Scheme=="https"&&string.IsNullOrEmpty(v.UserInfo)&&string.IsNullOrEmpty(v.Fragment)&&v.AbsoluteUri==u,"HTTPS_URI_REQUIRED");}
    internal static ApprovedRequest ValidatePending(byte[] raw,JsonElement policy,string requestedId,long now)
    {
        ValidatePolicy(policy);
        using var d=Strict(raw);var p=d.RootElement;Fields(p,"schema","bound","requestDigest");Need(Text(p,"schema")=="RC_OWNER_PENDING_V1","PENDING_SCHEMA");
        var b=p.GetProperty("bound");Fields(b,"issuer","resource","ownerId","enrollmentEpoch","requestId","nonce","expiresAt","clientId","redirectUri","challenge","state","grantPolicyId","grant");
        var rid=Opaque(b,"requestId");Need(rid==requestedId,"REQUEST_ID_MISMATCH");Opaque(b,"nonce");Opaque(b,"challenge");
        foreach(var k in new[]{"issuer","resource","ownerId","enrollmentEpoch"})Need(Text(b,k)==Text(policy,k),"OWNER_ISSUER_BINDING");
        var exp=b.GetProperty("expiresAt").GetInt64();Need(exp>now&&exp-now<=120000,"PENDING_EXPIRED_OR_TOO_LONG");
        var digest=Digest(Encoding.UTF8.GetBytes(b.GetRawText()));Need(Opaque(p,"requestDigest")==digest,"PENDING_DIGEST");
        var client=Text(b,"clientId");var redirect=Text(b,"redirectUri");var admitted=policy.GetProperty("clients").EnumerateArray().Where(c=>Text(c,"clientId")==client).ToArray();
        Need(admitted.Length==1&&admitted[0].GetProperty("redirectUris").EnumerateArray().Any(x=>x.GetString()==redirect),"CLIENT_REDIRECT_BINDING");
        Need(Text(b,"state",1024).Length>=16,"STATE_LENGTH");var gp=Id(b,"grantPolicyId");var matches=policy.GetProperty("grantCatalog").EnumerateArray().Where(g=>Id(g,"grantPolicyId")==gp).ToArray();Need(matches.Length==1,"GRANT_POLICY_BINDING");
        var grant=b.GetProperty("grant");Fields(grant,"profileId","rootPolicyId","actions","scopes");var expected=matches[0].GetProperty("grant");
        Need(Id(grant,"profileId")==Id(expected,"profileId")&&Id(grant,"rootPolicyId")==Id(expected,"rootPolicyId")&&Ids(grant,"actions").SequenceEqual(Ids(expected,"actions"))&&Ids(grant,"scopes").SequenceEqual(Ids(expected,"scopes")),"GRANT_FIELDS_BINDING");
        var gid="grant:"+Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(rid))).ToLowerInvariant()[..32];
        return new(rid,digest,gid,Text(b,"issuer"),Id(b,"ownerId"),Id(b,"enrollmentEpoch"),client,redirect,Text(b,"resource"),Id(grant,"profileId"),Id(grant,"rootPolicyId"),Ids(grant,"actions"),Ids(grant,"scopes"),exp,raw.ToArray());
    }
    internal static byte[] Statement(ApprovedRequest r,long now,string receiptId)
    {
        Need(now<r.ExpiresAt,"CONSENT_EXPIRED");
        // This exact fixed-property object is signed again after JSON.parse /
        // JSON.stringify in the JS kernel. HTML-safe escaping would change its
        // signature bytes for valid URI path characters such as '&'.
        using var m=new MemoryStream();using(var w=new Utf8JsonWriter(m,new JsonWriterOptions{Encoder=JavaScriptEncoder.UnsafeRelaxedJsonEscaping})){w.WriteStartObject();w.WriteString("kind","approve");w.WriteString("issuer",r.Issuer);w.WriteString("ownerId",r.OwnerId);w.WriteString("enrollmentEpoch",r.Epoch);w.WriteString("receiptId",receiptId);w.WriteString("requestDigest",r.RequestDigest);w.WriteString("grantId",r.GrantId);w.WriteNumber("issuedAt",now);w.WriteNumber("expiresAt",Math.Min(r.ExpiresAt,checked(now+60000)));w.WriteEndObject();}return m.ToArray();
    }
}
