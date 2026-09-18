param(
  [string]$InstallDir = '',
  [switch]$InstallPrerequisites,
  [switch]$PowerMode,
  [switch]$StandardMode,
  [switch]$GuiControl,
  [switch]$DisableGuiControl,
  [switch]$StartServer,
  [switch]$SkipTunnelClient,
  [string]$TunnelClientVersion = '0.0.14',
  [string]$SourceRef = 'v0.5.0',
  [string]$ExpectedCommit = ''
)
$ErrorActionPreference = 'Stop'
$Repo = 'https://github.com/GOD13emad/ChatGPTRemoteCommander.git'
$script:DetectedFromAutostart = $false
$script:InstalledCommit = $null
$script:EffectivePowerMode = $false
$script:EffectiveGuiControl = $false

if ($PowerMode -and $StandardMode) { throw 'Use only one of -PowerMode or -StandardMode.' }
if ($GuiControl -and $DisableGuiControl) { throw 'Use only one of -GuiControl or -DisableGuiControl.' }
if ([string]::IsNullOrWhiteSpace($SourceRef) -or $SourceRef.StartsWith('-') -or $SourceRef.Contains('..') -or $SourceRef -notmatch '^[A-Za-z0-9._/-]+$') { throw 'Invalid -SourceRef.' }
if ($ExpectedCommit -and $ExpectedCommit -notmatch '^[0-9a-fA-F]{40}$') { throw 'Invalid -ExpectedCommit.' }

function Refresh-Path {
  $machine=[Environment]::GetEnvironmentVariable('Path','Machine')
  $user=[Environment]::GetEnvironmentVariable('Path','User')
  $env:Path="$machine;$user"
}

function Require-Windows {
  if ([string]::IsNullOrWhiteSpace($env:WINDIR)) { throw 'This installer supports Windows only. Use install.sh on Linux.' }
}

function Resolve-InstallDir {
  if ($InstallDir) { return [IO.Path]::GetFullPath($InstallDir) }
  $runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  $runValue=(Get-ItemProperty -Path $runKey -Name 'ChatGPTRemoteCommander' -ErrorAction SilentlyContinue).ChatGPTRemoteCommander
  if ($runValue) {
    $m=[regex]::Match([string]$runValue,'-File\s+"([^"]*autostart-windows\.ps1)"','IgnoreCase')
    if (-not $m.Success) { $m=[regex]::Match([string]$runValue,'-File\s+([^\s]+autostart-windows\.ps1)','IgnoreCase') }
    if ($m.Success) {
      $candidate=Split-Path -Parent $m.Groups[1].Value
      if (Test-Path -LiteralPath (Join-Path $candidate '.git')) {
        $script:DetectedFromAutostart=$true
        $resolved=[IO.Path]::GetFullPath($candidate)
        Write-Host "Detected active installation from Windows autostart: $resolved"
        return $resolved
      }
    }
  }
  $stateRoot=Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander'
  if (Test-Path -LiteralPath (Join-Path $stateRoot '.git')) {
    $resolved=[IO.Path]::GetFullPath($stateRoot)
    Write-Host "Detected legacy installation: $resolved"
    return $resolved
  }
  $resolved=Join-Path $stateRoot 'app'
  Write-Host "Using application directory: $resolved"
  return $resolved
}

function Ensure-Command([string]$Name,[string]$WingetId) {
  if (Get-Command $Name -ErrorAction SilentlyContinue) { return }
  if (-not $InstallPrerequisites) { throw "$Name is required. Re-run with -InstallPrerequisites or install $WingetId manually." }
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw "winget is required to install $Name automatically." }
  & winget.exe install --id $WingetId -e --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "winget failed installing $WingetId ($LASTEXITCODE)" }
  Refresh-Path
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "$Name was installed but is not visible on PATH. Open a new PowerShell and re-run." }
}

function Ensure-Prerequisites {
  Ensure-Command 'git.exe' 'Git.Git'
  Ensure-Command 'node.exe' 'OpenJS.NodeJS.LTS'
  Ensure-Command 'pwsh.exe' 'Microsoft.PowerShell'
  $major=[int]((& node.exe --version).Trim().TrimStart('v').Split('.')[0])
  if ($major -lt 22) { throw "Node.js 22+ is required; found $major." }
}

