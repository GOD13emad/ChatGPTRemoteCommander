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
    'Stop-OwnedCandidate',
    '$currentCandidate',
    'GUI_POLICY_STATUS_FAIL',
    'SUPERVISOR_RECYCLE_PASS',
    'Cleanup-Releases',
    'RELEASE_CLEANUP_DEFER',
    'AUTO_UPDATE_CLEANUP_PENDING',
    'PROMOTED_MAINTENANCE_REQUIRED',
    'PROMOTED_DRAIN_PENDING',
    'AUTO_UPDATE_DRAIN_PENDING',
    'DRAIN_CANCEL_SAFE',
    'Complete-DeferredDrains',
    'DRAIN_STALE_CONFIRMED',
    'DRAIN_STALE_DEFER',
    'DRAIN_PERSISTENT_TERMINAL_DEFER',
    'AUTO_UPDATE_ACTIVE_TERMINALS_PRESERVE',
    'DRAIN_TERMINAL_RETAINED',
    'retained-backends.json',
    'AUTO_UPDATE_EXISTING_DRAIN_BLOCK',
    'BLOCKED_EXISTING_DRAIN',
    'PROMOTED_PARTIAL',
    'AUTO_UPDATE_PROFILE_DEFER',
    'AUTO_UPDATE_EXISTING_DRAIN_DEFER',
    'Get-PersistentTerminalChildren',
    'ROUTER_PREVIOUS_RETIRED',
    'router-retire.mjs',
    'stale-drain-policy.ps1',
    'AUTO_UPDATE_NEWER_CURRENT',
    'Test-VersionGreater'
  ]) assert.ok(s.includes(marker),marker);
  assert.ok(s.includes('https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest') && s.includes('Invoke-WebRequest') && s.includes('Invoke-RestMethod'),'Windows stable discovery must prefer published-release redirect with REST fallback');
  assert.ok(s.includes('[string[]]$CommandArgs'), 'gate helper must not bind the PowerShell automatic $args variable');
  assert.ok(s.includes('& npm.cmd @CommandArgs'), 'gate helper must pass the intended npm argument array');
  assert.ok(s.includes("GATE_START gui-native-selftest"), 'unattended updater must run non-interactive native GUI self-test');
  assert.ok(s.includes("gui-control.ps1") && s.includes("-SelfTest"), 'GUI candidate gate must compile/validate native helper without desktop interaction');
  assert.ok(!s.includes("Run-Gate $stage.Dir 'gui-native' @('run','test:gui-native')"), 'unattended updater must not run interactive GUI E2E');
  assert.ok(!s.includes("Invoke-Mcp $port 'gui_status'"), 'candidate validation must not contend for the shared interactive GUI helper');
  assert.ok(s.includes('Stop-OwnedCandidate $currentCandidate'), 'failure cleanup must include the current pre-registration candidate');
  assert.ok(s.indexOf('$currentCandidate=[pscustomobject]') > s.indexOf('$p=Start-Backend'), 'candidate ownership tracking must start immediately after spawn');
  const startBackend=s.slice(s.indexOf('function Start-Backend'),s.indexOf('function Stop-OwnedCandidate'));
  assert.ok(startBackend.includes('Start-Process') && !startBackend.includes('-RedirectStandardOutput') && !startBackend.includes('-RedirectStandardError'),'Windows staged backends must detach from updater run_shell stdio handles');
  const stale=s.slice(s.indexOf('function Get-StaleDrainEvidence'),s.indexOf('function Get-DrainStatus'));
  for(const marker of ['activeOperations','queued','unexpectedConnections','Get-NetTCPConnection -State Established','Get-BackendDescendants','guiBusy','guiLeased','DEFER_PROCESS_TREE'])assert.ok(stale.includes(marker),marker);
  assert.ok(!stale.includes('$isIdleTerminal'),'persistent terminals must always block stale-backend retirement');
  assert.ok(stale.includes('$routerListener'),'only the canonical router connection may be ignored as transport evidence');
  assert.ok(stale.includes("Get-StaleDrainDecision"),'stale recovery must pass independent evidence into a fail-closed policy');
  assert.ok(s.includes("Start-Sleep -Milliseconds 500") && s.includes("DRAIN_STALE_RECHECK_DEFER"),'stale recovery must re-check immediately before destructive stop');
  assert.ok(s.indexOf('Get-StaleDrainEvidence $OldActive') < s.indexOf('Stop-StaleBackendTree $OldActive'),'stale evidence must precede stale-backend retirement');
  assert.ok(s.includes("Retire-PreviousRoute $Target.RoutePath $OldActive $Target.Profile"),'successful Windows drain must atomically retire route.previous');
  const drain=s.slice(s.indexOf('function Drain-Previous'),s.indexOf('function Complete-DeferredDrains'));
  assert.ok(drain.indexOf('Get-PersistentTerminalChildren $OldActive') < drain.indexOf('Stop-OldBackend $OldActive'),'Windows immediate retirement must check persistent terminals before old-backend stop');
  const deferred=s.slice(s.indexOf('function Complete-DeferredDrains'),s.indexOf('function Has-SupersededRelease'));
  assert.ok(deferred.indexOf('Get-PersistentTerminalChildren $old') < deferred.indexOf('Stop-OldBackend $old'),'Windows deferred retirement must check persistent terminals before every old-backend stop path');
  const maintenance=s.slice(s.indexOf('$controlMismatch=($controlHead-ne $stage.Commit)'),s.indexOf('Push-Location $stage.Dir'));
  assert.ok(maintenance.includes("if($controlMismatch)") && maintenance.includes('Recycle-ControlSupervisor'),'control-code promotion may recycle the supervisor');
  const cleanupOnly=maintenance.slice(maintenance.lastIndexOf('$cleanupPending=@(Cleanup-Releases)'));
  assert.ok(cleanupOnly.includes("AUTO_UPDATE_CLEANUP_PENDING") && !cleanupOnly.includes('Recycle-ControlSupervisor'),'release cleanup alone must never recycle a healthy supervisor');
  assert.ok(!s.includes('[string[]]$Args'), 'reserved automatic $args name must not be used as a gate parameter');
  assert.ok(s.includes("Get-ChildItem -LiteralPath $InstanceRoot -Directory"), 'target discovery must enumerate only immediate profile directories');
  assert.ok(s.includes("Join-Path $profileDir.FullName 'instance.json'"), 'target discovery must bind only each profile directory instance record');
  assert.ok(!s.includes("Get-ChildItem -LiteralPath $InstanceRoot -Filter 'instance.json' -Recurse"), 'target discovery must never recurse into instance backups');
  assert.ok(s.includes('PROFILE_DIRECTORY_MISMATCH'), 'profile directory identity must fail closed');
  assert.ok(s.includes("AUTO_UPDATE_DRAIN_PENDING profiles=") && s.includes("AUTO_UPDATE_PROFILE_DEFER profiles="),'Windows committed cutover must preserve both post-cutover drains and independently deferred profiles');
  assert.ok(s.includes('DRAIN_TERMINAL_RETAINED') && s.includes('Get-ProtectedReleasePaths') && s.includes('Complete-RetainedBackends'),'Windows terminal keeper must durably detach zero-inflight previous backends and protect their release trees');
  assert.ok(s.includes('Get-TerminalRetentionEvidence') && s.includes('DRAIN_TERMINAL_STALE_ROUTER_ACCOUNTING'),'Windows terminal keeper must detach stale router accounting only after independent backend-idle evidence');
  const retainEvidence=s.slice(s.indexOf('function Get-TerminalRetentionEvidence'),s.indexOf('function Stop-StaleBackendTree'));
  for(const marker of ['activeOperations','queued','unexpectedConnections','guiBusy','guiLeased','terminalRoots','unsafeDescendants','Get-StaleDrainDecision'])assert.ok(retainEvidence.includes(marker),marker);
  assert.ok(s.includes('DRAIN_TERMINAL_RETAIN_RECHECK_DEFER') && s.includes('Start-Sleep -Milliseconds 500'),'terminal retention must re-check safety immediately before route detachment');
  assert.ok(s.includes("if($last.ok -and $last.count-gt 0 -and $last.cancellableOnly)"),'Windows may cancel only explicitly classified long-lived requests');
  assert.ok(s.indexOf('AUTO_UPDATE_NEWER_CURRENT') < s.indexOf("Run-Gate $stage.Dir 'check'"), 'automatic downgrade guard must precede candidate gates/cutover');
  const cutover=s.indexOf('if(Test-Path $t.RoutePath)');
  const existingDrainAdmission=s.indexOf('$existingDrainBlocks=@(Complete-DeferredDrains)');
  const terminalAdmission=s.indexOf('$terminalPreserve=@()');
  assert.ok(existingDrainAdmission>0 && existingDrainAdmission<terminalAdmission,'unresolved previous drain must be handled before active-terminal admission');
  const existingDrainBlock=s.slice(existingDrainAdmission,terminalAdmission);
  assert.ok(existingDrainBlock.includes('Where-Object{$_.Profile-eq$profile}') && existingDrainBlock.includes('AUTO_UPDATE_EXISTING_DRAIN_DEFER') && existingDrainBlock.includes('if($candidates.Count-eq0)'),'Windows existing-drain admission must defer only affected profiles and globally block only when none remain');
  assert.ok(terminalAdmission>0 && terminalAdmission<cutover,'persistent terminal admission must run before Windows route cutover');
  const terminalAdmissionBlock=s.slice(terminalAdmission,cutover);
  assert.ok(terminalAdmissionBlock.includes('AUTO_UPDATE_ACTIVE_TERMINALS_PRESERVE') && !terminalAdmissionBlock.includes('Stop-OwnedCandidate'),'Windows active terminals must be preserved through cutover rather than block or kill their profile');
  assert.ok(s.indexOf("Run-Gate $stage.Dir 'check'") < cutover, 'gates must precede cutover');
  assert.ok(s.indexOf('Verify-Tunnels') < s.indexOf('$cutoverCommitted=$true'), 'tunnels verified before commit point');
  const commitPoint=s.indexOf('$cutoverCommitted=$true');
  assert.ok(commitPoint>0 && s.indexOf('finalize-workflow-schema.mjs',commitPoint)>commitPoint, 'schema finalizes only after cutover commit in the main promotion path');
});

