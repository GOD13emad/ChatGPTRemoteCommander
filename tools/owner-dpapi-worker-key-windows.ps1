# Native Windows DPAPI CurrentUser custody for an existing owner+Tunnel pair.
# Enroll receives a fresh 32-byte seed exclusively on anonymous STDIN.
# No key, profile credential or user secret is included in arguments/output.
# No grants, OS elevation, second Tunnel, or active service mutation.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidateSet('Enroll','Verify')][string]$Mode,
 [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_-]{1,64}$')][string]$ProfileName,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$OwnerSidHash,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$KeyId,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ClientLeafSha256,
 [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9._-]{1,64}$')][string]$HostId
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
function Fail([string]$Code){throw $Code}
function Sha([byte[]]$Data){
 return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Data)).ToLowerInvariant()
}
function Assert-Item([string]$File,[bool]$Directory){
 $i=Get-Item -LiteralPath $File -Force -ErrorAction Stop
 if([bool]$i.PSIsContainer -ne $Directory -or
    ($i.Attributes -band [IO.FileAttributes]::ReparsePoint)){
   Fail 'RC012_WORKER_DPAPI_UNTRUSTED_PATH'
 }
 $acl=Get-Acl -LiteralPath $File
 $localSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $localSid -or
    !$acl.AreAccessRulesProtected){Fail 'RC012_WORKER_DPAPI_UNTRUSTED_ACL'}
 $allowed=@($localSid,'S-1-5-18','S-1-5-32-544')
 foreach($r in $acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier])){
   if($r.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
      $allowed -cnotcontains $r.IdentityReference.Value){
       Fail 'RC012_WORKER_DPAPI_UNTRUSTED_ACL'
   }
 }
 return $i
}
function Protect-NewAcl([string]$File){
 # New, owned staging files ONLY. Never rewrite existing profile ACLs.
 $acl=Get-Acl -LiteralPath $File
 $owner=[Security.Principal.SecurityIdentifier]::new(
   [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
 $acl.SetOwner($owner)
 $acl.SetAccessRuleProtection($true,$false)
 foreach($rule in @($acl.Access)){[void]$acl.RemoveAccessRuleSpecific($rule)}
 $inherit=[Security.AccessControl.InheritanceFlags]::None
 if((Get-Item -LiteralPath $File).PSIsContainer){
   $inherit=[Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [Security.AccessControl.InheritanceFlags]::ObjectInherit
 }
 $ace=[Security.AccessControl.FileSystemAccessRule]::new(
   $owner,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,
   [Security.AccessControl.PropagationFlags]::None,
   [Security.AccessControl.AccessControlType]::Allow)
 $acl.AddAccessRule($ace)
 Set-Acl -LiteralPath $File -AclObject $acl -ErrorAction Stop
}
$secret=$null;$entropy=$null;$cipher=$null;$plain=$null;$inputBuf=$null
$stage=$null;$lock=$null;$lockStream=$null
try {
 Add-Type -AssemblyName System.Security -ErrorAction Stop | Out-Null
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $sidHash=Sha([Text.Encoding]::UTF8.GetBytes(
   'commander.os-owner.sid.v1'+[char]0+'win32'+[char]0+'sid='+$sid))
 if($sidHash -cne $OwnerSidHash){Fail 'RC012_WORKER_DPAPI_OWNER_CHANGED'}
 $pair=if($ProfileName -eq 'chatgpt-remote-commander'){'default'}else{$ProfileName}
 $base=Join-Path $env:APPDATA ('ChatGPTRemoteCommander\private-pair\'+$pair)
 [void](Assert-Item $base $true)
 $target=Join-Path $base 'worker-identity'
 $blob=Join-Path $target 'worker-ed25519-seed.dpapi'
 $receiptPath=Join-Path $target 'worker-key-id.json'
 $entropy=[Text.Encoding]::UTF8.GetBytes(
   'commander.worker.identity.v1|'+$ProfileName+'|'+$OwnerSidHash)
 if($Mode -eq 'Verify'){
   [void](Assert-Item $target $true)
   $b=Assert-Item $blob $false;$r=Assert-Item $receiptPath $false
   if($b.Length -lt 128 -or $b.Length -gt 4096 -or
      $r.Length -lt 100 -or $r.Length -gt 4096){
     Fail 'RC012_WORKER_DPAPI_FILE_SIZE_INVALID'
   }
   $m=Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 |ConvertFrom-Json
   if($m.schema -ne 1 -or $m.profileId -cne $ProfileName -or
      $m.ownerSidHash -cne $OwnerSidHash -or $m.keyId -cne $KeyId -or
      $m.hostId -cne $HostId -or
      $m.clientLeafDerSha256 -cne $ClientLeafSha256){
      Fail 'RC012_WORKER_DPAPI_RECEIPT_CHANGED'
   }
   $cipher=[IO.File]::ReadAllBytes($blob)
   if((Sha $cipher) -cne $m.cipherSha256){
     Fail 'RC012_WORKER_DPAPI_CIPHER_CHANGED'
   }
   $plain=[Security.Cryptography.ProtectedData]::Unprotect(
      $cipher,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
   if($plain.Length -ne 32){Fail 'RC012_WORKER_DPAPI_SEED_INVALID'}
   [Console]::Out.WriteLine('RC012_WINDOWS_OWNER_DPAPI_WORKER_VERIFY_PASS')
   exit 0
 }
 if(Test-Path -LiteralPath $target){Fail 'RC012_WORKER_DPAPI_EXISTING_CAPSULE_STOP'}
 $lock=Join-Path $base '.worker-identity-provision.lock'
 $lockStream=[IO.FileStream]::new($lock,[IO.FileMode]::CreateNew,
   [IO.FileAccess]::Write,[IO.FileShare]::None)
 # The CREATE_NEW file itself is the lock; close before changing its DACL
 # (a FileShare.None handle could block Set-Acl on Windows).
 $lockStream.Dispose();$lockStream=$null
 Protect-NewAcl $lock
 $stage=Join-Path $base ('.worker-identity-stage-'+[guid]::NewGuid().ToString('N'))
 [void](New-Item -ItemType Directory -Path $stage -ErrorAction Stop)
 Protect-NewAcl $stage
 [void](Assert-Item $stage $true)
 $inputBuf=[byte[]]::new(33)
 $stream=[Console]::OpenStandardInput()
 $read=0
 while($read -lt 33){
   $count=$stream.Read($inputBuf,$read,33-$read)
   if($count -eq 0){break}
   $read+=$count
 }
 if($read -ne 32){Fail 'RC012_WORKER_DPAPI_SEED_SIZE_INVALID'}
 $secret=[byte[]]::new(32)
 [Array]::Copy($inputBuf,$secret,32)
 $cipher=[Security.Cryptography.ProtectedData]::Protect(
   $secret,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 if($cipher.Length -lt 128 -or $cipher.Length -gt 4096){
   Fail 'RC012_WORKER_DPAPI_CIPHER_SIZE_INVALID'
 }
 $b=Join-Path $stage 'worker-ed25519-seed.dpapi'
 $r=Join-Path $stage 'worker-key-id.json'
 [IO.File]::WriteAllBytes($b,$cipher)
 Protect-NewAcl $b
 $m=@{schema=1;hostId=$HostId;profileId=$ProfileName;
   ownerSidHash=$OwnerSidHash;clientLeafDerSha256=$ClientLeafSha256;
   keyId=$KeyId;cipherSha256=(Sha $cipher)}
 [IO.File]::WriteAllText($r,($m|ConvertTo-Json -Compress),
    [Text.UTF8Encoding]::new($false))
 Protect-NewAcl $r
 $plain=[Security.Cryptography.ProtectedData]::Unprotect(
   [IO.File]::ReadAllBytes($b),$entropy,
   [Security.Cryptography.DataProtectionScope]::CurrentUser)
 if($plain.Length -ne 32 -or
   ![Security.Cryptography.CryptographicOperations]::FixedTimeEquals(
      $plain,$secret)){
   Fail 'RC012_WORKER_DPAPI_STAGE_VERIFY_FAILED'
 }
 if(Test-Path -LiteralPath $target){Fail 'RC012_WORKER_DPAPI_CONCURRENT_CAPSULE_STOP'}
 [IO.Directory]::Move($stage,$target)
 $stage=$null
 [Console]::Out.WriteLine('RC012_WINDOWS_OWNER_DPAPI_WORKER_ENROLL_PASS')
 exit 0
} catch {
 [Console]::Error.WriteLine('RC012_WINDOWS_OWNER_DPAPI_WORKER_FAILED')
 exit 2
} finally {
 if($secret){[Array]::Clear($secret,0,$secret.Length)}
 if($entropy){[Array]::Clear($entropy,0,$entropy.Length)}
 if($inputBuf){[Array]::Clear($inputBuf,0,$inputBuf.Length)}
 if($plain){[Array]::Clear($plain,0,$plain.Length)}
 if($cipher){[Array]::Clear($cipher,0,$cipher.Length)}
 if($lockStream){$lockStream.Dispose()}
 if($stage -and (Test-Path -LiteralPath $stage)){
   Remove-Item -LiteralPath $stage -Force -Recurse -ErrorAction SilentlyContinue
 }
 if($lock -and (Test-Path -LiteralPath $lock)){
   Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue
 }
}
