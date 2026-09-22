// Isolated qualification, never installs or changes a running Commander service.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkflowTools } from '../../src/workflow-tools.mjs';
import { createCommandPlanner } from '../../src/project-planner.mjs';
import { validateJsonSchema } from '../../src/schema-validator.mjs';
import { readText, writeText } from '../../src/tools-v0.3.mjs';

const live=process.argv.includes('--codex');
if(process.argv.slice(2).some(x=>x!=='--codex'))throw new Error('Usage: node examples/project-engine/run.mjs [--codex]');
const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-project-demo-')));
const expected='Verified by the independent project engine.';
const definitions={
  write_text:{name:'write_text',description:'Write the requested UTF-8 artifact in this isolated project.',inputSchema:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content'],additionalProperties:false}},
  read_text:{name:'read_text',description:'Read a UTF-8 project file.',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}
};
const planner=live?createCommandPlanner({kind:'codex',executable:process.env.RC_CODEX_EXECUTABLE||'codex',timeoutMs:60000}):{
  describe:()=>({kind:'deterministic-fixture'}),
  plan:async()=>({action:'call',tool:'write_text',argumentsJson:JSON.stringify({path:'result.txt',content:expected}),summary:'Write the specified artifact.'})
};
const config={allowedRoots:[root],maxReadBytes:524288,maxWriteBytes:524288,
  durableWorkflows:{enabled:true,directory:path.join(root,'private-state'),executionTools:['write_text','read_text'],
    runner:{enabled:true,allowedTools:['write_text','read_text'],maxActions:2,maxDurationMs:120000}}};
const ctx={config,roots:[root],auditLog:path.join(root,'audit.jsonl')};
let api;
try {
  api=createWorkflowTools({config,roots:[root],device:'isolated-qualification',configSha256:'0'.repeat(64),planner,
    lookup:name=>definitions[name],validateSchema:validateJsonSchema,
    dispatch:(name,args)=>name==='write_text'?writeText(ctx,args):readText(ctx,args)});
  const created=await api.execute('workflow_create',{id:'qualification',root,
    goal:'Create result.txt containing exactly: '+expected,
    acceptance:['The artifact contains the requested text.'],steps:[{id:'artifact',title:'Write result.txt with the exact requested sentence'}]});
  await api.execute('workflow_run_start',{id:'qualification',runId:'qualification-run',expectedRevision:created.state.revision,
    checks:[{criterion:0,type:'text_includes',path:'result.txt',text:expected}]});
  const execution=await api.execute('workflow_run_tick',{runId:'qualification-run'});
  const completion=await api.execute('workflow_run_tick',{runId:'qualification-run'});
  const output={provider:live?'codex':'fixture',execution:execution.status,completion,
    artifactVerified:fs.existsSync(path.join(root,'result.txt'))&&fs.readFileSync(path.join(root,'result.txt'),'utf8')===expected,
    brainCreated:fs.existsSync(path.join(root,'PROJECT_BRAIN.md'))};
  console.log(JSON.stringify(output,null,2));
  if(completion.status!=='COMPLETED'||!output.artifactVerified||!output.brainCreated)process.exitCode=1;
} catch(error) {
  console.error(JSON.stringify({status:'QUALIFICATION_FAILED',code:error.projectCode??error.workflowCode??error.code??'ERROR'}));process.exitCode=1;
} finally {
  await api?.close();
  const temp=fs.realpathSync.native(os.tmpdir());
  if(path.dirname(root)!==temp||!path.basename(root).startsWith('rc-project-demo-'))throw new Error('Cleanup scope mismatch');
  fs.rmSync(root,{recursive:true,force:true});
}
