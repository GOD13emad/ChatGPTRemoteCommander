import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeliveryStore, digest, stableJson } from '../src/delivery-store.mjs';

function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-delivery-'));
  const directory=path.join(root,'state');
  const open=()=>new DeliveryStore({directory,scope:'profile-a'});
  return {root,directory,open,dispose(){fs.rmSync(root,{recursive:true,force:true});}};
}

test('delivery event publish is durable and idempotent across restart',()=>{
  const f=fixture();
  try{
    let store=f.open();
    const first=store.publish({eventKey:'project:run-one:complete',correlationId:'chat-a',source:'project',sourceId:'run-one',kind:'COMPLETED'});
    const again=store.publish({eventKey:'project:run-one:complete',correlationId:'chat-a',source:'project',sourceId:'run-one',kind:'COMPLETED'});
    assert.equal(again.deliveryId,first.deliveryId);
    store.close(); store=f.open();
    const after=store.get(first.deliveryId,'chat-a');
    assert.equal(after.kind,'COMPLETED');
    assert.equal(after.state,'COMPLETED_UNDELIVERED');
    assert.equal(store.health().pending,1);
    store.close();
  } finally { f.dispose(); }
});

test('same event key with changed payload fails closed',()=>{
  const f=fixture(); const store=f.open();
  try{
    store.publish({eventKey:'project:run-one:end',correlationId:'chat-a',source:'project',sourceId:'run-one',kind:'BLOCKED',code:'PROJECT_BLOCKED'});
    assert.throws(()=>store.publish({eventKey:'project:run-one:end',correlationId:'chat-a',source:'project',sourceId:'run-one',kind:'COMPLETED'}),/DELIVERY_EVENT_CONFLICT/);
  } finally { store.close(); f.dispose(); }
});

test('claim and ack require exact correlation and are idempotent for same attempt',()=>{
  const f=fixture(); const store=f.open();
  try{
    const item=store.publish({eventKey:'project:run-two:wait',correlationId:'chat-a',source:'project',sourceId:'run-two',kind:'WAITING_INPUT'});
    assert.throws(()=>store.claim({deliveryId:item.deliveryId,correlationId:'chat-b',attemptId:'attempt-b'}),/DELIVERY_CORRELATION_MISMATCH/);
    const claimed=store.claim({deliveryId:item.deliveryId,correlationId:'chat-a',attemptId:'attempt-a'});
    assert.equal(claimed.state,'DELIVERY_PENDING');
    assert.equal(claimed.claimed,true);
    const duplicate=store.claim({deliveryId:item.deliveryId,correlationId:'chat-a',attemptId:'attempt-a'});
    assert.equal(duplicate.attempts,1);
    assert.throws(()=>store.claim({deliveryId:item.deliveryId,correlationId:'chat-a',attemptId:'attempt-other'}),/DELIVERY_CLAIM_BUSY/);
    const acked=store.ack({deliveryId:item.deliveryId,correlationId:'chat-a',attemptId:'attempt-a'});
    assert.equal(acked.state,'DELIVERED');
    const repeated=store.ack({deliveryId:item.deliveryId,correlationId:'chat-a',attemptId:'attempt-a'});
    assert.equal(repeated.receiptId,acked.receiptId);
    assert.throws(()=>store.ack({deliveryId:item.deliveryId,correlationId:'chat-b',attemptId:'attempt-a'}),/DELIVERY_CORRELATION_MISMATCH/);
  } finally { store.close(); f.dispose(); }
});

test('artifact storage is content-addressed bounded and chunk-readable through correlation',()=>{
  const f=fixture(); const store=f.open();
  try{
    const result={text:'x'.repeat(40000),nested:{ok:true}};
    const a=store.writeArtifact(result),b=store.writeArtifact(result);
    assert.deepEqual(a,b);
    assert.equal(a.id,digest(Buffer.from(JSON.stringify(result))));
    const item=store.publish({eventKey:'tool:job-one:final',correlationId:'chat-a',source:'tool',sourceId:'job-one',kind:'COMPLETED',artifact:a});
    let offset=0,total=0;
    while(offset!==null){
      const chunk=store.readArtifact({deliveryId:item.deliveryId,correlationId:'chat-a',offset,maxBytes:4096});
      total+=Buffer.from(chunk.data,'base64').length;
      offset=chunk.nextOffset;
    }
    assert.equal(total,a.bytes);
    assert.throws(()=>store.readArtifact({deliveryId:item.deliveryId,correlationId:'chat-b'}),/DELIVERY_CORRELATION_MISMATCH/);
  } finally { store.close(); f.dispose(); }
});

test('request reservation deduplicates exact lost acknowledgement and conflicts changed input',()=>{
  const f=fixture(); const store=f.open();
  try{
    const inputHash=digest(stableJson({tool:'write_text',path:'a.txt'}));
    const first=store.reserve({requestId:'request-1',correlationId:'chat-a',tool:'write_text',inputHash,durationMs:1000});
    const duplicate=store.reserve({requestId:'request-1',correlationId:'chat-a',tool:'write_text',inputHash,durationMs:1000});
    assert.equal(duplicate.jobId,first.jobId);
    assert.equal(duplicate.duplicate,true);
    assert.throws(()=>store.reserve({requestId:'request-1',correlationId:'chat-a',tool:'write_text',inputHash:digest('changed'),durationMs:1000}),/REQUEST_ID_CONFLICT/);
  } finally { store.close(); f.dispose(); }
});

test('completed request produces stable artifact delivery when finish acknowledgement is lost',()=>{
  const f=fixture(); const store=f.open();
  try{
    const inputHash=digest('input');
    store.reserve({requestId:'request-2',correlationId:'chat-a',tool:'read_text',inputHash,durationMs:1000});
    const first=store.finish('request-2',{ok:true,data:'result'});
    const duplicate=store.finish('request-2',{ok:true,data:'result'});
    assert.equal(duplicate.deliveryId,first.deliveryId);
    assert.equal(store.list({correlationId:'chat-a'}).items.length,1);
  } finally { store.close(); f.dispose(); }
});

test('expired unfinished request becomes durable UNCERTAIN rather than replay authority',async()=>{
  const f=fixture();
  try{
    let store=f.open();
    store.reserve({requestId:'request-3',correlationId:'chat-a',tool:'write_text',inputHash:digest('input'),durationMs:1000});
    store.close();
    await new Promise(resolve=>setTimeout(resolve,1050));
    store=f.open();
    assert.equal(store.recover().recovered,1);
    const request=store.request('request-3');
    assert.equal(request.status,'UNCERTAIN');
    const event=store.get(request.deliveryId,'chat-a');
    assert.equal(event.kind,'UNCERTAIN');
    assert.equal(event.code,'RECONCILE_BEFORE_NEW_REQUEST');
    store.close();
  } finally { f.dispose(); }
});
