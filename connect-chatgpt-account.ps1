param(
  [Parameter(Mandatory=$false)][string]$TunnelId,
  [Parameter(Mandatory=$true)][string]$Profile,
  [Parameter(Mandatory=$false)][ValidateRange(0,65535)][int]$HealthPort = 0,
  [switch]$Isolate,
  [ValidateRange(0,65535)][int]$McpPort = 0,
  [switch]$IsolatedPowerMode,
  [switch]$IsolatedGuiControl
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PersistentSetup = Join-Path $Root 'enable-autostart.ps1'
$Isolator = Join-Path $Root 'configure-profile-instance.ps1'

if ($IsolatedGuiControl -and -not $IsolatedPowerMode) { throw '-IsolatedGuiControl requires -IsolatedPowerMode.' }
if (($McpPort -ne 0 -or $IsolatedPowerMode -or $IsolatedGuiControl) -and -not $Isolate) { throw 'Use -Isolate when specifying isolated MCP options.' }

if (-not (Test-Path -LiteralPath $PersistentSetup -PathType Leaf)) {
  throw 'enable-autostart.ps1 is missing. Update/reinstall ChatGPT Remote Commander.'
}

$params = @{ Profile = $Profile; HealthPort = $HealthPort }
if (-not [string]::IsNullOrWhiteSpace($TunnelId)) { $params.TunnelId = $TunnelId }

Write-Host 'Persistent multi-account enrollment is active; no foreground duplicate tunnel will be started.'
& $PersistentSetup @params

if ($Isolate) {
  if (-not (Test-Path -LiteralPath $Isolator -PathType Leaf)) { throw 'configure-profile-instance.ps1 is missing. Update/reinstall Remote Commander.' }
  $isolation = @{ Profile = $Profile; McpPort = $McpPort }
  if ($IsolatedPowerMode) { $isolation.PowerMode = $true }
  if ($IsolatedGuiControl) { $isolation.GuiControl = $true }
  & $Isolator @isolation
}

Write-Host ''
Write-Host "CONNECT_ACCOUNT_PASS profile=$Profile mode=persistent-autostart isolated=$([bool]$Isolate)"
Write-Host 'You can close this window. The background supervisor owns this account tunnel.'
