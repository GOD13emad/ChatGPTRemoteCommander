$ErrorActionPreference='Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'tools\stale-drain-policy.ps1')
$cases=@(
  @{a=0;q=0;c=0;d=0;b=$false;l=$false;want='ALLOW'},
  @{a=1;q=0;c=0;d=0;b=$false;l=$false;want='DEFER_ACTIVE'},
  @{a=0;q=1;c=0;d=0;b=$false;l=$false;want='DEFER_QUEUED'},
  @{a=0;q=0;c=1;d=0;b=$false;l=$false;want='DEFER_CONNECTED'},
  @{a=0;q=0;c=0;d=1;b=$false;l=$false;want='DEFER_DESCENDANTS'},
  @{a=0;q=0;c=0;d=0;b=$true;l=$false;want='DEFER_GUI_BUSY'},
  @{a=0;q=0;c=0;d=0;b=$false;l=$true;want='DEFER_GUI_LEASED'}
)
foreach($x in $cases){
  $got=Get-StaleDrainDecision -ActiveOperations $x.a -Queued $x.q -UnexpectedConnections $x.c -UnsafeDescendants $x.d -GuiBusy $x.b -GuiLeased $x.l
  if($got-ne$x.want){throw "STALE_DRAIN_POLICY_FAIL expected=$($x.want) got=$got"}
}
'STALE_DRAIN_POLICY_PASS'
