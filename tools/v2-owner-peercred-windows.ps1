# Commander V2 source-only Windows native owner IPC QA.
# A bounded private same-user pipe test. Does not install a service, elevate,
# authenticate a ChatGPT account, or grant access to any V1 action.
param([switch]$SelfTest, [switch]$NegativeSidCheck)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or -not $SelfTest) { throw 'CMDV2_OWNER_PIPE_QA_ONLY' }
if ($NegativeSidCheck -and -not $SelfTest) { throw 'CMDV2_OWNER_PIPE_QA_ONLY' }

$name = 'CommanderV2-NativeOwnerQA-' + [Guid]::NewGuid().ToString('N')
$flags = [IO.Pipes.PipeOptions]::CurrentUserOnly -bor [IO.Pipes.PipeOptions]::Asynchronous
$server = $null
$client = $null
try {
    $server = [IO.Pipes.NamedPipeServerStream]::new(
        $name, [IO.Pipes.PipeDirection]::InOut, 1,
        [IO.Pipes.PipeTransmissionMode]::Byte, $flags)
    $client = [IO.Pipes.NamedPipeClientStream]::new(
        '.', $name, [IO.Pipes.PipeDirection]::InOut,
        [IO.Pipes.PipeOptions]::Asynchronous,
        [Security.Principal.TokenImpersonationLevel]::Impersonation)

    $connected = [Threading.Tasks.Task]::WaitAll(
        [Threading.Tasks.Task[]]@($server.WaitForConnectionAsync(), $client.ConnectAsync(3000)), 4000)
    if (-not $connected -or -not $server.IsConnected -or -not $client.IsConnected) {
        throw 'CMDV2_OWNER_PIPE_CONNECT_TIMEOUT'
    }
    $send = [byte[]]@(41)
    $received = [byte[]]::new(1)
    $written = $client.WriteAsync($send, 0, 1)
    $read = $server.ReadAsync($received, 0, 1)
    if (-not [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($written, $read), 4000) -or
        $read.Result -ne 1 -or $received[0] -ne 41) {
        throw 'CMDV2_OWNER_PIPE_HANDSHAKE_INVALID'
    }

    # Impersonation user name is evaluated only after the client writes.
    # Windows returns a short NTAccount alias on some domain-joined systems.
    # Compare canonical security identifiers, never string account names.
    $clientAccount = $server.GetImpersonationUserName()
    if ([string]::IsNullOrWhiteSpace($clientAccount)) {
        throw 'CMDV2_OWNER_PIPE_CLIENT_IDENTITY_MISSING'
    }
    $clientSid = ([Security.Principal.NTAccount]::new($clientAccount)).Translate(
        [Security.Principal.SecurityIdentifier]).Value
    $ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if ($NegativeSidCheck) { $ownerSid = 'S-1-0-0' }
    $sidMatched = [string]::Equals($clientSid, $ownerSid, [StringComparison]::Ordinal)
    if ($NegativeSidCheck) {
        if ($sidMatched) { throw 'CMDV2_OWNER_PIPE_NEGATIVE_TEST_FAILED' }
        [pscustomobject]@{
            gate = 'CMDV2_WIN_OWNER_SID_MISMATCH_DENIED_QA_PASS'
            syntheticExpectedSidMismatch = $true
            crossUserClientActuallyTested = $false
            mcpAuthorized = $false
            installed = $false
        } | ConvertTo-Json -Compress
    } else {
        if (-not $sidMatched) { throw 'CMDV2_OWNER_PIPE_SID_MISMATCH' }
        [pscustomobject]@{
            gate = 'CMDV2_WIN_NATIVE_OWNER_PIPE_QA_PASS'
            currentUserOnly = $true
            actualConnectedOwnerSidMatches = $true
            syntheticGrant = $false
            chatAccountAuthenticated = $false
            mcpAuthorized = $false
            installed = $false
            adminGranted = $false
        } | ConvertTo-Json -Compress
    }
} finally {
    if ($client) { $client.Dispose() }
    if ($server) { $server.Dispose() }
}
