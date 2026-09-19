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
  "EXPECTED_COMMIT_REQUIRED",
  "config-backups",
  "Get-ExpectedConfigHash",
  "mcp-runtime.json",
  "tunnel-client.json",
  "function Get-DeploymentState {",
  "function Resolve-DeploymentStateSignals(",
  "function Assert-NoReparseAncestorChain(",
  "function Assert-SafeLegacyRoot(",
  "BLUE_GREEN_STATE_PARTIAL",
  "BLUE_GREEN_MANAGED_EXPLICIT_INSTALL_DIR_REFUSED",
  "BLUE_GREEN_REGISTRY_MISMATCH",
  "BLUE_GREEN_MANAGED_STATE_MISMATCH",
  "LEGACY_ROOT_EQUALS_STATE_ROOT_REFUSED",
  "LEGACY_ROOT_OUTSIDE_STATE_ROOT_REFUSED",
  "function Assert-BlueGreenInvocation",
  "BLUE_GREEN_EXPECTED_COMMIT_REQUIRED",
  "BLUE_GREEN_CONFIG_SWITCH_REFUSED",
  "function Get-ManagedLegacyRoot {",
  "function New-ExactCandidateCheckout {",
  "function Assert-CandidateCheckout(",
  "fetch --depth 1 --no-tags origin $SourceRef",
  "rev-parse 'FETCH_HEAD^{commit}'",
  "checkout --detach $resolved",
  "function Remove-ExactCandidateStage",
  "CANDIDATE_STAGE_CLEANUP_PATH_REFUSED",
  "CANDIDATE_STAGE_CLEANUP_REPARSE_POINT_REFUSED",
  "CANDIDATE_STAGE_CLEANUP_NESTED_REPARSE_POINT_REFUSED",
  "CANDIDATE_STAGE_CLEANUP_ANCESTOR_REPARSE_REFUSED",
  "CANDIDATE_WORKTREE_NOT_CLEAN",
  "CANDIDATE_SPECIAL_ENTRY_REFUSED",
  "CANDIDATE_BLUE_GREEN_FILE_UNTRACKED",
  "'-CandidateRoot',$candidate.root",
  "'-ExpectedCommit',$candidate.commit",
  "@('-LegacyRoot',$InstallDir)",
  "@('-LegacyRoot',(Get-ManagedLegacyRoot))",
  "BLUE_GREEN_INSTALL_PASS",
  "BLUE_GREEN_INSTALL_ACCEPTED",
  "BLUE_GREEN_BOOTSTRAP_PENDING"
], 'install.ps1');

const classifyAt = install.indexOf('$deploymentState = Get-DeploymentState');
const prerequisitesAt = install.indexOf('Ensure-Prerequisites', classifyAt);
const installSourceAt = install.indexOf('  Install-Source', classifyAt);
if (classifyAt < 0 || prerequisitesAt < classifyAt || installSourceAt < prerequisitesAt) {
  throw new Error('install.ps1 deployment classification/order contract failed');
}
if (!install.includes("if ($deploymentState -eq 'Fresh')") || !install.includes('Invoke-BlueGreenDeployment $deploymentState')) {
  throw new Error('install.ps1 Fresh versus blue/green dispatch contract failed');
}

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
  "ArgumentList.Add($ProfileDir)"
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

const guiNativeRun = read('test/gui-native-run.mjs');
hasAll(guiNativeRun, [
  "path.join(process.env.LOCALAPPDATA, 'Microsoft', 'dotnet', 'dotnet.exe')",
  "GUI_NATIVE_DOTNET_10_SDK_REQUIRED",
  "process.env.REMOTE_COMMANDER_DOTNET_EXE = dotnet"
], 'test/gui-native-run.mjs');

const guiNativeE2e = read('test/gui-native-e2e.mjs');
hasAll(guiNativeE2e, [
  "mkdtemp(path.join(os.tmpdir(),'remote-commander-gui-e2e-'))",
  "process.env.REMOTE_COMMANDER_DOTNET_EXE||'dotnet'",
  "const verified=interactionVerified && focusRestored",
  "await rm(scratch,{recursive:true,force:true})"
], 'test/gui-native-e2e.mjs');
if (guiNativeE2e.includes("path.join(root,'var','gui-e2e")) {
  throw new Error('native GUI E2E must not write transient state into the immutable release tree');
}

console.log('WINDOWS_RUNTIME_CONTRACT_PASS');
