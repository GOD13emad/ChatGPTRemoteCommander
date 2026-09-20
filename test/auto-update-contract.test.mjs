import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

test('auto updater is candidate-first, hardware-gated and commit-point aware',()=>{
  const s=read('auto-update-windows.ps1');
  for(const marker of [
    'Local\\ChatGPTRemoteCommanderAutoUpdater',
    "Run-Gate $stage.Dir 'check'",
    "Run-Gate $stage.Dir 'test'",
    "Run-Gate $stage.Dir 'audit'",
    "Run-Gate $stage.Dir 'gui-native'",
    'copy-workflow-store.mjs',
    'workflow-shadow',
    'DisableCapability',
    'EnableCapability',
    'FINAL_CANDIDATE_DOCTOR_FAIL',
    'FULL_POWER_DELETE_FAIL',
    'RC_AUTOUPDATE_SHELL_PASS',
    'Verify-Canonical',
    'Verify-Tunnels',
    '$cutoverCommitted=$true',
    'finalize-workflow-schema.mjs',
    'Promote-Control',
    'Recycle-ControlSupervisor',
    'GATE_ARGUMENTS_MISSING',
    'CANDIDATE_CLEANUP_OWNERSHIP_MISMATCH',
    'SUPERVISOR_RECYCLE_PASS',
    'Cleanup-Releases',
    'PROMOTED_MAINTENANCE_REQUIRED'
  ]) assert.ok(s.includes(marker),marker);
  assert.ok(s.includes('[string[]]$CommandArgs'), 'gate helper must not bind the PowerShell automatic $args variable');
  assert.ok(s.includes('& npm.cmd @CommandArgs'), 'gate helper must pass the intended npm argument array');
  assert.ok(!s.includes('[string[]]$Args'), 'reserved automatic $args name must not be used as a gate parameter');
  const cutover=s.indexOf('if(Test-Path $t.RoutePath)');
  assert.ok(s.indexOf("Run-Gate $stage.Dir 'check'") < cutover, 'gates must precede cutover');
  assert.ok(s.indexOf('Verify-Tunnels') < s.indexOf('$cutoverCommitted=$true'), 'tunnels verified before commit point');
  const commitPoint=s.indexOf('$cutoverCommitted=$true');
  assert.ok(commitPoint>0 && s.indexOf('finalize-workflow-schema.mjs',commitPoint)>commitPoint, 'schema finalizes only after cutover commit in the main promotion path');
});

test('stable router and supervisor preserve canonical ports while backends are versioned',()=>{
  const router=read('src/stable-router.mjs'),sup=read('supervisor-routing.ps1'),main=read('autostart-windows.ps1');
  for(const marker of ['ROUTER_GENERATION_CONFLICT','inflightByPort','127.0.0.1','active.port'])assert.ok(router.includes(marker),marker);
  for(const marker of ['Get-RouteState','Start-RoutedBackend','Start-RouterForRoute','Ensure-RoutedProfile','Start-AutoUpdateIfDue'])assert.ok(sup.includes(marker),marker);
  assert.ok(main.includes(". (Join-Path $Root 'supervisor-routing.ps1')"));
  assert.ok(main.includes("Ensure-RoutedProfile 'default' 47831"));
});

test('installer delegates existing installations to candidate updater instead of in-place source mutation',()=>{
  const s=read('install.ps1');
  assert.ok(s.includes('Invoke-ExistingSafeUpdate'));
  assert.ok(s.includes("candidate-first update failed"));
  const main=s.indexOf('$existingInstall = Test-Path');
  const branch=s.indexOf('Invoke-ExistingSafeUpdate',main);
  const install=s.indexOf('Install-Source',main);
  assert.ok(main>0 && branch>main && install>branch);
});

test('Full Power means all known capabilities unless disabled explicitly',()=>{
  const s=read('src/capability-profile.mjs');
  for(const marker of ['autoEnableNewCapabilities','disabledCapabilities','filesystem.permanent_delete','shell.unrestricted','lifecycle.auto_update','lifecycle.zero_downtime_update'])assert.ok(s.includes(marker),marker);
  assert.ok(s.includes("next.powerMode.allowPermanentDelete = on('filesystem.permanent_delete')"));
  assert.ok(s.includes("next.powerMode.blockedShellPatterns = on('shell.unrestricted') ? []"));
});

test('public installation opts into stable automatic updates',()=>{
  const c=JSON.parse(read('config.json'));
  assert.equal(c.autoUpdate.enabled,true);
  assert.equal(c.autoUpdate.zeroDowntime,true);
  assert.equal(c.autoUpdate.channel,'stable');
  assert.ok(Number.isInteger(c.autoUpdate.intervalMinutes)&&c.autoUpdate.intervalMinutes>0);
});


test('Linux updater is candidate-first, hardware-gated, routed and rollback-aware',()=>{
  const s=read('auto-update-linux.sh');
  for(const marker of [
    'stage_release',
    'run_gate "$STAGE_DIR" check npm run check',
    'run_gate "$STAGE_DIR" test npm test',
    'run_gate "$STAGE_DIR" audit npm run audit',
    'copy-workflow-store.mjs',
    'workflow-shadow',
    'hardware-selftest.mjs',
    'router-switch.mjs',
    'router-init.mjs',
    'tunnels_ready',
    'CUTOVER_COMMITTED=1',
    'finalize-workflow-schema.mjs',
    'promote_control',
    'recycle_supervisor',
    'cleanup_releases',
    'AUTO_UPDATE_POST_COMMIT_MAINTENANCE_REQUIRED'
  ]) assert.ok(s.includes(marker),marker);
  const gates=s.indexOf('run_gate "$STAGE_DIR" check npm run check');
  const cutover=s.indexOf('if [[ -f "$ROUTE" ]]');
  const commit=s.indexOf('CUTOVER_COMMITTED=1');
  assert.ok(gates>0 && cutover>gates,'Linux gates precede cutover');
  assert.ok(s.indexOf('tunnels_ready',cutover)<commit,'Linux tunnel verification precedes commit point');
  assert.ok(s.indexOf('finalize-workflow-schema.mjs',commit)>commit,'Linux schema finalization follows commit point');
});

test('Linux supervisor recovers routed backend/router and schedules automatic updates',()=>{
  const sup=read('supervisor-routing-linux.sh'),main=read('autostart-linux.sh');
  for(const marker of ['ensure_routed_default','start_routed_backend','start_router_default','start_auto_update_if_due','AUTO_UPDATE_CHECK_STARTED'])assert.ok(sup.includes(marker),marker);
  assert.ok(main.includes('. "$ROOT/supervisor-routing-linux.sh"'));
  assert.ok(main.includes('ensure_routed_default || start_mcp'));
  assert.ok(main.includes('start_auto_update_if_due || true'));
});

test('Linux installer delegates existing installs and builds Full Power through shared capability profile',()=>{
  const s=read('install.sh');
  for(const marker of ['invoke_existing_safe_update','build-candidate-config.mjs','--disable-capability','--enable-capability','SAFE_UPDATE_PASS','capabilityProfile.tier'])assert.ok(s.includes(marker),marker);
  const branch=s.indexOf('if [[ -d "$INSTALL_DIR/.git" ]]');
  assert.ok(branch>0 && s.indexOf('invoke_existing_safe_update',branch)>branch);
});
