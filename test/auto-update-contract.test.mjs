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
    'Run-GuiNativeSelfTest $stage.Dir',
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
    'PROMOTED_MAINTENANCE_REQUIRED',
    'PROMOTED_DRAIN_PENDING',
    'AUTO_UPDATE_DRAIN_PENDING',
    'DRAIN_CANCEL_SAFE',
    'Complete-DeferredDrains',
    'AUTO_UPDATE_NEWER_CURRENT',
    'Test-VersionGreater'
  ]) assert.ok(s.includes(marker),marker);
  assert.ok(s.includes('[string[]]$CommandArgs'), 'gate helper must not bind the PowerShell automatic $args variable');
  assert.ok(s.includes('& npm.cmd @CommandArgs'), 'gate helper must pass the intended npm argument array');
  assert.ok(s.includes("GATE_START gui-native-selftest"), 'unattended updater must run non-interactive native GUI self-test');
  assert.ok(s.includes("gui-control.ps1") && s.includes("-SelfTest"), 'GUI candidate gate must compile/validate native helper without desktop interaction');
  assert.ok(!s.includes("Run-Gate $stage.Dir 'gui-native' @('run','test:gui-native')"), 'unattended updater must not run interactive GUI E2E');
  assert.ok(!s.includes('[string[]]$Args'), 'reserved automatic $args name must not be used as a gate parameter');
  assert.ok(s.includes("Get-ChildItem -LiteralPath $InstanceRoot -Directory"), 'target discovery must enumerate only immediate profile directories');
  assert.ok(s.includes("Join-Path $profileDir.FullName 'instance.json'"), 'target discovery must bind only each profile directory instance record');
  assert.ok(!s.includes("Get-ChildItem -LiteralPath $InstanceRoot -Filter 'instance.json' -Recurse"), 'target discovery must never recurse into instance backups');
  assert.ok(s.includes('PROFILE_DIRECTORY_MISMATCH'), 'profile directory identity must fail closed');
  assert.ok(s.includes("AUTO_UPDATE_DRAIN_PENDING profiles="),'Windows committed cutover must defer unsafe drains instead of throwing');
  assert.ok(s.includes("if($last.ok -and $last.count-gt 0 -and $last.cancellableOnly)"),'Windows may cancel only explicitly classified long-lived requests');
  assert.ok(s.indexOf('AUTO_UPDATE_NEWER_CURRENT') < s.indexOf("Run-Gate $stage.Dir 'check'"), 'automatic downgrade guard must precede candidate gates/cutover');
  const cutover=s.indexOf('if(Test-Path $t.RoutePath)');
  assert.ok(s.indexOf("Run-Gate $stage.Dir 'check'") < cutover, 'gates must precede cutover');
  assert.ok(s.indexOf('Verify-Tunnels') < s.indexOf('$cutoverCommitted=$true'), 'tunnels verified before commit point');
  const commitPoint=s.indexOf('$cutoverCommitted=$true');
  assert.ok(commitPoint>0 && s.indexOf('finalize-workflow-schema.mjs',commitPoint)>commitPoint, 'schema finalizes only after cutover commit in the main promotion path');
});

test('stable router and supervisor preserve canonical ports while backends are versioned',()=>{
  const router=read('src/stable-router.mjs'),sup=read('supervisor-routing.ps1'),main=read('autostart-windows.ps1');
  for(const marker of ['ROUTER_GENERATION_CONFLICT','inflightByPort','inflightDetailsByPort','cancellable','subscriptions/listen','127.0.0.1','active.port'])assert.ok(router.includes(marker),marker);
  for(const marker of [
    'Get-RouteState','Start-RoutedBackend','Start-RouterForRoute','Ensure-RoutedProfile','Start-AutoUpdateIfDue',
    'Get-RouterStatusSafe','Get-RouterBackendActivity','Get-RoutedBackendRecoveryDecision',
    'RoutedBackendHealthFailureThreshold','DEFER_BUSY','DEFER_TRANSIENT','DEFER_UNPROVEN',
    'ROUTED_BACKEND_RECYCLE_$decision','ROUTED_BACKEND_RECYCLE_CONFIRMED',
    'ROUTER_SOURCE_ACTIVATION_DEFERRED','Get-FileHash','sourceSha256'
  ])assert.ok(sup.includes(marker),marker);
  assert.ok(sup.includes('Start-RoutedBackend $route $CanonicalPort'),'backend recovery must inspect the canonical router before any recycle');
  const routerStart=sup.slice(sup.indexOf('function Start-RouterForRoute'),sup.indexOf('function Ensure-RoutedProfile'));
  assert.ok(!routerStart.includes('Stop-OwnedRouter'),'live source drift must not create a canonical-listener gap');
  assert.ok(main.includes(". (Join-Path $Root 'supervisor-routing.ps1')"));
  assert.ok(main.includes("Ensure-RoutedProfile 'default' 47831"));
});

