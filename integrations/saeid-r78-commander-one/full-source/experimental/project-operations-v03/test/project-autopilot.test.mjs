import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PROJECT_AUTOPILOT_MODE, retrieveProjectContext, scheduleReadyTasks, detectProjectStall,
  classifyErrorRecurrence, reconcileUncertainEffect, arbitrateResources, verifyThreeHostIdentity,
  evaluateUpgradeReadiness, evaluateBudgetFuse, evaluateMeaningfulNotification } from '../src/project-autopilot.mjs';

// Synthetic memory-only inputs. No filesystem, OS, process, network, timers,
// device adapters, paid services, model, game/video or installer imports.
const now = 1_000_000, a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64), d = 'd'.repeat(64);
const digest = value => createHash('sha256').update(value).digest('hex');
const stamp = () => ({ observedAtEpochMs: now - 100, expiresAtEpochMs: now + 1000 });
const contextRecord = (id = 'record-a', revision = 1, summary = 'ثبت تصمیم پروژه') => ({ id, projectId: 'project-a', revision,
  kind: 'CHECKPOINT', summary, summarySha256: digest(summary), verified: true, ...stamp() });
const context = () => ({ schema: 1, now, projectId: 'project-a', maxItems: 2, maxChars: 1024, records: [contextRecord()] });
const task = (id = 'task-a', state = 'PENDING', dependencies = []) => ({ id, projectId: 'project-a', state, dependencies,
  action: 'RUN_BOUNDED_TESTS', hostId: 'SAEED_WINDOWS', ...stamp() });
const dag = () => ({ schema: 1, now, projectId: 'project-a', maxReady: 2, tasks: [task()] });
const stall = () => ({ schema: 1, now, startedAtEpochMs: now - 60_000, lastProgressAtEpochMs: now - 10_000,
  lastHeartbeatAtEpochMs: now - 5000, progressPermille: 300, lastProgressPermille: 200, state: 'RUNNING', stallAfterMs: 30_000, heartbeatAfterMs: 15_000 });
const errorInput = () => ({ schema: 1, now, eventId: 'event-current', projectId: 'project-a', hostId: 'SAEED_WINDOWS',
  errorClass: 'RUNTIME', gate: 'CHILD_COMPLETION', phase: 'RUN', code: 'EXIT_FAILURE', priorFamilyOccurrences: 0, history: [] });
const uncertain = () => ({ schema: 1, operationId: 'operation-a', receiptState: 'UNKNOWN', effectPossible: true,
  idempotencyKey: null, authoritativeReceiptSha256: null, receiptOperationId: null });
const job = (id = 'job-a') => ({ id, hostId: 'SAEED_WINDOWS', kind: 'TEST', memoryMiB: 512, cpuPermille: 200, priority: 2, backgroundSafe: true });
const resources = () => ({ schema: 1, now, ...stamp(), hostId: 'SAEED_WINDOWS', humanBusy: false, availableMemoryMiB: 8192,
  cpuLoadPermille: 100, maxJobs: 2, jobs: [job()] });
const identities = () => ({ schema: 1, now, hosts: ['SAEED_WINDOWS', 'EMAD_WINDOWS', 'EMAD_LINUX'].map(hostId => {
  const tuple = { machineId: 'fixture-machine-' + hostId, appId: 'fixture-app-' + hostId, profileId: 'fixture-profile', releaseSha256: a };
  return { hostId, connected: true, ...stamp(), expected: { ...tuple }, actual: { ...tuple } };
}) });
const upgrade = () => ({ schema: 1, now, hostId: 'SAEED_WINDOWS', identity: identities(), humanBusy: false, uncertainOperations: 0,
  sourceFreezeSha256: c, candidateSha256: d, testReceipt: { sha256: b, candidateSha256: d, status: 'PASS_SOURCE_TEST_SCOPE_ONLY' },
  rollback: { releaseSha256: a, configSha256: b, verified: true },
  approval: { approvalId: 'approval-a', hostId: 'SAEED_WINDOWS', sourceFreezeSha256: c, candidateSha256: d,
    rollbackReleaseSha256: a, expiresAtEpochMs: now + 1000, consumed: false } });
