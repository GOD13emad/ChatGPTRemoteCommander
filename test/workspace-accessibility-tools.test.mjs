import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createWorkspaceAccessibilityTools,workspaceAccessibilityDefinitions
} from '../src/workspace-accessibility-tools.mjs';

const OWNER={processId:10369,handle:'4205340062'};
const make=(withCheckbox=false,extraControls=[])=>{
 const calls=[];
 let title='RC bounded fixture — Mozilla Firefox';
 let focused=true;
 let activeLease=0;
 let failSnapshot=false;
 let now=1000;
 const gui=async(name,args)=>{
  calls.push({name,args});
  if(name==='gui_status')return {ok:true,available:true,screens:[{index:0},{index:1}]};
  if(name==='gui_session_begin')return {ok:true,lease:'lease-'+(++activeLease),mode:args.mode};
  if(name==='gui_list_windows')return {ok:true,windows:[{...OWNER,title,wmClass:'firefox_firefox',focused}]};
  if(name==='gui_session_end')return {ok:true};
  throw Error('COORDINATE_METHOD_FORBIDDEN_'+name);
 };
 const transport=async r=>{
  calls.push({name:'atspi',args:r});
  assert.equal(r.pid,10369);
  assert.equal(r.windowTitle,title);
  if(r.command==='snapshot'&&failSnapshot)
   throw new Error('ATSPI_OBSERVATION_TIMEOUT_NO_EFFECT');
  if(r.command==='snapshot')return {ok:true,nodesVisited:22,truncated:false,controls:[
   {path:[0,2],role:'entry',name:'Search query',editable:true,action:null},
   {path:[0,4],role:'button',name:'Search',editable:false,action:'click'},
   ...(withCheckbox?[{path:[0,7],role:'check box',name:'public item with no stars',editable:false,action:'check'}]:[]),
   ...extraControls
  ]};
  if(r.command==='type')return {ok:true,effect:'DISPATCHED'};
  if(r.command==='invoke')return {ok:true,effect:'DISPATCHED'};
  throw Error('UNKNOWN_ATSPI_OP');
 };
 const sessions=new Map(),api=createWorkspaceAccessibilityTools({gui,transport,sessions,now:()=>now});
 return {api,calls,sessions,setFocused:x=>focused=x,setTitle:x=>title=x,
  setFailSnapshot:x=>failSnapshot=x,advance:x=>now+=x};
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
  explicitUserAuthorization:'Current owner permits isolated QA semantic controls'});
 const f=(await m.api.execute('workspace_accessibility_snapshot',{...OWNER,lease:l.lease})).controls[0];
 m.setFocused(false);
 await assert.rejects(m.api.execute('workspace_accessibility_type',{...OWNER,
  lease:l.lease,elementId:f.elementId,text:'NEVER'}),/FOCUS_NOT_CONFIRMED/);
 assert.equal(m.calls.filter(c=>c.name==='atspi'&&c.args.command==='type').length,0);
 await m.api.execute('workspace_accessibility_end',{lease:l.lease});
});

test('window title change refuses new actions',async()=>{
 const m=make();const l=await m.api.execute('workspace_accessibility_open',{...OWNER,mode:'takeover',
  explicitUserAuthorization:'Current owner permits isolated QA semantic controls'});
 const item=(await m.api.execute('workspace_accessibility_snapshot',{...OWNER,lease:l.lease})).controls[1];
 m.setTitle('Different page — Mozilla Firefox');
 await assert.rejects(m.api.execute('workspace_accessibility_invoke',{...OWNER,
  lease:l.lease,elementId:item.elementId}),/OWNER_FIREFOX_CHANGED/);
 assert.equal(m.calls.filter(c=>c.name==='atspi'&&c.args.command==='invoke').length,0);
 await m.api.execute('workspace_accessibility_end',{lease:l.lease});
});

