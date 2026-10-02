import { createHash } from 'node:crypto';
import { types } from 'node:util';

// This module recommends finite policy decisions. It has no effect adapters,
// timers, OS/process/filesystem/network APIs, installation or spending path.
export const PROJECT_AUTOPILOT_MODE = 'PURE_POLICY_ONLY_NOT_INSTALLED';
const HOSTS = ['SAEED_WINDOWS', 'EMAD_WINDOWS', 'EMAD_LINUX'];
const ACTIONS = ['READ_CHECKPOINT', 'INSPECT_SOURCE', 'RUN_BOUNDED_TESTS', 'COLLECT_EVIDENCE'];
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_FRESH_MS = 300_000;
const digest = value => createHash('sha256').update(value).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
class PolicyError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const reject = code => { throw new PolicyError(code); };
function record(value, keys) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) reject('SCHEMA_RECORD_INVALID');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) reject('SCHEMA_PROTOTYPE_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key)
    || !Object.hasOwn(descriptors[key], 'value') || descriptors[key].enumerable !== true)) reject('SCHEMA_KEYS_INVALID');
  const copied = Object.create(null);
  for (const key of keys) copied[key] = descriptors[key].value;
  return copied;
}
function list(value, max) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) reject('SCHEMA_ARRAY_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(value), length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > max || Reflect.ownKeys(descriptors).length !== length + 1) reject('SCHEMA_ARRAY_BOUNDS');
  const copied = [];
  for (let index = 0; index < length; index++) {
    const field = descriptors[String(index)];
    if (!field || !Object.hasOwn(field, 'value') || field.enumerable !== true) reject('SCHEMA_ARRAY_MEMBER_INVALID');
    copied.push(field.value);
  }
  return copied;
}
function integer(value, min, max, code = 'SCHEMA_INTEGER_INVALID') {
  if (!Number.isSafeInteger(value) || value < min || value > max) reject(code);
  return value;
}
function token(value, code = 'SCHEMA_ID_INVALID') {
  if (typeof value !== 'string' || !ID.test(value)) reject(code);
  return value;
}
function text(value, max) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max
    || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value)) reject('SCHEMA_TEXT_INVALID');
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) reject('SCHEMA_TEXT_INVALID');
    } else if (unit >= 0xdc00 && unit <= 0xdfff) reject('SCHEMA_TEXT_INVALID');
  }
  return value;
}
function hash(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !HASH.test(value)) reject('SCHEMA_HASH_INVALID');
  return value;
}
function enumeration(value, allowed, code = 'SCHEMA_ENUM_INVALID') {
  if (!allowed.includes(value)) reject(code);
  return value;
}
function boolean(value) { if (typeof value !== 'boolean') reject('SCHEMA_BOOLEAN_INVALID'); return value; }
function time(value) { return integer(value, 0, Number.MAX_SAFE_INTEGER, 'SCHEMA_TIME_INVALID'); }
function fresh(observed, expires, now) {
  time(observed); time(expires);
  if (observed > now || expires < observed || expires - observed > MAX_FRESH_MS || expires < now) reject('OBSERVATION_STALE_OR_INVALID');
}
function envelope(input, keys) {
  const value = record(input, ['schema', ...keys]);
  if (value.schema !== 1) reject('SCHEMA_VERSION_INVALID');
  return value;
}
function decision(feature, state, reasons = [], data = {}) {
  return { schema: 1, feature, decision: state, reasonCodes: reasons, actionAllowed: false, ...data };
}
function policy(feature, evaluate) {
  try { return evaluate(); }
  catch (error) {
    // No reflection or property reads on arbitrary thrown input values.
    return decision(feature, 'STOP', [error instanceof PolicyError ? error.code : 'POLICY_INTERNAL_UNPROVEN']);
  }
}

