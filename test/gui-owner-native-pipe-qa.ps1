# Windows-only isolated QA for OS peer identity and an explicitly restricted pipe DACL.
# NOT an owner-presence broker. Same-user clients can connect; never grant GUI/J01 access.
param(
 [Parameter(Mandatory)][ValidateSet('server','client')][string]$Mode,
 [Parameter(Mandatory)][string]$PipeName,
 [string]$UntrustedClaim = 'S-1-5-18'
)
$ErrorActionPreference='Stop'
if(-not $IsWindows){throw 'WINDOWS_ONLY'}
if($PipeName -notmatch '^rc-owner-qa-[a-f0-9]{32}$'){throw 'INVALID_QA_PIPE_NAME'}
$id=[System.Security.Principal.WindowsIdentity]::GetCurrent()
if(-not $id.User){throw 'MISSING_OS_PRINCIPAL'}
$pipe=$null
try{
 if($Mode -eq 'server'){
   $sd=[System.IO.Pipes.PipeSecurity]::new()
   $sd.SetAccessRuleProtection($true,$false)
   $sd.SetOwner($id.User)
   $sd.AddAccessRule([System.IO.Pipes.PipeAccessRule]::new(
     $id.User,[System.IO.Pipes.PipeAccessRights]::FullControl,
     [System.Security.AccessControl.AccessControlType]::Allow))
   $rules=@($sd.GetAccessRules($true,$false,[System.Security.Principal.SecurityIdentifier]))
   if($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $id.User.Value){throw 'QA_PIPE_ACL_UNEXPECTED'}
   $pipe=[System.IO.Pipes.NamedPipeServerStreamAcl]::Create(
     $PipeName,[System.IO.Pipes.PipeDirection]::InOut,1,
     [System.IO.Pipes.PipeTransmissionMode]::Byte,
     [System.IO.Pipes.PipeOptions]::None,0,0,$sd,
     [System.IO.HandleInheritability]::None,
     [System.IO.Pipes.PipeAccessRights]0)
   # Inspect the ACL returned by the OS for the created pipe handle, not
   # merely the descriptor we intended to install.
   $applied=[System.IO.Pipes.PipesAclExtensions]::GetAccessControl($pipe)
   $appliedRules=@($applied.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]))
   if($appliedRules.Count -ne 1 -or
      $appliedRules[0].IdentityReference.Value -ne $id.User.Value -or
      $appliedRules[0].AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
      $appliedRules[0].IsInherited){throw 'QA_OS_PIPE_DACL_MISMATCH'}
   Write-Output 'QA_PIPE_READY'
   $pipe.WaitForConnection()
   $reader=[System.IO.StreamReader]::new($pipe,[System.Text.Encoding]::UTF8,$false,1024,$true)
   $claim=$reader.ReadLine()
   if($null -eq $claim -or $claim.Length -gt 512){throw 'QA_INVALID_INPUT'}
   $script:actualSid=$null
   $pipe.RunAsClient([System.IO.Pipes.PipeStreamImpersonationWorker]{
     $who=[System.Security.Principal.WindowsIdentity]::GetCurrent($true)
     $script:actualSid=$who.User.Value
   })
   $peerVerified=([string]$script:actualSid -eq [string]$id.User.Value)
   $out=[pscustomobject]@{
     schema='rc-qa-os-pipe-peer-v1';osTokenPeerMatchesServer=$peerVerified;
     claimedIdentityUsed=$false;accessAclExplicit=$true;
     ownerAuthenticated=$false;releaseAuthorized=$false;nativeOutcome='UNKNOWN';
     notes='Same-account QA peer identity is NOT physical-owner approval'
   }
   $writer=[System.IO.StreamWriter]::new($pipe,[System.Text.UTF8Encoding]::new($false),1024,$true)
   $writer.AutoFlush=$true
   $writer.WriteLine(($out|ConvertTo-Json -Compress))
 }else{
   $pipe=[System.IO.Pipes.NamedPipeClientStream]::new(
     '.',$PipeName,[System.IO.Pipes.PipeDirection]::InOut,
     [System.IO.Pipes.PipeOptions]::None,
     [System.Security.Principal.TokenImpersonationLevel]::Impersonation)
   $pipe.Connect(6000)
   $writer=[System.IO.StreamWriter]::new($pipe,[System.Text.UTF8Encoding]::new($false),1024,$true)
   $writer.AutoFlush=$true
   $writer.WriteLine($UntrustedClaim)
   $reader=[System.IO.StreamReader]::new($pipe,[System.Text.Encoding]::UTF8,$false,1024,$true)
   $line=$reader.ReadLine()
   if(-not $line -or $line.Length -gt 2048){throw 'QA_RESPONSE_INVALID'}
   Write-Output $line
 }
}catch{
 [Console]::Error.WriteLine('QA_OS_PIPE_ERROR: '+$_.Exception.Message)
 exit 2
}finally{
 if($null -ne $pipe){$pipe.Dispose()}
}
