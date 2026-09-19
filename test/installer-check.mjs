import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const windowsInstaller = readFileSync('install.ps1', 'utf8');
for (const required of ['[switch]$GuiControl','[switch]$DisableGuiControl','guiControl','allowScreenshot','allowMouse','allowKeyboard','allowWindowFocus']) {
  if (!windowsInstaller.includes(required)) {
    throw new Error(`install.ps1 missing GUI Control behavior: ${required}`);
  }
}
for (const required of [
  "Join-Path $StateRoot 'app'",
  'Detected active installation from Windows autostart',
  '$InstallDir = Resolve-InstallDir',
  'Tracked local changes exist in InstallDir',
  "[string]$SourceRef = 'v0.8.0'",
  'ExpectedCommit',
  'EXPECTED_COMMIT_REQUIRED',
  "rev-parse 'FETCH_HEAD^{commit}'",
  'incomplete Git checkout with no HEAD',
  'Remove-Item -LiteralPath $InstallDir -Recurse -Force',
  'Get-ExpectedConfigHash',
  'mcp-runtime.json',
  'tunnel-client.json',
  'config-backups',
  'auditMaxBytes',
  'auditKeepFiles',
  "Mode: $(if ($PowerMode) {'POWER'} else {'STANDARD'})",
  'function Get-DeploymentState {',
  'function Resolve-DeploymentStateSignals(',
  'function Assert-SafeLegacyRoot(',
  'function Assert-NoReparseAncestorChain(',
  'BLUE_GREEN_STATE_PARTIAL',
  'BLUE_GREEN_MANAGED_EXPLICIT_INSTALL_DIR_REFUSED',
  'BLUE_GREEN_REGISTRY_MISMATCH',
  'LEGACY_ROOT_EQUALS_STATE_ROOT_REFUSED',
  'LEGACY_ROOT_OUTSIDE_STATE_ROOT_REFUSED',
  'BLUE_GREEN_EXPECTED_COMMIT_REQUIRED',
  'BLUE_GREEN_CONFIG_SWITCH_REFUSED',
  'function Get-ManagedLegacyRoot {',
  'function New-ExactCandidateCheckout {',
  'function Assert-CandidateCheckout(',
  'CANDIDATE_STAGE_CLEANUP_ANCESTOR_REPARSE_REFUSED',
  'CANDIDATE_WORKTREE_NOT_CLEAN',
  'CANDIDATE_SPECIAL_ENTRY_REFUSED',
  'CANDIDATE_BLUE_GREEN_FILE_UNTRACKED',
  "rev-parse 'FETCH_HEAD^{commit}'",
  "checkout --detach $resolved",
  "'-CandidateRoot',$candidate.root",
  "'-ExpectedCommit',$candidate.commit",
  "@('-LegacyRoot',$InstallDir)",
  "@('-LegacyRoot',(Get-ManagedLegacyRoot))",
  'BLUE_GREEN_INSTALL_PASS',
  'BLUE_GREEN_INSTALL_ACCEPTED',
  'BLUE_GREEN_BOOTSTRAP_PENDING'
]) {
  if (!windowsInstaller.includes(required)) {
    throw new Error(`install.ps1 missing required release behavior: ${required}`);
  }
}

const classification = windowsInstaller.indexOf('$deploymentState = Get-DeploymentState');
const activeInstallMutation = windowsInstaller.indexOf('  Install-Source', classification);
const prerequisites = windowsInstaller.indexOf('Ensure-Prerequisites', classification);
if (classification < 0 || prerequisites < classification || activeInstallMutation < prerequisites) {
  throw new Error('install.ps1 must classify deployment state before invoking Install-Source');
}
if (!windowsInstaller.includes("if ($deploymentState -eq 'Fresh')")) {
  throw new Error('Install-Source must remain confined to the Fresh branch');
}

