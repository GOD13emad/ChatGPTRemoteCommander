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

const bootEnable = read('enable-boot-recovery.ps1');
hasAll(bootEnable, [
  "BOOT_RECOVERY_ELEVATION_REQUIRED",
  "DataProtectionScope]::LocalMachine",
  "S-1-5-18",
  "S-1-5-32-544",
  "New-ScheduledTaskTrigger -AtStartup",
  "New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount",
  "CredentialSelfTest",
  "boot-recovery-system-probe.json",
  "Register-ScheduledTask -TaskName $HandoffTaskName",
  "New-ScheduledTaskTrigger -AtLogOn",
  "autoAdminLogonRequired=$false",
  "plaintextCredentialPersisted=$false"
], 'enable-boot-recovery.ps1');
for (const forbidden of ['AutoAdminLogon =', 'DefaultPassword', '-LogonType Password']) {
  if (bootEnable.includes(forbidden)) throw new Error('boot recovery unsafe marker: ' + forbidden);
}

const handoff = read('handoff-user-session-windows.ps1');
hasAll(handoff, [
  "Get-CommanderBusy",
  "active=$active",
  "leases=$leases",
  "HANDOFF_DEFERRED_BUSY",
  "Test-SystemOwner",
  "autostart-windows\\.ps1",
  "-BootCore",
  "system-tunnel",
  "system-mcp",
  "USER_SESSION_HANDOFF_PASS"
], 'handoff-user-session-windows.ps1');

const bootDisable = read('disable-boot-recovery.ps1');
hasAll(bootDisable, [
  "BOOT_RECOVERY_ELEVATION_REQUIRED",
  "Unregister-ScheduledTask",
  "*.machine.dpapi",
  "currentUserCredentialsPreserved=$true",
  "autoAdminLogonChanged=$false"
], 'disable-boot-recovery.ps1');

hasAll(supervisor, [
  "OwnerUserProfile",
  "CredentialScope",
  "CurrentUser','LocalMachine",
  "DataProtectionScope]::LocalMachine",
  "CredentialSelfTest",
  "SelfTestOutput",
  "BootCore",
  "OwnerLocalAppData",
  "OwnerRoamingAppData",
  "$env:USERPROFILE = $OwnerUserProfile"
], 'autostart-windows.ps1 boot recovery');

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
  for (const script of ['autostart-windows.ps1','enable-boot-recovery.ps1','handoff-user-session-windows.ps1','disable-boot-recovery.ps1']) {
    const parse = spawnSync('pwsh.exe', ['-NoLogo','-NoProfile','-Command',
      '$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile("'+script+'",[ref]$t,[ref]$e);if($e.Count){$e|ForEach-Object{$_.Message};exit 1}'],
      { encoding:'utf8' });
    if (parse.status !== 0) throw new Error(script+' parse failed: '+(parse.stderr||parse.stdout));
  }

  const policy = spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-File','test/supervisor-recovery-policy-windows.ps1'],{encoding:'utf8'});
  if(policy.status!==0) throw new Error('supervisor recovery policy failed: '+(policy.stderr||policy.stdout));
  if(!policy.stdout.includes('SUPERVISOR_RECOVERY_POLICY_PASS')) throw new Error('supervisor recovery policy marker missing');
  const stale = spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File','test/stale-drain-policy-windows.ps1'],{encoding:'utf8'});
  if(stale.status!==0) throw new Error('stale drain policy failed: '+(stale.stderr||stale.stdout));
  if(!stale.stdout.includes('STALE_DRAIN_POLICY_PASS')) throw new Error('stale drain policy marker missing');
  const stdio = spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File','test/backend-stdio-windows.ps1'],{encoding:'utf8',timeout:15000});
  if(stdio.status!==0) throw new Error('backend stdio detach failed: '+(stdio.stderr||stdio.stdout));
  if(!stdio.stdout.includes('BACKEND_STDIO_DETACH_PASS')) throw new Error('backend stdio detach marker missing');
}

console.log('WINDOWS_RUNTIME_CONTRACT_PASS');
