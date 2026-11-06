using CommanderOwnerConsent;
using System.Security.Cryptography;
using System.Text;
namespace CommanderOwnerBootstrap;
internal static class Program
{
    private static BootstrapStage phase=BootstrapStage.Arguments;private static bool ownCreatedStateRoot;private static string? appliedOwner;
    private static int Main(string[] args)
    {
        try{
            if(args.SequenceEqual(new[]{"--diagnose"})){var s=WindowsGuard.Inspect();Print("DIAGNOSTIC",w=>{w.WriteBoolean("elevated",s.Elevated);w.WriteBoolean("administrator",s.Administrator);w.WriteNumber("integrity",s.IntegrityRid);w.WriteBoolean("authorityOpened",false);w.WriteBoolean("taskRegistered",false);w.WriteBoolean("keysGenerated",false);});return 0;}
            ConsentCore.Need(args.Length>0,"EXACT_BOOTSTRAP_MODE");
            if(args[0]=="--rollback"){phase=BootstrapStage.Rollback;ConsentCore.Need(args.Length==2,"EXACT_ROLLBACK_ARGS");WindowsGuard.RequireOwner(WindowsGuard.Inspect(),args[1]);Print(ProtectedInstall.Rollback(args[1]));return 0;}
            ConsentCore.Need(args.Length==4&&(args[0]=="--preflight"||args[0]=="--apply"),"EXACT_BOOTSTRAP_ARGS");
            // UAC must be deliberate and performed by the owner/parent. No
            // runas launcher, alternate-user elevation or JSON elevated flag.
            if(args[0]=="--apply"){phase=BootstrapStage.OwnerToken;WindowsGuard.RequireOwner(WindowsGuard.Inspect(),args[3]);}
            phase=BootstrapStage.Bundle;using var bundle=new Bundle(args[1],args[2]);var token=WindowsGuard.Inspect();ConsentCore.Need(token.Sid==bundle.OwnerSid&&args[3]==bundle.OwnerSid&&token.SessionId==bundle.Session,"SAME_OWNER_SESSION_REQUIRED");
            phase=BootstrapStage.Targets;
            ProtectedInstall.RequireAbsent(ProtectedInstall.ProgramRoot);ProtectedInstall.RequireAbsent(ProtectedInstall.StateRoot);
            phase=BootstrapStage.AncestorPreflight;ProtectedInstall.PreflightParents();
            phase=BootstrapStage.ScriptPolicy;
            ProtectedInstall.RequireScriptPolicyReady();
            if(args[0]=="--preflight"){Print("PREFLIGHT_ONLY_UAC_REQUIRED",w=>{w.WriteString("bundleSha256",bundle.ManifestHash);w.WriteBoolean("targetsAbsent",true);w.WriteBoolean("taskExistenceUnproven",true);w.WriteBoolean("keysGenerated",false);w.WriteBoolean("installedCommanderChanged",false);});return 0;}
            WindowsGuard.RequireOwner(token,bundle.OwnerSid);Apply(bundle);NativeOutcome.TryRecord(ownCreatedStateRoot,appliedOwner,"COMPLETE","SUCCESS",BootstrapStage.Completion);Print("ENROLLED_PREPRODUCTION_SELFTEST_ONLY",w=>{w.WriteBoolean("taskStarted",false);w.WriteBoolean("realChatGptIngress",false);w.WriteBoolean("installedCommanderChanged",false);});return 0;
        }
        catch(Exception e){var code=NativeOutcome.Code(e);var cleanup=e.Data["ownedHelperCleanupUncertain"] is true||code=="OWN_HELPER_CLEANUP_UNCERTAIN_NO_RETRY";NativeOutcome.TryRecord(ownCreatedStateRoot,appliedOwner,"FAILED_NO_RETRY",code,phase,cleanup);NativeOutcome.ShowApplyFailure(args.Length>0&&args[0]=="--apply",code,phase);Console.Error.WriteLine(Encoding.UTF8.GetString(NativeOutcome.Payload("FAILED_NO_RETRY",code,phase,cleanup)));return 2;}
    }
    private static void Print(string status,Action<System.Text.Json.Utf8JsonWriter>? more=null)=>Console.WriteLine(Encoding.UTF8.GetString(BootstrapPolicy.Json(w=>{w.WriteString("status",status);more?.Invoke(w);})));
    private static void Apply(Bundle bundle)
    {
        var owner=bundle.OwnerSid;var program=ProtectedInstall.ProgramRoot;var state=ProtectedInstall.StateRoot;
        appliedOwner=owner;phase=BootstrapStage.Parents;ProtectedInstall.Parent(program,owner);ProtectedInstall.Parent(state,owner);phase=BootstrapStage.Roots;ProtectedInstall.NewDirectory(state,owner);ownCreatedStateRoot=true;ProtectedInstall.NewDirectory(program,owner);
        // This create-only marker survives a crash. Existing targets on the next
        // invocation STOP; no automatic repair, re-enrollment or key overwrite.
        phase=BootstrapStage.Intent;var enrollment="enroll:"+Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        ProtectedInstall.Write(Path.Combine(state,"enrollment.intent.json"),BootstrapPolicy.Json(w=>{w.WriteString("schema","RC_OWNER_ENROLLMENT_INTENT_V1");w.WriteString("ownerSid",owner);w.WriteNumber("ownerSessionId",bundle.Session);w.WriteString("bundleSha256",bundle.ManifestHash);w.WriteString("scope","no-project-selftest-only");w.WriteString("enrollmentId",enrollment);}),owner);
        phase=BootstrapStage.Subdirectories;foreach(var name in new[]{"pending","events","receipts","oauth-exchange","task-temp"})ProtectedInstall.NewDirectory(Path.Combine(state,name),owner);
        var files=new List<(string Root,string Name,string Sha)>();
        void Put(string root,string name,byte[] bytes,bool read=false,bool immutable=true){ProtectedInstall.Write(Path.Combine(root=="program"?program:state,name),bytes,owner,read);if(immutable)files.Add((root,name,BootstrapPolicy.Hex(bytes)));}
        phase=BootstrapStage.Images;foreach(var image in BootstrapPolicy.Images)Put("program",image,WindowsGuard.Read(bundle.Files[image]),true);
        Put("program","CommanderOwnerBootstrap.exe",WindowsGuard.Read(bundle.Files["CommanderOwnerBootstrap.exe"]),true);Put("program","TaskOwner.ps1",ProtectedInstall.TaskScript(),true);
        phase=BootstrapStage.Keys;using var consent=ECDsa.Create(ECCurve.NamedCurves.nistP256);using var issuer=ECDsa.Create(ECCurve.NamedCurves.nistP256);using var client=ECDsa.Create(ECCurve.NamedCurves.nistP256);
        foreach(var pair in new[]{("consent-key.pk8",consent),("oauth-sign-key.pk8",issuer),("selftest-client-key.pk8",client)}){var secret=pair.Item2.ExportPkcs8PrivateKey();try{Put("state",pair.Item1,secret);}finally{CryptographicOperations.ZeroMemory(secret);}}
        Put("state","consent-public.pem",Encoding.UTF8.GetBytes(consent.ExportSubjectPublicKeyInfoPem()),true);Put("state","oauth-public.pem",Encoding.UTF8.GetBytes(issuer.ExportSubjectPublicKeyInfoPem()),true);
        phase=BootstrapStage.Policies;var epoch="epoch:"+Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();var policies=BootstrapPolicy.Policies(owner,bundle.Session,epoch,bundle.Hashes,consent,issuer,client);
        foreach(var pair in policies.Where(x=>x.Key!="client-policy.json"))Put("state",pair.Key,pair.Value,true);
        phase=BootstrapStage.Journals;foreach(var pair in BootstrapPolicy.EmptyJournals(policies["policy.json"],policies["oauth-policy.json"]))Put("state",pair.Key,pair.Value,false,!MutableState(pair.Key));
        phase=BootstrapStage.TaskPreparation;var prepared=TaskPlan.Prepared(owner,bundle.ManifestHash,enrollment);Put("state","task.prepared.json",prepared);
        ProtectedInstall.Write(Path.Combine(state,"task.attested.json"),[],owner);
        Put("state","task.registration.intent.json",BootstrapPolicy.Json(w=>{w.WriteString("schema","RC_OWNER_TASK_REGISTRATION_INTENT_V1");w.WriteString("ownerSid",owner);w.WriteString("bundleSha256",bundle.ManifestHash);w.WriteString("enrollmentId",enrollment);w.WriteString("preparedSha256",BootstrapPolicy.Hex(prepared));}),false);
        phase=BootstrapStage.TaskRegistration;var result=ProtectedInstall.InvokeTaskScript("apply");ConsentCore.Need(result=="TASK_CREATED_ATTESTED_NOT_STARTED","TASK_ATTESTATION_RESULT");
        using(var task=WindowsGuard.OpenProtected(Path.Combine(state,"task.attested.json"),32768)){var raw=WindowsGuard.Read(task);using var t=ConsentCore.Strict(raw);ConsentCore.Need(ConsentCore.Text(t.RootElement,"taskName")==BootstrapPolicy.TaskName&&t.RootElement.GetProperty("started").GetBoolean()==false,"TASK_ATTESTATION_CONTENT");files.Add(("state","task.attested.json",BootstrapPolicy.Hex(raw)));}
        // Publish the owner-readable client policy only after verified task setup.
        phase=BootstrapStage.ClientPolicy;Put("program","client-policy.json",policies["client-policy.json"],true);
        phase=BootstrapStage.Completion;ProtectedInstall.Write(Path.Combine(state,"enrollment.complete.json"),BootstrapPolicy.Json(w=>{w.WriteString("schema","RC_OWNER_ENROLLMENT_COMPLETE_V1");w.WriteString("ownerSid",owner);w.WriteString("bundleSha256",bundle.ManifestHash);w.WriteBoolean("taskStarted",false);w.WriteBoolean("preproductionOnly",true);BootstrapPolicy.Strings(w,"mutableStatePreserved","issuer.journal","issuer.head.json","oauth-exchange/exchange.journal","oauth-exchange/exchange.head","pending","events","receipts","writer.lock","oauth-exchange/exchange.lock");w.WritePropertyName("immutableFiles");w.WriteStartArray();foreach(var file in files){w.WriteStartObject();w.WriteString("root",file.Root);w.WriteString("name",file.Name);w.WriteString("sha256",file.Sha);w.WriteEndObject();}w.WriteEndArray();}),owner);
    }
    internal static bool MutableState(string name)=>name is "issuer.journal" or "issuer.head.json" or "oauth-exchange/exchange.journal" or "oauth-exchange/exchange.head";
}
