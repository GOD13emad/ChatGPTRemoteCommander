import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeAdmission} from '../src/runtime-admission.mjs';

function fixture(platform = 'win32', version = '0.10.15', isolated = false) {
  const owner = {platform, host: platform === 'win32' ? 'TEST-WINDOWS' : 'test-linux', username: 'test-owner'};
  const root = platform === 'win32' ? 'C:\\Test Product' : '/tmp/test-product';
  const sep = platform === 'win32' ? '\\' : '/';
  const core = {version, port: 48832, path: root, configPath: root + sep + 'config.json', configSha256: 'a'.repeat(64), routePath: root + sep + 'route.json', routeSha256: 'b'.repeat(64)};
  const pin = {schema: 1, companionVersion: '1.1.2', owner, deviceName: 'TEST-COMMANDER', profile: {id: isolated ? 'secondary' : 'default', isolated}, core};
  const policy = {schema: 1, companionVersion: '1.1.2', allowedCoreVersions: ['0.10.8', '0.10.15'], configSchemas: {capabilityProfile: 4, durableWorkflow: 2}};
  const descriptor = {version: '1.1.2', owner: owner.username, core: structuredClone(core)};
  const status = {name: 'chatgpt-remote-commander', version, deviceName: pin.deviceName, platform, port: core.port, configSha256: core.configSha256, instance: {profile: pin.profile.id, isolated: pin.profile.isolated}, configSchema: {...policy.configSchemas}};
  return {pin, policy, descriptor, status, identity: {...owner}};
}
const code = expected => error => error?.code === expected;
const args = f => ({descriptor: f.descriptor, identity: f.identity, maxTicks: 1});

for (const platform of ['win32', 'linux']) for (const version of ['0.10.8', '0.10.15']) for (const isolated of [false, true]) {
  test(`admit reviewed ${platform}/${version}/isolated=${isolated}`, () => {
    const f = fixture(platform, version, isolated); const a = createRuntimeAdmission(f);
    assert.equal(a.checkRequest(args(f)).coreVersion, version);
    assert.equal(a.checkStatus(f.status).profileId, f.pin.profile.id);
  });
}
for (const [name, mutate, error] of [
  ['unsupported exact version', f => {f.pin.core.version = '0.10.16';}, 'RUNTIME_VERSION_NOT_REVIEWED'],
  ['empty version allowlist', f => {f.policy.allowedCoreVersions = [];}, 'RUNTIME_POLICY'],
  ['duplicate version', f => {f.policy.allowedCoreVersions.push('0.10.15');}, 'RUNTIME_POLICY'],
  ['wildcard version', f => {f.policy.allowedCoreVersions = ['0.10.*'];}, 'RUNTIME_POLICY'],
  ['prerelease', f => {f.policy.allowedCoreVersions = ['0.10.15-rc.1'];}, 'RUNTIME_POLICY'],
  ['unknown policy field', f => {f.policy.autoAccept = true;}, 'RUNTIME_POLICY_FIELDS'],
  ['companion mismatch', f => {f.pin.companionVersion = '1.1.1';}, 'RUNTIME_COMPANION_VERSION'],
  ['unsupported OS', f => {f.pin.owner.platform = 'darwin';}, 'RUNTIME_OWNER'],
  ['empty user', f => {f.pin.owner.username = '';}, 'RUNTIME_OWNER'],
  ['invalid core port', f => {f.pin.core.port = 0;}, 'RUNTIME_CORE'],
  ['malformed config hash', f => {f.pin.core.configSha256 = 'a';}, 'RUNTIME_CORE'],
  ['unknown core field', f => {f.pin.core.bypass = true;}, 'RUNTIME_CORE_FIELDS'],
  ['relative source path', f => {f.pin.core.path = 'relative';}, 'RUNTIME_CORE_PATH'],
  ['relative config path', f => {f.pin.core.configPath = 'config.json';}, 'RUNTIME_CORE_PATH'],
  ['NUL path', f => {f.pin.core.routePath += '\0';}, 'RUNTIME_CORE_PATH'],
  ['profile boolean string', f => {f.pin.profile.isolated = 'false';}, 'RUNTIME_PROFILE'],
  ['default marked isolated', f => {f.pin.profile.isolated = true;}, 'RUNTIME_PROFILE'],
  ['secondary marked unisolated', f => {f.pin.profile.id = 'secondary';}, 'RUNTIME_PROFILE'],
  ['unknown policy schema', f => {f.policy.schema = 2;}, 'RUNTIME_POLICY'],
]) test(`deny policy/pin: ${name}`, () => {const f = fixture(); mutate(f); assert.throws(() => createRuntimeAdmission(f), code(error));});

