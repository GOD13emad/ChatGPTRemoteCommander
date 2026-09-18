import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const hasAll = (text, items, label) => {
  for (const item of items) if (!text.includes(item)) throw new Error(label + ' missing: ' + item);
};

const install = read('install.ps1');
hasAll(install, [
  'Tracked working-tree changes detected',
  'SourceRef',
  'checkout --detach --force',
  'config-backups',
  'configSha256',
  'runtime-state.json',
  'tunnel-client.active.json',
  'archiveSha256',
  'does not match verified release archive'
], 'install.ps1');

const enable = read('enable-autostart.ps1');
hasAll(enable, [
  '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$',
  'Pinned tunnel-client manifest is missing',
  'Requested TunnelId does not match the existing profile',
  'Requested HealthPort does not match the existing profile',
  'saved only after validation succeeds',
  'Move-Item -LiteralPath $tempCred -Destination $CredFile -Force'
], 'enable-autostart.ps1');

const supervisor = read('autostart-windows.ps1');
hasAll(supervisor, [
  'tunnel-client.active.json',
  'PROFILE_REJECTED',
  'ExecutablePath',
  'TUNNEL_STARTED',
  'TUNNEL_STUCK_RESTART',
  'Test-TunnelReady'
], 'autostart-windows.ps1');

const disable = read('disable-autostart.ps1');
hasAll(disable, [
  'function Find-TunnelExe',
  'function ManagedProfiles',
  'ExpectedInstanceId',
  'ExecutablePath'
], 'disable-autostart.ps1');

const account = read('connect-chatgpt-account.ps1');
hasAll(account, [
  'Persistent multi-account enrollment is active',
  'enable-autostart.ps1',
  'ACCOUNT_CONNECT_PASS',
  'HealthPort'
], 'connect-chatgpt-account.ps1');

console.log('WINDOWS_RUNTIME_CONTRACT_PASS');