// 1. Verified, fresh context only, bounded by both records and UTF-16 units.
// Returned summaries remain untrusted context, never command authority.
export function retrieveProjectContext(input) {
  return policy('BOUNDED_CONTEXT', () => {
    const value = envelope(input, ['now', 'projectId', 'maxItems', 'maxChars', 'records']);
    const now = time(value.now), projectId = token(value.projectId);
    const maxItems = integer(value.maxItems, 1, 16), maxChars = integer(value.maxChars, 1, 4096);
    const seen = new Set(), eligible = [];
    for (const source of list(value.records, 64)) {
      const item = record(source, ['id', 'projectId', 'revision', 'kind', 'summary', 'summarySha256', 'verified', 'observedAtEpochMs', 'expiresAtEpochMs']);
      token(item.id); token(item.projectId); integer(item.revision, 1, 1_000_000);
      enumeration(item.kind, ['CHECKPOINT', 'DECISION', 'EVIDENCE']); text(item.summary, 512); hash(item.summarySha256); boolean(item.verified);
      time(item.observedAtEpochMs); time(item.expiresAtEpochMs);
      if (seen.has(item.id)) reject('CONTEXT_DUPLICATE_ID');
      seen.add(item.id);
      if (item.projectId !== projectId) reject('PROJECT_IDENTITY_MISMATCH');
      if (digest(item.summary) !== item.summarySha256) reject('CONTEXT_HASH_MISMATCH');
      if (item.observedAtEpochMs > now || item.expiresAtEpochMs < item.observedAtEpochMs
        || item.expiresAtEpochMs - item.observedAtEpochMs > MAX_FRESH_MS) reject('OBSERVATION_STALE_OR_INVALID');
      if (item.verified && item.expiresAtEpochMs >= now) eligible.push(item);
    }
    eligible.sort((a, b) => b.revision - a.revision || b.observedAtEpochMs - a.observedAtEpochMs || compare(a.id, b.id));
    const records = []; let characters = 0;
    for (const item of eligible) if (records.length < maxItems && characters + item.summary.length <= maxChars) {
      records.push({ id: item.id, revision: item.revision, kind: item.kind, summary: item.summary, summarySha256: item.summarySha256 });
      characters += item.summary.length;
    }
    return decision('BOUNDED_CONTEXT', records.length ? 'CONTEXT_READY' : 'UNPROVEN', records.length ? [] : ['NO_VERIFIED_FRESH_CONTEXT'],
      { records, characters, untrustedContext: true });
  });
}

// 2. Suggestions only. No task is started; each proposed action/host needs the
// independent identity, resource, approval and uncertainty gates at execution.
export function scheduleReadyTasks(input) {
  return policy('READY_DAG', () => {
    const value = envelope(input, ['now', 'projectId', 'maxReady', 'tasks']);
    const now = time(value.now), projectId = token(value.projectId), maxReady = integer(value.maxReady, 1, 8);
    const tasks = new Map();
    for (const source of list(value.tasks, 64)) {
      const item = record(source, ['id', 'projectId', 'state', 'dependencies', 'action', 'hostId', 'observedAtEpochMs', 'expiresAtEpochMs']);
      token(item.id); token(item.projectId); enumeration(item.state, ['PENDING', 'RUNNING', 'COMPLETE', 'BLOCKED', 'UNCERTAIN']);
      enumeration(item.action, ACTIONS, 'ACTION_UNSUPPORTED'); enumeration(item.hostId, HOSTS, 'HOST_UNSUPPORTED');
      fresh(item.observedAtEpochMs, item.expiresAtEpochMs, now);
      if (item.projectId !== projectId) reject('PROJECT_IDENTITY_MISMATCH');
      if (tasks.has(item.id)) reject('TASK_DUPLICATE_ID');
      const dependencies = list(item.dependencies, 64).map(id => token(id));
      if (new Set(dependencies).size !== dependencies.length) reject('TASK_DUPLICATE_DEPENDENCY');
      tasks.set(item.id, { ...item, dependencies });
    }
    for (const item of tasks.values()) for (const id of item.dependencies) if (!tasks.has(id)) reject('TASK_DEPENDENCY_MISSING');
    const visited = new Set();
    for (let round = 0; round < tasks.size; round++) {
      for (const item of tasks.values()) if (item.dependencies.every(id => visited.has(id))) visited.add(item.id);
    }
    if (visited.size !== tasks.size) reject('TASK_DAG_CYCLE');
    if ([...tasks.values()].some(item => item.state === 'UNCERTAIN')) return decision('READY_DAG', 'RECONCILE_REQUIRED', ['UNCERTAIN_TASK_NO_RETRY'], { ready: [] });
    const ready = [...tasks.values()].filter(item => item.state === 'PENDING'
      && item.dependencies.every(id => tasks.get(id).state === 'COMPLETE')).sort((a, b) => compare(a.id, b.id)).slice(0, maxReady)
      .map(({ id, action, hostId }) => ({ id, action, hostId }));
    return decision('READY_DAG', ready.length ? 'READY_SUGGESTIONS' : 'WAIT', [], { ready, requiresExecutionGates: true });
  });
}

