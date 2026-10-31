import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createV2V1ToolBridge,V2_V1_BRIDGE_TOOLS} from '../src/v2-v1-tool-bridge.mjs';
import {createV2NativeOwnerExecutor} from '../src/v2-v1-owner-executor.mjs';

const withRoot=async f=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'v2-v1-owner-'));
 const root=path.join(parent,'review');
 try{await f(root)}finally{fs.rmSync(parent,{recursive:true,force:true})}
};
test('noauth tool list includes only metadata and proposal surfaces',()=>{
 assert.deepEqual(V2_V1_BRIDGE_TOOLS.map(t=>t.name),['v2_v1_tool_catalog','v2_request_owner_tool']);
 assert.ok(V2_V1_BRIDGE_TOOLS.every(t=>t.securitySchemes[0].type==='noauth'));
});
test('owner review queues exact V1 tool but NEVER executes on remote request',()=>withRoot(async root=>{
 let effects=0,time=100000;
 const cat=['system_status','write_text','run_shell','gui_status','workflow_run_start'];
 const queue=createV2V1ToolBridge({root,loadCatalog:async()=>cat,now:()=>time});
 assert.deepEqual(await queue.catalog(),cat);
 const request=await queue.request({tool:'run_shell',arguments:{command:'echo SAFE'}});
 assert.equal(request.executed,false);
 assert.equal(effects,0);
 assert.equal(queue.inspect(request.requestId).tool,'run_shell');
 assert.equal(fs.lstatSync(root).mode&0o077,0);
 assert.equal(fs.lstatSync(path.join(root,'requests',request.requestId+'.json')).mode&0o077,0);
 assert.equal(fs.readdirSync(path.join(root,'receipts')).length,0);
 const executor=createV2NativeOwnerExecutor({root,loadCatalog:async()=>cat,
  invokeTool:async()=>{effects++;return {}},
  requireOwnerConfirmation:async()=>true,now:()=>time});
 const result=await executor.approve(request.requestId);
 assert.equal(result.status,'V1_CALL_RETURNED');
 assert.equal(effects,1);
 assert.equal(executor.status(request.requestId).status,'V1_CALL_RETURNED');
 await assert.rejects(()=>executor.approve(request.requestId),{code:'V2_OWNER_NOT_PENDING'});
 assert.equal(effects,1);
}));
test('denied owner, stale tool, expired requests never execute',()=>withRoot(async root=>{
 let now=100000,actions=0,approval=false,cat=['system_status'];
 const queue=createV2V1ToolBridge({root,loadCatalog:async()=>cat,now:()=>now});
 const r=await queue.request({tool:'system_status',arguments:{}});
 const executor=createV2NativeOwnerExecutor({root,loadCatalog:async()=>cat,now:()=>now,
  invokeTool:async()=>{actions++;return {}},requireOwnerConfirmation:async()=>approval});
 await assert.rejects(()=>executor.approve(r.requestId),{code:'V2_OWNER_DENIED'});
 assert.equal(actions,0);
 cat=['gui_status'];
 await assert.rejects(()=>executor.approve(r.requestId),{code:'V2_OWNER_TOOL_REMOVED'});
 cat=['system_status'];approval=true;now+=600001;
 await assert.rejects(()=>executor.approve(r.requestId),{code:'V2_OWNER_NOT_PENDING'});
 assert.equal(actions,0);
}));
test('untrusted argument shapes, tool IDs, catalog names and oversized values denied',()=>withRoot(async root=>{
 const q=createV2V1ToolBridge({root,loadCatalog:async()=>['system_status','run_shell']});
 await assert.rejects(()=>q.request({tool:'evil|bash',arguments:{}}));
 await assert.rejects(()=>q.request({tool:'unknown',arguments:{}}));
 await assert.rejects(()=>q.request({tool:'run_shell',arguments:{command:'x'.repeat(5000)}}));
 await assert.rejects(()=>q.request({tool:'run_shell',arguments:{command:'\u001b[31m'}}));
 await assert.rejects(()=>q.request({tool:'run_shell',arguments:{constructor:'x'}}));
 assert.equal(fs.readdirSync(path.join(root,'requests')).length,0);
}));
test('transport failure after bounded owner approval is recorded UNCERTAIN, not retried',()=>withRoot(async root=>{
 let n=0;
 const opts={root,loadCatalog:async()=>['read_text'],now:()=>120000};
 const q=createV2V1ToolBridge(opts);
 const r=await q.request({tool:'read_text',arguments:{path:'owned'}});
 const executor=createV2NativeOwnerExecutor({...opts,
  requireOwnerConfirmation:async()=>true,
  invokeTool:async()=>{n++;throw new Error('transport dropped')}});
 const result=await executor.approve(r.requestId);
 assert.equal(result.status,'DISPATCH_OUTCOME_UNCERTAIN');
 await assert.rejects(()=>executor.approve(r.requestId),{code:'V2_OWNER_NOT_PENDING'});
 assert.equal(n,1);
}));
test('native interactive CLI rejects headless approval',()=>{
 const s=spawnSync(process.execPath,['tools/v2-v1-owner-cli.mjs','approve',
  '00000000-0000-4000-8000-000000000000'],{cwd:process.cwd(),
  encoding:'utf8',timeout:4000});
 assert.notEqual(s.status,0);
 assert.match(s.stderr,/V2_OWNER_INTERACTIVE_TTY_REQUIRED/);
});
