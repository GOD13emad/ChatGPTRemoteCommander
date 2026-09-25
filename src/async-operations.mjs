import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { expandPathValue } from './platform.mjs';

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'UNCERTAIN']);
const REQUEST_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OP_RE = /^[a-f0-9-]{36}$/;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
async function atomicJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  let lastError;
  for (let attempt = 0; attempt <= 20; attempt += 1) {
    try {
      await rename(temp, target);
      return;
    } catch (error) {
      lastError = error;
      const transient = process.platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(error?.code);
      if (!transient || attempt === 20) break;
      await new Promise((resolve) => setTimeout(resolve, 25 + attempt * 10));
    }
  }
  throw lastError;
}
async function readJson(target) {
  return JSON.parse(await readFile(target, 'utf8'));
}
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function tailText(target, maxBytes) {
  if (!maxBytes) return '';
  try {
    const info = await stat(target);
    const start = Math.max(0, info.size - maxBytes);
    const handle = await open(target, 'r');
    try {
      const buffer = Buffer.alloc(info.size - start);
      await handle.read(buffer, 0, buffer.length, start);
      return buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}
function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(Math.trunc(parsed), max)) : fallback;
}
function profileKey(config) {
  const raw = String(config.instance?.profile ?? 'default');
  return raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'default';
}

