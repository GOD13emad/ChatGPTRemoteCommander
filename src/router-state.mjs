import http from 'node:http';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { lstat, mkdir, open, rename, stat, unlink } from 'node:fs/promises';

export const ROUTER_CONFIG_SCHEMA = 1;
export const ROUTER_POINTER_SCHEMA = 1;
export const ROUTER_REVISION = 'blue-green-router-r1';

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const MAX_STATE_BYTES = 64 * 1024;
const STALE_LOCK_AGE_MS = 30000;

export function routerError(code, message = code) {
  return Object.assign(new Error(message), { code });
}

function plainObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw routerError(code);
  return value;
}

function exactKeys(value, required, optional, code) {
  plainObject(value, code);
  const allowed = new Set([...required, ...optional]);
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !allowed.has(key))) {
    throw routerError(code);
  }
}

function integer(value, low, high, code) {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw routerError(code);
  return value;
}

function localAbsolute(value, code) {
  if (typeof value !== 'string' || value.length === 0 || /^(?:\\\\|\/\/)/.test(value) || !path.isAbsolute(value)) {
    throw routerError(code);
  }
  return path.resolve(value);
}

function named(value, pattern, code) {
  if (typeof value !== 'string' || !pattern.test(value)) throw routerError(code);
  return value;
}

export function validateBackendIdentity(value) {
  exactKeys(value,
    ['profile', 'version', 'configSha256', 'commit', 'slotId', 'projectDir', 'port'], [],
    'ROUTER_BACKEND_IDENTITY_INVALID');
  return Object.freeze({
    profile: named(value.profile, NAME, 'ROUTER_BACKEND_PROFILE_INVALID'),
    version: named(value.version, VERSION, 'ROUTER_BACKEND_VERSION_INVALID'),
    configSha256: named(value.configSha256, SHA256, 'ROUTER_BACKEND_CONFIG_SHA_INVALID').toLowerCase(),
    commit: named(value.commit, COMMIT, 'ROUTER_BACKEND_COMMIT_INVALID').toLowerCase(),
    slotId: named(value.slotId, NAME, 'ROUTER_BACKEND_SLOT_INVALID'),
    projectDir: localAbsolute(value.projectDir, 'ROUTER_BACKEND_PROJECT_DIR_INVALID'),
    port: integer(value.port, 1024, 65535, 'ROUTER_BACKEND_PORT_INVALID')
  });
}

export function backendIdentityEquals(left, right) {
  const a = validateBackendIdentity(left);
  const b = validateBackendIdentity(right);
  return Object.keys(a).every(key => a[key] === b[key]);
}

export function validatePointer(value) {
  exactKeys(value, ['schema', 'generation', 'backend', 'updatedAt'], [], 'ROUTER_POINTER_INVALID');
  if (value.schema !== ROUTER_POINTER_SCHEMA) throw routerError('ROUTER_POINTER_SCHEMA_UNSUPPORTED');
  integer(value.generation, 1, Number.MAX_SAFE_INTEGER, 'ROUTER_POINTER_GENERATION_INVALID');
  if (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw routerError('ROUTER_POINTER_TIME_INVALID');
  }
  return Object.freeze({
    schema: ROUTER_POINTER_SCHEMA,
    generation: value.generation,
    backend: validateBackendIdentity(value.backend),
    updatedAt: value.updatedAt
  });
}

function bounded(value, fallback, low, high, code) {
  if (value === undefined) return fallback;
  return integer(value, low, high, code);
}

