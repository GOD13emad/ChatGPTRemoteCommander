import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectFeatureService} from '../src/project-feature-service.mjs';
const scope={schema:1,generation:1,revision:'BUILD-V03-SCOPE-R1',authority:'human',gameEnabled:false,videoEnabled:false,coreBuildEnabled:true,browserMonitorBuildEnabled:true,runtimeInstalled:false,automaticPromotion:false};
const binding={hostId:'SAEED_WINDOWS',profileId:'fixture',projectId:'fixture-project',root:'C:\\fixture'};
const setup=()=>{
  const entries=[];const monitor={getContext:()=>({binding}),recordFeatureDecision:async entry=>{entries.push(entry);return {sequence:entry.expectedSequence+1};}};
  return {entries,service:createProjectFeatureService({monitor,scope,binding})};
};
const dag=()=>({schema:1,now:1000,projectId:'fixture-project',maxReady:2,tasks:[{id:'test-a',projectId:'fixture-project',state:'PENDING',dependencies:[],action:'RUN_BOUNDED_TESTS',hostId:'SAEED_WINDOWS',observedAtEpochMs:900,expiresAtEpochMs:1900}]});
test('capabilities expose ten projections but game fuse is paused',()=>{
  const {service}=setup();assert.equal(service.getCapabilities().length,10);
  assert.equal(service.getCapabilities().find(x=>x.featureId==='DEV-09').state,'USER_PAUSED');
  assert.ok(service.getCapabilities().every(x=>x.executionAuthority==='NONE'));
});
test('ready tasks reach only the durable decision seam',async()=>{
  const {service,entries}=setup();const r=await service.evaluate({featureId:'DEV-02',input:dag(),expectedSequence:0});
  assert.deepEqual(r.policy.ready.map(x=>x.id),['test-a']);assert.equal(entries.length,1);
  assert.deepEqual(entries[0],{featureId:'DEV-02',decision:'ALLOW',reasonCodes:[],expectedSequence:0});
  assert.equal(r.executionAuthority,'NONE');assert.equal(r.receipt.sequence,1);
});
test('dependency gate blocks missing and uncertain prerequisites',async()=>{
  const {service}=setup();const d=dag();d.tasks[0].dependencies=['missing'];
  assert.equal((await service.evaluate({featureId:'DEV-02',input:d,expectedSequence:0})).projection,'DENY');
  const u=dag();u.tasks[0].state='UNCERTAIN';assert.equal((await service.evaluate({featureId:'DEV-02',input:u,expectedSequence:1})).projection,'DENY');
});
test('different project cannot enter bound project decision journal',async()=>{
  const {service}=setup();const d=dag();d.projectId='another';
  assert.equal((await service.evaluate({featureId:'DEV-02',input:d,expectedSequence:0})).policy.reasonCodes[0],'FEATURE_BINDING_MISMATCH');
});
test('game budget stays paused even with purchase-free positive input',async()=>{
  const {service,entries}=setup();const r=await service.evaluate({featureId:'DEV-09',input:{purchaseRequired:false},expectedSequence:0});
  assert.equal(r.projection,'PAUSED');assert.equal(entries[0].decision,'PAUSED');assert.equal(r.policy.actionAllowed,false);
});
test('input hooks never execute',async()=>{
  const {service}=setup();let hooks=0;const d=dag();Object.defineProperty(d,'projectId',{enumerable:true,get(){hooks++;return 'fixture-project';}});
  const r=await service.evaluate({featureId:'DEV-02',input:d,expectedSequence:0});
  assert.equal(r.projection,'DENY');assert.equal(hooks,0);
  assert.equal((await service.evaluate({featureId:'DEV-02',input:new Proxy(d,{}),expectedSequence:1})).projection,'DENY');
});
test('every feature rejects malformed inputs without execution grant',async()=>{
  const {service}=setup();for(let i=1;i<=10;i++) {
    const r=await service.evaluate({featureId:'DEV-'+String(i).padStart(2,'0'),input:{},expectedSequence:i-1});
    assert.equal(r.executionAuthority,'NONE');assert.equal(r.policy.actionAllowed,false);
    assert.equal(r.projection,i===9?'PAUSED':'DENY');
  }
});
test('unknown feature and malformed request do not write the journal',async()=>{
  const {service,entries}=setup();await assert.rejects(service.evaluate({featureId:'SHELL',input:{},expectedSequence:0}),/FEATURE_NOT_REGISTERED/);
  await assert.rejects(service.evaluate({featureId:'DEV-02',input:dag(),expectedSequence:-1}),/FEATURE_SEQUENCE_INVALID/);
  assert.equal(entries.length,0);
});
test('journal error propagates unchanged rather than successful projection',async()=>{
  const failure=new Error('JOURNAL_CAS_CONFLICT');const monitor={getContext:()=>({binding}),recordFeatureDecision:async()=>{throw failure;}};
  const service=createProjectFeatureService({monitor,scope,binding});
  await assert.rejects(service.evaluate({featureId:'DEV-02',input:dag(),expectedSequence:0}),e=>e===failure);
});
test('core scope off and missing durable adapter deny construction',()=>{
  assert.throws(()=>createProjectFeatureService({monitor:{},scope,binding}),/FEATURE_DURABLE_ADAPTER_MISSING/);
  assert.throws(()=>createProjectFeatureService({monitor:{getContext:()=>({binding}),recordFeatureDecision(){}},scope:{...scope,coreBuildEnabled:false},binding}),/FEATURE_SCOPE_NOT_ADMITTED/);
});
test('journal identity must match the feature service binding before any write',()=>{
  for(const field of ['hostId','profileId','projectId','root']) {
    const monitor={getContext:()=>({binding:{...binding,[field]:'other'}}),recordFeatureDecision(){throw new Error('SHOULD_NOT_WRITE');}};
    assert.throws(()=>createProjectFeatureService({monitor,scope,binding}),/FEATURE_JOURNAL_BINDING_MISMATCH/);
  }
});
test('numeric identity cannot be coerced into a valid project or profile',()=>{
  for(const field of ['profileId','projectId']) {
    const numeric={...binding,[field]:123};
    const monitor={getContext:()=>({binding:numeric}),recordFeatureDecision(){throw new Error('SHOULD_NOT_WRITE');}};
    assert.throws(()=>createProjectFeatureService({monitor,scope,binding:numeric}),/FEATURE_BINDING_INVALID/);
  }
});
test('constructor rejects proxy and getter options before hooks execute',()=>{
  let hooks=0;
  const options={monitor:setup().service,scope,binding};
  const proxied=new Proxy(options,{get(target,key){hooks++;return target[key];}});
  assert.throws(()=>createProjectFeatureService(proxied),/FEATURE_OPTIONS_INVALID/);
  const accessor={scope,binding};Object.defineProperty(accessor,'monitor',{enumerable:true,get(){hooks++;return {};}});
  assert.throws(()=>createProjectFeatureService(accessor),/FEATURE_OPTIONS_INVALID/);
  assert.equal(hooks,0);
});
test('confirmed no-effect requires new authorization, not an ALLOW projection',async()=>{
  const {service}=setup();const input={schema:1,operationId:'op1',receiptState:'CONFIRMED_NOT_APPLIED',effectPossible:false,idempotencyKey:null,authoritativeReceiptSha256:'a'.repeat(64),receiptOperationId:'op1'};
  const result=await service.evaluate({featureId:'DEV-05',input,expectedSequence:0});
  assert.equal(result.policy.decision,'NEW_AUTHORIZATION_REQUIRED');assert.equal(result.projection,'PAUSED');
});
test('suppressed notification is recorded as PAUSED, never an ALLOW',async()=>{
  const {service}=setup();const current={projectId:'fixture-project',revision:1,status:'RUNNING',blocker:null,nextAction:null,evidenceSha256:null};
  const result=await service.evaluate({featureId:'DEV-10',input:{schema:1,previous:current,current,lastNotificationFingerprint:null},expectedSequence:0});
  assert.equal(result.policy.emit,false);assert.equal(result.projection,'PAUSED');
});
