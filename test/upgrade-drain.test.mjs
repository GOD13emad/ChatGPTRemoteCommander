import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGuiController } from '../src/gui-tools-windows.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverFile = path.join(repo, 'src', 'server-v0.3.mjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('mutating admission is counted before the asynchronous drain snapshot', async () => {
  const source = await readFile(serverFile, 'utf8');
  const admission = source.indexOf('activeMutations += 1;');
  const snapshot = source.indexOf('const drain = await drainSnapshot();', admission);
  const execution = source.indexOf('const result = await executeTool(name, args);', snapshot);
  assert.ok(admission > 0 && snapshot > admission && execution > snapshot,
    'mutation admission must linearize before checking the fence and executing the tool');
});

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(fn, timeoutMs = 6000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; }
    catch (error) { last = error; }
    await pause(25);
  }
  throw last ?? new Error('wait timeout');
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'remote-commander-upgrade-'));
  const project = path.join(root, 'project');
  await mkdir(project);
  const slowScript = path.join(project, 'slow.mjs');
  await writeFile(slowScript, "await new Promise(resolve => setTimeout(resolve, 1200));\nconsole.log('done');\n");
  const advertisedPort = await freePort();
  let backendPort = await freePort();
  while (backendPort === advertisedPort) backendPort = await freePort();
  const configuredMarker = path.join(root, 'configured-marker.json');
  const configuredAudit = path.join(root, 'configured-audit.jsonl');
  const marker = path.join(root, 'runtime', 'marker.json');
  const auditLog = path.join(root, 'audit', 'audit.jsonl');
  const drainFile = path.join(root, 'control', 'drain');
  const guiStopFile = path.join(root, 'control', 'GUI_STOP');
  const config = {
    host: '127.0.0.1', port: advertisedPort, deviceName: 'upgrade-fixture',
    instance: { profile: 'fixture', isolated: true },
    allowedRoots: [project], allowedPrograms: ['node'], maxCommandMs: 10000,
    auditLog: configuredAudit, runtimeState: configuredMarker,
    powerMode: {
      enabled: true, fullFilesystem: false, allowShell: true, allowProcessControl: true,
      allowPermanentDelete: false, backupRoot: path.join(root, 'backups'), maxCommandMs: 10000,
      maxOutputBytes: 1048576, maxTerminalBufferBytes: 262144,
      guiControl: { enabled: true, allowScreenshot: true, allowMouse: true, allowKeyboard: true, allowWindowFocus: true }
    },
    durableWorkflows: {
      enabled: true, directory: path.join(root, 'workflows'),
      executionTools: ['system_status', 'read_text', 'run_project_command']
    }
  };
  const configRaw = `${JSON.stringify(config, null, 2)}\n`;
  const configPath = path.join(root, 'config.json');
  await writeFile(configPath, configRaw);
  await mkdir(path.dirname(marker), { recursive: true });
  await writeFile(marker, '{"pid":0,"stale":true}\n');
  const expectedConfigSha = createHash('sha256').update(configRaw).digest('hex');
  const commit = 'a'.repeat(40);
  const env = { ...process.env };
  for (const name of ['REMOTE_COMMANDER_CONFIG', 'REMOTE_COMMANDER_LISTEN_PORT', 'REMOTE_COMMANDER_RUNTIME_STATE', 'REMOTE_COMMANDER_AUDIT_LOG', 'REMOTE_COMMANDER_DRAIN_FILE', 'REMOTE_COMMANDER_GUI_STOP_FILE', 'REMOTE_COMMANDER_RELEASE_COMMIT', 'REMOTE_COMMANDER_SLOT_ID']) delete env[name];
  Object.assign(env, {
    REMOTE_COMMANDER_CONFIG: configPath,
    REMOTE_COMMANDER_LISTEN_PORT: String(backendPort),
    REMOTE_COMMANDER_RUNTIME_STATE: marker,
    REMOTE_COMMANDER_AUDIT_LOG: auditLog,
    REMOTE_COMMANDER_DRAIN_FILE: drainFile,
    REMOTE_COMMANDER_GUI_STOP_FILE: guiStopFile,
    REMOTE_COMMANDER_RELEASE_COMMIT: commit,
    REMOTE_COMMANDER_SLOT_ID: 'green'
  });
  const child = spawn(process.execPath, [serverFile], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  let id = 1;
  const rpc = async (name, args = {}) => {
    const response = await fetch(`http://127.0.0.1:${backendPort}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } })
    });
    return (await response.json()).result;
  };
  const invoke = async (name, args = {}) => {
    const result = await rpc(name, args);
    assert.equal(result.isError, false, result.content?.[0]?.text);
    return result.structuredContent;
  };
  const health = await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(output);
    const response = await fetch(`http://127.0.0.1:${backendPort}/health`);
    return response.ok ? response.json() : null;
  });
  await waitFor(() => fs.existsSync(marker));
  return { root, project, slowScript, advertisedPort, backendPort, configuredMarker, configuredAudit, marker, auditLog, drainFile, guiStopFile, expectedConfigSha, commit, child, output: () => output, rpc, invoke, health };
}

