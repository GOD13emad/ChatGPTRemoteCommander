param(
  [Parameter(Mandatory=$false)][string]$TunnelId,
  [Parameter(Mandatory=$true)][string]$Profile,
  [Parameter(Mandatory=$false)][ValidateRange(0,65535)][int]$HealthPort = 0
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PersistentSetup = Join-Path $Root 'enable-autostart.ps1'

if (-not (Test-Path -LiteralPath $PersistentSetup -PathType Leaf)) {
  throw 'enable-autostart.ps1 is missing. Update/reinstall ChatGPT Remote Commander.'
}

$params = @{ Profile = $Profile; HealthPort = $HealthPort }
if (-not [string]::IsNullOrWhiteSpace($TunnelId)) { $params.TunnelId = $TunnelId }

Write-Host 'Persistent multi-account enrollment is active; no foreground duplicate tunnel will be started.'
& $PersistentSetup @params

Write-Host ''
Write-Host "CONNECT_ACCOUNT_PASS profile=$Profile mode=persistent-autostart"
Write-Host 'You can close this window. The background supervisor owns this account tunnel.'
