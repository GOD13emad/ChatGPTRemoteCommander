using System.Security.Cryptography;using System.Text;using System.Text.Json;using CommanderOwnerConsent;using CommanderOwnerProxy;
namespace CommanderOwnerAcceptance;
internal sealed class ProbeAuthority:IDisposable
{
    internal const string Issuer="https://commander.invalid/owner",Endpoint="https://commander.invalid/owner/token",Resource="https://commander.invalid/selftest",Client="commander-owner-selftest",Redirect="https://commander.invalid/local-callback",ConsentPin="599847485c8650740bd59228a4f7629534acf0d85ca84593b81faf38ac990a13";
    internal ClientPolicy ClientPolicy{get;}internal readonly byte[] NativeBytes,OAuthBytes;internal readonly JsonDocument Native,OAuth;internal readonly ECDsa ConsentPublic,IssuerPublic;private readonly List<FileStream> held=[];private readonly bool elevated;
    private ProbeAuthority(ClientPolicy p,bool admin)
    {
        ClientPolicy=p;elevated=admin;p.DemandOwner(WindowsGuard.Inspect(),admin);
        NativeBytes=Read("policy.json",32768);OAuthBytes=Read("oauth-policy.json",32768);Native=ConsentCore.Strict(NativeBytes);OAuth=ConsentCore.Strict(OAuthBytes);ValidateScope(Native.RootElement,OAuth.RootElement,p);
        ConsentPublic=Public("consent-public.pem",ConsentCore.Text(Native.RootElement,"signingPublicKeySpkiSha256"));IssuerPublic=Public("oauth-public.pem",ConsentCore.Text(OAuth.RootElement,"signingPublicKeySpkiSha256"));
    }
    internal static ProbeAuthority Load(bool admin)
    {var p=ClientPolicy.LoadProtected();try{return new(p,admin);}catch{p.Dispose();throw;}}
    internal string OwnerSid=>ClientPolicy.OwnerSid;internal int Session=>ClientPolicy.OwnerSessionId;internal string StateRoot=>ClientPolicy.StateRoot;internal string ProgramRoot=>ClientPolicy.ProgramRoot;internal string AcceptanceRoot=>Path.Combine(StateRoot,"selftest-acceptance");
    internal static string Hex(byte[] b)=>Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();
    internal void Revalidate(){ClientPolicy.Revalidate(elevated);ConsentCore.Need(Hex(ReadFresh("policy.json",32768))==Hex(NativeBytes)&&Hex(ReadFresh("oauth-policy.json",32768))==Hex(OAuthBytes),"PROBE_POLICY_CHANGED");}
    private byte[] Read(string name,int size){var f=WindowsGuard.OpenProtected(Path.Combine(StateRoot,name),size);held.Add(f);return WindowsGuard.Read(f);}
    internal byte[] ReadFresh(string name,int size){using var f=WindowsGuard.OpenProtected(Path.Combine(StateRoot,name),size);return WindowsGuard.Read(f);}
    private ECDsa Public(string name,string pin)
    {var b=Read(name,4096);var k=ECDsa.Create();try{k.ImportFromPem(Encoding.UTF8.GetString(b));ConsentCore.Need(k.KeySize==256&&k.ExportParameters(false).Curve.Oid.Value=="1.2.840.10045.3.1.7"&&Hex(k.ExportSubjectPublicKeyInfo())==pin,"PROBE_PUBLIC_KEY_PIN");return k;}catch{k.Dispose();throw;}}
    internal static void ValidateScope(JsonElement n,JsonElement o,ClientPolicy p)
    {
        ConsentCore.ValidatePolicy(n);ConsentCore.Need(ConsentCore.Text(n,"issuer")==Issuer&&ConsentCore.Text(n,"resource")==Resource&&ConsentCore.Text(n,"ownerId")=="local-owner"&&ConsentCore.Text(n,"ownerSid")==p.OwnerSid&&ConsentCore.Text(n,"helperSha256")==ConsentPin,"PROBE_EXACT_NO_PROJECT_AUTHORITY");
        ConsentCore.Need(p.ClientId==Client&&p.RedirectUri==Redirect&&p.Resource==Resource&&p.GrantPolicyIds.SequenceEqual(new[]{"selftest"}),"PROBE_EXACT_CLIENT_POLICY");
        var nc=n.GetProperty("clients");ConsentCore.Need(nc.GetArrayLength()==1&&ConsentCore.Text(nc[0],"clientId")==Client&&nc[0].GetProperty("redirectUris").GetArrayLength()==1&&nc[0].GetProperty("redirectUris")[0].GetString()==Redirect,"PROBE_NO_EXTRA_CLIENTS");
        var grants=n.GetProperty("grantCatalog");ConsentCore.Need(grants.GetArrayLength()==1&&ConsentCore.Text(grants[0],"grantPolicyId")=="selftest","PROBE_NO_EXTRA_GRANTS");var g=grants[0].GetProperty("grant");ConsentCore.Need(ConsentCore.Text(g,"profileId")=="selftest"&&ConsentCore.Text(g,"rootPolicyId")=="no-project"&&OnlySelftest(g.GetProperty("actions"))&&OnlySelftest(g.GetProperty("scopes")),"PROBE_NO_PROJECT_SCOPE");
        ConsentCore.Fields(o,"schema","issuer","tokenEndpoint","resource","ownerId","enrollmentEpoch","keyId","signingPublicKeySpkiSha256","clients");ConsentCore.Need(ConsentCore.Text(o,"schema")=="RC_PROTECTED_OAUTH_POLICY_V1"&&ConsentCore.Text(o,"issuer")==Issuer&&ConsentCore.Text(o,"tokenEndpoint")==Endpoint&&ConsentCore.Text(o,"resource")==Resource&&ConsentCore.Text(o,"ownerId")=="local-owner"&&ConsentCore.Text(o,"enrollmentEpoch")==ConsentCore.Text(n,"enrollmentEpoch")&&ConsentCore.Text(o,"keyId")=="owner-selftest-es256","PROBE_EXACT_OAUTH_POLICY");var clients=o.GetProperty("clients");ConsentCore.Need(clients.GetArrayLength()==1&&ConsentCore.Text(clients[0],"clientId")==Client&&clients[0].GetProperty("jwks").GetArrayLength()==1,"PROBE_EXACT_CLIENT_KEY_SET");var jwk=clients[0].GetProperty("jwks")[0];ConsentCore.Fields(jwk,"kid","use","alg","kty","crv","x","y");ConsentCore.Need(ConsentCore.Text(jwk,"kid")=="selftest-client"&&ConsentCore.Text(jwk,"use")=="sig"&&ConsentCore.Text(jwk,"alg")=="ES256"&&ConsentCore.Text(jwk,"kty")=="EC"&&ConsentCore.Text(jwk,"crv")=="P-256","PROBE_FIXED_ASSERTION_KEY");
    }
    internal static bool OnlySelftest(JsonElement a)=>a.ValueKind==JsonValueKind.Array&&a.GetArrayLength()==1&&a[0].GetString()=="selftest";
    internal static byte[] B64(string s,int max=32768)
    {ConsentCore.Need(s.Length is >0&&s.Length<=max&&System.Text.RegularExpressions.Regex.IsMatch(s,"^[A-Za-z0-9_-]+$"),"PROBE_B64");var b=Convert.FromBase64String(s.Replace('-','+').Replace('_','/').PadRight((s.Length+3)/4*4,'='));ConsentCore.Need(ConsentCore.B64(b)==s,"PROBE_B64");return b;}
    internal void DemandClientPrivate(ECDsa key)
    {var pub=key.ExportParameters(false);var j=OAuth.RootElement.GetProperty("clients")[0].GetProperty("jwks")[0];ConsentCore.Need(pub.Curve.Oid.Value=="1.2.840.10045.3.1.7"&&ConsentCore.B64(pub.Q.X!)==ConsentCore.Text(j,"x")&&ConsentCore.B64(pub.Q.Y!)==ConsentCore.Text(j,"y"),"PROBE_SELFTEST_PRIVATE_KEY_BINDING");}
    internal void VerifyConsent(byte[] receipt,ApprovedRequest request,long now)
    {
        using var d=ConsentCore.Strict(receipt);var e=d.RootElement;ConsentCore.Fields(e,"statement","signature");var s=e.GetProperty("statement");ConsentCore.Fields(s,"kind","issuer","ownerId","enrollmentEpoch","receiptId","requestDigest","grantId","issuedAt","expiresAt");var start=s.GetProperty("issuedAt").GetInt64();var end=s.GetProperty("expiresAt").GetInt64();ConsentCore.Need(ConsentCore.Text(s,"kind")=="approve"&&ConsentCore.Text(s,"issuer")==Issuer&&ConsentCore.Text(s,"ownerId")=="local-owner"&&ConsentCore.Text(s,"enrollmentEpoch")==request.Epoch&&ConsentCore.Text(s,"requestDigest")==request.RequestDigest&&ConsentCore.Text(s,"grantId")==request.GrantId&&start<=now&&end>now&&end<=start+60000&&end<=request.ExpiresAt,"PROBE_ACTUAL_APPROVAL_BINDING");var msg=Encoding.UTF8.GetBytes("RC_OWNER_OAUTH_CONSENT_V1\n"+s.GetRawText());ConsentCore.Need(ConsentPublic.VerifyData(msg,B64(ConsentCore.Text(e,"signature",256)),HashAlgorithmName.SHA256,DSASignatureFormat.Rfc3279DerSequence),"PROBE_ACTUAL_APPROVAL_SIGNATURE");
    }
    public void Dispose(){ConsentPublic.Dispose();IssuerPublic.Dispose();Native.Dispose();OAuth.Dispose();for(var i=held.Count-1;i>=0;i--)held[i].Dispose();ClientPolicy.Dispose();}
}
