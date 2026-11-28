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
    assert.equal(store.readRequestState('req-1'),'SUCCEEDED');
    assert.equal(store.readRequestState('missing-request'),null);
    assert.throws(()=>store.readRequestState('../bad'),
      {mutationIdempotencyCode:'MUTATION_REQUEST_ID_REQUIRED'});
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
    assert.equal(store.readRequestState('req-2'),'UNCERTAIN');
    await assert.rejects(
      store.execute({ requestId: 'req-2', tool: 'send_terminal', input: { id: 't1', input: 'y' } }, async () => ({ accepted: true })),
      /MUTATION_REQUEST_ID_CONFLICT/
    );
    store.close();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('durable preflight denial is terminal across restart while effect failure remains uncertain',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc012-receipt-denied-'));
  let store=new MutationIdempotencyStore({directory:root,scope:'denial-test'});
  const details={requestId:'denied-one',tool:'write_text',input:{path:'fixture.txt'}};
  let effects=0,checks=0;
  try{
    await assert.rejects(store.executeWithPreflight(details,async()=>{
      checks++;throw Error('owner grant revoked');
    },async()=>{effects++;}),/owner grant revoked/);
    assert.equal(store.readRequestState(details.requestId),'DENIED');
    assert.deepEqual(store.status().states,{DENIED:1});
    assert.equal(effects,0);
    store.close();
    store=new MutationIdempotencyStore({directory:root,scope:'denial-test'});
    await assert.rejects(store.executeWithPreflight(details,async()=>{checks++;},
      async()=>{effects++;}),{mutationIdempotencyCode:'MUTATION_PRE_EFFECT_DENIED'});
    await assert.rejects(store.execute({...details,input:{path:'different.txt'}},
      async()=>{effects++;}),{mutationIdempotencyCode:'MUTATION_REQUEST_ID_CONFLICT'});
    assert.equal(checks,1);
    assert.equal(effects,0);
    // A tool cannot manufacture a safe denial by reporting a denial code.
    const unknown={...details,requestId:'unknown-one'};
    await assert.rejects(store.executeWithPreflight(unknown,async()=>{},async()=>{
      effects++;throw Object.assign(Error('unknown effect'),{
        mutationIdempotencyCode:'MUTATION_PRE_EFFECT_DENIED'
      });
    }),/unknown effect/);
    assert.equal(store.readRequestState(unknown.requestId),'UNCERTAIN');
    assert.deepEqual(store.status().states,{DENIED:1,UNCERTAIN:1});
    assert.equal(effects,1);
  }finally{store.close();await fs.rm(root,{recursive:true,force:true});}
});

test('failed durable preflight-denial write preserves PREPARED and prevents execution',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc012-denial-write-fail-'));
  const store=new MutationIdempotencyStore({directory:root,scope:'denial-write-failure'});
  const details={requestId:'failed-denial',tool:'write_text',input:{path:'fixture.txt'}};
  let effects=0;
  try{
    store.db.exec("CREATE TRIGGER reject_denied BEFORE UPDATE ON mutations WHEN NEW.state='DENIED' BEGIN SELECT RAISE(ABORT,'QA_DENIAL_WRITE_FAILED'); END;");
    await assert.rejects(store.executeWithPreflight(details,async()=>{
      throw Error('authorization denied');
    },async()=>{effects++;}),/QA_DENIAL_WRITE_FAILED/);
    assert.equal(store.readRequestState(details.requestId),'PREPARED');
    await assert.rejects(store.executeWithPreflight(details,async()=>{},async()=>{
      effects++;
    }),{mutationIdempotencyCode:'MUTATION_OUTCOME_UNCERTAIN'});
    assert.equal(effects,0);
  }finally{store.close();await fs.rm(root,{recursive:true,force:true});}
});
