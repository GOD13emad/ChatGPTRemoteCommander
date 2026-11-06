using CommanderOwnerConsent;using CommanderOwnerBootstrap;using System.Text;using System.Text.Json;
namespace CommanderOwnerFinalizeJ
{
internal static class JQA
{
 static int Main(){var pass=0;var errors=new List<string>();void Test(string n,Action action){try{action();pass++;}catch(Exception e){errors.Add(n+":"+e.GetType().Name+":"+e.Message);}}void Need(bool ok)=>ConsentCore.Need(ok,"QA_ASSERTION");const string owner="S-1-5-21-1-2-3-1001",enroll="enroll:11111111111111111111111111111111",j="finalize:22222222222222222222222222222222",ti="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
  var token=WindowsGuard.Inspect();if(token.Elevated)throw new Exception("QA_ORDINARY_ONLY");
  Test("legacy-bytes-exact-frozen-I-plan",()=>Need(JContract.LegacyPrepared(owner,enroll).SequenceEqual(TaskPlan.Prepared(owner,JContract.BundleSha,enroll))));
  Test("new-xml-no-invalid-logon",()=>Need(!JContract.Xml(JContract.Description(enroll,j)).Contains("<LogonType>",StringComparison.Ordinal)));
  Test("old-xml-preserved-not-fixed",()=>Need(JContract.Xml("legacy",true).Contains("<LogonType>ServiceAccount</LogonType>",StringComparison.Ordinal)));
  Test("fresh-unique-J-binding",()=>Need(!JContract.Prepared(owner,enroll,j).SequenceEqual(JContract.Prepared(owner,enroll,"finalize:33333333333333333333333333333333"))));
  Test("prepared-strict-schema",()=>{using var d=ConsentCore.Strict(JContract.Prepared(owner,enroll,j));ConsentCore.Fields(d.RootElement,"schema","ownerSid","bundleSha256","enrollmentId","jId","taskName","xml","sddl");});
  Test("fixed-selftest-client-only",()=>{using var d=ConsentCore.Strict(JContract.ClientPolicy(owner,1,[1],[2],[3]));var e=d.RootElement;ConsentCore.Fields(e,"schema","ownerSid","ownerSessionId","hostSha256","proxySha256","adminSha256","nativePolicySha256","oauthPolicySha256","hostPolicySha256","clientId","redirectUri","resource","grantPolicyIds","taskName");Need(ConsentCore.Text(e,"resource")==JContract.Resource&&e.GetProperty("grantPolicyIds").GetArrayLength()==1&&e.GetProperty("grantPolicyIds")[0].GetString()=="selftest");});
  Test("typed-primary-error-kept-through-cleanup",()=>{var f=new JFault("J_TEST_PRIMARY","CreateOnlyTask",unchecked((int)0x80041318),"COMException");OwnedHelper.PreservePrimary(f,false);Need(f.Phase=="CreateOnlyTask"&&f.NativeHResult==-2147216616&&f.Message=="J_TEST_PRIMARY"&&f.Data["ownedHelperCleanupUncertain"] is true);});
  Test("raw-message-denied",()=>Need(!JIO.Safe("secret URL /token")));
  Test("fixed-code-accepted",()=>Need(JIO.Safe("J_TASK_SDDL_CHANGED")));
  Test("actual-ordinary-owner-denied",()=>{try{WindowsGuard.RequireOwner(token,token.Sid);}catch(ConsentFault e)when(e.Message=="SAME_OWNER_REAL_UAC_TOKEN_REQUIRED"){return;}throw new Exception("OWNER_GUARD_OPEN");});
  Test("OS-TI-ancestor-admitted",()=>Need(WindowsGuard.TrustedAncestorSid(ti,Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles))));
  Test("private-TI-not-admitted",()=>Need(!WindowsGuard.TrustedAncestorSid(ti,JContract.ProgramRoot)&&!WindowsGuard.TrustedAncestorSid(ti,JContract.StateRoot)));
  Test("ordinary-OS-ancestor-denied",()=>Need(!WindowsGuard.TrustedAncestorSid(owner,Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles))));
  Test("actual-private-TI-owner-denied",()=>{try{WindowsGuard.Protected(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),true);}catch(ConsentFault e)when(e.Message=="PROTECTED_OWNER_REQUIRED"){return;}throw new Exception("PRIVATE_OWNER_OPEN");});
  Test("fixed-system-tool-readonly",()=>{using var f=JIO.SystemTool();Need(f.Length>0);});
  Test("resource-script-not-runtime-retrieved",()=>Need(JContract.Script().Length>5000&&Encoding.UTF8.GetString(JContract.Script()).Contains("RegisterTask($taskName,$prepared.xml,18,'SYSTEM',$null,5,$sddl)",StringComparison.Ordinal)));
  Test("synthetic-public-fixture-create-only",()=>{var path=@"G:\CodexWork\RC1R80FinalizeJ\qa\fixture.json";using var f=new FileStream(path,FileMode.CreateNew,FileAccess.Write,FileShare.None);var b=JContract.Json(w=>{w.WriteString("description",JContract.Description(enroll,j));w.WriteString("xml",JContract.Xml(JContract.Description(enroll,j)));w.WriteString("oldXml",JContract.Xml("old",true));w.WriteString("host",Path.Combine(JContract.ProgramRoot,"CommanderNativeIssuer.exe"));w.WriteString("system",Environment.SystemDirectory);w.WriteString("owner",owner);});f.Write(b);f.Flush(true);});
  Console.WriteLine(Encoding.UTF8.GetString(JContract.Json(w=>{w.WriteNumber("pass",pass);w.WriteNumber("fail",errors.Count);JContract.Strings(w,"errors",errors.ToArray());w.WriteBoolean("protectedStageOpened",false);w.WriteBoolean("privateKeysOpened",false);w.WriteBoolean("tasksRegisteredStarted",false);})));return errors.Count==0?0:2;
 }
}
}
namespace CommanderOwnerBootstrap
{
 // QA-only serializer/path adapters for the exact frozen I TaskPlan dependency.
 internal static class BootstrapPolicy{internal const string TaskName=CommanderOwnerFinalizeJ.JContract.TaskName;internal static byte[] Json(Action<Utf8JsonWriter> a)=>CommanderOwnerFinalizeJ.JContract.Json(a);}
 internal static class ProtectedInstall{internal static string ProgramRoot=>CommanderOwnerFinalizeJ.JContract.ProgramRoot;}
}
