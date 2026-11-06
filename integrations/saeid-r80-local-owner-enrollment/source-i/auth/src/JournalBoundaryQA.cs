using System.Text;using System.Text.Json;using CommanderOwnerConsent;using System.Security.Cryptography;using System.Security.AccessControl;
namespace CommanderOwnerAuthQA;
internal static class JournalBoundaryQA
{
    private static int Main(string[] args)
    {
        var root=Path.GetFullPath(args.Single());if(Directory.Exists(root))throw new Exception("EXISTING_FIXTURE");Directory.CreateDirectory(root);var pass=0;var failures=new List<string>();var cases=new List<string>();
        byte[] J(string s)=>Encoding.UTF8.GetBytes(s);
        var enrollment=new string('a',64);var journalId=ConsentCore.B64(new byte[32]);
        void Setup(string name){Directory.CreateDirectory(Path.Combine(root,name));var p=Path.Combine(root,name);File.WriteAllBytes(Path.Combine(p,"issuer.journal"),[]);File.WriteAllBytes(Path.Combine(p,"exchange.journal"),[]);File.WriteAllText(Path.Combine(p,"issuer.initialized"),"{\"schema\":\"RC_ISSUER_INITIALIZED_V1\",\"journalId\":\""+journalId+"\",\"enrollmentSha256\":\""+enrollment+"\"}");File.WriteAllText(Path.Combine(p,"issuer.head.json"),"{\"schema\":\"RC_ISSUER_HEAD_V1\",\"journalId\":\""+journalId+"\",\"sequence\":0,\"hash\":\""+new string('0',64)+"\"}");File.WriteAllText(Path.Combine(p,"exchange.initialized"),enrollment);File.WriteAllText(Path.Combine(p,"exchange.head"),"{\"sequence\":0,\"hash\":\""+new string('0',64)+"\",\"enrollment\":\""+enrollment+"\"}");}
        void Test(string name,Action<string> action,bool deny=false){Setup(name);try{action(Path.Combine(root,name));if(deny)throw new Exception("DENIAL_MISSING");pass++;cases.Add(name);}catch(Exception e){if(deny&&e is not Exception{Message:"DENIAL_MISSING"}){pass++;cases.Add(name);}else failures.Add(name+":"+e.Message);}}
        byte[] Read(string p,string name="issuer.journal")=>ProtectedJournal.ReadBoundaryFixture(p,name,name=="issuer.journal"?4*1024*1024:8*1024*1024,enrollment);
        Test("issuer-initial-zero",p=>ConsentCore.Need(Read(p).Length==0,"NOT_ZERO"));
        Test("exchange-initial-zero",p=>ConsentCore.Need(Read(p,"exchange.journal").Length==0,"NOT_ZERO"));
        Test("issuer-noninitial-sequence",p=>{var f=Path.Combine(p,"issuer.head.json");File.WriteAllText(f,File.ReadAllText(f).Replace("\"sequence\":0","\"sequence\":1"));Read(p);},true);
        Test("issuer-nonzero-hash",p=>{var f=Path.Combine(p,"issuer.head.json");File.WriteAllText(f,File.ReadAllText(f).Replace(new string('0',64),new string('1',64)));Read(p);},true);
        Test("issuer-wrong-id",p=>{var f=Path.Combine(p,"issuer.head.json");File.WriteAllText(f,File.ReadAllText(f).Replace(journalId,ConsentCore.B64(RandomNumberGenerator.GetBytes(32))));Read(p);},true);
        Test("issuer-wrong-enrollment",p=>{var f=Path.Combine(p,"issuer.initialized");File.WriteAllText(f,File.ReadAllText(f).Replace(enrollment,new string('b',64)));Read(p);},true);
        Test("issuer-missing-head",p=>{File.Delete(Path.Combine(p,"issuer.head.json"));Read(p);},true);
        Test("issuer-missing-journal",p=>{File.Delete(Path.Combine(p,"issuer.journal"));Read(p);},true);
        Test("issuer-empty-anchor",p=>{File.WriteAllBytes(Path.Combine(p,"issuer.initialized"),[]);Read(p);},true);
        Test("issuer-duplicate-head-key",p=>{var f=Path.Combine(p,"issuer.head.json");File.WriteAllText(f,File.ReadAllText(f).Replace("\"sequence\":0","\"sequence\":0,\"sequence\":0"));Read(p);},true);
        Test("exchange-noninitial-sequence",p=>{var f=Path.Combine(p,"exchange.head");File.WriteAllText(f,File.ReadAllText(f).Replace("\"sequence\":0","\"sequence\":1"));Read(p,"exchange.journal");},true);
        Test("exchange-wrong-marker",p=>{File.WriteAllText(Path.Combine(p,"exchange.initialized"),new string('b',64));Read(p,"exchange.journal");},true);
        Test("exchange-head-binding",p=>{var f=Path.Combine(p,"exchange.head");File.WriteAllText(f,File.ReadAllText(f).Replace(enrollment,new string('c',64)));Read(p,"exchange.journal");},true);
        Test("issuer-truncated-tail",p=>{File.WriteAllBytes(Path.Combine(p,"issuer.journal"),J("{}"));Read(p);},true);
        Test("exchange-truncated-tail",p=>{File.WriteAllBytes(Path.Combine(p,"exchange.journal"),J("{}"));Read(p,"exchange.journal");},true);
        Test("unknown-role",p=>{File.WriteAllBytes(Path.Combine(p,"key.pk8"),[1]);try{ProtectedJournal.ReadBoundaryFixture(p,"key.pk8",4096,enrollment);}catch(ConsentFault e)when(e.Message=="JOURNAL_FIXED_ROLE_SIZE"){return;}throw new Exception("EXPECTED_ROLE_DENIAL");});
        Test("ordinary-production-root-denial",p=>ProtectedJournal.Read(p,"issuer.journal",4*1024*1024,enrollment),true);
        Test("valid-nonzero-tail-reader-only",p=>{File.WriteAllBytes(Path.Combine(p,"issuer.journal"),J("{}\n"));ConsentCore.Need(Read(p).Length==3,"TAIL_READER");});
        Test("production-private-descriptor",p=>{var a=ConsentPrivateFile.Descriptor();ConsentCore.Need(a.AreAccessRulesProtected&&a.GetOwner(typeof(System.Security.Principal.SecurityIdentifier))?.Value=="S-1-5-32-544","PRIVATE_DESCRIPTOR");foreach(System.Security.AccessControl.FileSystemAccessRule rule in a.GetAccessRules(true,true,typeof(System.Security.Principal.SecurityIdentifier)))ConsentCore.Need(rule.IdentityReference.Value is "S-1-5-18" or "S-1-5-32-544","PRIVATE_DESCRIPTOR_UNTRUSTED");});
        Test("real-fixture-file-protected-dacl",p=>{var path=Path.Combine(p,"receipt.private");using(var f=ConsentPrivateFile.CreateBoundaryFixtureFile(path)){f.Write(J("{\"fixture\":true}"));f.Flush(true);}var a=new FileInfo(path).GetAccessControl(System.Security.AccessControl.AccessControlSections.Access);ConsentCore.Need(a.AreAccessRulesProtected,"ACTUAL_FILE_DACL_NOT_PROTECTED");using var held=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read);try{using var writer=new FileStream(path,FileMode.Open,FileAccess.Write,FileShare.ReadWrite);throw new ConsentFault("WRITE_NOT_BLOCKED");}catch(IOException){}});
        Test("real-fixture-authority-denied",p=>{var path=Path.Combine(p,"receipt.private");using(var f=ConsentPrivateFile.CreateBoundaryFixtureFile(path)){f.WriteByte(1);f.Flush(true);}using var file=WindowsGuard.OpenProtected(path,4096,true);},true);
        using var output=new MemoryStream();using(var w=new Utf8JsonWriter(output)){w.WriteStartObject();w.WriteNumber("pass",pass);w.WriteNumber("fail",failures.Count);foreach(var pair in new[]{("cases",cases),("failures",failures)}){w.WritePropertyName(pair.Item1);w.WriteStartArray();foreach(var value in pair.Item2)w.WriteStringValue(value);w.WriteEndArray();}w.WriteBoolean("productionAclPositive",false);w.WriteBoolean("fixtureBypassesOnlyAclAndFixedRoot",true);w.WriteBoolean("keysGenerated",false);w.WriteEndObject();}Console.WriteLine(Encoding.UTF8.GetString(output.ToArray()));return failures.Count==0?0:2;
    }
}
