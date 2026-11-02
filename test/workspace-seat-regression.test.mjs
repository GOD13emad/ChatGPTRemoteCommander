import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveWorkspaceDefaultSeat,createWorkspaceController,isWorkspaceControllerTool} from '../src/workspace-tools.mjs';
import {createMemoryWorkspaceJournal} from '../src/workspace-target-journal.mjs';
test('workspace_target_reconcile is dispatched to the background CUA controller, not native GUI target',()=>{
 assert.equal(isWorkspaceControllerTool('workspace_target_reconcile'),true);
 assert.equal(isWorkspaceControllerTool('workspace_window_click'),true);
 assert.equal(isWorkspaceControllerTool('workspace_browser_click'),true);
 assert.equal(isWorkspaceControllerTool('workspace_target_open'),false);
 assert.equal(isWorkspaceControllerTool('workspace_target_list'),false);
 assert.equal(isWorkspaceControllerTool('workspace_accessibility_open'),false);
});
test('owner configured private seat is default only for windows, never browser or explicit seat',()=>{
 const cfg={workspaceControl:{defaultSeat:'a'}};
 assert.deepEqual(resolveWorkspaceDefaultSeat(cfg,'workspace_list_windows',{},'linux'),{workspaceSeat:'a'});
 assert.deepEqual(resolveWorkspaceDefaultSeat(cfg,'workspace_window_observe',{pid:1,windowId:2},'linux'),
   {pid:1,windowId:2,workspaceSeat:'a'});
 assert.deepEqual(resolveWorkspaceDefaultSeat(cfg,'workspace_list_windows',{workspaceSeat:'b'},'linux'),
   {workspaceSeat:'b'});
 assert.deepEqual(resolveWorkspaceDefaultSeat(cfg,'workspace_plan',{target:'new-app'},'linux'),{target:'new-app'});
 assert.deepEqual(resolveWorkspaceDefaultSeat(cfg,'workspace_browser_attach',{pid:1,windowId:2},'linux'),
   {pid:1,windowId:2});
 assert.deepEqual(resolveWorkspaceDefaultSeat(cfg,'workspace_target_reconcile',{surface:'browser'},'linux'),
   {surface:'browser'});
 assert.deepEqual(resolveWorkspaceDefaultSeat({},'workspace_list_windows',{},'linux'),{});
 assert.throws(()=>resolveWorkspaceDefaultSeat({workspaceControl:{defaultSeat:'invalid'}},'workspace_list_windows',{},'linux'),
   /WORKSPACE_DEFAULT_SEAT_INVALID/);
});
test('exact requestId reaches journal for private target effects without replay', async()=>{
 const calls=[];
 const controller=createWorkspaceController({platform:'linux',ownerSession:async()=>true,
  journal:createMemoryWorkspaceJournal(),now:()=>1000,
  callDriver:async(name,args,scope)=>{calls.push({name,args,scope});
   if(name==='get_window_state')return {snapshot_id:'s00000001',elements:[]};
   if(name==='click')return {effect:'confirmed',verified:true};
   return {windows:[]};
  }});
 const input={pid:321,windowId:65,workspaceSeat:'a'};
 const observed=await controller.execute('workspace_window_observe',input);
 assert.equal(observed.snapshotId,'s00000001');
 const observeSession=calls.at(-1).args.session;
 assert.equal(observeSession,'rcws-a-321-65');
 const args={...input,elementToken:'s00000001:0',requestId:'ws-private-idempotency-01',
  explicitUserAuthorization:'Owner requested a click on only this temporary private QA window'};
 const output=await controller.execute('workspace_window_click',args);
 assert.equal(output.decision.status,'CONFIRMED');
 assert.equal(calls.at(-1).scope.workspaceSeat,'a');
 assert.equal(calls.at(-1).args.session,observeSession);
 await assert.rejects(controller.execute('workspace_window_click',args),/WORKSPACE_DUPLICATE_REQUEST_NO_REPLAY/);
});
