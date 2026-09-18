import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const windowsInstaller = readFileSync('install.ps1', 'utf8');
for (const required of [
  '[switch]$PowerMode','[switch]$StandardMode','[switch]$GuiControl','[switch]$DisableGuiControl',
  "[string]$SourceRef = 'v0.5.0'",'[string]$ExpectedCommit','release expects $ExpectedCommit','checkout --detach --force','Tracked working-tree changes detected',
  'tunnel-client.active.json','Tunnel client archive checksum mismatch','does not match verified release archive',
  'tools\\merge-config.mjs','--gui $gui','config-backups','configSha256','instanceId','runtime-state.json',
  "Join-Path $stateRoot 'app'",'Detected active installation from Windows autostart','$InstallDir = Resolve-InstallDir'
]) {
  if (!windowsInstaller.includes(required)) throw new Error(`install.ps1 missing release-safe behavior: ${required}`);
}
for (const forbidden of ['pull --ff-only origin main','git.exe -C $InstallDir pull']) {
  if (windowsInstaller.includes(forbidden)) throw new Error(`install.ps1 contains unpinned update flow: ${forbidden}`);
}
const linuxInstaller = readFileSync('install.sh', 'utf8');
const linuxEnrollment = readFileSync('enable-autostart-linux.sh', 'utf8');
const linuxSupervisor = readFileSync('autostart-linux.sh', 'utf8');
const linuxDisable = readFileSync('disable-autostart-linux.sh', 'utf8');
const linuxAccount = readFileSync('connect-chatgpt-account.sh', 'utf8');
for (const required of [
  'SOURCE_REF=', 'EXPECTED_COMMIT=', '--source-ref', '--expected-commit', 'release expects $EXPECTED_COMMIT', 'checkout --detach --force', 'Tracked working-tree changes detected',
  'tunnel-client.active.json', 'archive SHA-256 verification failed', 'tools/merge-config.mjs',
  '--standard-mode', 'expected_instance', 'expected_config_hash', 'write_runtime_state'
]) if (!linuxInstaller.includes(required)) throw new Error(`install.sh missing release-safe behavior: ${required}`);
for (const forbidden of ['pull --ff-only origin main', 'git -C "$INSTALL_DIR" checkout main'])
  if (linuxInstaller.includes(forbidden)) throw new Error(`install.sh contains floating-main update flow: ${forbidden}`);
for (const required of [
  '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 'tunnel-client.active.json',
  'Requested tunnel ID does not match existing profile', 'Credential committed after successful validation',
  'doctor bind check skipped'
]) if (!linuxEnrollment.includes(required)) throw new Error(`enable-autostart-linux.sh missing hardened enrollment behavior: ${required}`);
for (const required of ['tunnel-client.active.json','expected_instance','expected_config_hash','TUNNEL_STUCK_RESTART','PROFILE_REJECTED'])
  if (!linuxSupervisor.includes(required)) throw new Error(`autostart-linux.sh missing ownership behavior: ${required}`);
for (const required of ['tunnel-client.active.json','instanceId','--remove-credential'])
  if (!linuxDisable.includes(required)) throw new Error(`disable-autostart-linux.sh missing ownership behavior: ${required}`);
for (const required of ['Persistent multi-account enrollment','enable-autostart-linux.sh','ACCOUNT_CONNECT_PASS'])
  if (!linuxAccount.includes(required)) throw new Error(`connect-chatgpt-account.sh missing persistent wrapper behavior: ${required}`);

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
    'install-work-plugin.ps1', 'tools/gui-control.ps1', 'test/gui-native.ps1',
    'test/gui-disposable-app.ps1', 'test/rc1-acceptance.ps1', 'tools/build-release.ps1', 'tools/verify-release.ps1'
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
