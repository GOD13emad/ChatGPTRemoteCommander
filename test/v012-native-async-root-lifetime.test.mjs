import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createAsyncOperationTools} from '../src/async-operations.mjs';
import {createV012OwnerNativeHostLease} from '../src/v012-owner-native-host-lease-bootstrap.mjs';
import {createV012SharedPhysicalRootFence} from '../src/v012-shared-physical-root-fence.mjs';
import {ensureWindowsMonitorDirectories} from '../src/browser-companion-windows-private.mjs';
import {processContainmentAvailable} from '../src/process-containment.mjs';
import {DeliveryStore} from '../src/delivery-store.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms)),HOST='native-async-fixture';
const route={hostId:HOST,profileId:'fixture',principalId:'fixture-owner',
 conversationId:'fixture-pair',operationId:'start-job',target:{kind:'workflow-root',id:'project'}};
async function fixture({revoke=false}={}){
 const parent=fs.realpathSync.native(os.tmpdir());
 const root=path.join(parent,'rc-native-async-'+randomUUID());
 if(process.platform==='win32')await ensureWindowsMonitorDirectories([root],{create:true});
 else fs.mkdirSync(root,{mode:0o700});
 const canonical=fs.realpathSync.native(root),lease=await createV012OwnerNativeHostLease({directory:canonical,hostId:HOST});
 let tools,observed,granted=true;
 const fence=createV012SharedPhysicalRootFence({nativeHostLease:lease,hostId:HOST,
   allowedRoots:[canonical],resolveTrustedRouteRoot:()=>canonical,
   readDeferredCompletion:r=>tools.readNativeRootCompletion(r)});
 const flag=path.join(canonical,'allow-finish');
 const command="const fs=require('node:fs');const t=setInterval(()=>{if(fs.existsSync("+JSON.stringify(flag)+")){clearInterval(t);process.stdout.write('native-job-complete\\n')}},30);";
 tools=createAsyncOperationTools({
   config:{asyncOperations:{enabled:true,stateDir:path.join(canonical,'async')}},
   nativeRootExecution:{required:()=>true,bind:meta=>{observed={...meta,binding:fence.bindDeferredOperation(meta)};return observed.binding;}},
   prepare:async()=>{if(revoke)granted=false;return {kind:'process',file:process.execPath,args:['-e',command],cwd:canonical,timeoutMs:15000};}
 });
 return {root:canonical,flag,lease,fence,tools,get observed(){return observed;},
   start:()=>fence.withDirectRouteLease(route,()=>tools.execute('operation_start',{
     requestId:'native-async-'+randomUUID(),tool:'run_project_command',arguments:{}
   },{authorizeNativeLaunch:async()=>granted})),
   async cleanup(){
     fs.writeFileSync(flag,'release');
     if(observed){
       let proof;
       for(let n=0;n<40;n++){
         proof=await tools.readNativeRootCompletion(observed);
         if(proof)break;
         await pause(250);
       }
       if(!proof){await tools.close();lease.close();return false;}
     }
     await tools.close();lease.close();fs.rmSync(canonical,{recursive:true,force:true});return true;
   }
 };
}
test('native background worker keeps root, returns receipt, and releases only with verified complete worker tree',{timeout:90000},async t=>{
 if(!(await processContainmentAvailable()))return t.skip('native containment unavailable');
 const f=await fixture();
 try{
   const queued=await f.start();assert.equal(queued.status,'QUEUED');
   assert.equal(f.observed.operationId,queued.operationId);
   let effects=0;
   await assert.rejects(f.fence.withWorkflowRootLease(f.root,async()=>effects++),{code:'V012_NATIVE_LEASE_OCCUPIED'});
   assert.equal(effects,0);
   fs.writeFileSync(f.flag,'release');
   let completed=null;
   for(let n=0;n<50;n++){
     completed=await f.tools.readNativeRootCompletion(f.observed);
     if(completed)break;
     await pause(200);
   }
   assert.ok(completed,'requires durable exact-reservation native process proof');
   const proofFile=path.join(f.root,'async','operations',queued.operationId,'native-completion.json');
   const alias=proofFile+'.test-hardlink';
   fs.linkSync(proofFile,alias);
   try{assert.equal(await f.tools.readNativeRootCompletion(f.observed),null,'a linked proof is not private evidence');}
   finally{fs.unlinkSync(alias);}
   if(process.platform==='linux'){
     const held=proofFile+'.test-fifo-held';
     fs.renameSync(proofFile,held);
     try{
       execFileSync('/usr/bin/mkfifo',[proofFile],{timeout:3000});
       assert.equal(await f.tools.readNativeRootCompletion(f.observed),null,'a substituted FIFO must reject without blocking');
     }finally{if(fs.existsSync(proofFile))fs.unlinkSync(proofFile);fs.renameSync(held,proofFile);}
   }
   const requestFile=path.join(f.observed.storage.stateRoot,'requests',f.observed.storage.requestKey+'.json');
   const heldRequest=requestFile+'.test-held';
   fs.renameSync(requestFile,heldRequest);
   try{
     const missingReservation=await f.tools.execute('operation_result',{operationId:queued.operationId});
     assert.notEqual(missingReservation.state.status,'SUCCEEDED','cached reservation is not durable evidence when its original file is missing');
     assert.equal(missingReservation.state.nativeCessationPending,true);
     const restarted=createAsyncOperationTools({
       config:{asyncOperations:{enabled:true,stateDir:path.join(f.root,'async')}},
       prepare:async()=>{throw Error('MISSING_RESERVATION_MUST_NOT_RELAUNCH');}
     });
     try{
       const unknown=await restarted.execute('operation_status',{operationId:queued.operationId});
       assert.equal(unknown.status,'UNCERTAIN');
       assert.equal(unknown.nativeCessationPending,true);
     }finally{await restarted.close();}
   }finally{fs.renameSync(heldRequest,requestFile);}
   // A direct worker's success is not native completion. After restart and a
   // corrupt state projection, the durable reservation must retain that fact.
   const opDir=path.join(f.root,'async','operations',queued.operationId);
   const proofPath=path.join(opDir,'native-completion.json');
   const heldProof=proofPath+'.test-held';
   fs.renameSync(proofPath,heldProof);
   const delivery=new DeliveryStore({directory:path.join(f.root,'delivery'),scope:'native-fixture'});
   const recovered=createAsyncOperationTools({
     config:{asyncOperations:{enabled:true,stateDir:path.join(f.root,'async')}},
     prepare:async()=>{throw Error('RECOVERY_MUST_NOT_RELAUNCH');},deliveryStore:delivery
   });
   const otherProfile=createAsyncOperationTools({
     config:{asyncOperations:{enabled:true,stateDir:path.join(f.root,'different-profile-async')}},
     prepare:async()=>{throw Error('OTHER_PROFILE_MUST_NOT_RELAUNCH');}
   });
   const reopenedLease=await createV012OwnerNativeHostLease({directory:f.root,hostId:HOST});
   const otherFence=createV012SharedPhysicalRootFence({nativeHostLease:reopenedLease,
     hostId:HOST,allowedRoots:[f.root],resolveTrustedRouteRoot:()=>f.root,
     readDeferredCompletion:r=>otherProfile.readNativeRootCompletion(r)});
   try{
     fs.writeFileSync(path.join(opDir,'state.json'),'{corrupt');
     const pending=await recovered.execute('operation_result',{operationId:queued.operationId});
     assert.notEqual(pending.state.status,'SUCCEEDED');
     assert.equal(pending.state.nativeCessationPending,true);
     assert.notEqual(pending.result.status,'SUCCEEDED');
     await recovered.reconcileDeliveries(500);
     assert.equal(delivery.list({correlationId:queued.correlationId,includeDelivered:true}).items.some(e=>e.kind==='COMPLETED'),false);
     await assert.rejects(f.fence.withWorkflowRootLease(f.root,async()=>effects++),{code:'V012_NATIVE_LEASE_OCCUPIED'});
     await assert.rejects(otherFence.withWorkflowRootLease(f.root,async()=>effects++),{code:'V012_NATIVE_LEASE_OCCUPIED'});
     fs.renameSync(heldProof,proofPath);
     const terminal=await recovered.execute('operation_status',{operationId:queued.operationId});
     assert.equal(terminal.status,'SUCCEEDED');
     assert.equal(delivery.list({correlationId:queued.correlationId,includeDelivered:true}).items.filter(e=>e.kind==='COMPLETED').length,1);
     await otherFence.withWorkflowRootLease(f.root,async()=>effects++);
     assert.equal(effects,1,'a fresh native DB connection and different profile reconcile the pinned original store');
   }finally{
     if(fs.existsSync(heldProof))fs.renameSync(heldProof,proofPath);
     await recovered.close();await otherProfile.close();reopenedLease.close();delivery.close();
   }
   const receipt=await f.tools.execute('operation_result',{operationId:queued.operationId,tailBytes:1024});
   assert.equal(receipt.state.status,'SUCCEEDED');
   await f.fence.withWorkflowRootLease(f.root,async()=>effects++);
   assert.equal(effects,2);
 }finally{if(!await f.cleanup())t.diagnostic('PRESERVED_UNRECONCILED_QA_ROOT='+f.root);}
});
test('revocation after preparation denies native worker launch and cannot bind a process scope',{timeout:30000},async t=>{
 if(!(await processContainmentAvailable()))return t.skip('native containment unavailable');
 const f=await fixture({revoke:true});
 try{
   await assert.rejects(f.start(),/ASYNC_NATIVE_ROOT_AUTHORIZATION_REVOKED/);
   assert.equal(f.observed,undefined,'no native binding or worker spawn after grant denial');
 }finally{assert.equal(await f.cleanup(),true);}
});

