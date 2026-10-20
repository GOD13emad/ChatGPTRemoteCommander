# Win32 kernel-backed, source-only IPC surface test. Never an owner authorization broker.
param(
  [string]$ClientSid = 'S-1-5-21-111111111-222222222-333333333-1001',
  [switch]$UnsafeClientRights
)
$ErrorActionPreference='Stop'
if(-not $IsWindows) {throw 'WINDOWS_ONLY'}
$serverId=[Security.Principal.WindowsIdentity]::GetCurrent()
$serverSid=$serverId.User
if(-not $serverSid){throw 'OS_SERVER_SID_UNAVAILABLE'}
try {$client=[Security.Principal.SecurityIdentifier]::new($ClientSid)}catch{throw 'INVALID_CLIENT_SID'}
if($client.Value -eq $serverSid.Value){throw 'SAME_OS_PRINCIPAL_REJECTED'}
if($client.Value -in @('S-1-1-0','S-1-5-11','S-1-5-32-545','S-1-5-7')){throw 'BROAD_OR_ANONYMOUS_CLIENT_REJECTED'}
$clientRights=[System.IO.Pipes.PipeAccessRights]::ReadData -bor
 [System.IO.Pipes.PipeAccessRights]::WriteData -bor
 [System.IO.Pipes.PipeAccessRights]::ReadAttributes -bor
 [System.IO.Pipes.PipeAccessRights]::Synchronize
if($UnsafeClientRights){$clientRights=[System.IO.Pipes.PipeAccessRights]::FullControl}
$unsafeBits=[System.IO.Pipes.PipeAccessRights]::CreateNewInstance -bor
 [System.IO.Pipes.PipeAccessRights]::ChangePermissions -bor
 [System.IO.Pipes.PipeAccessRights]::TakeOwnership -bor
 [System.IO.Pipes.PipeAccessRights]::Delete
if(([int]$clientRights -band [int]$unsafeBits) -ne 0){throw 'CLIENT_INSTANCE_OR_ADMIN_RIGHTS_REJECTED'}
$sd=[System.IO.Pipes.PipeSecurity]::new()
$sd.SetAccessRuleProtection($true,$false)
$sd.SetOwner($serverSid)
$sd.AddAccessRule([System.IO.Pipes.PipeAccessRule]::new(
 $serverSid,[System.IO.Pipes.PipeAccessRights]::FullControl,
 [System.Security.AccessControl.AccessControlType]::Allow))
$sd.AddAccessRule([System.IO.Pipes.PipeAccessRule]::new(
 $client,[System.IO.Pipes.PipeAccessRights]$clientRights,
 [System.Security.AccessControl.AccessControlType]::Allow))
