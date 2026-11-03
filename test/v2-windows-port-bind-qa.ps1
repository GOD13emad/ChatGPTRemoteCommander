param([Parameter(Mandatory=$true)][string]$Upgrader)
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($Upgrader,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'V2_PORT_PROBE_UPDATER_PARSE_FAILED'}
$matches=@($ast.FindAll({
  param($n)
  $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-FreePort'
},$true))
if($matches.Count -ne 1){throw 'V2_PORT_PROBE_FUNCTION_COUNT'}
Invoke-Expression $matches[0].Extent.Text
$blocked=$null;$held=$null
foreach($port in 49000..49040){
  $s=[Net.Sockets.Socket]::new([Net.Sockets.AddressFamily]::InterNetwork,
    [Net.Sockets.SocketType]::Stream,[Net.Sockets.ProtocolType]::Tcp)
  try{
    $s.ExclusiveAddressUse=$true
    $s.Bind([Net.IPEndPoint]::new([Net.IPAddress]::Loopback,$port))
    $held=$s;$blocked=$port;break
  }catch [Net.Sockets.SocketException]{$s.Dispose()}
}
if(-not $held){throw 'V2_PORT_PROBE_NO_TEST_PORT'}
try{
  $used=[Collections.Generic.HashSet[int]]::new()
  foreach($port in 48831..($blocked-1)){[void]$used.Add($port)}
  $selected=Get-FreePort $used
  if($selected -le $blocked -or $selected -gt 51999){throw 'V2_PORT_PROBE_SELECTED_BUSY_OR_INVALID'}
  $verify=[Net.Sockets.Socket]::new([Net.Sockets.AddressFamily]::InterNetwork,
    [Net.Sockets.SocketType]::Stream,[Net.Sockets.ProtocolType]::Tcp)
  try{
    $verify.ExclusiveAddressUse=$true
    $verify.Bind([Net.IPEndPoint]::new([Net.IPAddress]::Loopback,$selected))
  }finally{$verify.Dispose()}
  "V2_PORT_BIND_QA_PASS blocked=$blocked selected=$selected"
}finally{$held.Dispose()}
