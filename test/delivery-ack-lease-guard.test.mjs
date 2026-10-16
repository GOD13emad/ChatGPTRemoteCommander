import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeliveryStore } from '../src/delivery-store.mjs';

function make(t, id) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-lease-native-'));
  const store = new DeliveryStore({ directory: path.join(root, 'state'), scope: 'fixture-only' });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const correlationId = 'fixture-' + id;
  const p = store.publish({ eventKey: 'operation:' + id, correlationId,
    source: 'operation', sourceId: 'op-' + id, kind: 'COMPLETED' });
  const claim = attemptId => store.claim({ deliveryId:p.deliveryId, correlationId, attemptId, leaseMs:120000 });
  const ack = attemptId => store.ack({deliveryId:p.deliveryId, correlationId, attemptId});
  const expire = () => store.db.prepare('UPDATE deliveries SET lease_until=? WHERE id=? AND scope=?')
    .run(Date.now() - 1000, p.deliveryId, 'fixture-only');
  return {store, p, claim, ack, expire, correlationId};
}
test('expired and unreclaimed attempt must fail lease check without changing delivery', t => {
  const f=make(t,'expired');
  f.claim('attempt-one'); f.expire();
  assert.throws(() => f.ack('attempt-one'), /DELIVERY_LEASE_EXPIRED/);
  assert.equal(f.store.get(f.p.deliveryId,f.correlationId).state,'DELIVERY_PENDING');
  assert.equal(f.store.get(f.p.deliveryId,f.correlationId).receiptId,null);
});
test('fresh attempt ACKs once and repeat returns identical receipt', t => {
  const f=make(t,'fresh'); f.claim('attempt-one');
  const first=f.ack('attempt-one'); assert.equal(first.state,'DELIVERED');
  const second=f.ack('attempt-one');
  assert.equal(second.receiptId,first.receiptId);
  assert.equal(second.attempts,1);
});
test('reclaimed attempt supersedes expired attempt', t => {
  const f=make(t,'supersede');
  f.claim('attempt-one'); f.expire();
  f.claim('attempt-two');
  assert.throws(()=>f.ack('attempt-one'),/DELIVERY_ATTEMPT_CONFLICT/);
  assert.equal(f.ack('attempt-two').state,'DELIVERED');
});
test('wrong correlation and never-claimed attempt fail closed',t=>{
  const f=make(t,'scope');
  assert.throws(()=>f.ack('not-claimed'),/DELIVERY_ATTEMPT_CONFLICT/);
  f.claim('attempt-ok');
  assert.throws(()=>f.store.ack({deliveryId:f.p.deliveryId,correlationId:'wrong-scope',attemptId:'attempt-ok'}),/DELIVERY_CORRELATION_MISMATCH/);
  assert.equal(f.store.get(f.p.deliveryId,f.correlationId).state,'DELIVERY_PENDING');
});
test('same expired attempt is not renewed by a same-attempt claim',t=>{
  const f=make(t,'repeat'); f.claim('attempt-one'); f.expire();
  const twice=f.claim('attempt-one');
  assert.equal(twice.attempts,1);
  assert.throws(()=>f.ack('attempt-one'),/DELIVERY_LEASE_EXPIRED/);
});
