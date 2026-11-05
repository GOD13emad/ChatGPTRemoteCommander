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

test('asynchronous native owner denial or absence never allows a V1 catalog or tool call',async()=>{
 for(const verdict of [false,undefined,null,0]){
  let rpcCalls=0;
  const g=createV2V1LocalOwnerGateway({
   attestLocalOwner:async()=>verdict,newId:()=>uuid,
   rpc:async()=>{rpcCalls++;return {tools:names};}
  });
  await assert.rejects(g.list(),{code:'V2_LOCAL_OWNER_ATTESTATION_REQUIRED'});
  await assert.rejects(g.call({tool:'run_shell',args:{command:'true'}}),
   {code:'V2_LOCAL_OWNER_ATTESTATION_REQUIRED'});
  assert.equal(rpcCalls,0,'denied attestation must never reach V1');
 }
});
test('pending async identity assertion blocks all catalog and mutation effects',async()=>{
 let resolveAttestation;
 let calls=0;
 const hold=new Promise(resolve=>{resolveAttestation=resolve});
 const g=createV2V1LocalOwnerGateway({
  attestLocalOwner:()=>hold,newId:()=>uuid,
  rpc:async()=>{calls++;return {tools:names};}
 });
 const pending=g.call({tool:'run_shell',args:{command:'true'}});
 await Promise.resolve();await Promise.resolve();
 assert.equal(calls,0,'do not dispatch during unresolved native identity check');
 resolveAttestation(false);
 await assert.rejects(pending,{code:'V2_LOCAL_OWNER_ATTESTATION_REQUIRED'});
 assert.equal(calls,0);
});
test('owner attestation is rechecked after asynchronous catalog lookup before V1 dispatch',async()=>{
 let allowed=true,rpcCalls=0,mutationCalls=0;
 const g=createV2V1LocalOwnerGateway({
  attestLocalOwner:async()=>allowed,newId:()=>uuid,
  rpc:async method=>{
   rpcCalls++;
   if(method==='tools/list'){
    allowed=false;
    return {tools:names};
   }
   mutationCalls++;return {isError:false};
  }
 });
 await assert.rejects(g.call({tool:'run_shell',args:{command:'true'}}),
  {code:'V2_LOCAL_OWNER_ATTESTATION_REQUIRED'});
 assert.equal(rpcCalls,1);
 assert.equal(mutationCalls,0);
});
test('asynchronous native peer probe failure rejects without leaking to any V1 RPC',async()=>{
 let calls=0;
 const g=createV2V1LocalOwnerGateway({
  attestLocalOwner:async()=>{throw Object.assign(Error('peer invalid'),{code:'OS_PEER_DENIED'})},
  newId:()=>uuid,rpc:async()=>{calls++;return {tools:names}}
 });
 await assert.rejects(g.call({tool:'gui_status'}),{code:'OS_PEER_DENIED'});
 assert.equal(calls,0);
});
