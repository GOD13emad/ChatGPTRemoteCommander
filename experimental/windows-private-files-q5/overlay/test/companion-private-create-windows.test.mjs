import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateCompanionCreateRequest, validateCompanionCreateReceipt, companionCreateUncertainty,
  createCompanionPrivateFileWindows, decodeCompanionCreateWire, COMPANION_CREATE_WIRE_LIMITS } from '../src/companion-private-create-windows.mjs';
import { evaluateCompanionAcl, verifyCompanionPrivateDirectory, verifyCompanionPrivateFile } from '../src/companion-private-directory.mjs';
import { parseCompanionJson } from '../src/companion-json.mjs';
import { createCompanionSession, writeCompanionObservation } from '../src/companion-session.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const asciiFold = value => value.replace(/[A-Z]/g, c => c.toLowerCase());
const lock = '.commander-companion-export.lock', now = 1900000000000, requestId = 'a'.repeat(32);
const request = () => ({ filePath: 'C:\\private\\' + lock, directory: 'C:\\private', dev: '123', ino: '456',
  descriptorSha256: 'b'.repeat(64), purpose: 'LOCK' });
const receipt = () => ({ schemaVersion: 1, outcome: 'CREATED_EMPTY', requestId, purpose: 'LOCK', basename: lock,
  canonicalPathSha256: hash(asciiFold(request().filePath)), parentCanonicalPathSha256: hash(asciiFold(request().directory)),
  parentDev: '123', parentIno: '456', parentDescriptorSha256: 'b'.repeat(64), filesystem: 'NTFS', dev: '123', ino: '789',
  size: '0', nlink: 1, regular: true, reparsePoint: false, ownerMatchesCurrentUser: true, privatePermissionsVerified: true,
  descriptorSha256: 'c'.repeat(64), observedAtEpochMs: now, proofOrigin: 'ORIGINAL_CREATOR_HANDLE', parentNodeTokenOwner: 'UNPROVEN' });
