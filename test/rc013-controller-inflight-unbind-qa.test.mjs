import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createConversationController} from '../src/conversation-continuation.mjs';

test('native UI send resolving after unbind must quarantine outcome and not reactivate chat', async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc013-unbind-ui-'));
 const directory=path.join(root,'state');
 const project=path.join(root,'project');
 fs.mkdirSync(project);
 let signalStart,sendFinish;
 const started=new Promise(resolve=>{signalStart=resolve;});
 const sending=new Promise(resolve=>{sendFinish=resolve;});
 let sends=0;
 const controller=createConversationController({
  directory,scope:'qa',platform:'win32',helperPath:'unused',
  invokeUia:async request=>{
   if(request.action==='status')return {state:'READY',code:'CHAT_TAB_FOUND',processId:1};
   sends++;
   signalStart();
   return sending;
  }
 });
 try{
  await controller.bind({projectId:'p',root:project,tabTitle:'Native current chat'});
  const pending=controller.handoff({projectId:'p',eventKey:'final:1',eventType:'NEEDS_CHAT',summary:'QA'});
  await started;
  assert.equal(controller.unbind('p').unbound,true);
  sendFinish({state:'SENT',code:'UI_ACKNOWLEDGED'});
  await assert.doesNotReject(controller.drain());
  const state=await controller.status('p');
  assert.equal(state.binding.state,'UNBOUND');
  assert.equal(state.pending.find(x=>x.handoffId===pending.handoffId).state,'UNCERTAIN');
  assert.equal(sends,1);
 } finally {
  sendFinish?.({state:'UNCERTAIN',code:'QA_CLOSED'});
  await controller.close();
  fs.rmSync(root,{recursive:true,force:true});
 }
});
