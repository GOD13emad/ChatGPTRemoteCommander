param(
  [string]$Profile,
  [switch]$RemoveCredential
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

Remove-ItemProperty -Path $runKey -Name 'ChatGPTRemoteCommander' -ErrorAction SilentlyContinue

$rootPattern = [regex]::Escape($Root)
$supervisors = @(Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'autostart-windows\.ps1' -and $_.CommandLine -match $rootPattern })
foreach ($p in $supervisors) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

$tunnels = @(Get-CimInstance Win32_Process -Filter "Name='tunnel-client.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match $rootPattern -and $_.CommandLine -match 'run\s+--profile\s+' })
foreach ($p in $tunnels) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

$mcpStopped = $false
$listener = Get-NetTCPConnection -State Listen -LocalPort 47831 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
  if ($proc.Name -eq 'node.exe' -and $proc.CommandLine -match 'src[\\/]server-v0\.3\.mjs') {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    $mcpStopped = $true
  }
}

$credentialState = 'kept'
if ($RemoveCredential) {
  if ([string]::IsNullOrWhiteSpace($Profile)) { throw '-Profile is required with -RemoveCredential.' }
  $safe = $Profile -replace '[^A-Za-z0-9._-]','_'
  $file = Join-Path $env:LOCALAPPDATA "ChatGPTRemoteCommander\credentials\$safe.dpapi"
  Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
  $credentialState = 'removed'
}

Write-Host "AUTOSTART_DISABLED supervisors=$($supervisors.Count) tunnels=$($tunnels.Count) mcpStopped=$mcpStopped credential=$credentialState"
