param(
  [string]$InstallDir = '',
  [switch]$InstallPrerequisites,
  [switch]$PowerMode,
  [switch]$GuiControl,
  [switch]$DisableGuiControl,
  [switch]$StartServer,
  [switch]$SkipTunnelClient,
  [switch]$NonInteractive,
  [string]$TunnelClientVersion = '0.0.14',
  [string]$SourceRef = 'v0.8.0',
  [string]$ExpectedCommit = ''
)
$ErrorActionPreference = 'Stop'

$Repo = 'https://github.com/GOD13emad/ChatGPTRemoteCommander.git'
$InstallDirWasExplicit = $PSBoundParameters.ContainsKey('InstallDir')
$StateRoot = Join-Path $env:LOCALAPPDATA 'ChatGPTRemoteCommander'
$ControlRoot = Join-Path $StateRoot 'control'
$ManagedPath = Join-Path $ControlRoot 'managed.json'
$BlueGreenRegistryPath = 'HKCU:\Software\ChatGPTRemoteCommander\BlueGreen'

if ($GuiControl -and $DisableGuiControl) {
  throw 'Use only one of -GuiControl or -DisableGuiControl.'
}
if ($GuiControl -and -not $PowerMode) {
  throw '-GuiControl requires -PowerMode.'
}
if ($SourceRef -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$' -or $SourceRef -match '\.\.' -or $SourceRef -match '//') {
  throw 'Invalid -SourceRef.'
}
if ([string]::IsNullOrWhiteSpace($ExpectedCommit)) {
  throw 'EXPECTED_COMMIT_REQUIRED'
}
if ($ExpectedCommit -notmatch '^[0-9a-fA-F]{40}$') {
  throw 'Invalid -ExpectedCommit SHA.'
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path','Machine')
  $user = [Environment]::GetEnvironmentVariable('Path','User')
  $env:Path = "$machine;$user"
}

function Require-Windows {
  if ([string]::IsNullOrWhiteSpace($env:WINDIR)) {
    throw 'This installer currently supports Windows only.'
  }
}

function Resolve-InstallDir {
  if (-not [string]::IsNullOrWhiteSpace($InstallDir)) {
    return [IO.Path]::GetFullPath($InstallDir)
  }

  $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  $runValue = (Get-ItemProperty -Path $runKey -Name 'ChatGPTRemoteCommander' -ErrorAction SilentlyContinue).ChatGPTRemoteCommander
  if ($runValue) {
    $match = [regex]::Match([string]$runValue, '-File\s+"([^"]*autostart-windows\.ps1)"', 'IgnoreCase')
    if (-not $match.Success) {
      $match = [regex]::Match([string]$runValue, '-File\s+([^\s]+autostart-windows\.ps1)', 'IgnoreCase')
    }
    if ($match.Success) {
      $candidate = Split-Path -Parent $match.Groups[1].Value
      if (Test-Path -LiteralPath (Join-Path $candidate '.git')) {
        $resolved = [IO.Path]::GetFullPath($candidate)
        Write-Host "Detected active installation from Windows autostart: $resolved"
        return $resolved
      }
    }
  }

  if (Test-Path -LiteralPath (Join-Path $StateRoot '.git')) {
    $resolved = [IO.Path]::GetFullPath($StateRoot)
    Write-Host "Detected legacy installation: $resolved"
    return $resolved
  }

  $resolved = Join-Path $StateRoot 'app'
  Write-Host "Using application directory: $resolved"
  return $resolved
}

function Assert-NoReparseAncestorChain([string]$Path, [string]$Code) {
  $cursor = [IO.Path]::GetFullPath($Path)
  while (-not [string]::IsNullOrWhiteSpace($cursor)) {
    if (Test-Path -LiteralPath $cursor) {
      $item = Get-Item -LiteralPath $cursor -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.LinkType) { throw $Code }
    }
    $parent = [IO.Directory]::GetParent($cursor)
    if ($null -eq $parent -or $parent.FullName -eq $cursor) { break }
    $cursor = $parent.FullName
  }
  return [IO.Path]::GetFullPath($Path)
}

