// Portable pre/post runtime admission for the existing finite Companion runner.
// This module is NOT a scheduler, OS sandbox, authenticated channel or grant.
// policy/pin/identity and callbacks are trusted application inputs, never model
// output or webpage data. The host must independently verify registry/source/
// executable pins, native owner/ACL/path identity and durable intent receipts.
import path from 'node:path';

const HASH = /^[a-f0-9]{64}$/;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const CORE_KEYS = ['version', 'port', 'path', 'configPath', 'configSha256', 'routePath', 'routeSha256'];
const fail = (code, details = {}) => { throw Object.assign(new Error(code), {code, ...details}); };
const text = (v, max = 256) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);

// Reject non-data inputs before cloning: JSON.stringify alone invokes getters.
function snapshot(value) {
  const ancestors = new Set(); let count = 0;
  function visit(v, depth) {
    if (++count > 4096 || depth > 12) fail('RUNTIME_DATA');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.length <= 8192) return v;
    if (!v || typeof v !== 'object' || ancestors.has(v)) fail('RUNTIME_DATA');
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (!array && proto !== Object.prototype && proto !== null) fail('RUNTIME_DATA');
    const ds = Object.getOwnPropertyDescriptors(v), names = Reflect.ownKeys(ds);
    if (names.length > 1024 || names.some(k => typeof k !== 'string' || !('value' in ds[k]))) fail('RUNTIME_DATA');
    ancestors.add(v); let out;
    if (array) {
      if (v.length > 1024 || names.length !== v.length + 1) fail('RUNTIME_DATA');
      out = [];
      for (let i = 0; i < v.length; i++) {if (!Object.hasOwn(ds, String(i))) fail('RUNTIME_DATA');out.push(visit(ds[i].value, depth + 1));}
    } else {
      out = Object.create(null);
      for (const k of names) {if (k.length > 256 || !ds[k].enumerable) fail('RUNTIME_DATA');out[k] = visit(ds[k].value, depth + 1);}
    }
    ancestors.delete(v); return Object.freeze(out);
  }
  return visit(value, 0);
}
function fields(value, expected, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const keys = Object.keys(value);
  if (keys.length !== expected.length || !expected.every(k => Object.hasOwn(value, k))) fail(code);
}
function sameCore(actual, expected) {
  fields(actual, CORE_KEYS, 'RUNTIME_CORE_FIELDS');
  return CORE_KEYS.every(k => actual[k] === expected[k]);
}
function sameIdentity(actual, expected) {
  fields(actual, ['platform', 'host', 'username'], 'RUNTIME_LOCAL_IDENTITY');
  if (!text(actual.host) || !text(actual.username, 128) || actual.platform !== expected.platform) return false;
  const canonical = v => expected.platform === 'win32' ? v.toLowerCase() : v;
  return canonical(actual.host) === canonical(expected.host) && canonical(actual.username) === canonical(expected.username);
}

