import path from 'node:path';
import { appendFile, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { withPathLocks } from './locks.mjs';
import { guardFileWrite } from './file-write-guard.mjs';
import {
  psQuote,
  rootForPath,
  safeExistingPath,
  safeWritablePath,
  validateCommandArgs,
  validateProgram
} from './security-v0.3.mjs';
import { resolveExistingTarget, writeAnyFile } from './power-tools-v0.3.mjs';

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function legacyPowerFullFilesystem(ctx) {
  return ctx.config.powerMode?.enabled === true && ctx.config.powerMode?.fullFilesystem === true;
}

async function legacyExistingPath(ctx, userPath, base = ctx.roots[0]) {
  if (legacyPowerFullFilesystem(ctx)) return resolveExistingTarget(ctx, userPath, base);
  return safeExistingPath(userPath, ctx.roots, base);
}

let auditTail = Promise.resolve();

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(Math.trunc(parsed), maximum));
}

async function rotateAuditLog(ctx, nextBytes) {
  const maxBytes = boundedInteger(ctx.config.auditMaxBytes, 8 * 1024 * 1024, 64 * 1024, 1024 * 1024 * 1024);
  const keepFiles = boundedInteger(ctx.config.auditKeepFiles, 3, 1, 20);
  let currentBytes = 0;
  try { currentBytes = (await stat(ctx.auditLog)).size; }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (currentBytes === 0 || currentBytes + nextBytes <= maxBytes) {
    return { rotated: false, maxBytes, keepFiles };
  }

  await rm(`${ctx.auditLog}.${keepFiles}`, { force: true });
  for (let index = keepFiles - 1; index >= 1; index -= 1) {
    try { await rename(`${ctx.auditLog}.${index}`, `${ctx.auditLog}.${index + 1}`); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  try { await rename(ctx.auditLog, `${ctx.auditLog}.1`); }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return { rotated: true, maxBytes, keepFiles };
}

export function audit(ctx, record) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n';
  const nextBytes = Buffer.byteLength(line, 'utf8');
  const operation = auditTail.then(async () => {
    await mkdir(path.dirname(ctx.auditLog), { recursive: true });
    await rotateAuditLog(ctx, nextBytes);
    await appendFile(ctx.auditLog, line, 'utf8');
  });
  auditTail = operation.catch(() => {});
  return operation;
}
async function walkDirectory(dir, depth, maxEntries, base, out) {
  if (out.length >= maxEntries) return;
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= maxEntries) break;
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full) || '.';
    out.push({ path: rel, type: entry.isDirectory() ? 'directory' : 'file' });
    if (entry.isDirectory() && depth > 0) {
      await walkDirectory(full, depth - 1, maxEntries, base, out);
    }
  }
}

