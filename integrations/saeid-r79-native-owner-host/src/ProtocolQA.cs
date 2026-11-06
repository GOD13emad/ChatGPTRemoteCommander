using System.Buffers.Binary;using System.Text;using System.Text.Json;using CommanderOwnerConsent;
namespace CommanderNativeIssuer;
internal static class ProtocolQA
{
    private static readonly List<(string Name,bool Pass,string Code)> results=[];
    private const string Id="00000000-0000-4000-8000-000000000001";
    private static byte[] Request(string action,string args,string extra="")=>Encoding.UTF8.GetBytes("{\"version\":1,\"id\":\""+Id+"\",\"action\":\""+action+"\",\"arguments\":"+args+extra+"}");
    private static void Check(string name,Action f){try{f();results.Add((name,true,"PASS"));}catch(Exception e){results.Add((name,false,e is ConsentFault?e.Message:e.GetType().Name));}}
    private static void Deny(Action f){try{f();}catch(ConsentFault){return;}catch(JsonException){return;}throw new Exception("EXPECTED_DENIAL");}
    private static byte[] Frame(uint count,byte[]? body=null){var b=new byte[4+(body?.Length??0)];BinaryPrimitives.WriteUInt32LittleEndian(b,count);body?.CopyTo(b,4);return b;}
    internal static async Task<int> Main()
    {
        Check("authorize begin strict shape only no dispatch",()=>IssuerProtocol.Parse(Request("authorize","{\"phase\":\"begin\",\"request\":{\"response_type\":\"code\",\"client_id\":\"fixture\",\"redirect_uri\":\"fixture\",\"resource\":\"fixture\",\"code_challenge_method\":\"S256\",\"code_challenge\":\"fixture\",\"state\":\"fixture\",\"grant_policy_id\":\"fixture\"}}")));
        Check("authorize complete strict shape only",()=>IssuerProtocol.Parse(Request("authorize","{\"phase\":\"complete\",\"requestId\":\""+new string('A',43)+"\"}")));
        Check("exchange strict shape only no signing",()=>IssuerProtocol.Parse(Request("exchange","{\"grant_type\":\"fixture\",\"code\":\"fixture\",\"client_id\":\"fixture\",\"redirect_uri\":\"fixture\",\"resource\":\"fixture\",\"code_verifier\":\"fixture\",\"client_assertion_type\":\"fixture\",\"client_assertion\":\"fixture\"}")));
        Check("state strict shape only",()=>IssuerProtocol.Parse(Request("state","{\"grantId\":\"grant:fixture\"}")));
        Check("revoke strict shape only no mutation",()=>IssuerProtocol.Parse(Request("revoke","{\"grantId\":\"grant:fixture\"}")));
        Check("arbitrary signing action rejected",()=>Deny(()=>IssuerProtocol.Parse(Request("sign","{}"))));
        Check("shell action rejected",()=>Deny(()=>IssuerProtocol.Parse(Request("run_shell","{}"))));
        Check("top-level SYSTEM assertion rejected",()=>Deny(()=>IssuerProtocol.Parse(Request("state","{\"grantId\":\"grant:fixture\"}",",\"system\":true"))));
        Check("approval field cannot authorize revoke",()=>Deny(()=>IssuerProtocol.Parse(Request("revoke","{\"grantId\":\"grant:fixture\",\"approved\":true}"))));
        Check("caller supplied PID rejected",()=>Deny(()=>IssuerProtocol.Parse(Request("state","{\"grantId\":\"grant:fixture\"}",",\"pid\":4"))));
        Check("duplicate JSON field rejected",()=>Deny(()=>IssuerProtocol.Parse(Request("state","{\"grantId\":\"grant:a\",\"grantId\":\"grant:b\"}"))));
        Check("unsupported protocol version rejected",()=>Deny(()=>IssuerProtocol.Parse(Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(Request("state","{\"grantId\":\"grant:fixture\"}")).Replace("\"version\":1","\"version\":2",StringComparison.Ordinal)))));
        Check("path traversal native request id rejected",()=>Deny(()=>IssuerProtocol.Parse(Request("authorize","{\"phase\":\"complete\",\"requestId\":\"../../policy.json\"}"))));
        Check("unknown nested authorize field rejected",()=>Deny(()=>IssuerProtocol.Parse(Request("authorize","{\"phase\":\"complete\",\"requestId\":\""+new string('A',43)+"\",\"elevated\":true}"))));
        Check("ordinary token cannot satisfy host SYSTEM guard",()=>Deny(HostPolicy.RequireSystem));
        foreach(var pair in new[]{("zero byte frame",0u),("oversized frame",32769u),("huge frame",uint.MaxValue)})
        {try{using var m=new MemoryStream(Frame(pair.Item2));await Program.ReadFrame(m,CancellationToken.None);results.Add((pair.Item1,false,"EXPECTED_DENIAL"));}catch(ConsentFault){results.Add((pair.Item1,true,"PASS"));}}
        try{using var m=new MemoryStream(Frame(3,[1]));await Program.ReadFrame(m,CancellationToken.None);results.Add(("truncated frame",false,"EXPECTED_DENIAL"));}catch(EndOfStreamException){results.Add(("truncated frame",true,"PASS"));}
        try{var b=Request("state","{\"grantId\":\"grant:fixture\"}");using var m=new MemoryStream(Frame((uint)b.Length,b));var copy=await Program.ReadFrame(m,CancellationToken.None);ConsentCore.Need(copy.SequenceEqual(b),"FRAME_COPY");results.Add(("finite valid frame copied exactly",true,"PASS"));}catch(Exception e){results.Add(("finite valid frame copied exactly",false,e.GetType().Name));}
        var report=IssuerProtocol.Json(w=>{w.WriteString("schema","R79_HOST_PROTOCOL_NEGATIVE_QA_V1");w.WriteNumber("pass",results.Count(x=>x.Pass));w.WriteNumber("fail",results.Count(x=>!x.Pass));w.WritePropertyName("cases");w.WriteStartArray();foreach(var r in results){w.WriteStartObject();w.WriteString("name",r.Name);w.WriteBoolean("pass",r.Pass);w.WriteString("code",r.Code);w.WriteEndObject();}w.WriteEndArray();w.WriteBoolean("listenersOpened",false);w.WriteBoolean("keysOpened",false);w.WriteBoolean("peerPositiveProven",false);});Console.WriteLine(Encoding.UTF8.GetString(report));return results.All(x=>x.Pass)?0:1;
    }
}
