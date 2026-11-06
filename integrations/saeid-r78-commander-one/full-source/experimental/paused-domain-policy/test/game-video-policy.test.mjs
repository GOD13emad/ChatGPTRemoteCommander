import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evaluateGameAction, evaluateVideoAction, MEDIA_POLICY_LIMITS } from '../src/game-video-policy.mjs';

const now = 1900000000000, sha = 'a'.repeat(64), proof = 'b'.repeat(64);
const assetHash = assets => createHash('sha256').update(JSON.stringify(assets.map(({ id, sha256, bytes }) => ({ id, sha256, bytes }))
  .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0))).digest('hex');
function game() {
  const target = { owner: 'saeed', platform: 'win32', hostId: 'fixture-saeed-windows', deviceId: 'fixture-device', adapterId: 'fixture-adapter',
    configSha256: sha, appId: 'fixture.game', accountId: 'fixture-account', instanceId: 'fixture-instance' };
  return { now, target, observation: { ...target, observedAt: now - 100, expiresAt: now + 900, frameSha256: sha,
    frameSequence: 7, inputEpoch: 3, hostVerified: true, accountOwnedVerified: true, instanceVerified: true, adapterCallable: true, receiptAuthenticated: true },
    control: { sessionId: 'fixture-session', leaseId: 'fixture-lease', leaseHostId: target.hostId, leaseAccountId: target.accountId, leaseInstanceId: target.instanceId,
      leaseExpiresAt: now + 30000, leaseVerified: true, stopRequested: false, pauseRequested: false, userActive: false,
      foregroundOwned: true, backgroundIsolationVerified: true, inputLeaseVerified: true, budgetRevision: 4,
      budgetActions: 10, usedActions: 2, budgetMs: 60000, usedMs: 1000, deadlineAt: now + 60000 },
    ledger: { actionId: 'fixture-action', sessionId: 'fixture-session', leaseId: 'fixture-lease', budgetRevision: 4, outcome: 'NOT_STARTED', attemptCount: 0, reserved: false },
    action: { actionId: 'fixture-action', kind: 'COLLECT_FREE', expectedFrameSha256: sha, expectedFrameSequence: 7, expectedInputEpoch: 3, durationMs: 1000 },
    game: { publisher: 'fixture-publisher', publisherVerified: true, appId: target.appId, accountId: target.accountId, instanceId: target.instanceId,
      automationPermission: 'ALLOWED', termsSha256: proof, observedAt: now - 100, expiresAt: now + 29000,
      cost: { actionId: 'fixture-action', frameSha256: sha, moneyMinor: 0, premiumUnits: 0, resourceUnits: 0, verified: true } } };
}
function video() {
  const data = game(); delete data.game;
  data.target.owner = 'emad'; data.target.hostId = 'fixture-emad-windows'; data.target.appId = 'fixture.video';
  Object.assign(data.observation, data.target); data.control.leaseHostId = data.target.hostId;
  Object.assign(data.action, { kind: 'RENDER', providerId: 'fixture-local-free', outputName: 'fixture-output.mp4', maxOutputBytes: 1048576,
    maxFrames: 120, width: 1280, height: 720 });
  data.provider = { id: data.action.providerId, mode: 'LOCAL_FREE', hostId: data.target.hostId, accountId: data.target.accountId,
    instanceId: data.target.instanceId, verified: true, unitPriceMinor: 0, premiumRequired: false, paymentsEnabled: false,
    paidConsent: false, proofSha256: proof, observedAt: now - 100, expiresAt: now + 29000 };
  data.workspace = { owner: 'emad', hostId: data.target.hostId, canonicalRoot: 'C:\\fixture-output', dev: '123', ino: '456',
    verified: true, noReparse: true, outputName: data.action.outputName, outputAbsentVerified: true, availableBytes: 1073741824,
    observedAt: now - 100, expiresAt: now + 29000 };
  data.assets = [{ id: 'fixture-asset', sha256: sha, bytes: 100, rights: 'OWNED', rightsProofSha256: proof, rightsVerified: true,
    derivativeUseAllowed: true, personsConsentVerified: true, sourceHostId: data.target.hostId, observedAt: now - 100, expiresAt: now + 29000 }];
  data.action.assetSetSha256 = assetHash(data.assets); return data;
}
function denied(evaluate, data, expected) { const result = evaluate(data); assert.equal(result.status, 'DENY'); assert.equal(result.code, expected);
  assert.equal(result.executionGranted, false); assert.equal(result.effectsPerformed, false); return result; }