function Resolve-SourceCommit([string]$RepoDir) {
  if ($SourceRef -match '^[0-9a-fA-F]{40}$') {
    & git.exe -C $RepoDir fetch --depth 1 origin $SourceRef
    if ($LASTEXITCODE -ne 0) { throw "git fetch commit failed for $SourceRef" }
    return (& git.exe -C $RepoDir rev-parse FETCH_HEAD).Trim()
  }
  if ($SourceRef -match '^v[0-9]+\.[0-9]+\.[0-9]+(?:[-A-Za-z0-9.]*)?$') {
    $spec='refs/tags/{0}:refs/tags/{0}' -f $SourceRef
    & git.exe -C $RepoDir fetch --force --depth 1 origin $spec
    if ($LASTEXITCODE -ne 0) { throw "git fetch tag failed for $SourceRef" }
    return (& git.exe -C $RepoDir rev-parse ('refs/tags/{0}^{{commit}}' -f $SourceRef)).Trim()
  }
  $spec='+refs/heads/{0}:refs/remotes/origin/{0}' -f $SourceRef
  & git.exe -C $RepoDir fetch --force --depth 1 origin $spec
  if ($LASTEXITCODE -ne 0) { throw "git fetch branch failed for $SourceRef" }
  return (& git.exe -C $RepoDir rev-parse ('refs/remotes/origin/{0}^{{commit}}' -f $SourceRef)).Trim()
}

function Install-Source {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $InstallDir) | Out-Null
  if (Test-Path -LiteralPath (Join-Path $InstallDir '.git')) {
    Write-Host "Updating existing installation from pinned ref: $SourceRef"
    & git.exe -C $InstallDir diff --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Tracked working-tree changes detected; refusing installer overwrite.' }
    & git.exe -C $InstallDir diff --cached --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Staged changes detected; refusing installer overwrite.' }
  } elseif (Test-Path -LiteralPath $InstallDir) {
    throw "InstallDir exists but is not a Git checkout: $InstallDir"
  } else {
    & git.exe clone --depth 1 --no-checkout $Repo $InstallDir
    if ($LASTEXITCODE -ne 0) { throw 'git clone failed' }
  }
  $target=Resolve-SourceCommit $InstallDir
  if ($target -notmatch '^[0-9a-fA-F]{40}$') { throw "Could not resolve pinned source commit for $SourceRef" }
  if ($ExpectedCommit -and $target.ToLowerInvariant() -ne $ExpectedCommit.ToLowerInvariant()) { throw "Pinned source mismatch: ref $SourceRef resolved to $target but release expects $ExpectedCommit" }
  & git.exe -C $InstallDir checkout --detach --force $target
  if ($LASTEXITCODE -ne 0) { throw "git checkout failed for pinned commit $target" }
  $actual=(& git.exe -C $InstallDir rev-parse HEAD).Trim()
  if ($actual -ne $target) { throw "Installed source mismatch: expected $target actual $actual" }
  $script:InstalledCommit=$actual
  Write-Host "Pinned source installed: ref=$SourceRef commit=$actual"
}

