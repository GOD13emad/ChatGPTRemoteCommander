import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseWorkspaceRoute,classifyWorkspaceOutcome} from '../src/workspace-routing.mjs';
import {createWorkspaceController as makeWorkspaceController,workspaceToolDefinitions,assertWorkspaceToolPolicy} from '../src/workspace-tools.mjs';
import {createMemoryWorkspaceJournal} from '../src/workspace-target-journal.mjs';
const createWorkspaceController=options=>makeWorkspaceController({journal:createMemoryWorkspaceJournal(),...options});
const snapshot=(s)=>({snapshot_id:s,elements:[{element_token:s+':1',role:'button',actions:['click']}]});
const owner=()=>true;
const a={pid:555,windowId:22,elementToken:'s00000001:1',requestId:'request-window-a-click-1',
 explicitUserAuthorization:'User explicitly requested this exact window automation'};
const b={pid:666,windowId:23,elementToken:'s00000002:1',requestId:'request-window-b-click-2',
 explicitUserAuthorization:'User explicitly requested this exact window automation'};
test('planning prefers same-owner background windows; never physical keyboard or global lock',()=>{
 const p=chooseWorkspaceRoute({target:'existing-app',desktop:'windows',sameUserSession:true});
 assert.equal(p.route,'CUA_BACKGROUND_WINDOW');
 assert.equal(p.globalInputLock,false);
 assert.equal(p.physicalMouse,'UNCHANGED');
 assert.equal(p.foreground,'PRESERVE');
 assert.equal(chooseWorkspaceRoute({target:'existing-browser',desktop:'windows',sameUserSession:true,
   existingProfileGrant:false}).route,'PROFILE_ATTACH_AUTHORIZATION_REQUIRED');
 assert.equal(chooseWorkspaceRoute({target:'existing-browser',desktop:'windows',sameUserSession:true,
   existingProfileGrant:true}).route,'CUA_EXISTING_BROWSER_CDP');
 assert.equal(chooseWorkspaceRoute({target:'new-browser',desktop:'wayland'}).route,'COMMANDER_OWNED_PERSISTENT_PROFILE');
 assert.equal(chooseWorkspaceRoute({target:'existing-app',desktop:'wayland',
   sameUserSession:true,backgroundCapability:false}).route,'BACKGROUND_UNAVAILABLE_TARGET_ONLY');
 assert.equal(chooseWorkspaceRoute({target:'new-app',desktop:'x11'}).route,'PRIVATE_X11_DISPLAY');
});
test('no SYSTEM-to-owner pipe access or desktop-injection fallback',async()=>{
 let called=0;
 const ctl=createWorkspaceController({ownerSession:async()=>false,callDriver:async()=>{called++}});
 const plan=await ctl.execute('workspace_plan',{target:'existing-app'});
 assert.equal(plan.route,'OWNER_SESSION_BRIDGE_REQUIRED');
 await assert.rejects(ctl.execute('workspace_list_windows',{}),/WORKSPACE_OWNER_SESSION_REQUIRED/);
 await assert.rejects(ctl.execute('workspace_window_click',a),/WORKSPACE_OWNER_SESSION_REQUIRED/);
 assert.equal(called,0);
});
test('read-only observe returns exact element snapshot; confirmed click uses background only',async()=>{
 const calls=[];
 const ctl=createWorkspaceController({ownerSession:owner,now:()=>123400,
  callDriver:async(tool,args)=>{calls.push({tool,args});
   return tool==='get_window_state'?snapshot('s00000001'):
     tool==='click'?{effect:'confirmed',verified:true}:[];}});
 let shot=await ctl.execute('workspace_window_observe',{pid:a.pid,windowId:a.windowId});
 assert.equal(shot.snapshotId,'s00000001');
 let done=await ctl.execute('workspace_window_click',a);
 assert.equal(done.decision.status,'CONFIRMED');
 assert.equal(done.physicalInputTouched,false);
 assert.equal(done.focusChanged,false);
 assert.deepEqual(calls.at(-1),{tool:'click',args:{target:{kind:'window',pid:a.pid,window_id:a.windowId},
   element_token:a.elementToken,delivery_mode:'background',session:'rcws-555-22'}});
 assert.equal(workspaceToolDefinitions.some(t=>t.name==='workspace_window_click'),true);
});
test('unknown outcome blocks ONLY the same window until fresh snapshot reconciliation',async()=>{
 const called=[];
 const ctl=createWorkspaceController({ownerSession:owner,now:()=>1000,
  callDriver:async(tool,args)=>{called.push({tool,args});
   if(tool==='get_window_state')return snapshot(args.pid===555?'s00000001':'s00000002');
   if(tool==='click'&&args.target.pid===555)throw Error('uncertain native outcome');
   return {effect:'confirmed',verified:true};}});
 await ctl.execute('workspace_window_observe',{pid:a.pid,windowId:a.windowId});
 await ctl.execute('workspace_window_observe',{pid:b.pid,windowId:b.windowId});
 const unknown=await ctl.execute('workspace_window_click',a);
 assert.equal(unknown.decision.status,'RECONCILE_TARGET');
 assert.equal(unknown.noGlobalInputLock,true);
 const other=await ctl.execute('workspace_window_click',b);
 assert.equal(other.decision.status,'CONFIRMED');
 await assert.rejects(ctl.execute('workspace_window_click',{...a,requestId:'request-window-a-click-3'}),
  /WORKSPACE_TARGET_RECONCILIATION_REQUIRED/);
 let fresh=await ctl.execute('workspace_window_observe',{pid:a.pid,windowId:a.windowId});
 assert.equal(fresh.targetUncertain,true);
 const ack=await ctl.execute('workspace_target_reconcile',{pid:a.pid,windowId:a.windowId,
  snapshotId:'s00000001',determination:'EFFECT_OBSERVED'});
 assert.equal(ack.ok,true);
 assert.equal(ack.replayed,false);
 assert.equal(called.filter(x=>x.tool==='click'&&x.args.target.pid===555).length,1);
 await assert.rejects(ctl.execute('workspace_window_click',a),/WORKSPACE_DUPLICATE_REQUEST_NO_REPLAY/);
});
test('stale snapshot, wrong target and missing approval never invoke CUA',async()=>{
 let calls=0;
 const ctl=createWorkspaceController({ownerSession:owner,now:()=>65000,callDriver:async()=>{
  calls++;return snapshot('s00000001');}});
 await assert.rejects(ctl.execute('workspace_window_click',a),/WORKSPACE_FRESH_SNAPSHOT_REQUIRED/);
 await ctl.execute('workspace_window_observe',{pid:a.pid,windowId:a.windowId});
 await assert.rejects(ctl.execute('workspace_window_click',{...a,elementToken:'s00000002:1'}),/WORKSPACE_FRESH_SNAPSHOT_REQUIRED/);
 await assert.rejects(ctl.execute('workspace_window_click',{...a,explicitUserAuthorization:'x'}),/WORKSPACE_EXPLICIT_AUTHORIZATION_REQUIRED/);
 assert.equal(calls,1);
});
test('Wayland background refusal never silently escalates to physical input',()=>{
 assert.equal(classifyWorkspaceOutcome({refusedCode:'background_unavailable'}).status,'ROUTE_ALTERNATIVE_REQUIRED');
 assert.equal(classifyWorkspaceOutcome({effect:'unverifiable'}).status,'RECONCILE_TARGET');
});

