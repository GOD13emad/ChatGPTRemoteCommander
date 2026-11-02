import test from 'node:test';
import assert from 'node:assert/strict';
import {readV2OwnerWorkflowSummary} from '../src/v2-owner-workflow-inventory.mjs';
import {WorkflowStore} from '../src/workflow-store.mjs';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';


const route=(chat='chat-one',target='wf-one')=>({
 hostId:'host-one',principalId:'owner',profileId:'owner-profile',
 conversationId:chat,operationId:'read-one',target:{kind:'workflow-root',id:target}
});
const state=()=>({
 id:'wf-one',revision:4,lifecycleState:'WAITING',acceptanceStatus:'UNVALIDATED',
 scheduler:{enabled:false},steps:[
   {id:'step-1',status:'verified',title:'DO_NOT_EXPOSE',arguments:{secret:'NO_LEAK'}},
   {id:'step-2',status:'pending',receipt:{token:'NO_LEAK'}}
 ],goal:'SECRET_DO_NOT_EXPOSE', notes:[{text:'SECRET_DO_NOT_EXPOSE'}]
});
const view=()=>({state:state(),headSha256:'a'.repeat(64)});
function fixture(){
 let current=route(),allowed=true,approved=true,callers=true,reads=0,
  overrideGet=null,grantReads=0,consents=0;
 const services={
  sessionHandle:'session-one',expectedPrincipalId:'owner',
  sessions:{async resolveNativeRoute(){return current;}},
  observedCaller:async()=>({
   hostId:'host-one',principalId:'owner',profileId:'owner-profile',
   conversationId:callers?current.conversationId:'wrong-chat'}),
  grants:{async isAllowed(r,t){grantReads++;assert.equal(t,'workflow_read');return allowed;}},
  workflowStore:{async get(id){reads++;assert.equal(id,'wf-one');return overrideGet?overrideGet():view();}},
  authorizeRead:async()=>{consents++;return approved;}
 };
 return {services,setRoute:x=>{current=x;},denyGrant:()=>{allowed=false;},
  denyConsent:()=>{approved=false;},wrongCaller:()=>{callers=false;},
  setGet:fn=>{overrideGet=fn;},stats:()=>({reads,grantReads,consents})};
}
test('owner-attested exact grant reads sanitized canonical WorkflowStore state',async()=>{
 const f=fixture();
 const result=await readV2OwnerWorkflowSummary(f.services);
 assert.deepEqual(result.steps,[{id:'step-1',status:'verified'},{id:'step-2',status:'pending'}]);
 assert.equal(result.authority,'OWNER_SESSION_AND_GRANT_VERIFIED');
 assert.equal(result.isExecutionReceipt,false);
 assert.equal(result.revision,4);
 assert.equal(result.workflowId,'wf-one');
 assert.equal(Object.isFrozen(result.steps),true);
 assert.ok(f.stats().grantReads>=3);
 assert.doesNotMatch(JSON.stringify(result),/SECRET|NO_LEAK|DO_NOT_EXPOSE|owner-profile|chat-one|token/);
});
test('absence of trusted session provider or consent denies before store access',async()=>{
 const f=fixture();
 await assert.rejects(readV2OwnerWorkflowSummary({...f.services,sessions:null}),
  {code:'V2_INVENTORY_TRUSTED_OWNER_WORKER_REQUIRED'});
 f.denyConsent();
 await assert.rejects(readV2OwnerWorkflowSummary(f.services),
  {code:'V2_INVENTORY_OWNER_CONSENT_REQUIRED'});
 assert.equal(f.stats().reads,0);
});
test('revoked grant and forged conversation do not read or enumerate',async()=>{
 const f=fixture();
 f.denyGrant();
 await assert.rejects(readV2OwnerWorkflowSummary(f.services),
  {code:'V2_INVENTORY_GRANT_REQUIRED'});
 assert.equal(f.stats().reads,0);
 const g=fixture();g.wrongCaller();
 await assert.rejects(readV2OwnerWorkflowSummary(g.services),
  {code:'V2_ROUTE_CALLER_MISMATCH'});
 assert.equal(g.stats().reads,0);
});
test('session route changed during async store retrieval denies leaked output',async()=>{
 const f=fixture();
 f.setGet(()=>{f.setRoute(route('different-chat','wf-one'));return view();});
 await assert.rejects(readV2OwnerWorkflowSummary(f.services),
  {code:'V2_INVENTORY_SESSION_CHANGED'});
 assert.equal(f.stats().reads,1);
});
test('invalid workflow snapshot, injected statuses or duplicate IDs never surface',async()=>{
 const variants=[
  {...state(),id:'other-workflow'},
  {...state(),steps:[{id:'x',status:'verified'},{id:'x',status:'pending'}]},
  {...state(),steps:[{id:'x',status:'FAKE_COMPLETED'}]},
  {...state(),revision:-1},
  {...state(),lifecycleState:'GUESSING'}
 ];
 for(const s of variants){
  const f=fixture();f.setGet(()=>({state:s,headSha256:'a'.repeat(64)}));
  await assert.rejects(readV2OwnerWorkflowSummary(f.services),
   {code:'V2_INVENTORY_STORE_INTEGRITY_REQUIRED'});
 }
});
test('only a workflow-root route is accepted, without touching WorkflowStore',async()=>{
 const f=fixture();
 f.setRoute({...route(),target:{kind:'app-window',id:'wf-one'}});
 await assert.rejects(readV2OwnerWorkflowSummary(f.services),
  {code:'V2_INVENTORY_WORKFLOW_ROUTE_REQUIRED'});
 assert.equal(f.stats().reads,0);
});