// 3. Expected waiting is not failure. A stall recommends diagnostics, never
// process termination, restart, chat replay or continuing an uncertain effect.
export function detectProjectStall(input) {
  return policy('STALL_OBSERVATION', () => {
    const value = envelope(input, ['now', 'startedAtEpochMs', 'lastProgressAtEpochMs', 'lastHeartbeatAtEpochMs', 'progressPermille', 'lastProgressPermille', 'state', 'stallAfterMs', 'heartbeatAfterMs']);
    const now = time(value.now), started = time(value.startedAtEpochMs), progress = time(value.lastProgressAtEpochMs), heartbeat = time(value.lastHeartbeatAtEpochMs);
    integer(value.progressPermille, 0, 1000); integer(value.lastProgressPermille, 0, 1000);
    const stallAfter = integer(value.stallAfterMs, 1000, 10_800_000), heartbeatAfter = integer(value.heartbeatAfterMs, 1000, 60_000);
    enumeration(value.state, ['RUNNING', 'WAITING_HUMAN', 'WAITING_EXTERNAL', 'COMPLETE', 'UNCERTAIN']);
    if (started > progress || started > heartbeat || progress > now || heartbeat > now) reject('OBSERVATION_TIME_CONFLICT');
    if (value.progressPermille < value.lastProgressPermille) reject('PROGRESS_REGRESSED');
    if (value.state === 'UNCERTAIN') return decision('STALL_OBSERVATION', 'RECONCILE_REQUIRED', ['UNCERTAIN_TASK_NO_RETRY']);
    if (value.state.startsWith('WAITING_')) return decision('STALL_OBSERVATION', 'EXPECTED_WAIT', [], { restartAllowed: false });
    if (value.state === 'COMPLETE') {
      if (value.progressPermille !== 1000) reject('COMPLETE_PROGRESS_CONFLICT');
      return decision('STALL_OBSERVATION', 'COMPLETE_OBSERVED');
    }
    const reasons = [];
    if (now - heartbeat >= heartbeatAfter) reasons.push('HEARTBEAT_MISSING');
    if (now - progress >= stallAfter) reasons.push('PROGRESS_STALLED');
    return decision('STALL_OBSERVATION', reasons.length ? 'PAUSE_FOR_DIAGNOSTIC' : 'RUNNING_OBSERVED', reasons, { restartAllowed: false });
  });
}

// 4. Fingerprints exclude arbitrary messages/paths/secrets. Third occurrence
// requires history audit and research before another patch or attempt.
export function classifyErrorRecurrence(input) {
  return policy('ERROR_RECURRENCE', () => {
    const value = envelope(input, ['now', 'eventId', 'projectId', 'hostId', 'errorClass', 'gate', 'phase', 'code', 'priorFamilyOccurrences', 'history']);
    const now = time(value.now); token(value.eventId); token(value.projectId); enumeration(value.hostId, HOSTS, 'HOST_UNSUPPORTED');
    enumeration(value.errorClass, ['SOURCE_ADMISSION', 'RESOURCE', 'RUNTIME', 'TRANSPORT', 'UNCERTAIN_EFFECT', 'OTHER']);
    enumeration(value.phase, ['PREFLIGHT', 'RUN', 'POSTCHECK', 'COLLECTOR']);
    if (typeof value.gate !== 'string' || !CODE.test(value.gate) || typeof value.code !== 'string' || !CODE.test(value.code)) reject('ERROR_CODE_INVALID');
    // Trusted adapter must authenticate the counter/history and guarantee the
    // compacted counter excludes these eventIds. This pure function cannot.
    const prior = integer(value.priorFamilyOccurrences, 0, 1_000_000, 'CUMULATIVE_HISTORY_UNPROVEN');
    const fingerprint = digest(JSON.stringify([value.projectId, value.hostId, value.errorClass, value.gate, value.phase, value.code]));
    const familyFingerprint = digest(JSON.stringify([value.projectId, value.errorClass]));
    const seen = new Set([value.eventId]); let occurrences = prior + 1, exactSubmittedOccurrences = 1;
    for (const source of list(value.history, 128)) {
      const item = record(source, ['eventId', 'fingerprint', 'familyFingerprint', 'observedAtEpochMs']);
      token(item.eventId); hash(item.fingerprint); hash(item.familyFingerprint); time(item.observedAtEpochMs);
      if (seen.has(item.eventId)) reject('ERROR_EVENT_DUPLICATE');
      seen.add(item.eventId);
      if (item.observedAtEpochMs > now) reject('OBSERVATION_TIME_CONFLICT');
      if (item.familyFingerprint === familyFingerprint) occurrences++;
      if (item.fingerprint === fingerprint) exactSubmittedOccurrences++;
    }
    const research = occurrences >= 3;
    return decision('ERROR_RECURRENCE', research ? 'DEEP_RESEARCH_REQUIRED' : 'RECORD_AND_DIAGNOSE', research ? ['RECURRENCE_THRESHOLD_REACHED'] : [],
      { fingerprint, familyFingerprint, occurrences, exactSubmittedOccurrences, patchingPaused: research, retryAllowed: false,
        historyScope: 'DECLARED_COMPACTED_COUNTER_PLUS_SUBMITTED_DISTINCT_HISTORY', completeLifetimeHistoryProven: false });
  });
}

