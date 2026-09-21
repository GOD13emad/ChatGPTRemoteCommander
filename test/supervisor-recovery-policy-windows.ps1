$ErrorActionPreference='Stop'
$originalLocalAppData=$env:LOCALAPPDATA
$tempLocalAppData=Join-Path ([IO.Path]::GetTempPath()) ('rc-supervisor-policy-'+[guid]::NewGuid().ToString('N'))
$env:LOCALAPPDATA=$tempLocalAppData
function Write-SupervisorLog([string]$Message) {}
function Test-ProfileName([string]$Name) { return $true }
try {
  . (Join-Path (Split-Path -Parent $PSScriptRoot) 'supervisor-routing.ps1')
  $cases=@(
    @{h=$true;m=1;k=$false;i=-1;e='HEALTHY'},
    @{h=$false;m=1;k=$true;i=0;e='DEFER_TRANSIENT'},
    @{h=$false;m=2;k=$true;i=0;e='DEFER_TRANSIENT'},
    @{h=$false;m=3;k=$false;i=-1;e='DEFER_UNPROVEN'},
    @{h=$false;m=3;k=$true;i=1;e='DEFER_BUSY'},
    @{h=$false;m=3;k=$true;i=0;e='RECYCLE'}
  )
  foreach($c in $cases){
    $actual=Get-RoutedBackendRecoveryDecision ([bool]$c.h) ([int]$c.m) ([bool]$c.k) ([int]$c.i)
    if($actual -ne $c.e){throw "policy mismatch expected=$($c.e) actual=$actual"}
  }
  $script:StopBackendCalled=$false
  function Test-McpHealth { return $false }
  function Get-NetTCPConnection { [pscustomobject]@{OwningProcess=424242} }
  function Get-RouterStatusSafe {
    $inflight=[pscustomobject]@{'48834'=2}
    return [pscustomobject]@{ok=$true;router=$true;sourceSha256='stale';state=[pscustomobject]@{profile='default'};inflightByPort=$inflight}
  }
  function Stop-OwnedRoutedBackend { $script:StopBackendCalled=$true; throw 'UNSAFE_STOP_CALLED' }
  $route=[pscustomobject]@{
    File=(Join-Path $tempLocalAppData 'route.json')
    State=[pscustomobject]@{profile='default'}
    Active=[pscustomobject]@{port=48834;configSha256=('a'*64);configPath=(Join-Path $tempLocalAppData 'config.json');projectDir=$PSScriptRoot}
  }
  foreach($n in 1..4){
    $ready=Start-RoutedBackend $route 47831
    if($ready -ne $false){throw 'busy backend should defer recovery'}
  }
  if($script:StopBackendCalled){throw 'busy backend was destructively stopped'}

  $script:StopRouterCalled=$false
  function Stop-OwnedRouter { $script:StopRouterCalled=$true; throw 'UNSAFE_ROUTER_STOP_CALLED' }
  $global:Root=Split-Path -Parent $PSScriptRoot
  $routerReady=Start-RouterForRoute $route 47831
  if($routerReady -ne $true){throw 'healthy stale router should remain serving'}
  if($script:StopRouterCalled){throw 'live stale router was destructively stopped'}

  'SUPERVISOR_RECOVERY_POLICY_PASS'
} finally {
  $env:LOCALAPPDATA=$originalLocalAppData
  if(Test-Path -LiteralPath $tempLocalAppData){Remove-Item -LiteralPath $tempLocalAppData -Recurse -Force}
}