function Assert-SafeLegacyRoot([string]$Path) {
  $base = [IO.Path]::GetFullPath($StateRoot).TrimEnd('\')
  $legacy = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  if ($legacy -eq $base) { throw 'LEGACY_ROOT_EQUALS_STATE_ROOT_REFUSED' }
  if (-not $legacy.StartsWith($base + '\',[StringComparison]::OrdinalIgnoreCase)) {
    throw 'LEGACY_ROOT_OUTSIDE_STATE_ROOT_REFUSED'
  }
  if (-not (Test-Path -LiteralPath $legacy -PathType Container)) { throw 'LEGACY_ROOT_MISSING' }
  [void](Assert-NoReparseAncestorChain $legacy 'LEGACY_ROOT_REPARSE_ANCESTOR_REFUSED')
  $gitMarker = Join-Path $legacy '.git'
  if (-not (Test-Path -LiteralPath $gitMarker)) { throw 'LEGACY_ROOT_GIT_MARKER_MISSING' }
  $gitItem = Get-Item -LiteralPath $gitMarker -Force
  if (($gitItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $gitItem.LinkType) {
    throw 'LEGACY_ROOT_GIT_MARKER_REPARSE_REFUSED'
  }
  return $legacy
}

function Resolve-DeploymentStateSignals(
  [bool]$ManagedExists,
  [bool]$RunnerExists,
  [bool]$ControlExists,
  [bool]$RegistryExists,
  [bool]$LegacyExists,
  [bool]$InstallPathExists,
  [bool]$ExplicitInstallDir
) {
  if ($ManagedExists -or $RegistryExists) {
    if (-not ($ManagedExists -and $RunnerExists -and $ControlExists -and $RegistryExists)) { throw 'BLUE_GREEN_STATE_PARTIAL' }
    if ($ExplicitInstallDir) { throw 'BLUE_GREEN_MANAGED_EXPLICIT_INSTALL_DIR_REFUSED' }
    return 'Managed'
  }
  if ($RunnerExists -or $ControlExists) {
    if (-not ($RunnerExists -and $ControlExists -and $LegacyExists)) { throw 'BLUE_GREEN_STATE_PARTIAL' }
    return 'Legacy'
  }
  if ($LegacyExists) { return 'Legacy' }
  if ($InstallPathExists) { throw 'LEGACY_INSTALL_STATE_PARTIAL' }
  return 'Fresh'
}

function Get-DeploymentState {
  $runner = Join-Path $ControlRoot 'RUN_BLUEGREEN.ps1'
  $managedExists = Test-Path -LiteralPath $ManagedPath -PathType Leaf
  $runnerExists = Test-Path -LiteralPath $runner -PathType Leaf
  $controlExists = Test-Path -LiteralPath $ControlRoot
  $registryExists = Test-Path -LiteralPath $BlueGreenRegistryPath
  $legacyExists = Test-Path -LiteralPath (Join-Path $InstallDir '.git')
  $installPathExists = Test-Path -LiteralPath $InstallDir
  $registeredPath = ''

  foreach ($controlFile in @($ManagedPath,$runner)) {
    if (Test-Path -LiteralPath $controlFile) {
      [void](Assert-NoReparseAncestorChain $controlFile 'BLUE_GREEN_CONTROL_REPARSE_ANCESTOR_REFUSED')
    }
  }
  if ($registryExists) {
    $registeredPath = [string](Get-ItemProperty -LiteralPath $BlueGreenRegistryPath -Name ManagedStatePath -ErrorAction SilentlyContinue).ManagedStatePath
  }

  if (((Test-Path -LiteralPath $ManagedPath) -and -not $managedExists) -or ((Test-Path -LiteralPath $runner) -and -not $runnerExists)) { throw 'BLUE_GREEN_STATE_PARTIAL' }
  $state = Resolve-DeploymentStateSignals $managedExists $runnerExists $controlExists $registryExists $legacyExists $installPathExists $InstallDirWasExplicit
  if ($state -eq 'Legacy') {
    [void](Assert-SafeLegacyRoot $InstallDir)
    return $state
  }
  if ($state -eq 'Managed') {
    if ([string]::IsNullOrWhiteSpace($registeredPath)) { throw 'BLUE_GREEN_STATE_PARTIAL' }
    if ([IO.Path]::GetFullPath($registeredPath) -ne [IO.Path]::GetFullPath($ManagedPath)) {
      throw 'BLUE_GREEN_REGISTRY_MISMATCH'
    }
    try {
      $managed = Get-Content -LiteralPath $ManagedPath -Raw | ConvertFrom-Json
    } catch {
      throw 'BLUE_GREEN_MANAGED_STATE_INVALID'
    }
    try {
      $managedMismatch = [int]$managed.schema -ne 1 -or
        [IO.Path]::GetFullPath([string]$managed.base) -ne [IO.Path]::GetFullPath($StateRoot) -or
        [IO.Path]::GetFullPath([string]$managed.controlRoot) -ne [IO.Path]::GetFullPath($ControlRoot)
    } catch {
      throw 'BLUE_GREEN_MANAGED_STATE_MISMATCH'
    }
    if ($managedMismatch) { throw 'BLUE_GREEN_MANAGED_STATE_MISMATCH' }
    if ($managed.PSObject.Properties.Name -contains 'legacyRoot' -and
        -not [string]::IsNullOrWhiteSpace([string]$managed.legacyRoot)) {
      [void](Assert-SafeLegacyRoot ([string]$managed.legacyRoot))
    }
  }
  return $state
}

function Assert-BlueGreenInvocation([string]$DeploymentState) {
  if ($ExpectedCommit -notmatch '^[0-9a-fA-F]{40}$') {
    throw "BLUE_GREEN_EXPECTED_COMMIT_REQUIRED state=$DeploymentState"
  }
  $refused = [Collections.Generic.List[string]]::new()
  if ($DisableGuiControl) { $refused.Add('DisableGuiControl') }
  if ($SkipTunnelClient) { $refused.Add('SkipTunnelClient') }
  if ($TunnelClientVersion -ne '0.0.14') { $refused.Add('TunnelClientVersion') }
  if ($refused.Count -gt 0) {
    throw "BLUE_GREEN_CONFIG_SWITCH_REFUSED switches=$($refused -join ','): persistent config is preserved; use the dedicated profile workflow."
  }
  if ($PowerMode) { Write-Host 'BLUE_GREEN_COMPAT_ASSERTION PowerMode: candidate policy gates must confirm Power Mode.' }
  if ($GuiControl) { Write-Host 'BLUE_GREEN_COMPAT_ASSERTION GuiControl: candidate policy gates must confirm GUI Control.' }
  if ($StartServer) { Write-Host 'BLUE_GREEN_COMPAT_ASSERTION StartServer: the stable managed service must be active after validation.' }
}

function Get-ManagedLegacyRoot {
  $managed = Get-Content -LiteralPath $ManagedPath -Raw | ConvertFrom-Json
  if ($managed.PSObject.Properties.Name -contains 'legacyRoot' -and
      -not [string]::IsNullOrWhiteSpace([string]$managed.legacyRoot)) {
    return [IO.Path]::GetFullPath([string]$managed.legacyRoot)
  }
  return [IO.Path]::GetFullPath((Join-Path $StateRoot 'app'))
}

function Remove-ExactCandidateStage([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  $stagingRoot = [IO.Path]::GetFullPath((Join-Path $StateRoot 'staging')).TrimEnd('\')
  $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  if ([IO.Path]::GetDirectoryName($full) -ne $stagingRoot -or [IO.Path]::GetFileName($full) -notmatch '^installer-[0-9a-f]{32}$') {
    throw 'CANDIDATE_STAGE_CLEANUP_PATH_REFUSED'
  }
  [void](Assert-NoReparseAncestorChain $stagingRoot 'CANDIDATE_STAGE_CLEANUP_ANCESTOR_REPARSE_REFUSED')
  if (Test-Path -LiteralPath $full) {
    $item = Get-Item -LiteralPath $full -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.LinkType) {
      throw 'CANDIDATE_STAGE_CLEANUP_REPARSE_POINT_REFUSED'
    }
    if (Get-ChildItem -LiteralPath $full -Recurse -Force | Where-Object {
      ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $_.LinkType
    } | Select-Object -First 1) {
      throw 'CANDIDATE_STAGE_CLEANUP_NESTED_REPARSE_POINT_REFUSED'
    }
    Remove-Item -LiteralPath $full -Recurse -Force
  }
}

function Assert-CandidateCheckout([string]$Candidate, [string]$Commit) {
  [void](Assert-NoReparseAncestorChain $Candidate 'CANDIDATE_REPARSE_ANCESTOR_REFUSED')
  $top = (& git.exe -C $Candidate rev-parse --show-toplevel).Trim()
  if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath($top) -ne [IO.Path]::GetFullPath($Candidate)) {
    throw 'CANDIDATE_GIT_ROOT_MISMATCH'
  }
  $head = (& git.exe -C $Candidate rev-parse HEAD).Trim().ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or $head -ne $Commit.ToLowerInvariant()) { throw 'CANDIDATE_HEAD_MISMATCH' }
  $status = @(& git.exe -C $Candidate status --porcelain=v1 --untracked-files=all)
  if ($LASTEXITCODE -ne 0) { throw 'CANDIDATE_STATUS_FAILED' }
  if (@($status | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count -ne 0) {
    throw 'CANDIDATE_WORKTREE_NOT_CLEAN'
  }
  $index = @(& git.exe -C $Candidate ls-files --stage)
  if ($LASTEXITCODE -ne 0) { throw 'CANDIDATE_INDEX_READ_FAILED' }
  if ($index | Where-Object { $_ -match '^(120000|160000) ' } | Select-Object -First 1) {
    throw 'CANDIDATE_SPECIAL_ENTRY_REFUSED'
  }
  if (Get-ChildItem -LiteralPath $Candidate -Recurse -Force | Where-Object {
    ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $_.LinkType
  } | Select-Object -First 1) {
    throw 'CANDIDATE_REPARSE_POINT_REFUSED'
  }
  foreach ($required in @('RUN_BLUEGREEN.ps1','bluegreen-windows.ps1','bluegreen-supervisor-windows.ps1')) {
    $requiredPath = Join-Path $Candidate $required
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
      throw "CANDIDATE_BLUE_GREEN_FILE_MISSING file=$required"
    }
    $requiredItem = Get-Item -LiteralPath $requiredPath -Force
    if (($requiredItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $requiredItem.LinkType) {
      throw "CANDIDATE_BLUE_GREEN_FILE_LINK_REFUSED file=$required"
    }
    $tracked = @(& git.exe -C $Candidate ls-files --error-unmatch -- $required 2>$null)
    if ($LASTEXITCODE -ne 0 -or $tracked.Count -ne 1 -or [string]$tracked[0] -ne $required) {
      throw "CANDIDATE_BLUE_GREEN_FILE_UNTRACKED file=$required"
    }
  }
}

function New-ExactCandidateCheckout {
  $stagingRoot = Join-Path $StateRoot 'staging'
  New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
  [void](Assert-NoReparseAncestorChain $stagingRoot 'CANDIDATE_STAGING_REPARSE_POINT_REFUSED')
  $candidate = Join-Path $stagingRoot "installer-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Path $candidate | Out-Null
  [void](Assert-NoReparseAncestorChain $candidate 'CANDIDATE_REPARSE_ANCESTOR_REFUSED')
  try {
    & git.exe -C $candidate init | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'candidate git init failed' }
    & git.exe -C $candidate remote add origin $Repo | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'candidate git remote add failed' }
    & git.exe -C $candidate fetch --depth 1 --no-tags origin $SourceRef | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "candidate git fetch failed for SourceRef $SourceRef" }
    $resolved = (& git.exe -C $candidate rev-parse 'FETCH_HEAD^{commit}').Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $resolved -notmatch '^[0-9a-f]{40}$') {
      throw 'Could not peel candidate source ref to a commit.'
    }
    if ($resolved -ne $ExpectedCommit.ToLowerInvariant()) {
      throw "Candidate commit $resolved does not match ExpectedCommit $ExpectedCommit."
    }
    & git.exe -C $candidate checkout --detach $resolved | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'candidate git checkout failed' }
    Assert-CandidateCheckout $candidate $resolved
    return [pscustomobject]@{ root=[IO.Path]::GetFullPath($candidate); commit=$resolved }
  } catch {
    Remove-ExactCandidateStage $candidate
    throw
  }
}

