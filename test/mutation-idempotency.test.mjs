import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MutationIdempotencyStore } from '../src/mutation-idempotency.mjs';

test('mutation idempotency replays durable success without repeating effect', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-mutation-idem-'));
  try {
    let effects = 0;
    let store = new MutationIdempotencyStore({ directory: root, scope: 'test-scope' });
    const input = { path: 'a.txt', content: 'x' };
    const first = await store.execute({ requestId: 'req-1', tool: 'write_text', input }, async () => {
      effects += 1; return { ok: true, effects };
    });
    assert.deepEqual(first, { ok: true, effects: 1 });
    const retry = await store.execute({ requestId: 'req-1', tool: 'write_text', input }, async () => {
      effects += 1; return { ok: true, effects };
    });
    assert.deepEqual(retry, first);
    assert.equal(effects, 1);
    store.close();

    store = new MutationIdempotencyStore({ directory: root, scope: 'test-scope' });
    const afterRestart = await store.execute({ requestId: 'req-1', tool: 'write_text', input }, async () => {
      effects += 1; return { ok: true, effects };
    });
    assert.deepEqual(afterRestart, first);
    assert.equal(effects, 1);
    store.close();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('mutation idempotency conflicts changed input and fails closed after uncertain effect', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-mutation-idem-'));
  try {
    const store = new MutationIdempotencyStore({ directory: root, scope: 'test-scope' });
    let effects = 0;
    await assert.rejects(
      store.execute({ requestId: 'req-2', tool: 'send_terminal', input: { id: 't1', input: 'x' } }, async () => {
        effects += 1; throw new Error('simulated lost acknowledgement');
      }),
      /simulated lost acknowledgement/
    );
    await assert.rejects(
      store.execute({ requestId: 'req-2', tool: 'send_terminal', input: { id: 't1', input: 'x' } }, async () => {
        effects += 1; return { accepted: true };
      }),
      /MUTATION_OUTCOME_UNCERTAIN/
    );
    assert.equal(effects, 1);
    await assert.rejects(
      store.execute({ requestId: 'req-2', tool: 'send_terminal', input: { id: 't1', input: 'y' } }, async () => ({ accepted: true })),
      /MUTATION_REQUEST_ID_CONFLICT/
    );
    store.close();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});


test('provably invalid pre-effect input is rejected without PREPARED or UNCERTAIN states', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-mutation-preflight-'));
  let store;
  try {
    store = new MutationIdempotencyStore({ directory: root, scope: 'preflight-scope' });
    let effects = 0;
    for (const tool of ['write_text', 'write_file']) {
      const requestId = 'bad-sha-' + tool;
      const input = { path:'payload.txt', content:'safe', expectedSha256:'INVALID' };
      await assert.rejects(
        store.execute({ requestId, tool, input }, async () => {
          effects += 1;
          return { ok:true };
        }),
        /expectedSha256 must be a lowercase 64-hex SHA-256/
      );
      const beforeEffect = store.status().states;
      assert.equal(beforeEffect.PREPARED ?? 0, 0);
      assert.equal(beforeEffect.UNCERTAIN ?? 0, 0);
      assert.equal(beforeEffect.SUCCEEDED ?? 0, effects);
      // Correcting the input can use the same request ID since no effect was attempted.
      const accepted = await store.execute({
        requestId, tool, input: { path:'payload.txt', content:'safe' }
      }, async () => {
        effects += 1;
        return { ok:true, effects };
      });
      assert.equal(accepted.ok,true);
      const replay = await store.execute({
        requestId, tool, input: { path:'payload.txt', content:'safe' }
      }, async () => {
        effects += 1;
        throw new Error('must not repeat effect');
      });
      assert.deepEqual(replay,accepted);
      assert.equal(effects, tool === 'write_text' ? 1 : 2);
    }

    const uncertainInput = { path:'payload.txt', content:'safe', expectedSha256:'a'.repeat(64) };
    await assert.rejects(
      store.execute({ requestId:'effect-uncertain', tool:'write_file', input:uncertainInput },
        async () => { effects += 1; throw new Error('effect may have changed target'); }),
      /effect may have changed target/
    );
    assert.equal(store.status().states.UNCERTAIN, 1);
    await assert.rejects(
      store.execute({ requestId:'effect-uncertain', tool:'write_file', input:uncertainInput },
        async () => { effects += 1; return { ok:true }; }),
      /MUTATION_OUTCOME_UNCERTAIN/
    );
    assert.equal(effects,3);
  } finally {
    store?.close();
    await fs.rm(root, { recursive:true, force:true });
  }
});