function Install-TunnelClient {
  if ($SkipTunnelClient) { Write-Host 'Tunnel client installation skipped; existing active manifest is preserved.'; return }
  $arch=if($env:PROCESSOR_ARCHITECTURE -match 'ARM64'){'arm64'}else{'amd64'}
  $toolDir=Join-Path $InstallDir "tools\tunnel-client-v$TunnelClientVersion-windows-$arch"
  $exe=Join-Path $toolDir 'tunnel-client.exe'
  $file="tunnel-client-v$TunnelClientVersion-windows-$arch.zip"
  $base="https://github.com/openai/tunnel-client/releases/download/v$TunnelClientVersion"
  $tmp=Join-Path $env:LOCALAPPDATA "ChatGPTRemoteCommander\downloads\$([guid]::NewGuid().ToString('N'))"
  $extract=Join-Path $tmp 'verified'
  New-Item -ItemType Directory -Force -Path $tmp,$extract | Out-Null
  try {
    Invoke-WebRequest "$base/SHA256SUMS.txt" -OutFile (Join-Path $tmp 'SHA256SUMS.txt')
    Invoke-WebRequest "$base/$file" -OutFile (Join-Path $tmp $file)
    $line=Get-Content (Join-Path $tmp 'SHA256SUMS.txt') | Where-Object { $_ -match [regex]::Escape($file) } | Select-Object -First 1
    if (-not $line) { throw 'Could not find tunnel-client archive in SHA256SUMS.txt' }
    $expectedArchiveHash=($line -split '\s+')[0].ToLowerInvariant()
    $actualArchiveHash=(Get-FileHash (Join-Path $tmp $file) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expectedArchiveHash -ne $actualArchiveHash) { throw "Tunnel client archive checksum mismatch: expected $expectedArchiveHash actual $actualArchiveHash" }
    Expand-Archive -LiteralPath (Join-Path $tmp $file) -DestinationPath $extract -Force
    $verifiedExe=Join-Path $extract 'tunnel-client.exe'
    if (-not (Test-Path -LiteralPath $verifiedExe -PathType Leaf)) { throw 'tunnel-client.exe missing from verified archive' }
    $verifiedExeHash=(Get-FileHash -LiteralPath $verifiedExe -Algorithm SHA256).Hash.ToLowerInvariant()
    $replace=-not (Test-Path -LiteralPath $exe -PathType Leaf)
    if (-not $replace) { $replace=((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $verifiedExeHash) }
    if ($replace) {
      Remove-Item -LiteralPath $toolDir -Recurse -Force -ErrorAction SilentlyContinue
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $toolDir) | Out-Null
      Move-Item -LiteralPath $extract -Destination $toolDir
    }
    $installedHash=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($installedHash -ne $verifiedExeHash) { throw 'Installed tunnel-client executable does not match verified release archive.' }
    $manifest=[ordered]@{version=$TunnelClientVersion;relativePath=[IO.Path]::GetRelativePath($InstallDir,$exe);sha256=$verifiedExeHash;archiveSha256=$expectedArchiveHash}|ConvertTo-Json -Depth 4
    $manifestPath=Join-Path $InstallDir 'tools\tunnel-client.active.json'
    $tempManifest="$manifestPath.tmp-$PID"
    [IO.File]::WriteAllText($tempManifest,$manifest,[Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tempManifest -Destination $manifestPath -Force
    Write-Host "Tunnel client verified from official archive and pinned: $exe"
  } finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}

function Configure-LocalPolicy {
  $local=Join-Path $InstallDir 'config.local.json'
  $public=Join-Path $InstallDir 'config.json'
  $workspace=Join-Path $env:USERPROFILE 'source\repos'
  New-Item -ItemType Directory -Force -Path $workspace | Out-Null
  $mode=if($PowerMode){'power'}elseif($StandardMode){'standard'}elseif(Test-Path -LiteralPath $local){'preserve'}else{'standard'}
  $gui=if($GuiControl){'enable'}elseif($DisableGuiControl){'disable'}else{'preserve'}
  if ((Test-Path -LiteralPath $local) -and ($mode -ne 'preserve' -or $gui -ne 'preserve')) {
    $backupDir=Join-Path $InstallDir 'var\config-backups'
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    Copy-Item -LiteralPath $local -Destination (Join-Path $backupDir ("config.local.{0}-{1}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmssfff'),$PID)) -Force
  }
  $helper=Join-Path $InstallDir 'tools\merge-config.mjs'
  $resultText=& node.exe $helper --config $local --public $public --mode $mode --gui $gui --workspace $workspace --platform windows
  if ($LASTEXITCODE -ne 0) { throw 'Local policy merge failed.' }
  $result=$resultText|ConvertFrom-Json
  $script:EffectivePowerMode=[bool]$result.powerMode
  $script:EffectiveGuiControl=[bool]$result.guiControl
  Write-Host "Local policy: Power=$($script:EffectivePowerMode) GUI=$($script:EffectiveGuiControl) changed=$($result.changed)"
}

function Test-Installation {
  Push-Location $InstallDir
  try {
    & npm.cmd run check; if($LASTEXITCODE -ne 0){throw 'npm run check failed'}
    & npm.cmd test; if($LASTEXITCODE -ne 0){throw 'npm test failed'}
    & npm.cmd run audit; if($LASTEXITCODE -ne 0){throw 'npm run audit failed'}
  } finally { Pop-Location }
}

function String-Sha256([string]$Value) {
  return ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Value)))).ToLowerInvariant()
}

function Runtime-Identity {
  $root=[IO.Path]::GetFullPath($InstallDir).ToLowerInvariant()
  $cfg=if(Test-Path -LiteralPath (Join-Path $InstallDir 'config.local.json')){Join-Path $InstallDir 'config.local.json'}else{Join-Path $InstallDir 'config.json'}
  return [pscustomobject]@{
    InstanceId=(String-Sha256 $root).Substring(0,24)
    ConfigSha256=(Get-FileHash -LiteralPath $cfg -Algorithm SHA256).Hash.ToLowerInvariant()
    Version=(Get-Content -LiteralPath (Join-Path $InstallDir 'package.json') -Raw|ConvertFrom-Json).version
  }
}

function Get-Health {
  try{return Invoke-RestMethod 'http://127.0.0.1:47831/health' -TimeoutSec 2}catch{return $null}
}

