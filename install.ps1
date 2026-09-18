param(
  [string]$InstallDir = '',
  [switch]$InstallPrerequisites,
  [switch]$PowerMode,
  [switch]$GuiControl,
  [switch]$DisableGuiControl,
  [switch]$StartServer,
  [switch]$SkipTunnelClient,
  [string]$TunnelClientVersion = '0.0.14',
  [string]$SourceRef = 'main',
  [string]$ExpectedCommit = ''
)
$ErrorActionPreference = 'Stop'
$Repo = 'https://github.com/GOD13emad/ChatGPTRemoteCommander.git'
$RepoRaw = 'https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/main'
$script:ConfigChanged = $false

if ($SourceRef -notmatch '^[A-Za-z0-9._/-]{1,128}
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
    $dirty = (& git.exe -C $InstallDir status --porcelain --untracked-files=no)
    if ($LASTEXITCODE -ne 0) { throw 'git status failed' }
    if ($dirty) { throw 'Tracked local changes exist in InstallDir. Commit/stash them before update; installer will not overwrite them.' }

    Write-Host "Fetching source ref '$SourceRef' for existing installation: $InstallDir"
    & git.exe -C $InstallDir fetch --no-tags origin $SourceRef
    if ($LASTEXITCODE -ne 0) { throw "git fetch failed for SourceRef $SourceRef" }
    $resolved = (& git.exe -C $InstallDir rev-parse FETCH_HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $resolved -notmatch '^[0-9a-f]{40}$') { throw 'Could not resolve fetched source commit.' }
    if ($ExpectedCommit -and $resolved -ne $ExpectedCommit.ToLowerInvariant()) {
      throw "Fetched commit $resolved does not match ExpectedCommit $ExpectedCommit."
    }

    $current = (& git.exe -C $InstallDir rev-parse HEAD).Trim()
    if ($current -ne $resolved) {
      & git.exe -C $InstallDir merge-base --is-ancestor $current $resolved
      if ($LASTEXITCODE -ne 0) { throw 'Refusing non-fast-forward update/downgrade of active installation.' }
      & git.exe -C $InstallDir merge --ff-only $resolved
      if ($LASTEXITCODE -ne 0) { throw 'git fast-forward update failed' }
    }
  } elseif (Test-Path -LiteralPath $InstallDir) {
    throw "InstallDir exists but is not a Git checkout: $InstallDir"
  } else {
    Write-Host "Installing source ref '$SourceRef' to $InstallDir"
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    & git.exe -C $InstallDir init
    if ($LASTEXITCODE -ne 0) { throw 'git init failed' }
    & git.exe -C $InstallDir remote add origin $Repo
    if ($LASTEXITCODE -ne 0) { throw 'git remote add failed' }
    & git.exe -C $InstallDir fetch --depth 1 --no-tags origin $SourceRef
    if ($LASTEXITCODE -ne 0) { throw "git fetch failed for SourceRef $SourceRef" }
    $resolved = (& git.exe -C $InstallDir rev-parse FETCH_HEAD).Trim()
    if ($ExpectedCommit -and $resolved -ne $ExpectedCommit.ToLowerInvariant()) {
      throw "Fetched commit $resolved does not match ExpectedCommit $ExpectedCommit."
    }
    & git.exe -C $InstallDir checkout --detach $resolved
    if ($LASTEXITCODE -ne 0) { throw 'git checkout failed' }
  }

  $head = (& git.exe -C $InstallDir rev-parse HEAD).Trim()
  if ($ExpectedCommit -and $head -ne $ExpectedCommit.ToLowerInvariant()) {
    throw "Installed HEAD $head does not match ExpectedCommit $ExpectedCommit."
  }
  Write-Host "Source commit: $head"
}