test('existing signed-in browser is attached only through native existing-profile grant and background mode',async()=>{
 const calls=[];
 const ctl=createWorkspaceController({ownerSession:owner,now:()=>900,
  callDriver:async(tool,args)=>{
   calls.push({tool,args});
   if(tool==='browser_prepare')return {ok:true,effect:'confirmed',attached_existing_profile:true};
   if(tool==='get_browser_state')return {target_id:'target-1',tabs:[{tab_id:'tab-1'}]};
   if(tool==='browser_click')return {ok:true,effect:'confirmed',verified:true};
  }});
 const permission='I authorize attaching to my already logged-in browser without foreground activation.';
 const attached=await ctl.execute('workspace_browser_attach',{pid:44,windowId:11,explicitUserAuthorization:permission});
 assert.equal(attached.ok,true);
 assert.deepEqual(calls.at(-1),{tool:'browser_prepare',args:{
  pid:44,window_id:11,strategy:{kind:'existing_profile'},
  delivery_mode:'background',session:'rcws-44-11'}});
 const s=await ctl.execute('workspace_browser_inspect',{pid:44,windowId:11});
 assert.equal(s.mode,'BACKGROUND_READ_ONLY');
 const r=await ctl.execute('workspace_browser_click',{pid:44,windowId:11,targetId:'target-1',
   tabId:'tab-1',ref:'p00000001:2',requestId:'signedin-browser-click-1',explicitUserAuthorization:permission});
 assert.equal(r.ok,true);assert.equal(r.decision.status,'CONFIRMED');
 assert.equal(calls.at(-1).args.delivery_mode,'background');
 assert.equal(calls.at(-1).args.target_id,'target-1');
});
test('existing browser denied grant never copies the profile or changes focus',async()=>{
 let calls=0;
 const ctl=createWorkspaceController({ownerSession:owner,callDriver:async(tool,args)=>{
  calls++;if(tool==='browser_prepare')throw Error('grant not available');
 }});
 const x=await ctl.execute('workspace_browser_attach',{pid:44,windowId:11,
  explicitUserAuthorization:'I authorize same-browser background attachment'});
 assert.equal(x.status,'PROFILE_ATTACH_NOT_READY');assert.equal(x.scope,'TARGET_ONLY');
 assert.equal(calls,1);
 await assert.rejects(ctl.execute('workspace_browser_click',{pid:44,windowId:11,
 targetId:'x',tabId:'t',ref:'p00000001:2',requestId:'signedin-browser-click-1',
 explicitUserAuthorization:'I authorize same-browser background attachment'}),
 /WORKSPACE_FRESH_SNAPSHOT_REQUIRED/);
 assert.equal(calls,1);
});

