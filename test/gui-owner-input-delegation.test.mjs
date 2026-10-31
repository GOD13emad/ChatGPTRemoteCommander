import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createOwnerGuiReadOnlyProxy} from '../src/gui-owner-delegation.mjs';
import {mergeExplicitOwnerGuiPolicy} from '../src/owner-gui-policy.mjs';
import {createWorkspaceTargetTools} from '../src/workspace-target-tools.mjs';
const key='f'.repeat(64);
const status={ok:true,enabled:true,available:true,session:1,
 policy:{allowMouse:true,allowKeyboard:true,explicitTakeoverRequired:true}};
const core={enabled:true,available:true,policy:{allowMouse:false,allowKeyboard:false},
 uncertain:false,incidentPending:false,incidentStoreUnavailable:false,blocked:false};
const auth='Owner explicitly authorized the exact synthetic application in the current request';
const requestId='gui-test-current-20261031-01';
function mock({policy=true,primary=core,ownerStatus=status}={}){
 const calls=[];let seq=0;
 const cfg={powerMode:{guiControl:{enabled:true,ownerAuthorizedTakeover:policy}},
  ownerGuiDelegation:{enabled:true,port:48837,authFile:path.join(os.tmpdir(),'rc-gui-test-key'),
    allowTakeover:policy}};
 const proxy=createOwnerGuiReadOnlyProxy({config:cfg,primaryStatus:async()=>primary,
  readFileImpl:async()=>key,
  fetchImpl:async(_,options)=>{
   const rpc=JSON.parse(options.body).params;
   calls.push(rpc);
   let output={ok:true};
   switch(rpc.name){
    case 'gui_status':output=ownerStatus;break;
    case 'gui_session_begin':output={ok:true,lease:'owner-lease-'+(++seq),mode:rpc.arguments.mode};break;
   }
   return{status:200,text:async()=>JSON.stringify({jsonrpc:'2.0',id:1,result:{structuredContent:output}})};
  }});
 return {proxy,calls};
}
test('default owner bridge remains read-only when not opted in',async()=>{
 const {proxy,calls}=mock({policy:false,primary:{...core,available:false}});
 assert.equal((await proxy.execute('gui_type_text',{lease:'x',frame:'abcdefghijk'})).handled,false);
 await assert.rejects(proxy.execute('gui_session_begin',{mode:'takeover'}),/OBSERVE_ONLY/);
 assert.equal(calls.length,0);
});
test('double opt-in required from machine Core and explicit owner-authored policy',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rc-owner-takeover-'));
 try{
  const file=path.join(tmp,'key');fs.writeFileSync(file,key,{mode:0o600});
  const local={ownerGuiDelegation:{enabled:true,port:48837,authFile:file,allowTakeover:true}};
  const active={powerMode:{guiControl:{enabled:true,ownerAuthorizedTakeover:false}}};
  assert.throws(()=>mergeExplicitOwnerGuiPolicy(active,local),/NOT_AUTHORIZED/);
  const allowed=mergeExplicitOwnerGuiPolicy({powerMode:{guiControl:{enabled:true,ownerAuthorizedTakeover:true}}},local);
  assert.equal(allowed.config.ownerGuiDelegation.allowTakeover,true);
  assert.throws(()=>mergeExplicitOwnerGuiPolicy({powerMode:{guiControl:{enabled:true,ownerAuthorizedTakeover:true}}},{ownerGuiDelegation:{...local.ownerGuiDelegation,allowTakeover:'yes'}}),/TYPE_INVALID/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('available SYSTEM primary with input disabled delegates owner GUI on explicit opt-in',async()=>{
 const {proxy,calls}=mock();
 const data=await proxy.execute('gui_status');
 assert.equal(data.handled,true);
 assert.equal(data.value.delegatedMode,'explicit-owner-takeover');
 assert.equal(calls[0].name,'gui_status');
 assert.equal(calls[0].arguments?.requestId,undefined);
});
test('no owner authorization or no current request ID blocks takeover before network',async()=>{
 const {proxy,calls}=mock();
 await assert.rejects(()=>proxy.execute('gui_session_begin',{mode:'takeover'},{requestId}),/EXPLICIT_AUTHORIZATION_REQUIRED/);
 assert.equal(calls.length,0);
 await assert.rejects(()=>proxy.execute('gui_session_begin',{mode:'takeover',explicitUserAuthorization:auth}),/REQUEST_ID_REQUIRED/);
});
test('exact owner lease and frame allow one bound GUI action; unknown lease fails closed',async()=>{
 const {proxy,calls}=mock();
 const req={requestId};
 const start=await proxy.execute('gui_session_begin',{mode:'takeover',explicitUserAuthorization:auth,ttlSeconds:60},req);
 assert.equal(start.handled,true);
 const lease=start.value.lease;
 assert.equal(calls[0].name,'gui_status');
 const x=await proxy.execute('gui_mouse_click',{lease,frame:'abcdefghijk',x:9,y:11},req);
 assert.equal(x.handled,true);
 assert.equal(calls.at(-1).name,'gui_mouse_click');
 assert.notEqual(calls.at(-1).arguments.requestId,requestId);
 await assert.rejects(()=>proxy.execute('gui_type_text',{lease:'unknown-lease',frame:'abcdefghijk',text:'QA'},req),/TAKEOVER_LEASE_REQUIRED/);
 await proxy.execute('gui_session_end',{lease},req);
 await assert.rejects(()=>proxy.execute('gui_mouse_click',{lease,frame:'abcdefghijk',x:9,y:11},req),/TAKEOVER_LEASE_REQUIRED/);
});
test('missing owner permission, incident or primary native capability cannot be overridden',async()=>{
 const reject=mock({ownerStatus:{...status,policy:{...status.policy,allowMouse:false}}});
 await assert.rejects(reject.proxy.execute('gui_session_begin',{mode:'takeover',explicitUserAuthorization:auth},{requestId}),/OWNER_INPUT_NOT_READY/);
 const incident=mock({primary:{...core,incidentPending:true}});
 assert.equal((await incident.proxy.execute('gui_status')).handled,false);
 assert.equal(incident.calls.length,0);
 const normal=mock({primary:{...core,policy:{allowMouse:true,allowKeyboard:true}}});
 assert.equal((await normal.proxy.execute('gui_status')).handled,false);
 assert.equal(normal.calls.length,0);
});

test('target-to-owner relay synthetic input E2E uses same owner lease and scoped request IDs',async()=>{
 const calls=[];
 const cfg={powerMode:{guiControl:{enabled:true,ownerAuthorizedTakeover:true}},
  ownerGuiDelegation:{enabled:true,port:48837,authFile:path.join(os.tmpdir(),'qa-owner-credential'),allowTakeover:true}};
 const proxy=createOwnerGuiReadOnlyProxy({config:cfg,primaryStatus:async()=>core,readFileImpl:async()=>key,
  fetchImpl:async(_url,req)=>{
   const p=JSON.parse(req.body).params;calls.push(p);
   let output={ok:true};
   if(p.name==='gui_status')output={...status,screens:[{index:0}]};
   if(p.name==='gui_session_begin')output={ok:true,lease:'owner-qa-native-lease',mode:p.arguments.mode};
   if(p.name==='gui_list_windows')output={ok:true,windows:[{processId:123,handle:'456',title:'CommanderQA',focused:true}]};
   if(p.name==='gui_screenshot')output={ok:true,frame:'fresh-ownernative-frame-123'};
   return {status:200,text:async()=>JSON.stringify({jsonrpc:'2.0',id:1,result:{structuredContent:output}})};
  }});
 let counter=0;
 const gui=async(name,args)=>{
  const delegated=await proxy.execute(name,args,{requestId:'rcv1-qa-'+(++counter)+'-20261031'});
  if(!delegated.handled)throw Error('QA_OWNER_REQUIRED_NO_SYSTEM_FALLBACK');
  return delegated.value;
 };
 const api=createWorkspaceTargetTools({gui,bindings:new Map()});
 const open=await api.execute('workspace_target_open',{processId:123,handle:'456',mode:'takeover',explicitUserAuthorization:auth});
 assert.equal(open.mode,'takeover');
 const frame=await api.execute('workspace_target_snapshot',{processId:123,handle:'456',lease:open.lease});
 assert.equal(frame.frame,'fresh-ownernative-frame-123');
 const typed=await api.execute('workspace_target_type',{processId:123,handle:'456',lease:open.lease,frame:frame.frame,text:'SYNTHETIC-QA'});
 assert.equal(typed.ok,true);
 const sent=calls.find(c=>c.name==='gui_type_text');
 assert.equal(sent.arguments.text,'SYNTHETIC-QA');
 assert.match(sent.arguments.requestId,/^ogui-[a-f0-9]{48}$/);
 assert.equal((await api.execute('workspace_target_end',{lease:open.lease})).ok,true);
 await assert.rejects(api.execute('workspace_target_type',{processId:123,handle:'456',lease:open.lease,frame:frame.frame,text:'AFTER-END'}),/LEASE_UNBOUND_OR_EXPIRED/);
});
