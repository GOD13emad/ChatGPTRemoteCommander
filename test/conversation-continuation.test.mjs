import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConversationStore } from '../src/conversation-store.mjs';
import { createConversationController } from '../src/conversation-continuation.mjs';

function temp(){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'rc-conversation-'));
  const project=path.join(base,'project');
  const state=path.join(base,'state');
  fs.mkdirSync(project,{recursive:true});
  return {base,project,state,dispose:()=>fs.rmSync(base,{recursive:true,force:true})};
}
test('durable outbox deduplicates the same event and rejects conflicting reuse',()=>{
  const f=temp();
  try{
    const store=new ConversationStore({directory:f.state,scope:'test'});
    store.bind({projectId:'p1',root:f.project,tabTitle:'Project One'});
    const a=store.enqueue({projectId:'p1',eventKey:'gate:1',eventType:'NEEDS_CHAT',payload:{state:'BLOCKED'},message:'fixed'});
    const b=store.enqueue({projectId:'p1',eventKey:'gate:1',eventType:'NEEDS_CHAT',payload:{state:'BLOCKED'},message:'fixed'});
    assert.equal(a.handoffId,b.handoffId);
    assert.equal(store.stats().pending,1);
    assert.throws(()=>store.enqueue({projectId:'p1',eventKey:'gate:1',eventType:'NEEDS_CHAT',payload:{state:'OTHER'},message:'changed'}),/CONVERSATION_(EVENT|HANDOFF)_CONFLICT/);
    store.close();
  }finally{f.dispose();}
});

test('uncertain send is never blindly retried',async()=>{
  const f=temp();let sends=0;
  const controller=createConversationController({
    directory:f.state,scope:'test',platform:'win32',helperPath:'unused',
    invokeUia:async request=>{
      if(request.action==='status')return {state:'READY',code:'CHAT_TAB_FOUND',processId:1};
      sends+=1;return {state:'UNCERTAIN',code:'SEND_NOT_ACKNOWLEDGED'};
    }
  });
  try{
    await controller.bind({projectId:'p1',root:f.project,tabTitle:'Project One'});
    const queued=controller.handoff({projectId:'p1',eventKey:'evt:1',eventType:'NEEDS_CHAT',state:'BLOCKED'});
    assert.ok(queued.handoffId);
    await controller.drain();
    const status=await controller.status('p1');
    const item=status.pending.find(x=>x.handoffId===queued.handoffId&&x.state==='UNCERTAIN');
    assert.ok(item);
    await new Promise(r=>setTimeout(r,100));
    assert.equal(sends,1);
  }finally{await controller.close();f.dispose();}
});

test('ordinary deferral remains queued without duplicate send',async()=>{
  const f=temp();let sends=0;
  const controller=createConversationController({
    directory:f.state,scope:'test',platform:'win32',helperPath:'unused',
    invokeUia:async request=>{
      if(request.action==='status')return {state:'READY',code:'CHAT_TAB_FOUND',processId:1};
      sends+=1;return {state:'DEFERRED',code:'WAITING_FOR_CHAT_TAB'};
    }
  });
  try{
    await controller.bind({projectId:'p1',root:f.project,tabTitle:'Project One'});
    const queued=controller.handoff({projectId:'p1',eventKey:'evt:2',eventType:'PROCESS_EXIT',state:'SUCCEEDED'});
    await controller.drain();
    const drained=await controller.status('p1');
    const item=drained.pending.find(x=>x.handoffId===queued.handoffId&&x.state==='DEFERRED');
    assert.equal(item.lastCode,'WAITING_FOR_CHAT_TAB');
    assert.equal(sends,1);
    const status=await controller.status('p1');
    assert.equal(status.binding.state,'WAITING_FOR_CHAT_TAB');
  }finally{await controller.close();f.dispose();}
});

test('acknowledged handoff is sent once and removed from pending queue',async()=>{
  const f=temp();let sends=0;
  const controller=createConversationController({
    directory:f.state,scope:'test',platform:'win32',helperPath:'unused',
    invokeUia:async request=>{
      if(request.action==='status')return {state:'READY',code:'CHAT_TAB_FOUND',processId:1};
      sends+=1;
      assert.match(request.message,/untrusted status data/);
      return {state:'SENT',code:'UI_ACKNOWLEDGED'};
    }
  });
  try{
    await controller.bind({projectId:'p1',root:f.project,tabTitle:'Project One'});
    const queued=controller.handoff({projectId:'p1',eventKey:'evt:3',eventType:'OPERATION_COMPLETED',summary:'done'});
    await controller.drain();
    const sent=await controller.status('p1');
    assert.equal(sent.store.counts.SENT,1);
    assert.equal(sent.pending.length,0);
    assert.equal(sends,1);
  }finally{await controller.close();f.dispose();}
});

