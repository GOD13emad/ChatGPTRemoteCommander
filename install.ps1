param(
  [string]$InstallDir = "$env:LOCALAPPDATA\ChatGPTRemoteCommander",
  [switch]$InstallPrerequisites,
  [switch]$PowerMode,
  [switch]$StartServer,
  [switch]$SkipTunnelClient,
  [string]$TunnelClientVersion = '0.0.14'
)
$ErrorActionPreference = 'Stop'
$Repo = 'https://github.com/GOD13emad/ChatGPTRemoteCommander.git'
$RepoRaw = 'https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/main'

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path','Machine')
  $user = [Environment]::GetEnvironmentVariable('Path','User')
  $env:Path = "$machine;$user"
}

function Require-Windows {
  if ([string]::IsNullOrWhiteSpace($env:WINDIR)) { throw 'This installer currently supports Windows only.' }
}

function Ensure-Command([string]$Name, [string]$WingetId) {
  if (Get-Command $Name -ErrorAction SilentlyContinue) { return }
  if (-not $InstallPrerequisites) {
    throw "$Name is required. Re-run with -InstallPrerequisites or install $WingetId manually."
  }
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw "winget is required to auto-install $Name."
  }
  Write-Host "Installing $Name via winget ($WingetId)..."
  & winget.exe install --id $WingetId -e --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "winget failed installing $WingetId ($LASTEXITCODE)" }
  Refresh-Path
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was installed but is not yet visible on PATH. Open a new terminal and re-run the installer."
  }
}

function Ensure-Prerequisites {
  Ensure-Command 'git.exe' 'Git.Git'
  Ensure-Command 'node.exe' 'OpenJS.NodeJS.LTS'
  Ensure-Command 'pwsh.exe' 'Microsoft.PowerShell'
  $nodeMajor = [int]((& node.exe --version).Trim().TrimStart('v').Split('.')[0])
  if ($nodeMajor -lt 22) { throw "Node.js 22+ is required; found $nodeMajor." }
}

