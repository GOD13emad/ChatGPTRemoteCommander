import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createV012HostGlobalOperationLease,createV012WindowsHostGlobalOperationLease} from '../src/v012-host-global-operation-lease.mjs';
import {ensureWindowsMonitorDirectories} from '../src/browser-companion-windows-private.mjs';
import {runContainedProjectCommand,serializeProcessCessationProof,processContainmentAvailable} from '../src/process-containment.mjs';
const HOST='native-deferred-fixture',INPUT='1'.repeat(64);
const RESOURCE=JSON.stringify([1,HOST,'workflow-root','canonical-root']);
async function fixture(){
 const parent=fs.realpathSync.native(os.tmpdir());
 let root;
 if(process.platform==='win32'){
   root=path.join(parent,'rc-native-deferred-'+randomUUID());
   await ensureWindowsMonitorDirectories([root],{create:true});
 }else{root=fs.mkdtempSync(path.join(parent,'rc-native-deferred-'));fs.chmodSync(root,0o700);}
 root=fs.realpathSync.native(root);
 const open=()=>process.platform==='win32'
   ?createV012WindowsHostGlobalOperationLease({directory:root,hostId:HOST})
   :Promise.resolve(createV012HostGlobalOperationLease({directory:root,hostId:HOST}));
 return {root,open};
}
test('durable native deferred handoff releases only after exact real process cessation, including restart and replay denial',{timeout:60000},async t=>{
 if(!(await processContainmentAvailable()))return t.skip('native containment provider unavailable');
 const f=await fixture();let first,second;let binding;
 const operationId=randomUUID();
 try{
  first=await f.open();second=await f.open();
  await first.withLease(RESOURCE,async ctx=>{
    binding=ctx.bindDeferredOperation({operationId,inputHash:INPUT});
    // A live outer callback must not be replaced by its worker's earlier finish.
    const before=await second.reconcileDeferred(RESOURCE,async()=>{throw Error('must not consult completion before handoff');});
    assert.equal(before.released,false);
    ctx.commitDeferredHandoff({operationId});
    assert.equal((await second.reconcileDeferred(RESOURCE,async()=>{
      throw Error('must not consult completion while the outer callback is active');
    })).released,false);
    return {operationId,status:'QUEUED'};
  });
  await assert.rejects(second.withLease(RESOURCE,async()=>{}),{code:'V012_NATIVE_LEASE_OCCUPIED'});
  first.close();first=null;second.close();second=await f.open();
  assert.equal((await second.reconcileDeferred(RESOURCE,async()=>null)).released,false);
  const run=await runContainedProjectCommand({
    program:process.execPath,args:['-e',"process.stdout.write('completed\\n')"],
    cwd:f.root,timeoutMs:10000,outputLimit:4096,env:process.env,binding
  });
  const proof=serializeProcessCessationProof(run.processCessationProof);
  assert.ok(proof,'actual native provider must independently attest zero processes');
  assert.equal((await second.reconcileDeferred(RESOURCE,async()=>({
    inputHash:'2'.repeat(64),processCessationProof:proof
  }))).released,false,'wrong reservation cannot release the root');
  const forged={...proof,activeProcesses:1};
  assert.equal((await second.reconcileDeferred(RESOURCE,async()=>({
    inputHash:INPUT,processCessationProof:forged
  }))).released,false);
  assert.equal((await second.reconcileDeferred(RESOURCE,async()=>({
    inputHash:INPUT,processCessationProof:proof
  }))).released,true);
  // Reusing the old operation ID must not make an old proof valid for a new owner.
  await second.withLease(RESOURCE,async ctx=>{
    const next=ctx.bindDeferredOperation({operationId,inputHash:INPUT});
    assert.notEqual(next.leaseId,binding.leaseId);
    ctx.commitDeferredHandoff({operationId});
  });
  assert.equal((await second.reconcileDeferred(RESOURCE,async()=>({
    inputHash:INPUT,processCessationProof:proof
  }))).released,false,'old owner/process proof cannot clear replacement lease');
  await assert.rejects(second.withLease(RESOURCE,async()=>{}),{code:'V012_NATIVE_LEASE_OCCUPIED'});
 }finally{first?.close();second?.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
test('unbound uncertain legacy lease has no self-serve deferred release',{timeout:30000},async()=>{
 const f=await fixture();const lease=await f.open();
 try{
  await assert.rejects(lease.withLease(RESOURCE,async()=>{throw Error('unknown-effect');}));
  let consulted=0;
  const r=await lease.reconcileDeferred(RESOURCE,async()=>{consulted++;return{};});
  assert.equal(r.released,false);assert.equal(consulted,0);
  await assert.rejects(lease.withLease(RESOURCE,async()=>{}),{code:'V012_NATIVE_LEASE_OCCUPIED'});
 }finally{lease.close();fs.rmSync(f.root,{recursive:true,force:true});}
});