test('real existing SQLite WorkflowStore read leaves revision and records unchanged',async()=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'rcv2-inventory-sqlite-')));
 const store=new WorkflowStore({directory:join(directory,'private'),allowedRoots:[directory],
   device:'test-device',configSha256:'1'.repeat(64)});
 try{
  store.create({id:'wf-one',root:directory,goal:'Private untrusted project goal',
   acceptance:['Only evidence may establish completion'],steps:[
    {id:'s1',title:'Secret detail'}, {id:'s2',title:'Next action'}]});
  const before=store.get('wf-one');
  const f=fixture();f.services.workflowStore=store;
  const result=await readV2OwnerWorkflowSummary(f.services);
  assert.equal(result.workflowId,'wf-one');
  assert.equal(result.revision,before.state.revision);
  assert.equal(result.headSha256,before.headSha256);
  assert.equal(result.lifecycle,'CREATED');
  assert.deepEqual(result.steps.map(x=>x.status),['pending','pending']);
  assert.deepEqual(store.get('wf-one'),before);
  assert.equal(result.acceptanceStatus,'UNVALIDATED');
  assert.doesNotMatch(JSON.stringify(result),/Secret detail|Private untrusted project goal/);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('OAuth principal cannot borrow a different native owner despite valid grant',async()=>{
 const f=fixture();
 await assert.rejects(readV2OwnerWorkflowSummary({
  ...f.services,expectedPrincipalId:'other-owner'
 }),{code:'V2_INVENTORY_OAUTH_PRINCIPAL_MISMATCH'});
 assert.equal(f.stats().reads,0);
});


test('authoritative WorkflowStore BLOCKED and INTERRUPTED lifecycles remain visible',async()=>{
 for(const lifecycle of ['BLOCKED','INTERRUPTED']){
   const f=fixture();
   f.setGet(()=>({state:{...state(),lifecycleState:lifecycle},headSha256:'a'.repeat(64)}));
   const v=await readV2OwnerWorkflowSummary(f.services);
   assert.equal(v.lifecycle,lifecycle);
   assert.equal(v.isExecutionReceipt,false);
 }
});
