import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ConversationStore} from '../src/conversation-store.mjs';

function fixture(run) {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'rc013-target-qa-'));
  const directory=path.join(base,'private'),root=path.join(base,'project');
  fs.mkdirSync(root,{mode:0o700});
  const store=new ConversationStore({directory,scope:'owner-a'});
  const bind=(tabTitle='Original conversation')=>store.bind({projectId:'p',root,tabTitle});
  const enqueue=(eventKey)=>store.enqueue({projectId:'p',eventKey,eventType:'NEEDS_CHAT',
    payload:{eventKey},message:'synthetic handoff'});
  try{return run({store,bind,enqueue,directory,root});}
  finally{store.close();fs.rmSync(base,{recursive:true,force:true});}
}
const hasCode=(e,code)=>e?.conversationCode===code;

test('unbind of in-flight CLAIMED send retains UNCERTAIN forensic outcome, never silent CANCELLED',()=>fixture(({store,bind,enqueue})=>{
 bind();
 const first=enqueue('evt-a'),second=enqueue('evt-b');
 const claim=store.claimNext({leaseMs:5000});
 assert.equal(claim.handoffId,first.handoffId);
 assert.equal(store.unbind('p').unbound,true);
 assert.equal(store.binding('p').state,'UNBOUND');
 const result=store.get(first.handoffId);
 assert.equal(result.state,'UNCERTAIN');
 assert.equal(result.lastCode,'CONVERSATION_UNBOUND_IN_FLIGHT_OUTCOME_UNCERTAIN');
 assert.equal(result.attemptId,null);
 assert.equal(store.get(second.handoffId).state,'CANCELLED');
 assert.throws(()=>store.sent(first.handoffId,claim.attemptId),
   e=>hasCode(e,'CONVERSATION_CLAIM_LOST'));
 assert.equal(store.claimNext({leaseMs:5000}),null);
}));

test('active CLAIMED send prevents destination-tab retargeting',()=>fixture(({store,bind,enqueue})=>{
 bind();
 const task=enqueue('evt-c');
 store.claimNext({leaseMs:5000});
 assert.throws(()=>bind('Foreign conversation'),e=>hasCode(e,'CONVERSATION_DELIVERY_IN_FLIGHT'));
 assert.equal(store.binding('p').tabTitle,'Original conversation');
 assert.equal(store.get(task.handoffId).state,'CLAIMED');
}));

test('UNCERTAIN send prevents rebind to a different destination before explicit reconciliation',()=>fixture(({store,bind,enqueue})=>{
 bind();const task=enqueue('evt-d');
 const claim=store.claimNext({leaseMs:5000});
 store.uncertain(task.handoffId,claim.attemptId);
 assert.throws(()=>bind('Foreign conversation'),e=>hasCode(e,'CONVERSATION_DELIVERY_IN_FLIGHT'));
 assert.equal(store.binding('p').tabTitle,'Original conversation');
 store.resolveUncertain(task.handoffId,'cancel');
 assert.equal(bind('Foreign conversation').tabTitle,'Foreign conversation');
}));

test('stale sender status cannot resurrect UNBOUND destination',()=>fixture(({store,bind})=>{
 bind();store.unbind('p');
 const status=store.markBinding('p','BOUND',{seen:true});
 assert.equal(status.state,'UNBOUND');
 assert.equal(store.binding('p').state,'UNBOUND');
}));

test('two SQLite handles cannot rebind target while another has a claimed delivery',()=>fixture(({store,bind,enqueue,directory,root})=>{
 bind();enqueue('evt-multi');store.claimNext({leaseMs:5000});
 const other=new ConversationStore({directory,scope:'owner-a'});
 try{
  assert.throws(()=>other.bind({projectId:'p',root,tabTitle:'Foreign conversation'}),
    e=>hasCode(e,'CONVERSATION_DELIVERY_IN_FLIGHT'));
  assert.equal(store.binding('p').tabTitle,'Original conversation');
 } finally{other.close();}
}));

test('expired-retry handoff cannot silently migrate to another chat after unbind',()=>fixture(({store,bind,enqueue})=>{
 bind();
 const handoff=enqueue('evt-retry-foreign');
 const claimed=store.claimNext({leaseMs:5000});
 assert.equal(claimed.handoffId,handoff.handoffId);
 store.unbind('p');
 assert.equal(store.get(handoff.handoffId).state,'UNCERTAIN');
 store.resolveUncertain(handoff.handoffId,'retry');
 assert.equal(store.get(handoff.handoffId).state,'DEFERRED');
 assert.throws(()=>bind('Different ChatGPT conversation'),
   e=>hasCode(e,'CONVERSATION_PENDING_DESTINATION_CHANGE'));
 assert.equal(store.binding('p').state,'UNBOUND');
 assert.equal(store.get(handoff.handoffId).state,'DEFERRED');
 store.cancelEvent('p','evt-retry-foreign');
 assert.equal(store.get(handoff.handoffId).state,'CANCELLED');
 assert.equal(bind('Different ChatGPT conversation').tabTitle,'Different ChatGPT conversation');
 assert.equal(store.claimNext({leaseMs:5000}),null);
}));

test('pending handoff remains bound to original chat until explicitly cancelled',()=>fixture(({store,bind,enqueue})=>{
 bind();
 const h=enqueue('evt-queued-retarget');
 assert.equal(store.get(h.handoffId).state,'QUEUED');
 assert.throws(()=>bind('Different ChatGPT conversation'),
   e=>hasCode(e,'CONVERSATION_PENDING_DESTINATION_CHANGE'));
 assert.equal(store.binding('p').tabTitle,'Original conversation');
 assert.equal(bind('Original conversation').tabTitle,'Original conversation');
 store.cancelEvent('p','evt-queued-retarget');
 assert.equal(bind('Different ChatGPT conversation').tabTitle,'Different ChatGPT conversation');
}));
