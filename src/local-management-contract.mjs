/**
 * Opt-in native-management admission contract. No listener, filesystem, shell,
 * provider, GUI or application bootstrap is created by importing this module.
 * MAC possession is NOT OS-user or ChatGPT authentication. A separately reviewed
 * native adapter must bind an ephemeral key to an authorized local client and
 * bind dispatch/readBack to the exact Core instance before enabling this gate.
 */
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { localManagementReason } from './local-management-reconcile.mjs';

const MAX_WIRE_BYTES = 8192;
const MAX_LIFETIME_MS = 15000;
const ACTIONS = Object.freeze({ 'workflow.pause': 'pause', 'workflow.cancel': 'cancel' });
const KNOWN_NO_EFFECT = new Set([
  'WORKFLOW_REVISION_CONFLICT', 'WORKFLOW_NOT_FOUND', 'WORKFLOW_CANCELLED',
  'WORKFLOW_ALREADY_COMPLETED', 'WORKFLOW_IDENTITY_CHANGED',
]);
const fail = code => { const e = new Error(code); e.managementCode = code; throw e; };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function keys(value, expected) {
  if (!plain(value) || Object.keys(value).length !== expected.length ||
      expected.some(k => !Object.hasOwn(value, k))) fail('MANAGEMENT_SCHEMA');
}
function id(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail('MANAGEMENT_SCHEMA');
  return value;
}
function integer(value, low, high = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < low || value > high) fail('MANAGEMENT_SCHEMA');
  return value;
}
function targetOf(value) {
  keys(value, ['deviceId', 'profileId', 'configSha256', 'routeGeneration']);
  return {
    deviceId: id(value.deviceId, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    profileId: id(value.profileId, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    configSha256: id(value.configSha256, /^[a-f0-9]{64}$/),
    routeGeneration: integer(value.routeGeneration, 1),
  };
}
function payloadOf(value) {
  keys(value, ['schema', 'sessionId', 'target', 'requestId', 'action', 'workflowId',
    'expectedRevision', 'issuedAtEpochMs', 'expiresAtEpochMs']);
  if (value.schema !== 1 || typeof value.action !== 'string' || !Object.hasOwn(ACTIONS, value.action)) fail('MANAGEMENT_ACTION_DENIED');
  const issued = integer(value.issuedAtEpochMs, 0);
  const expires = integer(value.expiresAtEpochMs, issued + 1);
  if (expires - issued > MAX_LIFETIME_MS) fail('MANAGEMENT_LIFETIME');
  return {
    schema: 1,
    sessionId: id(value.sessionId, /^[a-f0-9]{64}$/),
    target: targetOf(value.target),
    requestId: id(value.requestId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
    action: value.action,
    workflowId: id(value.workflowId, /^[a-z][a-z0-9_-]{0,63}$/),
    expectedRevision: integer(value.expectedRevision, 1, 10000),
    issuedAtEpochMs: issued,
    expiresAtEpochMs: expires,
  };
}
function keyCopy(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) fail('MANAGEMENT_KEY_REQUIRED');
  return Buffer.from(key);
}
const macFor = (key, payload) => createHmac('sha256', key).update(JSON.stringify(payload)).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));

/** Native adapter helper. Never deliver its key to remote web content. */
export function encodeManagementRequest(payload, key) {
  const normalized = payloadOf(payload), secret = keyCopy(key);
  try { return JSON.stringify({ payload: normalized, mac: macFor(secret, normalized) }); }
  finally { secret.fill(0); }
}

/**
 * Reuses the resident Core dispatcher instead of opening another WorkflowStore.
 * Dispatch must preserve Core's revision/identity/lease/uncertainty checks.
 * readBack must be a non-mutating read of that SAME resident instance.
 * Request history is bounded and session-local; restarting requires a NEW key
 * and session. No persisted uncertain operation may be retried automatically.
 */