test('Windows routed-backend recovery is thresholded and fail-closed around live work',()=>{
  const sup=read('supervisor-routing.ps1');
  const decision=sup.slice(sup.indexOf('function Get-RoutedBackendRecoveryDecision'),sup.indexOf('function Stop-OwnedRouter'));
  assert.ok(decision.indexOf("DEFER_UNPROVEN") < decision.indexOf("RECYCLE"));
  assert.ok(decision.indexOf("DEFER_BUSY") < decision.indexOf("RECYCLE"));
  assert.ok(decision.indexOf("DEFER_TRANSIENT") < decision.indexOf("RECYCLE"));
  const backend=sup.slice(sup.indexOf('function Start-RoutedBackend'),sup.indexOf('function Start-RouterForRoute'));
  assert.ok(backend.includes('Start-Sleep -Milliseconds 500'),'recycle must include a final recovery probe');
  assert.ok(backend.includes("if(-not $activity.Known -or $activity.Count -gt 0)"),'final recycle gate must re-check router activity');
  assert.ok(backend.indexOf('Get-RouterBackendActivity') < backend.indexOf('Stop-OwnedRoutedBackend'),'activity proof must precede destructive stop');
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
    'AUTO_UPDATE_POST_COMMIT_MAINTENANCE_REQUIRED',
    'AUTO_UPDATE_DRAIN_PENDING',
    'drain_previous_once',
    'cancellableOnly',
    'AUTO_UPDATE_NEWER_CURRENT',
    'version_gt'
  ]) assert.ok(s.includes(marker),marker);
  assert.ok(s.includes("log 'AUTO_UPDATE_DRAIN_PENDING profile=default'"),'Linux committed cutover must defer unsafe drains');
  assert.ok(s.includes('drain_previous_once "$STAGE_DIR" "$OLD_PORT"'), 'Linux drain must use conservative shared policy');
  assert.ok(s.indexOf('AUTO_UPDATE_NEWER_CURRENT') < s.indexOf('run_gate "$STAGE_DIR" check npm run check'),'Linux automatic downgrade guard must precede gates/cutover');
  const gates=s.indexOf('run_gate "$STAGE_DIR" check npm run check');
  const cutover=s.indexOf('if [[ -f "$ROUTE" ]]');
  const commit=s.indexOf('CUTOVER_COMMITTED=1');
  assert.ok(gates>0 && cutover>gates,'Linux gates precede cutover');
  assert.ok(s.indexOf('tunnels_ready',cutover)<commit,'Linux tunnel verification precedes commit point');
  assert.ok(s.indexOf('finalize-workflow-schema.mjs',commit)>commit,'Linux schema finalization follows commit point');
});

test('Linux supervisor recovers routed backend/router and schedules automatic updates',()=>{
  const sup=read('supervisor-routing-linux.sh'),main=read('autostart-linux.sh');
  for(const marker of ['ensure_routed_default','start_routed_backend','start_router_default','start_auto_update_if_due','AUTO_UPDATE_CHECK_STARTED','router_source_sha','ROUTER_SOURCE_ACTIVATION_DEFERRED','sourceSha256'])assert.ok(sup.includes(marker),marker);
  const routerStart=sup.slice(sup.indexOf('start_router_default()'),sup.indexOf('ensure_routed_default()'));
  assert.ok(!routerStart.includes('stop_owned_router_default'),'Linux live source drift must not create a canonical-listener gap');
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
