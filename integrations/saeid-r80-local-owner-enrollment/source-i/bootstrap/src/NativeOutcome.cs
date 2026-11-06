using CommanderOwnerConsent;using System.Runtime.InteropServices;using System.Text;using System.Text.Json;
namespace CommanderOwnerBootstrap;
internal enum BootstrapStage{Arguments,OwnerToken,Bundle,Targets,AncestorPreflight,ScriptPolicy,Parents,Roots,Intent,Subdirectories,Images,Keys,Policies,Journals,TaskPreparation,TaskRegistration,ClientPolicy,Completion,Rollback}
internal static partial class NativeOutcome
{
    [DllImport("user32.dll",CharSet=CharSet.Unicode,ExactSpelling=true)]private static extern int MessageBoxW(nint owner,string text,string caption,uint kind);
    internal static string Code(Exception error)=>error is ConsentFault&&FaultCodes.Contains(error.Message)?error.Message:error is JsonException?"INVALID_JSON":error is UnauthorizedAccessException?"ACCESS_DENIED":error is IOException?"IO_UNCERTAIN_RECONCILE_NO_RETRY":"BOOTSTRAP_UNAVAILABLE_NO_RETRY";
    internal static byte[] Payload(string status,string code,BootstrapStage stage,bool cleanupUncertain=false)=>BootstrapPolicy.Json(w=>{w.WriteString("schema","RC_OWNER_BOOTSTRAP_OUTCOME_V1");w.WriteString("status",status);w.WriteString("code",code);w.WriteString("phase",stage.ToString());w.WriteBoolean("automaticRetryAllowed",false);w.WriteBoolean("ownedHelperCleanupUncertain",cleanupUncertain);});
    internal static bool TryRecord(bool ownCreatedRoot,string? owner,string status,string code,BootstrapStage stage,bool cleanupUncertain=false)
    {if(!ownCreatedRoot||owner==null)return false;try{ProtectedInstall.Write(Path.Combine(ProtectedInstall.StateRoot,"bootstrap.outcome.json"),Payload(status,code,stage,cleanupUncertain),owner,true);return true;}catch{return false;}}
    internal static bool ShowApplyFailure(bool apply,string code,BootstrapStage stage)
    {
        if(!apply)return false;
        try{if(!WindowsGuard.Inspect().Elevated)return false;return MessageBoxW(0,"نصب کامل نشد؛ دوباره اجرا نکنید.\nمرحله: "+stage+"\nکد: "+code+"\nاین پیام را به همین گفت‌وگو اعلام کنید.","Commander — نتیجهٔ نصب",0x10|0x80000|0x100000)>0;}catch{return false;}
    }
}