function Write-TunnelClientState([string]$ExePath) {
  $varDir = Join-Path $InstallDir 'var'
  New-Item -ItemType Directory -Force -Path $varDir | Out-Null
  $state = [ordered]@{
    version = $TunnelClientVersion
    path = [IO.Path]::GetFullPath($ExePath)
    sha256 = (Get-FileHash -LiteralPath $ExePath -Algorithm SHA256).Hash.ToLowerInvariant()
    recordedAt = (Get-Date).ToUniversalTime().ToString('o')
  }
  $target = Join-Path $varDir 'tunnel-client.json'
  $tmp = "$target.tmp-$PID"
  [IO.File]::WriteAllText($tmp, ($state | ConvertTo-Json -Depth 4) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $tmp -Destination $target -Force
}

function Install-TunnelClient {
  if ($SkipTunnelClient) { return }
  $arch = if ($env:PROCESSOR_ARCHITECTURE -match 'ARM64') { 'arm64' } else { 'amd64' }
  $toolDir = Join-Path $InstallDir "tools\tunnel-client-v$TunnelClientVersion-windows-$arch"
  $exe = Join-Path $toolDir 'tunnel-client.exe'
  if (Test-Path -LiteralPath $exe) {
    Write-TunnelClientState $exe
    Write-Host "Tunnel client already installed and pinned: $exe"
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
    Write-TunnelClientState $exe
    Write-Host "Tunnel client verified, installed and pinned: $exe"
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Configure-LocalPolicy {
  $root = Join-Path $env:USERPROFILE 'source\repos'
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $localConfig = Join-Path $InstallDir 'config.local.json'
  $publicConfig = Join-Path $InstallDir 'config.json'

  $basePath = if (Test-Path -LiteralPath $localConfig) { $localConfig } else { $publicConfig }
  $policy = Get-Content -LiteralPath $basePath -Raw | ConvertFrom-Json -AsHashtable
  if (-not $policy) { throw "Could not parse policy: $basePath" }

  $policy['host'] = '127.0.0.1'
  $policy['port'] = 47831
  if (-not $policy.ContainsKey('allowedRoots')) { $policy['allowedRoots'] = @('%USERPROFILE%\source\repos') }
  if (-not $policy.ContainsKey('allowedPrograms')) { $policy['allowedPrograms'] = @('git','node','npm','npx','python','py','dotnet','cmake','ninja') }
  if (-not $policy.ContainsKey('auditLog')) { $policy['auditLog'] = 'var/audit.jsonl' }

  if (-not $policy.ContainsKey('powerMode') -or $policy['powerMode'] -isnot [Collections.IDictionary]) {
    $policy['powerMode'] = @{}
  }
  $pm = $policy['powerMode']
  if (-not $pm.ContainsKey('guiControl') -or $pm['guiControl'] -isnot [Collections.IDictionary]) {
    $pm['guiControl'] = @{}
  }
  $gui = $pm['guiControl']

  if ($PowerMode) {
    $pm['enabled'] = $true
    $pm['fullFilesystem'] = $true
    $pm['allowShell'] = $true
    $pm['allowProcessControl'] = $true
    $pm['allowPermanentDelete'] = $false
    if (-not $pm.ContainsKey('backupRoot')) { $pm['backupRoot'] = '%USERPROFILE%\.chatgpt-remote-commander\backups' }
    if (-not $pm.ContainsKey('maxFileBytes')) { $pm['maxFileBytes'] = 33554432 }
    if (-not $pm.ContainsKey('maxCommandMs')) { $pm['maxCommandMs'] = 600000 }
    if (-not $pm.ContainsKey('maxOutputBytes')) { $pm['maxOutputBytes'] = 4194304 }
    if (-not $pm.ContainsKey('maxTerminalBufferBytes')) { $pm['maxTerminalBufferBytes'] = 8388608 }
    if (-not $pm.ContainsKey('blockedShellPatterns')) {
      $pm['blockedShellPatterns'] = @(
        '(^|\s)shutdown(?:\.exe)?(?:\s|$)',
        'Restart-Computer',
        'Stop-Computer',
        '(^|\s)logoff(?:\.exe)?(?:\s|$)',
        'ExitWindowsEx'
      )
    }
    if ($GuiControl) { $gui['enabled'] = $true }
    elseif ($DisableGuiControl) { $gui['enabled'] = $false }
    elseif (-not $gui.ContainsKey('enabled')) { $gui['enabled'] = $false }
    $gui['allowScreenshot'] = $true
    $gui['allowMouse'] = $true
    $gui['allowKeyboard'] = $true
    $gui['allowWindowFocus'] = $true
    if (-not $gui.ContainsKey('maxScreenshotWidth')) { $gui['maxScreenshotWidth'] = 1600 }
    if (-not $gui.ContainsKey('maxScreenshotBytes')) { $gui['maxScreenshotBytes'] = 2097152 }
  } else {
    # Standard is a real transition even if config.local.json already exists.
    $pm['enabled'] = $false
    $pm['fullFilesystem'] = $false
    $pm['allowShell'] = $false
    $pm['allowProcessControl'] = $false
    $pm['allowPermanentDelete'] = $false
    $gui['enabled'] = $false
  }

  $json = $policy | ConvertTo-Json -Depth 20
  $newBytes = [Text.UTF8Encoding]::new($false).GetBytes($json + [Environment]::NewLine)
  $oldHash = if (Test-Path -LiteralPath $localConfig) { (Get-FileHash -LiteralPath $localConfig -Algorithm SHA256).Hash } else { '' }
  $tmp = "$localConfig.tmp-$PID"
  [IO.File]::WriteAllBytes($tmp, $newBytes)
  $newHash = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash

  if ($oldHash -ne $newHash) {
    if (Test-Path -LiteralPath $localConfig) {
      $backupDir = Join-Path $InstallDir 'var\config-backups'
      New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
      $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
      Copy-Item -LiteralPath $localConfig -Destination (Join-Path $backupDir "config.local.$stamp.json") -Force
    }
    Move-Item -LiteralPath $tmp -Destination $localConfig -Force
    $script:ConfigChanged = $true
  } else {
    Remove-Item -LiteralPath $tmp -Force
  }

  Write-Host "Local policy active: $localConfig"
  Write-Host "Mode: $(if ($PowerMode) {'POWER'} else {'STANDARD'})"
  Write-Host "GUI Control: $(if ($PowerMode -and $gui['enabled']) {'ENABLED'} else {'disabled'})"
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
function Get-ExpectedConfigHash {
  $active = if (Test-Path -LiteralPath (Join-Path $InstallDir 'config.local.json')) { Join-Path $InstallDir 'config.local.json' } else { Join-Path $InstallDir 'config.json' }
  return (Get-FileHash -LiteralPath $active -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Get-OwnedMcpProcess {
  $stateFile = Join-Path $InstallDir 'var\mcp-runtime.json'
  if (-not (Test-Path -LiteralPath $stateFile)) { return $null }
  try {
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    if ([IO.Path]::GetFullPath([string]$state.projectDir) -ne [IO.Path]::GetFullPath($InstallDir)) { return $null }
    $listener = Get-NetTCPConnection -State Listen -LocalPort 47831 -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener -or $listener.OwningProcess -ne [int]$state.pid) { return $null }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.Name -ne 'node.exe' -or $proc.CommandLine -notmatch 'src[\\/]server-v0\.3\.mjs') { return $null }
    return $proc
  } catch { return $null }
}

function Start-LocalServer {
  if (-not $StartServer) { return }

  $expectedVersion = (Get-Content -LiteralPath (Join-Path $InstallDir 'package.json') -Raw | ConvertFrom-Json).version
  $expectedConfig = Get-ExpectedConfigHash
  $health = $null
  try { $health = Invoke-RestMethod 'http://127.0.0.1:47831/health' -TimeoutSec 2 } catch { }

  if ($health.ok -and $health.version -eq $expectedVersion -and $health.configSha256 -eq $expectedConfig) {
    Write-Host "MCP server is already healthy at version $expectedVersion with matching config."
    return
  }

  $listener = Get-NetTCPConnection -State Listen -LocalPort 47831 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $owned = Get-OwnedMcpProcess
    if (-not $owned) { throw 'Port 47831 is not owned by this installation; refusing automatic stop.' }
    Write-Host "Restarting owned MCP for version/config change..."
    Stop-Process -Id $owned.ProcessId -Force
  }

  # If the registered supervisor is active, let it restart the exact installation.
  $rootPattern = [regex]::Escape([IO.Path]::GetFullPath($InstallDir))
  $supervisor = Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'autostart-windows\.ps1' -and $_.CommandLine -match $rootPattern } |
    Select-Object -First 1

  if (-not $supervisor) {
    $escaped = $InstallDir.Replace("'", "''")
    $cmd = "Set-Location '$escaped'; npm start"
    Start-Process -FilePath 'pwsh.exe' -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-Command',$cmd) -WindowStyle Hidden | Out-Null
  }

  foreach ($i in 1..40) {
    Start-Sleep -Milliseconds 500
    try {
      $health = Invoke-RestMethod 'http://127.0.0.1:47831/health' -TimeoutSec 1
      if ($health.ok -and $health.version -eq $expectedVersion -and $health.configSha256 -eq $expectedConfig) {
        Write-Host "Server ready at version $expectedVersion with matching configuration."
        return
      }
    } catch { }
  }
  throw "Server startup did not reach expected version/config."
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
$effective = Get-Content -LiteralPath (Join-Path $InstallDir 'config.local.json') -Raw | ConvertFrom-Json
Write-Host "Mode: $(if ($effective.powerMode.enabled) { if ($effective.powerMode.guiControl.enabled) {'POWER + GUI'} else {'POWER'} } else {'STANDARD'})"
Write-Host ''
Write-Host 'Next: create your own OpenAI Secure MCP Tunnel and Runtime API key, then run once:'
Write-Host "  pwsh.exe -NoProfile -File `"$InstallDir\connect-chatgpt.ps1`""
Write-Host 'Persistent enrollment then manages MCP + tunnel automatically; no repeated Tunnel ID/port/key entry is needed.'
Write-Host 'Do not share the Runtime API key. It is entered locally and stored with Windows DPAPI for this user.'
) { throw 'Invalid -SourceRef.' }
if ($ExpectedCommit -and $ExpectedCommit -notmatch '^[0-9a-fA-F]{40}
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
) { throw 'Invalid -ExpectedCommit SHA.' }

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
