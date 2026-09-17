param(
  [string]$TunnelId,
  [string]$Profile = 'chatgpt-remote-commander'
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BundledTunnelExe = Join-Path $Root 'tools\tunnel-client-v0.0.14\tunnel-client.exe'
$TunnelExe = if (Test-Path -LiteralPath $BundledTunnelExe) {
  $BundledTunnelExe
} else {
  $cmd = Get-Command tunnel-client -ErrorAction SilentlyContinue
  if (-not $cmd) { throw 'tunnel-client was not found. Install the official OpenAI tunnel client or place it on PATH.' }
  $cmd.Source
}
$McpUrl = 'http://127.0.0.1:47831/mcp'
$HealthUrl = 'http://127.0.0.1:47831/health'
try {
  $health = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 3
  if (-not $health.ok) { throw 'MCP health returned not-ok' }
} catch {
  throw "ChatGPT Remote Commander is not running at $HealthUrl. Start node src/server.mjs first."
}
if (-not $TunnelId) { $TunnelId = Read-Host 'Paste OpenAI tunnel_id' }
if ($TunnelId -notmatch '^tunnel_[A-Za-z0-9_-]+$') {
  throw 'Invalid tunnel_id format.'
}
$SecureKey = Read-Host 'Paste Runtime API key (input hidden)' -AsSecureString
$PlainKey = [System.Net.NetworkCredential]::new('', $SecureKey).Password
if ([string]::IsNullOrWhiteSpace($PlainKey)) { throw 'Runtime API key is empty.' }
try {
  $env:CONTROL_PLANE_API_KEY = $PlainKey
  & $TunnelExe init `
    --sample sample_mcp_remote_no_auth `
    --profile $Profile `
    --tunnel-id $TunnelId `
    --mcp-server-url $McpUrl `
    --health-listen-addr '127.0.0.1:47832' `
    --force
  if ($LASTEXITCODE -ne 0) { throw "tunnel-client init failed: $LASTEXITCODE" }

  & $TunnelExe doctor --profile $Profile --explain
  if ($LASTEXITCODE -ne 0) { throw "tunnel-client doctor failed: $LASTEXITCODE" }

  Write-Host ''
  Write-Host 'Tunnel validation PASS. Starting tunnel; keep this window open.'
  Write-Host 'Local tunnel UI: http://127.0.0.1:47832/ui'
  & $TunnelExe run --profile $Profile
  if ($LASTEXITCODE -ne 0) { throw "tunnel-client run failed: $LASTEXITCODE" }
} finally {
  Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
  $PlainKey = $null
  $SecureKey = $null
}