// 5. Even confirmed no-effect receipts do not grant a retry authorization.
export function reconcileUncertainEffect(input) {
  return policy('UNCERTAIN_EFFECT', () => {
    const value = envelope(input, ['operationId', 'receiptState', 'effectPossible', 'idempotencyKey', 'authoritativeReceiptSha256', 'receiptOperationId']);
    token(value.operationId); boolean(value.effectPossible); if (value.idempotencyKey !== null) token(value.idempotencyKey);
    hash(value.authoritativeReceiptSha256, true); if (value.receiptOperationId !== null) token(value.receiptOperationId);
    enumeration(value.receiptState, ['UNKNOWN', 'IN_PROGRESS', 'CONFIRMED_SUCCESS', 'CONFIRMED_NOT_APPLIED', 'FAILED_BEFORE_EFFECT']);
    if (['UNKNOWN', 'IN_PROGRESS'].includes(value.receiptState)) {
      if (value.authoritativeReceiptSha256 !== null || value.receiptOperationId !== null) reject('RECEIPT_STATE_CONFLICT');
      return decision('UNCERTAIN_EFFECT', value.receiptState === 'IN_PROGRESS' ? 'WAIT_FOR_RECEIPT' : 'RECONCILE_REQUIRED', ['NO_BLIND_RETRY'], { retryAllowed: false });
    }
    if (value.authoritativeReceiptSha256 === null || value.receiptOperationId !== value.operationId) reject('AUTHORITATIVE_RECEIPT_UNPROVEN');
    if (value.receiptState === 'CONFIRMED_SUCCESS' && !value.effectPossible
      || value.receiptState !== 'CONFIRMED_SUCCESS' && value.effectPossible) reject('RECEIPT_EFFECT_CONFLICT');
    return decision('UNCERTAIN_EFFECT', value.receiptState === 'CONFIRMED_SUCCESS' ? 'COMPLETE_RECEIPT_OBSERVED' : 'NEW_AUTHORIZATION_REQUIRED', [], { retryAllowed: false });
  });
}