function Install-Source {
  $parent = Split-Path -Parent $InstallDir
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  if (Test-Path -LiteralPath (Join-Path $InstallDir '.git')) {
    Write-Host "Updating existing installation: $InstallDir"
    & git.exe -C $InstallDir fetch origin main
    if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
    & git.exe -C $InstallDir pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw 'git pull --ff-only failed' }
  } elseif (Test-Path -LiteralPath $InstallDir) {
    throw "InstallDir exists but is not a Git checkout: $InstallDir"
  } else {
    Write-Host "Cloning to $InstallDir"
    & git.exe clone --depth 1 $Repo $InstallDir
    if ($LASTEXITCODE -ne 0) { throw 'git clone failed' }
  }
}
function Install-TunnelClient {
  if ($SkipTunnelClient) { return }
  $arch = if ($env:PROCESSOR_ARCHITECTURE -match 'ARM64') { 'arm64' } else { 'amd64' }
  $toolDir = Join-Path $InstallDir "tools\tunnel-client-v$TunnelClientVersion-windows-$arch"
  $exe = Join-Path $toolDir 'tunnel-client.exe'
  if (Test-Path -LiteralPath $exe) {
    Write-Host "Tunnel client already installed: $exe"
    return
  }
  $tag = "v$TunnelClientVersion"
  $file = "tunnel-client-v$TunnelClientVersion-windows-$arch.zip"
  $base = "https://github.com/openai/tunnel-client/releases/download/$tag"
  $tmp = Join-Path $env:LOCALAPPDATA "ChatGPTRemoteCommander\downloads\$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    Write-Host "Downloading official OpenAI tunnel-client $tag..."
    Invoke-WebRequest "$base/$file" -OutFile (Join-Path $tmp $file)
    Invoke-WebRequest "$base/SHA256SUMS.txt" -OutFile (Join-Path $tmp 'SHA256SUMS.txt')
    $line = Get-Content (Join-Path $tmp 'SHA256SUMS.txt') | Where-Object { $_ -match [regex]::Escape($file) } | Select-Object -First 1
    if (-not $line) { throw 'Could not find tunnel-client archive in SHA256SUMS.txt' }
    $expected = ($line -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash (Join-Path $tmp $file) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expected -ne $actual) { throw "Tunnel client checksum mismatch: expected $expected actual $actual" }
    New-Item -ItemType Directory -Force -Path $toolDir | Out-Null
    Expand-Archive -LiteralPath (Join-Path $tmp $file) -DestinationPath $toolDir -Force
    if (-not (Test-Path -LiteralPath $exe)) { throw 'tunnel-client.exe missing after extraction' }
    Write-Host "Tunnel client verified and installed: $exe"
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Configure-LocalPolicy {
  $root = Join-Path $env:USERPROFILE 'source\repos'
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  if (-not $PowerMode) {
    Write-Host 'Standard mode selected: public config.json remains active; Power Mode is OFF.'
    return
  }
  $localConfig = Join-Path $InstallDir 'config.local.json'
  $json = @'
{
  "host": "127.0.0.1",
  "port": 47831,
  "allowedRoots": ["%USERPROFILE%\\source\\repos"],
  "allowedPrograms": ["git", "node", "npm", "npx", "python", "py", "dotnet", "cmake", "ninja"],
  "maxReadBytes": 524288,
  "maxWriteBytes": 524288,
  "maxCommandMs": 120000,
  "auditLog": "var/audit.jsonl",
  "powerMode": {
    "enabled": true,
    "fullFilesystem": true,
    "allowShell": true,
    "allowProcessControl": true,
    "allowPermanentDelete": false,
    "backupRoot": "%USERPROFILE%\\.chatgpt-remote-commander\\backups",
'@
  $json += @'
    "maxFileBytes": 33554432,
    "maxCommandMs": 600000,
    "maxOutputBytes": 4194304,
    "maxTerminalBufferBytes": 8388608,
    "blockedShellPatterns": [
      "(^|\\s)shutdown(?:\\.exe)?(?:\\s|$)",
      "Restart-Computer",
      "Stop-Computer",
      "(^|\\s)logoff(?:\\.exe)?(?:\\s|$)",
      "ExitWindowsEx"
    ]
  }
}
'@
  [IO.File]::WriteAllText($localConfig, $json, [Text.UTF8Encoding]::new($false))
  Write-Host "Power Mode local policy created: $localConfig"
  Write-Host 'Permanent delete remains OFF; shutdown/restart/logoff remain blocked.'
}

function Test-Installation {
  Push-Location -LiteralPath $InstallDir
  try {
    & npm.cmd run check
    if ($LASTEXITCODE -ne 0) { throw 'npm run check failed' }
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'npm test failed' }
    & npm.cmd run audit
    if ($LASTEXITCODE -ne 0) { throw 'security audit failed' }
  } finally { Pop-Location }
}
function Start-LocalServer {
  if (-not $StartServer) { return }
  try {
    $health = Invoke-RestMethod 'http://127.0.0.1:47831/health' -TimeoutSec 2
    if ($health.ok) {
      Write-Host 'MCP server is already running and healthy.'
      return
    }
  } catch { }
  $escaped = $InstallDir.Replace("'", "''")
  $cmd = "Set-Location '$escaped'; `$Host.UI.RawUI.WindowTitle='ChatGPT Remote Commander'; npm start"
  Start-Process -FilePath 'pwsh.exe' -ArgumentList @('-NoExit','-NoProfile','-Command',$cmd) | Out-Null
  Start-Sleep -Seconds 3
  $health = Invoke-RestMethod 'http://127.0.0.1:47831/health' -TimeoutSec 5
  if (-not $health.ok) { throw 'Server window started but health check failed.' }
  Write-Host "Server started successfully: http://127.0.0.1:47831/mcp"
}

Require-Windows
Ensure-Prerequisites
Install-Source
Install-TunnelClient
Configure-LocalPolicy
Test-Installation
Start-LocalServer

Write-Host ''
Write-Host 'INSTALL_PASS'
Write-Host "Installed at: $InstallDir"
Write-Host "Mode: $(if ($PowerMode) {'POWER (full filesystem/shell/process control)'} else {'STANDARD'})"
Write-Host ''
Write-Host 'Next: create your own OpenAI Secure MCP Tunnel and Runtime API key, then enroll it once for automatic startup:'
Write-Host "  pwsh.exe -NoProfile -File `"$InstallDir\enable-autostart.ps1`" -Profile `"$env:COMPUTERNAME`""
Write-Host 'After enrollment, later Windows logins start MCP + tunnel automatically; no repeated Tunnel ID/port/key entry is needed.'
Write-Host 'Do not share the Runtime API key. It is entered locally and stored with Windows DPAPI for this user.'
