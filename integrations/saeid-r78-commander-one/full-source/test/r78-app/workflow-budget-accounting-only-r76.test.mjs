import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {WorkflowStore} from '../../src/workflow-store.mjs';
// Unit boundary ONLY: these callbacks synchronously throw without starting any
// effect, child process or asynchronous task. Disabling lease coordination in
// this fixture isolates persisted counter behavior. Default-true lease safety
// is independently exercised by workflow-root-lease-minimal-r76.test.mjs.
// This is NOT acceptance of a production native-cessation recovery bridge.
test('same workflow/root/cause budget accounting persists in an explicitly lease-independent no-effect unit fixture',async()=>{
 const home=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-r76-budgetunit-')));const project=path.join(home,'project');fs.mkdirSync(project);
 const options={directory:path.join(home,'memory'),rootLeaseDirectory:path.join(home,'leases'),allowedRoots:[project],device:'fixture',configSha256:'a'.repeat(64),schedulerPolicy:{enabled:false,oneWriterPerRoot:false}};
 let store=new WorkflowStore(options);let callbacks=0;
 try{
  store.create({id:'retry',root:project,goal:'Budget counter unit qualification only',acceptance:['Reassessment after repeated same root cause'],retryBudget:1,steps:[{id:'a',title:'A',dependsOn:[]},{id:'b',title:'B',dependsOn:[]}]});
  const host={validate:async()=>{},dispatch:async()=>{callbacks++;throw Object.assign(Error('fixture synchronous no-effect failure'),{workflowCode:'SAME_ROOT'});}};
  const first=await store.call({id:'retry',stepId:'a',expectedRevision:1,tool:'write_text',arguments:{path:'a.txt',content:'not-written'}},host);
  assert.equal(first.outcome,'UNCERTAIN');assert.equal(callbacks,1);assert.equal(fs.existsSync(path.join(project,'a.txt')),false);
  await store.reconcileAutomatically('retry',{verify:async()=>({status:'NOT_APPLIED',summary:'Fixture joined callback created no file or descendants'})});
  store.close();store=new WorkflowStore(options);const before=store.get('retry').state;
  assert.equal(before.scheduler.repeatedFailureCount,1);assert.equal(before.root,project);
  await store.call({id:'retry',stepId:'b',expectedRevision:before.revision,tool:'write_text',arguments:{path:'b.txt',content:'not-written'}},host);
  const after=store.get('retry').state;assert.equal(callbacks,2);assert.equal(after.id,'retry');assert.equal(after.root,project);assert.equal(after.scheduler.repeatedFailureCount,2);assert.equal(after.scheduler.lastRootCauseCode,'SAME_ROOT');assert.equal(after.scheduler.lastFailureCode,'BLOCKED_REQUIRES_REASSESSMENT');assert.equal(after.lifecycleState,'BLOCKED');
 }finally{store.close();fs.rmSync(home,{recursive:true});}
});
