import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkflowTools } from '../src/workflow-tools.mjs';
import { validateJsonSchema } from '../src/schema-validator.mjs';
import { listDirectory,readText,writeText } from '../src/tools-v0.3.mjs';

const proposal=(tool,args)=>({action:'call',tool,argumentsJson:JSON.stringify(args),summary:'Perform the approved step'});
const definitions={
  write_text:{name:'write_text',inputSchema:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content'],additionalProperties:false}},
  read_text:{name:'read_text',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}},
  list_directory:{name:'list_directory',inputSchema:{type:'object',properties:{path:{type:'string'}},additionalProperties:false}}
};
function fixture(planner,extra={}) {
  const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-engine-')));
  const config={allowedRoots:[root],maxWriteBytes:524288,maxReadBytes:524288,auditLog:path.join(root,'audit.jsonl'),
    durableWorkflows:{enabled:true,directory:path.join(root,'state'),executionTools:['write_text','read_text','list_directory'],
      runner:{enabled:true,allowedTools:['write_text','read_text','list_directory'],maxActions:10,maxDurationMs:30000,...extra.runner}}};
  const ctx={config,roots:[root],auditLog:config.auditLog};
  let calls=0;
  const options={config,roots:[root],device:'fixture',configSha256:'1'.repeat(64),lookup:n=>definitions[n],validateSchema:validateJsonSchema,
    planner:{plan:planner,describe:()=>({kind:'fixture'})},
    dispatch:async(tool,args)=>{calls++;if(extra.dispatch)return extra.dispatch(tool,args,ctx);
      if(tool==='write_text')return writeText(ctx,args);
      if(tool==='read_text')return readText(ctx,args);
      if(tool==='list_directory')return listDirectory(ctx,args);
      throw new Error('unexpected dispatch');}};
  let api=createWorkflowTools(options);
  return {root,get api(){return api;},get calls(){return calls;},options,
    async create(steps=[{id:'write',title:'Create result.txt with verified output'}]) {
      return api.execute('workflow_create',{id:'project',root,goal:'Produce a verified artifact',acceptance:['Artifact contains approved text'],steps});
    },
    async start(extra={}){const state=(await api.execute('workflow_get',{id:'project'})).state;return api.execute('workflow_run_start',{
      id:'project',runId:'run-one',expectedRevision:state.revision,checks:[{criterion:0,type:'text_includes',path:'result.txt',text:'verified output'}],...extra});},
    tick:()=>api.execute('workflow_run_tick',{runId:'run-one'}),
    async reopen(){await api.close();api=createWorkflowTools(options);},
    async dispose(){await api.close();fs.rmSync(root,{recursive:true,force:true});}
  };
}

