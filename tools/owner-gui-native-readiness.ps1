# Read-only check for owner-native desktop GUI admission.
# This is NOT a token issuer, privileged owner broker, or incident clearance.
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if(-not $IsWindows){throw 'OWNER_GUI_WINDOWS_ONLY'}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$session=[Diagnostics.Process]::GetCurrentProcess().SessionId
$interactive=$session -gt 0 -and -not $identity.IsSystem
$root=Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander\owner-gui-v1'
$configFile=Join-Path $root 'config.json'
$configValid=$false
$configPresent=Test-Path -LiteralPath $configFile -PathType Leaf
$inputPolicyRestricted=$true
$profile='UNKNOWN'
if($configPresent) {
  $stat=Get-Item -LiteralPath $configFile -Force
  if(-not ($stat.Attributes -band [IO.FileAttributes]::ReparsePoint) -and
     $stat.Length -gt 0 -and $stat.Length -le 65536) {
    try {
      $cfg=Get-Content -LiteralPath $configFile -Raw -Encoding utf8|ConvertFrom-Json
      $profile=[string]$cfg.instance.profile
      $configValid=($profile -eq 'emad-owner-gui' -and [int]$cfg.port -eq 48837 -and
        [string]$cfg.host -eq '127.0.0.1' -and $cfg.powerMode.guiControl.enabled -eq $true)
      $inputPolicyRestricted=($cfg.powerMode.guiControl.allowMouse -ne $true -or
        $cfg.powerMode.guiControl.allowKeyboard -ne $true)
    } catch { $configValid=$false }
  }
}
# A prior unknown native effect requires independent owner-side disposition.
# Even a clean local incident pathname is not evidence of that disposition.
$pendingPath=Join-Path $env:LOCALAPPDATA 'chatgpt-remote-commander\gui-pending-native-input-v1.json'
$pendingPathExists=Test-Path -LiteralPath $pendingPath
# A same-session process is not proof of the owner's Windows identity.
# Compare the Win32_Process owner SID to the caller's token SID,
# require exactly one matching worker; never emit a SID or command line.
function Test-OwnerWorkerIdentity {
  param([object[]]$Processes,[int]$ExpectedSession,[string]$ExpectedSid,[scriptblock]$OwnerSidLookup)
  if($ExpectedSession -le 0 -or [string]::IsNullOrWhiteSpace($ExpectedSid) -or
     -not $OwnerSidLookup){return $false}
  $candidates=@($Processes | Where-Object {
    [int]$_.SessionId -eq $ExpectedSession -and
    [string]$_.Name -eq 'node.exe' -and
    [string]$_.CommandLine -match 'server-v0\.3\.mjs'
  })
  if($candidates.Count -ne 1){return $false}
  try{
    $identity= & $OwnerSidLookup $candidates[0]
    return ($null -ne $identity -and [string]$identity -ceq $ExpectedSid)
  }catch{return $false}
}

$workerCount=0
$workerSidVerified=$false
if($interactive){
  try{
    $candidates=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
      Where-Object { $_.SessionId -eq $session -and
        [string]$_.CommandLine -match 'server-v0\.3\.mjs' })
    $workerCount=$candidates.Count
    $workerSidVerified=Test-OwnerWorkerIdentity -Processes $candidates -ExpectedSession $session -ExpectedSid ([string]$identity.User.Value) -OwnerSidLookup {
      param($worker)
      $sid=Invoke-CimMethod -InputObject $worker -MethodName GetOwnerSid -ErrorAction Stop
      if([int]$sid.ReturnValue -ne 0){return $null}
      return [string]$sid.Sid
    }
  }catch{ $workerSidVerified=$false }
}
$reason=if(-not $interactive){'OWNER_INTERACTIVE_SESSION_REQUIRED'}
  elseif(-not $configValid){'OWNER_GUI_CONFIG_NOT_VERIFIED'}
  elseif($pendingPathExists){'PENDING_NATIVE_EFFECT_REQUIRES_REVIEW'}
  elseif(-not $workerSidVerified){'OWNER_WORKER_IDENTITY_UNVERIFIED'}
  else {'OS_TRUSTED_OWNER_CONSENT_BROKER_REQUIRED'}
# No code path in this diagnostic may indicate that a GUI input was authorized.
[pscustomobject]@{
 schema='rc-owner-gui-native-readiness-v1'
 status='NOT_AUTHORIZED'
 reason=$reason
 sessionInteractiveOwnerCandidate=$interactive
 ownerWorkerSameSessionPresent=($workerCount -gt 0)
 ownerWorkerIdentityVerified=$workerSidVerified
 ownerConfigValid=$configValid
 ownerInputPolicyRestricted=$inputPolicyRestricted
 incidentPendingPathPresent=$pendingPathExists
 incidentEffectReconciled=$false
 osTrustedOwnerConsentVerified=$false
 fleetNativeDispatchersQuiescenceProven=$false
 takeoverAuthorized=$false
 inputExecuted=$false
 modifiesState=$false
} | ConvertTo-Json -Depth 3 -Compress
