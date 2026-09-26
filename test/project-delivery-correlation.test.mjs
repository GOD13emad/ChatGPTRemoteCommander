import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProjectEngine } from '../src/project-engine.mjs';

test('project run persists caller correlation id and rejects invalid correlation', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-project-corr-'));
  const workflow={id:'wf',root,goal:'g',acceptance:['a'],steps:[{id:'s',title:'s'}],authority:{},executionProfile:{},revision:1,lifecycleState:'ACTIVE',control:{intent:'RUN'},notes:[],decisions:[],planExtensions:[]};
  const planner={describe:()=>({available:true,callsPerPlan:1}),plan:async()=>({action:'block',tool:'',argumentsJson:'{}',summary:'stop'})};
  const execute=async(name)=>name==='workflow_get'?{state:workflow}:{};
  const engine=createProjectEngine({directory:path.join(root,'private'),planner,execute,observe:async()=>({}),lookup:()=>null,policy:{allowedTools:['read_text'],maxDurationMs:5000}});
  try{
    const started=await engine.start({runId:'run',correlationId:'chat-a',id:'wf',expectedRevision:1,checks:[{path:'evidence.txt',type:'exists'}]});
    assert.equal(started.correlationId,'chat-a');
    assert.equal(engine.status('run').correlationId,'chat-a');
    await assert.rejects(
      engine.start({runId:'bad',correlationId:'bad space',id:'wf',expectedRevision:1,checks:[{path:'evidence.txt',type:'exists'}]}),
      /PROJECT_CORRELATION_ID_INVALID/
    );
  } finally { engine.close(); fs.rmSync(root,{recursive:true,force:true}); }
});
