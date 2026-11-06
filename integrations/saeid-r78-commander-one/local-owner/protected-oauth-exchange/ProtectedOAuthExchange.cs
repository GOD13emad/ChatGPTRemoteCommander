using System.Security.Cryptography;using System.Text;using System.Text.Json;using System.Text.RegularExpressions;
namespace CommanderOwnerConsent;
public sealed record AuthorizationCodeResult(string RequestId,string Status,string? Code,string? State,string? RedirectUri,string Issuer);
public sealed record TokenResult(string AccessToken,string TokenType,int ExpiresIn,byte[] StateEnvelope,bool RefreshTokenIssued);
public sealed class ProtectedOAuthExchange:IDisposable
{
    private readonly string authorityRoot,root;private readonly byte[] nativePolicy,policy;private readonly ProtectedIssuerState native;private readonly ECDsa key;private readonly bool fixture;private readonly ExchangeJournal journal;
    private static byte[] Json(Action<Utf8JsonWriter> f)=>ExchangeJournal.Json(f);private static string T(JsonElement e,string name,int max=4096)=>ConsentCore.Text(e,name,max);
    private static string Hash(byte[] x)=>ConsentCore.B64(SHA256.HashData(x));private static string Hash(string x)=>Hash(Encoding.UTF8.GetBytes(x));
    private static string Hex(byte[] x)=>Convert.ToHexString(x).ToLowerInvariant();private static long Now=>DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    private long Clock
    {
        get
        {
#if OAUTH_EXCHANGE_FIXTURE_TEST
            return checked(Now+ClockOffsetMs);
#else
            return Now;
#endif
        }
    }
    private ProtectedOAuthExchange(string authority,string path,byte[] n,byte[] p,ProtectedIssuerState store,ECDsa signingKey,bool fixtureMode)
    {authorityRoot=authority;root=path;nativePolicy=n.ToArray();policy=p.ToArray();native=store;key=signingKey;fixture=fixtureMode;ValidatePolicy();journal=new(root,Hex(SHA256.HashData(nativePolicy.Concat(policy).ToArray())),fixture);}
    public static ProtectedOAuthExchange OpenProtected()
    {
        var a=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"ChatGPTRemoteCommander","owner-auth");var r=Path.Combine(a,"oauth-exchange");WindowsGuard.Protected(a,true);WindowsGuard.Protected(r,true);var store=ProtectedIssuerState.OpenProtected();ECDsa? key=null;
        try{using var n=WindowsGuard.OpenProtected(Path.Combine(a,"policy.json"),32768);using var p=WindowsGuard.OpenProtected(Path.Combine(a,"oauth-policy.json"),32768);using var k=WindowsGuard.OpenProtected(Path.Combine(a,"oauth-sign-key.pk8"),4096,true);var bytes=WindowsGuard.Read(k);try{key=ECDsa.Create();key.ImportPkcs8PrivateKey(bytes,out var read);ConsentCore.Need(read==bytes.Length,"ISSUER_PRIVATE_KEY_FORMAT");}finally{CryptographicOperations.ZeroMemory(bytes);}return new(a,r,WindowsGuard.Read(n),WindowsGuard.Read(p),store,key,false);}catch{store.Dispose();key?.Dispose();throw;}
    }
#if OAUTH_EXCHANGE_FIXTURE_TEST
    internal static ProtectedOAuthExchange OpenFixture(string authority,byte[] n,byte[] p,ProtectedIssuerState store,ECDsa signingKey)
    {var r=Path.Combine(authority,"oauth-exchange");Directory.CreateDirectory(r);return new(authority,r,n,p,store,signingKey,true);}
    internal string? CrashAt;
    internal long ClockOffsetMs=0,AdvanceAfterClientVerificationMs=0,AdvanceAfterTokenPreparedMs=0,AdvanceAfterTokenSignedMs=0,AdvanceAfterNativeConsumeMs=0;
    private void Crash(string stage){if(CrashAt==stage)Environment.Exit(72);}