const budget = () => ({ schema: 1, spentUnits: 1, plannedUnits: 2, limitUnits: 3, spentMs: 100, plannedMs: 200, timeLimitMs: 300,
  paidServiceRequired: false, purchaseRequired: false });
const snap = (revision = 1, status = 'RUNNING') => ({ projectId: 'project-a', revision, status, blocker: null, nextAction: 'RUN_BOUNDED_TESTS', evidenceSha256: a });
const notification = () => ({ schema: 1, previous: snap(), current: { ...snap(2, 'STOP'), blocker: 'OWNER_APPROVAL_REQUIRED' }, lastNotificationFingerprint: null });
const stop = (result, reason = null) => {
  assert.equal(result.decision, 'STOP'); assert.equal(result.actionAllowed, false);
  if (reason) assert.ok(result.reasonCodes.includes(reason), JSON.stringify(result));
};
const cases = [
  ['BOUNDED_CONTEXT', retrieveProjectContext, context, 'CONTEXT_READY'],
  ['READY_DAG', scheduleReadyTasks, dag, 'READY_SUGGESTIONS'],
  ['STALL_OBSERVATION', detectProjectStall, stall, 'RUNNING_OBSERVED'],
  ['ERROR_RECURRENCE', classifyErrorRecurrence, errorInput, 'RECORD_AND_DIAGNOSE'],
  ['UNCERTAIN_EFFECT', reconcileUncertainEffect, uncertain, 'RECONCILE_REQUIRED'],
  ['RESOURCE_ARBITRATION', arbitrateResources, resources, 'RESOURCE_SUGGESTIONS_READY'],
  ['THREE_HOST_IDENTITY', verifyThreeHostIdentity, identities, 'IDENTITY_DECLARATIONS_MATCH'],
  ['UPGRADE_READINESS', evaluateUpgradeReadiness, upgrade, 'READY_FOR_SEPARATE_EXECUTION_GATE'],
  ['BUDGET_FUSE', evaluateBudgetFuse, budget, 'WITHIN_DECLARED_BUDGET'],
  ['MEANINGFUL_NOTIFICATION', evaluateMeaningfulNotification, notification, 'NOTIFY_RECOMMENDED']
];

test('mode is policy-only and every positive output remains finite JSON with no execution grant', () => {
  assert.equal(PROJECT_AUTOPILOT_MODE, 'PURE_POLICY_ONLY_NOT_INSTALLED');
  for (const [feature, evaluate, fixture, expected] of cases) {
    const input = fixture(), before = JSON.stringify(input), result = evaluate(input);
    assert.equal(result.feature, feature); assert.equal(result.decision, expected); assert.equal(result.actionAllowed, false);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result); assert.equal(JSON.stringify(input), before);
  }
});
for (const [feature, evaluate, fixture] of cases) {
  test(`${feature} rejects missing unknown hidden symbol accessor prototype and proxy records without executing hooks`, () => {
    let hooks = 0;
    const missing = fixture(); delete missing.schema;
    const hidden = fixture(); Object.defineProperty(hidden, 'hidden', { value: true, enumerable: false });
    const symbol = fixture(); symbol[Symbol('unsafe')] = true;
    const getter = fixture(); Object.defineProperty(getter, 'schema', { enumerable: true, get() { hooks++; throw new Error('GETTER_EXECUTED'); } });
    const inherited = Object.create({ get schema() { hooks++; throw new Error('PROTOTYPE_GETTER_EXECUTED'); } });
    const proxy = new Proxy(fixture(), { get() { hooks++; throw new Error('GET_TRAP'); }, ownKeys() { hooks++; throw new Error('KEY_TRAP'); }, getPrototypeOf() { hooks++; throw new Error('PROTOTYPE_TRAP'); } });
    const revoked = Proxy.revocable(fixture(), {}); revoked.revoke();
    for (const input of [undefined, null, missing, { ...fixture(), command: 'execute' }, { ...fixture(), schema: 2 }, hidden, symbol, getter, inherited, proxy, revoked.proxy]) stop(evaluate(input));
    assert.equal(hooks, 0);
  });
}

