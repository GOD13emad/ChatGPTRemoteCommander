import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createWorkspaceAccessibilityTools,workspaceAccessibilityDefinitions,atspiCommandPolicy
} from '../src/workspace-accessibility-tools.mjs';

const OWNER={processId:10369,handle:'4205340062'};
const make=({appName='firefox',wmClass='firefox_firefox',initialTitle='IEEE Xplore: Advanced Search — Mozilla Firefox'}={})=>{
 const calls=[];
 let title=initialTitle;
 let app=appName,cls=wmClass;
 let focused=true;
 let activeLease=0;
 let now=1000;
 const gui=async(name,args)=>{
  calls.push({name,args});
  if(name==='gui_status')return {ok:true,available:true,screens:[{index:0},{index:1}]};
  if(name==='gui_session_begin')return {ok:true,lease:'lease-'+(++activeLease),mode:args.mode};
  if(name==='gui_list_windows')return {ok:true,windows:[{...OWNER,title,appName:app,wmClass:cls,focused}]};
  if(name==='gui_session_end')return {ok:true};
  throw Error('COORDINATE_METHOD_FORBIDDEN_'+name);
 };
 const transport=async (r,policy)=>{
  calls.push({name:'atspi',args:r,policy});
  assert.equal(r.pid,10369);
  assert.equal(r.windowTitle,title);
  if(r.command==='snapshot')return {ok:true,nodesVisited:22,truncated:false,controls:[
   {path:[0,2],role:'entry',name:'Search query',editable:true,action:null},
   {path:[0,4],role:'button',name:'Search',editable:false,action:'click'}
  ]};
  if(r.command==='type')return {ok:true,effect:'DISPATCHED'};
  if(r.command==='invoke')return {ok:true,effect:'DISPATCHED'};
  throw Error('UNKNOWN_ATSPI_OP');
 };
 const sessions=new Map(),api=createWorkspaceAccessibilityTools({gui,transport,sessions,now:()=>now});
 return {api,calls,sessions,setFocused:x=>focused=x,setTitle:x=>title=x,setApp:x=>app=x,setClass:x=>cls=x,advance:x=>now+=x};
};

test('AT-SPI semantic route offers only independent non-coordinate tools',()=>{
 const names=workspaceAccessibilityDefinitions.map(x=>x.name);
 assert.deepEqual(names,[
  'workspace_accessibility_open','workspace_accessibility_snapshot',
  'workspace_accessibility_type','workspace_accessibility_invoke','workspace_accessibility_end'
 ]);
 for(const item of workspaceAccessibilityDefinitions){
  assert.equal(item.inputSchema.additionalProperties,false);
  assert.equal(item.name.includes('click'),false);
  assert.equal(item.name.includes('mouse'),false);
 }
});

test('owner observes controls but cannot mutate with observe-only lease',async()=>{
 const m=make();
 const l=await m.api.execute('workspace_accessibility_open',{...OWNER,mode:'observe'});
 assert.equal(l.semanticOnly,true);
 const snap=await m.api.execute('workspace_accessibility_snapshot',{...OWNER,lease:l.lease});
 assert.equal(snap.controls.length,2);
 assert.equal(snap.valuesRead,false);
 await assert.rejects(m.api.execute('workspace_accessibility_type',{
  ...OWNER,lease:l.lease,elementId:snap.controls[0].elementId,text:'TEST'
 }),/WORKSPACE_ACCESSIBILITY_TAKEOVER_REQUIRED/);
 assert.equal((await m.api.execute('workspace_accessibility_end',{lease:l.lease})).ok,true);
 assert.equal(m.calls.filter(x=>x.name==='atspi').length,1);
});

