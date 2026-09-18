param(
  [string]$InstallDir = '',
  [switch]$InstallPrerequisites,
  [switch]$PowerMode,
  [switch]$GuiControl,
  [switch]$DisableGuiControl,
  [switch]$StartServer,
  [switch]$SkipTunnelClient,
  [string]$TunnelClientVersion = '0.0.14'
)
$ErrorActionPreference = 'Stop'
$Repo = 'https://github.com/GOD13emad/ChatGPTRemoteCommander.git'
$RepoRaw = 'https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/main'

if ($GuiControl -and $DisableGuiControl) { throw 'Use only one of -GuiControl or -DisableGuiControl.' }
if ($GuiControl -and -not $PowerMode) { throw '-GuiControl requires -PowerMode.' }
$GuiControlWasSpecified = $PSBoundParameters.ContainsKey('GuiControl') -or $PSBoundParameters.ContainsKey('DisableGuiControl')

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path','Machine')
  $user = [Environment]::GetEnvironmentVariable('Path','User')
  $env:Path = "$machine;$user"
}

function Require-Windows {
  if ([string]::IsNullOrWhiteSpace($env:WINDIR)) { throw 'This installer currently supports Windows only.' }
}

function Resolve-InstallDir {
  if (-not [string]::IsNullOrWhiteSpace($InstallDir)) {
    return [IO.Path]::GetFullPath($InstallDir)
  }

  $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  $runValue = (Get-ItemProperty -Path $runKey -Name 'ChatGPTRemoteCommander' -ErrorAction SilentlyContinue).ChatGPTRemoteCommander
  if ($runValue) {
    $m = [regex]::Match([string]$runValue, '-File\s+"([^"]*autostart-windows\.ps1)"', 'IgnoreCase')
    if (-not $m.Success) {
      $m = [regex]::Match([string]$runValue, '-File\s+([^\s]+autostart-windows\.ps1)', 'IgnoreCase')
    }
    if ($m.Success) {
      $candidate = Split-Path -Parent $m.Groups[1].Value
      if (Test-Path -LiteralPath (Join-Path $candidate '.git')) {
        $resolved = [IO.Path]::GetFullPath($candidate)
        Write-Host "Detected active installation from Windows autostart: $resolved"
        return $resolved
      }
    }
  }

  $stateRoot = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander'
  if (Test-Path -LiteralPath (Join-Path $stateRoot '.git')) {
    $resolved = [IO.Path]::GetFullPath($stateRoot)
    Write-Host "Detected legacy installation: $resolved"
    return $resolved
  }

  $resolved = Join-Path $stateRoot 'app'
  Write-Host "Using application directory: $resolved"
  return $resolved
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
  $existingGui = $false
  if (Test-Path -LiteralPath $localConfig) {
    try {
      $existing = Get-Content -LiteralPath $localConfig -Raw | ConvertFrom-Json
      $existingGui = ($existing.powerMode.guiControl.enabled -eq $true)
    } catch { }
  }

  $guiEnabled = if ($GuiControl) { $true } elseif ($DisableGuiControl) { $false } elseif ($GuiControlWasSpecified) { $false } else { $existingGui }

  $policy = [ordered]@{
    host = '127.0.0.1'
    port = 47831
    allowedRoots = @('%USERPROFILE%\source\repos')
    allowedPrograms = @('git','node','npm','npx','python','py','dotnet','cmake','ninja')
    maxReadBytes = 524288
    maxWriteBytes = 524288
    maxCommandMs = 120000
    auditLog = 'var/audit.jsonl'
    powerMode = [ordered]@{
      enabled = $true
      fullFilesystem = $true
      allowShell = $true
      allowProcessControl = $true
      allowPermanentDelete = $false
      backupRoot = '%USERPROFILE%\.chatgpt-remote-commander\backups'
      maxFileBytes = 33554432
      maxCommandMs = 600000
      maxOutputBytes = 4194304
      maxTerminalBufferBytes = 8388608
      guiControl = [ordered]@{
        enabled = [bool]$guiEnabled
        allowScreenshot = $true
        allowMouse = $true
        allowKeyboard = $true
        allowWindowFocus = $true
      }
      blockedShellPatterns = @(
        '(^|\s)shutdown(?:\.exe)?(?:\s|$)',
        'Restart-Computer',
        'Stop-Computer',
        '(^|\s)logoff(?:\.exe)?(?:\s|$)',
        'ExitWindowsEx'
      )
    }
  }

  $json = $policy | ConvertTo-Json -Depth 10
  [IO.File]::WriteAllText($localConfig, $json, [Text.UTF8Encoding]::new($false))
  Write-Host "Power Mode local policy created: $localConfig"
  Write-Host "GUI Control: $(if ($guiEnabled) {'ENABLED'} else {'disabled'})"
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

  $expectedVersion = (Get-Content -LiteralPath (Join-Path $InstallDir 'package.json') -Raw | ConvertFrom-Json).version
  $health = $null
  try { $health = Invoke-RestMethod 'http://127.0.0.1:47831/health' -TimeoutSec 2 } catch { }

  if ($health.ok -and $health.version -eq $expectedVersion) {
    Write-Host "MCP server is already running and healthy at version $expectedVersion."
    return
  }

  if ($health.ok -and $health.version -ne $expectedVersion) {
    Write-Host "Updating running MCP from version $($health.version) to $expectedVersion..."
    $listener = Get-NetTCPConnection -State Listen -LocalPort 47831 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
      if ($proc.Name -eq 'node.exe' -and $proc.CommandLine -match 'server-v0\.3\.mjs') {
        Stop-Process -Id $listener.OwningProcess -Force
        foreach ($i in 1..20) {
          Start-Sleep -Milliseconds 500
          try {
            $health = Invoke-RestMethod 'http://127.0.0.1:47831/health' -TimeoutSec 1
            if ($health.ok -and $health.version -eq $expectedVersion) {
              Write-Host "Supervisor restarted MCP at version $expectedVersion."
              return
            }
          } catch { }
        }
      } else {
        throw "Port 47831 is owned by an unexpected process; refusing to stop it automatically."
      }
    }
  }

  $escaped = $InstallDir.Replace("'", "''")
  $cmd = "Set-Location '$escaped'; `$Host.UI.RawUI.WindowTitle='ChatGPT Remote Commander'; npm start"
  Start-Process -FilePath 'pwsh.exe' -ArgumentList @('-NoExit','-NoProfile','-Command',$cmd) | Out-Null

  foreach ($i in 1..20) {
    Start-Sleep -Milliseconds 500
    try {
      $health = Invoke-RestMethod 'http://127.0.0.1:47831/health' -TimeoutSec 1
      if ($health.ok -and $health.version -eq $expectedVersion) {
        Write-Host "Server started successfully at version ${expectedVersion}: http://127.0.0.1:47831/mcp"
        return
      }
    } catch { }
  }
  throw "Server startup did not reach expected version $expectedVersion."
}

Require-Windows
$InstallDir = Resolve-InstallDir
Ensure-Prerequisites
Install-Source
Install-TunnelClient
Configure-LocalPolicy
Test-Installation
Start-LocalServer

Write-Host ''
Write-Host 'INSTALL_PASS'
Write-Host "Installed at: $InstallDir"
Write-Host "Mode: $(if ($PowerMode) { if ($GuiControl) {'POWER + GUI (filesystem/shell/process + interactive desktop control)'} else {'POWER'} } else {'STANDARD'})"
Write-Host ''
Write-Host 'Next: create your own OpenAI Secure MCP Tunnel and Runtime API key, then run once:'
Write-Host "  pwsh.exe -NoProfile -File `"$InstallDir\connect-chatgpt.ps1`""
Write-Host 'Persistent enrollment then manages MCP + tunnel automatically; no repeated Tunnel ID/port/key entry is needed.'
Write-Host 'Do not share the Runtime API key. It is entered locally and stored with Windows DPAPI for this user.'
