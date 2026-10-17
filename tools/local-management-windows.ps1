param([ValidateSet("relay","client")][string]$Mode)
# Opt-in QA-only native transport: no installation, service, TCP or shell bridge.
# Parent Core owns all workflow effects. The relay only authenticates the local
# peer and forwards one bounded MAC-protected control frame and its receipt.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $Mode -notin @('relay','client')) { throw 'MANAGEMENT_EXPLICIT_WINDOWS_MODE_REQUIRED' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RcmPipePeer {
  [DllImport("kernel32.dll",SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetNamedPipeClientProcessId(IntPtr h,out uint pid);
  [DllImport("kernel32.dll",SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetNamedPipeServerProcessId(IntPtr h,out uint pid);
}
'@
function Fail([string]$Code) { throw $Code }
function ValidInt($n,[long]$min,[long]$max) {
  return ($null -ne $n -and $n -isnot [bool] -and
    $n -is [ValueType] -and [long]$n -ge $min -and [long]$n -le $max -and
    ([double]$n -eq [long]$n))
}
function StrictJson([string]$raw) {
  if ($null -eq $raw -or [Text.Encoding]::UTF8.GetByteCount($raw) -gt 65536) { Fail 'MANAGEMENT_FRAME_LIMIT' }
  $doc = [System.Text.Json.JsonDocument]::Parse($raw)
  try {
    function Visit($e) {
      if ($e.ValueKind -eq [System.Text.Json.JsonValueKind]::Object) {
        $names = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($prop in $e.EnumerateObject()) {
          if (-not $names.Add($prop.Name)) { Fail 'MANAGEMENT_DUPLICATE_KEY' }
          Visit $prop.Value
        }
      } elseif ($e.ValueKind -eq [System.Text.Json.JsonValueKind]::Array) {
        foreach ($item in $e.EnumerateArray()) { Visit $item }
      }
    }
    Visit $doc.RootElement
  } finally { $doc.Dispose() }
  return ConvertFrom-Json -InputObject $raw -AsHashtable -Depth 24
}
function Shape($obj,[string[]]$fields) {
  if ($null -eq $obj -or $obj -isnot [System.Collections.IDictionary] -or
      $obj.Count -ne $fields.Count) { Fail 'MANAGEMENT_SCHEMA' }
  foreach ($key in $fields) { if (-not $obj.Contains($key)) { Fail 'MANAGEMENT_SCHEMA' } }
}
function ReadParent() {
  $raw = [Console]::In.ReadLine()
  if ($null -eq $raw) { Fail 'MANAGEMENT_PARENT_CLOSED' }
  return StrictJson $raw
}
function SendParent($obj) {
  $raw = ConvertTo-Json -InputObject $obj -Compress -Depth 24
  if ([Text.Encoding]::UTF8.GetByteCount($raw) -gt 32768) { Fail 'MANAGEMENT_PARENT_LIMIT' }
  [Console]::Out.WriteLine($raw)
  [Console]::Out.Flush()
}
function ReadPipe($stream,[int]$limit,[int]$timeoutMs) {
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $bytes = [System.Collections.Generic.List[byte]]::new()
  $buf = [byte[]]::new(1)
  while ($bytes.Count -lt $limit) {
    $remain = $timeoutMs - [int]$clock.ElapsedMilliseconds
    if ($remain -le 0) { Fail 'MANAGEMENT_TRANSPORT_TIMEOUT' }
    $cts = [Threading.CancellationTokenSource]::new()
    try {
      $cts.CancelAfter($remain)
      $n = $stream.ReadAsync($buf,0,1,$cts.Token).GetAwaiter().GetResult()
    } catch {
      Fail 'MANAGEMENT_TRANSPORT_TIMEOUT'
    } finally { $cts.Dispose() }
    if ($n -ne 1) { Fail 'MANAGEMENT_CHANNEL_CLOSED' }
    if ($buf[0] -eq 10) {
      return [Text.UTF8Encoding]::new($false,$true).GetString($bytes.ToArray())
    }
    $bytes.Add($buf[0])
  }
  Fail 'MANAGEMENT_FRAME_LIMIT'
}
function WritePipe($stream,$obj,[int]$limit) {
  $raw=ConvertTo-Json -InputObject $obj -Compress -Depth 24
  $b=[Text.Encoding]::UTF8.GetBytes($raw + "`n")
  if ($b.Length -gt $limit) { Fail 'MANAGEMENT_FRAME_LIMIT' }
  $stream.Write($b,0,$b.Length)
  $stream.Flush()
}
function CanonicalTarget($target) {
  Shape $target @('deviceId','profileId','configSha256','routeGeneration')
  foreach ($key in @('deviceId','profileId')) {
    if ($target[$key] -isnot [string] -or $target[$key] -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') { Fail 'MANAGEMENT_TARGET' }
  }
  if ($target['configSha256'] -isnot [string] -or $target['configSha256'] -cnotmatch '^[a-f0-9]{64}$' -or
      -not (ValidInt $target['routeGeneration'] 1 999999999)) { Fail 'MANAGEMENT_TARGET' }
  return [ordered]@{deviceId=$target['deviceId'];profileId=$target['profileId'];configSha256=$target['configSha256'];routeGeneration=[long]$target['routeGeneration']}
}
function CurrentUserOnlyOptions() {
  return [IO.Pipes.PipeOptions]::CurrentUserOnly -bor [IO.Pipes.PipeOptions]::Asynchronous
}
$server=$null
$client=$null
try {
  if ($Mode -eq 'relay') {
    $init=ReadParent
    Shape $init @('schema','pipeName','expectedClientPid','sessionMs','idleMs','maxRequests')
    if (-not (ValidInt $init.schema 1 1) -or
        $init.pipeName -isnot [string] -or $init.pipeName -cnotmatch '^rcm-native-[a-f0-9]{32}$' -or
        -not (ValidInt $init.expectedClientPid 1 2147483647) -or
        -not (ValidInt $init.sessionMs 100 300000) -or
        -not (ValidInt $init.idleMs 100 30000) -or
        -not (ValidInt $init.maxRequests 1 1)) { Fail 'MANAGEMENT_INIT_UNVERIFIED' }
    $opts=CurrentUserOnlyOptions
    $opts=$opts -bor [IO.Pipes.PipeOptions]::FirstPipeInstance
    $server=[IO.Pipes.NamedPipeServerStream]::new($init.pipeName,[IO.Pipes.PipeDirection]::InOut,1,[IO.Pipes.PipeTransmissionMode]::Byte,$opts)
    SendParent ([ordered]@{type='ready';pipeName=$init.pipeName;pid=$PID})
    $wait=$server.WaitForConnectionAsync()
    if (-not $wait.Wait([int]$init.idleMs)) { Fail 'MANAGEMENT_PEER_TIMEOUT' }
    [uint32]$actualClientPid=0
    if (-not [RcmPipePeer]::GetNamedPipeClientProcessId($server.SafePipeHandle.DangerousGetHandle(),[ref]$actualClientPid)) { Fail 'MANAGEMENT_PEER_CREDENTIALS' }
    if ($actualClientPid -ne [uint32]$init.expectedClientPid) { Fail 'MANAGEMENT_PEER_DENIED' }
    SendParent ([ordered]@{type='peer';pid=[long]$actualClientPid})
    $boot=ReadParent
    Shape $boot @('type','bootstrap')
    if ($boot.type -cne 'bootstrap') { Fail 'MANAGEMENT_PARENT_PROTOCOL' }
    WritePipe $server $boot.bootstrap 4096
    $wire=ReadPipe $server 8192 ([int]$init.idleMs)
    SendParent ([ordered]@{type='request';sequence=1;wire=$wire})
    $result=ReadParent
    if ($result.type -ceq 'close') { Fail 'MANAGEMENT_SESSION_REVOKED' }
    Shape $result @('type','sequence','receipt')
    if ($result.type -cne 'result' -or -not (ValidInt $result.sequence 1 1)) { Fail 'MANAGEMENT_PARENT_PROTOCOL' }
    WritePipe $server $result.receipt 8192
    $server.WaitForPipeDrain()
  } else {
    $desc=ReadParent
    Shape $desc @('pipeName','serverPid','target','commands')
    if ($desc.pipeName -isnot [string] -or $desc.pipeName -cnotmatch '^rcm-native-[a-f0-9]{32}$' -or
        -not (ValidInt $desc.serverPid 1 2147483647)) { Fail 'MANAGEMENT_CLIENT_DESCRIPTOR' }
    $target=CanonicalTarget $desc.target
    if ($desc.commands -isnot [array] -or $desc.commands.Count -ne 1) { Fail 'MANAGEMENT_ONE_ACTION_ONLY' }
    $client=[IO.Pipes.NamedPipeClientStream]::new('.',$desc.pipeName,[IO.Pipes.PipeDirection]::InOut,(CurrentUserOnlyOptions))
    $client.Connect(4000)
    [uint32]$actualServerPid=0
    if (-not [RcmPipePeer]::GetNamedPipeServerProcessId($client.SafePipeHandle.DangerousGetHandle(),[ref]$actualServerPid)) { Fail 'MANAGEMENT_PEER_CREDENTIALS' }
    if ($actualServerPid -ne [uint32]$desc.serverPid) { Fail 'MANAGEMENT_SERVER_PID_MISMATCH' }
    $bootstrap=StrictJson (ReadPipe $client 4096 5000)
    Shape $bootstrap @('schema','session','keyHex')
    Shape $bootstrap.session @('schema','sessionId','target','actions','authentication')
    if (-not (ValidInt $bootstrap.schema 1 1) -or -not (ValidInt $bootstrap.session.schema 1 1) -or
        $bootstrap.session.sessionId -isnot [string] -or $bootstrap.session.sessionId -cnotmatch '^[a-f0-9]{64}$' -or
        $bootstrap.keyHex -isnot [string] -or $bootstrap.keyHex -cnotmatch '^[a-f0-9]{64}$' -or
        $bootstrap.session.authentication -cne 'WINDOWS_NAMED_PIPE_CURRENT_USER_ONLY_PID' -or
        ($bootstrap.session.actions -join ',') -cne 'workflow.pause,workflow.cancel') { Fail 'MANAGEMENT_BOOTSTRAP_INVALID' }
    if ((ConvertTo-Json (CanonicalTarget $bootstrap.session.target) -Compress) -cne
        (ConvertTo-Json $target -Compress)) { Fail 'MANAGEMENT_BOOTSTRAP_TARGET' }
    $cmd=$desc.commands[0]
    Shape $cmd @('action','workflowId','revision','requestId')
    if ($cmd.action -cnotin @('workflow.pause','workflow.cancel') -or
        $cmd.workflowId -isnot [string] -or $cmd.workflowId -cnotmatch '^[a-z][a-z0-9_-]{0,63}$' -or
        -not (ValidInt $cmd.revision 1 10000) -or
        $cmd.requestId -isnot [string] -or $cmd.requestId -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') { Fail 'MANAGEMENT_ACTION_DENIED' }
    $now=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $payload=[ordered]@{schema=1;sessionId=$bootstrap.session.sessionId;target=$target;
      requestId=$cmd.requestId;action=$cmd.action;workflowId=$cmd.workflowId;
      expectedRevision=[long]$cmd.revision;issuedAtEpochMs=$now;expiresAtEpochMs=$now+10000}
    $key=[Convert]::FromHexString($bootstrap.keyHex)
    $macObj=[Security.Cryptography.HMACSHA256]::new($key)
    try { $tag=[Convert]::ToHexString($macObj.ComputeHash([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $payload -Compress -Depth 24)))).ToLowerInvariant() }
    finally { $macObj.Dispose();[Array]::Clear($key,0,$key.Length) }
    WritePipe $client ([ordered]@{payload=$payload;mac=$tag}) 8192
    $receipt=StrictJson (ReadPipe $client 8192 5000)
    Shape $receipt (@('schema','requestId','action','workflowId','target','expectedRevision','state','code','newRevision') + $(if ($receipt.state -ceq 'APPLIED') { @('controlIntent') } else { @() }))
    if (-not (ValidInt $receipt.schema 1 1) -or $receipt.requestId -cne $cmd.requestId -or
        $receipt.action -cne $cmd.action -or $receipt.workflowId -cne $cmd.workflowId -or
        -not (ValidInt $receipt.expectedRevision ([long]$cmd.revision) ([long]$cmd.revision)) -or
        (ConvertTo-Json (CanonicalTarget $receipt.target) -Compress) -cne (ConvertTo-Json $target -Compress)) { Fail 'MANAGEMENT_RECEIPT_IDENTITY' }
    if ($receipt.state -ceq 'APPLIED' -and
        ($receipt.code -cne 'MANAGEMENT_CONTROL_READBACK_VERIFIED' -or
         -not (ValidInt $receipt.newRevision ([long]$cmd.revision+1) ([long]$cmd.revision+1)) -or
         $receipt.controlIntent -cne $(if($cmd.action -eq 'workflow.pause'){'PAUSED'}else{'CANCELLED'}))) { Fail 'MANAGEMENT_RECEIPT_UNVERIFIED' }
    if ($receipt.state -cnotin @('APPLIED','REJECTED','UNCERTAIN')) { Fail 'MANAGEMENT_RECEIPT_UNVERIFIED' }
    SendParent ([ordered]@{state=$receipt.state;code=$receipt.code;newRevision=$receipt.newRevision;
      peerVerified=$true;requestedAction=$cmd.action})
  }
} catch {
  # No raw exception text, paths, frame, credentials, operation args or tokens.
  [Console]::Error.WriteLine('MANAGEMENT_NATIVE_TRANSPORT_FAILED')
  exit 2
} finally {
  if ($null -ne $client) { $client.Dispose() }
  if ($null -ne $server) { $server.Dispose() }
}
