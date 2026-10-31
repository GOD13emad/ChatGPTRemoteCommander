// Commander V2 Windows native-messaging binary launcher.
// No GUI, registry writes, profile access, credentials or tool dispatch.
// A browser must register an explicit user-local host + extension origin first.
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

internal static class Program
{
    private static readonly Regex Origin = new(
        @"^chrome-extension://[a-p]{32}/$",
        RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly HashSet<string> Required = new(StringComparer.Ordinal)
        { "schema", "origin", "nodePath", "hostScriptPath", "nodeSha256", "hostScriptSha256" };
    private static readonly Regex Digest = new(
        @"^[a-f0-9]{64}$", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);

    private static int Deny()
    {
        Console.Error.WriteLine("V2_NATIVE_LAUNCHER_DENIED");
        return 2;
    }

    private static async Task<int> Main(string[] args)
    {
        try
        {
            if (args.Length < 1 || args.Length > 2 || !Origin.IsMatch(args[0]) ||
                args[0].Length > 128 ||
                (args.Length == 2 && !Regex.IsMatch(args[1], @"^--parent-window=\d{1,20}$")))
                return Deny();

            string configuration = Path.Combine(AppContext.BaseDirectory, "native-host-config.json");
            if (!File.Exists(configuration) ||
                (File.GetAttributes(configuration) & FileAttributes.ReparsePoint) != 0)
                return Deny();
            using var document = JsonDocument.Parse(File.ReadAllText(configuration));
            var data = document.RootElement;
            if (data.ValueKind != JsonValueKind.Object ||
                data.EnumerateObject().Count() != Required.Count ||
                data.EnumerateObject().Any(x => !Required.Contains(x.Name)) ||
                data.GetProperty("schema").GetInt32() != 2)
                return Deny();

            string origin = data.GetProperty("origin").GetString() ?? "";
            string nodePath = data.GetProperty("nodePath").GetString() ?? "";
            string hostScript = data.GetProperty("hostScriptPath").GetString() ?? "";
            string nodeSha = data.GetProperty("nodeSha256").GetString() ?? "";
            string hostSha = data.GetProperty("hostScriptSha256").GetString() ?? "";
            if (!Origin.IsMatch(origin) || !string.Equals(origin, args[0], StringComparison.Ordinal) ||
                nodePath.Length > 2048 || hostScript.Length > 2048 ||
                !Path.IsPathFullyQualified(nodePath) || !Path.IsPathFullyQualified(hostScript) ||
                !nodePath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ||
                !hostScript.EndsWith(".mjs", StringComparison.OrdinalIgnoreCase) ||
                !File.Exists(nodePath) || !File.Exists(hostScript) ||
                (File.GetAttributes(nodePath) & FileAttributes.ReparsePoint) != 0 ||
                (File.GetAttributes(hostScript) & FileAttributes.ReparsePoint) != 0 ||
                !PinnedFile(nodePath, nodeSha) || !PinnedFile(hostScript, hostSha))
                return Deny();

            var start = new ProcessStartInfo(nodePath)
            {
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                WorkingDirectory = Path.GetDirectoryName(hostScript)!
            };
            start.ArgumentList.Add(hostScript);
            start.ArgumentList.Add(origin);
            start.Environment["RCV2_NATIVE_MESSAGING_ALLOWED_ORIGIN"] = origin;

            using var child = Process.Start(start);
            if (child is null) return Deny();
            var incoming = CopyAndClose(Console.OpenStandardInput(), child.StandardInput.BaseStream);
            var outgoing = child.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
            var errors = child.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
            await Task.WhenAll(incoming, outgoing, errors);
            await child.WaitForExitAsync();
            return child.ExitCode == 0 ? 0 : 1;
        }
        catch
        {
            return Deny();
        }
    }

    // Per-launch integrity guard; not a sandbox against a malicious same-user writer.
    private static bool PinnedFile(string file, string expected)
    {
        if (!Digest.IsMatch(expected)) return false;
        using var input = File.OpenRead(file);
        string actual = Convert.ToHexString(SHA256.HashData(input)).ToLowerInvariant();
        return string.Equals(actual, expected, StringComparison.Ordinal);
    }

    private static async Task CopyAndClose(Stream source, Stream destination)
    {
        try { await source.CopyToAsync(destination); }
        finally { destination.Close(); }
    }
}
