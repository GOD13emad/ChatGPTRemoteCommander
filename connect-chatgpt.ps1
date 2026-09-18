param(
  [string]$TunnelId,
  [string]$Profile = 'chatgpt-remote-commander'
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PersistentSetup = Join-Path $Root 'enable-autostart.ps1'

if (-not (Test-Path -LiteralPath $PersistentSetup)) {
  throw 'enable-autostart.ps1 is missing. Update/reinstall ChatGPT Remote Commander.'
}

$params = @{ Profile = $Profile }
if (-not [string]::IsNullOrWhiteSpace($TunnelId)) {
  $params.TunnelId = $TunnelId
}

Write-Host 'Persistent connection mode is active; foreground duplicate tunnels are not started.'
& $PersistentSetup @params

Write-Host ''
Write-Host "CONNECT_PASS profile=$Profile mode=persistent-autostart"
Write-Host 'You can close this window. MCP and tunnel are managed by the background supervisor.'