function Invoke-BlueGreenDeployment([string]$DeploymentState) {
  $candidate = New-ExactCandidateCheckout
  try {
    Assert-CandidateCheckout $candidate.root $candidate.commit
    $runner = Join-Path $candidate.root 'RUN_BLUEGREEN.ps1'
    $mode = if ($DeploymentState -eq 'Managed') { 'Update' } else { 'Bootstrap' }
    $arguments = @(
      '-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',$runner,
      '-CandidateRoot',$candidate.root,'-ExpectedCommit',$candidate.commit,'-Mode',$mode
    )
    if ($mode -eq 'Bootstrap') {
      $arguments += @('-LegacyRoot',$InstallDir)
    } else {
      $arguments += @('-LegacyRoot',(Get-ManagedLegacyRoot))
    }
    if ($NonInteractive) { $arguments += '-NonInteractive' }
    & pwsh.exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "BLUE_GREEN_RUNNER_FAILED exit=$LASTEXITCODE mode=$mode" }
    Write-Host ''
    if ($NonInteractive) { Write-Host 'BLUE_GREEN_INSTALL_ACCEPTED'; Write-Host 'The detached receipt must reach state=succeeded and target state must be verified independently before PASS.' }
    else { Write-Host 'BLUE_GREEN_INSTALL_PASS' }
    Write-Host "Deployment state: $DeploymentState"
    Write-Host "Source commit: $($candidate.commit)"
  } finally {
    Remove-ExactCandidateStage $candidate.root
  }
}

