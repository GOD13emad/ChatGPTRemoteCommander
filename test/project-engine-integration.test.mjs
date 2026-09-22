import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorkflowTools } from '../src/workflow-tools.mjs';
import { validateJsonSchema } from '../src/schema-validator.mjs';
import { listDirectory, readText, writeText } from '../src/tools-v0.3.mjs';
import { writeAnyFile } from '../src/power-tools-v0.3.mjs';

const proposal = (tool, args) => ({ action: 'call', tool, argumentsJson: JSON.stringify(args), summary: 'Perform one approved project step' });
const definitions = {
  write_text: { name: 'write_text', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } },
  read_text: { name: 'read_text', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  list_directory: { name: 'list_directory', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false } }
};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(25);
  }
  assert.fail('Timed out waiting for bounded integration result');
}
function makeFixture({ root, planner, scheduler = false, runner = {}, afterDispatch } = {}) {
  root ??= fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-engine-integration-')));
  const config = {
    allowedRoots: [root], maxWriteBytes: 524288, maxReadBytes: 524288, auditLog: path.join(root, 'audit.jsonl'),
    durableWorkflows: {
      enabled: true, directory: path.join(root, 'state'), executionTools: Object.keys(definitions),
      scheduler: { enabled: scheduler, intervalMs: 1000, oneWriterPerRoot: true },
      runner: { enabled: true, allowedTools: Object.keys(definitions), maxActions: 10, maxDurationMs: 30000, ...runner }
    }
  };
  let calls = 0, plans = 0;
  const api = createWorkflowTools({
    config, roots: [root], device: 'integration-fixture', configSha256: '7'.repeat(64),
    lookup: name => definitions[name], validateSchema: validateJsonSchema,
    planner: { plan: async (...args) => { plans++; return planner(...args); }, describe: () => ({ kind: 'integration-fixture' }) },
    dispatch: async (name, args, workflow) => {
      calls++;
      // The same project-root restriction as the real server dispatch adapter.
      const ctx = { roots: [workflow.root], auditLog: config.auditLog, config: { ...config, allowedRoots: [workflow.root], powerMode: { fullFilesystem: false } } };
      const result = name === 'write_text' ? await writeText(ctx, args)
        : name === 'read_text' ? await readText(ctx, args) : await listDirectory(ctx, args);
      if (afterDispatch) await afterDispatch(name, args, result);
      return result;
    }
  });
  return {
    root, api, get calls() { return calls; }, get plans() { return plans; },
    create: (id = 'project', steps = [{ id: 'write', title: 'Produce result evidence' }]) => api.execute('workflow_create', { id, root, goal: 'Produce the approved project artifact', acceptance: ['Artifact contains verified output'], steps }),
    async start({ id = 'project', runId = 'run-one', checks, ...rest } = {}) {
      const state = (await api.execute('workflow_get', { id })).state;
      return api.execute('workflow_run_start', { id, runId, expectedRevision: state.revision, checks: checks ?? [{ criterion: 0, type: 'text_includes', path: 'result.txt', text: 'verified output' }], ...rest });
    },
    tick: () => api.execute('workflow_run_tick', { runId: 'run-one' }),
    state: async (id = 'project') => (await api.execute('workflow_get', { id })).state,
    status: () => api.execute('workflow_run_status', { runId: 'run-one' }),
    async dispose() { await api.close(); fs.rmSync(root, { recursive: true, force: true }); }
  };
}

async function claimWorker(root) {
  const release = deferred();
  process.on('message', message => { if (message?.kind === 'release') release.resolve(); });
  const fixture = makeFixture({ root, planner: async () => {
    process.send({ kind: 'planning' });
    await release.promise;
    return proposal('write_text', { path: 'result.txt', content: 'verified output' });
  } });
  try { process.send({ kind: 'result', result: await fixture.tick() }); }
  catch (error) { process.send({ kind: 'error', message: String(error.message) }); process.exitCode = 1; }
  finally { await fixture.api.close(); process.disconnect(); }
}