export function validateRouterConfig(value) {
  exactKeys(value, ['schema', 'routerId', 'host', 'port', 'profile', 'pointerPath', 'runtimeStatePath'],
    ['requestMaxBytes', 'responseMaxBytes', 'healthTimeoutMs', 'upstreamTimeoutMs'], 'ROUTER_CONFIG_INVALID');
  if (value.schema !== ROUTER_CONFIG_SCHEMA) throw routerError('ROUTER_CONFIG_SCHEMA_UNSUPPORTED');
  if (!LOOPBACK.has(value.host)) throw routerError('ROUTER_LISTENER_NOT_LOOPBACK');
  const pointerPath = localAbsolute(value.pointerPath, 'ROUTER_POINTER_PATH_INVALID');
  const runtimeStatePath = localAbsolute(value.runtimeStatePath, 'ROUTER_RUNTIME_STATE_PATH_INVALID');
  const comparablePointer = process.platform === 'win32' ? pointerPath.toLowerCase() : pointerPath;
  const comparableRuntime = process.platform === 'win32' ? runtimeStatePath.toLowerCase() : runtimeStatePath;
  if (comparablePointer === comparableRuntime) throw routerError('ROUTER_STATE_PATH_COLLISION');
  return Object.freeze({
    schema: ROUTER_CONFIG_SCHEMA,
    routerId: named(value.routerId, NAME, 'ROUTER_ID_INVALID'),
    host: value.host,
    port: integer(value.port, 1024, 65535, 'ROUTER_PORT_INVALID'),
    profile: named(value.profile, NAME, 'ROUTER_PROFILE_INVALID'),
    pointerPath,
    runtimeStatePath,
    requestMaxBytes: bounded(value.requestMaxBytes, 1024 * 1024, 128, 16 * 1024 * 1024, 'ROUTER_REQUEST_LIMIT_INVALID'),
    responseMaxBytes: bounded(value.responseMaxBytes, 4 * 1024 * 1024, 128, 32 * 1024 * 1024, 'ROUTER_RESPONSE_LIMIT_INVALID'),
    healthTimeoutMs: bounded(value.healthTimeoutMs, 2000, 100, 30000, 'ROUTER_HEALTH_TIMEOUT_INVALID'),
    // Commands may legitimately run for the backend's full bounded command window.
    // This timeout never triggers a retry; callers must treat expiry as uncertain.
    upstreamTimeoutMs: bounded(value.upstreamTimeoutMs, 660000, 1000, 900000, 'ROUTER_TIMEOUT_INVALID')
  });
}