test('real filesystem operation is journaled and independent evidence finalizes with Brain',async()=>{
  const f=fixture(async()=>proposal('write_text',{path:'result.txt',content:'verified output'}));
  try{await f.create();await f.start();const first=await f.tick();assert.equal(first.status,'QUEUED');assert.equal(f.calls,1);
    const final=await f.tick();assert.equal(final.status,'COMPLETED');assert.equal(final.attempts,1);
    const state=(await f.api.execute('workflow_get',{id:'project'})).state;
    assert.equal(state.lifecycleState,'COMPLETED');assert.equal(state.finalization.acceptanceResults[0],true);
    assert.ok(fs.readFileSync(path.join(f.root,'PROJECT_BRAIN.md'),'utf8').includes('COMPLETED'));
    assert.equal((await f.api.execute('workflow_operations',{id:'project'})).operations.length,1);
  }finally{await f.dispose();}
});
test('all criteria must be independently covered before enrollment',async()=>{
  const f=fixture(async()=>{throw new Error('must not plan');});try{await f.create();await assert.rejects(f.start({checks:[]}),/COVERAGE/);assert.equal(f.calls,0);}finally{await f.dispose();}
});
test('model success claim does not override failing acceptance evidence',async()=>{
  const f=fixture(async()=>({...proposal('write_text',{path:'result.txt',content:'wrong'}),summary:'Everything is complete and passed'}));
  try{await f.create();await f.start();await f.tick();const r=await f.tick();assert.equal(r.status,'BLOCKED');assert.equal(r.lastCode,'PROJECT_ACCEPTANCE_FAILED');
    assert.notEqual((await f.api.execute('workflow_get',{id:'project'})).state.lifecycleState,'COMPLETED');}finally{await f.dispose();}
});
for(const [name,value,code] of [
  ['unknown tool',proposal('run_shell',{command:'anything'}),'PROJECT_TOOL_NOT_ALLOWED'],
  ['invalid schema',proposal('write_text',{path:'result.txt'}),'PROJECT_ARGUMENTS_INVALID'],
  ['malformed proposal',{action:'call'},'PROJECT_PROPOSAL_INVALID'],
  ['prototype key',proposal('write_text',JSON.parse('{"path":"result.txt","content":"x","__proto__":{}}')),'PROJECT_ARGUMENTS_INVALID']
])test(name+' performs zero effects',async()=>{
  const f=fixture(async()=>value);try{await f.create();await f.start();const r=await f.tick();assert.equal(r.status,'BLOCKED');assert.equal(r.lastCode,code);assert.equal(f.calls,0);}finally{await f.dispose();}
});
test('pause while planner is waiting prevents dispatch; resume preserves budget',async()=>{
  let release,entered;const waiting=new Promise(r=>entered=r);
  const f=fixture(async()=>{entered();return new Promise(r=>release=r);});
  try{await f.create();await f.start();const pending=f.tick();await waiting;
    const s=(await f.api.execute('workflow_get',{id:'project'})).state;
    await f.api.execute('workflow_control',{id:'project',expectedRevision:s.revision,action:'pause',reason:'User paused'});
    release(proposal('write_text',{path:'result.txt',content:'verified output'}));
    const result=await pending;assert.equal(result.status,'PAUSED');assert.equal(f.calls,0);assert.equal(result.attempts,1);
  }finally{await f.dispose();}
});
test('changed goal during planning fences the old proposal',async()=>{
  let release,entered;const waiting=new Promise(r=>entered=r);const f=fixture(async()=>{entered();return new Promise(r=>release=r);});
  try{await f.create();await f.start();const pending=f.tick();await waiting;const s=(await f.api.execute('workflow_get',{id:'project'})).state;
    await f.api.execute('workflow_revise',{id:'project',expectedRevision:s.revision,goal:'Different request',reason:'User revised'});
    release(proposal('write_text',{path:'result.txt',content:'verified output'}));assert.equal((await pending).lastCode,'PROJECT_SCOPE_CHANGED');assert.equal(f.calls,0);
  }finally{await f.dispose();}
});
test('restart and duplicate enrollment do not reset reserved planner budget',async()=>{
  let plans=0;const f=fixture(async()=>{plans++;return proposal('read_text',{path:'source.txt'});});
  try{fs.writeFileSync(path.join(f.root,'source.txt'),'source');await f.create([{id:'a',title:'Read source'},{id:'b',title:'Read again'}]);await f.start({maxActions:1});
    await f.tick();await f.reopen();await f.start({maxActions:10});const r=await f.tick();assert.equal(r.status,'EXHAUSTED');assert.equal(r.attempts,1);assert.equal(plans,1);
  }finally{await f.dispose();}
});
test('two engine instances cannot plan or dispatch concurrently',async()=>{
  let release,entered;const waiting=new Promise(r=>entered=r);const f=fixture(async()=>{entered();return new Promise(r=>release=r);});let second;
  try{await f.create();await f.start();second=createWorkflowTools(f.options);const pending=f.tick();await waiting;
    const other=await second.execute('workflow_run_tick',{runId:'run-one'});assert.equal(other.skipped,true);
    release(proposal('write_text',{path:'result.txt',content:'verified output'}));await pending;assert.equal(f.calls,1);
  }finally{await second?.close();await f.dispose();}
});
test('uncertain mutation blocks continuation and is never automatically replayed',async()=>{
  const f=fixture(async()=>proposal('write_text',{path:'result.txt',content:'verified output'}),{dispatch:async(t,a)=>{fs.writeFileSync(path.join(f.root,a.path),a.content);throw new Error('lost receipt');}});
  try{await f.create();await f.start();const r=await f.tick();assert.equal(r.lastCode,'PROJECT_EFFECT_UNCERTAIN');await f.reopen();const again=await f.tick();assert.equal(again.skipped,true);assert.equal(f.calls,1);
  }finally{await f.dispose();}
});
test('runner status is opt-in and existing recovery-only tool catalog is unchanged',async()=>{
  const f=fixture(async()=>proposal('read_text',{path:'x'}));let legacy;
  try{const opts={...f.options,config:{...f.options.config,durableWorkflows:{...f.options.config.durableWorkflows,directory:path.join(f.root,'legacy'),runner:{enabled:false}}}};
    legacy=createWorkflowTools(opts);assert.equal(legacy.definitions.length,17);assert.equal(f.api.definitions.length,20);
    const disabled=await legacy.execute('workflow_status',{});assert.equal(disabled.runnerConfigured,false);assert.equal(disabled.automaticExecution,false);
    const enabled=await f.api.execute('workflow_status',{});assert.equal(enabled.runnerConfigured,true);assert.equal(enabled.automaticExecution,false);
  }finally{await legacy?.close();await f.dispose();}
});
