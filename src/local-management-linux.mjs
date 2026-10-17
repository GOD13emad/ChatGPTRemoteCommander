/**
 * Explicit, unprivileged Linux native IPC adapter for an EXISTING Core instance.
 * No production server imports/enables this module automatically. The Python
 * child verifies SO_PEERCRED and relays bounded frames only: it cannot execute a
 * workflow, shell command, model or GUI action. All effects go to workflowTools.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createLocalManagementGateway } from './local-management-contract.mjs';
import {inspectLocalManagementEvent} from './local-management-reconcile.mjs';

const HELPER = fileURLToPath(new URL('../tools/local-management-linux.py', import.meta.url));
const AUTH = 'LINUX_SO_PEERCRED_SAME_UID_SESSION';
const TARGET_KEYS = ['deviceId', 'profileId', 'configSha256', 'routeGeneration'];
const fail = code => { throw Object.assign(new Error(code), { managementCode: code }); };
const exact = (v, names) => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const int = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clone = value => JSON.parse(JSON.stringify(value));

/**
 * The caller is trusted native bootstrap code, not an MCP/web request. It must
 * supply the displayed target, current resident identity callback and the exact
 * already-running workflowTools instance. Optional expectedClientPid narrows the
 * owner-UID boundary to a deliberately launched native client. It is not read from
 * the remote client's request. A new session is never created/retried here.
 */
