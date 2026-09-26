import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createAsyncOperationTools } from '../src/async-operations.mjs';
import { DeliveryStore } from '../src/delivery-store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'async-operation-fixture.mjs');
const worker = path.join(here, '..', 'tools', 'operation-worker.mjs');

async function waitFor(manager, operationId, terminal = ['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'UNCERTAIN']) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const state = await manager.execute('operation_status', { operationId });
    if (terminal.includes(state.status)) return state;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('operation did not finish');
}

async function withManager(fn, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rc-async-'));
  const manager = createAsyncOperationTools({
    config: {
      instance: { profile: 'test' },
      asyncOperations: { enabled: true, stateDir: path.join(root, 'state'), maxOutputBytes: 65536, ...overrides }
    },
    workerPath: worker,
    prepare: async (_tool, args) => ({
      file: process.execPath,
      args: [fixture, ...args.argv],
      cwd: root,
      timeoutMs: args.timeoutMs ?? 5000,
      outputLimit: args.outputLimit ?? 65536
    })
  });
  try { await fn({ manager, root }); } finally { await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); }
}

test('lost acknowledgement retry reuses one operation and one external effect', async () => {
  await withManager(async ({ manager, root }) => {
    const effect = path.join(root, 'effect.txt');
    const input = { requestId: 'retry-1', tool: 'run_project_command', arguments: { argv: ['effect', effect, '250'] } };
    const first = await manager.execute('operation_start', input);
    const retry = await manager.execute('operation_start', input);
    assert.equal(retry.operationId, first.operationId);
    assert.equal(retry.duplicate, true);
    await waitFor(manager, first.operationId);
    assert.equal(await readFile(effect, 'utf8'), 'x');
  });
});

test('same requestId with changed inputs fails closed', async () => {
  await withManager(async ({ manager }) => {
    await manager.execute('operation_start', { requestId: 'same-id', tool: 'run_project_command', arguments: { argv: ['sleep', '30', 'a'] } });
    await assert.rejects(
      manager.execute('operation_start', { requestId: 'same-id', tool: 'run_project_command', arguments: { argv: ['sleep', '30', 'b'] } }),
      /REQUEST_ID_CONFLICT/
    );
  });
});

test('large output is file-backed and inline result stays bounded', async () => {
  await withManager(async ({ manager }) => {
    const started = await manager.execute('operation_start', {
      requestId: 'large-1',
      tool: 'run_project_command',
      arguments: { argv: ['large', '200000'], outputLimit: 65536 }
    });
    await waitFor(manager, started.operationId);
    const result = await manager.execute('operation_result', { operationId: started.operationId, tailBytes: 1024 });
    assert.equal(result.state.status, 'SUCCEEDED');
    assert.equal(result.result.stdout.capturedBytes, 65536);
    assert.equal(result.result.stdout.totalBytes, 200000);
    assert.equal(result.result.stdout.sha256, createHash('sha256').update('x'.repeat(200000)).digest('hex'));
    assert.equal(result.result.stdout.truncated, true);
    assert.equal(Buffer.byteLength(result.stdoutTail), 1024);
    assert.ok(JSON.stringify(result).length < 10000);
  });
});

test('child exit completes operation even when inherited stdio delays close', async () => {
  await withManager(async ({ manager }) => {
    const started = await manager.execute('operation_start', {
      requestId: 'linger-stdio-1',
      tool: 'run_project_command',
      arguments: { argv: ['linger-stdio', 'parent-done'], timeoutMs: 8000 }
    });
    const state = await waitFor(manager, started.operationId);
    assert.equal(state.status, 'SUCCEEDED');
    const result = await manager.execute('operation_result', { operationId: started.operationId, tailBytes: 1024 });
    assert.equal(result.result.outputComplete, false);
    assert.equal(result.stdoutTail, 'parent-done');
  });
});

test('a new manager instance can recover status and result while detached work continues', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rc-async-restart-'));
  const config = { instance: { profile: 'test' }, asyncOperations: { enabled: true, stateDir: path.join(root, 'state'), maxOutputBytes: 65536 } };
  const prepare = async (_tool, args) => ({ file: process.execPath, args: [fixture, ...args.argv], cwd: root, timeoutMs: 5000, outputLimit: 65536 });
  try {
    const firstManager = createAsyncOperationTools({ config, prepare, workerPath: worker });
    const started = await firstManager.execute('operation_start', {
      requestId: 'restart-1',
      tool: 'run_project_command',
      arguments: { argv: ['sleep', '250', 'recovered'] }
    });
    const secondManager = createAsyncOperationTools({ config, prepare, workerPath: worker });
    await waitFor(secondManager, started.operationId);
    const result = await secondManager.execute('operation_result', { operationId: started.operationId, tailBytes: 1024 });
    assert.equal(result.state.status, 'SUCCEEDED');
    assert.equal(result.stdoutTail, 'recovered');
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
});

test('cancel request is durable and stops Commander-owned work', async () => {
  await withManager(async ({ manager }) => {
    const started = await manager.execute('operation_start', {
      requestId: 'cancel-1',
      tool: 'run_project_command',
      arguments: { argv: ['sleep', '5000', 'late'], timeoutMs: 8000 }
    });
    await manager.execute('operation_cancel', { operationId: started.operationId });
    const state = await waitFor(manager, started.operationId);
    assert.equal(state.status, 'CANCELLED');
  });
});


