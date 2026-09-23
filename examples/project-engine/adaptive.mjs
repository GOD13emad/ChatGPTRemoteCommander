// Deterministic, isolated team + adaptive plan qualification. No live service use.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createWorkflowTools} from '../../src/workflow-tools.mjs';
import {validateJsonSchema} from '../../src/schema-validator.mjs';
import {readText,writeText} from '../../src/tools-v0.3.mjs';

const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-adaptive-demo-')));
const expected='Approved artifact from the observed source.';
fs.writeFileSync(path.join(root,'source.txt'),expected);
const definitions={
  read_text:{name:'read_text',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}},
  write_text:{name:'write_text',inputSchema:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content'],additionalProperties:false}}
};
const propose=(action,tool,args,summary)=>({action,tool,argumentsJson:JSON.stringify(args),summary});
const calls=[];
const planner={describe:()=>({kind:'deterministic-fixture'}),plan:async context=>{
  calls.push({phase:context.collaboration.phase,id:context.collaboration.id,step:context.currentStep.id});
  if(context.collaboration.phase==='coordinator') {
    assert.equal(context.collaboration.workerProposals.length,2);
    return context.collaboration.workerProposals[0].proposal;
  }
  if(!context.steps.some(s=>s.id==='inspect'))return propose('extend','',{
    steps:[{id:'inspect',title:'Read source.txt before producing the artifact'}],reason:'The artifact needs source evidence.'
  },'Insert the missing source inspection.');
  if(context.currentStep.id==='inspect')return propose('call','read_text',{path:'source.txt'},'Inspect the source.');
  assert.equal(context.observations.length,1);
  const text=context.observations[0].result.text;
  assert.equal(text,expected);
  return propose('call','write_text',{path:'result.txt',content:text},'Write the artifact from current evidence.');
}};
const config={allowedRoots:[root],maxReadBytes:524288,maxWriteBytes:524288,
  durableWorkflows:{enabled:true,directory:path.join(root,'private'),executionTools:['read_text','write_text'],runner:{
    enabled:true,allowedTools:['read_text','write_text'],maxActions:3,maxPlannerCalls:9,maxDurationMs:60000,
    adaptive:{enabled:true,maxExtensions:1},team:{workers:[{id:'builder',role:'Propose the next bounded step.'},{id:'reviewer',role:'Review evidence and missing prerequisites.'}],maxParallel:2}
  }}};
const ctx={config,roots:[root],auditLog:path.join(root,'audit.jsonl')};
let api;
try {
  api=createWorkflowTools({config,roots:[root],device:'isolated-adaptive-qualification',configSha256:'1'.repeat(64),
    planner,lookup:n=>definitions[n],validateSchema:validateJsonSchema,
    dispatch:(name,args)=>name==='read_text'?readText(ctx,args):writeText(ctx,args)});
  const created=await api.execute('workflow_create',{id:'adaptive',root,goal:'Read source.txt and create an identical result.txt.',
    acceptance:['Result matches the approved source.'],steps:[{id:'deliver',title:'Create result.txt from source evidence'}]});
  await api.execute('workflow_run_start',{id:'adaptive',runId:'adaptive-run',expectedRevision:created.state.revision,
    checks:[{criterion:0,type:'text_includes',path:'result.txt',text:expected}]});
  const ticks=[];
  for(let i=0;i<4;i++)ticks.push(await api.execute('workflow_run_tick',{runId:'adaptive-run'}));
  const run=ticks.at(-1),state=(await api.execute('workflow_get',{id:'adaptive'})).state;
  assert.equal(run.status,'COMPLETED',JSON.stringify(ticks.map(t=>({status:t.status,code:t.lastCode,reason:t.reason}))));
  assert.equal(run.extensions,1);assert.equal(run.plannerCalls,9);
  assert.equal(calls.length,9);assert.equal(fs.readFileSync(path.join(root,'result.txt'),'utf8'),expected);
  console.log(JSON.stringify({status:run.status,provider:'deterministic-fixture',steps:state.steps.map(s=>({id:s.id,status:s.status})),
    extensions:run.extensions,attempts:run.attempts,providerCallsReserved:run.plannerCalls,providerCallsObserved:calls.length,
    coordinatorCalls:calls.filter(c=>c.phase==='coordinator').length,artifactVerified:true,brainCreated:fs.existsSync(path.join(root,'PROJECT_BRAIN.md'))},null,2));
} finally {
  await api?.close();
  if(path.dirname(root)!==fs.realpathSync.native(os.tmpdir())||!path.basename(root).startsWith('rc-adaptive-demo-'))throw new Error('Cleanup scope mismatch');
  fs.rmSync(root,{recursive:true,force:true});
}
