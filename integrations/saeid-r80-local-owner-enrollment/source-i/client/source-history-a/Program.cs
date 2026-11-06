using System.Text;using System.Text.Json;using CommanderOwnerConsent;using CommanderNativeIssuer;
namespace CommanderOwnerProxy;
internal static class Program
{
    internal static async Task<int> Main(string[] args)
    {
        var transport=new ClientTransport();string id="client";try
        {
            if(args.SequenceEqual(new[]{"--selftest"}))return await ClientQA.Run();
            if(args.SequenceEqual(new[]{"--diagnose"})){var s=WindowsGuard.Inspect();Console.WriteLine(Encoding.UTF8.GetString(IssuerProtocol.Json(w=>{w.WriteString("schema","RC_NATIVE_CLIENT_DIAGNOSTIC_V1");w.WriteBoolean("systemSid",s.Sid=="S-1-5-18");w.WriteBoolean("elevated",s.Elevated);w.WriteBoolean("administrator",s.Administrator);w.WriteNumber("integrityRid",s.IntegrityRid);w.WriteBoolean("interactiveSession",s.SessionId>0);w.WriteBoolean("policyOpened",false);w.WriteBoolean("pipeConnected",false);w.WriteBoolean("taskStarted",false);w.WriteBoolean("runtimeAuthorityExercised",false);})));return 0;}
            ConsentCore.Need(args.SequenceEqual(new[]{"--rpc"}),"CLIENT_EXACT_MODE_REQUIRED");using var cancellation=new CancellationTokenSource(TimeSpan.FromSeconds(25));Console.CancelKeyPress+=(_,e)=>{e.Cancel=true;cancellation.Cancel();};
            // Parse bounded input to correlate even preflight errors. Protected
            // policy/role checks still precede all scheduler and pipe effects.
            var bytes=await ReadInput(Console.OpenStandardInput(),cancellation.Token);var request=IssuerProtocol.Parse(bytes);id=request.Id;using var policy=ClientPolicy.LoadProtected();var admin=policy.CheckCurrentOwnerAndImage();policy.DemandRequest(request,admin);var reply=await transport.Send(policy,admin,request,bytes,cancellation.Token);await Console.OpenStandardOutput().WriteAsync(reply,cancellation.Token);Console.WriteLine();return 0;
        }
        catch(Exception error){var code=error is ConsentFault?error.Message:error is OperationCanceledException?"CLIENT_CANCELLED_NO_RETRY":error is JsonException?"CLIENT_INVALID_JSON":error is UnauthorizedAccessException?"CLIENT_ACCESS_DENIED":error is FileNotFoundException or DirectoryNotFoundException?"CLIENT_PROTECTED_ENROLLMENT_NOT_READY":error is IOException?"CLIENT_TRANSPORT_LOST_NO_RETRY":"CLIENT_UNAVAILABLE_NO_RETRY";Console.Error.WriteLine(Encoding.UTF8.GetString(IssuerProtocol.Json(w=>{w.WriteNumber("version",1);w.WriteString("id",id);w.WriteBoolean("ok",false);w.WriteString("code",code);w.WriteBoolean("automaticRetryAllowed",false);w.WriteBoolean("effectMayHaveOccurred",transport.EffectMayHaveOccurred);w.WriteBoolean("taskLaunchAttempted",transport.TaskLaunchAttempted);w.WriteBoolean("taskLaunchConfirmed",transport.TaskLaunchConfirmed);})));return 2;}
    }
    internal static async Task<byte[]> ReadInput(Stream input,CancellationToken cancellation)
    {using var deadline=CancellationTokenSource.CreateLinkedTokenSource(cancellation);deadline.CancelAfter(TimeSpan.FromSeconds(5));using var data=new MemoryStream();var buffer=new byte[4096];while(true){var count=await input.ReadAsync(buffer,deadline.Token);if(count==0)break;ConsentCore.Need(data.Length+count<=IssuerProtocol.MaxFrameBytes,"CLIENT_STDIN_BOUND");data.Write(buffer,0,count);}ConsentCore.Need(data.Length>0,"CLIENT_STDIN_EMPTY");return data.ToArray();}
}