test('validation failure happens before request reservation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rc-async-validate-'));
  const stateDir = path.join(root, 'state');
  const manager = createAsyncOperationTools({
    config: { instance: { profile: 'test' }, asyncOperations: { enabled: true, stateDir } },
    workerPath: worker,
    prepare: async () => { throw new Error('validation rejected'); }
  });
  try {
    await assert.rejects(
      manager.execute('operation_start', {
        requestId: 'invalid-before-reserve',
        tool: 'run_project_command',
        arguments: { bad: true }
      }),
      /validation rejected/
    );
    const requests = await readdir(path.join(stateDir, 'requests')).catch((error) => {
      if (error?.code === 'ENOENT') return [];
      throw error;
    });
    assert.deepEqual(requests, []);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
});


test('dead-worker reconciliation adopts an exact final receipt instead of overwriting it UNCERTAIN', async () => {
  await withManager(async ({ manager, root }) => {
    const started = await manager.execute('operation_start', {
      requestId: 'receipt-race-1',
      tool: 'run_project_command',
      arguments: { argv: ['sleep', '40', 'receipt-wins'] }
    });
    const final = await waitFor(manager, started.operationId);
    assert.equal(final.status, 'SUCCEEDED');

    const statePath = path.join(root, 'state', 'operations', started.operationId, 'state.json');
    const stale = JSON.parse(await readFile(statePath, 'utf8'));
    stale.status = 'UNCERTAIN';
    stale.workerPid = 2147483646;
    delete stale.finishedAt;
    delete stale.exitCode;
    stale.failureCode = 'WORKER_EXCEPTION';
    await writeFile(statePath, JSON.stringify(stale, null, 2) + '\n', 'utf8');

    const recovered = await manager.execute('operation_status', { operationId: started.operationId });
    assert.equal(recovered.status, 'SUCCEEDED');
    assert.equal(recovered.recoveredFromReceipt, true);
  });
});


test('dead PID without receipt stays nonterminal until durable deadline', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rc-async-dead-pid-'));
  const stateDir = path.join(root, 'state');
  const manager = createAsyncOperationTools({
    config: { instance: { profile: 'test' }, asyncOperations: { enabled: true, stateDir } },
    workerPath: worker,
    prepare: async () => { throw new Error('prepare must not run for status'); }
  });
  try {
    const operationId = randomUUID();
    const operationDir = path.join(stateDir, 'operations', operationId);
    await mkdir(operationDir, { recursive: true });
    const statePath = path.join(operationDir, 'state.json');
    const now = new Date().toISOString();
    const state = {
      schema: 1,
      operationId,
      requestId: 'dead-pid-before-deadline',
      inputHash: 'a'.repeat(64),
      tool: 'run_project_command',
      status: 'RUNNING',
      createdAt: now,
      updatedAt: now,
      timeoutMs: 5000,
      deadlineAt: new Date(Date.now() + 5000).toISOString(),
      workerPid: 2147483646,
      childPid: null
    };
    await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');

    const beforeDeadline = await manager.execute('operation_status', { operationId });
    assert.equal(beforeDeadline.status, 'RUNNING');

    state.deadlineAt = new Date(Date.now() - 6000).toISOString();
    await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
    const afterDeadline = await manager.execute('operation_status', { operationId });
    assert.equal(afterDeadline.status, 'UNCERTAIN');
    assert.equal(afterDeadline.failureCode, 'DEADLINE_EXCEEDED_WITHOUT_FINAL_RECEIPT');
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
});


test('terminal operation receipts backfill exactly once into durable delivery after restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-async-delivery-'));
  try {
    const config = {
      instance: { profile: 'delivery-test' },
      asyncOperations: { enabled: true, stateDir: path.join(root, 'ops'), maxOutputBytes: 1024 * 1024 }
    };
    const prepare = async () => ({
      file: process.execPath,
      args: ['-e', 'process.stdout.write("done")'],
      cwd: root,
      timeoutMs: 5000,
      outputLimit: 1024 * 1024
    });
    const first = createAsyncOperationTools({ config, prepare });
    const started = await first.execute('operation_start', {
      requestId: 'delivery-request-1',
      correlationId: 'chat-a',
      tool: 'run_project_command',
      arguments: { argv: ['done'] }
    });
    await waitForTerminal(first, started.operationId);
    first.close?.();

    const delivery = new DeliveryStore({ directory: path.join(root, 'delivery'), scope: 'profile-a' });
    const second = createAsyncOperationTools({ config, prepare, deliveryStore: delivery });
    await second.reconcileDeliveries(500);
    const listed = delivery.list({ correlationId: 'chat-a', includeDelivered: true });
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0].source, 'operation');
    assert.equal(listed.items[0].sourceId, started.operationId);
    assert.equal(listed.items[0].kind, 'COMPLETED');
    await second.reconcileDeliveries(500);
    assert.equal(delivery.list({ correlationId: 'chat-a', includeDelivered: true }).items.length, 1);
    second.close?.();
    delivery.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('same async requestId with a changed correlation fails closed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-async-correlation-'));
  try {
    const config = { asyncOperations: { enabled: true, stateDir: path.join(root, 'ops') } };
    const prepare = async () => ({
      file: process.execPath, args: ['-e', 'setTimeout(()=>{},50)'], cwd: root,
      timeoutMs: 1000, outputLimit: 65536
    });
    const manager = createAsyncOperationTools({ config, prepare });
    const input = { requestId: 'same-correlation-request', correlationId: 'chat-a', tool: 'run_project_command', arguments: {} };
    await manager.execute('operation_start', input);
    await assert.rejects(
      manager.execute('operation_start', { ...input, correlationId: 'chat-b' }),
      /REQUEST_ID_CONFLICT/
    );
    manager.close?.();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
