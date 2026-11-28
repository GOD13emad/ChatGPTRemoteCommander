import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWorkflowTools} from '../src/workflow-tools.mjs';
import {createV012SharedPhysicalRootFence} from '../src/v012-shared-physical-root-fence.mjs';
import {createV2PrivatePairOperationGate} from '../src/v2-private-pair-operation-gate.mjs';

// These admission callbacks are synthetic; this tests composed data flow,
// never live J01 consent, enrolled Workers or OS privilege.
const NOW=Date.now(),SID='a'.repeat(64),TUNNEL='b'.repeat(64);
const route={hostId:'fixture-host',profileId:'fixture-profile',principalId:'owner',
 conversationId:'fixture-chat',operationId:'fixture-op',target:{kind:'host-shell',id:'shell'}};
function fixture(){
 const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc012-composed-fence-')));
 const state={held:false,acquires:0,effects:0,allowed:true};
 const native={hostId:route.hostId,async withLease(_key,work){
   if(state.held)throw Object.assign(Error('OCCUPIED'),{code:'V012_NATIVE_LEASE_OCCUPIED'});
   state.held=true;state.acquires++;
   try{return await work({markEffectStarted(){},markSafePreEffectDenial(){}});}
   finally{state.held=false;}
 }};
 const fence=createV012SharedPhysicalRootFence({nativeHostLease:native,
   hostId:route.hostId,allowedRoots:[root],resolveTrustedRouteRoot:()=>root});
 const tool=createWorkflowTools({config:{durableWorkflows:{enabled:true,directory:path.join(root,'state')}},
   roots:[root],device:route.hostId,configSha256:'0'.repeat(64),physicalRootFence:fence,
   lookup:name=>({name,inputSchema:{type:'object'}}),validateSchema:()=>[],
   dispatch:async()=>{state.effects++;return {ok:true};}});
 // The exact native-owner shape must not include target/operation fields.
 const owner={source:'native-owner-attested',hostId:route.hostId,profileId:route.profileId,
   principalId:route.principalId,conversationId:route.conversationId,bindingId:'c'.repeat(64),
   ownerSidHash:SID,tunnelIdHash:TUNNEL,expiresAtMs:NOW+60000};
 const gate=execute=>{
   // Keep fixture construction explicit; the production gate validates this
   // exact record before any route-specific lock callback can run.
   return createV2PrivatePairOperationGate({
     hostId:route.hostId,profileId:route.profileId,principalId:route.principalId,
     expectedOwnerSidHash:SID,expectedTunnelIdHash:TUNNEL,now:()=>NOW,
     attestTransport:async()=>({authenticated:true,peerType:'owner-pinned-private-tunnel-mtls',sessionSource:'native-owner-private-pair'}),
     readCurrentOwnerSidHash:async()=>SID,resolveOwnerContext:async()=>owner,
     verifyExactNativeGrant:async()=>state.allowed,
     withLease:async()=>{throw Error('LEGACY_RESOURCE_LOCK_MUST_NOT_RUN');},
     withRouteLease:(r,work)=>fence.withDirectRouteLease(r,work),
     receiptStore:{execute:async(_input,work)=>work()},execute});
 };
 const create=()=>tool.execute('workflow_create',{id:'sample',root,goal:'Shared effect fence',
   acceptance:['Single native resource'],steps:[{id:'read',title:'Read',dependsOn:[]}]});
 const call=()=>tool.execute('workflow_call',{id:'sample',stepId:'read',expectedRevision:1,
   tool:'read_text',arguments:{}});
 return {root,state,fence,tool,gate,create,call,close(){tool.close();fs.rmSync(root,{recursive:true,force:true});}};
}
test('protected direct shell gate excludes WorkflowTools until the same owner fence releases',async()=>{
 const f=fixture();let resume,started;
 const holding=new Promise(r=>started=r),wait=new Promise(r=>resume=r);
 try{
   await f.create();
   const pending=f.gate(async()=>{started();await wait;return {ok:true};}).execute({route,tool:'read_text'});
   await Promise.race([holding,pending]);
   await assert.rejects(f.call(),{code:'V012_NATIVE_LEASE_OCCUPIED'});
   assert.equal(f.state.effects,0);
   resume();await pending;
   assert.equal((await f.call()).outcome,'RECORDED_NOT_VALIDATED');
   assert.equal(f.state.effects,1);assert.equal(f.state.acquires,2);
 }finally{resume?.();f.close();}
});
test('same-root protected workflow dispatch reuses the shared owner claim without deadlock',async()=>{
 const f=fixture();
 try{
   await f.create();
   const workflowRoute={...route,target:{kind:'workflow-root',id:'enrolled-project'}};
   const result=await f.gate(()=>f.call()).execute({route:workflowRoute,tool:'read_text'});
   assert.equal(result.outcome,'RECORDED_NOT_VALIDATED');
   assert.equal(f.state.acquires,1);assert.equal(f.state.effects,1);
 }finally{f.close();}
});
test('revoked native grant never reaches shared root admission or WorkflowTools',async()=>{
 const f=fixture();
 try{
   await f.create();f.state.allowed=false;
   await assert.rejects(f.gate(()=>f.call()).execute({route,tool:'read_text'}),{code:'V2_GRANT_REQUIRED'});
   assert.equal(f.state.acquires,0);assert.equal(f.state.effects,0);
 }finally{f.close();}
});