export function createLocalManagementGateway({ target, key, dispatch, readBack,
  now = Date.now, maxRequests = 256, operationTimeoutMs = 5000, isCurrent = () => true } = {}) {
  const sessionId = randomBytes(32).toString('hex');
  const fixedTarget = Object.freeze(targetOf(target));
  const fixedTargetWire = JSON.stringify(fixedTarget), secret = keyCopy(key);
  id(sessionId, /^[a-f0-9]{64}$/);
  integer(maxRequests, 1, 1024);
  integer(operationTimeoutMs, 1, 10000);
  if (typeof dispatch !== 'function' || typeof readBack !== 'function' || typeof now !== 'function' || typeof isCurrent !== 'function')
    fail('MANAGEMENT_ADAPTER_REQUIRED');
  const current = () => { try { return isCurrent() === true; } catch { return false; } };
  let closed = false;
  const requests = new Map();

  function decode(wire) {
    if (closed) fail('MANAGEMENT_CLOSED');
    if (typeof wire !== 'string' || Buffer.byteLength(wire) > MAX_WIRE_BYTES) fail('MANAGEMENT_WIRE_LIMIT');
    let envelope;
    try { envelope = JSON.parse(wire); } catch { fail('MANAGEMENT_JSON'); }
    keys(envelope, ['payload', 'mac']);
    const payload = payloadOf(envelope.payload);
    id(envelope.mac, /^[a-f0-9]{64}$/);
    // Canonical wire equality rejects duplicate keys, unexpected fields and
    // alternate encodings before they can acquire a request identity.
    if (JSON.stringify({ payload, mac: envelope.mac }) !== wire) fail('MANAGEMENT_NONCANONICAL');
    if (!timingSafeEqual(Buffer.from(envelope.mac, 'hex'), Buffer.from(macFor(secret, payload), 'hex')))
      fail('MANAGEMENT_AUTH_FAILED');
    if (payload.sessionId !== sessionId) fail('MANAGEMENT_SESSION_CHANGED');
    if (JSON.stringify(payload.target) !== fixedTargetWire) fail('MANAGEMENT_TARGET_CHANGED');
    const time = integer(now(), 0);
    if (payload.expiresAtEpochMs <= time || payload.issuedAtEpochMs > time + 1000)
      fail('MANAGEMENT_EXPIRED_OR_FUTURE');
    return payload;
  }

  async function bounded(fn) {
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('MANAGEMENT_DEADLINE')), operationTimeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }

  async function perform(payload) {
    const base = { schema: 1, requestId: payload.requestId, action: payload.action,
      workflowId: payload.workflowId, target: fixedTarget,
      expectedRevision: payload.expectedRevision };
    const time = now();
    if (closed || !Number.isSafeInteger(time) || time < 0 || payload.expiresAtEpochMs <= time || payload.issuedAtEpochMs > time + 1000)
      return { ...base, state: 'REJECTED', code: closed ? 'MANAGEMENT_SESSION_REVOKED' : 'MANAGEMENT_EXPIRED_BEFORE_EFFECT', newRevision: null };
    let admissionFailure = null;
    try {
      await bounded(() => {
        // Recheck inside the last queued callback, not only before queuing it.
        const dispatchTime = now();
        admissionFailure = closed ? 'MANAGEMENT_SESSION_REVOKED' :
          (!Number.isSafeInteger(dispatchTime) || dispatchTime < 0 ||
           payload.expiresAtEpochMs <= dispatchTime || payload.issuedAtEpochMs > dispatchTime + 1000)
            ? 'MANAGEMENT_EXPIRED_BEFORE_EFFECT' : !current() ? 'MANAGEMENT_TARGET_CHANGED' : null;
        if (admissionFailure) throw new Error(admissionFailure);
        return dispatch('workflow_control', {
          id: payload.workflowId, expectedRevision: payload.expectedRevision,
          action: ACTIONS[payload.action], reason: localManagementReason(payload.requestId),
        });
      });
    } catch (error) {
      if (admissionFailure) return { ...base, state: 'REJECTED', code: admissionFailure, newRevision: null };
      const code = error?.workflowCode;
      return { ...base, state: KNOWN_NO_EFFECT.has(code) ? 'REJECTED' : 'UNCERTAIN',
        code: KNOWN_NO_EFFECT.has(code) ? code : 'MANAGEMENT_OUTCOME_UNCERTAIN', newRevision: null };
    }
    try {
      const view = await bounded(() => readBack(payload.workflowId));
      const state = view?.state;
      const intended = payload.action === 'workflow.pause' ? 'PAUSED' : 'CANCELLED';
      if (!current() || !state || state.id !== payload.workflowId || state.revision !== payload.expectedRevision + 1 ||
          state.control?.intent !== intended) throw new Error('UNVERIFIED');
      return { ...base, state: 'APPLIED', code: 'MANAGEMENT_CONTROL_READBACK_VERIFIED',
        newRevision: state.revision, controlIntent: intended };
    } catch {
      return { ...base, state: 'UNCERTAIN', code: 'MANAGEMENT_READBACK_UNVERIFIED', newRevision: null };
    }
  }

  return Object.freeze({
    session: () => ({ schema: 1, sessionId, target: copy(fixedTarget),
      actions: Object.keys(ACTIONS), authentication: 'EPHEMERAL_MAC_NATIVE_BOOTSTRAP_REQUIRED' }),
    async handle(wire) {
      const payload = decode(wire);
      const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const prior = requests.get(payload.requestId);
      if (prior) {
        if (prior.hash !== hash) fail('MANAGEMENT_REQUEST_ID_CONFLICT');
        return copy(await prior.promise);
      }
      if (requests.size >= maxRequests) fail('MANAGEMENT_REQUEST_BUDGET');
      // Reserve before dispatch. Identical concurrent clicks await one effect.
      const promise = Promise.resolve().then(() => perform(payload));
      requests.set(payload.requestId, { hash, promise });
      return copy(await promise);
    },
    close() { closed = true; secret.fill(0); },
  });
}
