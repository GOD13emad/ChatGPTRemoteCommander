import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceController,workspaceMutationEffectArgs,assertWorkspaceToolPolicy,workspaceToolDefinitions}
 from '../src/workspace-tools.mjs';
import {createMemoryWorkspaceJournal} from '../src/workspace-target-journal.mjs';

const target={pid:333,windowId:444};
const token='s00000001:2';
const auth='Owner authorizes exact disposable window input only';
const requestId='rc-window-type-qa-20261030-01';
function setup({label='QA plain text',role='edit',effect='verified',verified=true}={}){
 const journal=createMemoryWorkspaceJournal(),calls=[];
 const api=createWorkspaceController({platform:'linux',
  env:{XDG_RUNTIME_DIR:'/run/user/1000',DISPLAY:':1960'},
  ownerSession:async()=>true,journal,
  callDriver:async(name,args,scope)=>{
   calls.push({name,args,scope});
   if(name==='get_window_state')return {snapshot_id:'s00000001',
    elements:[{element_token:token,role,label}]};
   if(name==='type_text')return {effect,verified,ok:true};
   throw Error('UNEXPECTED_DRIVER_CALL_'+name);
  }});
 return {api,journal,calls};
}
const inp={...target,elementToken:token,text:'ONE_EXACT_QA_TEXT',
 requestId,explicitUserAuthorization:auth};
test('window typing is a declared owner-scoped and idempotency-bound action',()=>{
 const def=workspaceToolDefinitions.find(x=>x.name==='workspace_window_type');
 assert.ok(def);
 assert.equal(def.annotations.destructiveHint,true);
 assert.ok(def.inputSchema.required.includes('elementToken'));
 assert.ok(def.inputSchema.required.includes('explicitUserAuthorization'));
 assert.equal(workspaceMutationEffectArgs(def.name,inp,'outer-receipt-qa-20261030').requestId,'outer-receipt-qa-20261030');
 assert.throws(()=>workspaceMutationEffectArgs(def.name,inp,undefined),/WORKSPACE_BINDING_INVALID/);
 const config={powerMode:{enabled:true,guiControl:{enabled:true,allowMouse:false,allowKeyboard:true}}};
 assert.doesNotThrow(()=>assertWorkspaceToolPolicy(config,def.name,inp));
 assert.throws(()=>assertWorkspaceToolPolicy({powerMode:{enabled:true,guiControl:{enabled:true,allowKeyboard:false}}},def.name,inp),
  /WORKSPACE_GUI_KEYBOARD_POLICY_DENIED/);
});
test('verified generic text action uses exact window, element token and background delivery only',async()=>{
 const m=setup();
 await m.api.execute('workspace_window_observe',target);
 const r=await m.api.execute('workspace_window_type',inp);
 assert.equal(r.ok,true);
 assert.equal(r.mode,'BACKGROUND_TEXT_TARGETED');
 assert.equal(r.focusChanged,false);
 assert.equal(m.calls.filter(x=>x.name==='type_text').length,1);
 const sent=m.calls.find(x=>x.name==='type_text').args;
 assert.deepEqual(sent.target,{kind:'window',pid:333,window_id:444});
 assert.equal(sent.delivery_mode,'background');
 assert.equal(sent.element_token,token);
 assert.equal(sent.text,inp.text);
 assert.equal(await m.journal.pending('333:444'),null);
});
test('unverifiable type effect remains target-pending, never replayed',async()=>{
 const m=setup({effect:'unverifiable',verified:false});
 await m.api.execute('workspace_window_observe',target);
 const r=await m.api.execute('workspace_window_type',inp);
 assert.equal(r.decision.status,'RECONCILE_TARGET');
 const pending=await m.journal.pending('333:444');
 assert.equal(pending.action,'workspace_window_type');
 assert.equal(Object.prototype.hasOwnProperty.call(pending,'text'),false);
 await m.api.execute('workspace_window_observe',target);
 await assert.rejects(m.api.execute('workspace_window_type',{...inp,requestId:'rc-window-type-qa-second-attempt'}),
  /WORKSPACE_TARGET_RECONCILIATION_REQUIRED/);
 assert.equal(m.calls.filter(x=>x.name==='type_text').length,1);
});
test('sensitive, non-editable and mismatched elements are refused before effect',async()=>{
 for(const props of [
  {label:'Password',role:'edit'},{label:'OTP verification',role:'text box'},
  {label:'QA button',role:'button'}]){
  const m=setup(props);
  await m.api.execute('workspace_window_observe',target);
  await assert.rejects(m.api.execute('workspace_window_type',inp),/WORKSPACE_TEXT_TARGET_UNVERIFIED/);
  assert.equal(m.calls.filter(x=>x.name==='type_text').length,0);
 }
 const m=setup();await m.api.execute('workspace_window_observe',target);
 await assert.rejects(m.api.execute('workspace_window_type',{...inp,text:'\0hidden'}),
   /WORKSPACE_TEXT_INVALID/);
 await assert.rejects(m.api.execute('workspace_window_type',{...inp,elementToken:'s00000002:2'}),
   /WORKSPACE_FRESH_SNAPSHOT_REQUIRED/);
 assert.equal(m.calls.filter(x=>x.name==='type_text').length,0);
});