export const asyncOperationDefinitions = [
  {
    name: 'operation_start',
    description: 'Start a validated long-running command in a detached durable worker and return immediately. Reuse the same requestId on retry; identical retries return the same operationId and never start a duplicate effect.',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' },
        tool: { type: 'string', enum: ['run_project_command', 'run_shell'] },
        arguments: { type: 'object' }
      },
      required: ['requestId', 'tool', 'arguments'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
  },
  {
    name: 'operation_status',
    description: 'Read compact durable status for a detached operation without returning command output.',
    inputSchema: {
      type: 'object',
      properties: { operationId: { type: 'string', pattern: '^[a-f0-9-]{36}$' } },
      required: ['operationId'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'operation_result',
    description: 'Read the compact result and bounded stdout/stderr tails for a detached operation. Captured output is file-backed, bounded by policy, and may be truncated; total byte counts and full-stream SHA-256 digests remain available.',
    inputSchema: {
      type: 'object',
      properties: {
        operationId: { type: 'string', pattern: '^[a-f0-9-]{36}$' },
        tailBytes: { type: 'integer', minimum: 0, maximum: 32768 }
      },
      required: ['operationId'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'operation_cancel',
    description: 'Request cancellation of a Commander-owned detached operation. Repeated cancellation is idempotent.',
    inputSchema: {
      type: 'object',
      properties: { operationId: { type: 'string', pattern: '^[a-f0-9-]{36}$' } },
      required: ['operationId'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  }
];

export function createAsyncOperationTools({ config, prepare, workerPath }) {
  const policy = config.asyncOperations ?? {};
  const enabled = policy.enabled !== false;
  const root = policy.stateDir
    ? path.resolve(expandPathValue(policy.stateDir))
    : path.join(os.homedir(), '.chatgpt-remote-commander', 'operations', profileKey(config));
  const maxOutputBytes = boundedInt(policy.maxOutputBytes, 16 * 1024 * 1024, 64 * 1024, 64 * 1024 * 1024);
  const resolvedWorker = workerPath ?? fileURLToPath(new URL('../tools/operation-worker.mjs', import.meta.url));
  const operationsDir = path.join(root, 'operations');
  const requestsDir = path.join(root, 'requests');

  function opPaths(operationId) {
    if (!OP_RE.test(operationId)) throw new Error('invalid operationId');
    const dir = path.join(operationsDir, operationId);
    return {
      dir,
      state: path.join(dir, 'state.json'),
      result: path.join(dir, 'result.json'),
      stdout: path.join(dir, 'stdout.log'),
      stderr: path.join(dir, 'stderr.log'),
      cancel: path.join(dir, 'cancel.request')
    };
  }
  async function status(operationId, reconcile = true) {
    const p = opPaths(operationId);
    let state;
    try { state = await readJson(p.state); }
    catch (error) {
      if (error?.code === 'ENOENT') throw new Error('operation not found');
      throw error;
    }

    const exactReceipt = async (candidate) => {
      let receipt = null;
      try { receipt = await readJson(p.result); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      return receipt
        && receipt.operationId === candidate.operationId
        && receipt.inputHash === candidate.inputHash
        && TERMINAL.has(receipt.status)
        && receipt.status !== 'UNCERTAIN'
        ? receipt : null;
    };
    const adoptReceipt = async (candidate, receipt) => {
      const recovered = {
        ...candidate,
        status: receipt.status,
        updatedAt: receipt.finishedAt ?? new Date().toISOString(),
        finishedAt: receipt.finishedAt ?? null,
        exitCode: receipt.exitCode ?? null,
        signal: receipt.signal ?? null,
        timedOut: receipt.timedOut === true,
        cancelRequested: receipt.cancelRequested === true,
        recoveredFromReceipt: true
      };
      try { await atomicJson(p.state, recovered); } catch { recovered.stateRepairPending = true; }
      return recovered;
    };

    if (reconcile) {
      const receipt = await exactReceipt(state);
      if (receipt) return adoptReceipt(state, receipt);
    }
    if (TERMINAL.has(state.status)) return state;

    if (reconcile) {
      const deadlineExpired = typeof state.deadlineAt === 'string'
        && Number.isFinite(Date.parse(state.deadlineAt))
        && Date.now() > Date.parse(state.deadlineAt) + 5000;
      const workerMissing = state.workerPid && !alive(state.workerPid);
      if (deadlineExpired || workerMissing) {
        const latest = await readJson(p.state);
        const receipt = await exactReceipt(latest);
        if (receipt) return adoptReceipt(latest, receipt);
        if (TERMINAL.has(latest.status)) return latest;
        // PID liveness is only a hint. Without a durable receipt, do not invent
        // failure before the operation deadline and never replay the effect.
        if (!deadlineExpired) return latest;
        state = {
          ...latest,
          status: 'UNCERTAIN',
          updatedAt: new Date().toISOString(),
          failureCode: 'DEADLINE_EXCEEDED_WITHOUT_FINAL_RECEIPT'
        };
        await atomicJson(p.state, state);
      }
    }
    return state;
  }
  async function start(input) {
    if (!enabled) throw new Error('async operations are disabled');
    if (!REQUEST_RE.test(input.requestId)) throw new Error('invalid requestId');
    const inputHash = hashJson({ tool: input.tool, arguments: input.arguments });
    const prepared = await prepare(input.tool, input.arguments);
    if (!prepared || typeof prepared.file !== 'string' || !Array.isArray(prepared.args) || typeof prepared.cwd !== 'string') {
      throw new Error('invalid async execution plan');
    }
    await mkdir(requestsDir, { recursive: true, mode: 0o700 });
    await mkdir(operationsDir, { recursive: true, mode: 0o700 });
    const requestPath = path.join(requestsDir, `${hashJson(input.requestId)}.json`);
    const operationId = randomUUID();
    let claimed = false;
    try {
      const handle = await open(requestPath, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({ requestId: input.requestId, operationId, inputHash, createdAt: new Date().toISOString() }) + '\n');
      } finally {
        await handle.close();
      }
      claimed = true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    if (!claimed) {
      const prior = await readJson(requestPath);
      if (prior.requestId !== input.requestId || prior.inputHash !== inputHash) {
        throw new Error('REQUEST_ID_CONFLICT');
      }
      let priorState;
      try { priorState = await status(prior.operationId); }
      catch (error) {
        if (error.message !== 'operation not found') throw error;
        priorState = { operationId: prior.operationId, status: 'UNCERTAIN', failureCode: 'RESERVED_WITHOUT_STATE' };
      }
      return { operationId: prior.operationId, requestId: input.requestId, duplicate: true, status: priorState.status };
    }

    const p = opPaths(operationId);
    await mkdir(p.dir, { recursive: true, mode: 0o700 });
    const operationTimeoutMs = boundedInt(prepared.timeoutMs, 300000, 1000, 24 * 60 * 60 * 1000);
    const outputLimit = Math.min(boundedInt(prepared.outputLimit, maxOutputBytes, 4096, maxOutputBytes), maxOutputBytes);
    const now = new Date().toISOString();
    const baseState = {
      schema: 1,
      operationId,
      requestId: input.requestId,
      inputHash,
      tool: input.tool,
      status: 'QUEUED',
      createdAt: now,
      updatedAt: now,
      timeoutMs: operationTimeoutMs,
      deadlineAt: new Date(Date.now() + operationTimeoutMs).toISOString(),
      workerPid: null,
      childPid: null
    };
    await atomicJson(p.state, baseState);
    const execution = {
      operationId,
      requestId: input.requestId,
      inputHash,
      tool: input.tool,
      file: prepared.file,
      args: prepared.args,
      cwd: prepared.cwd,
      timeoutMs: operationTimeoutMs,
      outputLimit,
      statePath: p.state,
      resultPath: p.result,
      stdoutPath: p.stdout,
      stderrPath: p.stderr,
      cancelPath: p.cancel
    };
    try {
      const worker = spawn(process.execPath, [resolvedWorker], {
        detached: true,
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'ignore']
      });
      const queued = { ...baseState, workerPid: worker.pid, updatedAt: new Date().toISOString() };
      await atomicJson(p.state, queued);
      worker.stdin.end(JSON.stringify(execution));
      worker.unref();
      return { operationId, requestId: input.requestId, duplicate: false, status: 'QUEUED' };
    } catch (error) {
      await atomicJson(p.state, {
        ...baseState,
        status: 'FAILED',
        updatedAt: new Date().toISOString(),
        failureCode: 'WORKER_START_FAILED'
      });
      throw error;
    }
  }
  async function result(input) {
    const state = await status(input.operationId);
    const p = opPaths(input.operationId);
    let receipt = null;
    try { receipt = await readJson(p.result); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const tailBytes = boundedInt(input.tailBytes, 8192, 0, 32768);
    return {
      state,
      result: receipt,
      stdoutTail: await tailText(p.stdout, tailBytes),
      stderrTail: await tailText(p.stderr, tailBytes)
    };
  }
  async function cancel(input) {
    const state = await status(input.operationId);
    if (TERMINAL.has(state.status)) return { operationId: input.operationId, status: state.status, alreadyTerminal: true };
    const p = opPaths(input.operationId);
    await writeFile(p.cancel, new Date().toISOString() + '\n', { encoding: 'utf8', mode: 0o600 });
    return { operationId: input.operationId, status: state.status, cancelRequested: true };
  }

  return {
    definitions: asyncOperationDefinitions,
    status: () => ({
      enabled,
      backgroundFirst: policy.backgroundFirst !== false,
      durable: true,
      requestIdempotency: true,
      rawArgumentsStored: false,
      maxOutputBytes,
      stateRoot: root
    }),
    execute: async (name, input) => {
      if (name === 'operation_start') return start(input);
      if (name === 'operation_status') return status(input.operationId);
      if (name === 'operation_result') return result(input);
      if (name === 'operation_cancel') return cancel(input);
      throw new Error('unknown async operation tool');
    }
  };
}
