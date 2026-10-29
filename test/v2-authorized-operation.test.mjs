import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MutationIdempotencyStore } from '../src/mutation-idempotency.mjs';
import { executeV2BoundOperation } from '../src/v2-authorized-operation.mjs';
const route = (change = {}) => ({
  hostId: 'emad-win', principalId: 'owner', profileId: 'emad',
  conversationId: 'chat-a', operationId: 'op-a',
  target: { kind: 'workflow-root', id: 'project-a' }, ...change
});
const identity = r => ({
  hostId: r.hostId, principalId: r.principalId,
  profileId: r.profileId, conversationId: r.conversationId
});
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-v2-authorized-'));
  const receiptStore = new MutationIdempotencyStore({ directory: dir, scope: 'test-profile' });
  let current = identity(route()), allowed = true, effects = 0, leases = 0;
  const queues = new Map();
  const services = {
    observedCaller: async () => current,
    hasGrant: async () => allowed,
    withLease: async (key, callback) => {
      const prior = queues.get(key) ?? Promise.resolve();
      let release;
      const hold = new Promise(resolve => { release = resolve; });
      const promise = prior.then(() => hold);
      queues.set(key, promise);
      await prior;
      leases++;
      try { return await callback(); }
      finally { release(); if (queues.get(key) === promise) queues.delete(key); }
    },
    receiptStore,
    execute: async r => { effects++; return { success: true, conversation: r.conversationId, effects }; }
  };
  return {
    services, get effects() { return effects; }, get leases() { return leases; },
    setPrincipal: value => { current = value; },
    revoke: () => { allowed = false; },
    grant: () => { allowed = true; },
    close: () => { receiptStore.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  };
}
test('an exact authorized operation uses durable existing receipt store', async () => {
  const f = fixture();
  try {
    const a = await executeV2BoundOperation(route(), f.services, 'workflow_call');
    const b = await executeV2BoundOperation(route(), f.services, 'workflow_call');
    assert.deepEqual(a, b);
    assert.equal(f.effects, 1);
    assert.equal(f.services.receiptStore.status().states.SUCCEEDED, 1);
  } finally { f.close(); }
});
test('missing authoritative dependencies fail before any effect', async () => {
  const f = fixture();
  try {
    for (const field of ['observedCaller', 'hasGrant', 'withLease', 'execute', 'receiptStore']) {
      const bad = { ...f.services }; delete bad[field];
      await assert.rejects(executeV2BoundOperation(route(), bad, 'workflow_call'), { code: 'V2_TRUSTED_DEPENDENCY_REQUIRED' });
    }
    assert.equal(f.effects, 0);
    assert.equal(f.leases, 0);
  } finally { f.close(); }
});
test('caller identity is observed, not borrowed from route or request headers', async () => {
  const f = fixture();
  try {
    f.setPrincipal({ ...identity(route()), conversationId: 'forged-other-chat' });
    await assert.rejects(executeV2BoundOperation(route(), f.services, 'workflow_call'), { code: 'V2_ROUTE_CALLER_MISMATCH' });
    assert.equal(f.effects, 0);
    assert.equal(f.leases, 0);
  } finally { f.close(); }
});
test('permission denial precedes receipt reservation and lease admission', async () => {
  const f = fixture();
  try {
    f.revoke();
    await assert.rejects(executeV2BoundOperation(route(), f.services, 'workflow_call'), { code: 'V2_GRANT_REQUIRED' });
    assert.equal(f.leases, 0);
    assert.deepEqual(f.services.receiptStore.status().states, {});
    f.grant();
    await executeV2BoundOperation(route(), f.services, 'workflow_call');
    assert.equal(f.effects, 1);
  } finally { f.close(); }
});
test('revocation while waiting for lease prevents effect and receipt', async () => {
  const f = fixture();
  try {
    let entered; const started = new Promise(ok => entered = ok);
    let release; const blocked = new Promise(ok => release = ok);
    f.services.withLease = async (_key, cb) => { entered(); await blocked; return cb(); };
    const pending = executeV2BoundOperation(route(), f.services, 'workflow_call');
    await started;
    f.revoke(); release();
    await assert.rejects(pending, { code: 'V2_GRANT_REQUIRED' });
    assert.equal(f.effects, 0);
    assert.deepEqual(f.services.receiptStore.status().states, {});
  } finally { f.close(); }
});
test('session identity change during scheduling prevents original request effect', async () => {
  const f = fixture();
  try {
    const base = f.services.withLease;
    f.services.withLease = async (key, cb) => {
      f.setPrincipal({ ...identity(route()), profileId: 'other' });
      return base(key, cb);
    };
    await assert.rejects(executeV2BoundOperation(route(), f.services, 'workflow_call'), { code: 'V2_ROUTE_CALLER_MISMATCH' });
    assert.equal(f.effects, 0);
  } finally { f.close(); }
});
test('a revoked receipt cannot be replayed just because it previously succeeded', async () => {
  const f = fixture();
  try {
    await executeV2BoundOperation(route(), f.services, 'workflow_call');
    f.revoke();
    await assert.rejects(executeV2BoundOperation(route(), f.services, 'workflow_call'), { code: 'V2_GRANT_REQUIRED' });
    assert.equal(f.effects, 1);
  } finally { f.close(); }
});
test('two chats sharing one target cannot be promoted under another chat identity', async () => {
  const f = fixture();
  try {
    await executeV2BoundOperation(route(), f.services, 'workflow_call');
    await assert.rejects(executeV2BoundOperation(route({ conversationId: 'chat-b', operationId: 'op-b' }), f.services, 'workflow_call'), { code: 'V2_ROUTE_CALLER_MISMATCH' });
    f.setPrincipal(identity(route({ conversationId: 'chat-b' })));
    const b = await executeV2BoundOperation(route({ conversationId: 'chat-b', operationId: 'op-b' }), f.services, 'workflow_call');
    assert.equal(b.conversation, 'chat-b');
    assert.equal(f.effects, 2);
  } finally { f.close(); }
});
test('the same operation id cannot be reused for a conflicting target or tool', async () => {
  const f = fixture();
  try {
    await executeV2BoundOperation(route(), f.services, 'workflow_call');
    await assert.rejects(executeV2BoundOperation(route({ target: { kind: 'browser-target', id: 'tab-a' } }), f.services, 'workflow_call'), /MUTATION_REQUEST_ID_CONFLICT/);
    await assert.rejects(executeV2BoundOperation(route(), f.services, 'write_text'), /MUTATION_REQUEST_ID_CONFLICT/);
    assert.equal(f.effects, 1);
  } finally { f.close(); }
});
test('failed effect is UNCERTAIN; no blind retry', async () => {
  const f = fixture();
  try {
    f.services.execute = async () => { throw Error('transport dropped'); };
    await assert.rejects(executeV2BoundOperation(route(), f.services, 'workflow_call'), /transport dropped/);
    f.services.execute = async () => { throw Error('wrong replay'); };
    await assert.rejects(executeV2BoundOperation(route(), f.services, 'workflow_call'), /MUTATION_OUTCOME_UNCERTAIN/);
    assert.equal(f.services.receiptStore.status().states.UNCERTAIN, 1);
  } finally { f.close(); }
});