test('wire valid serialized success roundtrips through the SAME production decoder', () => {
  const wire = Buffer.from(JSON.stringify(receipt()));
  const decoded = decodeCompanionCreateWire(wire);
  assert.equal(Object.keys(decoded).length, 23);
  assert.deepEqual(validateCompanionCreateReceipt(decoded, request(), requestId, { now }), receipt());
});
test('wire finite serialized failure outcomes retain their exact no-create or uncertain state', () => {
  for (const value of [
    { schemaVersion: 1, outcome: 'NOT_CREATED', requestId, phase: 'PREFLIGHT', creationAttempted: false, code: 'PREFLIGHT_FAILED' },
    { schemaVersion: 1, outcome: 'NOT_CREATED_COLLISION', requestId, phase: 'PREFLIGHT', creationAttempted: false, code: 'TARGET_PRESENT' },
    { schemaVersion: 1, outcome: 'CreatedButOpenUncertain', requestId, phase: 'HANDLE_PROOF', creationAttempted: true, code: 'CREATE_OUTCOME_UNCERTAIN' }
  ]) assert.deepEqual(decodeCompanionCreateWire(Buffer.from(JSON.stringify(value))), value);
});
test('wire duplicate BOM truncated oversized deep overbudget and unknown-schema inputs fail closed', () => {
  const good = JSON.stringify(receipt()), goodBytes = Buffer.from(good);
  for (const bytes of [Buffer.from(good.slice(0, -1) + ',"outcome":"CREATED_EMPTY"}'), Buffer.from('\ufeff' + good),
    Buffer.concat([Buffer.from([0xc3, 0x28]), goodBytes]), Buffer.from(good.slice(0, -1)),
    Buffer.concat([goodBytes, Buffer.alloc(COMPANION_CREATE_WIRE_LIMITS.maxBytes + 1 - goodBytes.length, 32)]), Buffer.from('[[[[0]]]]'),
    Buffer.from(JSON.stringify(Array.from({ length: 128 }, () => 1)))]) {
    assert.throws(() => decodeCompanionCreateWire(bytes), error => error.message === 'COMPANION_JSON_INVALID');
  }
  for (const bytes of [Buffer.from('{}'),
    Buffer.from(JSON.stringify({ schemaVersion: 1, outcome: 'NOT_CREATED', requestId, phase: 'CREATE', creationAttempted: true, code: 'PREFLIGHT_FAILED' })),
    Buffer.from(JSON.stringify({ ...receipt(), unknown: true }))]) {
    assert.throws(() => decodeCompanionCreateWire(bytes), error => error.message === 'COMPANION_CREATE_SCHEMA_INVALID');
  }
  assert.equal(COMPANION_CREATE_WIRE_LIMITS.maxBytes, 8192); assert.equal(COMPANION_CREATE_WIRE_LIMITS.maxDepth, 3);
  assert.equal(COMPANION_CREATE_WIRE_LIMITS.maxNodes, 128);
});
test('creator request only admits exact reserved direct children and explicit fixture binding', () => {
  assert.equal(validateCompanionCreateRequest(request()).basename, lock);
  const tmp = '.commander-companion-123e4567-e89b-42d3-a456-426614174000.tmp';
  assert.equal(validateCompanionCreateRequest({ ...request(), filePath: 'C:\\private\\' + tmp, purpose: 'TEMP' }).basename, tmp);
  const fixture = 'C:\\temp\\rc-companion-private-test-Abc123';
  assert.equal(validateCompanionCreateRequest({ ...request(), directory: fixture, filePath: fixture + '\\commander-binding.json', purpose: 'TEST_BINDING' }).basename, 'commander-binding.json');
  for (const change of [{ purpose: 'TEST_BINDING', filePath: 'C:\\private\\commander-binding.json' },
    { filePath: 'C:\\other\\' + lock }, { filePath: 'C:\\private\\ordinary.json' },
    { filePath: 'C:\\private\\' + lock + ':secret' }, { directory: '\\\\server\\private' },
    { dev: 123 }, { ino: '01' }, { descriptorSha256: 'x'.repeat(64) }, { purpose: 'EXECUTE' }]) {
    assert.throws(() => validateCompanionCreateRequest({ ...request(), ...change }), /COMPANION_CREATE_/);
  }
});
test('creator request rejects unknown fields and accessors without evaluating them', () => {
  let reads = 0; const invalid = request(); Object.defineProperty(invalid, 'purpose', { enumerable: true, get() { reads++; return 'LOCK'; } });
  assert.throws(() => validateCompanionCreateRequest(invalid), /SCHEMA_INVALID/); assert.equal(reads, 0);
  assert.throws(() => validateCompanionCreateRequest({ ...request(), force: true }), /SCHEMA_INVALID/);
});
test('actual-handle receipt has an exact bounded identity and privacy contract', () => {
  assert.equal(validateCompanionCreateReceipt(receipt(), request(), requestId, { now }).ino, '789');
  for (const change of [{ requestId: 'd'.repeat(32) }, { parentDev: '0' }, { parentIno: '0' },
    { parentDescriptorSha256: 'd'.repeat(64) }, { canonicalPathSha256: 'd'.repeat(64) },
    { parentCanonicalPathSha256: 'd'.repeat(64) }, { filesystem: 'ReFS' }, { dev: 123 },
    { ino: Number.MAX_SAFE_INTEGER }, { size: '1' }, { nlink: 2 }, { regular: false }, { reparsePoint: true },
    { ownerMatchesCurrentUser: false }, { privatePermissionsVerified: false }, { proofOrigin: 'REQUESTED_ACL' },
    { parentNodeTokenOwner: 'OBSERVED' }, { outcome: 'NOT_CREATED' }, { descriptorSha256: null }]) {
    assert.throws(() => validateCompanionCreateReceipt({ ...receipt(), ...change }, request(), requestId, { now }), /RECEIPT_INVALID/);
  }
});
test('creator receipt is rechecked for expiration and backwards time', () => {
  for (const observedAtEpochMs of [now - 5001, now + 1, -1, NaN]) {
    assert.throws(() => validateCompanionCreateReceipt({ ...receipt(), observedAtEpochMs }, request(), requestId, { now }), /RECEIPT_INVALID/);
  }
});
test('duplicate truncated and BOM receipts fail before adoption', () => {
  for (const raw of ['{"outcome":"CREATED_EMPTY","outcome":"NOT_CREATED"}', '{"outcome":', '\ufeff{}']) {
    assert.throws(() => parseCompanionJson(Buffer.from(raw), { maxBytes: 8192, maxDepth: 3, maxNodes: 64 }));
  }
});
test('uncertain creator metadata contains only safe basename and no ownership grant', () => {
  const unknown = companionCreateUncertainty('C:\\private\\' + lock, 'LOCK');
  assert.deepEqual(unknown, { outcome: 'CreatedButOpenUncertain', reconciliationRequired: true, basename: lock, purpose: 'LOCK' });
  assert.equal(JSON.stringify(unknown).includes('C:'), false);
});
test('strict admin-owner and broad allow admission remains rejected', () => {
  const user = 'S-1-5-21-1-2-3-1001', observation = { path: 'C:\\private', ownerSid: user, currentSid: user,
    sddl: 'O:ownerD:(A;;FA;;;owner)', rules: [{ sid: user, access: 'Allow', rights: 2032127 }, { sid: 'S-1-5-18', access: 'Allow', rights: 2032127 }] };
  assert.equal(evaluateCompanionAcl(observation, observation.path).private, true);
  assert.throws(() => evaluateCompanionAcl({ ...observation, ownerSid: 'S-1-5-32-544' }, observation.path), /ACL_INVALID/);
  assert.throws(() => evaluateCompanionAcl({ ...observation, rules: [...observation.rules, { sid: 'S-1-1-0', access: 'Allow', rights: 1 }] }, observation.path), /DIRECTORY_NOT_PRIVATE/);
});

