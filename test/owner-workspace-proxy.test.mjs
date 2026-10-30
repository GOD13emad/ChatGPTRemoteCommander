import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createOwnerWorkspaceProxy} from '../src/owner-workspace-proxy.mjs';
const auth='a'.repeat(64);
const cfg={ownerWorkspaceDelegation:{enabled:true,port:48772,authFile:path.resolve('fake-owner.key')}};
function make(callback){
 return createOwnerWorkspaceProxy({config:cfg,readFileImpl:async()=>auth,
  fetchImpl:async(url,options)=>{
   assert.equal(url,'http://127.0.0.1:48772/mcp');
   assert.equal(options.headers['x-rc-owner-workspace-auth'],auth);
   const body=JSON.parse(options.body);
   return callback(body);
  }});
}
const done=v=>({status:200,text:async()=>JSON.stringify({jsonrpc:'2.0',id:1,
 result:{structuredContent:v}})});
test('owner proxy is absent unless existing authorized owner delegation is configured',()=>{
 assert.equal(createOwnerWorkspaceProxy({config:{}}),null);
});
test('background owner window is forwarded through authenticated same-user agent',async()=>{
 const p=make(body=>{
  assert.equal(body.params.name,'workspace_window_observe');
  assert.deepEqual(body.params.arguments,{pid:101,windowId:2});
  return done({snapshotId:'s00000001',mode:'READ_ONLY'});
 });
 const out=await p.execute('workspace_window_observe',{pid:101,windowId:2});
 assert.equal(out.handled,true);
 assert.equal(out.value.snapshotId,'s00000001');
 const unknown=await p.execute('delete_path',{path:'x'});
 assert.equal(unknown.handled,false);
});
test('mutating click requires actual current request id and explicit current-task approval',async()=>{
 const p=make(body=>{
  assert.equal(body.params.name,'workspace_window_click');
  assert.match(body.params.arguments.requestId,/^owrk-[a-f0-9]{48}$/);
  assert.notEqual(body.params.arguments.requestId,'caller-abc123');
  return done({ok:true,mode:'BACKGROUND_TARGETED',physicalInputTouched:false});
 });
 const args={pid:101,windowId:2,elementToken:'s00000001:1',
  explicitUserAuthorization:'Owner authorized background click',requestId:'caller-abc123'};
 await assert.rejects(p.execute('workspace_window_click',args,{}),/WORKSPACE_OWNER_REQUEST_ID_REQUIRED/);
 const result=await p.execute('workspace_window_click',args,{requestId:'realupstream-request-1'});
 assert.equal(result.value.physicalInputTouched,false);
});
test('owner rejection is final; does not fall back to SYSTEM global GUI',async()=>{
 const p=make(()=>({status:403,text:async()=>''}));
 await assert.rejects(p.execute('workspace_window_preview',{pid:22,windowId:3}),
   /WORKSPACE_OWNER_AGENT_DENIED/);
});
test('owner image metadata is forwarded as spectator-only content',async()=>{
 const p=make(()=>({status:200,text:async()=>JSON.stringify({jsonrpc:'2.0',id:1,result:{
 structuredContent:{mode:'READ_ONLY_SPECTATOR',interactiveInput:false},
 content:[{type:'image',mimeType:'image/png',data:'aaaa'},{type:'text',text:'preview'}]
 }})}));
 const r=await p.execute('workspace_window_preview',{pid:100,windowId:3});
 assert.equal(r.value.__mcpContent[0].type,'image');
 assert.equal(r.value.__structuredContent.interactiveInput,false);
});

test('owner workspace planning reflects the authenticated interactive owner, not SYSTEM caller',async()=>{
 const p=make(body=>{
  assert.equal(body.params.name,'workspace_plan');
  assert.equal(body.params.arguments.target,'existing-app');
  return done({route:'CUA_BACKGROUND_WINDOW',sameUserSession:true,globalInputLock:false});
 });
 const v=await p.execute('workspace_plan',{target:'existing-app'});
 assert.equal(v.handled,true);
 assert.equal(v.value.route,'CUA_BACKGROUND_WINDOW');
 assert.equal(v.value.globalInputLock,false);
});
