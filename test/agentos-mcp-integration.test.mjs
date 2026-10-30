import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceController,workspaceToolDefinitions,assertWorkspaceToolPolicy} from '../src/workspace-tools.mjs';
import {createMemoryWorkspaceJournal} from '../src/workspace-target-journal.mjs';
const allow={powerMode:{enabled:true,guiControl:{enabled:true,allowMouse:true}}};
const target={pid:3401,windowId:80302};
const fp='0123456789abcdef01234567';
const element={name:'No',fingerprint:fp,enabled:true,invokeAvailable:true};
function mockController(history,{owner=true,failMutation=false}={}){
 return createWorkspaceController({platform:'win32',env:{SESSIONNAME:'RDP-Tcp#2'},
  now:()=>1000,ownerSession:async()=>owner,journal:createMemoryWorkspaceJournal(),
  nativeCall:async(op,args)=>{
   history.push({op,args});
   if(op==='Observe')return {ok:true,pid:args.pid,windowHandle:args.windowId,elements:[element]};
   if(failMutation)throw Error('transport-lost');
   return {ok:true,invocationIssued:true,userGoalVerified:false};
  }});
}
test('tools advertised in shared MCP catalog with read-only vs mutation annotations',()=>{
 for(const name of ['workspace_agentos_plan','workspace_native_ui_observe','workspace_native_ui_invoke'])
  assert.ok(workspaceToolDefinitions.some(t=>t.name===name));
 assert.equal(workspaceToolDefinitions.find(t=>t.name==='workspace_native_ui_observe').annotations.readOnlyHint,true);
 assert.equal(workspaceToolDefinitions.find(t=>t.name==='workspace_native_ui_invoke').annotations.readOnlyHint,false);
 assert.doesNotThrow(()=>assertWorkspaceToolPolicy(allow,'workspace_native_ui_invoke'));
 assert.throws(()=>assertWorkspaceToolPolicy({powerMode:{enabled:true,guiControl:{enabled:true,allowMouse:false}}},'workspace_native_ui_invoke'),/WORKSPACE_GUI_INPUT_POLICY_DENIED/);
});
test('native UIA observe -> exact single invoke -> no replay and no goal overclaim',async()=>{
 const calls=[];const ctl=mockController(calls);
 const observed=await ctl.execute('workspace_native_ui_observe',target);
 assert.equal(observed.ok,true);assert.equal(observed.provider,'windows-uia-native');
 const action={...target,fingerprint:fp,controlName:'No',requestId:'rc011-native-test-e2e-01',
  explicitUserAuthorization:'Owner allows No in own isolated test dialog only'};
 const click=await ctl.execute('workspace_native_ui_invoke',action);
 assert.equal(click.ok,true);
 assert.equal(click.decision.status,'INVOKE_ACKNOWLEDGED');
 assert.equal(click.decision.userGoalVerified,false);
 assert.deepEqual(calls.map(c=>c.op),['Observe','Invoke']);
 await assert.rejects(ctl.execute('workspace_native_ui_invoke',action),/WORKSPACE_DUPLICATE_REQUEST_NO_REPLAY/);
 assert.equal(calls.length,2);
});
test('native UIA wrong fingerprint, name or missing request id never invokes',async()=>{
 const calls=[];const ctl=mockController(calls);
 await ctl.execute('workspace_native_ui_observe',target);
 const base={...target,requestId:'rc011-native-test-guard-01',
  explicitUserAuthorization:'Owner allows a single temporary test control only',
  fingerprint:fp,controlName:'No'};
 for(const patch of [{fingerprint:'111111111111111111111111'},{controlName:'Yes'},{requestId:null},{explicitUserAuthorization:'no'}])
  await assert.rejects(ctl.execute('workspace_native_ui_invoke',{...base,...patch}),/AGENTOS_/);
 assert.equal(calls.length,1);
});
test('no owner session cannot use native Win32 action from SYSTEM context',async()=>{
 const calls=[];const ctl=mockController(calls,{owner:false});
 await assert.rejects(ctl.execute('workspace_native_ui_observe',target),/WORKSPACE_OWNER_SESSION_REQUIRED/);
 assert.equal(calls.length,0);
});
test('lost native mutation is pending and cannot be retried with different id',async()=>{
 const calls=[];const ctl=mockController(calls,{failMutation:true});
 await ctl.execute('workspace_native_ui_observe',target);
 const a={...target,fingerprint:fp,controlName:'No',requestId:'rc011-native-unknown-01',
 explicitUserAuthorization:'Owner allows the exact disposable native GUI button'};
 const first=await ctl.execute('workspace_native_ui_invoke',a);
 assert.equal(first.ok,false);assert.equal(first.mode,'NATIVE_UIA_OUTCOME_UNCERTAIN');
 await ctl.execute('workspace_native_ui_observe',target);
 await assert.rejects(ctl.execute('workspace_native_ui_invoke',{...a,requestId:'rc011-native-unknown-02'}),/WORKSPACE_TARGET_RECONCILIATION_REQUIRED/);
 assert.equal(calls.filter(c=>c.op==='Invoke').length,1);
});
test('agent plan does not confer owner privileges and respects the OS',async()=>{
 const calls=[];const ctl=mockController(calls,{owner:false});
 const route=await ctl.execute('workspace_agentos_plan',{target:'existing-app'});
 assert.equal(route.status,'BLOCKED');assert.equal(route.code,'OWNER_SESSION_REQUIRED');
 assert.equal(route.autoElevate,false);
 assert.equal(calls.length,0);
});