test('game accepts zero-cost publisher-permitted synthetic Windows facts for Saeed and Emad without execution authority', () => {
  for (const owner of ['saeed', 'emad']) {
    const data = game(); data.target.owner = owner; data.observation.owner = owner;
    const result = evaluateGameAction(data); assert.equal(result.status, 'ADMIT'); assert.equal(result.stage, 'PURE_POLICY_ONLY');
    assert.equal(result.executionGranted, false); assert.equal(result.effectsPerformed, false); assert.equal(result.recheckRequired, true);
    assert.equal(result.reservationProposal.expectedBudgetRevision, 4); assert.equal(result.reservationProposal.proposedUsedActions, 3);
    assert.equal(data.control.usedActions, 2); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.reservationProposal));
  }
});
test('game rejects Linux or unknown owner scope', () => {
  for (const change of [{ platform: 'linux' }, { owner: 'other' }]) {
    const data = game(); Object.assign(data.target, change); Object.assign(data.observation, change); denied(evaluateGameAction, data, 'TARGET_SCOPE_DENIED');
  }
});
test('fresh exact host device adapter config app account and instance bindings cannot drift', () => {
  for (const key of ['owner', 'platform', 'hostId', 'deviceId', 'adapterId', 'configSha256', 'appId', 'accountId', 'instanceId']) {
    const data = game(); data.observation[key] = key === 'configSha256' ? proof : 'changed'; denied(evaluateGameAction, data, 'BINDING_MISMATCH');
  }
});
test('unverified ownership account instance authentication and unavailable adapter cannot self-admit', () => {
  for (const key of ['hostVerified', 'accountOwnedVerified', 'instanceVerified', 'adapterCallable', 'receiptAuthenticated']) {
    const data = game(); data.observation[key] = false; denied(evaluateGameAction, data, 'VERIFIED_ADAPTER_REQUIRED');
  }
});
test('expired future backwards and excessive frame lifetime proofs fail closed', () => {
  for (const change of [{ expiresAt: now }, { observedAt: now + 1 }, { observedAt: now - 2000, expiresAt: now + 1 }, { expiresAt: now + 2000 }]) {
    const data = game(); Object.assign(data.observation, change); denied(evaluateGameAction, data, 'STALE_OR_BACKWARDS_PROOF');
  }
});
test('exact frame hash sequence and input epoch are re-bound per action', () => {
  for (const [key, value] of [['expectedFrameSha256', proof], ['expectedFrameSequence', 8], ['expectedInputEpoch', 4]]) {
    const data = game(); data.action[key] = value; denied(evaluateGameAction, data, 'BINDING_MISMATCH');
  }
});
test('user STOP and pause override otherwise-valid game and video requests', () => {
  for (const [build, evaluate] of [[game, evaluateGameAction], [video, evaluateVideoAction]]) for (const [key, code] of [['stopRequested', 'USER_STOP'], ['pauseRequested', 'USER_PAUSE']]) {
    const data = build(); data.control[key] = true; denied(evaluate, data, code);
  }
});
test('foreground interference or lost input lease rejects mutable game actions while read-only coaching remains non-input', () => {
  for (const change of [{ userActive: true }, { foregroundOwned: false }, { inputLeaseVerified: false }]) {
    const data = game(); Object.assign(data.control, change); denied(evaluateGameAction, data, 'FOREGROUND_INTERFERENCE_DENIED');
    data.action.kind = 'COACH'; assert.equal(evaluateGameAction(data).status, 'ADMIT');
  }
  const data = game(); data.control.backgroundIsolationVerified = false; denied(evaluateGameAction, data, 'ISOLATED_OWNED_LEASE_REQUIRED');
});
test('lease host account instance expiry and ownership are strict', () => {
  for (const key of ['leaseHostId', 'leaseAccountId', 'leaseInstanceId']) { const data = game(); data.control[key] = 'changed'; denied(evaluateGameAction, data, 'BINDING_MISMATCH'); }
  const expired = game(); expired.control.leaseExpiresAt = now; denied(evaluateGameAction, expired, 'LEASE_OR_BUDGET_EXPIRED');
  const unverified = game(); unverified.control.leaseVerified = false; denied(evaluateGameAction, unverified, 'ISOLATED_OWNED_LEASE_REQUIRED');
});
test('bounded action count duration session deadline and lease cannot be exceeded', () => {
  for (const change of [{ budgetActions: 2 }, { budgetMs: 1999 }, { deadlineAt: now + 999 }, { leaseExpiresAt: now + 999 }]) {
    const data = game(); Object.assign(data.control, change); denied(evaluateGameAction, data, 'BUDGET_EXHAUSTED');
  }
  for (const durationMs of [0, MEDIA_POLICY_LIMITS.actionDurationMs + 1]) {
    const data = game(); data.action.durationMs = durationMs; denied(evaluateGameAction, data, durationMs === 0 ? 'BUDGET_EXHAUSTED' : 'NUMBER_INVALID');
  }
});
test('uncertain prior effects require reconciliation and all attempted or reserved outcomes prohibit replay', () => {
  const uncertain = game(); uncertain.ledger.outcome = 'UNCERTAIN'; assert.equal(denied(evaluateGameAction, uncertain, 'EFFECT_UNCERTAIN_RECONCILE').reconciliationRequired, true);
  for (const change of [{ outcome: 'SUCCEEDED' }, { outcome: 'FAILED' }, { outcome: 'CANCELLED' }, { attemptCount: 1 }, { reserved: true }]) {
    const data = game(); Object.assign(data.ledger, change); denied(evaluateGameAction, data, 'NO_REPLAY');
  }
  const drift = game(); drift.ledger.budgetRevision++; denied(evaluateGameAction, drift, 'BINDING_MISMATCH');
});
test('money premium ordinary resources and uncertain cost are never admitted even with permission', () => {
  for (const change of [{ moneyMinor: 1 }, { premiumUnits: 1 }, { resourceUnits: 1 }, { verified: false }]) {
    const data = game(); Object.assign(data.game.cost, change); denied(evaluateGameAction, data, 'NO_SPEND_OR_UNCERTAIN_COST');
  }
  for (const key of ['actionId', 'frameSha256']) { const data = game(); data.game.cost[key] = key === 'frameSha256' ? proof : 'other'; denied(evaluateGameAction, data, 'BINDING_MISMATCH'); }
});
test('Supercell mutation is denied despite a claimed permission while observation and coaching are read-only', () => {
  for (const kind of ['COLLECT_FREE', 'START_FREE_TASK']) {
    const data = game(); data.game.publisher = 'supercell'; data.action.kind = kind; denied(evaluateGameAction, data, 'PUBLISHER_AUTOMATION_PROHIBITED');
  }
  const caseAlias = game(); caseAlias.game.publisher = 'SuperCell'; denied(evaluateGameAction, caseAlias, 'PUBLISHER_AUTOMATION_PROHIBITED');
  const packageBound = game(); packageBound.target.appId = 'com.supercell.clashofclans'; packageBound.observation.appId = packageBound.target.appId; packageBound.game.appId = packageBound.target.appId;
  denied(evaluateGameAction, packageBound, 'PUBLISHER_AUTOMATION_PROHIBITED');
  for (const kind of ['OBSERVE', 'COACH']) { const data = game(); data.game.publisher = 'supercell'; data.game.automationPermission = 'DENIED'; data.action.kind = kind; assert.equal(evaluateGameAction(data).status, 'ADMIT'); }
});
test('unknown publisher permission and arbitrary command purchase or macro action are denied', () => {
  for (const permission of ['DENIED', 'UNPROVEN']) { const data = game(); data.game.automationPermission = permission; denied(evaluateGameAction, data, 'PUBLISHER_PERMISSION_REQUIRED'); }
  for (const kind of ['BUY', 'SPEND_DIAMONDS', 'MACRO', 'EXEC', 'ATTACK']) { const data = game(); data.action.kind = kind; denied(evaluateGameAction, data, 'ACTION_DENIED'); }
});
test('video admits only synthetic verified Emad Windows local-free bounded workspace facts', () => {
  for (const kind of ['PLAN', 'RENDER']) {
    const data = video(); data.action.kind = kind; const result = evaluateVideoAction(data);
    assert.equal(result.status, 'ADMIT'); assert.equal(result.executionGranted, false); assert.equal(result.effectsPerformed, false);
    assert.equal(data.control.usedActions, 2); assert.equal(result.reservationProposal.proposedUsedMs, 2000);
  }
});
test('video rejects Saeed Linux unknown owner and unavailable Emad adapter', () => {
  for (const change of [{ owner: 'saeed' }, { platform: 'linux' }, { owner: 'other' }]) {
    const data = video(); Object.assign(data.target, change); Object.assign(data.observation, change); denied(evaluateVideoAction, data, 'TARGET_SCOPE_DENIED');
  }
  const unavailable = video(); unavailable.observation.adapterCallable = false; denied(evaluateVideoAction, unavailable, 'VERIFIED_ADAPTER_REQUIRED');
});
test('video disallows paid premium enabled-payment remote or unverified providers without fallback', () => {
  for (const change of [{ unitPriceMinor: 1 }, { premiumRequired: true }, { paymentsEnabled: true }, { paidConsent: true }, { mode: 'REMOTE_FREE' }, { verified: false }]) {
    const data = video(); Object.assign(data.provider, change); denied(evaluateVideoAction, data, 'FREE_LOCAL_PROVIDER_REQUIRED');
  }
  const stale = video(); stale.provider.expiresAt = now; denied(evaluateVideoAction, stale, 'STALE_OR_BACKWARDS_PROOF');
});
test('video asset content rights derivative permission person consent and exact source host are required', () => {
  for (const change of [{ rights: 'UNKNOWN' }, { rightsVerified: false }, { derivativeUseAllowed: false }, { personsConsentVerified: false }]) {
    const data = video(); Object.assign(data.assets[0], change); denied(evaluateVideoAction, data, 'ASSET_RIGHTS_REQUIRED');
  }
  const wrong = video(); wrong.assets[0].sourceHostId = 'fixture-saeed-windows'; denied(evaluateVideoAction, wrong, 'BINDING_MISMATCH');
  const licensed = video(); licensed.assets[0].rights = 'LICENSED'; assert.equal(evaluateVideoAction(licensed).status, 'ADMIT');
});
test('video asset duplicate missing stale oversized and request hash drift cannot admit', () => {
  const duplicate = video(); duplicate.assets.push({ ...duplicate.assets[0] }); denied(evaluateVideoAction, duplicate, 'ASSET_SET_INVALID');
  const missing = video(); missing.assets = []; denied(evaluateVideoAction, missing, 'SCHEMA_INVALID');
  const stale = video(); stale.assets[0].expiresAt = now; denied(evaluateVideoAction, stale, 'STALE_OR_BACKWARDS_PROOF');
  const large = video(); large.assets[0].bytes = MEDIA_POLICY_LIMITS.assetBytes + 1; denied(evaluateVideoAction, large, 'NUMBER_INVALID');
  const drift = video(); drift.action.assetSetSha256 = proof; denied(evaluateVideoAction, drift, 'BINDING_MISMATCH');
});
test('video rejects output traversal UNC ADS device names wildcards aliases and unknown formats', () => {
  for (const outputName of ['../out.mp4', 'C:\\out.mp4', '\\\\server\\out.mp4', 'out.mp4:ads', 'CON.mp4', 'out?.mp4', 'out.mp4 ', 'out.exe']) {
    const data = video(); data.action.outputName = outputName; denied(evaluateVideoAction, data, 'OUTPUT_PATH_DENIED');
  }
  for (const canonicalRoot of ['C:\\', '\\\\server\\root', 'C:\\root\\..\\other', 'C:\\root.', 'C:\\NUL', 'C:\\root:ads', 'C:\\root\u202e']) {
    const data = video(); data.workspace.canonicalRoot = canonicalRoot; denied(evaluateVideoAction, data, 'OUTPUT_PATH_DENIED');
  }
});
test('video requires actual owned non-reparse absent output workspace and finite byte frame dimension budgets', () => {
  for (const key of ['verified', 'noReparse', 'outputAbsentVerified']) { const data = video(); data.workspace[key] = false; denied(evaluateVideoAction, data, 'OWNED_OUTPUT_WORKSPACE_REQUIRED'); }
  const disk = video(); disk.workspace.availableBytes = 1; denied(evaluateVideoAction, disk, 'OUTPUT_BUDGET_INVALID');
  for (const [key, max] of [['maxOutputBytes', MEDIA_POLICY_LIMITS.outputBytes], ['maxFrames', MEDIA_POLICY_LIMITS.outputFrames], ['width', MEDIA_POLICY_LIMITS.dimension], ['height', MEDIA_POLICY_LIMITS.dimension]]) {
    const data = video(); data.action[key] = max + 1; denied(evaluateVideoAction, data, 'NUMBER_INVALID');
  }
});
test('closed schemas reject unknown fields inherited records symbols accessors arrays and malformed numbers without getter reads', () => {
  const unknown = game(); unknown.action.command = 'anything'; denied(evaluateGameAction, unknown, 'SCHEMA_INVALID');
  const symbol = game(); symbol.control[Symbol('hidden')] = true; denied(evaluateGameAction, symbol, 'SCHEMA_INVALID');
  const inherited = game(); inherited.target = Object.create(inherited.target); denied(evaluateGameAction, inherited, 'SCHEMA_INVALID');
  let reads = 0; const getter = game(); Object.defineProperty(getter.observation, 'hostVerified', { enumerable: true, get() { reads++; return true; } });
  denied(evaluateGameAction, getter, 'SCHEMA_INVALID');
  const arrayGetter = video(); Object.defineProperty(arrayGetter.assets, '0', { enumerable: true, get() { reads++; return video().assets[0]; } }); denied(evaluateVideoAction, arrayGetter, 'SCHEMA_INVALID');
  const trap = game(); trap.target = new Proxy({}, { getPrototypeOf() { const error = {}; Object.defineProperty(error, 'message', { get() { reads++; return 'raw'; } }); throw error; } }); denied(evaluateGameAction, trap, 'SCHEMA_INVALID');
  for (const value of [NaN, Infinity, -1, '100']) { const data = game(); data.now = value; denied(evaluateGameAction, data, 'NUMBER_INVALID'); }
  assert.equal(reads, 0);
});
test('decision is deterministic and accepts no opaque execution payload or public video publish action', () => {
  const data = video(); assert.deepEqual(evaluateVideoAction(data), evaluateVideoAction(data)); data.action.kind = 'PUBLISH'; denied(evaluateVideoAction, data, 'ACTION_DENIED');
  const opaque = game(); opaque.action.args = ['--anything']; denied(evaluateGameAction, opaque, 'SCHEMA_INVALID');
});

