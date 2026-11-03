import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {bindV2V1MutationId} from '../src/v2-v1-idempotency-bindings.mjs';
import {createV2V1ToolBridge} from '../src/v2-v1-tool-bridge.mjs';
import {createV2NativeOwnerExecutor} from '../src/v2-v1-owner-executor.mjs';
// POSIX owner/UID, local HOME and native review fixtures are Linux-specific.
// Windows must exercise its separate owner/Win32 adapters, not emulate POSIX authorization.
const posixTest = process.platform === 'win32' ? test.skip : test;
const requestId='ee4da4e2-5d7f-40fb-9a4d-a32f285964c4';
const tools=[
 {name:'run_shell',inputSchema:{type:'object',properties:{command:{type:'string'},requestId:{type:'string'}}}},
 {name:'system_status',inputSchema:{type:'object',properties:{}}}
];
test('binds a stable V2 request identity only to a schema-authorized V1 requestId parameter',()=>{
 const original={command:'true'};
 const output=bindV2V1MutationId({tool:'run_shell',args:original,requestId,toolDefinitions:tools});
 assert.deepEqual(output,{command:'true',requestId:'v2-'+requestId});
 assert.deepEqual(original,{command:'true'});
 assert.deepEqual(bindV2V1MutationId({tool:'system_status',args:{},requestId,toolDefinitions:tools}),{});
 assert.deepEqual(bindV2V1MutationId({tool:'run_shell',args:original,requestId,toolDefinitions:tools}),output);
});
test('refuses user-controlled IDs, changed schemas and unknown tools before execution',()=>{
 for(const sample of [
  {tool:'run_shell',args:{command:'true',requestId:'spoof'}},
  {tool:'run_shell',args:{command:'true'},toolDefinitions:[{name:'run_shell',inputSchema:{type:'object',properties:{requestId:{type:'integer'}}}}]},
  {tool:'unlisted',args:{command:'true'}},
  {tool:'run_shell',requestId:'bad',args:{command:'true'}},
  {tool:'run_shell',args:{command:'true'},toolDefinitions:[tools[0],tools[0]]}
 ]){
  assert.throws(()=>bindV2V1MutationId({
   tool:'run_shell',requestId,toolDefinitions:tools,...sample
  }),/V2_V1_IDEMPOTENCY_/);
 }
});
posixTest('owner sees the exact V1-bound args; dispatch exactly once after approval, with crash-safe receipt',async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'mmz-v2-bound-id-')),root=path.join(base,'queue');
 try{
  const queue=createV2V1ToolBridge({root,now:()=>1000,loadCatalog:async()=>['run_shell']});
  const r=await queue.request({tool:'run_shell',arguments:{command:'true'}});
  let approvedArgs,invokedArgs,n=0;
  const make=()=>createV2NativeOwnerExecutor({
   root,now:()=>1000,loadCatalog:async()=>['run_shell'],
   prepareInvocation:async(tool,args,{requestId:id})=>bindV2V1MutationId({
    tool,args,requestId:id,toolDefinitions:tools
   }),
   requireOwnerConfirmation:async({arguments:args})=>{
    approvedArgs=structuredClone(args);return true;
   },
   invokeTool:async(tool,args)=>{invokedArgs=args;n++;return {isError:false}}
  });
  const res=await make().approve(r.requestId);
  assert.equal(res.status,'V1_CALL_RETURNED');
  assert.equal(approvedArgs.requestId,'v2-'+r.requestId);
  assert.deepEqual(approvedArgs,invokedArgs);
  assert.equal(n,1);
  assert.equal(queue.progress(r.requestId).status,'V1_CALL_RETURNED');
  await assert.rejects(()=>make().approve(r.requestId),{code:'V2_OWNER_NOT_PENDING'});
  assert.equal(n,1);
 }finally{fs.rmSync(base,{recursive:true,force:true})}
});
posixTest('schema changes between owner preview and dispatch fail closed, with no receipt/effect',async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'mmz-v2-bound-drift-')),root=path.join(base,'queue');
 try{
  const q=createV2V1ToolBridge({root,now:()=>1000,loadCatalog:async()=>['run_shell']});
  const r=await q.request({tool:'run_shell',arguments:{command:'true'}});
  let prepared=0,effects=0;
  const x=createV2NativeOwnerExecutor({
   root,now:()=>1000,loadCatalog:async()=>['run_shell'],
   prepareInvocation:async(tool,args,{requestId:id})=>{
    prepared++;
    return bindV2V1MutationId({
     tool,args,requestId:id,
     toolDefinitions:prepared===1?tools:[{name:'run_shell',inputSchema:{type:'object',properties:{command:{type:'string'}}}}]
    });
   },
   requireOwnerConfirmation:async()=>true,
   invokeTool:async()=>{effects++;return {}}
  });
  await assert.rejects(()=>x.approve(r.requestId),{code:'V2_OWNER_EFFECTIVE_ARGS_CHANGED'});
  assert.equal(effects,0);
  assert.deepEqual(fs.readdirSync(path.join(root,'receipts')),[]);
 }finally{fs.rmSync(base,{recursive:true,force:true})}
});