const linuxInstaller = readFileSync('install.sh', 'utf8');
const linuxEnrollment = readFileSync('enable-autostart-linux.sh', 'utf8');
const linuxPluginInstaller = readFileSync('install-work-plugin.sh', 'utf8');
const linuxAccountConnector = readFileSync('connect-chatgpt-account.sh', 'utf8');
for (const required of [
  'SOURCE_REF="${REMOTE_COMMANDER_SOURCE_REF:-v0.8.0}"',
  '--source-ref',
  '--expected-commit',
  'REMOTE_COMMANDER_EXPECTED_COMMIT',
  "rev-parse 'FETCH_HEAD^{commit}'",
  'incomplete staging checkout removed',
  'Tracked local changes exist in InstallDir',
  'fetch --no-tags origin "$SOURCE_REF"',
  'checkout --detach',
  'Source commit:',
  'Updating running MCP from version',
  'enable-autostart-linux.sh',
  '"auditMaxBytes": 8388608',
  '"auditKeepFiles": 3',
  'REMOTE_COMMANDER_CURL_CONNECT_TIMEOUT',
  'REMOTE_COMMANDER_CURL_MAX_TIME',
  '--connect-timeout "$CURL_CONNECT_TIMEOUT"',
  '--max-time "$CURL_MAX_TIME"',
  'curl_fetch https://nodejs.org/dist/index.json',
  'curl -fsS --connect-timeout 1 --max-time 2 http://127.0.0.1:47831/health'
]) {
  if (!linuxInstaller.includes(required)) {
    throw new Error(`install.sh missing required release behavior: ${required}`);
  }
}
for (const required of ['--connect-timeout "$CURL_CONNECT_TIMEOUT"', '--max-time "$CURL_MAX_TIME"']) {
  if (!linuxPluginInstaller.includes(required)) {
    throw new Error(`install-work-plugin.sh missing bounded download behavior: ${required}`);
  }
}
for (const required of ['--connect-timeout 1 --max-time 3']) {
  if (!linuxAccountConnector.includes(required)) {
    throw new Error(`connect-chatgpt-account.sh missing bounded health behavior: ${required}`);
  }
}
for (const required of ['Reusing existing local credential', 'doctor bind check skipped']) {
  if (!linuxEnrollment.includes(required)) {
    throw new Error(`enable-autostart-linux.sh missing required v0.3.3 behavior: ${required}`);
  }
}

