import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const windowsInstaller = readFileSync('install.ps1', 'utf8');
for (const required of [
  "Join-Path $stateRoot 'app'",
  'Detected active installation from Windows autostart',
  'Updating running MCP from version'
]) {
  if (!windowsInstaller.includes(required)) {
    throw new Error(`install.ps1 missing required v0.3.3 behavior: ${required}`);
  }
}
const linuxInstaller = readFileSync('install.sh', 'utf8');
const linuxEnrollment = readFileSync('enable-autostart-linux.sh', 'utf8');
for (const required of ['Updating running MCP from version', 'enable-autostart-linux.sh']) {
  if (!linuxInstaller.includes(required)) {
    throw new Error(`install.sh missing required v0.3.3 behavior: ${required}`);
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
    'autostart-linux.sh', 'enable-autostart-linux.sh', 'disable-autostart-linux.sh'
  ];
  for (const file of files) {
    const outcome = run('bash', ['-n', file]);
    if (outcome.skipped) throw new Error('bash parser is required on Linux');
  }
  console.log('INSTALLER_CHECK_PASS platform=linux bash=true');
} else if (process.platform === 'win32') {
  const files = [
    'install.ps1', 'connect-chatgpt-account.ps1', 'connect-chatgpt.ps1',
    'autostart-windows.ps1', 'enable-autostart.ps1', 'disable-autostart.ps1'
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
