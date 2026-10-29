import test from 'node:test';
import assert from 'node:assert/strict';
import {
  V2_ROUTE_CONTRACT_VERSION, normalizeV2Route, assertV2CallerBinding,
  v2ResourceLeaseKey, v2OperationKey
} from '../src/v2-routing-contract.mjs';

const route = (changes = {}) => ({
  hostId: 'emad-win', principalId: 'S-1-5-21-1001', profileId: 'emad',
  conversationId: 'chat-a', operationId: 'run.001',
  target: { kind: 'workflow-root', id: 'root-a' }, ...changes
});
const observed = { hostId: 'emad-win', principalId: 'S-1-5-21-1001', profileId: 'emad', conversationId: 'chat-a' };

test('V2 contract revision remains explicit', () => {
  assert.equal(V2_ROUTE_CONTRACT_VERSION, 1);
});
test('exact route validated and frozen without permissions or I/O', () => {
  const parsed = normalizeV2Route(route());
  assert.equal(parsed.target.kind, 'workflow-root');
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.target));
});
test('exact authenticated caller binding accepted', () => {
  assert.equal(assertV2CallerBinding(route(), observed).conversationId, 'chat-a');
});
test('foreign chat, principal, profile, or host cannot claim a route', () => {
  for (const field of Object.keys(observed)) {
    assert.throws(() => assertV2CallerBinding(route(), { ...observed, [field]: 'foreign' }), { code: 'V2_ROUTE_CALLER_MISMATCH' });
  }
});
test('unknown or missing keys are rejected, not silently defaulted', () => {
  for (const value of [ { ...route(), grant: 'FULL_POWER' }, { ...route(), operationId: undefined }, (() => { const x = route(); delete x.profileId; return x; })() ]) {
    assert.throws(() => normalizeV2Route(value));
  }
  assert.throws(() => assertV2CallerBinding(route(), { ...observed, extra: true }), { code: 'V2_ROUTE_UNKNOWN_OR_MISSING_FIELD' });
});
test('unattributed or malformed identities fail closed', () => {
  for (const value of ['', null, undefined, 'x/y', '../a', '..', 123, 'x'.repeat(129)]) {
    assert.throws(() => normalizeV2Route(route({ conversationId: value })), { code: 'V2_ROUTE_INVALID_ID' });
  }
});
test('unsupported targets and unscoped targets are refused', () => {
  assert.throws(() => normalizeV2Route(route({ target: { kind: 'physical-desktop', id: 'default' } })), { code: 'V2_ROUTE_INVALID_TARGET' });
  assert.throws(() => normalizeV2Route(route({ target: { kind: 'desktop-seat' } })), { code: 'V2_ROUTE_UNKNOWN_OR_MISSING_FIELD' });
  assert.throws(() => normalizeV2Route(route({ target: { kind: 'browser-target', id: 'tab-a', cookies: true } })), { code: 'V2_ROUTE_UNKNOWN_OR_MISSING_FIELD' });
});
test('two conversations on one root share the same lease but not operation receipt', () => {
  const a = route();
  const b = route({ conversationId: 'chat-b' });
  assert.equal(v2ResourceLeaseKey(a), v2ResourceLeaseKey(b));
  assert.notEqual(v2OperationKey(a), v2OperationKey(b));
});
test('one conversation across hosts has separate resource leases and receipts', () => {
  const a = route();
  const b = route({ hostId: 'mmz-linux' });
  assert.notEqual(v2ResourceLeaseKey(a), v2ResourceLeaseKey(b));
  assert.notEqual(v2OperationKey(a), v2OperationKey(b));
});
test('profile- and principal-distinct receipts cannot be cross-claimed', () => {
  const a = route();
  for (const changes of [{ profileId: 'saeed' }, { principalId: 'uid:1000' }, { operationId: 'run.002' }]) {
    assert.notEqual(v2OperationKey(a), v2OperationKey(route(changes)));
  }
});
test('resource type forms separate lease domain', () => {
  assert.notEqual(v2ResourceLeaseKey(route()), v2ResourceLeaseKey(route({ target: { kind: 'browser-target', id: 'root-a' } })));
});
test('tuple encoding resists separator collisions in IDs', () => {
  const a = route({ hostId: 'a:b', principalId: 'c' });
  const b = route({ hostId: 'a', principalId: 'b:c' });
  assert.notEqual(v2OperationKey(a), v2OperationKey(b));
});