function Ensure-Command([string]$Name, [string]$WingetId) {
  if (Get-Command $Name -ErrorAction SilentlyContinue) {
    return
  }
  if (-not $InstallPrerequisites) {
    throw "$Name is required. Re-run with -InstallPrerequisites or install $WingetId manually."
  }
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw "winget is required to auto-install $Name."
  }

  Write-Host "Installing $Name via winget ($WingetId)..."
  & winget.exe install --id $WingetId -e --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "winget failed installing $WingetId ($LASTEXITCODE)"
  }

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
  if ($nodeMajor -lt 22) {
    throw "Node.js 22+ is required; found $nodeMajor."
  }
}

function Install-Source {
  $parent = Split-Path -Parent $InstallDir
  New-Item -ItemType Directory -Force -Path $parent | Out-Null

  if (Test-Path -LiteralPath (Join-Path $InstallDir '.git')) {
    $dirty = & git.exe -C $InstallDir status --porcelain --untracked-files=no
    if ($LASTEXITCODE -ne 0) {
      throw 'git status failed'
    }
    if ($dirty) {
      throw 'Tracked local changes exist in InstallDir. Commit or stash them before update; installer will not overwrite them.'
    }

    Write-Host "Fetching source ref '$SourceRef' for existing installation: $InstallDir"
    & git.exe -C $InstallDir fetch --no-tags origin $SourceRef
    if ($LASTEXITCODE -ne 0) {
      throw "git fetch failed for SourceRef $SourceRef"
    }

    $resolved = (& git.exe -C $InstallDir rev-parse 'FETCH_HEAD^{commit}').Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $resolved -notmatch '^[0-9a-f]{40}$') {
      throw 'Could not peel fetched source ref to a commit.'
    }
    if ($resolved -ne $ExpectedCommit.ToLowerInvariant()) {
      throw "Fetched commit $resolved does not match ExpectedCommit $ExpectedCommit."
    }

    $currentRaw = & git.exe -C $InstallDir rev-parse HEAD 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($currentRaw)) {
      throw 'InstallDir contains an incomplete Git checkout with no HEAD. Move/remove that failed installation and retry.'
    }
    $current = $currentRaw.Trim().ToLowerInvariant()
    if ($current -ne $resolved) {
      & git.exe -C $InstallDir merge-base --is-ancestor $current $resolved
      if ($LASTEXITCODE -ne 0) {
        throw 'Refusing non-fast-forward update or downgrade of active installation.'
      }
      & git.exe -C $InstallDir merge --ff-only $resolved
      if ($LASTEXITCODE -ne 0) {
        throw 'git fast-forward update failed'
      }
    }
  } elseif (Test-Path -LiteralPath $InstallDir) {
    throw "InstallDir exists but is not a Git checkout: $InstallDir"
  } else {
    Write-Host "Installing source ref '$SourceRef' to $InstallDir"
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    $sourceReady = $false
    try {
      & git.exe -C $InstallDir init
      if ($LASTEXITCODE -ne 0) { throw 'git init failed' }
      & git.exe -C $InstallDir remote add origin $Repo
      if ($LASTEXITCODE -ne 0) { throw 'git remote add failed' }
      & git.exe -C $InstallDir fetch --depth 1 --no-tags origin $SourceRef
      if ($LASTEXITCODE -ne 0) { throw "git fetch failed for SourceRef $SourceRef" }

      $resolved = (& git.exe -C $InstallDir rev-parse 'FETCH_HEAD^{commit}').Trim().ToLowerInvariant()
      if ($LASTEXITCODE -ne 0 -or $resolved -notmatch '^[0-9a-f]{40}$') {
        throw 'Could not peel fetched source ref to a commit.'
      }
      if ($resolved -ne $ExpectedCommit.ToLowerInvariant()) {
        throw "Fetched commit $resolved does not match ExpectedCommit $ExpectedCommit."
      }

      & git.exe -C $InstallDir checkout --detach $resolved
      if ($LASTEXITCODE -ne 0) { throw 'git checkout failed' }
      $sourceReady = $true
    } finally {
      if (-not $sourceReady -and (Test-Path -LiteralPath $InstallDir)) {
        Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
  }

  $head = (& git.exe -C $InstallDir rev-parse HEAD).Trim().ToLowerInvariant()
  if ($head -ne $ExpectedCommit.ToLowerInvariant()) {
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
  $arch = if ($env:PROCESSOR_ARCHITECTURE -match 'ARM64') { 'arm64' } else { 'amd64' }
  $toolDir = Join-Path $InstallDir "tools\tunnel-client-v$TunnelClientVersion-windows-$arch"
  $exe = Join-Path $toolDir 'tunnel-client.exe'

  if ($SkipTunnelClient) {
    if (Test-Path -LiteralPath $exe -PathType Leaf) {
      Write-TunnelClientState $exe
      Write-Host "Reusing pinned tunnel client: $exe"
      return
    }
    throw "SkipTunnelClient was requested but expected executable is missing: $exe"
  }

  if (Test-Path -LiteralPath $exe -PathType Leaf) {
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

    $line = Get-Content (Join-Path $tmp 'SHA256SUMS.txt') |
      Where-Object { $_ -match [regex]::Escape($file) } |
      Select-Object -First 1

    if (-not $line) {
      throw 'Could not find tunnel-client archive in SHA256SUMS.txt'
    }

    $expected = ($line -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash (Join-Path $tmp $file) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expected -ne $actual) {
      throw "Tunnel client checksum mismatch: expected $expected actual $actual"
    }

    New-Item -ItemType Directory -Force -Path $toolDir | Out-Null
    Expand-Archive -LiteralPath (Join-Path $tmp $file) -DestinationPath $toolDir -Force
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
      throw 'tunnel-client.exe missing after extraction'
    }

    Write-TunnelClientState $exe
    Write-Host "Tunnel client verified, installed and pinned: $exe"
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Configure-LocalPolicy {
  $defaultRoot = Join-Path $env:USERPROFILE 'source\repos'
  New-Item -ItemType Directory -Force -Path $defaultRoot | Out-Null

  $localConfig = Join-Path $InstallDir 'config.local.json'
  $publicConfig = Join-Path $InstallDir 'config.json'
  $basePath = if (Test-Path -LiteralPath $localConfig -PathType Leaf) { $localConfig } else { $publicConfig }

  $policy = Get-Content -LiteralPath $basePath -Raw | ConvertFrom-Json -AsHashtable
  if (-not $policy) {
    throw "Could not parse policy: $basePath"
  }

  $policy['host'] = '127.0.0.1'
  $policy['port'] = 47831
  if (-not $policy.ContainsKey('allowedRoots')) {
    $policy['allowedRoots'] = @('%USERPROFILE%\source\repos')
  }
  if (-not $policy.ContainsKey('allowedPrograms')) {
    $policy['allowedPrograms'] = @('git','node','npm','npx','python','py','dotnet','cmake','ninja')
  }
  if (-not $policy.ContainsKey('auditLog')) {
    $policy['auditLog'] = 'var/audit.jsonl'
  }
  if (-not $policy.ContainsKey('auditMaxBytes')) {
    $policy['auditMaxBytes'] = 8388608
  }
  if (-not $policy.ContainsKey('auditKeepFiles')) {
    $policy['auditKeepFiles'] = 3
  }

  if (-not $policy.ContainsKey('powerMode') -or $policy['powerMode'] -isnot [System.Collections.IDictionary]) {
    $policy['powerMode'] = @{}
  }
  $pm = $policy['powerMode']

  if (-not $pm.ContainsKey('guiControl') -or $pm['guiControl'] -isnot [System.Collections.IDictionary]) {
    $pm['guiControl'] = @{}
  }
  $gui = $pm['guiControl']

  if ($PowerMode) {
    $pm['enabled'] = $true
    $pm['fullFilesystem'] = $true
    $pm['allowShell'] = $true
    $pm['allowProcessControl'] = $true
    $pm['allowPermanentDelete'] = $false

    if (-not $pm.ContainsKey('backupRoot')) {
      $pm['backupRoot'] = '%USERPROFILE%\.chatgpt-remote-commander\backups'
    }
    if (-not $pm.ContainsKey('maxFileBytes')) {
      $pm['maxFileBytes'] = 33554432
    }
    if (-not $pm.ContainsKey('maxCommandMs')) {
      $pm['maxCommandMs'] = 600000
    }
    if (-not $pm.ContainsKey('maxOutputBytes')) {
      $pm['maxOutputBytes'] = 4194304
    }
    if (-not $pm.ContainsKey('maxTerminalBufferBytes')) {
      $pm['maxTerminalBufferBytes'] = 8388608
    }
    if (-not $pm.ContainsKey('blockedShellPatterns')) {
      $pm['blockedShellPatterns'] = @(
        '(^|\s)shutdown(?:\.exe)?(?:\s|$)',
        'Restart-Computer',
        'Stop-Computer',
        '(^|\s)logoff(?:\.exe)?(?:\s|$)',
        'ExitWindowsEx'
      )
    }

    if ($GuiControl) {
      $gui['enabled'] = $true
    } elseif ($DisableGuiControl) {
      $gui['enabled'] = $false
    } elseif (-not $gui.ContainsKey('enabled')) {
      $gui['enabled'] = $false
    }

    $gui['allowScreenshot'] = $true
    $gui['allowMouse'] = $true
    $gui['allowKeyboard'] = $true
    $gui['allowWindowFocus'] = $true
    if (-not $gui.ContainsKey('maxScreenshotWidth')) {
      $gui['maxScreenshotWidth'] = 1600
    }
    if (-not $gui.ContainsKey('maxScreenshotBytes')) {
      $gui['maxScreenshotBytes'] = 2097152
    }
  } else {
    $pm['enabled'] = $false
    $pm['fullFilesystem'] = $false
    $pm['allowShell'] = $false
    $pm['allowProcessControl'] = $false
    $pm['allowPermanentDelete'] = $false
    $gui['enabled'] = $false
  }

  $json = $policy | ConvertTo-Json -Depth 20
  $newBytes = [Text.UTF8Encoding]::new($false).GetBytes($json + [Environment]::NewLine)
  $oldHash = if (Test-Path -LiteralPath $localConfig -PathType Leaf) {
    (Get-FileHash -LiteralPath $localConfig -Algorithm SHA256).Hash
  } else {
    ''
  }

  $tmp = "$localConfig.tmp-$PID"
  [IO.File]::WriteAllBytes($tmp, $newBytes)
  $newHash = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash

  if ($oldHash -ne $newHash) {
    if (Test-Path -LiteralPath $localConfig -PathType Leaf) {
      $backupDir = Join-Path $InstallDir 'var\config-backups'
      New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
      $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
      Copy-Item -LiteralPath $localConfig -Destination (Join-Path $backupDir "config.local.$stamp.json") -Force
    }
    Move-Item -LiteralPath $tmp -Destination $localConfig -Force
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
    if ($LASTEXITCODE -ne 0) {
      throw 'npm run check failed'
    }
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) {
      throw 'npm test failed'
    }
    & npm.cmd run audit
    if ($LASTEXITCODE -ne 0) {
      throw 'security audit failed'
    }
  } finally {
    Pop-Location
  }
}

function Get-ExpectedConfigHash {
  $local = Join-Path $InstallDir 'config.local.json'
  $active = if (Test-Path -LiteralPath $local -PathType Leaf) { $local } else { Join-Path $InstallDir 'config.json' }
  return (Get-FileHash -LiteralPath $active -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-OwnedMcpProcess([object]$Health) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort 47831 -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) {
    return $null
  }

  $stateFile = Join-Path $InstallDir 'var\mcp-runtime.json'
  if (Test-Path -LiteralPath $stateFile -PathType Leaf) {
    try {
      $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
      if ($listener.OwningProcess -eq [int]$state.pid -and
          [IO.Path]::GetFullPath([string]$state.projectDir) -eq [IO.Path]::GetFullPath($InstallDir)) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
        if ($proc.Name -eq 'node.exe' -and $proc.CommandLine -match 'src[\\/]server-v0\.3\.mjs') {
          return $proc
        }
      }
    } catch {
    }
  }

  if ($Health -and $Health.ok -and $Health.name -eq 'chatgpt-remote-commander') {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if ($proc.Name -eq 'node.exe' -and $proc.CommandLine -match 'src[\\/]server-v0\.3\.mjs') {
      Write-Host 'Using legacy MCP ownership migration check for pre-v0.5 runtime.'
      return $proc
    }
  }

  return $null
}

function Start-LocalServer {
  if (-not $StartServer) {
    return
  }

  $expectedVersion = (Get-Content -LiteralPath (Join-Path $InstallDir 'package.json') -Raw | ConvertFrom-Json).version
  $expectedConfig = Get-ExpectedConfigHash
  $health = $null
  try {
    $health = Invoke-RestMethod 'http://127.0.0.1:47831/health' -TimeoutSec 2
  } catch {
  }

  if ($health.ok -and $health.version -eq $expectedVersion -and $health.configSha256 -eq $expectedConfig) {
    Write-Host "MCP server is already healthy at version $expectedVersion with matching config."
    return
  }

  $listener = Get-NetTCPConnection -State Listen -LocalPort 47831 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $owned = Get-OwnedMcpProcess $health
    if (-not $owned) {
      throw 'Port 47831 is not owned by this installation; refusing automatic stop.'
    }
    Write-Host 'Restarting owned MCP for version or configuration change...'
    Stop-Process -Id $owned.ProcessId -Force
  }

  $rootPattern = [regex]::Escape([IO.Path]::GetFullPath($InstallDir))
  $supervisor = Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'autostart-windows\.ps1' -and $_.CommandLine -match $rootPattern } |
    Select-Object -First 1

  if (-not $supervisor) {
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    $out = Join-Path $InstallDir 'var\mcp-install.out.log'
    $err = Join-Path $InstallDir 'var\mcp-install.err.log'
    New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'var') | Out-Null
    Start-Process -FilePath $npm -ArgumentList @('start','--silent') -WorkingDirectory $InstallDir -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
  }

  foreach ($i in 1..40) {
    Start-Sleep -Milliseconds 500
    try {
      $health = Invoke-RestMethod 'http://127.0.0.1:47831/health' -TimeoutSec 1
      if ($health.ok -and $health.version -eq $expectedVersion -and $health.configSha256 -eq $expectedConfig) {
        Write-Host "Server ready at version $expectedVersion with matching configuration."
        return
      }
    } catch {
    }
  }

  throw 'Server startup did not reach expected version/configuration.'
}

