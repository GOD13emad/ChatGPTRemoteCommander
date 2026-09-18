import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const count = (text, needle) => text.split(needle).length - 1;
const exact = (text, needle, expected, label) => {
  const actual = count(text, needle);
  if (actual !== expected) throw new Error(`${label}: expected ${expected} occurrence(s) of ${needle}, found ${actual}`);
};

const install = read('install.ps1');
if (!install.startsWith('param(') || install.split(/\r?\n/).length > 700) throw new Error('install.ps1 structural envelope invalid');
for (const fn of ['function Install-Source {','function Install-TunnelClient {','function Configure-LocalPolicy {','function Start-LocalServer {']) exact(install, fn, 1, 'install.ps1');
exact(install, "Write-Host 'INSTALL_PASS'", 1, 'install.ps1');
exact(install, 'function Require-Windows {', 1, 'install.ps1');
exact(install, 'Require-Windows\n', 1, 'install.ps1 invocation');

const supervisor = read('autostart-windows.ps1');
if (!supervisor.startsWith('param(') || supervisor.split(/\r?\n/).length > 420) throw new Error('autostart-windows.ps1 structural envelope invalid');
for (const marker of ['function Find-TunnelExe {','function Start-TunnelProfile($Item, [string]$Exe) {','SUPERVISOR_STARTED','TUNNEL_STUCK_RESTART']) {
  exact(supervisor, marker, 1, 'autostart-windows.ps1');
}

const enable = read('enable-autostart.ps1');
if (!enable.startsWith('param(') || enable.split(/\r?\n/).length > 360) throw new Error('enable-autostart.ps1 structural envelope invalid');
for (const marker of ['function Find-TunnelExe {','function Ensure-McpHealth {','AUTOSTART_ENROLL_PASS']) exact(enable, marker, 1, 'enable-autostart.ps1');

const disable = read('disable-autostart.ps1');
if (!disable.startsWith('param(') || disable.split(/\r?\n/).length > 230) throw new Error('disable-autostart.ps1 structural envelope invalid');
exact(disable, 'AUTOSTART_DISABLED', 1, 'disable-autostart.ps1');

const account = read('connect-chatgpt-account.ps1');
if (!account.startsWith('param(') || account.split(/\r?\n/).length > 80) throw new Error('connect-chatgpt-account.ps1 structural envelope invalid');
exact(account, 'ACCOUNT_CONNECT_PASS', 1, 'connect-chatgpt-account.ps1');

for (const [name, text] of [['install',install],['supervisor',supervisor],['enable',enable],['disable',disable],['account',account]]) {
  if (text.includes('\u0000')) throw new Error(name + ' contains NUL');
  if (!text.endsWith('\n')) throw new Error(name + ' must end with newline');
}

const acceptance = read('test/rc1-acceptance.ps1');
if (!acceptance.startsWith('param(') || acceptance.split(/\r?\n/).length > 360) throw new Error('rc1-acceptance.ps1 structural envelope invalid');
for (const marker of [
  "ExpectedCandidateCommit",
  "RC1_CANDIDATE_DRIFT",
  "git-diff-check",
  "RC1_NO_INPUT_PASS",
  "RC1_INTERACTIVE_GUI_PASS",
  "gui_session_begin",
  "gui_screenshot",
  "gui_session_end",
  "var\\GUI_STOP"
]) {
  if (!acceptance.includes(marker)) throw new Error('rc1-acceptance.ps1 missing: ' + marker);
}
exact(acceptance, "param(", 1, 'rc1-acceptance.ps1');
exact(acceptance, "RC1_NO_INPUT_PASS", 1, 'rc1-acceptance.ps1');
exact(acceptance, "RC1_INTERACTIVE_GUI_PASS", 1, 'rc1-acceptance.ps1');
if (/C:\\Users\\[^\\\r\n]+\\source\\repos\\ChatGPTRemoteCommander/i.test(acceptance)) throw new Error('rc1-acceptance.ps1 contains a personal developer path');
if (/Assert-True\s*\(\s*\$candidate\s*-match\s*['"][^'"]+['"]\s*$/m.test(acceptance)) throw new Error('rc1-acceptance.ps1 contains an incomplete candidate assertion');

console.log('SOURCE_INTEGRITY_PASS');
