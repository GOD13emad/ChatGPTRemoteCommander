# SYSTEM admission gate for Windows Supervisor; dotsourced before runtime/owner state.
# This gate never promotes a candidate or bypasses native user-session consent.
$script:RcSystemNativeContext=([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -eq 'S-1-5-18')
$script:RcSystemTrustedRouteGuard=$false
if($script:RcSystemNativeContext -and -not $SelfTest){
  $trustTool=Join-Path $Root 'tools\windows-system-route-trust-preflight.ps1'
  if(-not(Test-Path -LiteralPath $trustTool -PathType Leaf)){
    throw 'SYSTEM_TRUST_PREFLIGHT_MISSING'
  }
  $trustVerdict=& $trustTool -CandidateRoot $Root | ConvertFrom-Json -ErrorAction Stop
  if(-not $trustVerdict.readOnly -or
    -not $trustVerdict.preflightPassed -or
    -not $trustVerdict.dependencyClosureVerified -or
    -not $trustVerdict.migrationReady -or
    -not $trustVerdict.releaseAuthorized){
    throw 'SYSTEM_TRUSTED_ROUTE_NOT_READY'
  }
  $script:RcSystemTrustedRouteGuard=$true
}
