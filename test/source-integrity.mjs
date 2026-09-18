import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const count = (text, needle) => text.split(needle).length - 1;
const exact = (text, needle, expected, label) => {
  const actual = count(text, needle);
  if (actual !== expected) throw new Error(`${label}: expected ${expected} occurrence(s) of ${needle}, found ${actual}`);
};

const install = read('install.ps1');
if (!install.startsWith('param(') || install.split(/\r?\n/).length > 650) throw new Error('install.ps1 structural envelope invalid');
for (const fn of ['function Install-Source {','function Install-TunnelClient {','function Configure-LocalPolicy {','function Start-LocalServer {']) exact(install, fn, 1, 'install.ps1');
exact(install, "Write-Host 'INSTALL_PASS'", 1, 'install.ps1');
exact(install, 'Require-Windows', 2, 'install.ps1'); // definition + invocation

const supervisor = read('autostart-windows.ps1');
if (!supervisor.startsWith('param(') || supervisor.split(/\r?\n/).length > 350) throw new Error('autostart-windows.ps1 structural envelope invalid');
for (const marker of ['function Find-TunnelExe {','function Start-TunnelProfile($Item) {','SUPERVISOR_STARTED','TUNNEL_READY']) {
  exact(supervisor, marker, 1, 'autostart-windows.ps1');
}

const enable = read('enable-autostart.ps1');
if (!enable.startsWith('param(') || enable.split(/\r?\n/).length > 320) throw new Error('enable-autostart.ps1 structural envelope invalid');
for (const marker of ['function Find-TunnelExe {','function Ensure-McpHealth {','AUTOSTART_ENROLL_PASS']) exact(enable, marker, 1, 'enable-autostart.ps1');

const disable = read('disable-autostart.ps1');
if (!disable.startsWith('param(') || disable.split(/\r?\n/).length > 180) throw new Error('disable-autostart.ps1 structural envelope invalid');
exact(disable, 'AUTOSTART_DISABLED', 1, 'disable-autostart.ps1');

const account = read('connect-chatgpt-account.ps1');
if (!account.startsWith('param(') || account.split(/\r?\n/).length > 80) throw new Error('connect-chatgpt-account.ps1 structural envelope invalid');
exact(account, 'CONNECT_ACCOUNT_PASS', 1, 'connect-chatgpt-account.ps1');

for (const [name, text] of [['install',install],['supervisor',supervisor],['enable',enable],['disable',disable],['account',account]]) {
  if (text.includes('\u0000')) throw new Error(name + ' contains NUL');
  if (!text.endsWith('\n')) throw new Error(name + ' must end with newline');
}

console.log('SOURCE_INTEGRITY_PASS');