function Health-Matches($Health,$Expected) {
  return ($Health -and $Health.ok -and $Health.version -eq $Expected.Version -and $Health.instanceId -eq $Expected.InstanceId -and $Health.configSha256 -eq $Expected.ConfigSha256)
}

function Start-LocalServer {
  if(-not $StartServer){return}
  $expected=Runtime-Identity
  $health=Get-Health
  $legacyOwned=$false
  if($health -and $health.ok -and [string]::IsNullOrWhiteSpace([string]$health.instanceId) -and $script:DetectedFromAutostart){$legacyOwned=$true}
  elseif($health -and $health.ok -and $health.instanceId -ne $expected.InstanceId){throw 'Port 47831 is serving a different Remote Commander instance; refusing to stop it.'}
  if((Health-Matches $health $expected) -and -not $legacyOwned){Write-Host 'MCP server already matches expected version/config identity.';return}
  if($health -and $health.ok){
    $listener=Get-NetTCPConnection -State Listen -LocalPort 47831 -ErrorAction SilentlyContinue|Select-Object -First 1
    if(-not $listener){throw 'MCP health answered but listener was not found.'}
    $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if($proc.Name -ne 'node.exe' -or $proc.CommandLine -notmatch 'server-v0\.3\.mjs'){throw 'Port 47831 is owned by an unexpected process.'}
    Stop-Process -Id $listener.OwningProcess -Force
    foreach($i in 1..12){Start-Sleep -Milliseconds 250;$h=Get-Health;if(Health-Matches $h $expected){Write-Host 'Supervisor restarted expected MCP.';return}}
  } elseif(Get-NetTCPConnection -State Listen -LocalPort 47831 -ErrorAction SilentlyContinue){throw 'Port 47831 is occupied but Remote Commander health is unavailable.'}
  $varDir=Join-Path $InstallDir 'var';New-Item -ItemType Directory -Force -Path $varDir|Out-Null
  $node=(Get-Command node.exe -ErrorAction Stop).Source
  Start-Process -FilePath $node -ArgumentList @('src/server-v0.3.mjs') -WorkingDirectory $InstallDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $varDir 'mcp-install.out.log') -RedirectStandardError (Join-Path $varDir 'mcp-install.err.log') | Out-Null
  foreach($i in 1..40){Start-Sleep -Milliseconds 250;$h=Get-Health;if(Health-Matches $h $expected){Write-Host "Server started at version $($expected.Version): http://127.0.0.1:47831/mcp";return}}
  throw 'Server did not reach expected version/config identity.'
}

function Write-RuntimeState {
  $expected=Runtime-Identity
  $varDir=Join-Path $InstallDir 'var';New-Item -ItemType Directory -Force -Path $varDir|Out-Null
  $state=[ordered]@{installRoot=[IO.Path]::GetFullPath($InstallDir);sourceRef=$SourceRef;sourceCommit=$script:InstalledCommit;packageVersion=$expected.Version;instanceId=$expected.InstanceId;configSha256=$expected.ConfigSha256;updatedAt=(Get-Date).ToString('o')}|ConvertTo-Json -Depth 5
  $path=Join-Path $varDir 'runtime-state.json';$tmp="$path.tmp-$PID"
  [IO.File]::WriteAllText($tmp,$state,[Text.UTF8Encoding]::new($false));Move-Item -LiteralPath $tmp -Destination $path -Force
}

Require-Windows
$InstallDir=Resolve-InstallDir
Ensure-Prerequisites
Install-Source
Install-TunnelClient
Configure-LocalPolicy
Test-Installation
Write-RuntimeState
Start-LocalServer

Write-Host ''
Write-Host 'INSTALL_PASS'
Write-Host "Installed at: $InstallDir"
Write-Host "Mode: $(if($script:EffectivePowerMode){if($script:EffectiveGuiControl){'POWER + GUI'}else{'POWER'}}else{'STANDARD'})"
Write-Host "Source: ref=$SourceRef commit=$script:InstalledCommit expected=$(if($ExpectedCommit){$ExpectedCommit}else{'not-stamped'})"
Write-Host ''
Write-Host 'Next: create your OpenAI Secure MCP Tunnel and Runtime API key, then run once:'
Write-Host ('  pwsh.exe -NoProfile -File "{0}"' -f (Join-Path $InstallDir 'connect-chatgpt.ps1'))
Write-Host 'Persistent enrollment manages MCP + tunnel automatically; no repeated Tunnel ID/port/key entry is needed.'
Write-Host 'Do not share the Runtime API key. It is stored with Windows DPAPI for this user.'
