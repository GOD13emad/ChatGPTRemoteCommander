import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const hasAll = (text, items, label) => {
  for (const item of items) if (!text.includes(item)) throw new Error(label + ' missing: ' + item);
};

const install = read('install.ps1');
hasAll(install, [
  "Tracked local changes exist in InstallDir",
  "Refusing non-fast-forward update or downgrade",
  "ExpectedCommit",
  "config-backups",
  "Get-ExpectedConfigHash",
  "mcp-runtime.json",
  "tunnel-client.json",
  "tunnel-client.json"
], 'install.ps1');

const enable = read('enable-autostart.ps1');
hasAll(enable, [
  "without ..",
  "Pinned tunnel-client state is missing",
  "TunnelId does not match the existing profile",
  "HealthPort does not match the existing profile",
  "saved only after tunnel validation passes",
  "Move-Item -LiteralPath $tmpCred -Destination $CredFile -Force"
], 'enable-autostart.ps1');

const supervisor = read('autostart-windows.ps1');
hasAll(supervisor, [
  "tunnel-client.json",
  "PROFILE_SKIPPED_INVALID",
  "ExecutablePath",
  "TUNNEL_READY",
  "Test-TunnelReady"
], 'autostart-windows.ps1');

const disable = read('disable-autostart.ps1');
hasAll(disable, [
  "Get-PinnedTunnelExe",
  "Get-ManagedProfiles",
  "mcp-runtime.json",
  "ExecutablePath"
], 'disable-autostart.ps1');

const account = read('connect-chatgpt-account.ps1');
hasAll(account, [
  "Persistent multi-account enrollment is active",
  "enable-autostart.ps1",
  "CONNECT_ACCOUNT_PASS",
  "HealthPort"
], 'connect-chatgpt-account.ps1');

console.log('WINDOWS_RUNTIME_CONTRACT_PASS');