test('two distinct chats serialize the same resource without sharing receipts', async () => {
  const f = fixture();
  try {
    const a = route({ conversationId: 'chat-a', operationId: 'once-a' });
    const b = route({ conversationId: 'chat-b', operationId: 'once-b' });
    let active = 0, peak = 0;
    let entered;
    const firstStarted = new Promise(resolve => { entered = resolve; });
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    let effectCount = 0;
    const services = {
      ...f.services,
      execute: async r => {
        active++;
        peak = Math.max(peak, active);
        const n = ++effectCount;
        if (n === 1) { entered(); await hold; }
        active--;
        return { chat: r.conversationId, n };
      }
    };
    const first = executeV2BoundOperation(a, { ...services, observedCaller: async () => identity(a) }, 'workflow_call');
    await firstStarted;
    const second = executeV2BoundOperation(b, { ...services, observedCaller: async () => identity(b) }, 'workflow_call');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(effectCount, 1);
    release();
    const [ra, rb] = await Promise.all([first, second]);
    assert.equal(ra.chat, 'chat-a');
    assert.equal(rb.chat, 'chat-b');
    assert.equal(effectCount, 2);
    assert.equal(peak, 1);
    assert.equal(f.services.receiptStore.status().states.SUCCEEDED, 2);
  } finally { f.close(); }
});
test('different hosts do not share a lease identity', async () => {
  const { v2ResourceLeaseKey } = await import('../src/v2-routing-contract.mjs');
  assert.notEqual(v2ResourceLeaseKey(route()), v2ResourceLeaseKey(route({ hostId: 'mmz-linux' })));
});