export async function listDirectory(ctx, input) {
  const target = await legacyExistingPath(ctx, input.path ?? '.', ctx.roots[0]);
  const info = await stat(target);
  if (!info.isDirectory()) throw new Error('path is not a directory');
  const depth = Math.max(0, Math.min(Number(input.depth ?? 1), 4));
  const maxEntries = Math.max(1, Math.min(Number(input.maxEntries ?? 200), 500));
  const entries = [];
  await walkDirectory(target, depth, maxEntries, target, entries);
  await audit(ctx, { action: 'list_directory', target, ok: true, count: entries.length });
  return { target, depth, truncated: entries.length >= maxEntries, entries };
}
export async function readText(ctx, input) {
  const fullFilesystem = legacyPowerFullFilesystem(ctx);
  const target = await legacyExistingPath(ctx, input.path, ctx.roots[0]);
  const info = await stat(target);
  if (!info.isFile()) throw new Error('path is not a file');
  const maxReadBytes = Number(fullFilesystem
    ? (ctx.config.powerMode?.maxFileBytes ?? ctx.config.maxReadBytes ?? 524288)
    : (ctx.config.maxReadBytes ?? 524288));
  if (info.size > maxReadBytes) {
    throw new Error(`file exceeds maxReadBytes (${maxReadBytes})`);
  }
  const buffer = await readFile(target);
  if (buffer.includes(0)) throw new Error('binary files are not supported by read_text');
  const text = buffer.toString('utf8');
  const result = {
    path: target,
    bytes: buffer.length,
    sha256: sha256(buffer),
    text
  };
  await audit(ctx, { action: 'read_text', target, ok: true, bytes: buffer.length, powerModeFullFilesystem: fullFilesystem });
  return result;
}
export async function writeText(ctx, input) {
  if (input.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(input.expectedSha256)) throw new Error('expectedSha256 must be a lowercase 64-hex SHA-256');
  if (typeof input.content !== 'string') throw new Error('content must be a string');
  const fullFilesystem = legacyPowerFullFilesystem(ctx);
  const bytes = Buffer.byteLength(input.content, 'utf8');
  const maxWriteBytes = Number(fullFilesystem
    ? (ctx.config.powerMode?.maxFileBytes ?? ctx.config.maxWriteBytes ?? 524288)
    : (ctx.config.maxWriteBytes ?? 524288));
  if (bytes > maxWriteBytes) {
    throw new Error(`content exceeds maxWriteBytes (${maxWriteBytes})`);
  }
  const mode = input.mode === 'append' ? 'append' : 'overwrite';

  if (fullFilesystem) {
    const result = await writeAnyFile(ctx, {
      path: input.path,
      content: input.content,
      mode,
      expectedSha256: input.expectedSha256,
      encoding: 'utf8',
      createParents: false
    });
    const adapted = { ...result, mode };
    await audit(ctx, {
      action: 'write_text', target: adapted.path, ok: true, mode, bytes,
      backupPath: adapted.backupPath, powerModeFullFilesystem: true
    });
    return adapted;
  }

  const target = await safeWritablePath(input.path, ctx.roots, ctx.roots[0]);
  return withPathLocks([target], async () => {
    const snapshot = await guardFileWrite(target);
    let beforeHash = null;
    let backupPath = null;
    try {
      const before = await readFile(target);
      beforeHash = sha256(before);
      if (input.expectedSha256 && input.expectedSha256 !== beforeHash) {
        throw new Error('expectedSha256 does not match current file');
      }
      await guardFileWrite(target, snapshot);
      const root = rootForPath(target, ctx.roots);
      const rel = path.relative(root, target);
      const stamp = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
      backupPath = path.join(root, '.remote-commander-backups', stamp, rel);
      await mkdir(path.dirname(backupPath), { recursive: true });
      await copyFile(target, backupPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      if (input.expectedSha256 !== undefined) throw new Error('expectedSha256 precondition failed: target does not exist');
    }
    await guardFileWrite(target, snapshot);
    if (mode === 'append') await appendFile(target, input.content, 'utf8');
    else await writeFile(target, input.content, 'utf8');
    const after = await readFile(target);
    const result = { path: target, mode, bytes: after.length, beforeSha256: beforeHash, sha256: sha256(after), backupPath };
    await audit(ctx, { action: 'write_text', target, ok: true, mode, bytes, backupPath });
    return result;
  });
}
export async function runProjectCommand(ctx, input) {
  const fullFilesystem = legacyPowerFullFilesystem(ctx);
  const program = validateProgram(input.program, ctx.config.allowedPrograms);
  const cwd = await legacyExistingPath(ctx, input.cwd ?? '.', ctx.roots[0]);
  const info = await stat(cwd);
  if (!info.isDirectory()) throw new Error('cwd is not a directory');
  const args = validateCommandArgs(program, input.args ?? [], cwd, ctx.roots, { fullFilesystem });
  const requested = Number(input.timeoutMs ?? ctx.config.maxCommandMs);
  const timeoutMs = Math.max(1000, Math.min(requested, ctx.config.maxCommandMs));
  const child = spawn(program, args, {
    cwd,
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  const outputLimit = 262144;
  child.stdout.on('data', (chunk) => { if (stdout.length < outputLimit) stdout += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { if (stderr.length < outputLimit) stderr += chunk.toString('utf8'); });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
  const outcome = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  const result = {
    program, args, cwd, timeoutMs, timedOut,
    exitCode: outcome.code, signal: outcome.signal, stdout, stderr,
    truncated: stdout.length >= outputLimit || stderr.length >= outputLimit
  };
  await audit(ctx, {
    action: 'run_project_command', program, args, cwd, ok: !timedOut && outcome.code === 0,
    exitCode: outcome.code, timedOut, powerModeFullFilesystem: fullFilesystem
  });
  return result;
}