// 6. Fixed minimum reserve and CPU ceiling, bounded jobs, human-busy pause.
export function arbitrateResources(input) {
  return policy('RESOURCE_ARBITRATION', () => {
    const value = envelope(input, ['now', 'observedAtEpochMs', 'expiresAtEpochMs', 'hostId', 'humanBusy', 'availableMemoryMiB', 'cpuLoadPermille', 'maxJobs', 'jobs']);
    fresh(value.observedAtEpochMs, value.expiresAtEpochMs, time(value.now));
    enumeration(value.hostId, HOSTS, 'HOST_UNSUPPORTED'); boolean(value.humanBusy);
    const memory = integer(value.availableMemoryMiB, 0, 1_048_576), load = integer(value.cpuLoadPermille, 0, 10_000), maxJobs = integer(value.maxJobs, 1, 4);
    const seen = new Set(), jobs = [];
    for (const source of list(value.jobs, 16)) {
      const item = record(source, ['id', 'hostId', 'kind', 'memoryMiB', 'cpuPermille', 'priority', 'backgroundSafe']);
      token(item.id); enumeration(item.hostId, HOSTS, 'HOST_UNSUPPORTED'); enumeration(item.kind, ['TEST', 'OCR', 'MODEL', 'GAME', 'VIDEO']);
      integer(item.memoryMiB, 1, 65_536); integer(item.cpuPermille, 1, 800); integer(item.priority, 0, 9); boolean(item.backgroundSafe);
      if (item.hostId !== value.hostId) reject('HOST_IDENTITY_MISMATCH');
      if (item.kind === 'VIDEO' && item.hostId !== 'EMAD_WINDOWS') reject('VIDEO_HOST_NOT_AUTHORIZED');
      if (seen.has(item.id)) reject('RESOURCE_JOB_DUPLICATE');
      seen.add(item.id); jobs.push(item);
    }
    if (value.humanBusy) return decision('RESOURCE_ARBITRATION', 'PAUSE_HUMAN_BUSY', ['FOREGROUND_INTERFERENCE_FORBIDDEN'], { selected: [] });
    if (jobs.some(item => !item.backgroundSafe)) return decision('RESOURCE_ARBITRATION', 'PAUSE_UNSAFE_FOREGROUND', ['FOREGROUND_INTERFERENCE_FORBIDDEN'], { selected: [] });
    let remainingMemory = memory - 3072, remainingCpu = 800 - load;
    const selected = [];
    jobs.sort((a, b) => b.priority - a.priority || compare(a.id, b.id));
    for (const item of jobs) if (selected.length < maxJobs && item.memoryMiB <= remainingMemory && item.cpuPermille <= remainingCpu) {
      selected.push(item.id); remainingMemory -= item.memoryMiB; remainingCpu -= item.cpuPermille;
    }
    return decision('RESOURCE_ARBITRATION', selected.length ? 'RESOURCE_SUGGESTIONS_READY' : 'PAUSE_RESOURCE_LIMIT', selected.length ? [] : ['RESOURCE_HEADROOM_REQUIRED'],
      { selected, minimumReserveMiB: 3072, cpuCeilingPermille: 800 });
  });
}

function hostObservations(input) {
  const value = envelope(input, ['now', 'hosts']), now = time(value.now), hosts = list(value.hosts, 3);
  if (hosts.length !== 3) reject('THREE_HOST_SET_REQUIRED');
  const seen = new Set(), reasons = [], result = [];
  for (const source of hosts) {
    const item = record(source, ['hostId', 'connected', 'observedAtEpochMs', 'expiresAtEpochMs', 'expected', 'actual']);
    enumeration(item.hostId, HOSTS, 'HOST_UNSUPPORTED'); boolean(item.connected);
    if (seen.has(item.hostId)) reject('HOST_DUPLICATE');
    seen.add(item.hostId);
    const expected = record(item.expected, ['machineId', 'appId', 'profileId', 'releaseSha256']);
    token(expected.machineId); token(expected.appId); token(expected.profileId); hash(expected.releaseSha256);
    if (!item.connected) {
      if (item.actual !== null || item.observedAtEpochMs !== null || item.expiresAtEpochMs !== null) reject('HOST_DISCONNECTED_EVIDENCE_CONFLICT');
      reasons.push({ hostId: item.hostId, code: 'HOST_IDENTITY_UNPROVEN' }); continue;
    }
    fresh(item.observedAtEpochMs, item.expiresAtEpochMs, now);
    if (item.actual === null) { reasons.push({ hostId: item.hostId, code: 'HOST_IDENTITY_UNPROVEN' }); continue; }
    const actual = record(item.actual, ['machineId', 'appId', 'profileId', 'releaseSha256']);
    for (const field of ['machineId', 'appId', 'profileId']) if (actual[field] !== null) token(actual[field]);
    hash(actual.releaseSha256, true);
    for (const field of ['machineId', 'appId', 'profileId', 'releaseSha256']) {
      if (actual[field] === null) reasons.push({ hostId: item.hostId, code: 'HOST_IDENTITY_UNPROVEN' });
      else if (actual[field] !== expected[field]) reasons.push({ hostId: item.hostId, code: field === 'releaseSha256' ? 'HOST_RELEASE_HASH_MISMATCH' : 'HOST_BINDING_MISMATCH' });
    }
    result.push({ hostId: item.hostId, currentReleaseSha256: actual.releaseSha256 });
  }
  return { now, reasons, hosts: result.sort((a, b) => compare(a.hostId, b.hostId)) };
}
// 7. All three stable tuples, not display names or cached version labels.
export function verifyThreeHostIdentity(input) {
  return policy('THREE_HOST_IDENTITY', () => {
    const proof = hostObservations(input);
    return decision('THREE_HOST_IDENTITY', proof.reasons.length ? 'STOP' : 'IDENTITY_DECLARATIONS_MATCH', [...new Set(proof.reasons.map(item => item.code))],
      { hostFindings: proof.reasons, matchingHostDeclarations: proof.reasons.length ? [] : proof.hosts.map(item => item.hostId), notDeploymentProof: true });
  });
}

