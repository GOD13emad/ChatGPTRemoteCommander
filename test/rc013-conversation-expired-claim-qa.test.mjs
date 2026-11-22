import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ConversationStore} from '../src/conversation-store.mjs';

function fixture(fn) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'rc013-outbox-lease-'));
  const directory=path.join(base,'state'),root=path.join(base,'project');
  fs.mkdirSync(root,{mode:0o700});
  const store=new ConversationStore({directory,scope:'qa'});
  store.bind({projectId:'p1',root,tabTitle:'QA Project'});
  const expire=id=>{
    const db=new DatabaseSync(path.join(directory,'conversation.sqlite'));
    const deadline=Date.now()-2000;
    try{db.prepare('UPDATE handoffs SET lease_until=? WHERE id=?').run(deadline,id);}
    finally{db.close();}
    return deadline;
  };
  try{return fn({store,expire});}
  finally{store.close();fs.rmSync(base,{recursive:true,force:true});}
}
const enqueue=(store,key)=>store.enqueue({
 projectId:'p1',eventKey:key,eventType:'NEEDS_CHAT',payload:{key},message:'safe QA message '+key
});
test('expired CLAIMED delivery must become UNCERTAIN, never blind retry',()=>{
 fixture(({store,expire})=>{
  const handoff=enqueue(store,'evt-1');
  const attempt=store.claimNext({leaseMs:5000});
  assert.equal(attempt.handoffId,handoff.handoffId);
  expire(handoff.handoffId);
  assert.equal(store.claimNext({leaseMs:5000}),null);
  const result=store.get(handoff.handoffId);
  assert.equal(result.state,'UNCERTAIN');
  assert.equal(result.lastCode,'LEASE_EXPIRED_OUTCOME_UNCERTAIN');
  assert.equal(result.attemptId,null);
  assert.throws(()=>store.sent(handoff.handoffId,attempt.attemptId),
    e=>e?.conversationCode==='CONVERSATION_CLAIM_LOST');
  assert.equal(store.claimNext({leaseMs:5000}),null);
 });
});
test('expired send cannot starve unrelated queued message',()=>{
 fixture(({store,expire})=>{
  const a=enqueue(store,'evt-a');
  const claim=store.claimNext({leaseMs:5000});
  assert.equal(claim.handoffId,a.handoffId);
  expire(a.handoffId);
  const b=enqueue(store,'evt-b');
  const next=store.claimNext({leaseMs:5000});
  assert.equal(next.handoffId,b.handoffId);
  assert.equal(store.get(a.handoffId).state,'UNCERTAIN');
  assert.equal(store.get(b.handoffId).state,'CLAIMED');
 });
});
test('UNCERTAIN expired send is retriable only after explicit manual resolution',()=>{
 fixture(({store,expire})=>{
  const a=enqueue(store,'evt-c');
  const first=store.claimNext({leaseMs:5000});
  expire(a.handoffId);
  assert.equal(store.claimNext({leaseMs:5000}),null);
  assert.equal(store.get(a.handoffId).state,'UNCERTAIN');
  assert.equal(store.resolveUncertain(a.handoffId,'retry').state,'DEFERRED');
  const second=store.claimNext({leaseMs:5000});
  assert.equal(second.handoffId,a.handoffId);
  assert.notEqual(second.attemptId,first.attemptId);
  store.uncertain(a.handoffId,second.attemptId,'SEND_OUTCOME_UNCERTAIN');
  assert.equal(store.resolveUncertain(a.handoffId,'confirm_sent').state,'SENT');
  assert.equal(store.claimNext({leaseMs:5000}),null);
 });
});

test('UNCERTAIN remains quarantined across restart until explicit confirmation',()=>{
 fixture(({store,expire})=>{
  const a=enqueue(store,'evt-restart');
  const claimed=store.claimNext({leaseMs:5000});
  expire(a.handoffId);
  assert.equal(store.claimNext({leaseMs:5000}),null);
  const restarted=new ConversationStore({directory:store.directory,scope:'qa'});
  try{
   assert.equal(restarted.get(a.handoffId).state,'UNCERTAIN');
   assert.equal(restarted.claimNext({leaseMs:5000}),null);
   assert.equal(restarted.resolveUncertain(a.handoffId,'confirm_sent').state,'SENT');
   assert.equal(restarted.claimNext({leaseMs:5000}),null);
   assert.throws(()=>restarted.sent(a.handoffId,claimed.attemptId),
     e=>e?.conversationCode==='CONVERSATION_CLAIM_LOST');
  }finally{restarted.close();}
 });
});

test('claimed-only expiry must schedule recovery without any queued handoffs',()=>{
 fixture(({store,expire})=>{
  const a=enqueue(store,'evt-scheduler');
  assert.equal(store.claimNext({leaseMs:5000}).handoffId,a.handoffId);
  const deadline=expire(a.handoffId);
  const due=store.nextDue();
  assert.equal(typeof due,'number','claimed lease must wake scheduler after restart');
  assert.ok(due>=deadline&&due<=deadline+1000,'due must reference stale claim');
  assert.equal(store.claimNext({leaseMs:5000}),null);
  assert.equal(store.get(a.handoffId).state,'UNCERTAIN');
  assert.equal(store.nextDue(),null);
 });
});