test('read-only spectator preview returns a static PNG, not pointer interaction',async()=>{
 let calls=0;
 const ctl=createWorkspaceController({ownerSession:owner,platform:'linux',env:{XDG_RUNTIME_DIR:'/run/user/1000'},previewDriver:async(args,scope)=>{
  calls++;assert.equal(args.pid,91);assert.equal(args.window_id,92);
  assert.equal(scope.workspaceSeat,'a');
  return {meta:{window_id:92},imageBytes:Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(20)])};
 }});
 const v=await ctl.execute('workspace_window_preview',{pid:91,windowId:92,workspaceSeat:'a'});
 assert.equal(v.__structuredContent.mode,'READ_ONLY_SPECTATOR');
 assert.equal(v.__structuredContent.interactiveInput,false);
 assert.equal(v.__mcpContent[0].mimeType,'image/png');
 assert.equal(calls,1);
});
test('browser uncertain click affects one browser only, reconcilable from next target snapshot',async()=>{
 const c=createWorkspaceController({ownerSession:owner,now:()=>1000,
 callDriver:async(tool,args)=>{
  if(tool==='get_browser_state')return {target_id:'target-1',tabs:[{tab_id:'tab-1'}]};
  if(tool==='browser_click')return {ok:true,effect:'unverifiable',verified:false};
  return {ok:true};
 }});
 const request={pid:44,windowId:11,targetId:'target-1',tabId:'tab-1',
  ref:'p00000001:2',requestId:'browser-uncertain-receipt-01',
  explicitUserAuthorization:'User authorized exactly this background browser tab'};
 await c.execute('workspace_browser_inspect',{pid:44,windowId:11});
 const click=await c.execute('workspace_browser_click',request);
 assert.equal(click.decision.status,'RECONCILE_TARGET');
 const observed=await c.execute('workspace_browser_inspect',{pid:44,windowId:11});
 assert.equal(observed.targetUncertain,true);
 assert.match(observed.snapshotId,/^b[0-9a-f]{8}$/);
 await assert.rejects(c.execute('workspace_browser_click',{...request,requestId:'browser-uncertain-receipt-02'}),
 /WORKSPACE_TARGET_RECONCILIATION_REQUIRED/);
 const ack=await c.execute('workspace_target_reconcile',{pid:44,windowId:11,surface:'browser',
 snapshotId:observed.snapshotId,determination:'EFFECT_OBSERVED'});
 assert.equal(ack.ok,true);assert.equal(ack.replayed,false);
});

