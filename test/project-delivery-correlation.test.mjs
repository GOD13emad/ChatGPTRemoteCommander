import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkflowTools } from '../src/workflow-tools.mjs';
import { validateJsonSchema } from '../src/schema-validator.mjs';

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
      checks:[{criterion:0,type:'exists',path:'evidence.txt'}]
    });
    assert.equal(started.correlationId,'chat-a');
    assert.equal((await api.execute('workflow_run_status',{runId:'run-one'})).correlationId,'chat-a');
    await assert.rejects(
      api.execute('workflow_run_start',{
        id:'project',runId:'bad',correlationId:'bad space',expectedRevision:state.revision,
        checks:[{criterion:0,type:'exists',path:'evidence.txt'}]
      }),
      /PROJECT_CORRELATION_ID_INVALID|schema validation failed/i
    );
  } finally {
    await api.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
});
