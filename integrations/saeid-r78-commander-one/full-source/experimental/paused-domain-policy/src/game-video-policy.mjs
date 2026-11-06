import { createHash } from 'node:crypto';
import { types } from 'node:util';

// Pure admission of trusted adapter facts, NOT their authentication and NOT an
// executor. Adapters must verify facts outside the user/MCP request channel,
// atomically reserve a durable ledger/budget, and recheck before any effect.
export const MEDIA_POLICY_LIMITS = Object.freeze({ frameAgeMs: 1500, proofAgeMs: 30000,
  actionDurationMs: 60000, sessionDurationMs: 3600000, sessionActions: 100,
  assetCount: 16, assetBytes: 67108864, assetTotalBytes: 268435456,
  outputBytes: 134217728, outputFrames: 3600, dimension: 1920 });
const errors = new WeakMap();
function fail(code) { const marker = {}; errors.set(marker, code); throw marker; }
function object(value, keys) {
  if (types.isProxy(value) || !value || Object.getPrototypeOf(value) !== Object.prototype) fail('SCHEMA_INVALID');
  const fields = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(fields);
  if (names.length !== keys.length || names.some(k => typeof k !== 'string' || !keys.includes(k))
    || names.some(k => !Object.hasOwn(fields[k], 'value') || !fields[k].enumerable)) fail('SCHEMA_INVALID');
  return Object.fromEntries(keys.map(k => [k, fields[k].value]));
}
function array(value, max) {
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('SCHEMA_INVALID');
  const fields = Object.getOwnPropertyDescriptors(value), length = fields.length?.value;
  if (!Number.isSafeInteger(length) || length < 1 || length > max || Reflect.ownKeys(fields).length !== length + 1) fail('SCHEMA_INVALID');
  return Array.from({ length }, (_, i) => {
    const item = fields[String(i)]; if (!item || !Object.hasOwn(item, 'value') || !item.enumerable) fail('SCHEMA_INVALID'); return item.value;
  });
}
function id(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) fail('IDENTIFIER_INVALID'); return value; }
function hash(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('HASH_INVALID'); return value; }
function integer(value, max = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(value) || value < 0 || value > max) fail('NUMBER_INVALID'); return value; }
function bool(value) { if (typeof value !== 'boolean') fail('BOOLEAN_INVALID'); return value; }
function fresh(observedAt, expiresAt, now, age) {
  integer(observedAt); integer(expiresAt);
  if (observedAt > now || expiresAt <= now || expiresAt <= observedAt || expiresAt - observedAt > age || now - observedAt > age) fail('STALE_OR_BACKWARDS_PROOF');
}
function same(value, expected) { if (value !== expected) fail('BINDING_MISMATCH'); }
function common(input, domain, actionKeys) {
  const target = object(input.target, ['owner', 'platform', 'hostId', 'deviceId', 'adapterId', 'configSha256', 'appId', 'accountId', 'instanceId']);
  if (!['saeed', 'emad'].includes(target.owner) || !['win32', 'linux'].includes(target.platform)) fail('TARGET_SCOPE_DENIED');
  for (const key of ['hostId', 'deviceId', 'adapterId', 'appId', 'accountId', 'instanceId']) id(target[key]); hash(target.configSha256);
  if (target.platform !== 'win32' || domain === 'video' && target.owner !== 'emad') fail('TARGET_SCOPE_DENIED');
  const observation = object(input.observation, ['owner', 'platform', 'hostId', 'deviceId', 'adapterId', 'configSha256', 'appId', 'accountId', 'instanceId',
    'observedAt', 'expiresAt', 'frameSha256', 'frameSequence', 'inputEpoch', 'hostVerified', 'accountOwnedVerified', 'instanceVerified', 'adapterCallable', 'receiptAuthenticated']);
  for (const key of ['owner', 'platform', 'hostId', 'deviceId', 'adapterId', 'configSha256', 'appId', 'accountId', 'instanceId']) same(observation[key], target[key]);
  for (const key of ['hostVerified', 'accountOwnedVerified', 'instanceVerified', 'adapterCallable', 'receiptAuthenticated']) if (bool(observation[key]) !== true) fail('VERIFIED_ADAPTER_REQUIRED');
  fresh(observation.observedAt, observation.expiresAt, input.now, MEDIA_POLICY_LIMITS.frameAgeMs);
  hash(observation.frameSha256); integer(observation.frameSequence); integer(observation.inputEpoch);
  const action = object(input.action, actionKeys); id(action.actionId); hash(action.expectedFrameSha256);
  integer(action.expectedFrameSequence); integer(action.expectedInputEpoch); integer(action.durationMs, MEDIA_POLICY_LIMITS.actionDurationMs);
  if (action.durationMs < 1) fail('BUDGET_EXHAUSTED');
  same(action.expectedFrameSha256, observation.frameSha256); same(action.expectedFrameSequence, observation.frameSequence); same(action.expectedInputEpoch, observation.inputEpoch);
  const control = object(input.control, ['sessionId', 'leaseId', 'leaseHostId', 'leaseAccountId', 'leaseInstanceId', 'leaseExpiresAt', 'leaseVerified',
    'stopRequested', 'pauseRequested', 'userActive', 'foregroundOwned', 'backgroundIsolationVerified', 'inputLeaseVerified',
    'budgetRevision', 'budgetActions', 'usedActions', 'budgetMs', 'usedMs', 'deadlineAt']);
  id(control.sessionId); id(control.leaseId);
  for (const key of ['leaseVerified', 'stopRequested', 'pauseRequested', 'userActive', 'foregroundOwned', 'backgroundIsolationVerified', 'inputLeaseVerified']) bool(control[key]);
  if (control.stopRequested) fail('USER_STOP'); if (control.pauseRequested) fail('USER_PAUSE');
  if (!control.leaseVerified || !control.backgroundIsolationVerified) fail('ISOLATED_OWNED_LEASE_REQUIRED');
  same(control.leaseHostId, target.hostId); same(control.leaseAccountId, target.accountId); same(control.leaseInstanceId, target.instanceId);
  integer(control.leaseExpiresAt); integer(control.deadlineAt);
  if (control.leaseExpiresAt <= input.now || control.deadlineAt <= input.now) fail('LEASE_OR_BUDGET_EXPIRED');
  integer(control.budgetRevision); integer(control.budgetActions, MEDIA_POLICY_LIMITS.sessionActions); integer(control.usedActions, MEDIA_POLICY_LIMITS.sessionActions);
  integer(control.budgetMs, MEDIA_POLICY_LIMITS.sessionDurationMs); integer(control.usedMs, MEDIA_POLICY_LIMITS.sessionDurationMs);
  if (control.usedActions >= control.budgetActions || action.durationMs > control.budgetMs - control.usedMs || action.durationMs > control.deadlineAt - input.now
    || action.durationMs > control.leaseExpiresAt - input.now) fail('BUDGET_EXHAUSTED');
  const ledger = object(input.ledger, ['actionId', 'sessionId', 'leaseId', 'budgetRevision', 'outcome', 'attemptCount', 'reserved']);
  same(ledger.actionId, action.actionId); same(ledger.sessionId, control.sessionId); same(ledger.leaseId, control.leaseId); same(ledger.budgetRevision, control.budgetRevision);
  integer(ledger.attemptCount); bool(ledger.reserved);
  if (ledger.outcome === 'UNCERTAIN') fail('EFFECT_UNCERTAIN_RECONCILE');
  if (ledger.outcome !== 'NOT_STARTED' || ledger.attemptCount !== 0 || ledger.reserved) fail('NO_REPLAY');
  return { target, observation, action, control };
}
function decision(domain, status, code, context = null) {
  return Object.freeze({ schemaVersion: 1, domain, status, code, stage: 'PURE_POLICY_ONLY', executionGranted: false, effectsPerformed: false,
    reconciliationRequired: code === 'EFFECT_UNCERTAIN_RECONCILE', recheckRequired: true,
    reservationProposal: context ? Object.freeze({ actionId: context.action.actionId, sessionId: context.control.sessionId, leaseId: context.control.leaseId,
      expectedBudgetRevision: context.control.budgetRevision, proposedUsedActions: context.control.usedActions + 1,
      proposedUsedMs: context.control.usedMs + context.action.durationMs }) : null });
}
const actionKeys = ['actionId', 'kind', 'expectedFrameSha256', 'expectedFrameSequence', 'expectedInputEpoch', 'durationMs'];
export function evaluateGameAction(value) {
  try {
    const input = object(value, ['now', 'target', 'observation', 'control', 'ledger', 'action', 'game']); integer(input.now);
    const context = common(input, 'game', actionKeys), { action, target, observation, control } = context;
    if (!['OBSERVE', 'COACH', 'COLLECT_FREE', 'START_FREE_TASK'].includes(action.kind)) fail('ACTION_DENIED');
    const game = object(input.game, ['publisher', 'publisherVerified', 'appId', 'accountId', 'instanceId', 'automationPermission', 'termsSha256', 'observedAt', 'expiresAt', 'cost']);
    id(game.publisher); bool(game.publisherVerified); if (!game.publisherVerified) fail('PUBLISHER_UNVERIFIED');
    for (const key of ['appId', 'accountId', 'instanceId']) same(game[key], target[key]); hash(game.termsSha256);
    fresh(game.observedAt, game.expiresAt, input.now, MEDIA_POLICY_LIMITS.proofAgeMs);
    if (!['ALLOWED', 'DENIED', 'UNPROVEN'].includes(game.automationPermission)) fail('SCHEMA_INVALID');
    const cost = object(game.cost, ['actionId', 'frameSha256', 'moneyMinor', 'premiumUnits', 'resourceUnits', 'verified']);
    same(cost.actionId, action.actionId); same(cost.frameSha256, observation.frameSha256);
    integer(cost.moneyMinor); integer(cost.premiumUnits); integer(cost.resourceUnits); bool(cost.verified);
    if (!cost.verified || cost.moneyMinor !== 0 || cost.premiumUnits !== 0 || cost.resourceUnits !== 0) fail('NO_SPEND_OR_UNCERTAIN_COST');
    if (['COLLECT_FREE', 'START_FREE_TASK'].includes(action.kind)) {
      // IDs are ASCII-only; case aliases must not bypass publisher restrictions.
      if (game.publisher.toLowerCase() === 'supercell' || target.appId.toLowerCase().startsWith('com.supercell.')) fail('PUBLISHER_AUTOMATION_PROHIBITED');
      if (game.automationPermission !== 'ALLOWED') fail('PUBLISHER_PERMISSION_REQUIRED');
      if (control.userActive || !control.foregroundOwned || !control.inputLeaseVerified) fail('FOREGROUND_INTERFERENCE_DENIED');
    }
    return decision('game', 'ADMIT', 'POLICY_ADMIT_REQUIRES_ATOMIC_RESERVATION', context);
  } catch (error) { return decision('game', 'DENY', errors.get(error) ?? 'SCHEMA_INVALID'); }
}
function outputName(value) {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9_-]*\.(mp4|webm|mov)$/.test(value)
    || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\./i.test(value)) fail('OUTPUT_PATH_DENIED'); return value;
}
function workspaceRoot(value) {
  if (typeof value !== 'string' || value.length > 1024 || !/^[A-Za-z]:\\/.test(value) || /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(value)) fail('OUTPUT_PATH_DENIED');
  const parts = value.slice(3).split('\\');
  if (parts.length < 1 || parts.some(p => !p || p === '.' || p === '..' || /[<>:"/|?*]/.test(p) || /[. ]$/.test(p)
    || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p))) fail('OUTPUT_PATH_DENIED'); return value;
}
function assets(value, now, hostId) {
  const items = array(value, MEDIA_POLICY_LIMITS.assetCount).map(v => {
    const item = object(v, ['id', 'sha256', 'bytes', 'rights', 'rightsProofSha256', 'rightsVerified', 'derivativeUseAllowed', 'personsConsentVerified', 'sourceHostId', 'observedAt', 'expiresAt']);
    id(item.id); hash(item.sha256); hash(item.rightsProofSha256); integer(item.bytes, MEDIA_POLICY_LIMITS.assetBytes);
    if (item.bytes < 1 || !['OWNED', 'LICENSED'].includes(item.rights) || bool(item.rightsVerified) !== true
      || bool(item.derivativeUseAllowed) !== true || bool(item.personsConsentVerified) !== true) fail('ASSET_RIGHTS_REQUIRED');
    same(item.sourceHostId, hostId); fresh(item.observedAt, item.expiresAt, now, MEDIA_POLICY_LIMITS.proofAgeMs); return item;
  });
  if (new Set(items.map(item => item.id)).size !== items.length || items.reduce((sum, item) => sum + item.bytes, 0) > MEDIA_POLICY_LIMITS.assetTotalBytes) fail('ASSET_SET_INVALID');
  const canonical = items.map(({ id, sha256, bytes }) => ({ id, sha256, bytes })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
export function evaluateVideoAction(value) {
  try {
    const input = object(value, ['now', 'target', 'observation', 'control', 'ledger', 'action', 'provider', 'workspace', 'assets']); integer(input.now);
    const context = common(input, 'video', [...actionKeys, 'providerId', 'outputName', 'assetSetSha256', 'maxOutputBytes', 'maxFrames', 'width', 'height']);
    const { target, action } = context;
    if (!['PLAN', 'RENDER'].includes(action.kind)) fail('ACTION_DENIED');
    id(action.providerId); outputName(action.outputName); hash(action.assetSetSha256);
    integer(action.maxOutputBytes, MEDIA_POLICY_LIMITS.outputBytes); integer(action.maxFrames, MEDIA_POLICY_LIMITS.outputFrames);
    integer(action.width, MEDIA_POLICY_LIMITS.dimension); integer(action.height, MEDIA_POLICY_LIMITS.dimension);
    if (Math.min(action.maxOutputBytes, action.maxFrames, action.width, action.height) < 1) fail('OUTPUT_BUDGET_INVALID');
    const provider = object(input.provider, ['id', 'mode', 'hostId', 'accountId', 'instanceId', 'verified', 'unitPriceMinor', 'premiumRequired', 'paymentsEnabled', 'paidConsent', 'proofSha256', 'observedAt', 'expiresAt']);
    same(provider.id, action.providerId); same(provider.hostId, target.hostId); same(provider.accountId, target.accountId); same(provider.instanceId, target.instanceId);
    hash(provider.proofSha256); integer(provider.unitPriceMinor);
    for (const key of ['verified', 'premiumRequired', 'paymentsEnabled', 'paidConsent']) bool(provider[key]);
    if (!provider.verified || provider.mode !== 'LOCAL_FREE' || provider.unitPriceMinor !== 0 || provider.premiumRequired || provider.paymentsEnabled || provider.paidConsent) fail('FREE_LOCAL_PROVIDER_REQUIRED');
    fresh(provider.observedAt, provider.expiresAt, input.now, MEDIA_POLICY_LIMITS.proofAgeMs);
    const workspace = object(input.workspace, ['owner', 'hostId', 'canonicalRoot', 'dev', 'ino', 'verified', 'noReparse', 'outputName', 'outputAbsentVerified', 'availableBytes', 'observedAt', 'expiresAt']);
    same(workspace.owner, 'emad'); same(workspace.hostId, target.hostId); same(workspace.outputName, action.outputName);
    workspaceRoot(workspace.canonicalRoot); id(workspace.dev); id(workspace.ino); integer(workspace.availableBytes);
    if (bool(workspace.verified) !== true || bool(workspace.noReparse) !== true || bool(workspace.outputAbsentVerified) !== true) fail('OWNED_OUTPUT_WORKSPACE_REQUIRED');
    if (workspace.availableBytes < action.maxOutputBytes) fail('OUTPUT_BUDGET_INVALID');
    fresh(workspace.observedAt, workspace.expiresAt, input.now, MEDIA_POLICY_LIMITS.proofAgeMs);
    same(assets(input.assets, input.now, target.hostId), action.assetSetSha256);
    return decision('video', 'ADMIT', 'POLICY_ADMIT_REQUIRES_ATOMIC_RESERVATION', context);
  } catch (error) { return decision('video', 'DENY', errors.get(error) ?? 'SCHEMA_INVALID'); }
}
