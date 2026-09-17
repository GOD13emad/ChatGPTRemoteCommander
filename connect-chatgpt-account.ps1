param(
  [Parameter(Mandatory=$false)][string]$TunnelId,
  [Parameter(Mandatory=$true)][string]$Profile,
  [Parameter(Mandatory=$false)][ValidateRange(0,65535)][int]$HealthPort = 0
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$McpUrl = 'http://127.0.0.1:47831/mcp'
$HealthUrl = 'http://127.0.0.1:47831/health'

$bundled = Get-ChildItem -Path (Join-Path $Root 'tools') -Filter 'tunnel-client.exe' -File -Recurse -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
$TunnelExe = if ($bundled) { $bundled.FullName } else {
  $cmd = Get-Command tunnel-client -ErrorAction SilentlyContinue
  if (-not $cmd) { throw 'tunnel-client not found. Run install.ps1 or install the official OpenAI tunnel client.' }
  $cmd.Source
}

try {
  $health = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 3
  if (-not $health.ok) { throw 'MCP health returned not-ok' }
} catch {
  throw "ChatGPT Remote Commander is not running at $HealthUrl. Start npm start first."
}

if ($HealthPort -eq 0) {
  foreach ($candidate in 47832..47931) {
    if (-not (Get-NetTCPConnection -State Listen -LocalPort $candidate -ErrorAction SilentlyContinue)) {
      $HealthPort = $candidate
      break
    }
  }
  if ($HealthPort -eq 0) { throw 'No free tunnel health port found in 47832..47931.' }
} elseif (Get-NetTCPConnection -State Listen -LocalPort $HealthPort -ErrorAction SilentlyContinue) {
  throw "HealthPort $HealthPort is already in use. Omit -HealthPort to auto-select one."
}
if (-not $TunnelId) { $TunnelId = Read-Host 'Paste OpenAI tunnel_id for this account' }
if ($TunnelId -notmatch '^tunnel_[A-Za-z0-9_-]+$') { throw 'Invalid tunnel_id format.' }

$SecureKey = Read-Host 'Paste Runtime API key for this account (input hidden)' -AsSecureString
$PlainKey = [System.Net.NetworkCredential]::new('', $SecureKey).Password
if ([string]::IsNullOrWhiteSpace($PlainKey)) { throw 'Runtime API key is empty.' }

try {
  $env:CONTROL_PLANE_API_KEY = $PlainKey
  $listen = "127.0.0.1:$HealthPort"
  & $TunnelExe init `
    --sample sample_mcp_remote_no_auth `
    --profile $Profile `
    --tunnel-id $TunnelId `
    --mcp-server-url $McpUrl `
    --health-listen-addr $listen `
    --force
  if ($LASTEXITCODE -ne 0) { throw "tunnel-client init failed: $LASTEXITCODE" }

  & $TunnelExe doctor --profile $Profile --explain
  if ($LASTEXITCODE -ne 0) { throw "tunnel-client doctor failed: $LASTEXITCODE" }

  Write-Host ''
  Write-Host "ACCOUNT_TUNNEL_READY profile=$Profile healthPort=$HealthPort"
  Write-Host "Local tunnel UI: http://127.0.0.1:$HealthPort/ui"
  Write-Host 'Keep this window open while this ChatGPT account uses the PC.'
  & $TunnelExe run --profile $Profile
  if ($LASTEXITCODE -ne 0) { throw "tunnel-client run failed: $LASTEXITCODE" }
} finally {
  Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
  $PlainKey = $null
  $SecureKey = $null
}