for (const [name, mutate, error] of [
  ['old worker version against new registry', f => {f.descriptor.core.version = '0.10.8';}, 'RUNTIME_DESCRIPTOR_CORE_DRIFT'],
  ['config hash', f => {f.descriptor.core.configSha256 = 'c'.repeat(64);}, 'RUNTIME_DESCRIPTOR_CORE_DRIFT'],
  ['route hash', f => {f.descriptor.core.routeSha256 = 'd'.repeat(64);}, 'RUNTIME_DESCRIPTOR_CORE_DRIFT'],
  ['port', f => {f.descriptor.core.port++;}, 'RUNTIME_DESCRIPTOR_CORE_DRIFT'],
  ['path', f => {f.descriptor.core.path += '-other';}, 'RUNTIME_DESCRIPTOR_CORE_DRIFT'],
  ['descriptor owner', f => {f.descriptor.owner = 'someone-else';}, 'RUNTIME_DESCRIPTOR_OWNER'],
  ['descriptor companion', f => {f.descriptor.version = '1.1.1';}, 'RUNTIME_COMPANION_VERSION'],
  ['local host', f => {f.identity.host = 'other-host';}, 'RUNTIME_LOCAL_IDENTITY'],
  ['local user', f => {f.identity.username = 'other-user';}, 'RUNTIME_LOCAL_IDENTITY'],
  ['local OS', f => {f.identity.platform = 'linux';}, 'RUNTIME_LOCAL_IDENTITY'],
]) test(`deny request: ${name}`, () => {const f = fixture(); const a = createRuntimeAdmission(f); mutate(f); assert.throws(() => a.checkRequest(args(f)), code(error));});

for (const [field, value] of [['name','other'],['version','0.10.8'],['deviceName','other'],['platform','linux'],['port',48833],['configSha256','c'.repeat(64)]]) {
  test(`deny status ${field} drift`, () => {const f=fixture();const a=createRuntimeAdmission(f);f.status[field]=value;assert.throws(()=>a.checkStatus(f.status),code('RUNTIME_STATUS_IDENTITY'));});
}
test('deny cross-profile even on same host and core', () => {const f=fixture();const a=createRuntimeAdmission(f);f.status.instance={profile:'secondary',isolated:true};assert.throws(()=>a.checkStatus(f.status),code('RUNTIME_STATUS_PROFILE'));});
test('deny missing status', () => {assert.throws(()=>createRuntimeAdmission(fixture()).checkStatus(null),code('RUNTIME_STATUS_SHAPE'));});
test('deny schema mismatch', () => {const f=fixture();const a=createRuntimeAdmission(f);f.status.configSchema.durableWorkflow=3;assert.throws(()=>a.checkStatus(f.status),code('RUNTIME_STATUS_SCHEMA'));});
test('windows identity comparison ignores letter case only', () => {const f=fixture();const a=createRuntimeAdmission(f);f.identity.host=f.identity.host.toLowerCase();f.identity.username=f.identity.username.toUpperCase();a.checkRequest(args(f));});
test('linux username comparison is exact', () => {const f=fixture('linux');const a=createRuntimeAdmission(f);f.identity.username=f.identity.username.toUpperCase();assert.throws(()=>a.checkRequest(args(f)),code('RUNTIME_LOCAL_IDENTITY'));});
test('reject unsafe tick counts', () => {const f=fixture();const a=createRuntimeAdmission(f);for(const t of [0,66,1.5,'1',NaN]) assert.throws(()=>a.checkRequest({...args(f),maxTicks:t}),code('RUNTIME_TICKS'));});
test('policy and pins are snapshotted, caller cannot change admission later', () => {const f=fixture();const a=createRuntimeAdmission(f);f.pin.core.version='0.10.16';f.policy.allowedCoreVersions.push('0.10.16');assert.equal(a.checkRequest(args(f)).coreVersion,'0.10.15');});
test('getter in policy is rejected without execution', () => {const f=fixture();let calls=0;Object.defineProperty(f.policy,'schema',{get(){calls++;return 1;},enumerable:true});assert.throws(()=>createRuntimeAdmission(f),code('RUNTIME_DATA'));assert.equal(calls,0);});
test('cycle is rejected', () => {const f=fixture();f.policy.cycle=f.policy;assert.throws(()=>createRuntimeAdmission(f),code('RUNTIME_DATA'));});
test('admission return value cannot be changed', () => {const f=fixture();assert.ok(Object.isFrozen(createRuntimeAdmission(f).checkRequest(args(f))));});

