param(
 [ValidateSet("server","client")] [string]$Mode="server",
 [string]$PipeName="",
 [int]$ExpectedServerPid=0
)
$ErrorActionPreference="Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RcmNativePeer {
 [DllImport("kernel32.dll",SetLastError=true)]
 [return:MarshalAs(UnmanagedType.Bool)]
 public static extern bool GetNamedPipeClientProcessId(IntPtr h,out uint pid);
 [DllImport("kernel32.dll",SetLastError=true)]
 [return:MarshalAs(UnmanagedType.Bool)]
 public static extern bool GetNamedPipeServerProcessId(IntPtr h,out uint pid);
}
"@
$options=[System.IO.Pipes.PipeOptions]::CurrentUserOnly -bor [System.IO.Pipes.PipeOptions]::Asynchronous
if($Mode -eq 'client'){
 if($PipeName -notmatch '^rcm-qa-[a-f0-9]{32}$' -or $ExpectedServerPid -le 0){throw 'CLIENT_INPUT_DENIED'}
 $client=[System.IO.Pipes.NamedPipeClientStream]::new('.',$PipeName,[System.IO.Pipes.PipeDirection]::InOut,[System.IO.Pipes.PipeOptions]::CurrentUserOnly)
 try{
   $client.Connect(3000)
   [uint32]$realServerPid=0
   if(-not [RcmNativePeer]::GetNamedPipeServerProcessId($client.SafePipeHandle.DangerousGetHandle(),[ref]$realServerPid)){throw 'SERVER_ID_UNAVAILABLE'}
   if($realServerPid -ne [uint32]$ExpectedServerPid){throw 'SERVER_ID_MISMATCH'}
   $hello=[System.Text.Encoding]::ASCII.GetBytes('HELLO')
   $client.Write($hello,0,5)
   $client.Flush()
   $answer=[byte[]]::new(2);$read=0
   while($read -lt 2){$n=$client.Read($answer,$read,2-$read);if($n -le 0){throw 'SERVER_CLOSE'};$read+=$n}
   if([System.Text.Encoding]::ASCII.GetString($answer) -ne 'OK'){throw 'SERVER_REPLY_INVALID'}
   [Console]::Out.WriteLine('CLIENT_PEER_VERIFIED')
 }finally{$client.Dispose()}
 return
}
$name='rcm-qa-'+[Guid]::NewGuid().ToString('N')
$opts=$options -bor [System.IO.Pipes.PipeOptions]::FirstPipeInstance
$server=[System.IO.Pipes.NamedPipeServerStream]::new($name,[System.IO.Pipes.PipeDirection]::InOut,1,[System.IO.Pipes.PipeTransmissionMode]::Byte,$opts)
$child=$null
try{
 $wait=$server.WaitForConnectionAsync()
 $proc=[System.Diagnostics.ProcessStartInfo]::new()
 $proc.FileName=(Get-Command pwsh -ErrorAction Stop).Source
 $proc.UseShellExecute=$false
 $proc.CreateNoWindow=$true
 $proc.RedirectStandardOutput=$true
 $proc.RedirectStandardError=$true
 foreach($item in @('-NoLogo','-NoProfile','-NonInteractive','-File',$PSCommandPath,'-Mode','client','-PipeName',$name,'-ExpectedServerPid',([string]$PID))){[void]$proc.ArgumentList.Add($item)}
 $child=[System.Diagnostics.Process]::Start($proc)
 if(-not $wait.Wait(4000)){throw 'CONNECTION_TIMEOUT'}
 [uint32]$peerPid=0
 if(-not [RcmNativePeer]::GetNamedPipeClientProcessId($server.SafePipeHandle.DangerousGetHandle(),[ref]$peerPid)){throw 'CLIENT_PID_UNAVAILABLE'}
 if($peerPid -ne [uint32]$child.Id){throw 'CLIENT_PID_MISMATCH'}
 $message=[byte[]]::new(5);$read=0
 while($read -lt 5){$n=$server.Read($message,$read,5-$read);if($n -le 0){throw 'CLIENT_CLOSE'};$read+=$n}
 if([System.Text.Encoding]::ASCII.GetString($message) -ne 'HELLO'){throw 'CLIENT_DATA_INVALID'}
 $reply=[System.Text.Encoding]::ASCII.GetBytes('OK')
 $server.Write($reply,0,2);$server.Flush()
 if(-not $child.WaitForExit(5000)){throw 'CHILD_TIMEOUT'}
 $stdout=$child.StandardOutput.ReadToEnd()
 if($child.ExitCode -ne 0 -or $stdout -notmatch 'CLIENT_PEER_VERIFIED'){throw 'CLIENT_FAILED'}
 [ordered]@{status='PASS_TWO_PROCESS_WINDOWS_NAMED_PIPE_CURRENT_USER_ONLY';peerPidMatchedSpawnedProcess=$true;peerServerPidVerifiedByClient=$true;noTcp=$true;noAdministrator=$true;noPersistentService=$true;childExit=$child.ExitCode}|ConvertTo-Json -Compress
}finally{
 $server.Dispose()
 if($null -ne $child){if(-not $child.HasExited){$child.Kill($true);$child.WaitForExit(1500)};$child.Dispose()}
}