// 8. Transactional readiness is only a recommendation. No rollback or upgrade
// is executed, and no recorded test digest is treated as proof of runtime.
export function evaluateUpgradeReadiness(input) {
  return policy('UPGRADE_READINESS', () => {
    const value = envelope(input, ['now', 'hostId', 'identity', 'humanBusy', 'uncertainOperations', 'sourceFreezeSha256', 'candidateSha256', 'testReceipt', 'rollback', 'approval']);
    const now = time(value.now); enumeration(value.hostId, HOSTS, 'HOST_UNSUPPORTED'); boolean(value.humanBusy);
    integer(value.uncertainOperations, 0, 10_000); hash(value.sourceFreezeSha256, true); hash(value.candidateSha256, true);
    const testReceipt = record(value.testReceipt, ['sha256', 'candidateSha256', 'status']);
    hash(testReceipt.sha256, true); hash(testReceipt.candidateSha256, true);
    enumeration(testReceipt.status, ['PASS_SOURCE_TEST_SCOPE_ONLY', 'FAIL', 'UNPROVEN']);
    let approval = null;
    if (value.approval !== null) {
      approval = record(value.approval, ['approvalId', 'hostId', 'sourceFreezeSha256', 'candidateSha256', 'rollbackReleaseSha256', 'expiresAtEpochMs', 'consumed']);
      token(approval.approvalId); enumeration(approval.hostId, HOSTS, 'HOST_UNSUPPORTED'); hash(approval.sourceFreezeSha256);
      hash(approval.candidateSha256); hash(approval.rollbackReleaseSha256); time(approval.expiresAtEpochMs); boolean(approval.consumed);
    }
    const rollback = record(value.rollback, ['releaseSha256', 'configSha256', 'verified']);
    hash(rollback.releaseSha256, true); hash(rollback.configSha256, true); boolean(rollback.verified);
    const identity = hostObservations(value.identity);
    if (identity.now !== now) reject('UPGRADE_IDENTITY_CLOCK_CONFLICT');
    if (identity.reasons.length) return decision('UPGRADE_READINESS', 'STOP', ['HOST_IDENTITY_UNPROVEN_OR_MISMATCH']);
    if (value.humanBusy) return decision('UPGRADE_READINESS', 'PAUSE_HUMAN_BUSY', ['FOREGROUND_INTERFERENCE_FORBIDDEN']);
    if (value.uncertainOperations) return decision('UPGRADE_READINESS', 'RECONCILE_REQUIRED', ['UNCERTAIN_OPERATION_NO_UPGRADE']);
    if (!value.sourceFreezeSha256 || !value.candidateSha256 || !testReceipt.sha256
      || testReceipt.status !== 'PASS_SOURCE_TEST_SCOPE_ONLY' || testReceipt.candidateSha256 !== value.candidateSha256) reject('UPGRADE_SOURCE_OR_TEST_UNPROVEN');
    const currentRelease = identity.hosts.find(item => item.hostId === value.hostId).currentReleaseSha256;
    if (!rollback.verified || rollback.releaseSha256 !== currentRelease || rollback.configSha256 === null) reject('ROLLBACK_UNPROVEN_OR_MISMATCH');
    if (value.candidateSha256 === currentRelease) reject('UPGRADE_NOT_NEW');
    if (approval === null) return decision('UPGRADE_READINESS', 'WAIT_OPERATOR_APPROVAL', ['UPGRADE_APPROVAL_REQUIRED']);
    if (approval.hostId !== value.hostId || approval.sourceFreezeSha256 !== value.sourceFreezeSha256
      || approval.candidateSha256 !== value.candidateSha256 || approval.rollbackReleaseSha256 !== currentRelease) reject('UPGRADE_APPROVAL_SCOPE_MISMATCH');
    if (approval.consumed) reject('UPGRADE_APPROVAL_ALREADY_CONSUMED');
    if (approval.expiresAtEpochMs < now || approval.expiresAtEpochMs - now > MAX_FRESH_MS) reject('UPGRADE_APPROVAL_STALE_OR_INVALID');
    return decision('UPGRADE_READINESS', 'READY_FOR_SEPARATE_EXECUTION_GATE', [], { rollbackRequired: true, runtimeAcceptance: 'UNPROVEN', installationAllowed: false });
  });
}