test('one-shot authorized semantic text + click with exact PID/HWND, no pointer',async()=>{
 const m=make();
 const l=await m.api.execute('workspace_accessibility_open',{
  ...OWNER,mode:'takeover',explicitUserAuthorization:'Owner accepts AT-SPI on existing Firefox only'
 });
 const controls=(await m.api.execute('workspace_accessibility_snapshot',{...OWNER,lease:l.lease})).controls;
 const typed=await m.api.execute('workspace_accessibility_type',{...OWNER,lease:l.lease,
  elementId:controls[0].elementId,text:'RC011_QUERY_QA'});
 assert.equal(typed.ok,true);
 await assert.rejects(m.api.execute('workspace_accessibility_type',{...OWNER,lease:l.lease,
  elementId:controls[0].elementId,text:'DUPLICATE'}),/ELEMENT_STALE_OR_UNBOUND/);
 const clicked=await m.api.execute('workspace_accessibility_invoke',{...OWNER,lease:l.lease,
  elementId:controls[1].elementId});
 assert.equal(clicked.effect,'DISPATCHED');
 assert.equal(m.calls.some(c=>c.name.includes('mouse')||c.name.includes('gui_type_text')),false);
 await m.api.execute('workspace_accessibility_end',{lease:l.lease});
 assert.equal(m.sessions.size,0);
});

test('focused owner window required at action time',async()=>{
 const m=make();const l=await m.api.execute('workspace_accessibility_open',{...OWNER,mode:'takeover',
  explicitUserAuthorization:'Current owner permits P12 semantic controls'});
 const f=(await m.api.execute('workspace_accessibility_snapshot',{...OWNER,lease:l.lease})).controls[0];
 m.setFocused(false);
 await assert.rejects(m.api.execute('workspace_accessibility_type',{...OWNER,
  lease:l.lease,elementId:f.elementId,text:'NEVER'}),/FOCUS_NOT_CONFIRMED/);
 assert.equal(m.calls.filter(c=>c.name==='atspi'&&c.args.command==='type').length,0);
 await m.api.execute('workspace_accessibility_end',{lease:l.lease});
});

test('window title change refuses new actions',async()=>{
 const m=make();const l=await m.api.execute('workspace_accessibility_open',{...OWNER,mode:'takeover',
  explicitUserAuthorization:'Current owner permits P12 semantic controls'});
 const item=(await m.api.execute('workspace_accessibility_snapshot',{...OWNER,lease:l.lease})).controls[1];
 m.setTitle('Different page — Mozilla Firefox');
 await assert.rejects(m.api.execute('workspace_accessibility_invoke',{...OWNER,
  lease:l.lease,elementId:item.elementId}),/OWNER_APPLICATION_CHANGED/);
 assert.equal(m.calls.filter(c=>c.name==='atspi'&&c.args.command==='invoke').length,0);
 await m.api.execute('workspace_accessibility_end',{lease:l.lease});
});

test('expired element and wrong PID refuse without native mutation',async()=>{
 const m=make();const l=await m.api.execute('workspace_accessibility_open',{...OWNER,mode:'takeover',
  explicitUserAuthorization:'Current owner permits P12 semantic controls'});
 const item=(await m.api.execute('workspace_accessibility_snapshot',{...OWNER,lease:l.lease})).controls[1];
 await assert.rejects(m.api.execute('workspace_accessibility_invoke',{...OWNER,
  processId:4321,lease:l.lease,elementId:item.elementId}),/LEASE_UNBOUND/);
 m.advance(20001);
 await assert.rejects(m.api.execute('workspace_accessibility_invoke',{...OWNER,
  lease:l.lease,elementId:item.elementId}),/ELEMENT_STALE_OR_UNBOUND/);
 assert.equal(m.calls.filter(c=>c.name==='atspi'&&c.args.command==='invoke').length,0);
 await m.api.execute('workspace_accessibility_end',{lease:l.lease});
});

test('authorization and capability assumptions enforced before lease',async()=>{
 const m=make();
 await assert.rejects(m.api.execute('workspace_accessibility_open',{...OWNER,mode:'takeover'}),
 /AUTHORIZATION_REQUIRED/);
 await assert.rejects(m.api.execute('workspace_accessibility_open',{
  processId:0,handle:'invalid',mode:'observe'}),/IDENTITY_INVALID/);
 assert.equal(m.calls.filter(c=>c.name==='gui_session_begin').length,0);
});


