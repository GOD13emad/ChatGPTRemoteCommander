using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
namespace CommanderOwnerConsent;
internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            // Read-only diagnostic performs no authority-file access, no native
            // consent, no enrollment and no key generation/signing.
            if(args.SequenceEqual(new[]{"--diagnose"}))
            {Console.WriteLine(Encoding.UTF8.GetString(JsonOutput.Diagnostic(WindowsGuard.Inspect())));return 0;}
            ConsentCore.Need(args.Length==2&&args[0]=="--request"&&System.Text.RegularExpressions.Regex.IsMatch(args[1],"^[A-Za-z0-9_-]{43}$"),"EXACT_REQUEST_ID_REQUIRED");
            Run(args[1]);return 0;
        }
        catch(Exception e){var code=e is ConsentFault?e.Message:e is IOException?"PROTECTED_IO_OR_CONSUMED_REQUEST":e is UnauthorizedAccessException?"PROTECTED_ACCESS_DENIED":e is JsonException?"INVALID_JSON":"CONSENT_UNAVAILABLE";Console.Error.WriteLine(Encoding.UTF8.GetString(JsonOutput.Error(code)));return 2;}
    }
    private static void Run(string requestId)
    {
        var token=WindowsGuard.Inspect();ConsentCore.Need(token.Elevated&&token.ElevationType==2&&token.Administrator&&token.IntegrityRid>=12288&&token.SessionId>0,"REAL_UAC_REQUIRED");
        var programRoot=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"ChatGPTRemoteCommander","owner-auth");
        var stateRoot=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"ChatGPTRemoteCommander","owner-auth");
        // The installation path and every authority-bearing child must be
        // administrator/SYSTEM controlled. This executable never repairs ACLs.
        WindowsGuard.Protected(programRoot,true);WindowsGuard.Protected(stateRoot,true);
        foreach(var part in new[]{"pending","events","receipts"})WindowsGuard.Protected(Path.Combine(stateRoot,part),true);
        using var policyFile=WindowsGuard.OpenProtected(Path.Combine(stateRoot,"policy.json"),32768);
        var policyRaw=WindowsGuard.Read(policyFile);using var p=ConsentCore.Strict(policyRaw);var policy=p.RootElement;ConsentCore.ValidatePolicy(policy);
        WindowsGuard.RequireOwner(token,ConsentCore.Text(policy,"ownerSid"));
        var image=Environment.ProcessPath??"";var expectedImage=Path.Combine(programRoot,"CommanderOwnerConsent.exe");
        ConsentCore.Need(string.Equals(Path.GetFullPath(image),Path.GetFullPath(expectedImage),StringComparison.OrdinalIgnoreCase)&&string.Equals(AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar),programRoot,StringComparison.OrdinalIgnoreCase),"PROTECTED_IMAGE_PATH_REQUIRED");
        using var imageFile=WindowsGuard.OpenProtected(image,128*1024*1024);
        ConsentCore.Need(Convert.ToHexString(SHA256.HashData(imageFile)).ToLowerInvariant()==ConsentCore.Text(policy,"helperSha256"),"HELPER_IMAGE_PIN");
        using var pending=WindowsGuard.OpenProtected(Path.Combine(stateRoot,"pending",requestId+".json"),32768);
        var raw=WindowsGuard.Read(pending);var request=ConsentCore.ValidatePending(raw,policy,requestId,DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        // Durable consume-before-UI. A crash/cancel/timeout keeps this marker.
        // It requires explicit protected reconciliation, never a silent rerun.
        using(var intent=ConsentPrivateFile.Create(Path.Combine(stateRoot,"events",requestId+".intent")))
        {var b=JsonOutput.Intent(request);intent.Write(b);intent.Flush(true);}
        if(!Show(request)) {WriteResult(stateRoot,requestId,JsonOutput.Denied(request));return;}
        // No caller-supplied statement. Reread the held immutable transaction
        // and enrollment before opening a key or producing one exact receipt.
        ConsentCore.Need(WindowsGuard.Read(pending).SequenceEqual(raw)&&WindowsGuard.Read(policyFile).SequenceEqual(policyRaw),"PROTECTED_INPUT_CHANGED");
        WindowsGuard.RequireOwner(WindowsGuard.Inspect(),ConsentCore.Text(policy,"ownerSid"));
        var fresh=ConsentCore.ValidatePending(raw,policy,requestId,DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        using var keyFile=WindowsGuard.OpenProtected(Path.Combine(stateRoot,"consent-key.pk8"),4096,true);var keyBytes=WindowsGuard.Read(keyFile);
        try
        {
            using var key=ECDsa.Create();key.ImportPkcs8PrivateKey(keyBytes,out var read);ConsentCore.Need(read==keyBytes.Length&&key.KeySize==256&&key.ExportParameters(false).Curve.Oid.Value=="1.2.840.10045.3.1.7","CONSENT_KEY_ALGORITHM");
            ConsentCore.Need(Convert.ToHexString(SHA256.HashData(key.ExportSubjectPublicKeyInfo())).ToLowerInvariant()==ConsentCore.Text(policy,"signingPublicKeySpkiSha256"),"CONSENT_KEY_PIN");
            var statement=ConsentCore.Statement(fresh,DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),ConsentCore.B64(RandomNumberGenerator.GetBytes(32)));
            var prefix=Encoding.UTF8.GetBytes("RC_OWNER_OAUTH_CONSENT_V1\n");var message=prefix.Concat(statement).ToArray();
            var signature=key.SignData(message,HashAlgorithmName.SHA256,DSASignatureFormat.Rfc3279DerSequence);
            using var s=JsonDocument.Parse(statement);WriteResult(stateRoot,requestId,JsonOutput.Envelope(statement,signature));
        }
        finally{CryptographicOperations.ZeroMemory(keyBytes);}
    }
    private static void WriteResult(string root,string requestId,byte[] bytes)
    {using var f=ConsentPrivateFile.Create(Path.Combine(root,"receipts",requestId+".json"));f.Write(bytes);f.Flush(true);}
    private static bool Show(ApprovedRequest r)=>NativeDialog.Show(r);
}