test('linux mode preserves binding and queue without desktop injection',async()=>{
  const f=temp();
  const controller=createConversationController({
    directory:f.state,scope:'test',platform:'linux',helperPath:'unused'
  });
  try{
    const binding=await controller.bind({projectId:'p1',root:f.project,tabTitle:'Project One'});
    assert.equal(binding.code,'WINDOWS_UIA_REQUIRED');
    controller.handoff({projectId:'p1',eventKey:'evt:4',eventType:'NEEDS_CHAT'});
    await controller.drain();
    const drained=await controller.status('p1');
    const pending=drained.pending.find(x=>x.state==='DEFERRED');
    assert.ok(pending);
    assert.equal(pending.lastCode,'WAITING_FOR_WINDOWS_CHAT_HOST');
  }finally{await controller.close();f.dispose();}
});

test('unbind cancels deliverable handoffs and blocks new ones',async()=>{
  const f=temp();
  const controller=createConversationController({
    directory:f.state,scope:'test',platform:'win32',helperPath:'unused',
    invokeUia:async request=>request.action==='status'
      ? {state:'READY',code:'CHAT_TAB_FOUND',processId:1}
      : {state:'DEFERRED',code:'CHAT_BUSY'}
  });
  try{
    await controller.bind({projectId:'p1',root:f.project,tabTitle:'Project One'});
    controller.handoff({projectId:'p1',eventKey:'evt:5',eventType:'NEEDS_CHAT'});
    await controller.drain();
    const pending=await controller.status('p1');
    assert.equal(pending.pending.length,1);
    const out=controller.unbind('p1');
    assert.equal(out.unbound,true);
    assert.throws(()=>controller.handoff({projectId:'p1',eventKey:'evt:6',eventType:'NEEDS_CHAT'}),/CONVERSATION_NOT_BOUND/);
  }finally{await controller.close();f.dispose();}
});


test('uncertain handoff requires explicit resolve before retry and resolve is idempotent',async()=>{
  const f=temp();
  let sends=0;
  const controller=createConversationController({
    directory:f.state,scope:'test',platform:'win32',helperPath:'unused',
    invokeUia:async req=>{
      if(req.action==='status')return {state:'READY',code:'CHAT_TAB_FOUND',processId:1};
      sends+=1;
      if(sends===1)return {state:'UNCERTAIN',code:'SEND_NOT_ACKNOWLEDGED'};
      return {state:'SENT',code:'UI_ACKNOWLEDGED'};
    }
  });
  try{
    await controller.bind({projectId:'p1',root:f.project,tabTitle:'Project Chat'});
    const handoff=controller.handoff({projectId:'p1',eventKey:'evt-uncertain',eventType:'NEEDS_CHAT',summary:'needs continuation'});
    await new Promise(r=>setTimeout(r,120));
    let status=await controller.status('p1');
    const uncertain=status.pending.find(x=>x.handoffId===handoff.handoffId);
    assert.equal(uncertain.state,'UNCERTAIN');
    assert.equal(sends,1);
    await new Promise(r=>setTimeout(r,120));
    assert.equal(sends,1,'UNCERTAIN must never blind-retry');

    const retried=await controller.execute('conversation_resolve',{handoffId:handoff.handoffId,action:'retry'});
    assert.ok(['DEFERRED','CLAIMED','SENT'].includes(retried.state));
    await new Promise(r=>setTimeout(r,160));
    status=await controller.status('p1');
    assert.equal(status.pending.some(x=>x.handoffId===handoff.handoffId),false);
    assert.equal(sends,2);

    const confirmed=await controller.execute('conversation_resolve',{handoffId:handoff.handoffId,action:'confirm_sent'});
    assert.equal(confirmed.state,'SENT');
    assert.equal(sends,2);
  }finally{await controller.close();f.dispose();}
});


test('continuation binding rejects a different canonical project root',async()=>{
  const f=temp();
  const other=path.join(f.base,'other-project');fs.mkdirSync(other,{recursive:true});
  const controller=createConversationController({
    directory:f.state,scope:'test',platform:'win32',helperPath:'unused',
    invokeUia:async request=>request.action==='status'
      ? {state:'READY',code:'CHAT_TAB_FOUND',processId:1}
      : {state:'DEFERRED',code:'CHAT_BUSY'}
  });
  try{
    await controller.bind({projectId:'p1',root:f.project,tabTitle:'Project One'});
    await assert.rejects(
      controller.validateContinuation({projectId:'p1',eventKey:'root:check',root:other}),
      /CONVERSATION_PROJECT_ROOT_MISMATCH/
    );
  }finally{await controller.close();f.dispose();}
});