test('Firefox read-only snapshot gets a longer bounded budget without extending mutations',async()=>{
 assert.deepEqual(atspiCommandPolicy('snapshot'),{
  timeoutMs:18000,timeoutCode:'ATSPI_SNAPSHOT_TIMEOUT_NO_EFFECT'
 });
 for(const cmd of ['type','invoke']){
  assert.deepEqual(atspiCommandPolicy(cmd),{
   timeoutMs:7000,timeoutCode:'ATSPI_OPERATION_TIMEOUT_EFFECT_UNKNOWN'
  });
 }
 const m=make();
 const lease=await m.api.execute('workspace_accessibility_open',{...OWNER,
  mode:'takeover',explicitUserAuthorization:'Owner permits focused test Firefox semantic controls'});
 const controls=(await m.api.execute('workspace_accessibility_snapshot',{...OWNER,lease:lease.lease})).controls;
 await m.api.execute('workspace_accessibility_type',{...OWNER,lease:lease.lease,
  elementId:controls[0].elementId,text:'budget-only-test'});
 await m.api.execute('workspace_accessibility_invoke',{...OWNER,lease:lease.lease,
  elementId:controls[1].elementId});
 await m.api.execute('workspace_accessibility_end',{lease:lease.lease});
 assert.deepEqual(m.calls.filter(x=>x.name==='atspi').map(x=>({
  command:x.args.command,timeoutMs:x.policy.timeoutMs
 })),[{command:'snapshot',timeoutMs:18000},{command:'type',timeoutMs:7000},
  {command:'invoke',timeoutMs:7000}]);
});

test('generic AT-SPI lease works for a different same-user application with exact window and no coordinates',async()=>{
 const m=make({appName:'zenity',wmClass:'zenity',initialTitle:'RC_QA_DIALOG'});
 const l=await m.api.execute('workspace_accessibility_open',{...OWNER,mode:'takeover',
  explicitUserAuthorization:'Owner authorizes isolated zenity QA'});
 const controls=(await m.api.execute('workspace_accessibility_snapshot',{...OWNER,lease:l.lease})).controls;
 assert.equal(controls.length,2);
 await m.api.execute('workspace_accessibility_type',{...OWNER,lease:l.lease,
  elementId:controls[0].elementId,text:'PRIVATE_TEST'});
 const r=await m.api.execute('workspace_accessibility_invoke',{...OWNER,lease:l.lease,
  elementId:controls[1].elementId});
 assert.equal(r.effect,'DISPATCHED');
 assert.equal(m.calls.some(c=>/gui_mouse|gui_type|gui_focus/.test(c.name)),false);
 await m.api.execute('workspace_accessibility_end',{lease:l.lease});
 assert.equal(m.sessions.size,0);
});
test('application identity drift or an unidentified app fails closed before semantic effect',async()=>{
 const bad=make({appName:'',wmClass:''});
 await assert.rejects(bad.api.execute('workspace_accessibility_open',{...OWNER,mode:'observe'}),
  /OWNER_APPLICATION_UNVERIFIED/);
 const m=make({appName:'zenity',wmClass:'zenity',initialTitle:'RC_QA_DIALOG'});
 const l=await m.api.execute('workspace_accessibility_open',{...OWNER,mode:'takeover',
  explicitUserAuthorization:'Owner authorizes isolated zenity QA'});
 const snap=await m.api.execute('workspace_accessibility_snapshot',{...OWNER,lease:l.lease});
 m.setApp('different-app');
 await assert.rejects(m.api.execute('workspace_accessibility_invoke',{...OWNER,lease:l.lease,
  elementId:snap.controls[1].elementId}),/OWNER_APPLICATION_CHANGED/);
 assert.equal(m.calls.filter(c=>c.name==='atspi'&&c.args.command==='invoke').length,0);
 await m.api.execute('workspace_accessibility_end',{lease:l.lease});
});