if (process.argv[2] === '--claim-worker') {
  await claimWorker(process.argv[3]);
} else {
  test('automatic scheduler never plans an unenrolled workflow and completes only after explicit enrollment', { timeout: 9000 }, async () => {
    const fixture = makeFixture({ scheduler: true, runner: { autoTick: true }, planner: async () => proposal('write_text', { path: 'result.txt', content: 'verified output' }) });
    try {
      await fixture.create();
      await sleep(1200); // An actual timer cycle, not just the manual scheduler API.
      assert.equal(fixture.plans, 0);
      assert.equal(fixture.calls, 0);
      assert.equal(fs.existsSync(path.join(fixture.root, 'result.txt')), false);
      assert.deepEqual((await fixture.api.execute('workflow_run_status', {})).runs, []);
      await fixture.start();
      const final = await until(async () => { const current = await fixture.status(); return current.status === 'COMPLETED' ? current : null; });
      assert.equal(final.actions, 1);
      assert.equal(fixture.plans, 1);
      assert.equal(fixture.calls, 1);
      assert.equal((await fixture.state()).lifecycleState, 'COMPLETED');
    } finally { await fixture.dispose(); }
  });

  test('deadline aborts an abort-aware planner before any filesystem effect', { timeout: 6000 }, async () => {
    let aborted = false;
    const fixture = makeFixture({ planner: async (_, { signal }) => new Promise((resolve, reject) => {
      const stop = () => { aborted = true; reject(Object.assign(new Error('Planner interrupted'), { code: 'PLANNER_ABORTED' })); };
      if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
    }) });
    try {
      await fixture.create(); await fixture.start({ durationMs: 1000 });
      const result = await fixture.tick();
      assert.equal(aborted, true);
      assert.equal(result.status, 'EXHAUSTED');
      assert.equal(result.lastCode, 'PROJECT_DEADLINE_EXHAUSTED');
      assert.equal(result.attempts, 1);
      assert.equal(fixture.calls, 0);
      assert.equal(fs.existsSync(path.join(fixture.root, 'result.txt')), false);
      assert.equal((await fixture.tick()).skipped, true);
      assert.equal(fixture.plans, 1);
    } finally { await fixture.dispose(); }
  });

  test('cancel during an effect preserves its root lease and cancellation after the receipt', { timeout: 6000 }, async () => {
    const entered = deferred(), release = deferred();
    const fixture = makeFixture({ planner: async () => proposal('write_text', { path: 'result.txt', content: 'verified output' }), afterDispatch: async () => { entered.resolve(); await release.promise; } });
    let pending;
    try {
      await fixture.create(); await fixture.create('other'); await fixture.start();
      pending = fixture.tick(); await entered.promise;
      const running = await fixture.state();
      await fixture.api.execute('workflow_control', { id: 'project', expectedRevision: running.revision, action: 'cancel', reason: 'User cancelled during the pending effect receipt' });
      const other = await fixture.state('other');
      await assert.rejects(fixture.api.execute('workflow_call', { id: 'other', expectedRevision: other.revision, stepId: 'write', tool: 'write_text', arguments: { path: 'other.txt', content: 'must not write' } }), /WORKFLOW_ROOT_LEASED/u);
      assert.equal(fixture.calls, 1);
      assert.equal(fs.existsSync(path.join(fixture.root, 'other.txt')), false);
      release.resolve();
      const result = await pending;
      assert.equal(result.status, 'CANCELLED');
      assert.equal(result.lastCode, 'PROJECT_CANCELLED');
      const cancelled = await fixture.state();
      assert.equal(cancelled.control.intent, 'CANCELLED');
      assert.equal(cancelled.lifecycleState, 'CANCELLED');
      assert.equal(cancelled.steps[0].status, 'recorded');
      const operations = (await fixture.api.execute('workflow_operations', { id: 'project' })).operations;
      assert.equal(operations.length, 1);
      assert.equal(operations[0].status, 'EXECUTED');
      assert.equal((await fixture.tick()).skipped, true);
    } finally { release.resolve(); await pending; await fixture.dispose(); }
  });

  test('nested evidence paths finalize with platform separators and independently verified hashes', async () => {
    const nested = path.join('reports', 'nested', 'result.txt');
    const fixture = makeFixture({ planner: async () => proposal('write_text', { path: nested, content: 'verified output' }) });
    try {
      fs.mkdirSync(path.join(fixture.root, 'reports', 'nested'), { recursive: true });
      await fixture.create();
      await fixture.start({ checks: [{ criterion: 0, type: 'text_includes', path: nested, text: 'verified output' }] });
      assert.equal((await fixture.tick()).status, 'QUEUED');
      const final = await fixture.tick();
      assert.equal(final.status, 'COMPLETED');
      assert.equal(final.verification[0].path, 'reports/nested/result.txt');
      assert.match(final.verification[0].sha256, /^[a-f0-9]{64}$/u);
      const state = await fixture.state();
      assert.equal(state.lifecycleState, 'COMPLETED');
      assert.equal(state.finalization.acceptanceResults[0], true);
    } finally { await fixture.dispose(); }
  });

  test('an absolute target outside the project is refused by real scoped host dispatch', async () => {
    const external = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-engine-external-')));
    const target = path.join(external, 'protected.txt');
    fs.writeFileSync(target, 'untouched');
    const fixture = makeFixture({ planner: async () => proposal('write_text', { path: target, content: 'verified output' }) });
    try {
      await fixture.create(); await fixture.start();
      const result = await fixture.tick();
      assert.equal(result.status, 'BLOCKED');
      assert.equal(fs.readFileSync(target, 'utf8'), 'untouched');
      assert.notEqual((await fixture.state()).lifecycleState, 'COMPLETED');
      await fixture.tick(); assert.equal(fixture.plans, 1);
    } finally { await fixture.dispose(); fs.rmSync(external, { recursive: true, force: true }); }
  });

  test('an external directory junction cannot redirect a planned write outside the project', async () => {
    const external = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-engine-alias-')));
    const target = path.join(external, 'protected.txt');
    fs.writeFileSync(target, 'untouched');
    const fixture = makeFixture({ planner: async () => proposal('write_text', { path: path.join('alias', 'protected.txt'), content: 'verified output' }) });
    try {
      fs.symlinkSync(external, path.join(fixture.root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
      await fixture.create(); await fixture.start();
      const result = await fixture.tick();
      assert.equal(result.status, 'BLOCKED');
      assert.equal(fs.readFileSync(target, 'utf8'), 'untouched');
      assert.notEqual((await fixture.state()).lifecycleState, 'COMPLETED');
    } finally { await fixture.dispose(); fs.rmSync(external, { recursive: true, force: true }); }
  });

  test('an external hardlink alias is refused before a planned write mutates its target', async () => {
    const external = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-engine-hardlink-')));
    const target = path.join(external, 'protected.txt');
    fs.writeFileSync(target, 'untouched');
    const fixture = makeFixture({ planner: async () => proposal('write_text', { path: 'result.txt', content: 'verified output' }) });
    try {
      fs.linkSync(target, path.join(fixture.root, 'result.txt'));
      await fixture.create(); await fixture.start();
      const result = await fixture.tick();
      assert.equal(fs.readFileSync(target, 'utf8'), 'untouched', 'The outside file must not be changed through its in-project hardlink');
      assert.equal(result.status, 'BLOCKED');
    } finally { await fixture.dispose(); fs.rmSync(external, { recursive: true, force: true }); }
  });

  for (const [name, write, fullFilesystem] of [
    ['standard write_text', writeText, false], ['full write_text', writeText, true], ['write_file', writeAnyFile, true]
  ]) for (const mode of ['overwrite', 'append']) {
    test(`${name} ${mode} refuses hardlinks before creating backups or audit receipts`, async () => {
      const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-write-guard-')));
      const external = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-write-guard-external-')));
      const protectedFile = path.join(external, 'protected.txt');
      const backupRoot = path.join(root, 'power-backups');
      const auditLog = path.join(root, 'audit.jsonl');
      const ctx = { roots: [root], auditLog, config: { maxWriteBytes: 524288, powerMode: { enabled: true, fullFilesystem, backupRoot, maxFileBytes: 524288 } } };
      try {
        fs.writeFileSync(protectedFile, 'untouched');
        fs.linkSync(protectedFile, path.join(root, 'alias.txt'));
        await assert.rejects(write(ctx, { path: 'alias.txt', content: 'must not appear', mode }), /FILE_WRITE_HARDLINK/u);
        assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'untouched');
        assert.equal(fs.existsSync(backupRoot), false);
        assert.equal(fs.existsSync(path.join(root, '.remote-commander-backups')), false);
        assert.equal(fs.existsSync(auditLog), false);
      } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(external, { recursive: true, force: true }); }
    });
  }

  test('separate Node processes cannot claim the same project run concurrently', { timeout: 12000 }, async () => {
    const fixture = makeFixture({ planner: async () => { throw new Error('Competing parent must not plan'); } });
    const entered = deferred(), completed = deferred();
    // Attach rejection handlers immediately; a worker startup failure must not
    // leave another concurrently waiting promise as an unhandled rejection.
    entered.promise.catch(() => {}); completed.promise.catch(() => {});
    let child, exited, workerTimer;
    try {
      await fixture.create(); await fixture.start();
      child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--claim-worker', fixture.root], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
      workerTimer = setTimeout(() => child.kill(), 8000);
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.on('message', message => {
        if (message?.kind === 'planning') entered.resolve();
        if (message?.kind === 'result') completed.resolve(message.result);
        if (message?.kind === 'error') { const error = new Error(message.message); entered.reject(error); completed.reject(error); }
      });
      exited = new Promise((resolve, reject) => {
        child.once('error', error => { entered.reject(error); completed.reject(error); reject(error); });
        child.once('close', code => {
          clearTimeout(workerTimer);
          if (code !== 0) { const error = new Error(`Claim worker exited ${code}: ${stderr}`); entered.reject(error); completed.reject(error); reject(error); }
          else resolve();
        });
      });
      exited.catch(() => {});
      await entered.promise;
      const competing = await fixture.tick();
      assert.equal(competing.skipped, true);
      assert.equal(fixture.plans, 0);
      assert.equal(fixture.calls, 0);
      child.send({ kind: 'release' });
      const receipt = await completed.promise;
      await exited;
      assert.equal(receipt.status, 'QUEUED');
      assert.equal(receipt.actions, 1);
      assert.equal(fs.readFileSync(path.join(fixture.root, 'result.txt'), 'utf8'), 'verified output');
      assert.equal((await fixture.tick()).status, 'COMPLETED');
      assert.equal((await fixture.api.execute('workflow_operations', { id: 'project' })).operations.length, 1);
    } finally {
      clearTimeout(workerTimer);
      if (child && child.exitCode === null) child.kill();
      await exited?.catch(() => {});
      await fixture.dispose();
    }
  });
}
