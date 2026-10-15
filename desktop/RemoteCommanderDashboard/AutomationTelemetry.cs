using System;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;
namespace RemoteCommander;

// Owner-private read-only status. No invocation of a provider or Work service.
internal sealed record AutomationReadout(string Automation, string LocalAI, string WorkCredits, bool Verified)
{
    internal static AutomationReadout Unknown => new("UNVERIFIED","UNVERIFIED","UNVERIFIED",false);
}
internal static class AutomationTelemetry
{
    private static bool PrivateRoot(string directory)
    {
        var info = new DirectoryInfo(directory);
        if (!info.Exists || info.Attributes.HasFlag(FileAttributes.ReparsePoint)) return false;
        var acl = info.GetAccessControl();
        var current = WindowsIdentity.GetCurrent().User;
        if (current == null || !acl.AreAccessRulesProtected ||
            acl.GetOwner(typeof(SecurityIdentifier)) is not SecurityIdentifier owner ||
            owner != current) return false;
        foreach (FileSystemAccessRule rule in acl.GetAccessRules(true, false, typeof(SecurityIdentifier)))
        {
            if (rule.AccessControlType != AccessControlType.Allow) continue;
            if (rule.IdentityReference is not SecurityIdentifier sid ||
                (sid != current && !sid.IsWellKnown(WellKnownSidType.LocalSystemSid) &&
                !sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid))) return false;
        }
        return true;
    }
    private static JsonDocument ReadPrivate(string path, int limit)
    {
        var file = new FileInfo(path);
        if (!file.Exists || file.Attributes.HasFlag(FileAttributes.ReparsePoint) ||
            file.Length < 2 || file.Length > limit) throw new IOException("UNVERIFIED_PRIVATE_FILE");
        var acl = file.GetAccessControl();
        var current = WindowsIdentity.GetCurrent().User;
        if (current is null ||
            acl.GetOwner(typeof(SecurityIdentifier)) is not SecurityIdentifier owner ||
            owner != current) throw new IOException("UNVERIFIED_FILE_OWNER");
        foreach (FileSystemAccessRule rule in acl.GetAccessRules(true, true, typeof(SecurityIdentifier)))
        {
            if (rule.AccessControlType != AccessControlType.Allow) continue;
            if (rule.IdentityReference is not SecurityIdentifier sid ||
                (sid != current && !sid.IsWellKnown(WellKnownSidType.LocalSystemSid) &&
                 !sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid)))
                throw new IOException("UNTRUSTED_FILE_ACL");
        }
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
        using var buffer = new MemoryStream();
        var chunk = new byte[2048];
        int n;
        while ((n = stream.Read(chunk, 0, Math.Min(chunk.Length, limit + 1 - (int)buffer.Length))) != 0)
        {
            buffer.Write(chunk, 0, n);
            if (buffer.Length > limit) throw new IOException("SNAPSHOT_TOO_LARGE");
        }
        return JsonDocument.Parse(buffer.ToArray());
    }
    private static bool Exact(JsonElement obj, params string[] names)
    {
        if (obj.ValueKind != JsonValueKind.Object) return false;
        var keys = obj.EnumerateObject().Select(p => p.Name).ToArray();
        return keys.Length == names.Length && keys.Distinct(StringComparer.Ordinal).Count() == keys.Length &&
               names.All(x => keys.Contains(x,StringComparer.Ordinal));
    }
    private static bool Choice(JsonElement e, string key, params string[] allowed) =>
        e.TryGetProperty(key,out var v) && v.ValueKind == JsonValueKind.String &&
        allowed.Contains(v.GetString(),StringComparer.Ordinal);
    private static bool Fresh(JsonElement e, out long t)
    {
        t=0;
        if (!e.TryGetProperty("observedAtEpochMs", out var observed) || !observed.TryGetInt64(out t) ||
            !e.TryGetProperty("expiresAtEpochMs",out var expiry) || !expiry.TryGetInt64(out var end))
            return false;
        var now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        return t>0 && end>=t && end-t<=30000 && t<=now && now<end;
    }
    internal static AutomationReadout Read(string stateRoot)
    {
        if (!OperatingSystem.IsWindows()) return AutomationReadout.Unknown;
        try
        {
            var dir=Path.Combine(stateRoot,"browser-companion");
            if (!PrivateRoot(dir)) return AutomationReadout.Unknown;
            using var monitor=ReadPrivate(Path.Combine(dir,"commander-monitor.json"),16384);
            using var automation=ReadPrivate(Path.Combine(dir,"commander-automation.json"),4096);
            var m=monitor.RootElement; var a=automation.RootElement;
            if (!Choice(m,"kind","COMMANDER_LIVE_MONITOR") ||
                !Exact(m,"schema","kind","observedAtEpochMs","expiresAtEpochMs",
                          "identity","gui","browser","workflows","extensions","operations") ||
                !m.TryGetProperty("schema",out var baseSchema) || baseSchema.GetInt32()!=1 ||
                !Choice(a,"kind","COMMANDER_AUTOMATION_MONITOR") ||
                !Exact(a,"schema","kind","observedAtEpochMs","expiresAtEpochMs","configSha256","automation") ||
                !a.TryGetProperty("schema",out var schema) || schema.GetInt32()!=1 ||
                !Fresh(m,out var mtime) || !Fresh(a,out var atime) ||
                Math.Abs(mtime-atime)>10000 ||
                !m.TryGetProperty("identity",out var identity) ||
                !identity.TryGetProperty("configSha256",out var mh) || mh.ValueKind!=JsonValueKind.String ||
                !a.TryGetProperty("configSha256",out var ah) || ah.ValueKind!=JsonValueKind.String)
                return AutomationReadout.Unknown;
            var key=mh.GetString() ?? "";
            if (key.Length!=64 || key.Any(c => !(c is >= '0' and <= '9' or >= 'a' and <= 'f')) ||
                key!=ah.GetString()) return AutomationReadout.Unknown;
            var state=a.GetProperty("automation");
            if (!Exact(state,"runnerConfigured","automaticExecution","localModel","workCredits","creditUsage") ||
                !state.TryGetProperty("runnerConfigured",out var configured) ||
                !state.TryGetProperty("automaticExecution",out var automatic) ||
                (configured.ValueKind!=JsonValueKind.True && configured.ValueKind!=JsonValueKind.False) ||
                (automatic.ValueKind!=JsonValueKind.True && automatic.ValueKind!=JsonValueKind.False) ||
                !Choice(state,"localModel","UNVERIFIED","NOT_ATTACHED","PROPOSAL_ONLY") ||
                !Choice(state,"workCredits","DENY_IN_CORE","UNVERIFIED") ||
                !Choice(state,"creditUsage","UNVERIFIED") ||
                (automatic.GetBoolean() && !configured.GetBoolean()))
                return AutomationReadout.Unknown;
            var status=!configured.GetBoolean()?"NOT_CONFIGURED":
                        automatic.GetBoolean()?"READ_ONLY_AUTO":"MANUAL_ONLY";
            return new AutomationReadout(status,state.GetProperty("localModel").GetString()!,
                state.GetProperty("workCredits").GetString()!,true);
        }
        catch { return AutomationReadout.Unknown; }
    }
}
