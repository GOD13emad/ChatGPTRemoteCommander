import test from 'node:test';
import assert from 'node:assert/strict';
import {createV2V1LocalOwnerGateway} from '../src/v2-v1-local-owner-gateway.mjs';

const uuid='d3a440d9-47a9-4725-bb50-987987adf897';
const names=[
 {name:'run_shell',inputSchema:{type:'object',properties:{
  command:{type:'string'},requestId:{type:'string'}
 }}},
 {name:'read_text',inputSchema:{type:'object',properties:{path:{type:'string'}}}},
 {name:'gui_status',inputSchema:{type:'object',properties:{}}}
];
test('native gateway sees exactly the live existing V1 catalog and returns data as local owner',async()=>{
 const seen=[];
 const g=createV2V1LocalOwnerGateway({
  attestLocalOwner:()=>true,newId:()=>uuid,
  rpc:async(method,params)=>{
   seen.push([method,params]);
   return method==='tools/list'?{tools:names}:{isError:false,structuredContent:{ok:true}};
  }
 });
 assert.deepEqual(await g.list(),['run_shell','read_text','gui_status']);
 const result=await g.call({tool:'run_shell',args:{command:'true'}});
 assert.equal(result.requestId,uuid);
 assert.deepEqual(seen.at(-1),['tools/call',{name:'run_shell',
  arguments:{command:'true',requestId:'v2-'+uuid}}]);
 assert.deepEqual(result.result.structuredContent,{ok:true});
});
test('native current-user authority cannot be skipped by MCP args or absent attestation',async()=>{
 let count=0;
 const gateway=createV2V1LocalOwnerGateway({
  attestLocalOwner:()=>{throw Error('LOCAL_IDENTITY_DENIED');},
  rpc:async()=>{count++;return {tools:names}}
 });
 await assert.rejects(()=>gateway.list(),/LOCAL_IDENTITY_DENIED/);
 await assert.rejects(()=>gateway.call({tool:'run_shell',args:{command:'true'}}),
  /LOCAL_IDENTITY_DENIED/);
 assert.equal(count,0);
});
test('gateway never forwards arbitrary externally supplied mutation ids',async()=>{
 let calls=0;
 const gateway=createV2V1LocalOwnerGateway({
  attestLocalOwner:()=>true,newId:()=>uuid,
  rpc:async(method)=>{calls++;return method==='tools/list'?{tools:names}:{isError:false}}
 });
 await assert.rejects(()=>gateway.call({tool:'run_shell',args:{
  command:'true',requestId:'another-v1-request'
 }}),/V2_V1_IDEMPOTENCY_REMOTE_ID_FORBIDDEN/);
 assert.equal(calls,1);
});
test('gateway retains V1 GUI consent semantics; no bypass or privileged session',async()=>{
 const calls=[];
 const gateway=createV2V1LocalOwnerGateway({
  attestLocalOwner:()=>true,newId:()=>uuid,
  rpc:async(method,params)=>{
   calls.push(method);
   return method==='tools/list'?{tools:names}:{
    isError:true,content:[{type:'text',text:'NATIVE_GUI_CONSENT_REQUIRED'}]
   };
  }
 });
 const r=await gateway.call({tool:'gui_status',args:{}});
 assert.equal(r.result.isError,true);
 assert.deepEqual(calls,['tools/list','tools/call']);
});
test('gateway fails closed on forged/malformed schemas and invalid user input',async()=>{
 const malformed=createV2V1LocalOwnerGateway({
  attestLocalOwner:()=>true,newId:()=>uuid,
  rpc:async()=>({tools:[{name:'run_shell'}]})
 });
 await assert.rejects(()=>malformed.call({tool:'run_shell',args:{command:'true'}}),
  /V2_V1_IDEMPOTENCY_SCHEMA_UNAVAILABLE/);
 await assert.rejects(()=>malformed.call({tool:'run_shell',args:{command:'x'.repeat(9000)}}),
  /V2_LOCAL_ARGS_TOO_LARGE/);
 await assert.rejects(()=>malformed.call({tool:'run_shell;',args:{command:'true'}}),
  /V2_LOCAL_TOOL_INVALID/);
});