// 9. Integer budgets; no purchase, paid/premium service or currency API.
export function evaluateBudgetFuse(input) {
  return policy('BUDGET_FUSE', () => {
    const value = envelope(input, ['spentUnits', 'plannedUnits', 'limitUnits', 'spentMs', 'plannedMs', 'timeLimitMs', 'paidServiceRequired', 'purchaseRequired']);
    for (const field of ['spentUnits', 'plannedUnits', 'limitUnits']) integer(value[field], 0, 1_000_000_000);
    for (const field of ['spentMs', 'plannedMs', 'timeLimitMs']) integer(value[field], 0, 86_400_000);
    boolean(value.paidServiceRequired); boolean(value.purchaseRequired);
    if (value.paidServiceRequired || value.purchaseRequired) return decision('BUDGET_FUSE', 'STOP', ['PAID_OPERATION_FORBIDDEN']);
    const reasons = [];
    if (value.spentUnits + value.plannedUnits > value.limitUnits) reasons.push('SPEND_LIMIT_EXCEEDED');
    if (value.spentMs + value.plannedMs > value.timeLimitMs) reasons.push('TIME_LIMIT_EXCEEDED');
    return decision('BUDGET_FUSE', reasons.length ? 'STOP' : 'WITHIN_DECLARED_BUDGET', reasons, { purchasesAllowed: false, premiumAllowed: false });
  });
}

function notificationSnapshot(source) {
  const value = record(source, ['projectId', 'revision', 'status', 'blocker', 'nextAction', 'evidenceSha256']);
  token(value.projectId); integer(value.revision, 1, 1_000_000);
  enumeration(value.status, ['READY', 'RUNNING', 'WAITING', 'STOP', 'COMPLETE', 'UNPROVEN']);
  if (value.blocker !== null && (typeof value.blocker !== 'string' || !CODE.test(value.blocker))) reject('NOTIFICATION_BLOCKER_INVALID');
  if (value.nextAction !== null) enumeration(value.nextAction, ACTIONS, 'ACTION_UNSUPPORTED');
  hash(value.evidenceSha256, true);
  if (value.status === 'STOP' && value.blocker === null || value.status === 'COMPLETE' && value.evidenceSha256 === null) reject('NOTIFICATION_ACCEPTANCE_UNPROVEN');
  return value;
}
// 10. No unchanged-state noise; new evidence alone is not decision value.
export function evaluateMeaningfulNotification(input) {
  return policy('MEANINGFUL_NOTIFICATION', () => {
    const value = envelope(input, ['previous', 'current', 'lastNotificationFingerprint']);
    hash(value.lastNotificationFingerprint, true);
    const current = notificationSnapshot(value.current), previous = value.previous === null ? null : notificationSnapshot(value.previous);
    const fingerprint = digest(JSON.stringify([current.projectId, current.status, current.blocker, current.nextAction, current.evidenceSha256]));
    if (previous) {
      if (previous.projectId !== current.projectId) reject('PROJECT_IDENTITY_MISMATCH');
      if (current.revision < previous.revision) reject('NOTIFICATION_REVISION_REGRESSED');
      if (current.revision === previous.revision && JSON.stringify(current) !== JSON.stringify(previous)) reject('NOTIFICATION_REVISION_CONFLICT');
    }
    const meaningful = previous ? ['status', 'blocker', 'nextAction'].some(field => previous[field] !== current[field])
      : ['STOP', 'COMPLETE'].includes(current.status);
    const emit = meaningful && fingerprint !== value.lastNotificationFingerprint;
    return decision('MEANINGFUL_NOTIFICATION', emit ? 'NOTIFY_RECOMMENDED' : 'SUPPRESS_UNCHANGED_OR_NO_DECISION_VALUE', [],
      { emit, fingerprint, notificationSideEffectPerformed: false });
  });
}