export function createRuntimeAdmission({policy, pin}) {
  policy = snapshot(policy); pin = snapshot(pin);
  fields(policy, ['schema', 'companionVersion', 'allowedCoreVersions', 'configSchemas'], 'RUNTIME_POLICY_FIELDS');
  if (policy.schema !== 1 || !text(policy.companionVersion, 40) || !VERSION.test(policy.companionVersion)
      || !Array.isArray(policy.allowedCoreVersions) || policy.allowedCoreVersions.length < 1 || policy.allowedCoreVersions.length > 16
      || policy.allowedCoreVersions.some(v => typeof v !== 'string' || v.length > 40 || !VERSION.test(v))
      || new Set(policy.allowedCoreVersions).size !== policy.allowedCoreVersions.length) fail('RUNTIME_POLICY');
  fields(policy.configSchemas, ['capabilityProfile', 'durableWorkflow'], 'RUNTIME_POLICY_FIELDS');
  if (Object.values(policy.configSchemas).some(n => !Number.isSafeInteger(n) || n < 1 || n > 1000)) fail('RUNTIME_POLICY');
  fields(pin, ['schema', 'companionVersion', 'owner', 'deviceName', 'profile', 'core'], 'RUNTIME_PIN_FIELDS');
  if (pin.schema !== 1) fail('RUNTIME_PIN');
  if (pin.companionVersion !== policy.companionVersion) fail('RUNTIME_COMPANION_VERSION');
  fields(pin.owner, ['platform', 'host', 'username'], 'RUNTIME_OWNER');
  if (!['win32', 'linux'].includes(pin.owner.platform) || !text(pin.owner.host) || !text(pin.owner.username, 128) || !text(pin.deviceName)) fail('RUNTIME_OWNER');
  fields(pin.profile, ['id', 'isolated'], 'RUNTIME_PROFILE');
  if (typeof pin.profile.id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(pin.profile.id) || typeof pin.profile.isolated !== 'boolean'
      || pin.profile.isolated !== (pin.profile.id !== 'default')) fail('RUNTIME_PROFILE');
  fields(pin.core, CORE_KEYS, 'RUNTIME_CORE_FIELDS');
  const core = pin.core;
  if (!policy.allowedCoreVersions.includes(core.version)) fail('RUNTIME_VERSION_NOT_REVIEWED');
  if (!Number.isSafeInteger(core.port) || core.port < 1024 || core.port > 65535
      || typeof core.configSha256 !== 'string' || !HASH.test(core.configSha256)
      || typeof core.routeSha256 !== 'string' || !HASH.test(core.routeSha256)) fail('RUNTIME_CORE');
  const paths = pin.owner.platform === 'win32' ? path.win32 : path.posix;
  for (const k of ['path', 'configPath', 'routePath']) {
    if (!text(core[k], 4096) || !paths.isAbsolute(core[k]) || paths.normalize(core[k]) !== core[k]) fail('RUNTIME_CORE_PATH');
  }
  const context = Object.freeze({schema: 1, companionVersion: pin.companionVersion, coreVersion: core.version,
    profileId: pin.profile.id, isolated: pin.profile.isolated, platform: pin.owner.platform,
    sourcePort: core.port, configSha256: core.configSha256, routeSha256: core.routeSha256,
    scope: 'PINNED_RUNTIME_COMPATIBILITY_NOT_PROJECT_EXECUTION_ACCEPTANCE'});
  let busy = false, reconciliationRequired = false;

  function checkRequest({descriptor, identity, maxTicks}) {
    descriptor = snapshot(descriptor); identity = snapshot(identity);
    if (!Number.isSafeInteger(maxTicks) || maxTicks < 1 || maxTicks > 65) fail('RUNTIME_TICKS');
    if (!sameIdentity(identity, pin.owner)) fail('RUNTIME_LOCAL_IDENTITY');
    if (!descriptor || typeof descriptor !== 'object') fail('RUNTIME_DESCRIPTOR');
    if (descriptor.version !== pin.companionVersion) fail('RUNTIME_COMPANION_VERSION');
    if (descriptor.owner !== pin.owner.username) fail('RUNTIME_DESCRIPTOR_OWNER');
    if (!sameCore(descriptor.core, core)) fail('RUNTIME_DESCRIPTOR_CORE_DRIFT');
    return context;
  }
  function checkStatus(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('RUNTIME_STATUS_SHAPE');
    const status = snapshot(value);
    if (status.name !== 'chatgpt-remote-commander' || status.version !== core.version
        || status.deviceName !== pin.deviceName || status.platform !== pin.owner.platform
        || status.port !== core.port || status.configSha256 !== core.configSha256) fail('RUNTIME_STATUS_IDENTITY');
    if (status.instance?.profile !== pin.profile.id || status.instance?.isolated !== pin.profile.isolated) fail('RUNTIME_STATUS_PROFILE');
    for (const key of Object.keys(policy.configSchemas)) if (status.configSchema?.[key] !== policy.configSchemas[key]) fail('RUNTIME_STATUS_SCHEMA');
    return context;
  }
  async function run({descriptor, identity, maxTicks, readStatus, execute}) {
    if (reconciliationRequired) fail('RUNTIME_RECONCILIATION_REQUIRED');
    if (busy) fail('RUNTIME_BUSY');
    if (typeof readStatus !== 'function' || typeof execute !== 'function') fail('RUNTIME_CALLBACKS');
    busy = true; let entered = false;
    try {
      const request = snapshot({descriptor, identity, maxTicks});
      checkRequest(request);
      checkStatus(await readStatus(context));
      let result, primary, secondary;
      entered = true;
      try {result = await execute(context, request);} catch (error) {primary = {error};}
      try {checkStatus(await readStatus(context));} catch (error) {secondary = {error};}
      if (primary) fail('RUNTIME_WORKER_FAILED', {cause: primary.error, postcheckError: secondary?.error, effectMayHaveOccurred: true});
      if (secondary) fail('RUNTIME_POSTCHECK_FAILED', {cause: secondary.error, effectMayHaveOccurred: true});
      return result;
    } catch (error) {
      if (entered) reconciliationRequired = true;
      throw error;
    } finally {busy = false;}
  }
  // Latch is per object only. A NEW process must consult the existing durable
  // runner journal/intent before any execution; creating a new object is NOT
  // recovery and does not authorize retry of an uncertain or completed effect.
  return Object.freeze({checkRequest, checkStatus, run});
}
