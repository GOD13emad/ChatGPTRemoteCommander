import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createOwnerWorkspaceProxy} from '../src/owner-workspace-proxy.mjs';

const key='a'.repeat(64);
const ownerConfig={ownerWorkspaceDelegation:{
 enabled:true,port:48838,authFile:path.join(process.cwd(),'owner-qa-secret')
}};
function mock(reply){
 const requests=[];
 const proxy=createOwnerWorkspaceProxy({config:ownerConfig,readFileImpl:async()=>key,
  fetchImpl:async(url,init)=>{
   requests.push({url,init});
   return {status:200,text:async()=>JSON.stringify(reply)};
  }});
 return {proxy,requests};
}
const call=m=>m.proxy.execute('workspace_window_observe',{pid:3932,windowId:2626232});
test('owner proxy preserves only authenticated allowlisted driver error codes',async()=>{
 const m=mock({jsonrpc:'2.0',id:1,error:{code:-32012,message:'WORKSPACE_DRIVER_UNAVAILABLE'}});
 await assert.rejects(call(m),e=>e.code==='WORKSPACE_DRIVER_UNAVAILABLE');
 assert.equal(m.requests.length,1);
 assert.equal(m.requests[0].init.redirect,'error');
 assert.equal(m.requests[0].init.headers['x-rc-owner-workspace-auth'],key);
});
test('owner proxy does not expose arbitrary owner error text or allow Session-0 fallback',async()=>{
 for(const message of ['PRIVATE_TOKEN_123','WORKSPACE_CREDENTIALS_EXPOSED','WORKSPACE_DRIVER_UNAVAILABLE extra']){
  const m=mock({jsonrpc:'2.0',id:1,error:{code:-32012,message}});
  await assert.rejects(call(m),e=>e.code==='WORKSPACE_OWNER_REJECTED');
 }
 const m=mock({jsonrpc:'2.0',id:1,error:{code:'-32012',message:'WORKSPACE_DRIVER_UNAVAILABLE'}});
 await assert.rejects(call(m),e=>e.code==='WORKSPACE_OWNER_REJECTED');
});
test('owner proxy still requires exact successful structured reply and never invents effect',async()=>{
 const bad=mock({jsonrpc:'2.0',id:1,result:{isError:true,content:[{type:'text',text:'secret'}]}});
 await assert.rejects(call(bad),e=>e.code==='WORKSPACE_OWNER_REJECTED');
 const good=mock({jsonrpc:'2.0',id:1,result:{structuredContent:{ok:true,mode:'READ_ONLY',value:{elements:[]}}}});
 const r=await call(good);
 assert.equal(r.handled,true);
 assert.equal(r.value.mode,'READ_ONLY');
});