#endif
    private void Authority()
    {
        if(fixture){
#if OAUTH_EXCHANGE_FIXTURE_TEST
            return;
#else
            throw new ConsentFault("FIXTURE_AUTHORITY_NOT_IN_PRODUCTION");
#endif
        }
        using var d=ConsentCore.Strict(nativePolicy);var s=WindowsGuard.Inspect();if(s.Sid=="S-1-5-18")ConsentCore.Need(s.Elevated&&s.Administrator&&s.IntegrityRid>=16384,"SYSTEM_AUTHORITY_REQUIRED");else WindowsGuard.RequireOwner(s,T(d.RootElement,"ownerSid"));WindowsGuard.Protected(root,true);using var n=WindowsGuard.OpenProtected(Path.Combine(authorityRoot,"policy.json"),32768);using var p=WindowsGuard.OpenProtected(Path.Combine(authorityRoot,"oauth-policy.json"),32768);ConsentCore.Need(WindowsGuard.Read(n).SequenceEqual(nativePolicy)&&WindowsGuard.Read(p).SequenceEqual(policy),"ISSUER_ENROLLMENT_CHANGED");
    }
    private static void Uri(string x){ConsentCore.Need(System.Uri.TryCreate(x,UriKind.Absolute,out var u)&&u.Scheme=="https"&&u.UserInfo.Length==0&&u.Query.Length==0&&u.Fragment.Length==0&&u.AbsoluteUri==x,"ISSUER_HTTPS_URI_REQUIRED");}
    private void ValidatePolicy()
    {
        using var n=ConsentCore.Strict(nativePolicy);ConsentCore.ValidatePolicy(n.RootElement);using var d=ConsentCore.Strict(policy);var p=d.RootElement;ConsentCore.Fields(p,"schema","issuer","tokenEndpoint","resource","ownerId","enrollmentEpoch","keyId","signingPublicKeySpkiSha256","clients");ConsentCore.Need(T(p,"schema")=="RC_PROTECTED_OAUTH_POLICY_V1","ISSUER_POLICY_SCHEMA");foreach(var f in new[]{"issuer","resource","ownerId","enrollmentEpoch"})ConsentCore.Need(T(p,f)==T(n.RootElement,f),"ISSUER_NATIVE_POLICY_BINDING");foreach(var f in new[]{"issuer","resource","tokenEndpoint"})Uri(T(p,f));ConsentCore.Need(Regex.IsMatch(T(p,"keyId"),"^[a-z][a-z0-9_.:-]{0,95}$"),"ISSUER_KEY_ID");ConsentCore.Need(key.ExportParameters(false).Curve.Oid.Value=="1.2.840.10045.3.1.7"&&Hex(SHA256.HashData(key.ExportSubjectPublicKeyInfo()))==T(p,"signingPublicKeySpkiSha256"),"ISSUER_KEY_PIN");
        var clients=p.GetProperty("clients");ConsentCore.Need(clients.ValueKind==JsonValueKind.Array&&clients.GetArrayLength() is >0 and <=8,"ISSUER_CLIENT_POLICY");var seen=new HashSet<string>(StringComparer.Ordinal);foreach(var c in clients.EnumerateArray()){ConsentCore.Fields(c,"clientId","jwks");var id=T(c,"clientId",512);ConsentCore.Need(seen.Add(id)&&n.RootElement.GetProperty("clients").EnumerateArray().Any(x=>T(x,"clientId")==id),"ISSUER_CLIENT_NOT_NATIVE_ADMITTED");var jwks=c.GetProperty("jwks");ConsentCore.Need(jwks.ValueKind==JsonValueKind.Array&&jwks.GetArrayLength() is >0 and <=8,"ISSUER_PUBLIC_JWKS_REQUIRED");var ids=new HashSet<string>();foreach(var j in jwks.EnumerateArray()){ConsentCore.Need(ids.Add(T(j,"kid")),"DUPLICATE_CLIENT_KEY");using var k=ClientKey(j);}}
    }
    private static byte[] B64(string text,int max=16384)
    {ConsentCore.Need(text.Length is >0&&text.Length<=max&&Regex.IsMatch(text,"^[A-Za-z0-9_-]+$"),"OAUTH_BASE64URL");var b=Convert.FromBase64String(text.Replace('-','+').Replace('_','/').PadRight((text.Length+3)/4*4,'='));ConsentCore.Need(ConsentCore.B64(b)==text,"OAUTH_BASE64URL");return b;}
    private static AsymmetricAlgorithm ClientKey(JsonElement j)
    {
        var alg=T(j,"alg");ConsentCore.Need(T(j,"use")=="sig"&&Regex.IsMatch(T(j,"kid"),"^[A-Za-z0-9_-]{1,100}$"),"CLIENT_KEY_POLICY");
        if(alg=="ES256"){ConsentCore.Fields(j,"kid","use","alg","kty","crv","x","y");ConsentCore.Need(T(j,"kty")=="EC"&&T(j,"crv")=="P-256","CLIENT_EC_KEY");return ECDsa.Create(new ECParameters{Curve=ECCurve.NamedCurves.nistP256,Q=new ECPoint{X=B64(T(j,"x")),Y=B64(T(j,"y"))}});}
        ConsentCore.Need(alg=="RS256","CLIENT_ALGORITHM");ConsentCore.Fields(j,"kid","use","alg","kty","n","e");ConsentCore.Need(T(j,"kty")=="RSA","CLIENT_RSA_KEY");var r=RSA.Create();try{r.ImportParameters(new(){Modulus=B64(T(j,"n")),Exponent=B64(T(j,"e"))});ConsentCore.Need(r.KeySize>=2048,"CLIENT_RSA_KEY_SIZE");return r;}catch{r.Dispose();throw;}
    }
    private static string Kind(JsonElement e)=>T(e,"kind");private static string RequestId(JsonElement e)=>T(e,"requestId");
    private byte[] Event(string kind,string requestId,Action<Utf8JsonWriter>? extra=null)=>Json(w=>{w.WriteString("kind",kind);w.WriteString("requestId",requestId);w.WriteNumber("at",Clock);extra?.Invoke(w);});
    private static int TerminalReserve(List<JsonElement> rows,string? spendingGrant=null,int spend=0)
    {
        var reserve=0;
        foreach(var prepared in rows.Where(x=>Kind(x)=="AUTHORIZE_PREPARED"))
        {
            var id=RequestId(prepared);if(rows.Any(x=>RequestId(x)==id&&Kind(x)=="AUTHORIZE_DENIED"))continue;
            var grant=T(prepared,"grantId");var issued=rows.Any(x=>RequestId(x)==id&&Kind(x)=="TOKEN_ISSUED");var revoked=rows.FindLastIndex(x=>RequestId(x)==id&&Kind(x)=="GRANT_REVOKED");
            var remaining=revoked<0?(issued?4:2):issued&&!rows.Skip(revoked+1).Any(x=>RequestId(x)==id&&Kind(x)=="STATE_ISSUED")?2:0;
            if(grant==spendingGrant)remaining=Math.Max(0,remaining-spend);reserve=checked(reserve+remaining);
        }return reserve;
    }
    private ApprovedRequest Pending(string id)
    {
        // Native store lookup prevents caller path traversal before selecting a file.
        ConsentCore.Need(native.ReadStatus(id)=="PENDING_COMMITTED","NATIVE_PENDING_NOT_READY");var path=Path.Combine(authorityRoot,"pending",id+".json");byte[] bytes;if(fixture)bytes=File.ReadAllBytes(path);else{using var f=WindowsGuard.OpenProtected(path,32768);bytes=WindowsGuard.Read(f);}using var p=ConsentCore.Strict(nativePolicy);return ConsentCore.ValidatePending(bytes,p.RootElement,id,Now);
    }
    public AuthorizationCodeResult AuthorizeAfterNativeConsent(string requestId)
    {
        Authority();using var gate=journal.Lock();var rows=journal.Rows();journal.Reserve(rows,4+TerminalReserve(rows));ConsentCore.Need(!rows.Any(x=>RequestId(x)==requestId),"AUTHORIZATION_ALREADY_ATTEMPTED_NO_REPLAY");var pending=Pending(requestId);var receiptPath=Path.Combine(authorityRoot,"receipts",requestId+".json");using var heldReceipt=fixture?new FileStream(receiptPath,FileMode.Open,FileAccess.Read,FileShare.Read):WindowsGuard.OpenProtected(receiptPath,32768);using var receiptDoc=ConsentCore.Strict(WindowsGuard.Read(heldReceipt));var receipt=receiptDoc.RootElement;var receiptDeadline=receipt.TryGetProperty("statement",out var receiptStatement)?receiptStatement.GetProperty("expiresAt").GetInt64():pending.ExpiresAt;var consentDeadline=Math.Min(pending.ExpiresAt,receiptDeadline);ConsentCore.Need(Clock<consentDeadline,"NATIVE_CONSENT_EXPIRED");var code=ConsentCore.B64(RandomNumberGenerator.GetBytes(32));var hash=Hash(code);var expires=Clock+60000;
        journal.Append(rows,Event("AUTHORIZE_PREPARED",requestId,w=>{w.WriteString("codeHash",hash);w.WriteString("bound",Convert.ToBase64String(pending.SourceBytes));w.WriteString("grantId",pending.GrantId);w.WriteNumber("expiresAtMs",expires);}));
#if OAUTH_EXCHANGE_FIXTURE_TEST
        Crash("AFTER_AUTHORIZE_PREPARED");
#endif
        var consumed=native.ConsumeNativeReceipt(requestId);
        if(consumed.Status=="OWNER_DENIED_TOKEN_NOT_ISSUED"){journal.Append(rows,Event("AUTHORIZE_DENIED",requestId));return new(requestId,"OWNER_DENIED",null,null,null,pending.Issuer);}
        ConsentCore.Need(consumed.Status=="CONSENT_CONSUMED_TOKEN_NOT_ISSUED"&&consumed.GrantId==pending.GrantId&&!consumed.TokenIssued,"NATIVE_CONSENT_RESULT_BINDING");
#if OAUTH_EXCHANGE_FIXTURE_TEST
        Crash("AFTER_NATIVE_CONSENT_CONSUMED");
        ClockOffsetMs+=AdvanceAfterNativeConsumeMs;
#endif
        ConsentCore.Need(Clock<consentDeadline,"NATIVE_CONSENT_EXPIRED_DURING_AUTHORIZATION");
        journal.Append(rows,Event("CODE_ACTIVE",requestId,w=>{w.WriteString("codeHash",hash);w.WriteString("bound",Convert.ToBase64String(pending.SourceBytes));w.WriteString("grantId",pending.GrantId);w.WriteNumber("expiresAtMs",expires);}));
        using var b=ConsentCore.Strict(pending.SourceBytes);return new(requestId,"CODE_ISSUED",code,T(b.RootElement.GetProperty("bound"),"state",1024),pending.RedirectUri,pending.Issuer);
    }
    private sealed record AuthenticatedClient(string Id,long ExpiresAtMs,long CheckedAtMs);
    private AuthenticatedClient AuthenticateClient(JsonElement request,List<JsonElement> rows)
    {
        ConsentCore.Need(T(request,"client_assertion_type")=="urn:ietf:params:oauth:client-assertion-type:jwt-bearer","CLIENT_ASSERTION_TYPE");var token=T(request,"client_assertion",8192);var parts=token.Split('.');ConsentCore.Need(parts.Length==3,"CLIENT_ASSERTION_SHAPE");using var hdoc=ConsentCore.Strict(B64(parts[0]));using var cdoc=ConsentCore.Strict(B64(parts[1]));var h=hdoc.RootElement;var c=cdoc.RootElement;ConsentCore.Fields(h,"alg","kid","typ");ConsentCore.Fields(c,"iss","sub","aud","iat","exp","jti");using var p=ConsentCore.Strict(policy);var id=T(request,"client_id",512);var clients=p.RootElement.GetProperty("clients").EnumerateArray().Where(x=>T(x,"clientId")==id).ToArray();ConsentCore.Need(clients.Length==1,"CLIENT_NOT_ADMITTED");var matches=clients[0].GetProperty("jwks").EnumerateArray().Where(j=>T(j,"kid")==T(h,"kid")).ToArray();ConsentCore.Need(matches.Length==1&&T(h,"typ")=="JWT"&&T(h,"alg")==T(matches[0],"alg"),"CLIENT_ASSERTION_KEY");var checkedAt=Clock;var sec=checkedAt/1000;var iat=c.GetProperty("iat").GetInt64();var exp=c.GetProperty("exp").GetInt64();var jti=T(c,"jti",128);ConsentCore.Need(T(c,"iss")==id&&T(c,"sub")==id&&T(c,"aud")==T(p.RootElement,"tokenEndpoint")&&iat>=sec-60&&iat<=sec&&exp>sec&&exp<=iat+60&&Regex.IsMatch(jti,"^[A-Za-z0-9_-]{16,128}$"),"CLIENT_ASSERTION_BINDING");var replay=Hash(id+"\n"+jti);ConsentCore.Need(!rows.Any(x=>Kind(x)=="CLIENT_ASSERTION_CONSUMED"&&T(x,"assertionHash")==replay),"CLIENT_ASSERTION_REPLAY");using var key=ClientKey(matches[0]);var message=Encoding.UTF8.GetBytes(parts[0]+"."+parts[1]);var signature=B64(parts[2],1024);var valid=key is ECDsa ec?ec.VerifyData(message,signature,HashAlgorithmName.SHA256,DSASignatureFormat.IeeeP1363FixedFieldConcatenation):((RSA)key).VerifyData(message,signature,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1);ConsentCore.Need(valid,"CLIENT_ASSERTION_SIGNATURE");
#if OAUTH_EXCHANGE_FIXTURE_TEST
        ClockOffsetMs+=AdvanceAfterClientVerificationMs;
#endif
        ConsentCore.Need(Clock>=checkedAt&&exp*1000>Clock,"CLIENT_ASSERTION_EXPIRED_DURING_VERIFY");
        journal.Append(rows,Event("CLIENT_ASSERTION_CONSUMED","client-assertion",w=>w.WriteString("assertionHash",replay)));return new(id,exp*1000,checkedAt);
    }
    private ApprovedRequest Bound(JsonElement active)
    {using var p=ConsentCore.Strict(nativePolicy);var bytes=Convert.FromBase64String(T(active,"bound",20000));using var d=ConsentCore.Strict(bytes);var e=d.RootElement.GetProperty("bound");var grant=e.GetProperty("grant");return new(T(e,"requestId"),T(d.RootElement,"requestDigest"),T(active,"grantId"),T(e,"issuer"),T(e,"ownerId"),T(e,"enrollmentEpoch"),T(e,"clientId"),T(e,"redirectUri"),T(e,"resource"),T(grant,"profileId"),T(grant,"rootPolicyId"),grant.GetProperty("actions").EnumerateArray().Select(x=>x.GetString()!).ToArray(),grant.GetProperty("scopes").EnumerateArray().Select(x=>x.GetString()!).ToArray(),e.GetProperty("expiresAt").GetInt64(),bytes);}
    public TokenResult ExchangeToken(byte[] untrustedRequest)
    {
        Authority();using var gate=journal.Lock();var rows=journal.Rows();journal.Reserve(rows,8+TerminalReserve(rows));using var request=ConsentCore.Strict(untrustedRequest);var r=request.RootElement;ConsentCore.Fields(r,"grant_type","code","client_id","redirect_uri","resource","code_verifier","client_assertion_type","client_assertion");var authenticated=AuthenticateClient(r,rows);var client=authenticated.Id;ConsentCore.Need(T(r,"grant_type")=="authorization_code","AUTHORIZATION_CODE_GRANT_REQUIRED");var code=T(r,"code",43);ConsentCore.Need(Regex.IsMatch(code,"^[A-Za-z0-9_-]{43}$"),"CODE_SHAPE");var codeHash=Hash(code);var all=rows.Where(x=>Kind(x)=="CODE_ACTIVE"&&T(x,"codeHash")==codeHash).ToArray();ConsentCore.Need(all.Length==1,"INVALID_CODE");var active=all[0];var id=RequestId(active);var b=Bound(active);ConsentCore.Need(b.ClientId==client,"CODE_CLIENT_BINDING");ConsentCore.Need(!rows.Any(x=>RequestId(x)==id&&Kind(x) is "TOKEN_PREPARED" or "TOKEN_ISSUED" or "TOKEN_REJECTED" or "GRANT_REVOKED")&&active.GetProperty("expiresAtMs").GetInt64()>Clock&&native.ReadStatus(id)=="CONSENT_CONSUMED","CODE_CONSUMED_EXPIRED_OR_REVOKED");
        journal.Append(rows,Event("TOKEN_PREPARED",id,w=>w.WriteString("codeHash",codeHash)));
#if OAUTH_EXCHANGE_FIXTURE_TEST
        Crash("AFTER_TOKEN_PREPARED");
        ClockOffsetMs+=AdvanceAfterTokenPreparedMs;
#endif
        using var pending=ConsentCore.Strict(b.SourceBytes);var challenge=T(pending.RootElement.GetProperty("bound"),"challenge",43);var verifier=T(r,"code_verifier",128);var valid=T(r,"redirect_uri")==b.RedirectUri&&T(r,"resource")==b.Resource&&Regex.IsMatch(verifier,"^[A-Za-z0-9._~-]{43,128}$")&&CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Hash(verifier)),Encoding.ASCII.GetBytes(challenge));
        if(!valid){journal.Append(rows,Event("TOKEN_REJECTED",id));throw new ConsentFault("TOKEN_BINDING_OR_PKCE_REJECTED");}
        var deadline=Math.Min(authenticated.ExpiresAtMs,active.GetProperty("expiresAtMs").GetInt64());ConsentCore.Need(Clock>=authenticated.CheckedAtMs&&Clock<deadline,"AUTHORIZATION_EXPIRED_DURING_ISSUANCE");var at=Clock;var sec=at/1000;var jti="token:"+Hex(RandomNumberGenerator.GetBytes(16));using var config=ConsentCore.Strict(policy);var header=Json(w=>{w.WriteString("alg","ES256");w.WriteString("kid",T(config.RootElement,"keyId"));w.WriteString("typ","at+jwt");});
        var claims=Json(w=>{w.WriteString("iss",b.Issuer);w.WriteString("aud",b.Resource);w.WriteString("sub",b.OwnerId);w.WriteString("client_id",b.ClientId);w.WriteString("grant_id",b.GrantId);w.WriteString("enrollment_epoch",b.Epoch);w.WriteString("profile_id",b.Profile);w.WriteString("root_policy_id",b.RootPolicy);w.WritePropertyName("actions");w.WriteStartArray();foreach(var action in b.Actions)w.WriteStringValue(action);w.WriteEndArray();w.WriteString("scope",string.Join(' ',b.Scopes));w.WriteNumber("iat",sec);w.WriteNumber("nbf",sec);w.WriteNumber("exp",sec+300);w.WriteString("jti",jti);});var prefix=ConsentCore.B64(header)+"."+ConsentCore.B64(claims);var token=prefix+"."+ConsentCore.B64(key.SignData(Encoding.UTF8.GetBytes(prefix),HashAlgorithmName.SHA256,DSASignatureFormat.IeeeP1363FixedFieldConcatenation));var state=SignState(b,"active",1,at);