test('expired element and wrong PID refuse without native mutation',async()=>{
 const m=make();const l=await m.api.execute('workspace_accessibility_open',{...OWNER,mode:'takeover',
  explicitUserAuthorization:'Current owner permits isolated QA semantic controls'});
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


test('checkbox AT-SPI check action is admitted once, with exact owner and no pointer',async()=>{
 const m=make(true);
 const lease=await m.api.execute('workspace_accessibility_open',{
  ...OWNER,mode:'takeover',explicitUserAuthorization:'Select verified GitHub repository pins'
 });
 const controls=(await m.api.execute('workspace_accessibility_snapshot',{...OWNER,lease:lease.lease})).controls;
 const box=controls.find(x=>x.role==='check box'&&x.name==='public item with no stars');
 assert.equal(box.clickable,true);
 const result=await m.api.execute('workspace_accessibility_invoke',{...OWNER,lease:lease.lease,elementId:box.elementId});
 assert.equal(result.effect,'DISPATCHED');
 const effect=m.calls.find(x=>x.name==='atspi'&&x.args.command==='invoke');
 assert.equal(effect.args.expectedRole,'check box');
 assert.equal(effect.args.expectedName,'public item with no stars');
 await assert.rejects(m.api.execute('workspace_accessibility_invoke',{
  ...OWNER,lease:lease.lease,elementId:box.elementId
 }),/ELEMENT_STALE_OR_UNBOUND/);
 assert.equal(m.calls.some(x=>x.name.includes('mouse')||x.name.includes('pointer')),false);
 await m.api.execute('workspace_accessibility_end',{lease:lease.lease});
});

test('checkbox role and action cannot be broadened to generic click or toggle',async()=>{
 const m=make(true);
 const lease=await m.api.execute('workspace_accessibility_open',{
  ...OWNER,mode:'takeover',explicitUserAuthorization:'Inspect exact Checkbox action safety'
 });
 const box=(await m.api.execute('workspace_accessibility_snapshot',{...OWNER,lease:lease.lease})).controls.find(x=>x.role==='check box');
 const original=m.sessions.get(lease.lease).elements.get(box.elementId);
 original.action='toggle';
 await assert.rejects(m.api.execute('workspace_accessibility_invoke',{
  ...OWNER,lease:lease.lease,elementId:box.elementId
 }),/ELEMENT_NOT_INVOKABLE/);
 original.action='click';
 await assert.rejects(m.api.execute('workspace_accessibility_invoke',{
  ...OWNER,lease:lease.lease,elementId:box.elementId
 }),/ELEMENT_NOT_INVOKABLE/);
 assert.equal(m.calls.filter(x=>x.name==='atspi'&&x.args.command==='invoke').length,0);
 await m.api.execute('workspace_accessibility_end',{lease:lease.lease});
});

test('an ambiguous native Firefox refresh revokes every earlier selector without replay',async()=>{
 const m=make();
 const lease=await m.api.execute('workspace_accessibility_open',{
  ...OWNER,mode:'takeover',explicitUserAuthorization:'Only isolated semantic regression fixture'
 });
 const item=(await m.api.execute('workspace_accessibility_snapshot',{
  ...OWNER,lease:lease.lease})).controls[1];
 m.setFailSnapshot(true);
 await assert.rejects(m.api.execute('workspace_accessibility_snapshot',{
  ...OWNER,lease:lease.lease}),/ATSPI_OBSERVATION_TIMEOUT_NO_EFFECT/);
 await assert.rejects(m.api.execute('workspace_accessibility_invoke',{
  ...OWNER,lease:lease.lease,elementId:item.elementId
 }),/ELEMENT_STALE_OR_UNBOUND/);
 assert.equal(m.calls.filter(c=>c.name==='atspi'&&c.args.command==='invoke').length,0);
 await m.api.execute('workspace_accessibility_end',{lease:lease.lease});
});

test('native AX cannot inject protected fields, invalid roles or unsafe element paths',async()=>{
 const bad=[
  {path:[0,8],role:'password text',name:'Sign in',editable:true,action:null},
  {path:[0,9],role:'entry',name:'API token',editable:true,action:null},
  {path:[0,10],role:'button',name:'Reveal password',editable:false,action:'click'},
  {path:[0,11],role:'button',name:'Show details',editable:true,action:'toggle'},
  {path:[0,99],role:'entry',name:'Editable item',editable:true,action:null},
  {path:[0,12],role:'entry',name:'Normal item',editable:true,action:null},
  {path:[0,13],role:'entry',name:'Login',editable:false,action:null}
 ];
 const m=make(false,bad);
 const lease=await m.api.execute('workspace_accessibility_open',{...OWNER,mode:'observe'});
 const snapshot=await m.api.execute('workspace_accessibility_snapshot',{...OWNER,lease:lease.lease});
 assert.deepEqual(snapshot.controls.map(c=>c.name),
   ['Search query','Search','Normal item']);
 assert.equal(snapshot.controls.filter(c=>c.editable).length,2);
 assert.equal(m.sessions.get(lease.lease).elements.size,3);
 assert.equal(m.calls.some(c=>c.name==='atspi'&&c.args.command!=='snapshot'),false);
 await m.api.execute('workspace_accessibility_end',{lease:lease.lease});
});
