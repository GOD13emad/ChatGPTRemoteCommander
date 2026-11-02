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

test('native observed effect reconciliation persists across restart and never replays',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-native-evidence-'));
 const request={requestId:'effect-1',tool:'workspace_window_invoke',
   input:{route:'bound',argumentsHash:'opaque'}};
 const id='a'.repeat(64);
 let executions=0,store;
 try{
  store=new MutationIdempotencyStore({directory:root,scope:'owner-chat'});
  const original=await store.execute(request,async()=>{
   executions++;return {status:'UNCERTAIN',targetId:'exact-window',identityDigest:id};
  });
  assert.equal(original.status,'UNCERTAIN');
  await assert.rejects(store.reconcileVerifiedObservation({
   ...request,expectedIdentityDigest:id,verify:async()=>false
  }),{mutationIdempotencyCode:'MUTATION_RECONCILIATION_PROOF_REQUIRED'});
  assert.equal((await store.execute(request,async()=>{executions++;})).status,'UNCERTAIN');
  await assert.rejects(store.reconcileVerifiedObservation({
   ...request,expectedIdentityDigest:'b'.repeat(64),verify:async()=>true
  }),{mutationIdempotencyCode:'MUTATION_RECONCILIATION_STATE_INVALID'});
  const evidence=await store.reconcileVerifiedObservation({
   ...request,expectedIdentityDigest:id,verify:async()=>true
  });
  assert.equal(evidence.status,'EFFECT_OBSERVED');
  assert.equal(evidence.userGoalVerified,false);
  assert.equal(executions,1);
  store.close();store=null;
  store=new MutationIdempotencyStore({directory:root,scope:'owner-chat'});
  assert.deepEqual(await store.execute(request,async()=>{executions++;}),evidence);
  assert.equal(executions,1);
  await assert.rejects(store.reconcileVerifiedObservation({
   ...request,expectedIdentityDigest:id,verify:async()=>true
  }),{mutationIdempotencyCode:'MUTATION_RECONCILIATION_STATE_INVALID'});
 }finally{store?.close();await fs.rm(root,{recursive:true,force:true});}
});
test('generic lost transport acknowledgement is not upgraded by observation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-native-evidence-'));
 const store=new MutationIdempotencyStore({directory:root,scope:'owner-chat'});
 const request={requestId:'effect-2',tool:'workspace_window_invoke',input:{x:1}};
 try{
  await assert.rejects(store.execute(request,async()=>{throw Error('disconnected');}),/disconnected/);
  await assert.rejects(store.reconcileVerifiedObservation({
   ...request,expectedIdentityDigest:'a'.repeat(64),verify:async()=>true
  }),{mutationIdempotencyCode:'MUTATION_RECONCILIATION_STATE_INVALID'});
  assert.equal(store.status().states.UNCERTAIN,1);
 }finally{store.close();await fs.rm(root,{recursive:true,force:true});}
});
