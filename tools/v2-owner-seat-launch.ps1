# V2-only owner-process task action. No network listener, credential access or UI input.
# ExpectedOwnerSid comes from the locally registered Task principal, not RPC
# arguments, ChatGPT conversation text or a reusable project credential.
param(
 [Parameter(Mandatory=$true)]
 [ValidatePattern('^S-1-5-21-(?:[0-9]+-){3}[0-9]+$')]
 [string]$ExpectedOwnerSid
)
$ErrorActionPreference='Stop'
$token=[Security.Principal.WindowsIdentity]::GetCurrent()
$me=Get-Process -Id $PID
if($token.User.Value -ne $ExpectedOwnerSid -or
   $token.User.Value -eq 'S-1-5-18' -or
   $me.SessionId -lt 1 -or
   $env:USERNAME -notmatch '^[A-Za-z0-9._-]{1,128}$'){
 throw 'V2_OWNER_SEAT_NATIVE_TOKEN_REQUIRED'
}
# Desktop presence is necessary for owner's existing browser, not sufficient
# to authorize any chat, credential, input action or cross-user session.
$explorer=@(Get-Process explorer -ErrorAction SilentlyContinue|
 Where-Object {$_.SessionId -eq $me.SessionId})
if($explorer.Count -lt 1){throw 'V2_OWNER_SEAT_INTERACTIVE_DESKTOP_REQUIRED'}
$node='C:\Program Files\nodejs\node.exe'
$agent='C:\ProgramData\ChatGPTRemoteCommander\V2OwnerSeat\v2-owner-seat-agent.mjs'
if(!(Test-Path -LiteralPath $node -PathType Leaf) -or
   !(Test-Path -LiteralPath $agent -PathType Leaf)){
 throw 'V2_OWNER_SEAT_COMPONENT_MISSING'
}
& $node $agent --owner-seat ([string]$me.SessionId)
if($LASTEXITCODE -ne 0){throw 'V2_OWNER_SEAT_AGENT_EXIT'}
