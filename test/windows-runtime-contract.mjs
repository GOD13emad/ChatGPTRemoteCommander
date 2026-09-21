import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = (p) => fs.readFileSync(p, 'utf8');
const hasAll = (text, items, label) => {
  for (const item of items) if (!text.includes(item)) throw new Error(label + ' missing: ' + item);
};

const install = read('install.ps1');
hasAll(install, [
  "Tracked local changes exist in InstallDir",
  "ExpectedCommit",
  "Invoke-ExistingSafeUpdate",
  "auto-update-windows.ps1",
  "capability-migrate.mjs",
  "update-backups",
  "Get-ExpectedConfigHash",
  "mcp-runtime.json",
  "tunnel-client.json",
  "SAFE_UPDATE_PASS"
], 'install.ps1');

const updater = read('auto-update-windows.ps1');
hasAll(updater, [
  "Local\\ChatGPTRemoteCommanderAutoUpdater",
  "workflow-shadow",
  "CANDIDATE_DOCTOR_FAIL",
  "Verify-Canonical",
  "Verify-Tunnels",
  "$cutoverCommitted=$true",
  "PROMOTED_MAINTENANCE_REQUIRED",
  "finalize-workflow-schema.mjs"
], 'auto-update-windows.ps1');

const enable = read('enable-autostart.ps1');
hasAll(enable, [
  "without ..",
  "Pinned tunnel-client state is missing",
  "TunnelId does not match the existing profile",
  "HealthPort does not match the existing profile",
  "saved only after tunnel validation passes",
  "Move-Item -LiteralPath $tmpCred -Destination $CredFile -Force",
  "--profile-dir $ProfileDir",
  "Test-AnyProfileProcess"
], 'enable-autostart.ps1');

const supervisor = read('autostart-windows.ps1');
hasAll(supervisor, [
  "tunnel-client.json",
  "PROFILE_SKIPPED_INVALID",
  "ExecutablePath",
  "TUNNEL_READY",
  "Test-TunnelReady",
  "ArgumentList.Add('--profile-dir')",
  "ArgumentList.Add($ProfileDir)",
  "supervisor-routing.ps1",
  "Ensure-RoutedProfile",
  "Start-AutoUpdateIfDue"
], 'autostart-windows.ps1');

const routing = read('supervisor-routing.ps1');
hasAll(routing, [
  "Get-RouteState",
  "Start-RoutedBackend",
  "Start-RouterForRoute",
  "ROUTER_READY",
  "AUTO_UPDATE_CHECK_STARTED"
], 'supervisor-routing.ps1');

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

if (process.platform === 'win32') {
  const policy = spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-File','test/supervisor-recovery-policy-windows.ps1'],{encoding:'utf8'});
  if(policy.status!==0) throw new Error('supervisor recovery policy failed: '+(policy.stderr||policy.stdout));
  if(!policy.stdout.includes('SUPERVISOR_RECOVERY_POLICY_PASS')) throw new Error('supervisor recovery policy marker missing');
}

console.log('WINDOWS_RUNTIME_CONTRACT_PASS');
