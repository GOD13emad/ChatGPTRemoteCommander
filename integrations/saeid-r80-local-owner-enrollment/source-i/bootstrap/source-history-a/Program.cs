using CommanderOwnerConsent;
using System.Security.Cryptography;
using System.Text;
namespace CommanderOwnerBootstrap;
internal static class Program
{
    private static int Main(string[] args)
    {
        try{
            if(args.SequenceEqual(new[]{"--diagnose"})){var s=WindowsGuard.Inspect();Print("DIAGNOSTIC",w=>{w.WriteBoolean("elevated",s.Elevated);w.WriteBoolean("administrator",s.Administrator);w.WriteNumber("integrity",s.IntegrityRid);w.WriteBoolean("authorityOpened",false);w.WriteBoolean("taskRegistered",false);w.WriteBoolean("keysGenerated",false);});return 0;}
            ConsentCore.Need(args.Length>0,"EXACT_BOOTSTRAP_MODE");
            if(args[0]=="--rollback"){ConsentCore.Need(args.Length==2,"EXACT_ROLLBACK_ARGS");WindowsGuard.RequireOwner(WindowsGuard.Inspect(),args[1]);ProtectedInstall.Rollback(args[1]);Print("ROLLBACK_TASK_REMOVED_KEYS_PRESERVED");return 0;}
            ConsentCore.Need(args.Length==4&&(args[0]=="--preflight"||args[0]=="--apply"),"EXACT_BOOTSTRAP_ARGS");
            // UAC must be deliberate and performed by the owner/parent. No
            // runas launcher, alternate-user elevation or JSON elevated flag.
            if(args[0]=="--apply")WindowsGuard.RequireOwner(WindowsGuard.Inspect(),args[3]);
            using var bundle=new Bundle(args[1],args[2]);var token=WindowsGuard.Inspect();ConsentCore.Need(token.Sid==bundle.OwnerSid&&args[3]==bundle.OwnerSid&&token.SessionId==bundle.Session,"SAME_OWNER_SESSION_REQUIRED");
            ProtectedInstall.RequireAbsent(ProtectedInstall.ProgramRoot);ProtectedInstall.RequireAbsent(ProtectedInstall.StateRoot);
            if(args[0]=="--preflight"){Print("PREFLIGHT_ONLY_UAC_REQUIRED",w=>{w.WriteString("bundleSha256",bundle.ManifestHash);w.WriteBoolean("targetsAbsent",true);w.WriteBoolean("taskExistenceUnproven",true);w.WriteBoolean("keysGenerated",false);w.WriteBoolean("installedCommanderChanged",false);});return 0;}
            WindowsGuard.RequireOwner(token,bundle.OwnerSid);Apply(bundle);Print("ENROLLED_PREPRODUCTION_SELFTEST_ONLY",w=>{w.WriteBoolean("taskStarted",false);w.WriteBoolean("realChatGptIngress",false);w.WriteBoolean("installedCommanderChanged",false);});return 0;
        }
        catch(Exception e){var code=e is ConsentFault?e.Message:e is System.Text.Json.JsonException?"INVALID_JSON":e is UnauthorizedAccessException?"ACCESS_DENIED":e is IOException?"IO_UNCERTAIN_RECONCILE_NO_RETRY":"BOOTSTRAP_UNAVAILABLE_NO_RETRY";Console.Error.WriteLine(Encoding.UTF8.GetString(BootstrapPolicy.Json(w=>w.WriteString("code",code))));return 2;}
    }
    private static void Print(string status,Action<System.Text.Json.Utf8JsonWriter>? more=null)=>Console.WriteLine(Encoding.UTF8.GetString(BootstrapPolicy.Json(w=>{w.WriteString("status",status);more?.Invoke(w);})));
    private static void Apply(Bundle bundle)
    {
        var owner=bundle.OwnerSid;var program=ProtectedInstall.ProgramRoot;var state=ProtectedInstall.StateRoot;
        ProtectedInstall.Parent(program,owner);ProtectedInstall.Parent(state,owner);ProtectedInstall.NewDirectory(state,owner);ProtectedInstall.NewDirectory(program,owner);
        // This create-only marker survives a crash. Existing targets on the next
        // invocation STOP; no automatic repair, re-enrollment or key overwrite.
        ProtectedInstall.Write(Path.Combine(state,"enrollment.intent.json"),BootstrapPolicy.Json(w=>{w.WriteString("schema","RC_OWNER_ENROLLMENT_INTENT_V1");w.WriteString("ownerSid",owner);w.WriteNumber("ownerSessionId",bundle.Session);w.WriteString("bundleSha256",bundle.ManifestHash);w.WriteString("scope","no-project-selftest-only");}),owner);
        foreach(var name in new[]{"pending","events","receipts","oauth-exchange","task-temp"})ProtectedInstall.NewDirectory(Path.Combine(state,name),owner);
        var files=new List<(string Root,string Name,string Sha)>();
        void Put(string root,string name,byte[] bytes,bool read=false){ProtectedInstall.Write(Path.Combine(root=="program"?program:state,name),bytes,owner,read);files.Add((root,name,BootstrapPolicy.Hex(bytes)));}
        foreach(var image in BootstrapPolicy.Images)Put("program",image,WindowsGuard.Read(bundle.Files[image]),true);
        Put("program","CommanderOwnerBootstrap.exe",WindowsGuard.Read(bundle.Files["CommanderOwnerBootstrap.exe"]),true);Put("program","TaskOwner.ps1",ProtectedInstall.TaskScript(),true);
        using var consent=ECDsa.Create(ECCurve.NamedCurves.nistP256);using var issuer=ECDsa.Create(ECCurve.NamedCurves.nistP256);using var client=ECDsa.Create(ECCurve.NamedCurves.nistP256);
        foreach(var pair in new[]{("consent-key.pk8",consent),("oauth-sign-key.pk8",issuer),("selftest-client-key.pk8",client)}){var secret=pair.Item2.ExportPkcs8PrivateKey();try{Put("state",pair.Item1,secret);}finally{CryptographicOperations.ZeroMemory(secret);}}
        Put("state","consent-public.pem",Encoding.UTF8.GetBytes(consent.ExportSubjectPublicKeyInfoPem()),true);Put("state","oauth-public.pem",Encoding.UTF8.GetBytes(issuer.ExportSubjectPublicKeyInfoPem()),true);
        var epoch="epoch:"+Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();var policies=BootstrapPolicy.Policies(owner,bundle.Session,epoch,bundle.Hashes,consent,issuer,client);
        foreach(var pair in policies.Where(x=>x.Key!="client-policy.json"))Put("state",pair.Key,pair.Value,true);
        foreach(var pair in BootstrapPolicy.EmptyJournals(policies["policy.json"],policies["oauth-policy.json"]))Put("state",pair.Key,pair.Value);
        ProtectedInstall.Write(Path.Combine(state,"task.attested.json"),[],owner);Put("state","task.intent.json",BootstrapPolicy.Json(w=>{w.WriteString("schema","RC_OWNER_TASK_INTENT_V1");w.WriteString("taskName",BootstrapPolicy.TaskName);w.WriteBoolean("started",false);}),false);
        var result=ProtectedInstall.InvokeTaskScript("apply");ConsentCore.Need(result=="TASK_CREATED_ATTESTED_NOT_STARTED","TASK_ATTESTATION_RESULT");
        using(var task=WindowsGuard.OpenProtected(Path.Combine(state,"task.attested.json"),32768)){var raw=WindowsGuard.Read(task);using var t=ConsentCore.Strict(raw);ConsentCore.Need(ConsentCore.Text(t.RootElement,"taskName")==BootstrapPolicy.TaskName&&t.RootElement.GetProperty("started").GetBoolean()==false,"TASK_ATTESTATION_CONTENT");files.Add(("state","task.attested.json",BootstrapPolicy.Hex(raw)));}
        // Publish the owner-readable client policy only after verified task setup.
        Put("program","client-policy.json",policies["client-policy.json"],true);
        ProtectedInstall.Write(Path.Combine(state,"enrollment.complete.json"),BootstrapPolicy.Json(w=>{w.WriteString("schema","RC_OWNER_ENROLLMENT_COMPLETE_V1");w.WriteString("ownerSid",owner);w.WriteString("bundleSha256",bundle.ManifestHash);w.WriteBoolean("taskStarted",false);w.WriteBoolean("preproductionOnly",true);w.WritePropertyName("immutableFiles");w.WriteStartArray();foreach(var file in files){w.WriteStartObject();w.WriteString("root",file.Root);w.WriteString("name",file.Name);w.WriteString("sha256",file.Sha);w.WriteEndObject();}w.WriteEndArray();}),owner);
    }
}
