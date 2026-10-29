import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkflowStore } from '../src/workflow-store.mjs';
import { V2GrantRegistry } from '../src/v2-grant-registry.mjs';
import { executeV2WorkflowStep } from '../src/v2-workflow-gateway.mjs';

function setup() {
  const temp=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-flow-')));
  const project=path.join(temp,'project'); fs.mkdirSync(project);
  const leases=path.join(temp,'shared');
  const opts=profile=>({
    directory:path.join(temp,'data-'+profile),rootLeaseDirectory:leases,allowedRoots:[temp],device:'host',
    configSha256:'1'.repeat(64),
    authority:{profileId:profile,tier:'FULL_POWER',capabilities:['filesystem.full','workflow.durable','workflow.scheduler']},
    schedulerPolicy:{enabled:true,resumeInterrupted:true,resumeAfterRestart:true,resumeAfterUpdate:true,oneWriterPerRoot:true,maxConcurrentProjects:1,leaseMs:5000,intervalMs:1000,retryBudget:3}
  });
  const a=new WorkflowStore(opts('alice'));
  const b=new WorkflowStore(opts('bob'));
  const grants=new V2GrantRegistry({directory:path.join(temp,'permissions'),authorizeAdministration:({actor})=>actor==='admin'});
  for(const [store,id] of [[a,'flowa'],[b,'flowb']]){
    store.create({id,root:project,goal:'gateway proof',acceptance:['one writer'],steps:[{id:'write',title:'write once'}]});
  }
  const caller=(profile,chat)=>({hostId:'host',principalId:'owner',profileId:profile,conversationId:chat});
  const route=(id,profile,chat)=>({...caller(profile,chat),operationId:'write',target:{kind:'workflow-root',id}});
  const enable=r=>grants.change({route:r,tool:'write_text',status:'ENABLED',expectedRevision:0,actor:'admin',reason:'fixture explicit capability'});
  const run=(store,r,dispatch,extra={})=>executeV2WorkflowStep({
    route:r,stepId:'write',expectedRevision:1,tool:'write_text',
    arguments:{path:path.join(project,r.target.id+'.txt'),content:r.conversationId},
    workflowStore:store,observedCaller:async()=>caller(r.profileId,r.conversationId),
    grantRegistry:grants,authorizeTool:async()=>true,dispatch,...extra
  });
  return {a,b,grants,enable,route,run,temp,project,close(){
    a.close();b.close();grants.close();fs.rmSync(temp,{recursive:true,force:true});
  }};
}
test('one actual WorkflowStore call is journaled under granted identity',async()=>{
 const f=setup();let effects=0;
 try {
   const r=f.route('flowa','alice','chat-one');f.enable(r);
   const result=await f.run(f.a,r,async()=>{effects++;return {ok:true};});
   assert.equal(result.outcome,'RECORDED_NOT_VALIDATED');
   assert.equal(f.a.get('flowa').state.steps[0].status,'recorded');
   assert.equal(f.a.schedulerStatus().currentLeases,0);
   assert.equal(effects,1);
 }finally{f.close();}
});
test('two profiles targeting the same real path contend in existing machine-global root lease',async()=>{
 const f=setup();let entered;const started=new Promise(ok=>entered=ok);let release;const wait=new Promise(ok=>release=ok);let unauthorizedEffects=0;
 try {
   const a=f.route('flowa','alice','chat-a');const b=f.route('flowb','bob','chat-b');
   f.enable(a);f.enable(b);
   const first=f.run(f.a,a,async()=>{entered();await wait;return {ok:true};});
   await started;
   await assert.rejects(f.run(f.b,b,async()=>{unauthorizedEffects++;return {ok:true};}),/WORKFLOW_ROOT_LEASED/);
   assert.equal(unauthorizedEffects,0);
   assert.equal(f.b.get('flowb').state.revision,1);
   assert.equal(f.a.schedulerStatus().currentLeases,1);
   release();await first;
   const done=await f.run(f.b,b,async()=>{unauthorizedEffects++;return {ok:true};});
   assert.equal(done.outcome,'RECORDED_NOT_VALIDATED');
   assert.equal(unauthorizedEffects,1);
 }finally{release?.();f.close();}
});
test('revoked grant refuses dispatch, including cached receipt read',async()=>{
 const f=setup();let effects=0;
 try {
   const r=f.route('flowa','alice','chat-one');f.enable(r);
   await f.run(f.a,r,async()=>{effects++;return {ok:true};});
   f.grants.change({route:r,tool:'write_text',status:'REVOKED',expectedRevision:1,actor:'admin',reason:'explicit revoke fixture'});
   await assert.rejects(f.run(f.a,r,async()=>{effects++;return {ok:true};}),{code:'V2_GRANT_REQUIRED'});
   assert.equal(effects,1);
 }finally{f.close();}
});
test('wrong observed conversation and host never reach WorkflowStore.call',async()=>{
 const f=setup();try{
   const r=f.route('flowa','alice','chat-one');f.enable(r);
   await assert.rejects(f.run(f.a,r,async()=>({ok:true}),{observedCaller:async()=>({hostId:'host',principalId:'owner',profileId:'alice',conversationId:'chat-other'})}),{code:'V2_ROUTE_CALLER_MISMATCH'});
   await assert.rejects(f.run(f.a,{...r,hostId:'other'},async()=>({ok:true})),{code:'V2_ROUTE_CALLER_MISMATCH'});
   await assert.rejects(f.run(f.a,{...r,hostId:'other'},async()=>({ok:true}),{observedCaller:async()=>({hostId:'other',principalId:'owner',profileId:'alice',conversationId:'chat-one'})}),{code:'V2_WORKFLOW_STATE_AUTHORITY_MISMATCH'});
   assert.equal(f.a.get('flowa').state.revision,1);
 }finally{f.close();}
});
test('step/operation mismatch and untrusted executor dependencies fail closed',async()=>{
 const f=setup();try{
   const r=f.route('flowa','alice','chat-one');f.enable(r);
   await assert.rejects(f.run(f.a,{...r,operationId:'run-other'},async()=>({ok:true})),{code:'V2_WORKFLOW_TARGET_OR_STEP_MISMATCH'});
   await assert.rejects(f.run(f.a,r,async()=>({ok:true}),{grantRegistry:null}),{code:'V2_WORKFLOW_TRUSTED_SERVICE_REQUIRED'});
 }finally{f.close();}
});
test('revocation inside host validation prevents dispatch or workflow intent',async()=>{
 const f=setup();let effects=0;
 try{
   const r=f.route('flowa','alice','chat-one');f.enable(r);
   await assert.rejects(f.run(f.a,r,async()=>{effects++;return {ok:true};},{
     authorizeTool:async()=>{f.grants.change({route:r,tool:'write_text',status:'REVOKED',expectedRevision:1,actor:'admin',reason:'revoke at validation'});return true;}
   }),{code:'V2_GRANT_REQUIRED'});
   assert.equal(f.a.get('flowa').state.revision,1);
   assert.equal(effects,0);
 }finally{f.close();}
});

