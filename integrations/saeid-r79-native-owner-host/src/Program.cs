using System.Buffers.Binary;using System.IO.Pipes;using System.Text;using System.Text.Json;using CommanderOwnerConsent;
namespace CommanderNativeIssuer;
internal static class Program
{
    internal static async Task<int> Main(string[] args)
    {
        try
        {
            if(args.SequenceEqual(new[]{"--diagnose"}))
            {var s=WindowsGuard.Inspect();Console.WriteLine(Encoding.UTF8.GetString(IssuerProtocol.Json(w=>{w.WriteString("schema","RC_NATIVE_ISSUER_HOST_DIAGNOSTIC_V1");w.WriteBoolean("systemSid",s.Sid=="S-1-5-18");w.WriteBoolean("elevated",s.Elevated);w.WriteBoolean("administrator",s.Administrator);w.WriteNumber("integrityRid",s.IntegrityRid);w.WriteBoolean("sessionZero",s.SessionId==0);w.WriteBoolean("policyOpened",false);w.WriteBoolean("keyOpened",false);w.WriteBoolean("pipeCreated",false);w.WriteBoolean("ownerEnrolled",false);w.WriteBoolean("sourceOnly",true);})));return 0;}
            ConsentCore.Need(args.SequenceEqual(new[]{"--serve-once"}),"HOST_EXACT_MODE_REQUIRED");
            // First privileged precondition. An ordinary process fails here,
            // before any policy/key path access, pipe creation or authority IO.
            HostPolicy.RequireSystem();using var policy=HostPolicy.LoadProtected();
            using var producer=ProtectedIssuerState.OpenProtected();using var exchange=ProtectedOAuthExchange.OpenProtected();using var pipe=PrivatePipe.Create(policy);
            using(var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(60)))await pipe.WaitForConnectionAsync(deadline.Token);
            using var peer=KernelPeer.Capture(pipe,policy);Request? request=null;
            try
            {
                byte[] body;using(var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(5)))body=await ReadFrame(pipe,deadline.Token);
                peer.Revalidate();request=IssuerProtocol.Parse(body);peer.Demand(request.Action);var response=Dispatch(request,producer,exchange);peer.Revalidate();using var replyDeadline=new CancellationTokenSource(TimeSpan.FromSeconds(5));await WriteFrame(pipe,response,replyDeadline.Token);return 0;
            }
            catch(Exception e)
            {
                // No raw arguments, code/token, path or exception text is logged.
                // A dispatched effect is never retried if its reply is lost.
                peer.Revalidate();using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(5));await WriteFrame(pipe,IssuerProtocol.Error(request?.Id??"unparsed",Code(e)),deadline.Token);return 2;
            }
        }
        catch(Exception e){Console.Error.WriteLine(Encoding.UTF8.GetString(IssuerProtocol.Error("host",Code(e))));return 2;}
    }
    private static string Code(Exception e)=>e is ConsentFault?e.Message:e is OperationCanceledException?"HOST_DEADLINE_NO_REPLAY":e is JsonException?"HOST_INVALID_JSON":e is UnauthorizedAccessException?"HOST_ACCESS_DENIED":e is IOException?"HOST_IO_NO_REPLAY":"HOST_UNAVAILABLE_NO_REPLAY";
    internal static async Task<byte[]> ReadFrame(Stream stream,CancellationToken token)
    {var header=new byte[4];await stream.ReadExactlyAsync(header,token);var count=BinaryPrimitives.ReadUInt32LittleEndian(header);ConsentCore.Need(count is >0 and <=IssuerProtocol.MaxFrameBytes,"IPC_FRAME_SIZE");var body=new byte[count];await stream.ReadExactlyAsync(body,token);return body;}
    private static async Task WriteFrame(Stream stream,byte[] bytes,CancellationToken token)
    {ConsentCore.Need(bytes.Length is >0 and <=IssuerProtocol.MaxFrameBytes,"IPC_RESPONSE_SIZE");var header=new byte[4];BinaryPrimitives.WriteUInt32LittleEndian(header,(uint)bytes.Length);await stream.WriteAsync(header,token);await stream.WriteAsync(bytes,token);await stream.FlushAsync(token);}
    private static byte[] Dispatch(Request request,ProtectedIssuerState producer,ProtectedOAuthExchange exchange)
    {
        var a=request.Arguments;
        switch(request.Action)
        {
            case "authorize":
                if(ConsentCore.Text(a,"phase")=="begin")
                {var p=producer.Begin(Encoding.UTF8.GetBytes(a.GetProperty("request").GetRawText()));return IssuerProtocol.Success(request.Id,w=>{w.WriteString("status",p.Status);w.WriteString("requestId",p.RequestId);w.WriteString("requestDigest",p.RequestDigest);w.WriteNumber("expiresAtMs",p.ExpiresAt);w.WriteBoolean("reusedExisting",p.ReusedExisting);w.WriteBoolean("ownerNativeConsentRequired",true);});}
                var c=exchange.AuthorizeAfterNativeConsent(ConsentCore.Text(a,"requestId",43));return IssuerProtocol.Success(request.Id,w=>{w.WriteString("status",c.Status);w.WriteString("requestId",c.RequestId);if(c.Code!=null)w.WriteString("code",c.Code);if(c.State!=null)w.WriteString("state",c.State);if(c.RedirectUri!=null)w.WriteString("redirectUri",c.RedirectUri);w.WriteString("iss",c.Issuer);});
            case "exchange":
                var t=exchange.ExchangeToken(Encoding.UTF8.GetBytes(a.GetRawText()));return IssuerProtocol.Success(request.Id,w=>{w.WriteString("access_token",t.AccessToken);w.WriteString("token_type",t.TokenType);w.WriteNumber("expires_in",t.ExpiresIn);w.WritePropertyName("stateEnvelope");w.WriteRawValue(t.StateEnvelope,false);w.WriteBoolean("refreshTokenIssued",false);});
            case "state":
                var state=exchange.GetFreshGrantState(ConsentCore.Text(a,"grantId",96));return IssuerProtocol.Success(request.Id,w=>{w.WritePropertyName("stateEnvelope");w.WriteRawValue(state,false);});
            case "revoke":
                exchange.RevokeGrant(ConsentCore.Text(a,"grantId",96));return IssuerProtocol.Success(request.Id,w=>w.WriteString("status","REVOKED"));
            default:throw new ConsentFault("IPC_ACTION_NOT_ALLOWED");
        }
    }
}
