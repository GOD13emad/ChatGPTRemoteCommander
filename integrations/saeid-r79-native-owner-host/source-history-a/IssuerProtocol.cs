using System.Text.Json;using System.Text.RegularExpressions;using CommanderOwnerConsent;
namespace CommanderNativeIssuer;
internal sealed record Request(string Id,string Action,JsonElement Arguments);
internal static class IssuerProtocol
{
    internal const int MaxFrameBytes=32768;
    internal static Request Parse(byte[] bytes)
    {
        using var d=ConsentCore.Strict(bytes);var e=d.RootElement;ConsentCore.Fields(e,"version","id","action","arguments");ConsentCore.Need(e.GetProperty("version").GetInt32()==1,"IPC_VERSION");var id=ConsentCore.Text(e,"id",36);ConsentCore.Need(Guid.TryParseExact(id,"D",out var g)&&g.ToString("D")==id,"IPC_REQUEST_ID");var action=ConsentCore.Text(e,"action",32);var a=e.GetProperty("arguments");
        switch(action)
        {
            case "authorize":
                var phase=ConsentCore.Text(a,"phase",8);
                if(phase=="begin"){ConsentCore.Fields(a,"phase","request");var r=a.GetProperty("request");ConsentCore.Fields(r,"response_type","client_id","redirect_uri","resource","code_challenge_method","code_challenge","state","grant_policy_id");}
                else{ConsentCore.Need(phase=="complete","IPC_AUTHORIZE_PHASE");ConsentCore.Fields(a,"phase","requestId");ConsentCore.Need(Regex.IsMatch(ConsentCore.Text(a,"requestId",43),"^[A-Za-z0-9_-]{43}$"),"IPC_PENDING_ID");}break;
            case "exchange":ConsentCore.Fields(a,"grant_type","code","client_id","redirect_uri","resource","code_verifier","client_assertion_type","client_assertion");break;
            case "state":case "revoke":ConsentCore.Fields(a,"grantId");ConsentCore.Need(Regex.IsMatch(ConsentCore.Text(a,"grantId",96),"^[a-z][a-z0-9_.:-]{0,95}$"),"IPC_GRANT_ID");break;
            default:throw new ConsentFault("IPC_ACTION_NOT_ALLOWED");
        }
        return new(id,action,a.Clone());
    }
    internal static byte[] Json(Action<Utf8JsonWriter> write){using var m=new MemoryStream();using(var w=new Utf8JsonWriter(m,new(){Encoder=System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping})){w.WriteStartObject();write(w);w.WriteEndObject();}return m.ToArray();}
    internal static byte[] Error(string id,string code)=>Json(w=>{w.WriteNumber("version",1);w.WriteString("id",id);w.WriteBoolean("ok",false);w.WriteString("code",code);w.WriteBoolean("automaticRetryAllowed",false);});
    internal static byte[] Success(string id,Action<Utf8JsonWriter> result)=>Json(w=>{w.WriteNumber("version",1);w.WriteString("id",id);w.WriteBoolean("ok",true);w.WritePropertyName("result");w.WriteStartObject();result(w);w.WriteEndObject();});
}