test('context selects recent verified rows within exact item and character caps', () => {
  const input = context(); input.records = [contextRecord('old', 1, 'one'), contextRecord('new', 3, 'three'), contextRecord('middle', 2, 'two')];
  input.maxItems = 2; input.maxChars = 5;
  const result = retrieveProjectContext(input); assert.deepEqual(result.records.map(item => item.id), ['new']); assert.equal(result.characters, 5); assert.equal(result.untrustedContext, true);
});
test('context excludes stale or unverified rows rather than inventing a checkpoint', () => {
  const input = context(); input.records[0].verified = false;
  assert.equal(retrieveProjectContext(input).decision, 'UNPROVEN');
  input.records[0].verified = true; input.records[0].expiresAtEpochMs = now - 1;
  assert.equal(retrieveProjectContext(input).decision, 'UNPROVEN');
});
test('context rejects other-project records duplicate IDs digest mismatch and malformed Unicode', () => {
  for (const change of [{ projectId: 'project-other' }, { summarySha256: a }, { summary: '\ud800', summarySha256: digest('\ud800') },
    { summary: 'x\u202ey', summarySha256: digest('x\u202ey') }]) {
    const input = context(); Object.assign(input.records[0], change); stop(retrieveProjectContext(input));
  }
  const duplicate = context(); duplicate.records.push(contextRecord()); stop(retrieveProjectContext(duplicate), 'CONTEXT_DUPLICATE_ID');
});
test('nested array getters proxies holes extras and over-cap lengths fail without hooks', () => {
  let hooks = 0;
  const getter = [contextRecord()]; Object.defineProperty(getter, '0', { enumerable: true, get() { hooks++; throw new Error('ARRAY_GETTER'); } });
  const proxy = new Proxy([contextRecord()], { get() { hooks++; throw new Error('ARRAY_TRAP'); }, ownKeys() { hooks++; throw new Error('ARRAY_KEYS'); } });
  const extra = [contextRecord()]; extra.command = 'execute';
  const symbol = [contextRecord()]; symbol[Symbol('extra')] = 1;
  for (const records of [getter, proxy, new Array(1), extra, symbol, Array.from({ length: 65 }, () => contextRecord())]) stop(retrieveProjectContext({ ...context(), records }));
  assert.equal(hooks, 0);
});
test('DAG schedules only pending tasks whose exact dependencies completed', () => {
  const input = dag(); input.tasks = [task('a', 'COMPLETE'), task('b', 'PENDING', ['a']), task('c', 'PENDING', ['b'])];
  assert.deepEqual(scheduleReadyTasks(input).ready.map(item => item.id), ['b']);
  input.tasks[0].state = 'RUNNING'; assert.equal(scheduleReadyTasks(input).decision, 'WAIT');
});
test('DAG rejects cycles missing duplicate dependencies and unsupported executable actions', () => {
  for (const tasks of [[task('a', 'PENDING', ['a'])], [task('a', 'PENDING', ['b']), task('b', 'PENDING', ['a'])],
    [task('a', 'PENDING', ['missing'])], [task('a', 'COMPLETE'), task('b', 'PENDING', ['a', 'a'])], [{ ...task(), action: 'SHELL' }]]) {
    stop(scheduleReadyTasks({ ...dag(), tasks }));
  }
});
test('DAG stops cross-project stale identities and recommends reconciliation for uncertain tasks', () => {
  stop(scheduleReadyTasks({ ...dag(), tasks: [{ ...task(), projectId: 'other' }] }), 'PROJECT_IDENTITY_MISMATCH');
  stop(scheduleReadyTasks({ ...dag(), tasks: [{ ...task(), expiresAtEpochMs: now - 1 }] }), 'OBSERVATION_STALE_OR_INVALID');
  const result = scheduleReadyTasks({ ...dag(), tasks: [task('a', 'UNCERTAIN'), task('b')] });
  assert.equal(result.decision, 'RECONCILE_REQUIRED'); assert.deepEqual(result.ready, []);
});
test('stall reports exact threshold diagnostics but never recommends restarting', () => {
  const input = stall(); input.lastProgressAtEpochMs = now - input.stallAfterMs; input.lastHeartbeatAtEpochMs = now - input.heartbeatAfterMs;
  const result = detectProjectStall(input); assert.equal(result.decision, 'PAUSE_FOR_DIAGNOSTIC');
  assert.deepEqual(result.reasonCodes, ['HEARTBEAT_MISSING', 'PROGRESS_STALLED']); assert.equal(result.restartAllowed, false);
});
test('stall treats human and external waiting as expected and uncertainty as no-retry', () => {
  for (const state of ['WAITING_HUMAN', 'WAITING_EXTERNAL']) assert.equal(detectProjectStall({ ...stall(), state }).decision, 'EXPECTED_WAIT');
  assert.equal(detectProjectStall({ ...stall(), state: 'UNCERTAIN' }).decision, 'RECONCILE_REQUIRED');
});
test('stall rejects future timestamps regressed progress and false complete claims', () => {
  for (const change of [{ lastHeartbeatAtEpochMs: now + 1 }, { progressPermille: 100 }, { state: 'COMPLETE' }, { now: NaN }]) stop(detectProjectStall({ ...stall(), ...change }));
  assert.equal(detectProjectStall({ ...stall(), state: 'COMPLETE', progressPermille: 1000 }).decision, 'COMPLETE_OBSERVED');
});
test('third same fingerprint triggers deep research and stops patching before a retry', () => {
  const input = errorInput(), { fingerprint, familyFingerprint } = classifyErrorRecurrence(input);
  input.history = [{ eventId: 'old1', fingerprint, familyFingerprint, observedAtEpochMs: now - 10 }, { eventId: 'old2', fingerprint, familyFingerprint, observedAtEpochMs: now - 5 }];
  const result = classifyErrorRecurrence(input); assert.equal(result.decision, 'DEEP_RESEARCH_REQUIRED'); assert.equal(result.occurrences, 3);
  assert.equal(result.patchingPaused, true); assert.equal(result.retryAllowed, false);
});
test('recurrence retains old same-family events excludes different families and rejects duplicate or future events', () => {
  const input = errorInput(), { fingerprint, familyFingerprint } = classifyErrorRecurrence(input);
  input.history = [{ eventId: 'old', fingerprint, familyFingerprint, observedAtEpochMs: now - 60_001 },
    { eventId: 'other', fingerprint: b, familyFingerprint: b, observedAtEpochMs: now - 1 }];
  assert.equal(classifyErrorRecurrence(input).occurrences, 2);
  input.history = [{ eventId: input.eventId, fingerprint, familyFingerprint, observedAtEpochMs: now - 1 }]; stop(classifyErrorRecurrence(input), 'ERROR_EVENT_DUPLICATE');
  input.history = [{ eventId: 'future', fingerprint, familyFingerprint, observedAtEpochMs: now + 1 }]; stop(classifyErrorRecurrence(input), 'OBSERVATION_TIME_CONFLICT');
});
test('uncertain lost acknowledgements and in-progress receipts never permit replay', () => {
  const result = reconcileUncertainEffect(uncertain()); assert.equal(result.decision, 'RECONCILE_REQUIRED'); assert.equal(result.retryAllowed, false);
  assert.equal(reconcileUncertainEffect({ ...uncertain(), receiptState: 'IN_PROGRESS' }).decision, 'WAIT_FOR_RECEIPT');
});
test('confirmed effect receipts require exact operation and digest yet no-effect needs new authority', () => {
  const confirmed = { ...uncertain(), receiptState: 'CONFIRMED_SUCCESS', authoritativeReceiptSha256: a, receiptOperationId: 'operation-a' };
  assert.equal(reconcileUncertainEffect(confirmed).decision, 'COMPLETE_RECEIPT_OBSERVED');
  stop(reconcileUncertainEffect({ ...confirmed, receiptOperationId: 'other' }), 'AUTHORITATIVE_RECEIPT_UNPROVEN');
  stop(reconcileUncertainEffect({ ...confirmed, authoritativeReceiptSha256: null }), 'AUTHORITATIVE_RECEIPT_UNPROVEN');
  stop(reconcileUncertainEffect({ ...confirmed, effectPossible: false }), 'RECEIPT_EFFECT_CONFLICT');
  const noEffect = reconcileUncertainEffect({ ...confirmed, receiptState: 'CONFIRMED_NOT_APPLIED', effectPossible: false });
  assert.equal(noEffect.decision, 'NEW_AUTHORIZATION_REQUIRED'); assert.equal(noEffect.retryAllowed, false);
});
test('resources choose a deterministic bounded batch and preserve minimum headroom', () => {
  const input = resources(); input.jobs = [job('b'), { ...job('a'), priority: 9 }, job('c')]; input.availableMemoryMiB = 4096;
  const result = arbitrateResources(input); assert.deepEqual(result.selected, ['a', 'b']); assert.equal(result.minimumReserveMiB, 3072); assert.equal(result.cpuCeilingPermille, 800);
});
test('resources pause while human busy foreground unsafe or memory and CPU unavailable', () => {
  assert.equal(arbitrateResources({ ...resources(), humanBusy: true }).decision, 'PAUSE_HUMAN_BUSY');
  assert.equal(arbitrateResources({ ...resources(), jobs: [{ ...job(), backgroundSafe: false }] }).decision, 'PAUSE_UNSAFE_FOREGROUND');
  for (const change of [{ availableMemoryMiB: 3072 }, { cpuLoadPermille: 800 }]) assert.equal(arbitrateResources({ ...resources(), ...change }).decision, 'PAUSE_RESOURCE_LIMIT');
});
test('resources reject stale observations different hosts and both non-Emad-Windows video hosts without fallback', () => {
  stop(arbitrateResources({ ...resources(), expiresAtEpochMs: now - 1 }), 'OBSERVATION_STALE_OR_INVALID');
  stop(arbitrateResources({ ...resources(), jobs: [{ ...job(), hostId: 'EMAD_WINDOWS' }] }), 'HOST_IDENTITY_MISMATCH');
  stop(arbitrateResources({ ...resources(), jobs: [{ ...job(), kind: 'VIDEO' }] }), 'VIDEO_HOST_NOT_AUTHORIZED');
  stop(arbitrateResources({ ...resources(), hostId: 'EMAD_LINUX', jobs: [{ ...job(), hostId: 'EMAD_LINUX', kind: 'VIDEO' }] }), 'VIDEO_HOST_NOT_AUTHORIZED');
});
test('three-host identity needs exact fresh stable tuples and release hashes not display names', () => {
  const result = verifyThreeHostIdentity(identities()); assert.equal(result.matchingHostDeclarations.length, 3); assert.equal(result.notDeploymentProof, true);
  const mismatch = identities(); mismatch.hosts[1].actual.releaseSha256 = b; stop(verifyThreeHostIdentity(mismatch), 'HOST_RELEASE_HASH_MISMATCH');
  const renamed = identities(); renamed.hosts[0].displayName = 'Renamed host'; stop(verifyThreeHostIdentity(renamed), 'SCHEMA_KEYS_INVALID');
});
test('missing Emad connection unknown app identity duplicates and stale host evidence stop', () => {
  const missing = identities(); Object.assign(missing.hosts[1], { connected: false, actual: null, observedAtEpochMs: null, expiresAtEpochMs: null });
  stop(verifyThreeHostIdentity(missing), 'HOST_IDENTITY_UNPROVEN');
  const unknown = identities(); unknown.hosts[1].actual.appId = null; stop(verifyThreeHostIdentity(unknown), 'HOST_IDENTITY_UNPROVEN');
  const duplicate = identities(); duplicate.hosts[2] = duplicate.hosts[1]; stop(verifyThreeHostIdentity(duplicate), 'HOST_DUPLICATE');
  const stale = identities(); stale.hosts[2].expiresAtEpochMs = now - 1; stop(verifyThreeHostIdentity(stale), 'OBSERVATION_STALE_OR_INVALID');
});
test('upgrade readiness remains advisory and human-busy or uncertain operations cannot install', () => {
  const result = evaluateUpgradeReadiness(upgrade()); assert.equal(result.decision, 'READY_FOR_SEPARATE_EXECUTION_GATE');
  assert.equal(result.installationAllowed, false); assert.equal(result.runtimeAcceptance, 'UNPROVEN'); assert.equal(result.rollbackRequired, true);
  assert.equal(evaluateUpgradeReadiness({ ...upgrade(), humanBusy: true }).decision, 'PAUSE_HUMAN_BUSY');
  assert.equal(evaluateUpgradeReadiness({ ...upgrade(), uncertainOperations: 1 }).decision, 'RECONCILE_REQUIRED');
});
test('upgrade rejects unproven tests wrong candidate rollback and missing host proof', () => {
  const noProof = upgrade(); noProof.sourceFreezeSha256 = null; stop(evaluateUpgradeReadiness(noProof), 'UPGRADE_SOURCE_OR_TEST_UNPROVEN');
  const wrongTest = upgrade(); wrongTest.testReceipt.candidateSha256 = b; stop(evaluateUpgradeReadiness(wrongTest), 'UPGRADE_SOURCE_OR_TEST_UNPROVEN');
  const failed = upgrade(); failed.testReceipt.status = 'FAIL'; stop(evaluateUpgradeReadiness(failed), 'UPGRADE_SOURCE_OR_TEST_UNPROVEN');
  const wrongRollback = upgrade(); wrongRollback.rollback.releaseSha256 = b; stop(evaluateUpgradeReadiness(wrongRollback), 'ROLLBACK_UNPROVEN_OR_MISMATCH');
  const missingHost = upgrade(); missingHost.identity.hosts[2].actual = null; stop(evaluateUpgradeReadiness(missingHost), 'HOST_IDENTITY_UNPROVEN_OR_MISMATCH');
});
test('upgrade approval must bind host freeze candidate rollback fresh expiry and unused receipt', () => {
  assert.equal(evaluateUpgradeReadiness({ ...upgrade(), approval: null }).decision, 'WAIT_OPERATOR_APPROVAL');
  for (const change of [{ hostId: 'EMAD_WINDOWS' }, { sourceFreezeSha256: b }, { candidateSha256: b }, { rollbackReleaseSha256: b },
    { expiresAtEpochMs: now - 1 }, { expiresAtEpochMs: now + 300_001 }, { consumed: true }]) {
    const input = upgrade(); Object.assign(input.approval, change); stop(evaluateUpgradeReadiness(input));
  }
});
test('budget supports exact limit and fuses spend time purchase and premium independently', () => {
  assert.equal(evaluateBudgetFuse(budget()).decision, 'WITHIN_DECLARED_BUDGET');
  for (const change of [{ plannedUnits: 3 }, { plannedMs: 201 }, { paidServiceRequired: true }, { purchaseRequired: true }]) stop(evaluateBudgetFuse({ ...budget(), ...change }));
  for (const change of [{ plannedUnits: NaN }, { spentMs: -1 }, { limitUnits: Number.MAX_SAFE_INTEGER }]) stop(evaluateBudgetFuse({ ...budget(), ...change }));
});
test('notification suppresses unchanged progress metadata and evidence-only churn', () => {
  const input = notification(); input.current = snap(2); assert.equal(evaluateMeaningfulNotification(input).emit, false);
  input.current.evidenceSha256 = b; assert.equal(evaluateMeaningfulNotification(input).emit, false);
  input.previous = null; input.current = snap(); assert.equal(evaluateMeaningfulNotification(input).emit, false);
});
test('notification emits meaningful new blocker once and does not perform the notification', () => {
  const input = notification(), first = evaluateMeaningfulNotification(input); assert.equal(first.emit, true); assert.equal(first.notificationSideEffectPerformed, false);
  input.lastNotificationFingerprint = first.fingerprint; assert.equal(evaluateMeaningfulNotification(input).emit, false);
});
test('notification rejects project switches revision conflicts and unsupported actions or acceptance', () => {
  for (const change of [{ projectId: 'other' }, { revision: 0 }, { revision: 1 }, { nextAction: 'INSTALL' }, { status: 'COMPLETE', evidenceSha256: null }]) {
    const input = notification(); Object.assign(input.current, change); stop(evaluateMeaningfulNotification(input));
  }
});
test('all policies reject functions inherited state cyclic schema and wrong numeric types without mutation', () => {
  for (const [, evaluate, fixture] of cases) {
    stop(evaluate(() => fixture()));
    const nullPrototype = Object.assign(Object.create(null), fixture()); assert.equal(evaluate(nullPrototype).actionAllowed, false);
    const cyclic = fixture(); cyclic.unknown = cyclic; stop(evaluate(cyclic));
    const frozen = Object.freeze(fixture()); assert.equal(evaluate(frozen).actionAllowed, false);
  }
});
test('R2 old family events across hosts gates phases and codes still trigger third-occurrence research', () => {
  const input = errorInput(), current = classifyErrorRecurrence(input);
  const other = classifyErrorRecurrence({ ...errorInput(), hostId: 'EMAD_WINDOWS', gate: 'OTHER_GATE', phase: 'PREFLIGHT', code: 'OTHER_CODE' });
  assert.notEqual(other.fingerprint, current.fingerprint); assert.equal(other.familyFingerprint, current.familyFingerprint);
  input.history = [{ eventId: 'old-a', fingerprint: other.fingerprint, familyFingerprint: other.familyFingerprint, observedAtEpochMs: 0 },
    { eventId: 'old-b', fingerprint: other.fingerprint, familyFingerprint: other.familyFingerprint, observedAtEpochMs: now - 60_001 }];
  const result = classifyErrorRecurrence(input); assert.equal(result.occurrences, 3); assert.equal(result.exactSubmittedOccurrences, 1);
  assert.equal(result.decision, 'DEEP_RESEARCH_REQUIRED'); assert.equal(result.patchingPaused, true); assert.equal(result.retryAllowed, false);
});
test('R2 declared compacted family counter survives bounded retrieval and never certifies lifetime completeness', () => {
  const result = classifyErrorRecurrence({ ...errorInput(), priorFamilyOccurrences: 2 });
  assert.equal(result.occurrences, 3); assert.equal(result.decision, 'DEEP_RESEARCH_REQUIRED');
  assert.equal(result.completeLifetimeHistoryProven, false);
  assert.equal(result.historyScope, 'DECLARED_COMPACTED_COUNTER_PLUS_SUBMITTED_DISTINCT_HISTORY');
  const input = errorInput(), proof = classifyErrorRecurrence(input); input.priorFamilyOccurrences = 1;
  input.history = [{ eventId: 'old-a', fingerprint: proof.fingerprint, familyFingerprint: proof.familyFingerprint, observedAtEpochMs: 0 }];
  assert.equal(classifyErrorRecurrence(input).occurrences, 3);
});
test('R2 old window overrides and missing unknown negative or fractional counters cannot reset recurrence', () => {
  stop(classifyErrorRecurrence({ ...errorInput(), windowMs: 1 }), 'SCHEMA_KEYS_INVALID');
  const missing = errorInput(); delete missing.priorFamilyOccurrences; stop(classifyErrorRecurrence(missing), 'SCHEMA_KEYS_INVALID');
  for (const priorFamilyOccurrences of [null, -1, 0.5, NaN, 1_000_001]) {
    stop(classifyErrorRecurrence({ ...errorInput(), priorFamilyOccurrences }), 'CUMULATIVE_HISTORY_UNPROVEN');
  }
});
test('R2 historical family records reject nested getters and proxies before hooks', () => {
  const input = errorInput(), proof = classifyErrorRecurrence(input); let hooks = 0;
  const item = { eventId: 'old-a', fingerprint: proof.fingerprint, familyFingerprint: proof.familyFingerprint, observedAtEpochMs: 0 };
  const getter = { ...item }; Object.defineProperty(getter, 'familyFingerprint', { enumerable: true, get() { hooks++; throw new Error('GETTER'); } });
  const proxy = new Proxy(item, { ownKeys() { hooks++; throw new Error('KEYS'); }, getPrototypeOf() { hooks++; throw new Error('PROTOTYPE'); } });
  const array = new Proxy([item], { ownKeys() { hooks++; throw new Error('ARRAY_KEYS'); }, getPrototypeOf() { hooks++; throw new Error('ARRAY_PROTOTYPE'); } });
  for (const history of [[getter], [proxy], array]) stop(classifyErrorRecurrence({ ...input, history }));
  assert.equal(hooks, 0);
});
test('R2 different project or error family cannot count as the current recurrence family', () => {
  const input = errorInput();
  const otherProject = classifyErrorRecurrence({ ...input, projectId: 'project-other' });
  const otherClass = classifyErrorRecurrence({ ...input, errorClass: 'RESOURCE' });
  input.history = [otherProject, otherClass].map((proof, index) => ({ eventId: 'other-' + index, fingerprint: proof.fingerprint,
    familyFingerprint: proof.familyFingerprint, observedAtEpochMs: 0 }));
  assert.equal(classifyErrorRecurrence(input).occurrences, 1);
});
test('R2 exactly128 supplied historical events are bounded and event129 is fail-closed', () => {
  const input = errorInput(), proof = classifyErrorRecurrence(input);
  input.history = Array.from({ length: 128 }, (_, index) => ({ eventId: 'event-' + index, fingerprint: proof.fingerprint,
    familyFingerprint: proof.familyFingerprint, observedAtEpochMs: 0 }));
  const result = classifyErrorRecurrence(input); assert.equal(result.occurrences, 129); assert.equal(result.decision, 'DEEP_RESEARCH_REQUIRED');
  input.history.push({ eventId: 'overflow', fingerprint: proof.fingerprint, familyFingerprint: proof.familyFingerprint, observedAtEpochMs: 0 });
  stop(classifyErrorRecurrence(input), 'SCHEMA_ARRAY_BOUNDS');
});
test('R2 video resource suggestions are restricted exactly to Emad Windows and still pause for human activity', () => {
  for (const hostId of ['SAEED_WINDOWS', 'EMAD_LINUX']) stop(arbitrateResources({ ...resources(), hostId,
    jobs: [{ ...job(), hostId, kind: 'VIDEO' }] }), 'VIDEO_HOST_NOT_AUTHORIZED');
  const input = { ...resources(), hostId: 'EMAD_WINDOWS', jobs: [{ ...job(), hostId: 'EMAD_WINDOWS', kind: 'VIDEO' }] };
  const result = arbitrateResources(input); assert.equal(result.decision, 'RESOURCE_SUGGESTIONS_READY'); assert.equal(result.actionAllowed, false);
  assert.equal(arbitrateResources({ ...input, humanBusy: true }).decision, 'PAUSE_HUMAN_BUSY');
});