test('stable router and supervisor preserve canonical ports while backends are versioned',()=>{
  const router=read('src/stable-router.mjs'),switcher=read('tools/router-switch.mjs'),sup=read('supervisor-routing.ps1'),main=read('autostart-windows.ps1');
  for(const marker of ['ROUTER_GENERATION_CONFLICT','inflightByPort','inflightDetailsByPort','cancellable','subscriptions/listen','127.0.0.1','active.port'])assert.ok(router.includes(marker),marker);
  assert.ok(switcher.includes('ROUTER_PREVIOUS_NOT_DRAINED'),'router switch must fail closed while any previous generation remains');
  assert.ok(switcher.indexOf('current.previous') < switcher.indexOf("fetch('http://127.0.0.1:'"),'previous-generation guard must run before candidate switch I/O');
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
    'RELEASE_CLEANUP_DEFER',
    'AUTO_UPDATE_CLEANUP_PENDING',
    'AUTO_UPDATE_POST_COMMIT_MAINTENANCE_REQUIRED',
    'AUTO_UPDATE_DRAIN_PENDING',
    'DRAIN_PERSISTENT_TERMINAL_DEFER',
    'drain_previous_once',
    'retire_previous_route',
    'router-retire.mjs',
    'ROUTER_PREVIOUS_RETIRED',
    'cancellableOnly',
    'AUTO_UPDATE_NEWER_CURRENT',
    'version_gt',
    'stop_owned_candidate',
    'validation_cleanup',
    'trap validation_cleanup ERR',
    'persistent_terminal_pids',
    'AUTO_UPDATE_PERSISTENT_TERMINAL_BLOCK',
    'AUTO_UPDATE_EXISTING_DRAIN_BLOCK',
    'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest',
    '%{url_effective}',
    'install_linux_gui_backend',
    'LINUX_GUI_BACKEND_SYNCED'
  ]) assert.ok(s.includes(marker),marker);
  assert.ok(!s.includes('git ls-remote --tags --refs'),'Linux stable discovery must never promote a raw tag without a published Release');
  assert.ok(s.includes("log 'AUTO_UPDATE_DRAIN_PENDING profile=default'"),'Linux committed cutover must defer unsafe drains');
  assert.ok(s.includes('drain_previous_once "$STAGE_DIR" "$OLD_PORT"'), 'Linux drain must use conservative shared policy');
  assert.ok(s.includes('retire_previous_route "$helper" "$old_port"'), 'Linux successful drain must atomically retire route.previous');
  const linuxDrain=s.slice(s.indexOf('drain_previous_once(){'),s.indexOf('has_superseded_release(){'));
  assert.ok(linuxDrain.indexOf('persistent_terminal_pids') < linuxDrain.indexOf('stop_owned_from_config'),'Linux retirement must check persistent terminals before stopping the old backend');
  const currentMaintenance=s.slice(s.indexOf('if [[ "$CONTROL" != "$COMMIT" ]]; then'),s.indexOf('CANDIDATE_PID=""'));
  const cleanupOnlyLinux=currentMaintenance.slice(currentMaintenance.indexOf('if has_superseded_release; then'));
  assert.ok(currentMaintenance.includes('recycle_supervisor'),'Linux control-code promotion may recycle the supervisor');
  assert.ok(currentMaintenance.includes('install_linux_gui_backend "$STAGE_DIR" "$ACTIVE_CFG"'),'Linux control-code maintenance must synchronize the GUI backend before recycle');
  assert.ok(cleanupOnlyLinux.includes("AUTO_UPDATE_CLEANUP_PENDING") && !cleanupOnlyLinux.includes('recycle_supervisor'),'Linux release cleanup alone must never recycle a healthy supervisor');
  assert.ok(s.includes('stop_owned_candidate "$CANDIDATE_PID" "$STAGE_DIR"'), 'Linux validation failures must clean the exact spawned candidate');
  assert.ok(s.indexOf('trap validation_cleanup ERR') < s.indexOf('CANDIDATE_PID="$(start_backend'), 'Linux validation cleanup trap must be installed before candidate spawn');
  assert.ok(s.indexOf('AUTO_UPDATE_NEWER_CURRENT') < s.indexOf('run_gate "$STAGE_DIR" check npm run check'),'Linux automatic downgrade guard must precede gates/cutover');
  const gates=s.indexOf('run_gate "$STAGE_DIR" check npm run check');
  const cutover=s.lastIndexOf('if [[ -f "$ROUTE" ]]');
  const existingDrainAdmission=s.indexOf('EXISTING_PREV_PORT="$(json_field');
  const terminalAdmission=s.indexOf('TERMINAL_PIDS="$(persistent_terminal_pids');
  assert.ok(existingDrainAdmission>0 && existingDrainAdmission<terminalAdmission,'Linux unresolved previous drain must be handled before active-terminal admission');
  assert.ok(s.slice(existingDrainAdmission,terminalAdmission).includes("AUTO_UPDATE_EXISTING_DRAIN_BLOCK"),'Linux existing-drain blocker must exit before route mutation');
  assert.ok(terminalAdmission>0 && terminalAdmission<cutover,'Linux persistent terminal admission must run before route cutover');
  assert.ok(s.slice(terminalAdmission,cutover).includes('stop_owned_candidate "$CANDIDATE_PID" "$STAGE_DIR"'),'Linux terminal blocker must stop the unpromoted candidate');
  const commit=s.indexOf('CUTOVER_COMMITTED=1');
  assert.ok(gates>0 && cutover>gates,'Linux gates precede cutover');
  assert.ok(s.indexOf('tunnels_ready',cutover)<commit,'Linux tunnel verification precedes commit point');
  assert.ok(s.indexOf('finalize-workflow-schema.mjs',commit)>commit,'Linux schema finalization follows commit point');
  assert.ok(s.includes("systemctl --user restart --no-block chatgpt-remote-commander.service"), 'Linux systemd recycle must be asynchronous so the updater can finish its own cgroup work');
  assert.ok(s.includes('src/server-v0.3.mjs 9>&-'), 'Linux promoted backend must close inherited updater lock descriptor');
  assert.ok(s.includes('src/stable-router.mjs --listen-port 47831') && s.includes('9>&- >>"$log_file"'), 'Linux stable router must close inherited updater lock descriptor');
  assert.ok(s.includes('install_linux_gui_backend "$STAGE_DIR" "$FINAL_CFG"'),'Linux promotion must synchronize the GUI backend before control promotion');
  const finalPromote=s.lastIndexOf('promote_control "$COMMIT" "$REF"');
  const finalCleanup=s.indexOf('cleanup_releases',finalPromote);
  const finalPass=s.indexOf('AUTO_UPDATE_PASS version=',finalCleanup);
  const finalRecycle=s.indexOf('recycle_supervisor',finalPass);
  assert.ok(finalPromote>0 && finalCleanup>finalPromote && finalPass>finalCleanup && finalRecycle>finalPass, 'Linux cleanup and durable PASS log must precede self-cgroup supervisor restart');
  const maintenance=s.indexOf('AUTO_UPDATE_MAINTENANCE_PASS version=');
  assert.ok(maintenance>0 && s.lastIndexOf('cleanup_releases',maintenance)<maintenance && s.indexOf('recycle_supervisor',maintenance)>maintenance, 'Linux maintenance pass must be durable before supervisor restart request');
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