function proxied(value, revoke, counts) {
  const handler = Object.fromEntries(['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor', 'get', 'has', 'isExtensible'].map(name =>
    [name, (...args) => { counts[name]++; return Reflect[name](...args); }]));
  const pair = Proxy.revocable(value, handler); if (revoke) pair.revoke(); return pair.proxy;
}
function proxyCounts() { return Object.fromEntries(['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor', 'get', 'has', 'isExtensible'].map(name => [name, 0])); }
for (const revoke of [false, true]) {
  test(`proxy guard rejects ${revoke ? 'revoked' : 'live'} root and recursive object records with zero traps`, () => {
    for (const [build, evaluate, slots] of [[game, evaluateGameAction, [null, ['target'], ['observation'], ['control'], ['ledger'], ['action'], ['game'], ['game', 'cost']]],
      [video, evaluateVideoAction, [null, ['target'], ['observation'], ['control'], ['ledger'], ['action'], ['provider'], ['workspace'], ['assets', 0]]]]) {
      for (const slot of slots) {
        let data = build(); const counts = proxyCounts();
        if (slot === null) data = proxied(data, revoke, counts);
        else { let parent = data; for (const key of slot.slice(0, -1)) parent = parent[key]; const key = slot.at(-1); parent[key] = proxied(parent[key], revoke, counts); }
        denied(evaluate, data, 'SCHEMA_INVALID'); assert.deepEqual(counts, proxyCounts());
      }
    }
  });
  test(`proxy guard rejects ${revoke ? 'revoked' : 'live'} arrays before array or descriptor inspection with zero traps`, () => {
    const data = video(), counts = proxyCounts(); data.assets = proxied(data.assets, revoke, counts);
    denied(evaluateVideoAction, data, 'SCHEMA_INVALID'); assert.deepEqual(counts, proxyCounts());
  });
}
