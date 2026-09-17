param(
  [string]$Profile,
  [switch]$RemoveCredential
)
$ErrorActionPreference = 'Stop'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
Remove-ItemProperty -Path $runKey -Name 'ChatGPTRemoteCommander' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'autostart-windows\.ps1' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if ($RemoveCredential -and $Profile) {
  $safe = $Profile -replace '[^A-Za-z0-9._-]','_'
  $file = Join-Path $env:LOCALAPPDATA "ChatGPTRemoteCommander\credentials\$safe.dpapi"
  Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
}
Write-Host 'AUTOSTART_DISABLED'
