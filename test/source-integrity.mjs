import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const count = (text, needle) => text.split(needle).length - 1;
const physicalLines = (text) => text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
const exact = (text, needle, expected, label) => {
  const actual = count(text, needle);
  if (actual !== expected) throw new Error(`${label}: expected ${expected} occurrence(s) of ${needle}, found ${actual}`);
};

const install = read('install.ps1');
if (!install.startsWith('param(') || install.split(/\r?\n/).length > 800) throw new Error('install.ps1 structural envelope invalid');
for (const fn of [
  'function Assert-NoReparseAncestorChain(', 'function Assert-SafeLegacyRoot(',
  'function Resolve-DeploymentStateSignals(', 'function Get-DeploymentState {',
  'function Assert-BlueGreenInvocation(',
  'function Get-ManagedLegacyRoot {',
  'function Remove-ExactCandidateStage(', 'function Assert-CandidateCheckout(',
  'function New-ExactCandidateCheckout {',
  'function Invoke-BlueGreenDeployment(', 'function Install-Source {',
  'function Install-TunnelClient {', 'function Configure-LocalPolicy {',
  'function Start-LocalServer {'
]) exact(install, fn, 1, 'install.ps1');
exact(install, "[string]$ExpectedCommit = ''", 1, 'install.ps1 release placeholder');
exact(install, "throw 'EXPECTED_COMMIT_REQUIRED'", 1, 'install.ps1');
exact(install, "Write-Host 'INSTALL_PASS'", 1, 'install.ps1');
exact(install, "Write-Host 'BLUE_GREEN_INSTALL_PASS'", 1, 'install.ps1');
exact(install, "Write-Host 'BLUE_GREEN_INSTALL_ACCEPTED'", 1, 'install.ps1');
exact(install, "Write-Host 'BLUE_GREEN_BOOTSTRAP_PENDING'", 1, 'install.ps1');
exact(install, 'Require-Windows', 2, 'install.ps1'); // definition + invocation

const bluegreen = read('bluegreen-windows.ps1');
if (!bluegreen.startsWith('[CmdletBinding()]') || physicalLines(bluegreen) > 1200) throw new Error('bluegreen-windows.ps1 structural envelope invalid');
const bluegreenSupervisor = read('bluegreen-supervisor-windows.ps1');
if (!bluegreenSupervisor.startsWith('[CmdletBinding()]') || bluegreenSupervisor.split(/\r?\n/).length > 400) throw new Error('bluegreen-supervisor-windows.ps1 structural envelope invalid');
const bluegreenRunner = read('RUN_BLUEGREEN.ps1');
if (!bluegreenRunner.startsWith('[CmdletBinding()]') || bluegreenRunner.split(/\r?\n/).length > 200) throw new Error('RUN_BLUEGREEN.ps1 structural envelope invalid');

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

for (const [name, text] of [
  ['install',install], ['bluegreen',bluegreen], ['bluegreen-supervisor',bluegreenSupervisor],
  ['bluegreen-runner',bluegreenRunner], ['supervisor',supervisor], ['enable',enable],
  ['disable',disable], ['account',account]
]) {
  if (text.includes('\u0000')) throw new Error(name + ' contains NUL');
  if (!text.endsWith('\n')) throw new Error(name + ' must end with newline');
}

console.log('SOURCE_INTEGRITY_PASS');
