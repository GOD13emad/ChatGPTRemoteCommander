// QA ONLY: real child process lifecycle + mock effects. Never touches GUI.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {createWindowsMockWorkerPoolQA} from '../src/native-workspace-worker-pool-win-qa.mjs';
import {createWindowsNativeJournalQA} from '../src/native-workspace-journal-win-sqlite-qa.mjs';
import {createWindowsSessionBrokerQA} from '../src/native-workspace-session-broker-win-qa.mjs';

const A='a'.repeat(64),B='b'.repeat(64);
const owned=async fn=>{
  const dir=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-worker-ipc-qa-')));
  try{await fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:120});}
};
function authFixture(pool,journal,crashOperation=null){
  const alice=Object.freeze({}),bob=Object.freeze({});
  const identities=new WeakMap([
    [alice,{principalId:'alice',sessionId:'agent-a',role:'agent',allowedWorkspaces:[A]}],
    [bob,{principalId:'bob',sessionId:'agent-b',role:'agent',allowedWorkspaces:[B]}]
  ]);
  const broker=createWindowsSessionBrokerQA({
    attest:context=>identities.get(context),
    observeNative:async({workspaceRef})=>({...await pool.observe({workspaceRef}),effectMode:'qa-simulated'}),
    dispatchNative:async action=>(action.operationId===crashOperation
      ?pool.simulateCrashQA(action.workspaceRef):pool.effect(action)),
    journal
  });
  return {broker,alice,bob};
}
async function action(broker,context,workspaceRef,operationId,kind='click'){
  const proof=await broker.observe({context,workspaceRef});
  const lease=broker.acquire({context,observation:proof,ttlMs:5000});
  return broker.execute({context,lease,operationId,kind,expectedWorkspaceRef:workspaceRef});
}

test('two dedicated child PIDs keep separate mock GUI frame and operation counters',
  {skip:process.platform!=='win32'},async()=>{
    const pool=createWindowsMockWorkerPoolQA();
    try{
      const [wa,wb]=await Promise.all([pool.launch(A),pool.launch(B)]);
      assert.notEqual(wa.pid,wb.pid);
      assert.equal(wa.workspaceRef,A);
      assert.equal(wb.workspaceRef,B);
      const [fa,fb]=await Promise.all([
        pool.observe({workspaceRef:A}),pool.observe({workspaceRef:B})
      ]);
      assert.match(fa.sha256,/^[a-f0-9]{64}$/);
      assert.match(fb.sha256,/^[a-f0-9]{64}$/);
      assert.notEqual(fa.sha256,fb.sha256);
      assert.equal(fa.pid,wa.pid);
      assert.equal(fb.pid,wb.pid);
      const [ea,eb]=await Promise.all([
        pool.effect({workspaceRef:A,operationId:'mock-a-1',kind:'drag'}),
        pool.effect({workspaceRef:B,operationId:'mock-b-1',kind:'click'})
      ]);
      assert.equal(ea.effectNumber,1);
      assert.equal(eb.effectNumber,1);
      assert.equal(ea.simulated,true);
      assert.equal(eb.simulated,true);
      assert.equal(ea.workspaceRef,A);
      assert.equal(eb.workspaceRef,B);
      await assert.rejects(pool.effect({workspaceRef:A,operationId:'mock-a-1',kind:'drag'}),
        e=>e.code==='WORKER_OPERATION_REPLAY');
      assert.equal(pool.status(A).running,true);
      assert.equal(pool.status(B).running,true);
    }finally{await pool.close();}
  });

test('unallocated and malformed workspace names cannot launch or route mock input',
  {skip:process.platform!=='win32'},async()=>{
    const pool=createWindowsMockWorkerPoolQA();
    try{
      assert.throws(()=>pool.observe({workspaceRef:A}),e=>e.code==='WORKER_NOT_RUNNING');
      assert.throws(()=>pool.launch('../escape'),e=>e.code==='WORKER_WORKSPACE_INVALID');
      await pool.launch(A);
      assert.throws(()=>pool.launch(A),e=>e.code==='WORKER_ALREADY_ALLOCATED');
      assert.throws(()=>pool.effect({workspaceRef:A,operationId:'bad',kind:'invalid'}),
        e=>e.code==='WORKER_ACTION_INVALID');
      assert.equal(pool.status(A).pending,0);
    }finally{await pool.close();}
  });

test('real broker + SQLite intents route to two independent QA child processes',
  {skip:process.platform!=='win32'},async()=>owned(async root=>{
    const pool=createWindowsMockWorkerPoolQA();
    const journal=createWindowsNativeJournalQA({root});
    try{
      journal.provision();
      const [aa,bb]=await Promise.all([pool.launch(A),pool.launch(B)]);
      const {broker,alice,bob}=authFixture(pool,journal);
      const [ra,rb]=await Promise.all([
        action(broker,alice,A,'worker-integrated-a','drag'),
        action(broker,bob,B,'worker-integrated-b','click')
      ]);
      assert.equal(ra.simulated,true);
      assert.equal(rb.simulated,true);
      assert.equal(ra.pid,aa.pid);
      assert.equal(rb.pid,bb.pid);
      assert.equal(journal.inspect('worker-integrated-a').state,'ACKED');
      assert.equal(journal.inspect('worker-integrated-b').state,'ACKED');
      broker.close();
    }finally{await pool.close();journal.close();}
  }));

test('child exit after prepared intent stays uncertain; other worker remains usable',
  {skip:process.platform!=='win32'},async()=>owned(async root=>{
    const pool=createWindowsMockWorkerPoolQA();
    const journal=createWindowsNativeJournalQA({root});
    try{
      journal.provision();
      await Promise.all([pool.launch(A),pool.launch(B)]);
      const {broker,alice,bob}=authFixture(pool,journal,'crash-intent');
      await assert.rejects(action(broker,alice,A,'crash-intent'),
        e=>e.code==='WORKER_EXITED');
      assert.equal(journal.inspect('crash-intent').state,'PREPARED');
      assert.equal(pool.status(A).running,false);
      assert.equal(pool.status(B).running,true);
      await assert.rejects(action(broker,alice,A,'cannot-repeat'),
        e=>e.code==='WORKER_NOT_RUNNING');
      const response=await action(broker,bob,B,'unaffected-other-agent');
      assert.equal(response.simulated,true);
      assert.equal(journal.inspect('unaffected-other-agent').state,'ACKED');
      broker.close();
    }finally{await pool.close();journal.close();}
  }));
