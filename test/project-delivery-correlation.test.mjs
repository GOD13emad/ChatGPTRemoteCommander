import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkflowTools } from '../src/workflow-tools.mjs';
import { validateJsonSchema } from '../src/schema-validator.mjs';
import { DeliveryStore } from '../src/delivery-store.mjs';

test('project run persists caller correlation id and rejects invalid correlation', async () => {
  const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-project-corr-')));
  const config={
    allowedRoots:[root],
    durableWorkflows:{
      enabled:true,directory:path.join(root,'state'),executionTools:['read_text'],
      runner:{enabled:true,allowedTools:['read_text'],maxActions:2,maxDurationMs:5000}
    }
  };
  const definition={name:'read_text',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}};
  const api=createWorkflowTools({
    config,roots:[root],device:'fixture',configSha256:'1'.repeat(64),
    lookup:name=>name==='read_text'?definition:null,
    validateSchema:validateJsonSchema,
    planner:{describe:()=>({kind:'fixture',available:true,callsPerPlan:1}),plan:async()=>({action:'block',tool:'',argumentsJson:'{}',summary:'stop'})},
    dispatch:async()=>({})
  });
  try{
    const created=await api.execute('workflow_create',{
      id:'project',root,goal:'Persist correlation',acceptance:['Evidence exists'],
      steps:[{id:'step',title:'Inspect evidence'}]
    });
    const state=(await api.execute('workflow_get',{id:'project'})).state;
    const started=await api.execute('workflow_run_start',{
      id:'project',runId:'run-one',correlationId:'chat-a',expectedRevision:state.revision,
      checks:[{criterion:0,type:'text_includes',path:'evidence.txt',text:'evidence'}]
    });
    assert.equal(started.correlationId,'chat-a');
    assert.equal((await api.execute('workflow_run_status',{runId:'run-one'})).correlationId,'chat-a');
    await assert.rejects(
      api.execute('workflow_run_start',{
        id:'project',runId:'bad',correlationId:'bad space',expectedRevision:state.revision,
        checks:[{criterion:0,type:'text_includes',path:'evidence.txt',text:'evidence'}]
      }),
      /PROJECT_CORRELATION_ID_INVALID|schema validation failed/i
    );
  } finally {
    await api.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
});


test('WAITING_INPUT and BLOCKED project states become idempotent correlation-scoped deliveries', async () => {
  const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-project-delivery-')));
  const deliveryRoot=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-project-delivery-private-')));
  const deliveryStore=new DeliveryStore({directory:deliveryRoot,scope:'profile-a',forbiddenRoots:[root]});
  let plans=0;
  const config={
    allowedRoots:[root],
    durableWorkflows:{
      enabled:true,directory:path.join(root,'state'),executionTools:['read_text'],
      runner:{enabled:true,allowedTools:['read_text'],maxActions:4,maxDurationMs:10000}
    }
  };
  const definition={name:'read_text',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}};
  const api=createWorkflowTools({
    config,roots:[root],device:'fixture',configSha256:'2'.repeat(64),deliveryStore,
    lookup:name=>name==='read_text'?definition:null,validateSchema:validateJsonSchema,
    planner:{
      describe:()=>({kind:'fixture',available:true,callsPerPlan:1}),
      plan:async()=>++plans===1
        ? {action:'block',tool:'',argumentsJson:JSON.stringify({request:{question:'Choose mode',options:['A','B']}}),summary:'input needed'}
        : {action:'block',tool:'',argumentsJson:'{}',summary:'cannot proceed'}
    },
    dispatch:async()=>({})
  });
  try{
    await api.execute('workflow_create',{
      id:'project',root,goal:'Exercise delivery states',acceptance:['Evidence exists'],
      steps:[{id:'step',title:'Inspect evidence'}]
    });
    const state=(await api.execute('workflow_get',{id:'project'})).state;
    await api.execute('workflow_run_start',{
      id:'project',runId:'run-one',correlationId:'chat-a',expectedRevision:state.revision,
      checks:[{criterion:0,type:'text_includes',path:'evidence.txt',text:'evidence'}]
    });
    const waiting=await api.execute('workflow_run_tick',{runId:'run-one'});
    assert.equal(waiting.status,'WAITING_INPUT');
    let items=deliveryStore.list({correlationId:'chat-a',includeDelivered:true}).items;
    assert.equal(items.length,1);
    assert.equal(items[0].kind,'WAITING_INPUT');
    assert.equal(items[0].sourceId,'run-one');
    assert.equal(deliveryStore.list({correlationId:'chat-b',includeDelivered:true}).items.length,0);
    await api.execute('workflow_run_status',{runId:'run-one'});
    assert.equal(deliveryStore.list({correlationId:'chat-a',includeDelivered:true}).items.length,1);
    assert.throws(
      ()=>deliveryStore.claim({deliveryId:items[0].deliveryId,correlationId:'chat-b',attemptId:'attempt-b'}),
      /DELIVERY_CORRELATION_MISMATCH/
    );
    const workflow=(await api.execute('workflow_get',{id:'project'})).state;
    await api.execute('workflow_run_resolve',{
      runId:'run-one',requestId:waiting.pendingRequest.requestId,expectedRevision:workflow.revision,response:'A'
    });
    const blocked=await api.execute('workflow_run_tick',{runId:'run-one'});
    assert.equal(blocked.status,'BLOCKED');
    items=deliveryStore.list({correlationId:'chat-a',includeDelivered:true}).items;
    assert.equal(items.length,2);
    assert.deepEqual(items.map(x=>x.kind).sort(),['BLOCKED','WAITING_INPUT']);
  } finally {
    await api.close();
    deliveryStore.close();
    fs.rmSync(root,{recursive:true,force:true});
    fs.rmSync(deliveryRoot,{recursive:true,force:true});
  }
});
