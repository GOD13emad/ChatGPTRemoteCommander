# PRIVATE QA ONLY: connect to one test-host PID pinned by the owning spawn() fixture.
# This is not a production server root of trust or a ChatGPT conversation grant.
[CmdletBinding()]
param(
 [Parameter(Mandatory)][ValidatePattern('^rc_qa_desk_[a-f0-9]{32}$')][string]$PipeName,
 [Parameter(Mandatory)][ValidateRange(1,2147483647)][int]$ExpectedServerPid,
 [ValidateSet('peer','status')][string]$Command='peer'
)
$ErrorActionPreference='Stop'
if(-not $IsWindows -or [Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0){
 throw 'QA_VERIFIED_CLIENT_NONINTERACTIVE_DENIED'
}
Add-Type -TypeDefinition @'
using System;
using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
public static class RcQaNamedPipeServerIdentity {
 [DllImport("kernel32.dll",SetLastError=true)]
 public static extern bool GetNamedPipeServerProcessId(SafePipeHandle h,out uint pid);
 [DllImport("kernel32.dll",SetLastError=true)]
 public static extern bool GetNamedPipeServerSessionId(SafePipeHandle h,out uint id);
}
'@ -ErrorAction Stop
# Explicitly disallow client impersonation; only current machine, no network address.
$pipe=[IO.Pipes.NamedPipeClientStream]::new('.',$PipeName,[IO.Pipes.PipeDirection]::InOut,
 [IO.Pipes.PipeOptions]::None,[Security.Principal.TokenImpersonationLevel]::None)
try{
 $pipe.Connect(3200)
 [uint32]$serverPid=0
 [uint32]$serverSession=0
 if(-not [RcQaNamedPipeServerIdentity]::GetNamedPipeServerProcessId(
     $pipe.SafePipeHandle,[ref]$serverPid) -or
    -not [RcQaNamedPipeServerIdentity]::GetNamedPipeServerSessionId(
     $pipe.SafePipeHandle,[ref]$serverSession) -or $serverPid -eq 0){
   throw 'QA_PIPE_SERVER_IDENTITY_UNAVAILABLE'
 }
 $selfSession=[Diagnostics.Process]::GetCurrentProcess().SessionId
 # No request is written before exact OS PID+session verification.
 if($serverPid -ne $ExpectedServerPid -or $serverSession -ne $selfSession){
   throw 'QA_PIPE_SERVER_IDENTITY_MISMATCH'
 }
 $writer=[IO.StreamWriter]::new($pipe,[Text.UTF8Encoding]::new($false),1024,$true)
 $reader=[IO.StreamReader]::new($pipe,[Text.UTF8Encoding]::new($false),$false,1024,$true)
 try{
   $writer.AutoFlush=$true
   $writer.WriteLine($Command)
   $task=$reader.ReadLineAsync()
   if(-not $task.Wait(4000)){throw 'QA_PIPE_SERVER_REPLY_TIMEOUT'}
   $line=$task.GetAwaiter().GetResult()
   if(-not $line -or $line.Length -gt 4096){throw 'QA_PIPE_SERVER_REPLY_INVALID'}
   $reply=ConvertFrom-Json -InputObject $line -ErrorAction Stop
   if($reply.ok -ne $true){throw 'QA_PIPE_SERVER_REPLY_DENIED'}
   [ordered]@{
     schema=1
     serverPid=[int]$serverPid
     serverSession=[int]$serverSession
     osPeerVerified=$true
     clientImpersonationDisabled=$true
     command=$Command
     effectMode='observation-only'
   } | ConvertTo-Json -Compress
 }finally{$reader.Dispose();$writer.Dispose()}
}finally{$pipe.Dispose()}
