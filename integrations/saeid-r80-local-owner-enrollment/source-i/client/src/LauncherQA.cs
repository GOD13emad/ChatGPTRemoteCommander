using System.Diagnostics;using System.Text;using CommanderNativeIssuer;using CommanderOwnerConsent;
namespace CommanderOwnerProxy;
internal static class LauncherQA
{
    internal static async Task<int> Main(string[] args)
    {
        if(args.SequenceEqual(new[]{"--owned-wait-fixture"})){await Task.Delay(10000);return 0;}
        ConsentCore.Need(args.Length==0,"FIXTURE_ARGS");var image=Environment.ProcessPath??throw new ConsentFault("FIXTURE_IMAGE");var info=new ProcessStartInfo(image){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};info.ArgumentList.Add("--owned-wait-fixture");using var child=Process.Start(info)??throw new ConsentFault("FIXTURE_CHILD");var owned=new OwnedLauncher(child,image);await Task.Delay(100);var stopped=owned.StopOnlyOwnedLauncher();var secondObservation=owned.StopOnlyOwnedLauncher();ConsentCore.Need(stopped&&secondObservation&&child.HasExited,"FIXTURE_CLEANUP");Console.WriteLine(Encoding.UTF8.GetString(IssuerProtocol.Json(w=>{w.WriteString("schema","RC_OWN_LAUNCHER_PRIVATE_FIXTURE_V1");w.WriteBoolean("heldOwnChildCleanupConfirmed",stopped);w.WriteBoolean("alreadyExitedObservationConfirmed",secondObservation);w.WriteBoolean("otherPidsOpened",false);w.WriteBoolean("systemTaskStartedOrStopped",false);w.WriteBoolean("pipeOpened",false);})));return 0;
    }
}