function regularStateFile(info, maximum) {
  return info.isFile() && !info.isSymbolicLink() && info.size >= 2 && info.size <= maximum && info.nlink === 1;
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function readJsonFile(file, maximum, missingCode, invalidCode) {
  let raw;
  // Atomic replacement can legitimately occur between lstat and open. Retry
  // that identity mismatch, but always reject links/multiple hard links. Once
  // opened, the handle itself is the linearizable state snapshot.
  for (let attempt = 0; attempt < 3 && raw === undefined; attempt++) {
    let initial;
    try { initial = await lstat(file); }
    catch (error) {
      if (error.code === 'ENOENT') throw routerError(missingCode);
      throw error;
    }
    if (!regularStateFile(initial, maximum)) throw routerError(invalidCode);
    let handle;
    try {
      handle = await open(file, 'r');
      const opened = await handle.stat();
      if (!regularStateFile(opened, maximum)) throw routerError(invalidCode);
      if (!sameFile(initial, opened)) continue;
      const candidate = await handle.readFile('utf8');
      const afterRead = await handle.stat();
      if (!regularStateFile(afterRead, maximum) || !sameFile(opened, afterRead) ||
          afterRead.size !== opened.size || afterRead.mtimeMs !== opened.mtimeMs ||
          Buffer.byteLength(candidate) !== afterRead.size) {
        throw routerError(invalidCode);
      }
      raw = candidate;
    } catch (error) {
      if (error.code?.startsWith?.('ROUTER_')) throw error;
      throw routerError(invalidCode, `${invalidCode}: ${error.code ?? 'READ'}`);
    } finally {
      await handle?.close().catch(() => {});
    }
  }
  if (raw === undefined) throw routerError(invalidCode);
  try { return { raw, value: JSON.parse(raw) }; }
  catch { throw routerError(invalidCode); }
}

export async function loadRouterConfig(file) {
  const resolved = localAbsolute(file, 'ROUTER_CONFIG_PATH_INVALID');
  const { raw, value } = await readJsonFile(resolved, MAX_STATE_BYTES, 'ROUTER_CONFIG_MISSING', 'ROUTER_CONFIG_INVALID');
  return {
    path: resolved,
    sha256: createHash('sha256').update(raw).digest('hex'),
    config: validateRouterConfig(value)
  };
}

export async function loadPointer(file) {
  const resolved = localAbsolute(file, 'ROUTER_POINTER_PATH_INVALID');
  const { value } = await readJsonFile(resolved, MAX_STATE_BYTES, 'ROUTER_POINTER_MISSING', 'ROUTER_POINTER_INVALID');
  return validatePointer(value);
}

export function loadPointerSync(file) {
  const resolved = localAbsolute(file, 'ROUTER_POINTER_PATH_INVALID');
  let raw;
  for (let attempt = 0; attempt < 3 && raw === undefined; attempt++) {
    let initial;
    try { initial = lstatSync(resolved); }
    catch (error) {
      if (error.code === 'ENOENT') throw routerError('ROUTER_POINTER_MISSING');
      throw error;
    }
    if (!regularStateFile(initial, MAX_STATE_BYTES)) throw routerError('ROUTER_POINTER_INVALID');
    let descriptor;
    try {
      descriptor = openSync(resolved, 'r');
      const opened = fstatSync(descriptor);
      if (!regularStateFile(opened, MAX_STATE_BYTES)) throw routerError('ROUTER_POINTER_INVALID');
      if (!sameFile(initial, opened)) continue;
      const candidate = readFileSync(descriptor, 'utf8');
      const afterRead = fstatSync(descriptor);
      if (!regularStateFile(afterRead, MAX_STATE_BYTES) || !sameFile(opened, afterRead) ||
          afterRead.size !== opened.size || afterRead.mtimeMs !== opened.mtimeMs ||
          Buffer.byteLength(candidate) !== afterRead.size) {
        throw routerError('ROUTER_POINTER_INVALID');
      }
      raw = candidate;
    } catch (error) {
      if (error.code?.startsWith?.('ROUTER_')) throw error;
      throw routerError('ROUTER_POINTER_INVALID');
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
  if (raw === undefined) throw routerError('ROUTER_POINTER_INVALID');
  try { return validatePointer(JSON.parse(raw)); }
  catch (error) {
    if (error.code?.startsWith?.('ROUTER_')) throw error;
    throw routerError('ROUTER_POINTER_INVALID');
  }
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (!['EACCES', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EPERM'].includes(error.code)) throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function writePointerAtomic(file, pointer) {
  const resolved = localAbsolute(file, 'ROUTER_POINTER_PATH_INVALID');
  const checked = validatePointer(pointer);
  const directory = path.dirname(resolved);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = `${resolved}.tmp-${process.pid}-${randomUUID()}`;
  const bytes = Buffer.from(JSON.stringify(checked, null, 2) + '\n');
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temp, resolved);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temp).catch(() => {});
    throw error;
  }
  return checked;
}

export async function writeJsonAtomic(file, value) {
  const resolved = localAbsolute(file, 'ROUTER_STATE_PATH_INVALID');
  const directory = path.dirname(resolved);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = `${resolved}.tmp-${process.pid}-${randomUUID()}`;
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  if (bytes.length > MAX_STATE_BYTES) throw routerError('ROUTER_STATE_TOO_LARGE');
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temp, resolved);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temp).catch(() => {});
    throw error;
  }
}

async function acquirePointerLock(pointerPath, timeoutMs = 3000) {
  const lockPath = `${pointerPath}.lock`;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }) + '\n');
      await handle.sync();
      return async () => {
        await handle.close().catch(() => {});
        await unlink(lockPath).catch(() => {});
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (await recoverStaleLock(lockPath)) continue;
      if (Date.now() >= deadline) throw routerError('ROUTER_POINTER_BUSY');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
}

