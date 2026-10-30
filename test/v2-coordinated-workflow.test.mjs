import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { V2CentralCoordinator } from '../src/v2-central-coordinator.mjs';
import { executeV2CoordinatedWorkflowStep } from '../src/v2-coordinated-workflow.mjs';
const route=(conversationId,operationId='write')=>({
 hostId:'device',principalId:'owner',profileId:'profile',conversationId,operationId,
 target:{kind:'workflow-root',id:'project'}
});
const caller=r=>({hostId:r.hostId,principalId:r.principalId,
 profileId:r.profileId,conversationId:r.conversationId});
function setup(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-gateway-'));
 let now=90000,allowed=true,commits=0;
 const coord=()=>new V2CentralCoordinator({directory,now:()=>now,
   authorizeLease:async()=>allowed});
 const first=coord(),second=coord();
 const grantRegistry={isAllowed:()=>allowed};
 const workflowStore={
   get:()=>({state:{id:'project',device:'device',authority:{profileId:'profile'}}}),
   call:async(_input,{validate,dispatch})=>{
     const state=workflowStore.get().state;
     try{
       await validate('write_text',{},state);
       const out=await dispatch('write_text',{},state);
       return {outcome:'RECORDED_NOT_VALIDATED',out};
     }catch(e){return {outcome:'UNCERTAIN',cause:e.code};}
   }
 };
 const input=(r,coordinator=first,commitWithFence=async data=>{
   await data.assertCurrent();commits++;return {success:true,fence:data.fence};
 })=>({
   coordinator,route:r,ttlMs:1000,commitWithFence,
   stepId:'write',expectedRevision:1,tool:'write_text',arguments:{},
   workflowStore,grantRegistry,observedCaller:async()=>caller(r),
   authorizeTool:async()=>allowed
 });
 return {first,second,input,route,advance:n=>now+=n,revoke:()=>allowed=false,
   get commits(){return commits;},
   close(){first.close();second.close();fs.rmSync(directory,{recursive:true,force:true});}};
}
test('two authenticated chats share one central fenced resource, not two per-chat leases',async()=>{
 const f=setup();let unblock,entered;const wait=new Promise(ok=>unblock=ok);
 const started=new Promise(ok=>entered=ok);
 try{
  const one=executeV2CoordinatedWorkflowStep(f.input(route('chat-one'),f.first,
    async data=>{entered();await wait;await data.assertCurrent();return {fence:data.fence};}));
  await started;
  await assert.rejects(executeV2CoordinatedWorkflowStep(
    f.input(route('chat-two'),f.second)),{code:'V2_COORDINATOR_RESOURCE_BUSY'});
  unblock();const done=await one;
  assert.equal(done.outcome,'RECORDED_NOT_VALIDATED');
  const second=await executeV2CoordinatedWorkflowStep(f.input(route('chat-two'),f.second));
  assert.equal(second.out.fence,2);
  assert.equal(f.commits,1);
 }finally{unblock?.();f.close();}
});
test('revoke before actuator disallows a write, despite an earlier coordinator admission',async()=>{
 const f=setup();
 try{
  await assert.rejects(executeV2CoordinatedWorkflowStep(f.input(route('chat-one'),f.first,
    async ({assertCurrent})=>{f.revoke();await assertCurrent();throw Error('should not reach');})),
    {code:'V2_COORDINATOR_AUTH_REQUIRED'});
  assert.equal(f.commits,0);
 }finally{f.close();}
});
test('stale lease blocks a delayed native write after another chat claims a higher fence',async()=>{
 const f=setup();
 try{
  await assert.rejects(executeV2CoordinatedWorkflowStep(f.input(route('chat-one'),f.first,
    async ({assertCurrent})=>{
      f.advance(1001);
      const claimed=await f.second.acquire({route:route('chat-two')});
      assert.equal(claimed.fence,2);
      await assertCurrent();
      throw Error('should not reach');
    })),{code:'V2_COORDINATOR_STALE_LEASE'});
  assert.equal(f.commits,0);
 }finally{f.close();}
});
test('untrusted dispatch replacement, non-workflow target and missing coordinator fail closed',async()=>{
 const f=setup();
 try{
  await assert.rejects(executeV2CoordinatedWorkflowStep({...f.input(route('chat-one')),dispatch:()=>true}),
    {code:'V2_COORDINATED_TRUSTED_BACKEND_REQUIRED'});
  await assert.rejects(executeV2CoordinatedWorkflowStep({...f.input(route('chat-one')),
    route:{...route('chat-one'),target:{kind:'app-window',id:'window'}}}),
    {code:'V2_COORDINATED_WORKFLOW_ROOT_REQUIRED'});
  await assert.rejects(executeV2CoordinatedWorkflowStep({...f.input(route('chat-one')),coordinator:null}),
    {code:'V2_COORDINATED_TRUSTED_BACKEND_REQUIRED'});
  assert.equal(f.commits,0);
 }finally{f.close();}
});

test('WorkflowStore adapter passes coordinator global identity to trusted actuator, never host-local key',async()=>{
 const f=setup();
 const central=new V2CentralCoordinator({directory:f.first.directory,
   authorizeLease:async()=>true,
   resolveGlobalResource:async()=> 'trusted-global-workflow-resource',
   requireGlobalResource:true});
 try{
  const output=await executeV2CoordinatedWorkflowStep(f.input(route('chat-one'),central,
    async({resource,leaseId,fence,assertCurrent})=>{
      assert.equal(resource,'["global-v1","workflow-root","trusted-global-workflow-resource"]');
      assert.equal(typeof leaseId,'string');
      assert.equal(fence,1);
      await assertCurrent();
      return {resource,fence};
    }));
  assert.equal(output.outcome,'RECORDED_NOT_VALIDATED');
  assert.equal(output.out.resource,
    '["global-v1","workflow-root","trusted-global-workflow-resource"]');
 }finally{central.close();f.close();}
});