const dirProof = pin => ({ ...pin, ownerVerified: true, privatePermissionsVerified: true, observedAtEpochMs: Date.now(), descriptorSha256: 'b'.repeat(64) });
const fileProof = pin => ({ ...pin, ownerVerified: true, privatePermissionsVerified: true, observedAtEpochMs: Date.now(), descriptorSha256: 'c'.repeat(64) });
async function snapshot() {
  const binding = { appId: 'fixture-app', accountId: 'fixture-account', profileId: 'fixture-profile', workflowId: 'fixture-project',
    projectRoot: process.platform === 'win32' ? 'C:\\fixture-project' : '/fixture-project', chatUrl: 'https://chatgpt.com/c/fixture-chat' };
  const identity = { appId: binding.appId, profile: binding.profileId, deviceName: 'fixture-host', version: '0.10.4',
    commit: null, configSha256: 'a'.repeat(64), routeGeneration: null };
  return createCompanionSession({ binding, identity, readWorkflow: () => ({ state: { id: binding.workflowId, revision: 1,
    root: binding.projectRoot, configSha256: identity.configSha256, checkpoint: null, steps: [] } }), readOperations: () => [], readBackendTools: () => ['system_status'] }).observe({ id: binding.workflowId });
}
const mockFixtures = new Map();
function syntheticFixture() {
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-companion-q5-mock-')));
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
  const before = fs.lstatSync(directory, { bigint: true }), owned = new Map();
  mockFixtures.set(directory, owned);
  return { directory, finish() {
    const after = fs.lstatSync(directory, { bigint: true }); assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino);
    const names = fs.readdirSync(directory);
    if (names.some(name => !owned.has(path.join(directory, name)))) throw new Error('Q5_MOCK_RECONCILIATION_REQUIRED');
    for (const name of names) {
      assert.ok(name === lock || /^\.commander-companion-[a-f0-9-]{36}\.tmp$/.test(name));
      const p = path.join(directory, name), stat = fs.lstatSync(p, { bigint: true });
      const pin = owned.get(p);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size !== 0n || stat.dev !== pin.dev || stat.ino !== pin.ino
        || stat.mtimeNs !== pin.mtimeNs) throw new Error('Q5_MOCK_RECONCILIATION_REQUIRED');
      const descriptor = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const opened = fs.fstatSync(descriptor, { bigint: true }), empty = Buffer.alloc(1);
        if (opened.dev !== pin.dev || opened.ino !== pin.ino || opened.size !== 0n || opened.nlink !== 1n
          || fs.readSync(descriptor, empty, 0, 1, 0) !== 0 || hash(Buffer.alloc(0)) !== pin.sha256) throw new Error('Q5_MOCK_RECONCILIATION_REQUIRED');
        const final = fs.lstatSync(p, { bigint: true });
        if (final.dev !== pin.dev || final.ino !== pin.ino || final.size !== 0n || final.nlink !== 1n || final.mtimeNs !== pin.mtimeNs) throw new Error('Q5_MOCK_RECONCILIATION_REQUIRED');
        fs.unlinkSync(p);
      } finally { fs.closeSync(descriptor); }
    }
    const finalParent = fs.lstatSync(directory, { bigint: true });
    if (!finalParent.isDirectory() || finalParent.isSymbolicLink() || finalParent.dev !== before.dev || finalParent.ino !== before.ino
      || finalParent.nlink !== before.nlink || fs.realpathSync.native(directory) !== directory) throw new Error('Q5_MOCK_PARENT_DRIFT');
    fs.rmdirSync(directory); mockFixtures.delete(directory);
  } };
}
function mockCreator(pin) {
  const descriptor = fs.openSync(pin.filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  const stat = fs.fstatSync(descriptor, { bigint: true });
  const ledger = mockFixtures.get(path.dirname(pin.filePath));
  if (!ledger) { fs.closeSync(descriptor); throw new Error('Q5_MOCK_OWNER_MISSING'); }
  ledger.set(pin.filePath, { dev: stat.dev, ino: stat.ino, mtimeNs: stat.mtimeNs, sha256: hash(Buffer.alloc(0)) });
  return { descriptor, dev: stat.dev.toString(), ino: stat.ino.toString(), descriptorSha256: 'c'.repeat(64) };
}
test('mock cleanup rejects an unregistered basename without deleting the known owned empty file', () => {
  const fixture = syntheticFixture(), filePath = path.join(fixture.directory, lock);
  const created = mockCreator({ filePath }); fs.closeSync(created.descriptor);
  const ledger = mockFixtures.get(fixture.directory), pin = ledger.get(filePath); ledger.delete(filePath);
  try {
    assert.throws(() => fixture.finish(), /Q5_MOCK_RECONCILIATION_REQUIRED/);
    const preserved = fs.lstatSync(filePath, { bigint: true });
    assert.equal(preserved.dev, pin.dev); assert.equal(preserved.ino, pin.ino); assert.equal(preserved.size, 0n);
  } finally { ledger.set(filePath, pin); fixture.finish(); }
});
test('mock cleanup rejects mismatched ledger identity before unlink and accepts only its restored own pin', () => {
  const fixture = syntheticFixture(), filePath = path.join(fixture.directory, lock);
  const created = mockCreator({ filePath }); fs.closeSync(created.descriptor);
  const ledger = mockFixtures.get(fixture.directory), pin = ledger.get(filePath);
  ledger.set(filePath, { ...pin, ino: pin.ino + 1n });
  try {
    assert.throws(() => fixture.finish(), /Q5_MOCK_RECONCILIATION_REQUIRED/);
    const preserved = fs.lstatSync(filePath, { bigint: true });
    assert.equal(preserved.dev, pin.dev); assert.equal(preserved.ino, pin.ino); assert.equal(preserved.size, 0n);
  } finally { ledger.set(filePath, pin); fixture.finish(); }
});
test('lost post-create lock receipt preserves empty file and ORs uncertainty before remember', async () => {
  const fixture = syntheticFixture(), value = await snapshot(); let calls = 0;
  try {
    assert.throws(() => writeCompanionObservation(fixture.directory, value, { verifyPrivateDirectory: dirProof, verifyPrivateFile: fileProof,
      createPrivateFile: pin => { calls++; fs.closeSync(mockCreator(pin).descriptor); const error = new Error('MOCK_LOST_RECEIPT'); error.code = 'EEXIST'; throw error; } }),
    error => error.message === 'MOCK_LOST_RECEIPT' && error.companionWrite.reconciliationRequired && error.companionWrite.lockFile === lock
      && !error.companionWrite.published && error.companionWrite.temporaryFile === null);
    assert.equal(calls, 1); assert.equal(fs.statSync(path.join(fixture.directory, lock)).size, 0);
  } finally { fixture.finish(); }
});
test('lost temporary receipt preserves zero bytes while independently owned lock can be cleaned', async () => {
  const fixture = syntheticFixture(), value = await snapshot(); let calls = 0, temporary;
  try {
    assert.throws(() => writeCompanionObservation(fixture.directory, value, { verifyPrivateDirectory: dirProof, verifyPrivateFile: fileProof,
      createPrivateFile: pin => { calls++; const owned = mockCreator(pin); if (pin.purpose === 'LOCK') return owned;
        temporary = path.basename(pin.filePath); fs.closeSync(owned.descriptor); throw new Error('MOCK_TRUNCATED_RECEIPT'); } }),
    error => error.companionWrite.reconciliationRequired && error.companionWrite.lockFile === null
      && error.companionWrite.temporaryFile === temporary && !error.companionWrite.published);
    assert.equal(calls, 2); assert.deepEqual(fs.readdirSync(fixture.directory), [temporary]);
  } finally { fixture.finish(); }
});
test('primitive frozen and malformed post-create errors cannot erase uncertainty', async () => {
  let reads = 0; const accessorError = new Error('ACCESSOR_CREATE_ERROR');
  Object.defineProperty(accessorError, 'companionCode', { get() { reads++; throw new Error('GETTER_NOT_ALLOWED'); } });
  for (const thrown of [null, 'primitive', Object.freeze(new Error('FROZEN_CREATE_ERROR')),
    accessorError, Object.assign(new Error('MALFORMED_NONCREATED'), { companionCreate: { outcome: 'NOT_CREATED', reconciliationRequired: false } })]) {
    const fixture = syntheticFixture(), value = await snapshot(); let calls = 0;
    try {
      assert.throws(() => writeCompanionObservation(fixture.directory, value, { verifyPrivateDirectory: dirProof, verifyPrivateFile: fileProof,
        createPrivateFile: pin => { calls++; fs.closeSync(mockCreator(pin).descriptor); throw thrown; } }),
      error => error instanceof Error && error.companionWrite.reconciliationRequired === true && error.companionWrite.lockFile === lock);
      assert.equal(calls, 1); assert.equal(fs.statSync(path.join(fixture.directory, lock)).size, 0);
    } finally { fixture.finish(); }
  }
  assert.equal(reads, 0);
});
test('mismatched creator identity closes transferred fd and preserves unadopted empty path', async () => {
  const fixture = syntheticFixture(), value = await snapshot(); let owned;
  try {
    assert.throws(() => writeCompanionObservation(fixture.directory, value, { verifyPrivateDirectory: dirProof, verifyPrivateFile: fileProof,
      createPrivateFile: pin => { owned = mockCreator(pin); return { ...owned, ino: '0' }; } }),
    error => error.companionCode === 'COMPANION_CREATE_ADOPTION_DRIFT' && error.companionWrite.reconciliationRequired);
    assert.throws(() => fs.fstatSync(owned.descriptor), /EBADF/); assert.equal(fs.statSync(path.join(fixture.directory, lock)).size, 0);
  } finally { fixture.finish(); }
});
test('creator fd with changed descriptor proof cannot write payload or fall back', async () => {
  const fixture = syntheticFixture(), value = await snapshot(); let calls = 0;
  try {
    assert.throws(() => writeCompanionObservation(fixture.directory, value, { verifyPrivateDirectory: dirProof, verifyPrivateFile: fileProof,
      createPrivateFile: pin => { calls++; return { ...mockCreator(pin), descriptorSha256: 'd'.repeat(64) }; } }),
    error => error.companionCode === 'COMPANION_PRIVATE_FILE_PROOF_DRIFT' && error.companionWrite.reconciliationRequired);
    assert.equal(calls, 1); assert.equal(fs.statSync(path.join(fixture.directory, lock)).size, 0);
  } finally { fixture.finish(); }
});
test('creator capability rejects nonfunctions and option getters before any call', async () => {
  const fixture = syntheticFixture(), value = await snapshot(); let getters = 0;
  try {
    assert.throws(() => writeCompanionObservation(fixture.directory, value, { createPrivateFile: 'command' }), /PRIVATE_CREATOR_REQUIRED/);
    const options = { verifyPrivateDirectory: dirProof, verifyPrivateFile: fileProof };
    Object.defineProperty(options, 'createPrivateFile', { enumerable: true, get() { getters++; return mockCreator; } });
    assert.throws(() => writeCompanionObservation(fixture.directory, value, options), /INVALID_FIELDS/);
    assert.equal(getters, 0); assert.deepEqual(fs.readdirSync(fixture.directory), []);
  } finally { fixture.finish(); }
});

const fixtureDirectoryScript = String.raw`
$ErrorActionPreference='Stop'
$taskPath=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:RC_Q5_FIXTURE_ROOT))
$taskItem=Get-Item -LiteralPath $taskPath -Force
if(-not $taskItem.PSIsContainer -or ($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $taskItem.Name -cnotmatch '^rc-companion-private-test-[A-Za-z0-9]+$' -or @(Get-ChildItem -LiteralPath $taskPath -Force).Count -ne 0){throw 'Owned empty fixture'}
$taskAcl=[Security.AccessControl.DirectorySecurity]::new();$taskUser=[Security.Principal.WindowsIdentity]::GetCurrent().User
$taskAcl.SetOwner($taskUser);$taskAcl.SetAccessRuleProtection($true,$false)
foreach($taskWho in @($taskUser,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){$taskAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($taskWho,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}
Set-Acl -LiteralPath $taskPath -AclObject $taskAcl
`;
function finiteFixtureError(value, fallback) {
  let code = null, creation = null;
  try { if (value && (typeof value === 'object' || typeof value === 'function')) {
    const own = Object.getOwnPropertyDescriptors(value); code = own.companionCode?.value ?? own.message?.value;
    creation = own.companionCreate?.value;
  } } catch {}
  const result = new Error(typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(code) ? code : fallback);
  try { if (creation && Object.getPrototypeOf(creation) === Object.prototype) {
    const fields = Object.getOwnPropertyDescriptors(creation), keys = Reflect.ownKeys(fields);
    const names = keys.every(key => typeof key === 'string') ? keys.sort().join(',') : '';
    if (names === 'basename,outcome,purpose,reconciliationRequired' && Object.values(fields).every(field => Object.hasOwn(field, 'value') && field.enumerable === true)
      && ['NOT_CREATED', 'NOT_CREATED_COLLISION', 'CreatedButOpenUncertain'].includes(fields.outcome.value)
      && typeof fields.reconciliationRequired.value === 'boolean' && ['LOCK', 'TEMP', 'TEST_BINDING'].includes(fields.purpose.value)
      && typeof fields.basename.value === 'string' && (fields.basename.value === lock || fields.basename.value === 'commander-binding.json'
        || /^\.commander-companion-[a-f0-9-]{36}\.tmp$/.test(fields.basename.value))) result.companionCreate = {
          outcome: fields.outcome.value, reconciliationRequired: fields.reconciliationRequired.value,
          basename: fields.basename.value, purpose: fields.purpose.value };
  } } catch {}
  return result;
}
function finishWithPrimary(finish, hasPrimary, primary) {
  let cleanup;
  try { finish(); } catch (error) { cleanup = finiteFixtureError(error, 'Q5_FIXTURE_CLEANUP_UNPROVEN'); }
  const first = hasPrimary ? finiteFixtureError(primary, 'Q5_FIXTURE_PRIMARY_UNPROVEN') : null;
  if (first && cleanup) throw new AggregateError([first, cleanup], 'Q5_FIXTURE_PRIMARY_AND_CLEANUP_FAILURE', { cause: first });
  if (first) throw first;
  if (cleanup) throw cleanup;
}
function runOwnedFixture(fixture, callback) {
  let primary, hasPrimary = false;
  try { callback(); } catch (error) { primary = error; hasPrimary = true; }
  finishWithPrimary(() => fixture.finish(), hasPrimary, primary);
}
test('collector preserves finite primary and cleanup codes without mutating unsafe thrown values', () => {
  let reads = 0; const accessor = new Error('PRIMARY_ACCESSOR');
  Object.defineProperty(accessor, 'companionCode', { get() { reads++; throw new Error('GETTER_FORBIDDEN'); } });
  const metadataProxy = new Error('PRIMARY_METADATA_PROXY');
  metadataProxy.companionCreate = new Proxy({}, { getPrototypeOf() { throw new Error('PROXY_TRAP'); } });
  const nestedAccessor = new Error('PRIMARY_NESTED_ACCESSOR');
  nestedAccessor.companionCreate = { outcome: 'CreatedButOpenUncertain', reconciliationRequired: true, purpose: 'LOCK' };
  Object.defineProperty(nestedAccessor.companionCreate, 'basename', { enumerable: true, get() { reads++; throw new Error('NESTED_GETTER_FORBIDDEN'); } });
  const cases = [
    { label: 'ordinary', primary: new Error('PRIMARY_CODE'), expected: 'PRIMARY_CODE' },
    { label: 'frozen', primary: Object.freeze(new Error('PRIMARY_FROZEN')), expected: 'PRIMARY_FROZEN' },
    { label: 'null', primary: null, expected: 'Q5_FIXTURE_PRIMARY_UNPROVEN' },
    { label: 'primitive', primary: 'primitive', expected: 'Q5_FIXTURE_PRIMARY_UNPROVEN' },
    { label: 'accessor', primary: accessor, expected: 'PRIMARY_ACCESSOR' },
    { label: 'metadata-proxy', primary: metadataProxy, expected: 'PRIMARY_METADATA_PROXY' },
    { label: 'nested-accessor', primary: nestedAccessor, expected: 'PRIMARY_NESTED_ACCESSOR' }
  ], completed = [];
  for (const { label, primary, expected } of cases) {
    assert.throws(() => finishWithPrimary(() => { throw new Error('CLEANUP_CODE'); }, true, primary), error => {
      assert.ok(error instanceof AggregateError); assert.equal(error.message, 'Q5_FIXTURE_PRIMARY_AND_CLEANUP_FAILURE');
      assert.equal(error.errors.length, 2); assert.equal(error.errors[0].message, expected);
      assert.equal(error.errors[1].message, 'CLEANUP_CODE'); assert.equal(error.cause, error.errors[0]);
      return true;
    });
    completed.push(label);
  }
  assert.deepEqual(completed, ['ordinary', 'frozen', 'null', 'primitive', 'accessor', 'metadata-proxy', 'nested-accessor']);
  assert.equal(reads, 0);
  console.log('Q5_COLLECTOR_CASES ' + JSON.stringify({ completed, getterReads: reads, nativeCreatorInvoked: false }));
});
test('collector reports cleanup-only failure and does not mask a primary-only failure', () => {
  assert.throws(() => finishWithPrimary(() => { throw new Error('CLEANUP_ONLY'); }, false), /CLEANUP_ONLY/);
  assert.throws(() => finishWithPrimary(() => {}, true, new Error('PRIMARY_ONLY')), /PRIMARY_ONLY/);
  assert.doesNotThrow(() => finishWithPrimary(() => {}, false));
});
function actualFixture() {
  console.log('Q5_CREATE_RUNTIME ' + JSON.stringify({ node: process.versions.node, uv: process.versions.uv,
    platform: process.platform, creatorStatus: 'NOT_YET_INVOKED', parentNodeTokenOwner: 'UNPROVEN' }));
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-companion-private-test-')));
  const before = fs.lstatSync(directory, { bigint: true }), owned = new Map();
  const setup = spawnSync('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', fixtureDirectoryScript], {
    env: { ...process.env, RC_Q5_FIXTURE_ROOT: Buffer.from(directory).toString('base64') },
    windowsHide: true, shell: false, encoding: 'utf8', timeout: 5000, maxBuffer: 8192 });
  assert.equal(setup.status, 0, 'Owned empty fixture setup must succeed'); assert.equal(setup.stderr, '');
  const parentProof = verifyCompanionPrivateDirectory({ directory, dev: before.dev.toString(), ino: before.ino.toString() });
  return { directory, create(purpose = 'LOCK') {
    const filePath = path.join(directory, purpose === 'LOCK' ? lock : 'commander-binding.json');
    const result = createCompanionPrivateFileWindows({ filePath, directory, dev: before.dev.toString(), ino: before.ino.toString(),
      descriptorSha256: parentProof.descriptorSha256, purpose });
    owned.set(filePath, { ...result, hash: hash(Buffer.alloc(0)), byteCount: 0 }); return { filePath, ...result };
  }, wrote(filePath, data) {
    assert.ok(Buffer.isBuffer(data) && data.length <= 65536); assert.ok(owned.has(filePath));
    owned.get(filePath).hash = hash(data); owned.get(filePath).byteCount = data.length;
  }, finish() {
    const after = fs.lstatSync(directory, { bigint: true }); assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino);
    const listing = fs.readdirSync(directory).map(name => path.join(directory, name));
    if (listing.some(filePath => !owned.has(filePath))) throw new Error('Q5_FIXTURE_RECONCILIATION_REQUIRED');
    for (const filePath of listing) {
      const pin = owned.get(filePath), current = fs.lstatSync(filePath, { bigint: true });
      assert.equal(current.dev.toString(), pin.dev); assert.equal(current.ino.toString(), pin.ino); assert.equal(current.nlink, 1n);
      assert.equal(verifyCompanionPrivateFile({ filePath, dev: pin.dev, ino: pin.ino }).descriptorSha256, pin.descriptorSha256);
      assert.ok(Number.isSafeInteger(pin.byteCount) && pin.byteCount >= 0 && pin.byteCount <= 65536);
      const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const opened = fs.fstatSync(descriptor, { bigint: true }), bytes = Buffer.alloc(pin.byteCount + 1);
        assert.ok(opened.isFile() && !current.isSymbolicLink() && current.isFile());
        assert.equal(opened.dev.toString(), pin.dev); assert.equal(opened.ino.toString(), pin.ino); assert.equal(opened.nlink, 1n);
        assert.equal(opened.size, BigInt(pin.byteCount)); assert.equal(current.size, opened.size);
        assert.equal(opened.mtimeNs, current.mtimeNs); assert.equal(opened.ctimeNs, current.ctimeNs);
        const count = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
        assert.equal(count, pin.byteCount); assert.equal(hash(bytes.subarray(0, count)), pin.hash);
        const final = fs.lstatSync(filePath, { bigint: true });
        assert.ok(final.isFile() && !final.isSymbolicLink());
        assert.equal(final.dev, opened.dev); assert.equal(final.ino, opened.ino); assert.equal(final.nlink, 1n);
        assert.equal(final.size, opened.size); assert.equal(final.mtimeNs, opened.mtimeNs); assert.equal(final.ctimeNs, opened.ctimeNs);
        fs.unlinkSync(filePath);
      } finally { fs.closeSync(descriptor); }
    }
    const finalParent = fs.lstatSync(directory, { bigint: true });
    if (!finalParent.isDirectory() || finalParent.isSymbolicLink() || finalParent.dev !== before.dev || finalParent.ino !== before.ino
      || finalParent.nlink !== before.nlink || fs.realpathSync.native(directory) !== directory) throw new Error('Q5_FIXTURE_PARENT_DRIFT');
    fs.rmdirSync(directory);
  } };
}
test('actual empty NTFS fixture proves Node native handle identity and strict ACL parity before any payload', { skip: process.platform !== 'win32' }, () => {
  const fixture = actualFixture();
  runOwnedFixture(fixture, () => {
    const created = fixture.create();
    try {
      const stat = fs.fstatSync(created.descriptor, { bigint: true });
      assert.equal(stat.dev.toString(), created.dev); assert.equal(stat.ino.toString(), created.ino); assert.equal(stat.size, 0n); assert.equal(stat.nlink, 1n);
      assert.equal(verifyCompanionPrivateFile({ filePath: created.filePath, dev: created.dev, ino: created.ino }).descriptorSha256, created.descriptorSha256);
      console.log('Q5_CREATE_PARITY ' + JSON.stringify({ node: process.versions.node, uv: process.versions.uv,
        nativeNodeIdentityMatches: true, initialBytes: 0, strictOwnerPrivate: true, actualDescriptorMatches: true, parentNodeTokenOwner: 'UNPROVEN' }));
    } finally { fs.closeSync(created.descriptor); }
  });
});
test('actual CreateNew collision preserves existing identity descriptor and bytes without takeover', { skip: process.platform !== 'win32' }, () => {
  const fixture = actualFixture();
  runOwnedFixture(fixture, () => {
    const created = fixture.create(), bytes = Buffer.from('owned collision fixture');
    try { fs.writeFileSync(created.descriptor, bytes); fs.fsyncSync(created.descriptor); fixture.wrote(created.filePath, bytes); }
    finally { fs.closeSync(created.descriptor); }
    assert.throws(() => fixture.create(), error => error.companionCode === 'COMPANION_CREATE_COLLISION'
      && error.companionCreate.outcome === 'NOT_CREATED_COLLISION' && error.companionCreate.reconciliationRequired === false);
    assert.deepEqual(fs.readFileSync(created.filePath), bytes);
    const after = fs.lstatSync(created.filePath, { bigint: true }); assert.equal(after.dev.toString(), created.dev); assert.equal(after.ino.toString(), created.ino);
  });
});