export async function startLinuxLocalManagement({ enabled = false, runtimeDirectory,
  target, readIdentity, workflowTools, expectedClientPid = null, sessionMs = 60000,
  idleMs = 15000, maxRequests = 64, operationTimeoutMs = 5000 } = {}) {
  if (enabled !== true) fail('MANAGEMENT_NOT_ENABLED');
  if (process.platform !== 'linux' || typeof process.getuid !== 'function') fail('MANAGEMENT_PLATFORM_UNSUPPORTED');
  const uid = process.getuid();
  if (uid === 0 || uid !== process.geteuid() || process.getgid() !== process.getegid())
    fail('MANAGEMENT_UNPRIVILEGED_OWNER_REQUIRED');
  if (typeof runtimeDirectory !== 'string' || !path.posix.isAbsolute(runtimeDirectory) ||
      path.posix.normalize(runtimeDirectory) !== runtimeDirectory || runtimeDirectory.includes('\0'))
    fail('MANAGEMENT_RUNTIME_PATH');
  if (!int(sessionMs, 100, 300000) || !int(idleMs, 50, 30000) || !int(maxRequests, 1, 256) ||
      !int(operationTimeoutMs, 1, 10000) || (expectedClientPid !== null && !int(expectedClientPid, 1, 2147483647)))
    fail('MANAGEMENT_OPTIONS');
  if (typeof readIdentity !== 'function' || typeof workflowTools?.execute !== 'function' ||
      !Array.isArray(workflowTools.definitions) ||
      !['workflow_control', 'workflow_get'].every(name => workflowTools.definitions.some(d => d.name === name)))
    fail('MANAGEMENT_RESIDENT_ADAPTER_REQUIRED');
  const fixedTarget = clone(target);
  const current = () => {
    try {
      const value = readIdentity();
      return exact(value, TARGET_KEYS) && TARGET_KEYS.every(k => value[k] === fixedTarget[k]);
    } catch { return false; }
  };
  if (!current()) fail('MANAGEMENT_TARGET_CHANGED');
  const key = randomBytes(32);
  const gateway = createLocalManagementGateway({ target: fixedTarget, key, maxRequests,
    operationTimeoutMs, isCurrent: current,
    dispatch: (name, args) => workflowTools.execute(name, args),
    readBack: id => workflowTools.execute('workflow_get', { id }),
  });
  // No arbitrary program/helper path comes from the client; the installed source
  // and system interpreter are the parent's trusted implementation boundary.
  for (const filename of ['/usr/bin/python3', HELPER]) {
    const resolved = fs.realpathSync(filename), st = fs.statSync(resolved);
    if (!st.isFile() || ![0, uid].includes(st.uid) || (st.mode & 0o022)) {
      gateway.close(); key.fill(0); fail('MANAGEMENT_HELPER_UNTRUSTED');
    }
  }
  let child;
  try {
    child = spawn('/usr/bin/python3', ['-I', '-u', HELPER, '--relay'], {
      stdio: ['pipe', 'pipe', 'ignore'], shell: false, windowsHide: true,
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
    });
  } catch {
    gateway.close(); key.fill(0); fail('MANAGEMENT_HELPER_START_FAILED');
  }
  let phase = 'STARTING', endpoint = null, peer = null, sequence = 0;
  let stopping = null, helperClosed = false, lastCode = null, pending = false;
  let buffer = Buffer.alloc(0), sessionTimer, startupTimer;
  let resolveReady, rejectReady, resolveExited;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const exited = new Promise(resolve => { resolveExited = resolve; });
  let readySettled = false;
  function rejectStartup(code) {
    if (!readySettled) { readySettled = true; rejectReady(Object.assign(new Error(code), { managementCode: code })); }
  }
  function send(value) {
    if (helperClosed || child.stdin.destroyed || !child.stdin.writable) return false;
    const line = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(line) > 65536) return false;
    child.stdin.write(line);
    return true;
  }
  function revoke(code) {
    lastCode = code;
    if (phase !== 'UNCERTAIN') phase = 'REVOKED';
    gateway.close(); key.fill(0);
    send({ type: 'close' });
    rejectStartup(code);
  }
  async function close() {
    if (!stopping) {
      revoke(lastCode ?? 'MANAGEMENT_SESSION_REVOKED');
      stopping = (async () => {
        if (!helperClosed) await Promise.race([exited, sleep(1000)]);
        if (!helperClosed) child.kill('SIGTERM'); // Only this owned relay child.
        if (!helperClosed) await Promise.race([exited, sleep(1000)]);
        if (!helperClosed) child.kill('SIGKILL');
        if (!helperClosed) await Promise.race([exited, sleep(1000)]);
        if (!helperClosed) fail('MANAGEMENT_HELPER_EXIT_UNVERIFIED');
        return { closed: true, helperExited: true };
      })();
    }
    return stopping;
  }
  function status() {
    return { phase, helperPid: child.pid, helperExited: helperClosed,
      endpoint, peer: peer ? { ...peer } : null, pending, lastCode,
      target: clone(fixedTarget), authentication: AUTH,
      // No key, request body, workflow contents or private callback output.
      requestFrames: sequence };
  }
  function protocolFailure(code = 'MANAGEMENT_RELAY_PROTOCOL') {
    revoke(code);
    void close().catch(() => {});
  }
  async function request(frame) {
    if (phase !== 'CONNECTED' || pending || !exact(frame, ['type', 'sequence', 'wire']) ||
        !int(frame.sequence, 1, maxRequests) || frame.sequence !== sequence + 1 ||
        typeof frame.wire !== 'string' || Buffer.byteLength(frame.wire) > 8192) {
      protocolFailure(); return;
    }
    sequence = frame.sequence; pending = true;
    try {
      if (!current()) { protocolFailure('MANAGEMENT_TARGET_CHANGED'); return; }
      const receipt = await gateway.handle(frame.wire);
      if (receipt.state === 'UNCERTAIN') { phase = 'UNCERTAIN'; lastCode = receipt.code; gateway.close(); key.fill(0); }
      send({ type: 'result', sequence, receipt });
    } catch {
      // Unknown/forged wire data is never echoed and never auto-retried.
      protocolFailure('MANAGEMENT_REQUEST_REFUSED');
    } finally { pending = false; }
  }
  function frame(value) {
    if (value?.type === 'ready') {
      if (phase !== 'STARTING' || !exact(value, ['type', 'path', 'pid', 'uid']) ||
          value.pid !== child.pid || value.uid !== uid || typeof value.path !== 'string') return protocolFailure();
      const rel = path.relative(runtimeDirectory, value.path);
      if (!/^rcm-[a-f0-9]{24}\/control\.sock$/.test(rel) || Buffer.byteLength(value.path) >= 108) return protocolFailure();
      if (!current()) return protocolFailure('MANAGEMENT_TARGET_CHANGED');
      endpoint = value.path; phase = 'READY'; clearTimeout(startupTimer);
      readySettled = true;
      resolveReady(Object.freeze({ endpoint, helperPid: child.pid, target: clone(fixedTarget),
        status, close, closed: exited, inspectControl: args => inspectLocalManagementEvent({
          ...args,target:fixedTarget,readIdentity,workflowTools
        }),
        revoke: () => revoke('MANAGEMENT_SESSION_REVOKED') }));
      return;
    }
    if (value?.type === 'peer') {
      if (phase !== 'READY' || !exact(value, ['type', 'pid', 'uid', 'gid']) || value.uid !== uid ||
          !int(value.pid, 1, 2147483647) || !int(value.gid, 0, 2147483647) ||
          (expectedClientPid !== null && value.pid !== expectedClientPid) || !current()) return protocolFailure('MANAGEMENT_PEER_DENIED');
      peer = { pid: value.pid, uid: value.uid, gid: value.gid }; phase = 'CONNECTED';
      send({ type: 'bootstrap', bootstrap: { schema: 1,
        session: { ...gateway.session(), authentication: AUTH }, keyHex: key.toString('hex') } });
      return;
    }
    if (value?.type === 'request') { void request(value); return; }
    if (value?.type === 'error' && exact(value, ['type', 'code']) && typeof value.code === 'string' &&
        /^MANAGEMENT_[A-Z_]{1,80}$/.test(value.code)) return protocolFailure(value.code);
    protocolFailure();
  }
  child.stdout.on('data', chunk => {
    if (buffer.length + chunk.length > 65536) { protocolFailure('MANAGEMENT_RELAY_LIMIT'); return; }
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.includes(10)) {
      const i = buffer.indexOf(10), raw = buffer.subarray(0, i); buffer = buffer.subarray(i+1);
      let value;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
      catch { protocolFailure(); return; }
      frame(value);
    }
  });
  child.stdin.on('error', () => protocolFailure('MANAGEMENT_PARENT_PIPE_CLOSED'));
  child.stdout.on('error', () => protocolFailure('MANAGEMENT_HELPER_PIPE_CLOSED'));
  child.once('error', () => rejectStartup('MANAGEMENT_HELPER_START_FAILED'));
  child.once('close', (code, signal) => {
    helperClosed = true; gateway.close(); key.fill(0);
    clearTimeout(startupTimer); clearTimeout(sessionTimer);
    if (!['UNCERTAIN', 'REVOKED'].includes(phase)) phase = 'CLOSED';
    rejectStartup(lastCode ?? 'MANAGEMENT_HELPER_EXITED');
    resolveExited({ exitCode: code, signal, helperExited: true });
  });
  startupTimer = setTimeout(() => protocolFailure('MANAGEMENT_STARTUP_TIMEOUT'), 5000);
  sessionTimer = setTimeout(() => { revoke('MANAGEMENT_SESSION_EXPIRED'); void close().catch(()=>{}); }, sessionMs);
  send({ schema: 1, root: runtimeDirectory, uid, expectedClientPid, sessionMs, idleMs, maxRequests });
  try { return await ready; }
  catch (error) { await close(); throw error; }
}
