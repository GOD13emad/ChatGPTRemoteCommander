import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = {
  engine: path.join(repo, 'bluegreen-windows.ps1'),
  supervisor: path.join(repo, 'bluegreen-supervisor-windows.ps1'),
  runner: path.join(repo, 'RUN_BLUEGREEN.ps1')
};
const source = Object.fromEntries(Object.entries(files).map(([key, value]) => [key, fs.readFileSync(value, 'utf8')]));
const installer = fs.readFileSync(path.join(repo,'install.ps1'),'utf8');

function powershell(args) {
  const result = spawnSync('pwsh.exe', ['-NoLogo', '-NoProfile', ...args], {
    cwd: repo, encoding: 'utf8', timeout: 30_000, windowsHide: true
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

function includesAll(text, markers) {
  for (const marker of markers) assert.ok(text.includes(marker), `missing contract marker: ${marker}`);
}

function fingerprint(root) {
  if(!fs.existsSync(root))return [];
  const out=[];const walk=(dir)=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const full=path.join(dir,entry.name);const relative=path.relative(root,full).replaceAll('\\','/');if(entry.isDirectory()){out.push(`d:${relative}`);walk(full)}else{out.push(`f:${relative}:${fs.statSync(full).size}:${createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`)}}};walk(root);return out;
}

test('PowerShell parser and side-effect-free self tests pass', { skip: process.platform !== 'win32' }, () => {
  const quoted = Object.values(files).map(value => `'${value.replaceAll("'", "''")}'`).join(',');
  powershell(['-Command', `$failed=$false;foreach($f in @(${quoted})){$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($f,[ref]$t,[ref]$e);if($e.Count){$e|%{Write-Error $_.Message};$failed=$true}};if($failed){exit 1}`]);
  for (const [file, args] of [
    [files.engine, ['-SelfTest', '-NonInteractive']],
    [files.supervisor, ['-SelfTest']],
    [files.runner, ['-SelfTest', '-NonInteractive']]
  ]) {
    const value = JSON.parse(powershell(['-File', file, ...args]).split(/\r?\n/).at(-1));
    assert.equal(value.ok, true);
    if(file===files.engine){assert.equal(value.statusPipelineIsolated,true);assert.equal(value.bootstrapCrashBoundaryMatrix,true)}
  }
});

test('release, persistent-state and candidate identity contracts are pinned', () => {
  includesAll(source.engine, [
    "@('-C',$Authority.root,'archive','--format=zip'", 'releases', 'instances', 'control',
    'REMOTE_COMMANDER_LISTEN_PORT', 'REMOTE_COMMANDER_RUNTIME_STATE', 'REMOTE_COMMANDER_AUDIT_LOG',
    'REMOTE_COMMANDER_DRAIN_FILE', 'REMOTE_COMMANDER_RELEASE_COMMIT', 'REMOTE_COMMANDER_SLOT_ID',
    'REMOTE_COMMANDER_GUI_STOP_FILE', "Join-Path $ControlRoot 'GUI_STOP'", 'LegacyRoot',
    'CANDIDATE_SYSTEM_IDENTITY_FAILED', 'CANDIDATE_INSTANCE_IDENTITY_FAILED',
    'CANDIDATE_DURABLE_WORKFLOWS_REQUIRED', 'CANDIDATE_POWER_STATUS_POLICY_FAILED',
    'CANDIDATE_POWER_GUARDS_MISSING', 'allowPermanentDelete', 'fullFilesystem',
    "Invoke-NpmGate $ReleasePath @('run','test:gui-native')", "Invoke-NpmGate $Authority.root @('run','audit')",
    'CANDIDATE_TOOL_COUNT_REGRESSION', 'gui_focus_window', 'CONTROL_REVISION_CHANGE_REFUSED',
    'Assert-ReleaseManifestExact', '_FILE_SET_MISMATCH', 'CANDIDATE_HEAD_NOT_EXPECTED_COMMIT',
    'CANDIDATE_TRACKED_TREE_DIRTY', 'UNPROVEN_SHALLOW',
    'Recover-PreManagedBootstrapArtifacts', 'PREMANAGED_RECOVERY_ATTESTED',
    'PREMANAGED_RECOVERY_LISTENER_OWNERSHIP_UNPROVEN', 'BootstrapJournalPath',
    'BOOTSTRAP_TRANSACTION_REUSED', 'REMOTE_COMMANDER_GUI_STOP_FILE=Join-Path $ControlRoot',
    'GUI_MAINTENANCE_LEASE_RELEASE_FAILED', 'GUI_NATIVE_GATE_BLOCKED_BY_OWNER_STOP',
    'Write-Host $line', "ForEach-Object { Write-Host ([string]$_) }"
  ]);
  assert.match(source.engine, /schema=1; base=\$Base; controlRoot=\$ControlRoot[\s\S]*instances=@\([\s\S]*tunnelProfiles=@\([\s\S]*tunnelClient=\$null/);
  assert.ok(source.engine.indexOf('REMOTE_COMMANDER_CONFIG=[string]$Instance.configPath') < source.engine.indexOf('Invoke-CandidateRuntimeGates'));
});

test('legacy admission fence precedes safety proof and owns both tunnel binaries', () => {
  includesAll(source.engine, [
    'LEGACY_BOOTSTRAP_NEAR_ZERO_DOWNTIME', 'stateful zero downtime is not claimed',
    'legacyPath=$sourceExe', 'TUNNEL_CLIENT_OWNED_BINARY_HASH_MISMATCH',
    'MULTIPLE_TUNNEL_PROCESSES', 'TUNNEL_ADMISSION_FENCE_FAILED', 'TUNNEL_YAML_IDENTITY_DRIFT',
    'LEGACY_BACKEND_CHILD_TERMINAL_PRESENT', 'LEGACY_OWNERSHIP_MISMATCH',
    'LEGACY_WORKFLOW_NOT_READY', 'LEGACY_PRODUCTION_ARCHIVE_DELETE_PASS',
    'Prepare-LegacyRetirement', 'Finalize-LegacyRemoval', 'preserved-legacy-untracked-',
    'LEGACY_PRESERVE_COPY_VERIFY_FAILED', 'SERVICE_ACTIVE_CLEANUP_INCOMPLETE',
    'LEGACY_ROOT_MUST_NOT_EQUAL_BASE', 'BOOTSTRAP_ROLLBACK_ARTIFACT_DELETE_FAILED',
    'git-history.bundle', 'preserved-legacy-git-', 'LEGACY_GIT_PRESERVE_VERIFY_FAILED',
    'LegacyCleanupJournalPath', 'LEGACY_CLEANUP_JOURNAL_FINALIZE_FAILED',
    'SERVICE_ACTIVE_CLEANUP_INCOMPLETE_SOURCE_DRIFT', 'BOOTSTRAP_ROLLBACK_POINTER_IDENTITY_UNKNOWN',
    'Restore-LegacyRegistry', 'Stop-BootstrapStableRuntime', 'Set-BootstrapStableAccepted',
    'Remove-BootstrapJournalAfterManagedProof', 'managed-recover-accepted'
  ]);
  const body = source.engine.slice(source.engine.indexOf('function Invoke-Bootstrap'), source.engine.indexOf('function Invoke-Update'));
  assert.ok(body.indexOf('Stop-LegacySupervisor') < body.indexOf('Stop-ExactTunnelProfiles'), 'legacy supervisor must be fenced before tunnels');
  assert.ok(body.indexOf('Stop-ExactTunnelProfiles') < body.indexOf('Assert-LegacySafe'), 'admission fence must precede legacy safety proof');
  assert.ok(body.indexOf('Prepare-LegacyRetirement') < body.indexOf("Invoke-RouterControl $instance 'init'"), 'legacy preservation must precede router cutover');
  assert.ok(body.indexOf('Wait-TunnelsForInstance') < body.indexOf('Finalize-LegacyRemoval'), 'legacy deletion must follow stable service verification');
  assert.ok(body.indexOf('Set-BootstrapStableAccepted $Authority') < body.indexOf('Finalize-LegacyRemoval'), 'durable stable acceptance must precede legacy deletion');
});

test('update is drain/CAS fenced with rollback, unfence and bounded cleanup', () => {
  includesAll(source.engine, [
    'Assert-UpgradeSafe ([int]$entry.old.port) -RequireDrain', "Invoke-RouterControl $entry.instance 'switch'",
    '[int]$status.activeCalls -ne 0',
    'CUTOVER_ROLLBACK_PASS', 'UPDATE_FAILED_ROLLBACK_UNPROVEN',
    'Remove-Item -LiteralPath $entry.oldSlot.drainFile', 'Stop-InactiveCandidates',
    'Wait-OldInflightZero', 'Save-RemovalEvidence', 'Remove-ValidatedOldRelease',
    'BACKEND_STOP_OWNERSHIP_MISMATCH', 'OLD_RELEASE_PROCESS_REFERENCE_PRESENT',
    'UpdateJournalPath', "phase='prepared'", "phase='accepted'", 'Recover-UpdateTransaction',
    'UPDATE_RECOVERY_POINTER_UNKNOWN', 'RETIREMENT_POINTER_IDENTITY_DRIFT',
    'SERVICE_ACTIVE_RETIREMENT_INCOMPLETE', 'ChatGPTRemoteCommanderBlueGreenEngine',
    'BLUE_GREEN_ENGINE_ALREADY_RUNNING', 'Remove-UpdateJournalAfterManagedProof',
    'UPDATE_RECOVERY_ACCEPTED_FINALIZE_UNPROVEN', 'Assert-Deadline', '-Recovery'
  ]);
  const update = source.engine.slice(source.engine.indexOf('function Invoke-Update'), source.engine.indexOf('if ($SelfTest)'));
  assert.ok(update.indexOf('Save-RemovalEvidence') < update.indexOf('Stop-OwnedBackendIfRunning $entry.oldSlot.runtimeState $entry.old'));
  assert.ok(update.indexOf('Stop-OwnedBackendIfRunning $entry.oldSlot.runtimeState $entry.old') < update.indexOf('Remove-ValidatedOldRelease'));
  assert.ok(update.indexOf('foreach($entry in $tx){Assert-Deadline;New-Item') < update.indexOf("foreach($entry in $tx){Assert-Deadline;$entry.switched=Invoke-RouterControl"), 'all drains must precede the first switch');
  assert.match(update,/elseif\(Test-SameBackend \$current\.backend \$entry\.old\)\{\[void\]\(Wait-RouterHealthy/);
  const journalFinalizer=source.engine.slice(source.engine.indexOf('function Remove-UpdateJournalAfterManagedProof'),source.engine.indexOf('function Recover-UpdateTransaction'));
  assert.ok(journalFinalizer.indexOf('Assert-ManagedServiceHealthy')<journalFinalizer.indexOf('Remove-Item -LiteralPath $UpdateJournalPath'),'update journal must survive until managed health proof passes');
});

test('supervisor pins registry, exact router identity and startup order', () => {
  includesAll(source.supervisor, [
    'ManagedStatePath', 'MULTIPLE_AUTOSTART_ENTRIES_REFUSED',
    'BACKEND_UNKNOWN_LISTENER', 'ROUTER_UNKNOWN_LISTENER', 'TUNNEL_HEALTH_UNKNOWN_LISTENER',
    'ROUTER_CONFIG_AUTHORITY_MISMATCH', 'ROUTER_MARKER_IDENTITY_MISMATCH',
    'Assert-ReleaseIntegrity', 'Assert-ControlIntegrity', 'TUNNEL_YAML_IDENTITY_DRIFT',
    'Assert-ManagedState', 'MANAGED_INSTANCE_PATH_MISMATCH', 'RELEASE_FILE_SET_MISMATCH',
    'BACKEND_SPAWN_PID_MISMATCH', 'ROUTER_SPAWN_PID_MISMATCH', 'TUNNEL_HEALTH_LISTENER_OWNERSHIP_MISMATCH',
    "foreach ($key in @('routerId','profile','port','configSha256'))",
    "[IO.Path]::GetFullPath([string]$marker.projectDir)", 'CONTROL_PLANE_API_KEY',
    'supervisor-runtime.json', "role='bluegreen-supervisor'", "Write-SupervisorRuntime 'healthy'", 'heartbeatAt'
  ]);
  const iteration = source.supervisor.slice(source.supervisor.indexOf('function Invoke-Iteration'), source.supervisor.indexOf('if ($SelfTest)'));
  assert.ok(iteration.indexOf('Ensure-Backend') < iteration.indexOf('Ensure-Router'));
  assert.ok(iteration.indexOf('Ensure-Router') < iteration.indexOf('Ensure-Tunnel'));
  assert.match(source.engine, /Start-Process[\s\S]*Get-StableSupervisorSpec/);
  includesAll(source.supervisor, ['ManagedStatePath =', 'ManagedOverride', 'MANAGED_OVERRIDE_MISMATCH']);
});

test('runner provides Persian RTL UI and explicit remote noninteractive mode', () => {
  includesAll(source.runner, [
    '[switch]$NonInteractive', "RightToLeft = 'Yes'", 'RightToLeftLayout = $true',
    'ارتقای امن', 'توقف ایمن', 'bluegreen-windows.ps1', "'-NonInteractive'",
    '$psi.ArgumentList.Add($argument)', '$eventArgs.Cancel = $true', 'LegacyRoot'
  ]);
  includesAll(source.runner, [
    "state='accepted'", "phase='waiting-launcher-exit'", 'operationCandidateRoot',
    'operationCommit', 'operationTree', 'deadlineAt', 'heartbeatAt',
    'FileOptions]::WriteThrough', '$stream.Flush($true)', 'WORKER_CANDIDATE_CLEANUP_PATH_INVALID',
    'New-Process $pwsh $args.ToArray() $false $operationCandidate',
    'ENGINE_SUCCEEDED_AFTER_DEADLINE', '$receipt.engineExitCode=$engineExitCode'
  ]);
  const detached = source.runner.slice(source.runner.indexOf('if($NonInteractive-and-not$SelfTest-and-not$PlanOnly)'), source.runner.indexOf('if ($NonInteractive -or $SelfTest'));
  assert.match(detached, /clone --quiet --no-local --no-hardlinks/);
  assert.match(detached, /-File',\$operationRunner/);
  assert.doesNotMatch(detached, /&\s*\$pwsh\s+@engineArguments/);
  includesAll(installer, ['BLUE_GREEN_INSTALL_ACCEPTED', 'receipt must reach state=succeeded', 'verified independently before PASS']);
  assert.doesNotMatch(installer, /if \(\$NonInteractive\) \{ Write-Host 'BLUE_GREEN_INSTALL_PASS'/);
});

test('stable supervisor lookalike process is classified as a decoy and left running', { skip: process.platform !== 'win32', timeout: 30_000 }, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'remote-commander-decoy-'));const local=path.join(root,'local');const sleeper=path.join(root,'sleeper.ps1');const stable=path.join(local,'ChatGPTRemoteCommander','control','bluegreen-supervisor-windows.ps1');fs.writeFileSync(sleeper,'param([string]$Mention)\nStart-Sleep -Seconds 30\n');
  const decoy=spawn('pwsh.exe',['-NoLogo','-NoProfile','-File',sleeper,stable],{windowsHide:true,stdio:'ignore'});
  try{await new Promise(resolve=>setTimeout(resolve,500));const probe=spawnSync('pwsh.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "ProcessId=${decoy.pid}"|Select-Object ProcessId,ExecutablePath,CommandLine|ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true});const run=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-File',files.engine,'-SelfTest','-NonInteractive','-SelfTestDecoyPid',String(decoy.pid)],{encoding:'utf8',timeout:20_000,windowsHide:true,env:{...process.env,LOCALAPPDATA:local}});assert.equal(run.status,0,`${run.stderr}\n${run.stdout}\nprobe=${probe.stdout}`);const value=JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1));assert.equal(value.supervisorDecoyRejected,true);assert.equal(decoy.exitCode,null,'identity audit must not stop a decoy process')}
  finally{decoy.kill();await new Promise(resolve=>{if(decoy.exitCode!==null)return resolve();const timer=setTimeout(resolve,3000);decoy.once('exit',()=>{clearTimeout(timer);resolve()})});fs.rmSync(root,{recursive:true,force:true})}
});

test('worker refuses success when engine exits zero after its durable deadline', { skip: process.platform !== 'win32', timeout: 30_000 }, () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'remote-commander-deadline-'));const operation=path.join(root,'operation');const candidate=path.join(operation,'candidate');fs.mkdirSync(candidate,{recursive:true});const runner=path.join(candidate,'RUN_BLUEGREEN.ps1');fs.copyFileSync(files.runner,runner);fs.writeFileSync(path.join(candidate,'bluegreen-windows.ps1'),"param([string]$CandidateRoot,[string]$ExpectedCommit,[string]$LegacyRoot,[string]$Mode,[int]$TimeoutSeconds,[switch]$NonInteractive,[string]$DeadlineUtc)\nexit 0\n");const receiptPath=path.join(operation,'receipt.json');const deadline=new Date(Date.now()-60_000).toISOString();const receipt={schema:1,state:'accepted',phase:'queued',launcherPid:2147483000,launcherStartedAt:deadline,operationCandidateRoot:candidate,deadlineAt:deadline,stdoutLog:path.join(operation,'out.log'),stderrLog:path.join(operation,'err.log')};fs.writeFileSync(receiptPath,JSON.stringify(receipt));
  try{const run=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-File',runner,'-Worker','-NonInteractive','-ReceiptPath',receiptPath,'-CandidateRoot',candidate,'-ExpectedCommit','0'.repeat(40),'-LegacyRoot',path.join(root,'missing'),'-Mode','Bootstrap','-TimeoutSeconds','30','-DeadlineUtc',deadline],{cwd:candidate,encoding:'utf8',timeout:20_000,windowsHide:true});assert.equal(run.status,124,`${run.stderr}\n${run.stdout}`);const final=JSON.parse(fs.readFileSync(receiptPath,'utf8'));assert.equal(final.state,'failed');assert.equal(final.engineExitCode,0);assert.equal(final.exitCode,124);assert.equal(final.deadlineExceeded,true);assert.equal(final.errorCode,'ENGINE_SUCCEEDED_AFTER_DEADLINE');assert.equal(fs.existsSync(candidate),false)}finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('legacy cleanup rejects hardlinks and directory ADS without changing the external alias', { skip: process.platform !== 'win32', timeout: 30_000 }, () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'remote-commander-file-identity-'));const external=path.join(root,'external.txt');const legacy=path.join(root,'legacy');const linked=path.join(legacy,'linked.txt');fs.mkdirSync(legacy);fs.writeFileSync(external,'identity-preserved');fs.linkSync(external,linked);fs.writeFileSync(`${legacy}:audit-stream`,'directory-evidence');
  try{const before=fs.readFileSync(external,'utf8');const run=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-File',files.engine,'-SelfTest','-NonInteractive','-SelfTestLegacyFilePath',linked,'-SelfTestLegacyDirectoryPath',legacy],{encoding:'utf8',timeout:20_000,windowsHide:true});assert.equal(run.status,0,`${run.stderr}\n${run.stdout}`);const value=JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1));assert.equal(value.hardlinkRejected,true);assert.equal(value.directoryAdsRejected,true);assert.equal(fs.readFileSync(external,'utf8'),before);assert.equal(fs.readFileSync(linked,'utf8'),before);assert.equal(fs.readFileSync(`${legacy}:audit-stream`,'utf8'),'directory-evidence')}
  finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('detached worker survives immediate removal of its source checkout and finalizes receipt', { skip: process.platform !== 'win32', timeout: 60_000 }, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'remote-commander-detached-'));
  const sourceRoot=path.join(root,'source');const local=path.join(root,'local');fs.mkdirSync(sourceRoot,{recursive:true});fs.mkdirSync(local,{recursive:true});
  try{
    for(const name of ['RUN_BLUEGREEN.ps1','bluegreen-windows.ps1'])fs.copyFileSync(path.join(repo,name),path.join(sourceRoot,name));
    fs.writeFileSync(path.join(sourceRoot,'package.json'),'{"name":"detached-contract","version":"0.0.0"}\n');
    for(const args of [['init'],['config','user.email','contract@example.invalid'],['config','user.name','Contract'],['add','.'],['commit','-m','fixture']]){
      const r=spawnSync('git.exe',args,{cwd:sourceRoot,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,`${r.stderr}\n${r.stdout}`);
    }
    const commit=spawnSync('git.exe',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8',windowsHide:true}).stdout.trim();
    const started=Date.now();const run=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-File',path.join(sourceRoot,'RUN_BLUEGREEN.ps1'),'-CandidateRoot',sourceRoot,'-ExpectedCommit',commit,'-LegacyRoot',path.join(root,'missing-legacy'),'-Mode','Bootstrap','-TimeoutSeconds','30','-NonInteractive'],{cwd:sourceRoot,encoding:'utf8',timeout:20_000,windowsHide:true,env:{...process.env,LOCALAPPDATA:local}});
    assert.equal(run.status,0,`${run.stderr}\n${run.stdout}`);assert.ok(Date.now()-started<20_000,'launcher must return without running the engine synchronously');
    const accepted=JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1));assert.equal(accepted.state,'accepted');assert.ok(fs.existsSync(accepted.receiptPath));
    fs.rmSync(sourceRoot,{recursive:true,force:true});let receipt;
    for(let i=0;i<120;i++){receipt=JSON.parse(fs.readFileSync(accepted.receiptPath,'utf8'));if(['failed','succeeded'].includes(receipt.state))break;await new Promise(resolve=>setTimeout(resolve,250));}
    const probe=spawnSync('pwsh.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "ProcessId=${Number(receipt.workerPid)}"|Select-Object ProcessId,ParentProcessId,CommandLine|ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true});const workerError=path.join(path.dirname(receipt.receiptPath),'worker-error.log');const diagnostics={receipt,worker:probe.stdout,workerError:fs.existsSync(workerError)?fs.readFileSync(workerError,'utf8'):'',stdout:fs.existsSync(receipt.stdoutLog)?fs.readFileSync(receipt.stdoutLog,'utf8'):'',stderr:fs.existsSync(receipt.stderrLog)?fs.readFileSync(receipt.stderrLog,'utf8'):''};const diagnosticText=JSON.stringify(diagnostics);assert.equal(receipt.state,'failed',diagnosticText);assert.equal(receipt.phase,'final',diagnosticText);assert.equal(receipt.operationCommit,commit);assert.equal(receipt.stagingCleaned,true);assert.equal(fs.existsSync(receipt.operationCandidateRoot),false);
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('plan-only exits before cleanup recovery or any runtime orchestration', () => {
  const release = source.engine.indexOf('$releasePath=if($PlanOnly)');
  const plan = source.engine.indexOf('if ($PlanOnly) {', release);
  const cleanup = source.engine.indexOf('if ($legacyCleanupPending)');
  const candidate = source.engine.indexOf('$candidates = @{}');
  assert.ok(plan > 0 && cleanup > plan && candidate > cleanup);
  const planBody = source.engine.slice(plan, cleanup);
  assert.match(planBody, /exit 0/);
  assert.doesNotMatch(planBody, /Remove-Item|Stop-Process|Start-Process/);
  assert.ok(source.engine.indexOf('ChatGPTRemoteCommanderBlueGreenEngine') < source.engine.indexOf('$authority=Get-SourceAuthority'));
  assert.match(source.engine.slice(release,plan), /if\(\$PlanOnly\).*\$authority\.releasePath.*else\{Prepare-Release \$authority\}/s);
});

test('plan-only leaves local control and tunnel-profile trees byte-identical', { skip: process.platform !== 'win32', timeout: 30_000 }, () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'remote-commander-plan-'));const sourceRoot=path.join(root,'source');const local=path.join(root,'local');const roaming=path.join(root,'roaming');const base=path.join(local,'ChatGPTRemoteCommander');const legacy=path.join(base,'app');const profiles=path.join(roaming,'tunnel-client');
  try{
    fs.mkdirSync(sourceRoot,{recursive:true});fs.mkdirSync(legacy,{recursive:true});fs.mkdirSync(path.join(base,'credentials'),{recursive:true});fs.mkdirSync(profiles,{recursive:true});fs.copyFileSync(files.engine,path.join(sourceRoot,'bluegreen-windows.ps1'));fs.writeFileSync(path.join(sourceRoot,'package.json'),'{"name":"plan-contract","version":"0.0.0"}\n');fs.writeFileSync(path.join(legacy,'config.local.json'),'{"port":47831}\n');fs.writeFileSync(path.join(base,'credentials','default.dpapi'),'fixture');fs.writeFileSync(path.join(profiles,'default.yaml'),'url: http://127.0.0.1:47831/mcp\nlisten_addr: 127.0.0.1:48080\n');
    for(const cwd of [sourceRoot,legacy])for(const args of [['init'],['config','user.email','contract@example.invalid'],['config','user.name','Contract'],['add','.'],['commit','-m','fixture']]){const r=spawnSync('git.exe',args,{cwd,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,`${r.stderr}\n${r.stdout}`)}const commit=spawnSync('git.exe',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8',windowsHide:true}).stdout.trim();const before=[fingerprint(base),fingerprint(profiles)];
    const run=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-File',path.join(sourceRoot,'bluegreen-windows.ps1'),'-CandidateRoot',sourceRoot,'-ExpectedCommit',commit,'-LegacyRoot',legacy,'-Mode','Bootstrap','-PlanOnly','-NonInteractive'],{cwd:sourceRoot,encoding:'utf8',timeout:20_000,windowsHide:true,env:{...process.env,LOCALAPPDATA:local,APPDATA:roaming}});assert.equal(run.status,0,`${run.stderr}\n${run.stdout}`);assert.deepEqual([fingerprint(base),fingerprint(profiles)],before);assert.equal(fs.existsSync(path.join(base,'control')),false);assert.equal(JSON.parse(run.stdout.trim()).ok,true);
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('engine mutex rejects a concurrent mutator before source or state inspection', { skip: process.platform !== 'win32', timeout: 20_000 }, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'remote-commander-mutex-'));const ready=path.join(root,'ready');const stop=path.join(root,'stop');const command="$m=[Threading.Mutex]::new($false,'Local\\ChatGPTRemoteCommanderBlueGreenEngine');if(-not$m.WaitOne(0)){exit 2};[IO.File]::WriteAllText($env:READY_FILE,'ready');while(-not(Test-Path -LiteralPath $env:STOP_FILE)){Start-Sleep -Milliseconds 50};$m.ReleaseMutex();$m.Dispose()";const holder=spawn('pwsh.exe',['-NoProfile','-Command',command],{windowsHide:true,stdio:'ignore',env:{...process.env,READY_FILE:ready,STOP_FILE:stop}});
  try{for(let i=0;i<100&&!fs.existsSync(ready);i++)await new Promise(resolve=>setTimeout(resolve,50));assert.equal(fs.existsSync(ready),true,'mutex holder did not become ready');const run=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-File',files.engine,'-CandidateRoot',path.join(root,'missing'),'-ExpectedCommit','invalid','-NonInteractive'],{encoding:'utf8',timeout:10_000,windowsHide:true,env:{...process.env,LOCALAPPDATA:path.join(root,'local'),APPDATA:path.join(root,'roaming')}});assert.notEqual(run.status,0);assert.match(`${run.stderr}\n${run.stdout}`,/BLUE_GREEN_ENGINE_ALREADY_RUNNING/);assert.equal(fs.existsSync(path.join(root,'local','ChatGPTRemoteCommander')),false)}finally{fs.writeFileSync(stop,'stop');await new Promise(resolve=>{const timer=setTimeout(()=>{holder.kill();resolve()},5000);holder.once('exit',()=>{clearTimeout(timer);resolve()})});fs.rmSync(root,{recursive:true,force:true})}
});

test('scripts contain no obvious credential disclosure path', () => {
  for (const text of Object.values(source)) {
    assert.doesNotMatch(text, /Write-(?:Output|Host|SafeLog)[^\n]*(?:\$plain|CONTROL_PLANE_API_KEY|credentialPath)/i);
    assert.doesNotMatch(text, /ConvertFrom-SecureString[^\n]*-AsPlainText/i);
  }
  includesAll(source.engine + source.supervisor, ['SECRET_IN_LOG_REFUSED']);
});
