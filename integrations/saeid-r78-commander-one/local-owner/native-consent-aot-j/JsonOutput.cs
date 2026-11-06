using System.Text.Json;
namespace CommanderOwnerConsent;
internal static class JsonOutput
{
    private static byte[] Write(Action<Utf8JsonWriter> action){using var m=new MemoryStream();using(var w=new Utf8JsonWriter(m)){w.WriteStartObject();action(w);w.WriteEndObject();}return m.ToArray();}
    internal static byte[] Error(string code)=>Write(w=>{w.WriteString("status","DENIED");w.WriteString("code",code);w.WriteBoolean("automaticRetryAllowed",false);});
    internal static byte[] Diagnostic(WindowsGuard.TokenState s)=>Write(w=>{w.WriteString("schema","RC_OWNER_TOKEN_DIAGNOSTIC_V1");w.WriteBoolean("Elevated",s.Elevated);w.WriteNumber("ElevationType",s.ElevationType);w.WriteBoolean("Administrator",s.Administrator);w.WriteNumber("IntegrityRid",s.IntegrityRid);w.WriteBoolean("interactiveSession",s.SessionId>0);w.WriteBoolean("ownerEnrolled",false);w.WriteBoolean("consentShown",false);w.WriteNumber("receiptsSigned",0);});
    internal static byte[] Intent(ApprovedRequest r)=>Write(w=>{w.WriteString("schema","RC_OWNER_INTENT_V1");w.WriteString("requestId",r.RequestId);w.WriteString("requestDigest",r.RequestDigest);w.WriteNumber("createdAt",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());w.WriteString("state","CONSENT_ATTEMPT_CONSUMED_NO_REPLAY");});
    internal static byte[] Denied(ApprovedRequest r)=>Write(w=>{w.WriteString("status","OWNER_DENIED_OR_TIMEOUT");w.WriteString("requestId",r.RequestId);w.WriteString("requestDigest",r.RequestDigest);w.WriteBoolean("automaticRetryAllowed",false);});
    internal static byte[] Envelope(byte[] statement,byte[] signature)=>Write(w=>{w.WritePropertyName("statement");w.WriteRawValue(statement,false);w.WriteString("signature",ConsentCore.B64(signature));});
}