test('exact pre-dispatch stale-element refusal does not latch or globally block input',async()=>{
 let serial=0;
 const c=createWorkspaceController({ownerSession:owner,now:()=>4000,callDriver:async(tool)=>{
  if(tool==='get_window_state')return snapshot(serial===0?'s00000001':'s00000002');
  if(tool==='click'){serial++;return serial===1?
   {status:'refused',refusal:{code:'stale_element_token'}}:
   {ok:true,effect:'confirmed',verified:true};}
 }});
 await c.execute('workspace_window_observe',{pid:a.pid,windowId:a.windowId});
 const refused=await c.execute('workspace_window_click',a);
 assert.equal(refused.status,'REFUSED_NO_EFFECT');assert.equal(refused.next,'REFRESH_SNAPSHOT');
 const next=await c.execute('workspace_window_observe',{pid:a.pid,windowId:a.windowId});
 assert.equal(next.targetUncertain,false);
 assert.equal(next.snapshotId,'s00000002');
 const accepted=await c.execute('workspace_window_click',{...a,elementToken:'s00000002:1',requestId:'request-window-a-after-refresh'});
 assert.equal(accepted.decision.status,'CONFIRMED');
});

test('private isolated X11 target-gone proof resolves only the vanished window',async()=>{
 let visible=true;
 const c=createWorkspaceController({ownerSession:owner,platform:'linux',
  env:{XDG_RUNTIME_DIR:'/run/user/1000'},journal:createMemoryWorkspaceJournal(),now:()=>1500,
  callDriver:async(tool,args)=>{
   if(tool==='get_window_state')return snapshot('s00000001');
   if(tool==='click')return {effect:'unverifiable'};
   if(tool==='list_windows')return {windows:visible?[{pid:555,window_id:22}]:[]};
  }});
 const args={pid:555,windowId:22,workspaceSeat:'a'};
 await c.execute('workspace_window_observe',args);
 const outcome=await c.execute('workspace_window_click',{...args,
  elementToken:'s00000001:1',requestId:'private-gone-receipt-1',
  explicitUserAuthorization:'User authorized this isolated test window'});
 assert.equal(outcome.decision.status,'RECONCILE_TARGET');
 await assert.rejects(c.execute('workspace_target_reconcile',{...args,surface:'window',
  targetGoneVerified:true,determination:'EFFECT_OBSERVED'}),/WORKSPACE_TARGET_GONE_NOT_PROVEN/);
 visible=false;
 const resolved=await c.execute('workspace_target_reconcile',{...args,surface:'window',
  targetGoneVerified:true,determination:'EFFECT_OBSERVED'});
 assert.equal(resolved.ok,true);assert.equal(resolved.replayed,false);
});

test('unverifiable window closure auto-reconciles exact Windows target by independent native listing',async()=>{
 let clickCount=0;
 const c=createWorkspaceController({ownerSession:owner,platform:'win32',now:()=>700,
  callDriver:async(tool,args)=>{
    if(tool==='get_window_state')return snapshot('s00000001');
    if(tool==='click'){clickCount++;return {effect:'unverifiable',verified:false};}
    if(tool==='list_windows')return {windows:[]};
    throw Error('unexpected '+tool);
  }});
 await c.execute('workspace_window_observe',{pid:555,windowId:22});
 const done=await c.execute('workspace_window_click',a);
 assert.equal(done.decision.status,'TARGET_GONE_VERIFIED');
 assert.equal(done.decision.userGoalVerified,false);
 assert.equal(done.verifiedTargetGone,true);
 assert.equal(done.replayed,false);
 assert.equal(clickCount,1);
 const next=await c.execute('workspace_window_observe',{pid:555,windowId:22});
 assert.equal(next.targetUncertain,false);
});
test('Windows manual reconciliation requires independently verified absence; target remains scoped until then',async()=>{
 let present=true;
 const c=createWorkspaceController({ownerSession:owner,platform:'win32',now:()=>701,
  callDriver:async(tool,args)=>{
   if(tool==='get_window_state')return snapshot('s00000001');
   if(tool==='click')throw Error('native reply lost');
   if(tool==='list_windows')return {windows:present?[{pid:555,window_id:22}]:[]};
  }});
 await c.execute('workspace_window_observe',{pid:555,windowId:22});
 const error=await c.execute('workspace_window_click',a);
 assert.equal(error.decision.status,'RECONCILE_TARGET');
 await assert.rejects(c.execute('workspace_target_reconcile',{pid:555,windowId:22,
   determination:'EFFECT_OBSERVED',targetGoneVerified:true}),
   /WORKSPACE_TARGET_GONE_NOT_PROVEN/);
 present=false;
 const ack=await c.execute('workspace_target_reconcile',{pid:555,windowId:22,
   determination:'EFFECT_OBSERVED',targetGoneVerified:true});
 assert.equal(ack.replayed,false);
 assert.equal(ack.ok,true);
});

