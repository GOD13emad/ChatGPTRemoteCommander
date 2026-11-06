using System.Security.Cryptography;using System.Security.Principal;using System.Text.Json;using System.Text.RegularExpressions;using CommanderOwnerConsent;using CommanderNativeIssuer;
namespace CommanderOwnerProxy;
internal sealed class ClientPolicy:IDisposable
{
    internal const string ProxyName="CommanderOwnerProxy.exe",AdminName="CommanderOwnerAdmin.exe",TaskName=@"\ChatGPTRemoteCommanderOwnerIssuerV1",PipeName="ChatGPTRemoteCommanderNativeIssuerV1";
    internal readonly string OwnerSid,HostSha256,ProxySha256,AdminSha256,NativePolicySha256,OAuthPolicySha256,HostPolicySha256,ClientId,RedirectUri,Resource;
    internal readonly int OwnerSessionId;internal readonly string[] GrantPolicyIds;internal readonly byte[] Bytes;
    internal string ProgramRoot=>Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"ChatGPTRemoteCommander","owner-auth");
    internal string StateRoot=>Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"ChatGPTRemoteCommander","owner-auth");
    private readonly List<FileStream> held=[];
    internal ClientPolicy(byte[] bytes)
    {
        Bytes=bytes;using var d=ConsentCore.Strict(bytes);var e=d.RootElement;
        ConsentCore.Fields(e,"schema","ownerSid","ownerSessionId","hostSha256","proxySha256","adminSha256","nativePolicySha256","oauthPolicySha256","hostPolicySha256","clientId","redirectUri","resource","grantPolicyIds","taskName");
        ConsentCore.Need(ConsentCore.Text(e,"schema")=="RC_NATIVE_ISSUER_CLIENT_V1","CLIENT_POLICY_SCHEMA");OwnerSid=ConsentCore.Text(e,"ownerSid");_ = new SecurityIdentifier(OwnerSid);ConsentCore.Need(Regex.IsMatch(OwnerSid,"^S-1-5-21-[0-9-]+$"),"CLIENT_OWNER_SID");OwnerSessionId=e.GetProperty("ownerSessionId").GetInt32();ConsentCore.Need(OwnerSessionId>0,"CLIENT_OWNER_SESSION");
        HostSha256=Hash(e,"hostSha256");ProxySha256=Hash(e,"proxySha256");AdminSha256=Hash(e,"adminSha256");NativePolicySha256=Hash(e,"nativePolicySha256");OAuthPolicySha256=Hash(e,"oauthPolicySha256");HostPolicySha256=Hash(e,"hostPolicySha256");
        ClientId=ConsentCore.Text(e,"clientId",96);RedirectUri=ConsentCore.Text(e,"redirectUri");Resource=ConsentCore.Text(e,"resource");foreach(var u in new[]{RedirectUri,Resource})ConsentCore.Need(Uri.TryCreate(u,UriKind.Absolute,out var uri)&&uri.Scheme=="https"&&uri.AbsoluteUri==u&&string.IsNullOrEmpty(uri.UserInfo)&&string.IsNullOrEmpty(uri.Fragment),"CLIENT_HTTPS_BINDING");
        var grants=e.GetProperty("grantPolicyIds");ConsentCore.Need(grants.ValueKind==JsonValueKind.Array&&grants.GetArrayLength() is >0 and <=32,"CLIENT_GRANT_SET");GrantPolicyIds=grants.EnumerateArray().Select(x=>x.GetString()??"").ToArray();ConsentCore.Need(GrantPolicyIds.All(x=>Regex.IsMatch(x,"^[a-z][a-z0-9_.:-]{0,95}$"))&&GrantPolicyIds.Distinct().Count()==GrantPolicyIds.Length,"CLIENT_GRANT_SET");ConsentCore.Need(ConsentCore.Text(e,"taskName")==TaskName,"CLIENT_FIXED_TASK");
    }
    private static string Hash(JsonElement e,string k){var x=ConsentCore.Text(e,k,64);ConsentCore.Need(Regex.IsMatch(x,"^[a-f0-9]{64}$"),"CLIENT_POLICY_PIN");return x;}
    internal static ClientPolicy LoadProtected()
    {
        var root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"ChatGPTRemoteCommander","owner-auth");WindowsGuard.Protected(root,true);var f=WindowsGuard.OpenProtected(Path.Combine(root,"client-policy.json"),32768);ClientPolicy? p=null;
        try{p=new(WindowsGuard.Read(f));p.held.Add(f);p.CheckSourcePolicy("policy.json",p.NativePolicySha256,true);p.CheckSourcePolicy("oauth-policy.json",p.OAuthPolicySha256,true);p.CheckSourcePolicy("issuer-host-policy.json",p.HostPolicySha256,true);return p;}catch{if(p!=null)p.Dispose();else f.Dispose();throw;}
    }
    private void CheckSourcePolicy(string name,string pin,bool hold)
    {WindowsGuard.Protected(StateRoot,true);var file=WindowsGuard.OpenProtected(Path.Combine(StateRoot,name),32768);try{var b=WindowsGuard.Read(file);ConsentCore.Need(Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant()==pin,"CLIENT_SOURCE_POLICY_PIN");using var d=ConsentCore.Strict(b);if(name=="policy.json")ConsentCore.Need(ConsentCore.Text(d.RootElement,"ownerSid")==OwnerSid,"CLIENT_SOURCE_OWNER_BINDING");if(name=="issuer-host-policy.json"){ConsentCore.Need(ConsentCore.Text(d.RootElement,"ownerSid")==OwnerSid&&d.RootElement.GetProperty("ownerSessionId").GetInt32()==OwnerSessionId&&ConsentCore.Text(d.RootElement,"hostSha256")==HostSha256,"CLIENT_HOST_POLICY_BINDING");}if(hold)held.Add(file);else file.Dispose();}catch{file.Dispose();throw;}}
    internal bool CheckCurrentOwnerAndImage()
    {
        var path=Path.GetFullPath(Environment.ProcessPath??"");var proxy=Path.Combine(ProgramRoot,ProxyName);var admin=Path.Combine(ProgramRoot,AdminName);var isAdmin=path.Equals(admin,StringComparison.OrdinalIgnoreCase);ConsentCore.Need(isAdmin||path.Equals(proxy,StringComparison.OrdinalIgnoreCase),"CLIENT_PROTECTED_ROLE_IMAGE");var s=WindowsGuard.Inspect();DemandOwner(s,isAdmin);held.Add(NativeImage.OpenPinned(path,isAdmin?AdminSha256:ProxySha256,ProgramRoot));return isAdmin;
    }
    internal void DemandOwner(WindowsGuard.TokenState s,bool admin)
    {ConsentCore.Need(s.Sid==OwnerSid&&s.SessionId==OwnerSessionId,"CLIENT_OWNER_SESSION_BINDING");if(admin)WindowsGuard.RequireOwner(s,OwnerSid);else ConsentCore.Need(!s.Elevated&&!s.Administrator&&s.IntegrityRid is >=8192 and <12288,"CLIENT_ORDINARY_OWNER_REQUIRED");}
    internal void Revalidate(bool admin)
    {DemandOwner(WindowsGuard.Inspect(),admin);using var f=WindowsGuard.OpenProtected(Path.Combine(ProgramRoot,"client-policy.json"),32768);ConsentCore.Need(WindowsGuard.Read(f).SequenceEqual(Bytes),"CLIENT_POLICY_CHANGED");CheckSourcePolicy("policy.json",NativePolicySha256,false);CheckSourcePolicy("oauth-policy.json",OAuthPolicySha256,false);CheckSourcePolicy("issuer-host-policy.json",HostPolicySha256,false);}
    internal void DemandRequest(Request r,bool admin)
    {
        ConsentCore.Need(admin?r.Action=="revoke":r.Action is "authorize" or "exchange" or "state","CLIENT_ROLE_ACTION_DENIED");var a=r.Arguments;
        if(r.Action=="authorize"&&ConsentCore.Text(a,"phase")=="begin")
        {var b=a.GetProperty("request");BindClient(b);ConsentCore.Need(ConsentCore.Text(b,"response_type")=="code"&&ConsentCore.Text(b,"code_challenge_method")=="S256"&&Regex.IsMatch(ConsentCore.Text(b,"code_challenge",43),"^[A-Za-z0-9_-]{43}$")&&ConsentCore.Text(b,"state",1024).Length>=16&&GrantPolicyIds.Contains(ConsentCore.Text(b,"grant_policy_id",96)),"CLIENT_AUTHORIZE_BINDING");}
        if(r.Action=="exchange"){BindClient(a);ConsentCore.Need(ConsentCore.Text(a,"grant_type")=="authorization_code"&&ConsentCore.Text(a,"client_assertion_type")=="urn:ietf:params:oauth:client-assertion-type:jwt-bearer","CLIENT_EXCHANGE_BINDING");ConsentCore.Text(a,"code",256);ConsentCore.Text(a,"code_verifier",128);ConsentCore.Text(a,"client_assertion",8192);}
    }
    private void BindClient(JsonElement e)=>ConsentCore.Need(ConsentCore.Text(e,"client_id")==ClientId&&ConsentCore.Text(e,"redirect_uri")==RedirectUri&&ConsentCore.Text(e,"resource")==Resource,"CLIENT_FIXED_OAUTH_BINDING");
    public void Dispose(){for(var i=held.Count-1;i>=0;i--)held[i].Dispose();held.Clear();}
}
