import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalizeRoots } from '../src/security-v0.3.mjs';
import { expandPathValue } from '../src/platform.mjs';
import { executePowerTool } from '../src/power-tools-v0.3.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

let currentChild = null;
let currentSpec = null;
let cancelRequested = false;
let timedOut = false;

async function atomicJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.${process.pid}.tmp`;
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
async function readInput() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('operation spec too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function killTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
    } else {
      try { process.kill(-pid, 'SIGTERM'); } catch { process.kill(pid, 'SIGTERM'); }
    }
  } catch {}
}
function collector(limit) {
  const chunks = [];
  let captured = 0;
  let total = 0;
  let finished = false;
  const hash = createHash('sha256');
  return {
    push(chunk) {
      if (finished) return;
      const data = Buffer.from(chunk);
      total += data.length;
      hash.update(data);
      if (captured >= limit) return;
      const slice = data.subarray(0, Math.min(data.length, limit - captured));
      chunks.push(slice);
      captured += slice.length;
    },
    finish() {
      finished = true;
      return { buffer: Buffer.concat(chunks), captured, total, sha256: hash.digest('hex'), truncated: total > captured };
    }
  };
}

function waitForChildOutcome(child, drainMs = 2000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let exited = null;
    let drainTimer = null;
    const cleanup = () => {
      child.off('error', onError);
      child.off('exit', onExit);
      child.off('close', onClose);
      if (drainTimer) clearTimeout(drainTimer);
    };
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(outcome);
    };
    const onError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onExit = (code, signal) => {
      exited = { code, signal };
      drainTimer = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish({ ...exited, stdioComplete: false });
      }, drainMs);
    };
    const onClose = (code, signal) => {
      finish({ code: exited?.code ?? code, signal: exited?.signal ?? signal, stdioComplete: true });
    };
    child.once('error', onError);
    child.once('exit', onExit);
    child.once('close', onClose);
  });
}

async function runPowerToolOperation(spec, prior) {
  const startedAt = new Date().toISOString();
  await atomicJson(spec.statePath, {
    ...prior,
    status: 'RUNNING',
    workerPid: process.pid,
    childPid: null,
    startedAt,
    updatedAt: startedAt
  });
  if (existsSync(spec.cancelPath)) {
    const finishedAt = new Date().toISOString();
    const emptyHash = createHash('sha256').update('').digest('hex');
    const receipt = {
      schema: 1, operationId: spec.operationId, tool: spec.tool, inputHash: spec.inputHash,
      status: 'CANCELLED', exitCode: null, signal: null, timedOut: false, cancelRequested: true,
      outputComplete: true, toolResult: null,
      stdout: { capturedBytes: 0, totalBytes: 0, sha256: emptyHash, truncated: false, path: spec.stdoutPath },
      stderr: { capturedBytes: 0, totalBytes: 0, sha256: emptyHash, truncated: false, path: spec.stderrPath },
      startedAt, finishedAt
    };
    await writeFile(spec.stdoutPath, Buffer.alloc(0), { mode: 0o600 });
    await writeFile(spec.stderrPath, Buffer.alloc(0), { mode: 0o600 });
    await atomicJson(spec.resultPath, receipt);
    await atomicJson(spec.statePath, { ...prior, status: 'CANCELLED', workerPid: process.pid, childPid: null,
      startedAt, finishedAt, updatedAt: finishedAt, exitCode: null, signal: null, timedOut: false, cancelRequested: true });
    return;
  }
  const configRaw = await readFile(spec.configPath, 'utf8');
  if (createHash('sha256').update(configRaw).digest('hex') !== spec.configSha256) throw new Error('OPERATION_CONFIG_CHANGED');
  const config = JSON.parse(configRaw);
  if (!Array.isArray(config.allowedRoots)) throw new Error('OPERATION_CONFIG_INVALID_ROOTS');
  config.allowedRoots = config.allowedRoots.map(expandPathValue);
  const roots = await canonicalizeRoots(config.allowedRoots);
  const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const ctx = {
    config,
    roots,
    auditLog: path.resolve(projectDir, config.auditLog || 'var/audit.jsonl')
  };
  const toolResult = await executePowerTool(ctx, spec.tool, spec.toolArguments);
  const encoded = JSON.stringify(toolResult);
  if (Buffer.byteLength(encoded) > spec.outputLimit) throw new Error('OPERATION_TOOL_RESULT_TOO_LARGE');
  const finishedAt = new Date().toISOString();
  const cancelRequestedNow = existsSync(spec.cancelPath);
  const emptyHash = createHash('sha256').update('').digest('hex');
  await writeFile(spec.stdoutPath, Buffer.alloc(0), { mode: 0o600 });
  await writeFile(spec.stderrPath, Buffer.alloc(0), { mode: 0o600 });
  const receipt = {
    schema: 1, operationId: spec.operationId, tool: spec.tool, inputHash: spec.inputHash,
    status: 'SUCCEEDED', exitCode: null, signal: null, timedOut: false, cancelRequested: cancelRequestedNow,
    outputComplete: true, toolResult,
    stdout: { capturedBytes: 0, totalBytes: 0, sha256: emptyHash, truncated: false, path: spec.stdoutPath },
    stderr: { capturedBytes: 0, totalBytes: 0, sha256: emptyHash, truncated: false, path: spec.stderrPath },
    startedAt, finishedAt
  };
  await atomicJson(spec.resultPath, receipt);
  await atomicJson(spec.statePath, {
    ...prior, status: 'SUCCEEDED', workerPid: process.pid, childPid: null,
    startedAt, finishedAt, updatedAt: finishedAt, exitCode: null, signal: null,
    timedOut: false, cancelRequested: cancelRequestedNow
  });
}

async function main() {
  const spec = await readInput();
  currentSpec = spec;
  const prior = JSON.parse(await readFile(spec.statePath, 'utf8'));
  if (spec.kind === 'power-tool') {
    await runPowerToolOperation(spec, prior);
    return;
  }
  if (spec.kind !== undefined && spec.kind !== 'process') throw new Error('OPERATION_KIND_UNSUPPORTED');
  const startedAt = new Date().toISOString();
  const stdout = collector(spec.outputLimit);
  const stderr = collector(spec.outputLimit);
  currentChild = spawn(spec.file, spec.args, {
    cwd: spec.cwd,
    windowsHide: true,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await atomicJson(spec.statePath, {
    ...prior,
    status: 'RUNNING',
    workerPid: process.pid,
    childPid: currentChild.pid,
    startedAt,
    updatedAt: startedAt
  });
  currentChild.stdout.on('data', (chunk) => stdout.push(chunk));
  currentChild.stderr.on('data', (chunk) => stderr.push(chunk));

  const cancelTimer = setInterval(() => {
    if (existsSync(spec.cancelPath)) {
      cancelRequested = true;
      killTree(currentChild?.pid);
    }
  }, 250);
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    killTree(currentChild?.pid);
  }, spec.timeoutMs);

  let outcome;
  try {
    outcome = await waitForChildOutcome(currentChild);
  } finally {
    clearInterval(cancelTimer);
    clearTimeout(timeoutTimer);
  }
  const out = stdout.finish();
  const err = stderr.finish();
  await writeFile(spec.stdoutPath, out.buffer, { mode: 0o600 });
  await writeFile(spec.stderrPath, err.buffer, { mode: 0o600 });
  const finishedAt = new Date().toISOString();
  const status = cancelRequested ? 'CANCELLED'
    : timedOut ? 'TIMED_OUT'
      : outcome.code === 0 ? 'SUCCEEDED' : 'FAILED';
  const receipt = {
    schema: 1,
    operationId: spec.operationId,
    tool: spec.tool,
    inputHash: spec.inputHash,
    status,
    exitCode: outcome.code,
    signal: outcome.signal,
    timedOut,
    cancelRequested,
    outputComplete: outcome.stdioComplete !== false,
    stdout: { capturedBytes: out.captured, totalBytes: out.total, sha256: out.sha256, truncated: out.truncated, path: spec.stdoutPath },
    stderr: { capturedBytes: err.captured, totalBytes: err.total, sha256: err.sha256, truncated: err.truncated, path: spec.stderrPath },
    startedAt,
    finishedAt
  };
  await atomicJson(spec.resultPath, receipt);
  await atomicJson(spec.statePath, {
    ...prior,
    status,
    workerPid: process.pid,
    childPid: currentChild.pid,
    startedAt,
    finishedAt,
    updatedAt: finishedAt,
    exitCode: outcome.code,
    signal: outcome.signal,
    timedOut,
    cancelRequested
  });
}

main().catch(async (error) => {
  try {
    if (currentSpec?.statePath) {
      let prior = {};
      try { prior = JSON.parse(await readFile(currentSpec.statePath, 'utf8')); } catch {}
      // result.json is the durable completion receipt. If it already proves the
      // exact operation completed, a later state-file write failure must not
      // downgrade that completed effect to UNCERTAIN.
      let receipt = null;
      try { receipt = JSON.parse(await readFile(currentSpec.resultPath, 'utf8')); } catch {}
      if (receipt
        && receipt.operationId === currentSpec.operationId
        && receipt.inputHash === currentSpec.inputHash
        && ['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'].includes(receipt.status)) {
        try {
          await atomicJson(currentSpec.statePath, {
            ...prior,
            status: receipt.status,
            workerPid: process.pid,
            childPid: currentChild?.pid ?? null,
            startedAt: receipt.startedAt ?? prior.startedAt ?? null,
            finishedAt: receipt.finishedAt ?? new Date().toISOString(),
            updatedAt: receipt.finishedAt ?? new Date().toISOString(),
            exitCode: receipt.exitCode ?? null,
            signal: receipt.signal ?? null,
            timedOut: receipt.timedOut === true,
            cancelRequested: receipt.cancelRequested === true,
            recoveredFromReceipt: true
          });
        } catch {}
        return;
      }
      await atomicJson(currentSpec.statePath, {
        ...prior,
        status: 'UNCERTAIN',
        workerPid: process.pid,
        childPid: currentChild?.pid ?? null,
        updatedAt: new Date().toISOString(),
        failureCode: 'WORKER_EXCEPTION',
        error: String(error?.message ?? error).slice(0, 500)
      });
    }
  } catch {}
  process.exitCode = 1;
});