test('Core policy is enforced before owner delegation for every workspace surface',()=>{
 const disabled={powerMode:{enabled:false,guiControl:{enabled:true,allowMouse:true},browserControl:{enabled:true,allowInput:true}}};
 assert.throws(()=>assertWorkspaceToolPolicy(disabled,'workspace_window_click',{}),/WORKSPACE_POWER_MODE_DISABLED/);
 const config={powerMode:{enabled:true,guiControl:{enabled:true,allowMouse:false,allowScreenshot:false},
   browserControl:{enabled:false,allowInput:true}}};
 assert.throws(()=>assertWorkspaceToolPolicy(config,'workspace_window_click',{}),/WORKSPACE_GUI_INPUT_POLICY_DENIED/);
 assert.throws(()=>assertWorkspaceToolPolicy(config,'workspace_window_preview',{}),/WORKSPACE_GUI_PREVIEW_POLICY_DENIED/);
 assert.throws(()=>assertWorkspaceToolPolicy(config,'workspace_browser_inspect',{}),/WORKSPACE_BROWSER_CONTROL_DISABLED/);
 assert.throws(()=>assertWorkspaceToolPolicy(config,'workspace_target_reconcile',{surface:'browser'}),/WORKSPACE_BROWSER_CONTROL_DISABLED/);
 const enabled={powerMode:{enabled:true,guiControl:{enabled:true,allowMouse:true,allowScreenshot:true},
 browserControl:{enabled:true,allowInput:false}}};
 assert.equal(assertWorkspaceToolPolicy(enabled,'workspace_window_click',{}),undefined);
 assert.equal(assertWorkspaceToolPolicy(enabled,'workspace_browser_inspect',{}),undefined);
 assert.throws(()=>assertWorkspaceToolPolicy(enabled,'workspace_browser_attach',{}),/WORKSPACE_BROWSER_INPUT_POLICY_DENIED/);
 assert.throws(()=>assertWorkspaceToolPolicy(enabled,'workspace_target_reconcile',{surface:'browser'}),/WORKSPACE_BROWSER_INPUT_POLICY_DENIED/);
});

test('native browser consent refusal is a bounded target-only non-effect, never a GUI lock',async()=>{
 let attempts=0;
 const c=createWorkspaceController({ownerSession:owner,callDriver:async(tool)=>{
  attempts++;
  if(tool==='get_browser_state'||tool==='browser_prepare')
   return {status:'refused',refusal:{code:'browser_consent_required'}};
  throw Error('unexpected native tool');
 }});
 const args={pid:44,windowId:11};
 const scan=await c.execute('workspace_browser_inspect',args);
 assert.equal(scan.ok,false);
 assert.equal(scan.code,'browser_consent_required');
 assert.equal(scan.focusChanged,false);
 const prepare=await c.execute('workspace_browser_attach',{...args,
  explicitUserAuthorization:'Owner explicitly requested background profile attachment'});
 assert.equal(prepare.ok,false);
 assert.equal(prepare.errorCode,'browser_consent_required');
 assert.equal(prepare.status,'PROFILE_ATTACH_NOT_READY');
 assert.equal(attempts,2);
});
