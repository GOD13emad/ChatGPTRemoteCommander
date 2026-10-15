// Explicit opt-in, isolated real local-model automatic read fixture.
// Requires RC_LOCAL_SCRIPT, RC_LOCAL_ADAPTER, --live. Never changes installed Core.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createWorkflowTools } from '../src/workflow-tools.mjs';
import { applyProjectRunnerConfig } from '../src/project-runner-config.mjs';
import { validateJsonSchema } from '../src/schema-validator.mjs';
import { readText } from '../src/tools-v0.3.mjs';
import { WORK_CREDIT_POLICY } from '../src/no-work-credit-policy.mjs';

if (process.argv.slice(2).join(' ') !== '--live' || process.platform !== 'linux')
  throw new Error('EXPLICIT_LINUX_LIVE_ONLY');
const launcher=process.env.RC_LOCAL_SCRIPT;
const adapter=process.env.RC_LOCAL_ADAPTER;
if (!launcher || !adapter) throw new Error('LOCAL_ADAPTER_PATH_REQUIRED');
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const homeTmp=fs.realpathSync.native(os.tmpdir());
const root=fs.realpathSync.native(fs.mkdtempSync(path.join(homeTmp,'rc-local-autonomous-')));
const filename='inspection.txt';
const original='RC_SYNTHETIC_READ_ONLY_FIXTURE=R1\nThe file is already accepted. No writes are permitted.\n';
const expected=createHash('sha256').update(original).digest('hex');
fs.writeFileSync(path.join(root,filename),original,{flag:'wx',mode:0o600});
const raw={
  allowedRoots:[root],
  powerMode:{enabled:true,fullFilesystem:true},
  capabilityProfile:{tier:'FULL_POWER',explicitlyAuthorized:true,disabledCapabilities:[]},
  durableWorkflows:{
    enabled:true,directory:path.join(root,'state'),
    executionTools:['read_text'],
    scheduler:{enabled:true,intervalMs:60000,maxConcurrentProjects:1,oneWriterPerRoot:true},
    runner:{
      enabled:true,autoTick:true,allowedTools:['read_text'],
      maxActions:2,maxPlannerCalls:3,maxDurationMs:60000,
      worker:{enabled:false},
      provider:{
        kind:'command',executable:'/bin/sh',args:[launcher],
        model:'rc-qwen3-4b:q4km',timeoutMs:30000,maxOutputBytes:4096,
        localOnly:true,creditPolicy:WORK_CREDIT_POLICY,
        endpoint:'http://127.0.0.1:18080/v1/chat/completions',
        scriptSha256:sha(launcher),adapterFile:adapter,adapterSha256:sha(adapter)
      }
    }
  }
};
let api;
let attempts=0,actualToolCalls=0;
const definition={name:'read_text',description:'Only the explicitly authorized synthetic inspection.txt in this temporary root, no other paths.',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}};
try{
  const selected=applyProjectRunnerConfig(raw,{platform:'linux'});
  if(selected.status!=='PRESERVED_EXPLICIT_NON_CODEX_PROVIDER'||selected.config.durableWorkflows.runner.autoTick!==true)
    throw new Error('LOCAL_RUNNER_ADMISSION_FAILED:'+selected.status);
  const config=selected.config;
  api=createWorkflowTools({
    config,roots:[root],device:'isolated-local-runner',
    configSha256:'e'.repeat(64),
    validateSchema:validateJsonSchema,
    lookup:name=>name==='read_text'?definition:undefined,
    dispatch:async(name,args)=>{
      actualToolCalls++;
      if(name!=='read_text'||args?.path!==filename)throw new Error('UNAUTHORIZED_TOOL_OR_PATH');
      return readText({config,roots:[root],auditLog:path.join(root,'audit.jsonl')},args);
    }
  });
  const wf=await api.execute('workflow_create',{
    id:'autolocal-read',root,goal:'Read only inspection.txt using exactly one permitted read_text request; never edit files.',
    acceptance:['The original inspection.txt SHA-256 is unchanged and independently verified.'],
    steps:[{id:'inspect',title:'Use read_text with path inspection.txt; no other action or tool is authorized.'}]
  });
  await api.execute('workflow_run_start',{
    id:'autolocal-read',runId:'autolocal-run',expectedRevision:wf.state.revision,
    checks:[{criterion:0,type:'file_sha256',path:filename,sha256:expected}]
  });
  for(let i=0;i<4;i++){
    attempts++;
    const t=await api.execute('workflow_scheduler_tick',{});
    const status=await api.execute('workflow_run_status',{runId:'autolocal-run'});
    if(status.status==='COMPLETED')break;
    if(status.status==='BLOCKED'||status.status==='FAILED')break;
  }
  const final=await api.execute('workflow_run_status',{runId:'autolocal-run'});
  const after=sha(path.join(root,filename));
  const success=final.status==='COMPLETED'&&after===expected&&actualToolCalls===1;
  console.log(JSON.stringify({result:success?'LOCAL_AUTOTICK_READ_PASS':'LOCAL_AUTOTICK_READ_UNPROVEN',
    status:final.status,lastCode:final.lastCode??null,attempts,actualToolCalls,fixtureUnchanged:after===expected,
    model:'Qwen3-4B',network:'loopback-model-only',workCredits:'NO_WORK_CALLS_FROM_THIS_FIXTURE',
    productionDeployment:false}));
  if(!success)process.exitCode=1;
}catch(e){
  console.error(JSON.stringify({result:'LOCAL_AUTOTICK_FAILED',code:e?.code||e?.workflowCode||e?.projectCode||e?.message||'UNKNOWN'}));
  process.exitCode=1;
}finally{
  await api?.close();
  if(path.dirname(root)===homeTmp&&path.basename(root).startsWith('rc-local-autonomous-'))fs.rmSync(root,{recursive:true,force:true});
}