async function dispose(f) {
  if (f.child.exitCode === null) f.child.kill();
  await Promise.race([new Promise(resolve => f.child.once('exit', resolve)), pause(2000)]);
  await rm(f.root, { recursive: true, force: true });
}

test('backend identity, overrides, drain fence, counters and snapshots are fail-closed', async () => {
  const f = await fixture();
  try {
    assert.equal(f.health.configSha256, f.expectedConfigSha);
    assert.equal(f.health.advertisedPort, f.advertisedPort);
    assert.equal(f.health.backendPort, f.backendPort);
    assert.deepEqual(f.health.backend, {
      profile: 'fixture', version: f.health.version, configSha256: f.expectedConfigSha,
      commit: f.commit, slotId: 'green', projectDir: repo, port: f.backendPort
    });
    const marker = JSON.parse(await readFile(f.marker, 'utf8'));
    assert.deepEqual(marker.backend, f.health.backend);
    assert.equal(marker.port, f.advertisedPort);
    assert.equal(marker.backendPort, f.backendPort);
    assert.equal(fs.existsSync(f.configuredMarker), false);

    await mkdir(path.dirname(f.guiStopFile), { recursive: true });
    await writeFile(f.guiStopFile, 'local stop\n');
    const stoppedGui = await f.invoke('gui_status');
    assert.equal(stoppedGui.blocked, true);
    assert.equal(stoppedGui.available, false);
    await rm(f.guiStopFile);

    const system = await f.invoke('system_status');
    assert.equal(system.configSha256, f.expectedConfigSha);
    assert.deepEqual(system.backend, f.health.backend);
    assert.equal(system.port, f.advertisedPort);
    assert.equal(system.backendPort, f.backendPort);

    const terminal = await f.invoke('start_terminal', { cwd: f.project });
    let status = await f.invoke('upgrade_status');
    assert.deepEqual(status.terminals, { total: 1, running: 1 });
    assert.deepEqual(status.gui, { leased: false, busy: false, uncertain: false, frame: false });
    assert.deepEqual(status.lockStats, { lockedKeys: 0, activeOperations: 0, queued: 0, hierarchyAware: true, canonicalAliases: true });
    await f.invoke('stop_terminal', { id: terminal.id });
    status = await f.invoke('upgrade_status');
    assert.deepEqual(status.terminals, { total: 0, running: 0 });

    await f.invoke('workflow_create', { id: 'upgrade', root: f.project, goal: 'Drain safely', acceptance: ['No mutation crosses the fence'], steps: [{ id: 'slow', title: 'Run bounded work' }] });
    const runningCall = f.invoke('workflow_call', { id: 'upgrade', stepId: 'slow', expectedRevision: 1, tool: 'run_project_command', arguments: { program: 'node', args: [f.slowScript], cwd: f.project, timeoutMs: 5000 } });
    status = await waitFor(async () => {
      const value = await f.invoke('upgrade_status');
      return value.activeMutations === 1 && value.workflows.running === 1 ? value : null;
    });
    assert.ok(status.activeCalls >= 1);
    await mkdir(path.dirname(f.drainFile), { recursive: true });
    await writeFile(f.drainFile, 'drain\n');
    status = await f.invoke('upgrade_status');
    assert.equal(status.draining, true);
    assert.equal(status.activeMutations, 1);
    assert.equal(status.workflows.running, 1);
    await runningCall;
    status = await waitFor(async () => {
      const value = await f.invoke('upgrade_status');
      return value.activeMutations === 0 && value.workflows.running === 0 ? value : null;
    });
    assert.equal(status.activeCalls, 0);
    assert.equal(status.workflows.uncertain, 0);

    const rejected = await f.rpc('write_text', { path: path.join(f.project, 'blocked.txt'), content: 'blocked' });
    assert.equal(rejected.isError, true);
    assert.match(rejected.content[0].text, /UPGRADE_DRAIN_ACTIVE/);
    assert.equal(fs.existsSync(path.join(f.project, 'blocked.txt')), false);
    assert.equal((await f.invoke('read_text', { path: f.slowScript })).sha256.length, 64);
    assert.equal((await f.invoke('system_status')).backend.port, f.backendPort);
    assert.equal(fs.existsSync(f.auditLog), true);
    assert.equal(fs.existsSync(f.configuredAudit), false);
  } finally { await dispose(f); }
});

