using CommanderOwnerConsent;using System.Security.Cryptography;using System.Text.Json;
namespace CommanderOwnerBootstrap;
internal static class BootstrapQA
{
    private static int Main()
    {
        var pass=0;var errors=new List<string>();void Test(string n,Action a,bool denied=false){try{a();if(denied)throw new Exception("DENIAL_MISSING");pass++;}catch(Exception e){if(denied&&e.Message!="DENIAL_MISSING")pass++;else errors.Add(n+":"+e.Message);}}
        using var consent=ECDsa.Create(ECCurve.NamedCurves.nistP256);using var issuer=ECDsa.Create(ECCurve.NamedCurves.nistP256);using var client=ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var pins=BootstrapPolicy.Images.ToDictionary(x=>x,_=>new string('a',64));var p=BootstrapPolicy.Policies("S-1-5-21-1-2-3-1001",1,"epoch:test",pins,consent,issuer,client);
        Test("native-policy",()=>{using var d=ConsentCore.Strict(p["policy.json"]);ConsentCore.ValidatePolicy(d.RootElement);});
        Test("no-project-only",()=>{using var d=ConsentCore.Strict(p["policy.json"]);var g=d.RootElement.GetProperty("grantCatalog")[0];ConsentCore.Need(g.GetProperty("grant").GetProperty("actions")[0].GetString()=="selftest"&&g.GetProperty("grant").GetProperty("rootPolicyId").GetString()=="no-project","GRANT");});
        Test("host-pins",()=>{using var h=ConsentCore.Strict(p["issuer-host-policy.json"]);ConsentCore.Need(ConsentCore.Text(h.RootElement,"nativePolicySha256")==BootstrapPolicy.Hex(p["policy.json"])&&ConsentCore.Text(h.RootElement,"oauthPolicySha256")==BootstrapPolicy.Hex(p["oauth-policy.json"]),"PINS");});
        Test("client-schema",()=>{using var c=ConsentCore.Strict(p["client-policy.json"]);ConsentCore.Fields(c.RootElement,"schema","ownerSid","ownerSessionId","hostSha256","proxySha256","adminSha256","nativePolicySha256","oauthPolicySha256","hostPolicySha256","clientId","redirectUri","resource","grantPolicyIds","taskName");ConsentCore.Need(ConsentCore.Text(c.RootElement,"taskName")==BootstrapPolicy.TaskName,"TASK");});
        Test("key-separation",()=>ConsentCore.Need(!consent.ExportSubjectPublicKeyInfo().SequenceEqual(issuer.ExportSubjectPublicKeyInfo())&&!client.ExportSubjectPublicKeyInfo().SequenceEqual(issuer.ExportSubjectPublicKeyInfo()),"SEPARATION"));
        Test("sid-denial",()=>BootstrapPolicy.Policies("S-1-5-18",1,"epoch:test",pins,consent,issuer,client),true);
        Test("session-denial",()=>BootstrapPolicy.Policies("S-1-5-21-1-2-3-1001",0,"epoch:test",pins,consent,issuer,client),true);
        Test("honest-zero-journals",()=>{var j=BootstrapPolicy.EmptyJournals(p["policy.json"],p["oauth-policy.json"]);ConsentCore.Need(j["issuer.journal"].Length==0&&j["oauth-exchange/exchange.journal"].Length==0,"NO_FAKE_ROWS");});
        Test("bad-native",()=>Bundle.Pe(new byte[1024]),true);
        Test("ordinary-elevation-denial",()=>WindowsGuard.RequireOwner(WindowsGuard.Inspect(),"S-1-5-21-1-2-3-1001"),true);
        Console.WriteLine(System.Text.Encoding.UTF8.GetString(BootstrapPolicy.Json(w=>{w.WriteNumber("pass",pass);w.WriteNumber("fail",errors.Count);BootstrapPolicy.Strings(w,"errors",errors.ToArray());w.WriteBoolean("keysInMemoryOnly",true);w.WriteBoolean("installed",false);w.WriteBoolean("taskRegistered",false);})));return errors.Count==0?0:2;
    }
}