async function recoverStaleLock(lockPath) {
  let handle;
  try {
    handle = await open(lockPath, 'r');
    const before = await handle.stat();
    if (!before.isFile() || before.size < 2 || before.size > 1024 || before.nlink > 1) return false;
    const raw = await handle.readFile('utf8');
    let record;
    try { record = JSON.parse(raw); } catch { return false; }
    if (!record || !Number.isSafeInteger(record.pid) || record.pid <= 0 ||
        typeof record.at !== 'string' || !Number.isFinite(Date.parse(record.at)) ||
        Date.now() - Date.parse(record.at) < STALE_LOCK_AGE_MS) return false;
    let definitelyDead = false;
    try { process.kill(record.pid, 0); }
    catch (error) { definitelyDead = error.code === 'ESRCH'; }
    if (!definitelyDead) return false;
    const current = await lstat(lockPath);
    // Do not remove a path that was replaced while its former owner was checked.
    if (current.isSymbolicLink() || !current.isFile() || current.size !== before.size ||
        current.mtimeMs !== before.mtimeMs || current.ino !== before.ino || current.dev !== before.dev) return false;
    await unlink(lockPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function initializePointer({ pointerPath, expectedGeneration, backend, validateCandidate }) {
  if (expectedGeneration !== 0) throw routerError('ROUTER_INIT_EXPECTED_GENERATION_ZERO');
  const resolved = localAbsolute(pointerPath, 'ROUTER_POINTER_PATH_INVALID');
  await mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const release = await acquirePointerLock(resolved);
  try {
    try {
      await stat(resolved);
      throw routerError('ROUTER_POINTER_ALREADY_EXISTS');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const identity = validateBackendIdentity(backend);
    if (typeof validateCandidate !== 'function') throw routerError('ROUTER_CANDIDATE_VALIDATOR_REQUIRED');
    await validateCandidate(identity);
    return await writePointerAtomic(resolved, {
      schema: ROUTER_POINTER_SCHEMA,
      generation: 1,
      backend: identity,
      updatedAt: new Date().toISOString()
    });
  } finally {
    await release();
  }
}

export async function switchPointer({ pointerPath, expectedGeneration, backend, validateCandidate }) {
  integer(expectedGeneration, 1, Number.MAX_SAFE_INTEGER, 'ROUTER_EXPECTED_GENERATION_INVALID');
  const resolved = localAbsolute(pointerPath, 'ROUTER_POINTER_PATH_INVALID');
  const release = await acquirePointerLock(resolved);
  try {
    const current = await loadPointer(resolved);
    const identity = validateBackendIdentity(backend);
    if (typeof validateCandidate !== 'function') throw routerError('ROUTER_CANDIDATE_VALIDATOR_REQUIRED');
    // A caller may lose the successful switch response and retry with its old
    // generation. Exact desired-state reconciliation is a no-op only after a
    // fresh identity/health probe; a dead active backend must never reconcile
    // as success merely because its pointer still matches.
    if (backendIdentityEquals(current.backend, identity)) {
      // Accept the current generation (desired-state assertion) or exactly the
      // prior generation (a lost successful response). Older generations can
      // be an ABA replay after this backend was active, replaced, then active
      // again; treating those as success would defeat the CAS contract.
      if (expectedGeneration !== current.generation && expectedGeneration !== current.generation - 1) {
        throw routerError('ROUTER_GENERATION_CONFLICT');
      }
      await validateCandidate(identity);
      return Object.freeze({ ...current, alreadyActive: true });
    }
    if (current.generation !== expectedGeneration) throw routerError('ROUTER_GENERATION_CONFLICT');
    await validateCandidate(identity);
    if (current.generation === Number.MAX_SAFE_INTEGER) throw routerError('ROUTER_GENERATION_EXHAUSTED');
    return await writePointerAtomic(resolved, {
      schema: ROUTER_POINTER_SCHEMA,
      generation: current.generation + 1,
      backend: identity,
      updatedAt: new Date().toISOString()
    });
  } finally {
    await release();
  }
}

function readResponse(response, maximum) {
  return new Promise((resolve, reject) => {
    const declared = Number(response.headers['content-length'] ?? 0);
    if (Number.isFinite(declared) && declared > maximum) {
      response.destroy();
      reject(routerError('ROUTER_BACKEND_RESPONSE_TOO_LARGE'));
      return;
    }
    const chunks = [];
    let size = 0;
    response.on('data', chunk => {
      size += chunk.length;
      if (size > maximum) {
        response.destroy(routerError('ROUTER_BACKEND_RESPONSE_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    response.once('error', reject);
    response.once('end', () => resolve(Buffer.concat(chunks)));
  });
}

export function requestBackend(identity, { method = 'GET', route = '/health', headers = {}, body = null,
  timeoutMs = 5000, responseMaxBytes = 4 * 1024 * 1024 } = {}) {
  const backend = validateBackendIdentity(identity);
  return new Promise((resolve, reject) => {
    let dispatchStarted = false;
    let settled = false;
    let timer;
    const classifyFailure = error => {
      if (method === 'POST' && dispatchStarted && error.code === 'ROUTER_BACKEND_TIMEOUT') {
        return Object.assign(routerError('ROUTER_BACKEND_TIMEOUT_AFTER_DISPATCH'), {
          httpStatus: 504, uncertainEffect: true, retryPermitted: false
        });
      }
      if (method === 'POST' && dispatchStarted && error.code === 'ROUTER_BACKEND_RESPONSE_TOO_LARGE') {
        return Object.assign(routerError('ROUTER_BACKEND_RESPONSE_TOO_LARGE_AFTER_DISPATCH'), {
          httpStatus: 502, uncertainEffect: true, retryPermitted: false
        });
      }
      if (method === 'POST' && dispatchStarted && !error.code?.startsWith?.('ROUTER_')) {
        return Object.assign(routerError('ROUTER_BACKEND_DISCONNECTED_AFTER_DISPATCH'), {
          httpStatus: 502, uncertainEffect: true, retryPermitted: false
        });
      }
      return error.code?.startsWith?.('ROUTER_') ? error : routerError('ROUTER_BACKEND_UNAVAILABLE');
    };
    const succeed = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(classifyFailure(error));
    };
    const request = http.request({
      host: '127.0.0.1', port: backend.port, path: route, method,
      headers: { ...headers, host: `127.0.0.1:${backend.port}` }
    }, async response => {
      try {
        const data = await readResponse(response, responseMaxBytes);
        succeed({ statusCode: response.statusCode ?? 502, headers: response.headers, body: data });
      } catch (error) { fail(error); }
    });
    // ClientRequest#setTimeout is an inactivity timeout and can be defeated by
    // a backend that drips bytes forever. The configured bound is a wall-clock
    // deadline for the complete response and never triggers a retry.
    timer = setTimeout(() => request.destroy(routerError('ROUTER_BACKEND_TIMEOUT')), timeoutMs);
    request.once('error', fail);
    dispatchStarted = method === 'POST';
    try {
      if (body) request.write(body);
      request.end();
    } catch (error) {
      fail(error);
      request.destroy();
    }
  });
}

export async function probeBackend(identity, options = {}) {
  const expected = validateBackendIdentity(identity);
  const response = await requestBackend(expected, {
    method: 'GET', route: '/health', timeoutMs: options.timeoutMs,
    responseMaxBytes: Math.min(options.responseMaxBytes ?? 1024 * 1024, 1024 * 1024)
  });
  if (response.statusCode !== 200) throw routerError('ROUTER_BACKEND_UNHEALTHY');
  const media = String(response.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  if (media !== 'application/json') throw routerError('ROUTER_BACKEND_HEALTH_INVALID');
  let body;
  try { body = JSON.parse(response.body.toString('utf8')); }
  catch { throw routerError('ROUTER_BACKEND_HEALTH_INVALID'); }
  if (body?.ok !== true || body?.name !== 'chatgpt-remote-commander') throw routerError('ROUTER_BACKEND_UNHEALTHY');
  let actual;
  try { actual = validateBackendIdentity(body.backend); }
  catch { throw routerError('ROUTER_BACKEND_IDENTITY_MISMATCH'); }
  if (!backendIdentityEquals(expected, actual)) throw routerError('ROUTER_BACKEND_IDENTITY_MISMATCH');
  return { ok: true, body, backend: actual };
}