test('backend refuses to serve when its ownership marker cannot be written atomically', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'remote-commander-marker-fail-'));
  const project = path.join(root, 'project');
  await mkdir(project);
  const markerDirectory = path.join(root, 'marker-target');
  await mkdir(markerDirectory);
  const port = await freePort();
  const config = {
    host: '127.0.0.1', port, deviceName: 'marker-failure-fixture',
    instance: { profile: 'fixture', isolated: true },
    allowedRoots: [project], allowedPrograms: [], maxCommandMs: 1000,
    auditLog: path.join(root, 'audit.jsonl'),
    powerMode: { enabled: false }
  };
  const configPath = path.join(root, 'config.json');
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const env = { ...process.env, REMOTE_COMMANDER_CONFIG: configPath,
    REMOTE_COMMANDER_LISTEN_PORT: String(port), REMOTE_COMMANDER_RUNTIME_STATE: markerDirectory,
    REMOTE_COMMANDER_RELEASE_COMMIT: 'b'.repeat(40), REMOTE_COMMANDER_SLOT_ID: 'blue' };
  const child = spawn(process.execPath, [serverFile], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  try {
    const code = await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      pause(6000).then(() => { throw new Error(`marker failure server did not exit: ${output}`); })
    ]);
    assert.equal(code, 1, output);
    assert.match(output, /RUNTIME_STATE_WRITE_FAILED.*RUNTIME_STATE_TARGET_INVALID/s);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) }));
  } finally {
    if (child.exitCode === null) child.kill();
    await rm(root, { recursive: true, force: true });
  }
});

test('GUI coordination snapshot contains state but no lease/frame tokens', async () => {
  let blockNext = false;
  let release;
  const image = () => ({
    ok: true, mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    width: 1, height: 1, snapshot: { foreground: 'fixture', processId: 1, bounds: { left: 0, top: 0, width: 1, height: 1 }, screenIndex: 0 }
  });
  const controller = createGuiController({
    platform: 'win32', token: (() => { let n = 0; return () => `token-${++n}`; })(), isStopped: async () => false,
    invoke: async request => {
      if (request.action === 'status') return { ok: true, available: true };
      if (request.action === 'screenshot') {
        if (blockNext) await new Promise(resolve => { release = resolve; });
        return image();
      }
      if (request.action === 'click') throw new Error('synthetic input failure');
      return { ok: true };
    }
  });
  const ctx = { config: { powerMode: { enabled: true, guiControl: { enabled: true, allowScreenshot: true, allowMouse: true, allowKeyboard: true, allowWindowFocus: true } } } };
  const lease = (await controller.execute(ctx, 'gui_session_begin', {})).lease;
  let shot = await controller.execute(ctx, 'gui_screenshot', { lease });
  let snapshot = controller.snapshot();
  assert.deepEqual(snapshot, { leased: true, busy: false, uncertain: false, frame: true });
  assert.equal(Object.hasOwn(snapshot, 'lease'), false);
  blockNext = true;
  const pending = controller.execute(ctx, 'gui_screenshot', { lease });
  await pause(0);
  assert.equal(controller.snapshot().busy, true);
  release();
  shot = await pending;
  await assert.rejects(controller.execute(ctx, 'gui_mouse_click', { lease, frame: shot.__structuredContent.frame, x: 0, y: 0 }), /synthetic input failure/);
  snapshot = controller.snapshot();
  assert.deepEqual(snapshot, { leased: true, busy: false, uncertain: true, frame: false });
});