function run(file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') return { skipped: true };
  if (result.status !== 0) {
    throw new Error(`${file} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return { skipped: false };
}

if (process.platform === 'linux') {
  const files = [
    'install.sh', 'connect-chatgpt-account.sh', 'run-server.sh',
    'autostart-linux.sh', 'enable-autostart-linux.sh', 'disable-autostart-linux.sh',
    'install-work-plugin.sh'
  ];
  for (const file of files) {
    const outcome = run('bash', ['-n', file]);
    if (outcome.skipped) throw new Error('bash parser is required on Linux');
  }
  console.log('INSTALLER_CHECK_PASS platform=linux bash=true');
} else if (process.platform === 'win32') {
  const files = [
    'install.ps1', 'connect-chatgpt-account.ps1', 'connect-chatgpt.ps1',
    'autostart-windows.ps1', 'enable-autostart.ps1', 'disable-autostart.ps1',
    'install-work-plugin.ps1', 'bluegreen-windows.ps1',
    'bluegreen-supervisor-windows.ps1', 'RUN_BLUEGREEN.ps1', 'tools/gui-control.ps1'
  ];
  for (const file of files) {
    const escaped = file.replaceAll("'", "''");
    const command = `$e=$null; [System.Management.Automation.Language.Parser]::ParseFile('${escaped}',[ref]$null,[ref]$e)>$null; if($e.Count){$e|% Message; exit 1}`;
    const outcome = run('pwsh.exe', ['-NoProfile', '-Command', command]);
    if (outcome.skipped) throw new Error('PowerShell 7 parser is required on Windows');
  }

  const installerPath = `${process.cwd()}\\install.ps1`.replaceAll("'", "''");
  const behavior = `
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile('${installerPath}',[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'INSTALLER_BEHAVIOR_PARSE_FAILED' }
function Assert-Equal([string]$Actual,[string]$Expected,[string]$Code) {
  if ($Actual -ne $Expected) { throw "$Code expected=$Expected actual=$Actual" }
}
function Assert-Throws([scriptblock]$Action,[string]$Expected,[string]$Code) {
  $message = ''
  try { & $Action } catch { $message = $_.Exception.Message }
  if ($message -notlike "*$Expected*") { throw "$Code expected=$Expected actual=$message" }
}
foreach ($name in @('Resolve-DeploymentStateSignals','Assert-NoReparseAncestorChain','Assert-SafeLegacyRoot','Assert-BlueGreenInvocation','Assert-CandidateCheckout')) {
  $matches = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name },$true))
  if ($matches.Count -ne 1) { throw "FUNCTION_IMPORT_COUNT name=$name count=$($matches.Count)" }
  Invoke-Expression $matches[0].Extent.Text
}
Assert-Equal (Resolve-DeploymentStateSignals $false $false $false $false $false $false $false) 'Fresh' 'STATE_FRESH'
Assert-Equal (Resolve-DeploymentStateSignals $false $false $false $false $true $true $false) 'Legacy' 'STATE_LEGACY'
Assert-Equal (Resolve-DeploymentStateSignals $false $true $true $false $true $true $true) 'Legacy' 'STATE_PREMANAGED_RECOVERABLE'
Assert-Equal (Resolve-DeploymentStateSignals $true $true $true $true $false $false $false) 'Managed' 'STATE_MANAGED'
Assert-Throws { Resolve-DeploymentStateSignals $false $true $true $false $false $false $false } 'BLUE_GREEN_STATE_PARTIAL' 'STATE_RUNNER_ONLY'
Assert-Throws { Resolve-DeploymentStateSignals $false $false $true $false $true $true $false } 'BLUE_GREEN_STATE_PARTIAL' 'STATE_CONTROL_ONLY'
Assert-Throws { Resolve-DeploymentStateSignals $true $true $true $false $true $true $false } 'BLUE_GREEN_STATE_PARTIAL' 'STATE_MANAGED_WITHOUT_REGISTRY'
Assert-Throws { Resolve-DeploymentStateSignals $false $false $false $true $true $true $false } 'BLUE_GREEN_STATE_PARTIAL' 'STATE_REGISTRY_ONLY'
Assert-Throws { Resolve-DeploymentStateSignals $false $false $false $false $false $true $false } 'LEGACY_INSTALL_STATE_PARTIAL' 'STATE_NON_GIT_DIRECTORY'
Assert-Throws { Resolve-DeploymentStateSignals $true $true $true $true $false $false $true } 'BLUE_GREEN_MANAGED_EXPLICIT_INSTALL_DIR_REFUSED' 'STATE_MANAGED_EXPLICIT_PATH'

$ExpectedCommit = 'a' * 40
$PowerMode = $true; $GuiControl = $true; $StartServer = $true
$DisableGuiControl = $false; $SkipTunnelClient = $false; $TunnelClientVersion = '0.0.14'
Assert-BlueGreenInvocation 'Managed'
$PowerMode = $false; $GuiControl = $false; $StartServer = $false
$DisableGuiControl = $true
Assert-Throws { Assert-BlueGreenInvocation 'Managed' } 'DisableGuiControl' 'SWITCH_DISABLE_GUI'
$DisableGuiControl = $false; $SkipTunnelClient = $true
Assert-Throws { Assert-BlueGreenInvocation 'Managed' } 'SkipTunnelClient' 'SWITCH_SKIP_TUNNEL'
$SkipTunnelClient = $false; $TunnelClientVersion = '9.9.9'
Assert-Throws { Assert-BlueGreenInvocation 'Managed' } 'TunnelClientVersion' 'SWITCH_TUNNEL_VERSION'

$contractRoot = Join-Path ([IO.Path]::GetTempPath()) "remote-commander-installer-$PID-$([guid]::NewGuid().ToString('N'))"
try {
  $StateRoot = Join-Path $contractRoot 'state'
  $inside = Join-Path $StateRoot 'app'
  $outside = Join-Path $contractRoot 'outside'
  New-Item -ItemType Directory -Path (Join-Path $inside '.git'),(Join-Path $outside '.git') -Force | Out-Null
  Assert-Equal (Assert-SafeLegacyRoot $inside) ([IO.Path]::GetFullPath($inside).TrimEnd('\\')) 'LEGACY_CHILD'
  Assert-Throws { Assert-SafeLegacyRoot $StateRoot } 'LEGACY_ROOT_EQUALS_STATE_ROOT_REFUSED' 'LEGACY_EQUAL_BASE'
  Assert-Throws { Assert-SafeLegacyRoot $outside } 'LEGACY_ROOT_OUTSIDE_STATE_ROOT_REFUSED' 'LEGACY_OUTSIDE_BASE'
  $real = Join-Path $contractRoot 'real'
  $junction = Join-Path $contractRoot 'junction'
  New-Item -ItemType Directory -Path $real | Out-Null
  New-Item -ItemType Junction -Path $junction -Target $real | Out-Null
  Assert-Throws { Assert-NoReparseAncestorChain $junction 'ANCESTOR_REPARSE_TEST' } 'ANCESTOR_REPARSE_TEST' 'REPARSE_ANCESTOR'
  $candidateFixture = Join-Path $contractRoot 'candidate'
  New-Item -ItemType Directory -Path $candidateFixture | Out-Null
  & git.exe -C $candidateFixture init -q
  if ($LASTEXITCODE -ne 0) { throw 'CANDIDATE_FIXTURE_INIT_FAILED' }
  & git.exe -C $candidateFixture config user.name contract
  & git.exe -C $candidateFixture config user.email contract@example.invalid
  foreach ($required in @('RUN_BLUEGREEN.ps1','bluegreen-windows.ps1','bluegreen-supervisor-windows.ps1')) {
    [IO.File]::WriteAllText((Join-Path $candidateFixture $required),("# $required" + [Environment]::NewLine),[Text.UTF8Encoding]::new($false))
  }
  & git.exe -C $candidateFixture add -- RUN_BLUEGREEN.ps1 bluegreen-windows.ps1 bluegreen-supervisor-windows.ps1
  & git.exe -C $candidateFixture commit -q -m fixture
  if ($LASTEXITCODE -ne 0) { throw 'CANDIDATE_FIXTURE_COMMIT_FAILED' }
  $fixtureCommit = (& git.exe -C $candidateFixture rev-parse HEAD).Trim()
  Assert-CandidateCheckout $candidateFixture $fixtureCommit
  [IO.File]::AppendAllText((Join-Path $candidateFixture 'RUN_BLUEGREEN.ps1'),("# dirty" + [Environment]::NewLine),[Text.UTF8Encoding]::new($false))
  Assert-Throws { Assert-CandidateCheckout $candidateFixture $fixtureCommit } 'CANDIDATE_WORKTREE_NOT_CLEAN' 'CANDIDATE_DIRTY'
} finally {
  if (Test-Path -LiteralPath $contractRoot) { Remove-Item -LiteralPath $contractRoot -Recurse -Force }
}
Write-Output 'INSTALLER_BEHAVIOR_PASS'
`;
  run('pwsh.exe', ['-NoProfile', '-Command', behavior]);
  const missingCommit = spawnSync('pwsh.exe', ['-NoProfile', '-File', 'install.ps1'], { encoding: 'utf8' });
  const missingCommitOutput = `${missingCommit.stdout ?? ''}\n${missingCommit.stderr ?? ''}`;
  if (missingCommit.status === 0 || !missingCommitOutput.includes('EXPECTED_COMMIT_REQUIRED')) {
    throw new Error(`install.ps1 must fail before mutation when ExpectedCommit is empty\n${missingCommitOutput}`);
  }
  console.log('INSTALLER_CHECK_PASS platform=win32 powershell=true');
} else {
  console.log(`INSTALLER_CHECK_SKIP platform=${process.platform}`);
}