test('tool authorization must positively return true, not merely avoid throwing',async()=>{
 const f=setup();
 try {
   const r=f.route('flowa','alice','chat-one');f.enable(r);
   let effects=0;
   await assert.rejects(f.run(f.a,r,async()=>{effects++;return {ok:true};},{
     authorizeTool:async()=>undefined
   }),{code:'V2_WORKFLOW_TOOL_AUTH_REQUIRED'});
   assert.equal(effects,0);
   assert.equal(f.a.get('flowa').state.revision,1);
 }finally{f.close();}
});
test('revoke after PREPARED but before dispatch yields UNCERTAIN and zero effects',async()=>{
 const f=setup();
 try{
   const r=f.route('flowa','alice','chat-one');f.enable(r);
   let checks=0,effects=0;
   const result=await f.run(f.a,r,async()=>{effects++;return {ok:true};},{
     observedCaller:async()=>{
       checks++;
       if(checks===4) f.grants.change({route:r,tool:'write_text',status:'REVOKED',expectedRevision:1,actor:'admin',reason:'revoke before actual effect'});
       return {hostId:'host',principalId:'owner',profileId:'alice',conversationId:'chat-one'};
     }
   });
   assert.equal(result.outcome,'UNCERTAIN');
   assert.equal(f.a.get('flowa').state.steps[0].status,'uncertain');
   assert.equal(effects,0);
   assert.equal(f.a.schedulerStatus().currentLeases,0);
 }finally{f.close();}
});

