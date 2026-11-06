import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createProjectMonitor} from '../src/project-monitor.mjs';
import {createProjectFeatureService} from '../src/project-feature-service.mjs';
const scope={schema:1,generation:1,revision:'BUILD-V03-SCOPE-R1',authority:'human',gameEnabled:false,videoEnabled:false,coreBuildEnabled:true,browserMonitorBuildEnabled:true,runtimeInstalled:false,automaticPromotion:false};
// Actual owned disk fixtures; privacy verifiers are deliberately injected.
// These tests do NOT establish Windows ACL/owner qualification or host autonomy.
function fixture() {
  const ownerRoot=fs.mkdtempSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'.feature-disk-owned-'));
  const directory=path.join(ownerRoot,'memory');fs.mkdirSync(directory);
  const identity=fs.statSync(ownerRoot,{bigint:true}),when=Date.now();
  const bound={hostId:'SAEED_WINDOWS',profileId:'test-feature-disk',projectId:'test-project',root:ownerRoot,rootIdentity:{dev:String(identity.dev),ino:String(identity.ino)}};
  const options={directory,binding:bound,verifyPrivateDirectory:()=>true,verifyPrivateFile:()=>true,clock:()=>when};
  const monitor=createProjectMonitor(options),context=monitor.getContext({maxBytes:16384,maxEvents:0});
  const binding=Object.fromEntries(['hostId','profileId','projectId','root'].map(k=>[k,context.binding[k]]));
  const service=createProjectFeatureService({monitor,scope,binding});
  const task={id:'read-1',projectId:binding.projectId,state:'PENDING',dependencies:[],action:'READ_CHECKPOINT',hostId:binding.hostId,observedAtEpochMs:when-1,expiresAtEpochMs:when+1000};
  return {monitor,service,options,binding,when,task,directory};
}
test('feature service writes real durable journal and survives a new monitor instance',async()=>{
  const f=fixture();const input={schema:1,now:f.when,projectId:f.binding.projectId,maxReady:1,tasks:[f.task]};
  const first=await f.service.evaluate({featureId:'DEV-02',input,expectedSequence:0});
  assert.equal(first.receipt.sequence,1);assert.equal(first.executionAuthority,'NONE');
  const repeated=await f.service.evaluate({featureId:'DEV-02',input,expectedSequence:1});assert.equal(repeated.receipt.changed,false);
  const reopened=createProjectMonitor(f.options);const context=reopened.getContext({maxBytes:16384,maxEvents:0});
  assert.equal(context.sequence,1);assert.equal(context.featureDecisions['DEV-02'].decision,'ALLOW');
  assert.deepEqual(context.outbox,[]);assert.equal(reopened.state().nativePrivateStorageQualified,false);
  assert.equal(fs.readFileSync(path.join(f.directory,'project-monitor.journal.jsonl'),'utf8').trim().split('\n').length,1);
});
test('paused game feature persists only PAUSED and never grants execution',async()=>{
  const f=fixture();const result=await f.service.evaluate({featureId:'DEV-09',input:{},expectedSequence:0});
  assert.equal(result.projection,'PAUSED');assert.equal(result.receipt.gameEnabled,false);assert.equal(result.receipt.videoEnabled,false);
  const reopened=createProjectMonitor(f.options);assert.equal(reopened.getContext().featureDecisions['DEV-09'].decision,'PAUSED');
});
test('wrong project service cannot write to a real existing journal',()=>{
  const f=fixture();assert.throws(()=>createProjectFeatureService({monitor:f.monitor,scope,binding:{...f.binding,projectId:'other-project'}}),/FEATURE_JOURNAL_BINDING_MISMATCH/);
  assert.equal(f.monitor.state().sequence,0);assert.equal(fs.existsSync(path.join(f.directory,'project-monitor.journal.jsonl')),false);
});
