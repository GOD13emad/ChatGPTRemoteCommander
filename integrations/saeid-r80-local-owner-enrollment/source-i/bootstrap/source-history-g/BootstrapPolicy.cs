using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CommanderOwnerConsent;
namespace CommanderOwnerBootstrap;
internal static class BootstrapPolicy
{
    internal const string TaskName="\\ChatGPTRemoteCommanderOwnerIssuerV1",Issuer="https://commander.invalid/owner",Resource="https://commander.invalid/selftest",TokenEndpoint="https://commander.invalid/owner/token",Client="commander-owner-selftest",Redirect="https://commander.invalid/local-callback";
    internal static readonly string[] Images=["CommanderNativeIssuer.exe","CommanderOwnerConsent.exe","CommanderOwnerProxy.exe","CommanderOwnerAdmin.exe"];
    internal const string FrozenHost="f4bf84f09cabae3a128d577cc5f4f07f8708a2b5fdf6d67432eccc6bdbdb58f9",FrozenConsent="599847485c8650740bd59228a4f7629534acf0d85ca84593b81faf38ac990a13";
    internal static string Hex(byte[] b)=>Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();
    internal static byte[] Json(Action<Utf8JsonWriter> action){using var m=new MemoryStream();using(var w=new Utf8JsonWriter(m)){w.WriteStartObject();action(w);w.WriteEndObject();}return m.ToArray();}
    internal static void Strings(Utf8JsonWriter w,string field,params string[] values){w.WritePropertyName(field);w.WriteStartArray();foreach(var x in values)w.WriteStringValue(x);w.WriteEndArray();}
    internal static Dictionary<string,byte[]> Policies(string ownerSid,int session,string epoch,IReadOnlyDictionary<string,string> images,ECDsa consent,ECDsa issuer,ECDsa client)
    {
        ConsentCore.Need(session>0&&System.Text.RegularExpressions.Regex.IsMatch(ownerSid,"^S-1-5-21-[0-9-]+$"),"OWNER_SESSION_BINDING");
        var result=new Dictionary<string,byte[]>();
        var native=Json(w=>{w.WriteString("schema","RC_OWNER_CONSENT_POLICY_V1");w.WriteString("issuer",Issuer);w.WriteString("resource",Resource);w.WriteString("ownerId","local-owner");w.WriteString("ownerSid",ownerSid);w.WriteString("enrollmentEpoch",epoch);w.WriteString("helperSha256",images[Images[1]]);w.WriteString("signingPublicKeySpkiSha256",Hex(consent.ExportSubjectPublicKeyInfo()));w.WritePropertyName("clients");w.WriteStartArray();w.WriteStartObject();w.WriteString("clientId",Client);Strings(w,"redirectUris",Redirect);w.WriteEndObject();w.WriteEndArray();w.WritePropertyName("grantCatalog");w.WriteStartArray();w.WriteStartObject();w.WriteString("grantPolicyId","selftest");w.WritePropertyName("grant");w.WriteStartObject();w.WriteString("profileId","selftest");w.WriteString("rootPolicyId","no-project");Strings(w,"actions","selftest");Strings(w,"scopes","selftest");w.WriteEndObject();w.WriteEndObject();w.WriteEndArray();});
        using(var check=ConsentCore.Strict(native))ConsentCore.ValidatePolicy(check.RootElement);result["policy.json"]=native;
        var pub=client.ExportParameters(false);
        var oauth=Json(w=>{w.WriteString("schema","RC_PROTECTED_OAUTH_POLICY_V1");w.WriteString("issuer",Issuer);w.WriteString("tokenEndpoint",TokenEndpoint);w.WriteString("resource",Resource);w.WriteString("ownerId","local-owner");w.WriteString("enrollmentEpoch",epoch);w.WriteString("keyId","owner-selftest-es256");w.WriteString("signingPublicKeySpkiSha256",Hex(issuer.ExportSubjectPublicKeyInfo()));w.WritePropertyName("clients");w.WriteStartArray();w.WriteStartObject();w.WriteString("clientId",Client);w.WritePropertyName("jwks");w.WriteStartArray();w.WriteStartObject();w.WriteString("kid","selftest-client");w.WriteString("use","sig");w.WriteString("alg","ES256");w.WriteString("kty","EC");w.WriteString("crv","P-256");w.WriteString("x",ConsentCore.B64(pub.Q.X!));w.WriteString("y",ConsentCore.B64(pub.Q.Y!));w.WriteEndObject();w.WriteEndArray();w.WriteEndObject();w.WriteEndArray();});result["oauth-policy.json"]=oauth;
        var host=Json(w=>{w.WriteString("schema","RC_NATIVE_ISSUER_HOST_V1");w.WriteString("ownerSid",ownerSid);w.WriteNumber("ownerSessionId",session);w.WriteString("hostSha256",images[Images[0]]);w.WriteString("nativePolicySha256",Hex(native));w.WriteString("oauthPolicySha256",Hex(oauth));w.WritePropertyName("peers");w.WriteStartArray();foreach(var pair in new[]{("oauth-proxy",Images[2]),("owner-admin",Images[3])}){w.WriteStartObject();w.WriteString("role",pair.Item1);w.WriteString("imageName",pair.Item2);w.WriteString("sha256",images[pair.Item2]);w.WriteEndObject();}w.WriteEndArray();});result["issuer-host-policy.json"]=host;
        result["client-policy.json"]=Json(w=>{w.WriteString("schema","RC_NATIVE_ISSUER_CLIENT_V1");w.WriteString("ownerSid",ownerSid);w.WriteNumber("ownerSessionId",session);w.WriteString("hostSha256",images[Images[0]]);w.WriteString("proxySha256",images[Images[2]]);w.WriteString("adminSha256",images[Images[3]]);w.WriteString("nativePolicySha256",Hex(native));w.WriteString("oauthPolicySha256",Hex(oauth));w.WriteString("hostPolicySha256",Hex(host));w.WriteString("clientId",Client);w.WriteString("redirectUri",Redirect);w.WriteString("resource",Resource);Strings(w,"grantPolicyIds","selftest");w.WriteString("taskName",TaskName);});
        return result;
    }
    internal static Dictionary<string,byte[]> EmptyJournals(byte[] native,byte[] oauth)
    {
        var enrollment=Hex(native);var exchange=Hex(native.Concat(oauth).ToArray());var id=ConsentCore.B64(RandomNumberGenerator.GetBytes(32));
        return new(){["issuer.initialized"]=Json(w=>{w.WriteString("schema","RC_ISSUER_INITIALIZED_V1");w.WriteString("journalId",id);w.WriteString("enrollmentSha256",enrollment);}),["issuer.journal"]=[],["issuer.head.json"]=Json(w=>{w.WriteString("schema","RC_ISSUER_HEAD_V1");w.WriteString("journalId",id);w.WriteNumber("sequence",0);w.WriteString("hash",new string('0',64));}),["oauth-exchange/exchange.initialized"]=Encoding.UTF8.GetBytes(exchange),["oauth-exchange/exchange.journal"]=[],["oauth-exchange/exchange.head"]=Json(w=>{w.WriteNumber("sequence",0);w.WriteString("hash",new string('0',64));w.WriteString("enrollment",exchange);})};
    }
}
