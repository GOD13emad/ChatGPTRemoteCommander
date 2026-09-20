import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const windowsInstaller = readFileSync('install.ps1', 'utf8');
const capabilityPolicy = readFileSync('src/capability-profile.mjs', 'utf8');
for (const required of ['[switch]$GuiControl','[switch]$DisableGuiControl','capability-migrate.mjs','Invoke-ExistingSafeUpdate','auto-update-windows.ps1']) {
  if (!windowsInstaller.includes(required)) throw new Error(`install.ps1 missing delegated capability/update behavior: ${required}`);
}
for (const required of ['guiControl','allowScreenshot','allowMouse','allowKeyboard','allowWindowFocus','allowPermanentDelete','autoEnableNewCapabilities','disabledCapabilities']) {
  if (!capabilityPolicy.includes(required)) throw new Error(`capability-profile.mjs missing Full Power behavior: ${required}`);
}
for (const required of [
  "Join-Path $stateRoot 'app'",
  'Detected active installation from Windows autostart',
  '$InstallDir = Resolve-InstallDir',
  'Tracked local changes exist in InstallDir',
  "[string]$SourceRef = 'v0.8.4'",
  'ExpectedCommit',
  "rev-parse 'FETCH_HEAD^{commit}'",
  'incomplete Git checkout with no HEAD',
  'Remove-Item -LiteralPath $InstallDir -Recurse -Force',
  'Get-ExpectedConfigHash',
  'mcp-runtime.json',
  'tunnel-client.json',
  'update-backups',
  'SAFE_UPDATE_PASS',
  'fresh-install routing/bootstrap validation failed',
  'Capability self-test:',
  'Mode: $(if ($effective.powerMode.enabled)'
]) {
  if (!windowsInstaller.includes(required)) {
    throw new Error(`install.ps1 missing required release behavior: ${required}`);
  }
}

const publicConfig = JSON.parse(readFileSync('config.json','utf8'));
if (publicConfig.auditMaxBytes !== 8388608 || publicConfig.auditKeepFiles !== 3) {
  throw new Error('config.json missing bounded audit defaults');
}
if (publicConfig.autoUpdate?.enabled !== true || publicConfig.autoUpdate?.zeroDowntime !== true) {
  throw new Error('config.json missing automatic update defaults');
}

const linuxInstaller = readFileSync('install.sh', 'utf8');
const linuxEnrollment = readFileSync('enable-autostart-linux.sh', 'utf8');
const linuxPluginInstaller = readFileSync('install-work-plugin.sh', 'utf8');
const linuxAccountConnector = readFileSync('connect-chatgpt-account.sh', 'utf8');
for (const required of [
  'SOURCE_REF="${REMOTE_COMMANDER_SOURCE_REF:-v0.8.4}"',
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
  'invoke_existing_safe_update',
  'SAFE_UPDATE_PASS',
  'build-candidate-config.mjs',
  'auto-update-linux.sh',
  'supervisor-routing-linux.sh',
  '--disable-capability',
  '--enable-capability',
  'capabilityProfile.tier',
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
    'autostart-linux.sh', 'supervisor-routing-linux.sh', 'auto-update-linux.sh',
    'enable-autostart-linux.sh', 'disable-autostart-linux.sh', 'install-work-plugin.sh'
  ];
  for (const file of files) {
    const outcome = run('bash', ['-n', file]);
    if (outcome.skipped) throw new Error('bash parser is required on Linux');
  }
  console.log('INSTALLER_CHECK_PASS platform=linux bash=true');
} else if (process.platform === 'win32') {
  const files = [
    'install.ps1', 'connect-chatgpt-account.ps1', 'connect-chatgpt.ps1',
    'autostart-windows.ps1', 'supervisor-routing.ps1', 'auto-update-windows.ps1', 'enable-autostart.ps1', 'disable-autostart.ps1',
    'install-work-plugin.ps1', 'tools/gui-control.ps1'
  ];
  for (const file of files) {
    const escaped = file.replaceAll("'", "''");
    const command = `$e=$null; [System.Management.Automation.Language.Parser]::ParseFile('${escaped}',[ref]$null,[ref]$e)>$null; if($e.Count){$e|% Message; exit 1}`;
    const outcome = run('pwsh.exe', ['-NoProfile', '-Command', command]);
    if (outcome.skipped) throw new Error('PowerShell 7 parser is required on Windows');
  }
  console.log('INSTALLER_CHECK_PASS platform=win32 powershell=true');
} else {
  console.log(`INSTALLER_CHECK_SKIP platform=${process.platform}`);
}
