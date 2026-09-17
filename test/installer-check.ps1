$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Installer = Join-Path $Root 'install.ps1'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($Installer, [ref]$null, [ref]$errors) | Out-Null
if ($errors.Count) { throw ($errors | ForEach-Object Message | Out-String) }
$text = Get-Content -Raw -LiteralPath $Installer
$required = @(
  'GOD13emad/ChatGPTRemoteCommander.git',
  'openai/tunnel-client/releases/download',
  'SHA256SUMS.txt',
  '-InstallPrerequisites',
  'config.local.json',
  'allowPermanentDelete',
  'INSTALL_PASS'
)
foreach ($needle in $required) {
  if (-not $text.Contains($needle)) { throw "installer missing required marker: $needle" }
}
if ($text -match 'sk-[A-Za-z0-9_-]{20,}|tunnel_[A-Za-z0-9_-]{16,}') {
  throw 'installer contains a credential-like literal'
}
Write-Output 'INSTALLER_CHECK_PASS'