Require-Windows
$InstallDir = Resolve-InstallDir
$deploymentState = Get-DeploymentState
if ($deploymentState -ne 'Fresh') {
  Assert-BlueGreenInvocation $deploymentState
}
Ensure-Prerequisites
if ($deploymentState -eq 'Fresh') {
  Install-Source
  Install-TunnelClient
  Configure-LocalPolicy
  Test-Installation
  Start-LocalServer

  $effective = Get-Content -LiteralPath (Join-Path $InstallDir 'config.local.json') -Raw | ConvertFrom-Json

  Write-Host ''
  Write-Host 'INSTALL_PASS'
  Write-Host "Installed at: $InstallDir"
  Write-Host "Source commit: $((& git.exe -C $InstallDir rev-parse HEAD).Trim())"
  Write-Host "Mode: $(if ($effective.powerMode.enabled) { if ($effective.powerMode.guiControl.enabled) {'POWER + GUI'} else {'POWER'} } else {'STANDARD'})"
  Write-Host 'BLUE_GREEN_BOOTSTRAP_PENDING'
  Write-Host 'Complete persistent tunnel enrollment, then rerun the exact pinned release installer to bootstrap blue/green safely.'
  Write-Host ''
  Write-Host 'Next: create or reuse your OpenAI Secure MCP Tunnel and run once:'
  Write-Host ('  pwsh.exe -NoProfile -File "{0}\connect-chatgpt.ps1"' -f $InstallDir)
  Write-Host 'Persistent enrollment manages MCP + tunnel automatically; no repeated Tunnel ID/port/key entry is needed.'
  Write-Host 'Do not share the Runtime API key. It is entered locally and stored with Windows DPAPI for this user.'
} else {
  Invoke-BlueGreenDeployment $deploymentState
}
