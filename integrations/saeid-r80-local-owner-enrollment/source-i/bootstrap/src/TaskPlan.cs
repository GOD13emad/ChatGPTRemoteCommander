using CommanderOwnerConsent;using System.Security;
namespace CommanderOwnerBootstrap;
internal static class TaskPlan
{
    internal static string Description(string bundle,string enrollment)=>"Remote Commander owner selftest issuer; bundle="+bundle+"; enrollment="+enrollment;
    internal static byte[] Prepared(string owner,string bundle,string enrollment)
    {
        ConsentCore.Need(System.Text.RegularExpressions.Regex.IsMatch(bundle,"^[a-f0-9]{64}$")&&System.Text.RegularExpressions.Regex.IsMatch(enrollment,"^enroll:[a-f0-9]{32}$"),"TASK_PLAN_BINDING");
        var description=SecurityElement.Escape(Description(bundle,enrollment));var host=SecurityElement.Escape(Path.Combine(ProtectedInstall.ProgramRoot,"CommanderNativeIssuer.exe"));var cwd=SecurityElement.Escape(Environment.SystemDirectory);
        var xml="<?xml version=\"1.0\" encoding=\"UTF-16\"?><Task version=\"1.4\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\"><RegistrationInfo><Description>"+description+"</Description></RegistrationInfo><Triggers/><Principals><Principal id=\"System\"><UserId>S-1-5-18</UserId><LogonType>ServiceAccount</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>false</AllowHardTerminate><StartWhenAvailable>false</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>false</Hidden><WakeToRun>false</WakeToRun><ExecutionTimeLimit>PT2M</ExecutionTimeLimit></Settings><Actions Context=\"System\"><Exec><Command>"+host+"</Command><Arguments>--serve-once</Arguments><WorkingDirectory>"+cwd+"</WorkingDirectory></Exec></Actions></Task>";
        var sddl="O:BAG:BAD:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGX;;;"+owner+")";
        return BootstrapPolicy.Json(w=>{w.WriteString("schema","RC_OWNER_TASK_PREPARED_V1");w.WriteString("ownerSid",owner);w.WriteString("bundleSha256",bundle);w.WriteString("enrollmentId",enrollment);w.WriteString("taskName",BootstrapPolicy.TaskName);w.WriteString("xml",xml);w.WriteString("sddl",sddl);});
    }
}
