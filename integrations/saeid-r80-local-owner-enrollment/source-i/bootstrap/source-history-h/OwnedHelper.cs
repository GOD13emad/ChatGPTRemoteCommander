using CommanderOwnerConsent;using System.Diagnostics;using System.Runtime.InteropServices;using System.Text;using Microsoft.Win32.SafeHandles;
namespace CommanderOwnerBootstrap;
internal sealed class OwnedHelper
{
    private readonly SafeProcessHandle handle;private readonly long creation;private readonly string image;
    [DllImport("kernel32.dll",SetLastError=true)]private static extern bool GetProcessTimes(SafeProcessHandle process,out long creation,out long exit,out long kernel,out long user);
    [DllImport("kernel32.dll")]private static extern uint WaitForSingleObject(SafeProcessHandle process,uint timeout);
    [DllImport("kernel32.dll",SetLastError=true)]private static extern bool TerminateProcess(SafeProcessHandle process,uint code);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]private static extern bool QueryFullProcessImageNameW(SafeProcessHandle process,uint flags,StringBuilder name,ref uint size);
    internal OwnedHelper(Process justCreated,string expected)
    {handle=justCreated.SafeHandle;image=Path.GetFullPath(expected);ConsentCore.Need(GetProcessTimes(handle,out creation,out _,out _,out _)&&PathOf().Equals(image,StringComparison.OrdinalIgnoreCase),"OWN_HELPER_CAPTURE_FAILED_UNCERTAIN");}
    private string PathOf(){var b=new StringBuilder(32768);uint n=(uint)b.Capacity;ConsentCore.Need(QueryFullProcessImageNameW(handle,0,b,ref n),"OWN_HELPER_IMAGE_QUERY");return Path.GetFullPath(b.ToString());}
    internal bool ReapOnlyOriginal()
    {try{ConsentCore.Need(GetProcessTimes(handle,out var current,out _,out _,out _)&&current==creation,"OWN_HELPER_GENERATION");var wait=WaitForSingleObject(handle,0);if(wait==0)return true;ConsentCore.Need(wait==258&&PathOf().Equals(image,StringComparison.OrdinalIgnoreCase),"OWN_HELPER_CHANGED");if(!TerminateProcess(handle,0xe0800002))return WaitForSingleObject(handle,0)==0;return WaitForSingleObject(handle,2000)==0;}catch{return false;}}
    internal static void PreservePrimary(Exception? primary,bool cleaned)
    {if(cleaned)return;if(primary!=null){primary.Data["ownedHelperCleanupUncertain"]=true;return;}throw new ConsentFault("OWN_HELPER_CLEANUP_UNCERTAIN_NO_RETRY");}
}