#if OAUTH_EXCHANGE_FIXTURE_TEST
        ClockOffsetMs+=AdvanceAfterTokenSignedMs;
#endif
        ConsentCore.Need(native.ReadStatus(id)=="CONSENT_CONSUMED","GRANT_REVOKED_DURING_SIGN");ConsentCore.Need(Clock>=at&&Clock<deadline,"AUTHORIZATION_EXPIRED_DURING_SIGN");journal.Append(rows,Event("TOKEN_ISSUED",id,w=>{w.WriteString("grantId",b.GrantId);w.WriteString("tokenHash",Hash(token));w.WriteNumber("stateSequence",1);w.WriteString("stateHash",Hash(state));}));ConsentCore.Need(Clock>=at&&Clock<deadline,"AUTHORIZATION_EXPIRED_DURING_COMMIT");return new(token,"Bearer",300,state,false);
    }
    private byte[] SignState(ApprovedRequest b,string status,long sequence,long at)
    {
        var statement=Json(w=>{w.WriteString("kind","rc-grant-state-v1");w.WriteString("issuer",b.Issuer);w.WriteString("resource",b.Resource);w.WriteString("ownerId",b.OwnerId);w.WriteString("enrollmentEpoch",b.Epoch);w.WriteString("grantId",b.GrantId);w.WriteString("status",status);w.WriteString("profileId",b.Profile);w.WriteString("rootPolicyId",b.RootPolicy);foreach(var set in new[]{"actions","scopes"}){w.WritePropertyName(set);w.WriteStartArray();foreach(var x in set=="actions"?b.Actions:b.Scopes)w.WriteStringValue(x);w.WriteEndArray();}w.WriteNumber("sequence",sequence);w.WriteNumber("issuedAtMs",at);w.WriteNumber("expiresAtMs",at+15000);});var signature=key.SignData(Encoding.UTF8.GetBytes("RC_OWNER_OAUTH_GRANT_STATE_V1\n").Concat(statement).ToArray(),HashAlgorithmName.SHA256,DSASignatureFormat.Rfc3279DerSequence);return Json(w=>{w.WritePropertyName("statement");w.WriteRawValue(statement,false);w.WriteString("signature",ConsentCore.B64(signature));});
    }
    public byte[] GetFreshGrantState(string grantId)
    {
        Authority();using var gate=journal.Lock();var rows=journal.Rows();var issued=rows.Where(x=>Kind(x)=="TOKEN_ISSUED"&&T(x,"grantId")==grantId).ToArray();ConsentCore.Need(issued.Length==1,"UNKNOWN_ISSUED_GRANT");var id=RequestId(issued[0]);var active=rows.Single(x=>RequestId(x)==id&&Kind(x)=="CODE_ACTIVE");var b=Bound(active);var status=native.ReadStatus(id);ConsentCore.Need(status is "CONSENT_CONSUMED" or "REVOKED","NATIVE_GRANT_STATE_UNAVAILABLE");journal.Reserve(rows,2+TerminalReserve(rows,status=="REVOKED"?grantId:null,status=="REVOKED"?2:0));var previous=rows.Where(x=>RequestId(x)==id&&x.TryGetProperty("stateSequence",out _)).Select(x=>x.GetProperty("stateSequence").GetInt64()).Max();var sequence=checked(previous+1);journal.Append(rows,Event("STATE_PREPARED",id,w=>w.WriteNumber("stateSequence",sequence)));var envelope=SignState(b,status=="REVOKED"?"revoked":"active",sequence,Clock);ConsentCore.Need(native.ReadStatus(id)==status,"GRANT_CHANGED_DURING_STATE_SIGN");journal.Append(rows,Event("STATE_ISSUED",id,w=>{w.WriteNumber("stateSequence",sequence);w.WriteString("stateHash",Hash(envelope));}));return envelope;
    }
    public void RevokeGrant(string grantId)
    {Authority();using var gate=journal.Lock();var rows=journal.Rows();journal.Reserve(rows,2+TerminalReserve(rows,grantId,2));var prepared=rows.Where(x=>Kind(x)=="AUTHORIZE_PREPARED"&&T(x,"grantId")==grantId).ToArray();ConsentCore.Need(prepared.Length==1,"UNKNOWN_AUTHORIZATION_GRANT");var id=RequestId(prepared[0]);ConsentCore.Need(!rows.Any(x=>RequestId(x)==id&&Kind(x) is "REVOKE_PREPARED" or "GRANT_REVOKED" or "AUTHORIZE_DENIED")&&native.ReadStatus(id)!="REVOKED","GRANT_REVOKED_OR_RECONCILIATION_REQUIRED");journal.Append(rows,Event("REVOKE_PREPARED",id));native.Revoke(id);journal.Append(rows,Event("GRANT_REVOKED",id));}
    public void Dispose(){key.Dispose();native.Dispose();}
}