test('worker wrapper uses pinned version for both pre/post readback', async () => {
  const f=fixture();const a=createRuntimeAdmission(f);const calls=[];let work=0;
  const result=await a.run({...args(f),readStatus:async expected=>{calls.push(expected.coreVersion);return f.status;},execute:async context=>{work++;return {value:context.coreVersion};}});
  assert.deepEqual(calls,['0.10.15','0.10.15']);assert.equal(work,1);assert.equal(result.value,'0.10.15');
});
test('failed admission executes no status request and no worker', async () => {
  const f=fixture();const a=createRuntimeAdmission(f);f.descriptor.core.version='0.10.8';let calls=0;
  await assert.rejects(a.run({...args(f),readStatus:async()=>{calls++;return f.status;},execute:async()=>{calls++;}}),code('RUNTIME_DESCRIPTOR_CORE_DRIFT'));assert.equal(calls,0);
});
test('bad pre-status executes no worker', async () => {
  const f=fixture();const a=createRuntimeAdmission(f);f.status.version='0.10.8';let work=0;
  await assert.rejects(a.run({...args(f),readStatus:async()=>f.status,execute:async()=>{work++;}}),code('RUNTIME_STATUS_IDENTITY'));assert.equal(work,0);
});
test('post-status drift never returns success and never retries work', async () => {
  const f=fixture();const a=createRuntimeAdmission(f);let reads=0,work=0;
  await assert.rejects(a.run({...args(f),readStatus:async()=>{reads++;return {...f.status,version:reads===1?'0.10.15':'0.10.8'};},execute:async()=>{work++;return 'done';}}),error=>error.code==='RUNTIME_POSTCHECK_FAILED'&&error.effectMayHaveOccurred===true&&error.cause.code==='RUNTIME_STATUS_IDENTITY');assert.equal(work,1);assert.equal(reads,2);
});
test('primary worker failure is preserved even when postcheck also fails', async () => {
  const f=fixture();const a=createRuntimeAdmission(f);let reads=0,work=0;const original=Object.assign(new Error('worker failure'),{code:'ORIGINAL_WORKER_FAILURE'});
  await assert.rejects(a.run({...args(f),readStatus:async()=>{if(++reads===2)throw new Error('offline');return f.status;},execute:async()=>{work++;throw original;}}),error=>error.code==='RUNTIME_WORKER_FAILED'&&error.cause===original&&error.postcheckError?.message==='offline');assert.equal(work,1);
});
test('one admission wrapper never overlaps itself', async () => {
  const f=fixture();const a=createRuntimeAdmission(f);let unblock;const gate=new Promise(r=>{unblock=r;});
  const first=a.run({...args(f),readStatus:async()=>{await gate;return f.status;},execute:async()=>42});
  await assert.rejects(a.run({...args(f),readStatus:async()=>f.status,execute:async()=>0}),code('RUNTIME_BUSY'));unblock();assert.equal(await first,42);
});
test('failed worker latches admission until explicit fresh reconciliation', async () => {
  const f=fixture();const a=createRuntimeAdmission(f);await assert.rejects(a.run({...args(f),readStatus:async()=>f.status,execute:async()=>{throw new Error('uncertain');}}));
  await assert.rejects(a.run({...args(f),readStatus:async()=>f.status,execute:async()=>0}),code('RUNTIME_RECONCILIATION_REQUIRED'));
});

test('execute receives immutable admitted request, not caller-mutated object', async () => {
  const f=fixture();const a=createRuntimeAdmission(f);
  const value=await a.run({...args(f),readStatus:async()=>{f.descriptor.core.version='0.10.16';return f.status;},execute:async(context,request)=>{assert.ok(Object.isFrozen(request.descriptor.core));return request.descriptor.core.version;}});
  assert.equal(value,'0.10.15');
});
test('unknown profile is not admitted through arbitrary status metadata', () => {
  const f=fixture();const a=createRuntimeAdmission(f);f.status.instance={profile:'default',isolated:'false'};
  assert.throws(()=>a.checkStatus(f.status),code('RUNTIME_STATUS_PROFILE'));
});
test('malformed callbacks fail before any side effect', async () => {
  const f=fixture();const a=createRuntimeAdmission(f);
  await assert.rejects(a.run({...args(f),readStatus:5,execute:async()=>0}),code('RUNTIME_CALLBACKS'));
});