$source=@'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class E41Win32PipeQA {
 [StructLayout(LayoutKind.Sequential)]
 public struct SA {
   public int nLength;
   public IntPtr lpSecurityDescriptor;
   [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle;
 }
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CreateNamedPipeW")]
 static extern SafeFileHandle CreateNamedPipe(string name, uint openMode, uint pipeMode, uint maxInstances, uint outSize, uint inSize, uint timeout, ref SA security);
 [DllImport("advapi32.dll", SetLastError=true)]
 static extern uint GetSecurityInfo(IntPtr handle, uint objectType, uint secInfo, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr securityDescriptor);
 [DllImport("advapi32.dll", SetLastError=true)]
 static extern uint GetSecurityDescriptorLength(IntPtr securityDescriptor);
 [DllImport("kernel32.dll", SetLastError=true)]
 static extern IntPtr LocalFree(IntPtr handle);
 public sealed class Result {
   public int duplicateWin32Error;
   public int appliedDescriptorBytes;
   public byte[] appliedDescriptor;
   public bool remoteRejectedFlagUsed;
   public bool firstInstanceFlagUsed;
 }
 public static Result Probe(string name, byte[] descriptor) {
   if(!name.StartsWith(@"\\.\pipe\rc-e41-qa-",StringComparison.Ordinal))
     throw new Exception("INVALID_QA_NAMESPACE");
   IntPtr p=Marshal.AllocHGlobal(descriptor.Length);
   try {
     Marshal.Copy(descriptor,0,p,descriptor.Length);
     SA sa=new SA{nLength=Marshal.SizeOf<SA>(), lpSecurityDescriptor=p, bInheritHandle=false};
     const uint open=0x00080003; // FILE_FLAG_FIRST_PIPE_INSTANCE | PIPE_ACCESS_DUPLEX
     const uint mode=0x00000008; // PIPE_REJECT_REMOTE_CLIENTS
     using(SafeFileHandle first=CreateNamedPipe(name,open,mode,2,1024,1024,0,ref sa)) {
       if(first.IsInvalid)throw new Exception("FIRST_INSTANCE_CREATION_FAILED:"+Marshal.GetLastWin32Error());
       IntPtr owner,group,dacl,sacl,pActual;
       uint e=GetSecurityInfo(first.DangerousGetHandle(),6,4,out owner,out group,out dacl,out sacl,out pActual);
       if(e!=0)throw new Exception("GET_APPLIED_DACL_FAILED:"+e);
       byte[] bytes;
       try {
         uint len=GetSecurityDescriptorLength(pActual);
         if(len<20 || len>65536)throw new Exception("INVALID_APPLIED_DESCRIPTOR_LENGTH");
         bytes=new byte[(int)len];
         Marshal.Copy(pActual,bytes,0,(int)len);
       }finally{LocalFree(pActual);}
       using(SafeFileHandle second=CreateNamedPipe(name,open,mode,2,1024,1024,0,ref sa)) {
         int code=second.IsInvalid?Marshal.GetLastWin32Error():0;
         if(!second.IsInvalid)throw new Exception("SECOND_FIRST_INSTANCE_UNEXPECTEDLY_CREATED");
         if(code!=5)throw new Exception("SECOND_FIRST_INSTANCE_NOT_ACCESS_DENIED:"+code);
         return new Result{duplicateWin32Error=code,appliedDescriptorBytes=bytes.Length,
           appliedDescriptor=bytes,remoteRejectedFlagUsed=true,firstInstanceFlagUsed=true};
       }
     }
   }finally{Marshal.FreeHGlobal(p);}
 }
}
'@
Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop
$name='\\.\pipe\rc-e41-qa-'+[Guid]::NewGuid().ToString('N')
$result=[E41Win32PipeQA]::Probe($name,$sd.GetSecurityDescriptorBinaryForm())
$applied=[Security.AccessControl.RawSecurityDescriptor]::new($result.appliedDescriptor,0)
$aces=@($applied.DiscretionaryAcl)
if($aces.Count -ne 2){throw 'APPLIED_DACL_NOT_TWO_ACES'}
$record=@{}
foreach($ace in $aces){
 if($ace.IsInherited -or $ace.AceQualifier -ne [Security.AccessControl.AceQualifier]::AccessAllowed){throw 'APPLIED_DACL_UNTRUSTED_ACE'}
 $record[$ace.SecurityIdentifier.Value]=[int]$ace.AccessMask
}
if($record.Count -ne 2 -or -not $record.ContainsKey($serverSid.Value) -or -not $record.ContainsKey($client.Value)) {throw 'APPLIED_OS_SID_MISMATCH'}
if(($record[$client.Value] -band [int]$unsafeBits) -ne 0){throw 'APPLIED_OS_CLIENT_ESCALATION_RIGHTS'}
if(($record[$client.Value] -band 3) -ne 3){throw 'APPLIED_OS_CLIENT_READ_WRITE_MISSING'}
if(($record[$serverSid.Value] -band [int][System.IO.Pipes.PipeAccessRights]::CreateNewInstance) -ne 4) {throw 'APPLIED_OS_SERVER_INSTANCE_RIGHT_MISSING'}
[pscustomobject]@{
 schema='e41-win32-first-instance-qa-v1';status='PASS';
 appliedAceCount=$aces.Count;clientInstanceRightsDenied=$true;
 clientAdminRightsDenied=$true;configuredSidsDistinct=$true;clientConnected=$false;
 firstInstanceDuplicateError=$result.duplicateWin32Error;
 remoteRejectRequestedAtCreation=$result.remoteRejectedFlagUsed;remoteRejectionBehaviorUntested=$true;
 firstInstanceFlagAppliedAtCreation=$result.firstInstanceFlagUsed;
 releaseAuthorized=$false;ownerAuthenticated=$false;nativeOutcome='UNKNOWN';
 platformScope='DISPOSABLE_SAME_PROCESS_QA_NOT_PRIVILEGED_BROKER'
}|ConvertTo-Json -Compress
