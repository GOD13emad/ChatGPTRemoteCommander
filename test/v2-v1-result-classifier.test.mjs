import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {classifyV2V1ShellResult,validateV2ShellReceiptValue} from '../src/v2-v1-result-classifier.mjs';
import {createV2V1ToolBridge} from '../src/v2-v1-tool-bridge.mjs';
import {createV2NativeOwnerExecutor} from '../src/v2-v1-owner-executor.mjs';
const valid={isError:false,structuredContent:{exitCode:0,timedOut:false,signal:null,stdout:'PRIVATE',stderr:'SECRET'}};

test('classify bounded V1 Shell completion without exposing any private output',()=>{
 assert.equal(classifyV2V1ShellResult(valid),'EXIT_ZERO');
 assert.equal(classifyV2V1ShellResult({...valid,structuredContent:{...valid.structuredContent,exitCode:1}}),'EXIT_NONZERO');
 assert.equal(classifyV2V1ShellResult({...valid,structuredContent:{...valid.structuredContent,timedOut:true}}),'TIMED_OUT');
 assert.equal(classifyV2V1ShellResult({isError:true}),'TOOL_ERROR');
 for(const bad of [undefined,{}, {isError:false,structuredContent:{exitCode:0,timedOut:false}},
  {isError:false,structuredContent:{exitCode:'0',timedOut:false,signal:null}},
  {isError:false,structuredContent:{exitCode:0,timedOut:false,signal:'SIGINT'}}])
   assert.equal(classifyV2V1ShellResult(bad),'UNKNOWN');
 assert.equal(validateV2ShellReceiptValue(undefined),'UNKNOWN');
 assert.throws(()=>validateV2ShellReceiptValue('PRIVATE OUTPUT'),/V2_SHELL_RECEIPT_UNTRUSTED/);
});

test('one owner-approved Shell callback persists only completion category; no replay',async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'v2-shell-output-classifier-'));
 const root=path.join(base,'review');
 try{
  const q=createV2V1ToolBridge({root,now:()=>2000,loadCatalog:async()=>['run_shell']});
  const request=await q.request({tool:'run_shell',arguments:{command:'true'}});
  let invokes=0;
  const owner=createV2NativeOwnerExecutor({root,now:()=>2000,loadCatalog:async()=>['run_shell'],
   requireOwnerConfirmation:async()=>true,
   invokeTool:async()=>{invokes++;return {isError:false,shellCompletion:classifyV2V1ShellResult(valid)}}});
  const done=await owner.approve(request.requestId);
  assert.equal(done.status,'V1_CALL_RETURNED');
  const status=q.progress(request.requestId);
  assert.equal(status.shellCompletion,'EXIT_ZERO');
  assert.equal(status.verifiedEffect,false);
  const receipt=fs.readFileSync(path.join(root,'final',request.requestId+'.json'),'utf8');
  assert.match(receipt,/"shellCompletion":"EXIT_ZERO"/);
  assert.ok(!receipt.includes('PRIVATE'));
  assert.ok(!receipt.includes('SECRET'));
  await assert.rejects(()=>owner.approve(request.requestId),{code:'V2_OWNER_NOT_PENDING'});
  assert.equal(invokes,1);
 }finally{fs.rmSync(base,{recursive:true,force:true})}
});

test('legacy returned Shell receipts remain UNKNOWN; missing receipt is not a proven exit',async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'v2-shell-legacy-result-'));
 const root=path.join(base,'review');
 try{
  const q=createV2V1ToolBridge({root,now:()=>2000,loadCatalog:async()=>['run_shell']});
  const request=await q.request({tool:'run_shell',arguments:{command:'true'}});
  assert.equal(q.progress(request.requestId).shellCompletion,null);
  const old=createV2NativeOwnerExecutor({root,now:()=>2000,loadCatalog:async()=>['run_shell'],
   requireOwnerConfirmation:async()=>true,invokeTool:async()=>({isError:false})});
  await old.approve(request.requestId);
  assert.equal(q.progress(request.requestId).shellCompletion,'UNKNOWN');
 }finally{fs.rmSync(base,{recursive:true,force:true})}
});