test('second Node process holds the same durable WorkflowStore root lease',async()=>{
 const { spawn } = await import('node:child_process');
 const f=setup();
 let child;
 try {
   const childRoute=f.route('flowchild','charlie','chat-child');
   const parentRoute=f.route('flowb','bob','chat-parent');
   f.enable(childRoute);f.enable(parentRoute);
   const source=[
     "import path from 'node:path';",
     "import process from 'node:process';",
     "import { WorkflowStore } from "+JSON.stringify(new URL('../src/workflow-store.mjs',import.meta.url).href)+";",
     "import { V2GrantRegistry } from "+JSON.stringify(new URL('../src/v2-grant-registry.mjs',import.meta.url).href)+";",
     "import { executeV2WorkflowStep } from "+JSON.stringify(new URL('../src/v2-workflow-gateway.mjs',import.meta.url).href)+";",
     "const temp=process.argv[1],project=process.argv[2];",
     "const store=new WorkflowStore({directory:path.join(temp,'data-charlie'),rootLeaseDirectory:path.join(temp,'shared'),allowedRoots:[temp],device:'host',configSha256:'1'.repeat(64),authority:{profileId:'charlie',tier:'FULL_POWER',capabilities:['filesystem.full','workflow.durable','workflow.scheduler']},schedulerPolicy:{enabled:true,oneWriterPerRoot:true,maxConcurrentProjects:1,leaseMs:5000,intervalMs:1000,retryBudget:3}});",
     "const grants=new V2GrantRegistry({directory:path.join(temp,'permissions'),authorizeAdministration:()=>false});",
     "store.create({id:'flowchild',root:project,goal:'other process',acceptance:['one writer'],steps:[{id:'write',title:'write'}]});",
     "const route={hostId:'host',principalId:'owner',profileId:'charlie',conversationId:'chat-child',operationId:'write',target:{kind:'workflow-root',id:'flowchild'}};",
     "try {",
     "const result=await executeV2WorkflowStep({route,stepId:'write',expectedRevision:1,tool:'write_text',arguments:{path:path.join(project,'child.txt'),content:'child'},workflowStore:store,observedCaller:async()=>({hostId:'host',principalId:'owner',profileId:'charlie',conversationId:'chat-child'}),grantRegistry:grants,authorizeTool:async()=>true,dispatch:async()=>{process.stdout.write('READY\\n');await new Promise(resolve=>setTimeout(resolve,1600));return {ok:true};}});",
     "if(result.outcome!=='RECORDED_NOT_VALIDATED')process.exitCode=2;",
     "}catch(e){process.stderr.write(String(e.stack||e));process.exitCode=1;}finally{grants.close();store.close();}"
   ].join('\n');
   child=spawn(process.execPath,['--input-type=module','--eval',source,f.temp,f.project],
     {stdio:['pipe','pipe','pipe'],windowsHide:true});
   let stderr='';
   child.stderr.on('data',data=>{stderr+=String(data);});
   const ready=new Promise((resolve,reject)=>{
     let output='';
     child.stdout.on('data',data=>{
       output+=String(data);
       if(output.includes('READY'))resolve();
     });
     child.once('error',reject);
     child.once('exit',code=>reject(new Error('child exit '+code+' '+stderr)));
   });
   let timeout;
   try { await Promise.race([ready,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('child ready timeout')),7000);})]); }
   finally {clearTimeout(timeout);}
   let effects=0;
   await assert.rejects(f.run(f.b,parentRoute,async()=>{effects++;return {ok:true};}),/WORKFLOW_ROOT_LEASED/);
   assert.equal(effects,0);
   const result=await new Promise((resolve,reject)=>{
     child.once('exit',(code)=>code===0?resolve(code):reject(new Error('child exit '+code+' '+stderr)));
     child.once('error',reject);
   });
   assert.equal(result,0);
   const after=await f.run(f.b,parentRoute,async()=>{effects++;return {ok:true};});
   assert.equal(after.outcome,'RECORDED_NOT_VALIDATED');
   assert.equal(effects,1);
 }finally {if(child && child.exitCode===null)child.kill();f.close();}
});
