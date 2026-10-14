// Explicit Linux-only two-step native Qwen3/Commander read-only Workflow E2E.
// One unique synthetic temp root, no write/shell tools, no stable runner enrollment.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createWorkflowTools} from '../../src/workflow-tools.mjs';
import {createCommandPlanner} from '../../src/project-planner.mjs';
import {validateJsonSchema} from '../../src/schema-validator.mjs';
import {readText} from '../../src/tools-v0.3.mjs';

if(process.platform!=='linux'||process.argv.slice(2).join(' ')!=='--live'){
  process.stderr.write('EXPLICIT_LINUX_LIVE_FLAG_REQUIRED\n');
  process.exit(2);
}
const sha = value => createHash('sha256').update(value).digest('hex');
const temp = fs.realpathSync.native(os.tmpdir());
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(temp,'rc-mmz-tworead-')));
const firstName='requirements.txt';
const secondName='evidence.txt';
const firstText='SYNTHETIC_PROJECT=MMZ-AUTHORIZED-READ\nREVIEW_MODE=READ_ONLY\nEVIDENCE_FILE=evidence.txt\n';
const secondText='SYNTHETIC_EVIDENCE=MMZ-TWO-STEP-PASS\nVERIFICATION=READ_TEXT_ONLY\n';
const files=new Map([[firstName,firstText],[secondName,secondText]]);
const expected=new Map([...files].map(([name,text])=>[name,sha(text)]));
for(const [name,value] of files)fs.writeFileSync(path.join(root,name),value,{flag:'wx',mode:0o600});
const config={
  allowedRoots:[root],maxReadBytes:8192,maxWriteBytes:8192,
  durableWorkflows:{
    enabled:true,directory:path.join(root,'state'),executionTools:['read_text'],
    runner:{enabled:true,autoTick:false,allowedTools:['read_text'],
      maxActions:2,maxPlannerCalls:2,maxDurationMs:120000}
  }
};
let api, created=false, eventError=null;
let plannerCalls=0, observations=0, priorObservationVerified=false;
const dispatched=[];
try {
  const script=path.join(path.dirname(fileURLToPath(import.meta.url)),'linux-local-qwen3.sh');
  const basePlanner=createCommandPlanner({
    kind:'command',executable:'/bin/sh',args:[script],timeoutMs:30000,
    maxOutputBytes:4096,model:'rc-qwen3-4b:q4km'
  });
  const planner={
    describe:()=>basePlanner.describe(),
    plan:async(ctx,options)=>{
      plannerCalls++;
      if(plannerCalls===2){
        priorObservationVerified=ctx.observations?.length===1
          &&ctx.observations[0].stepId==='requirements'
          &&ctx.observations[0].tool==='read_text'
          &&ctx.observations[0].result?.sha256===expected.get(firstName)
          &&ctx.observations[0].result?.text===firstText;
        if(!priorObservationVerified)throw new Error('PRIOR_OBSERVATION_NOT_VERIFIED');
      }
      return basePlanner.plan(ctx,options);
    }
  };
  const definition={
    name:'read_text',
    description:'Read exactly one explicitly authorized synthetic file, first requirements.txt then evidence.txt. No writes. Both files exist.',
    inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}
  };
  const context={roots:[root],config,auditLog:path.join(root,'audit.jsonl')};
  api=createWorkflowTools({
    config,roots:[root],device:'mmz-linux-tworead-fixture',
    configSha256:'7'.repeat(64),planner,validateSchema:validateJsonSchema,
    lookup:name=>name==='read_text'?definition:undefined,
    dispatch:async(tool,args)=>{
      // The engine performs a bounded re-observation of the prior read before
      // requesting the second plan. Re-observation is not a new model action.
      const isReplay=plannerCalls===1&&dispatched.length===1&&args.path===firstName;
      const expectedName=isReplay?firstName
        :plannerCalls===1&&dispatched.length===0?firstName
        :plannerCalls===2&&dispatched.length===1?secondName:null;
      if(tool!=='read_text'||args.path!==expectedName){
        eventError='UNAUTHORIZED_PATH_OR_ORDER';
        throw new Error(eventError);
      }
      const answer=await readText(context,args);
      const same=answer.text===files.get(expectedName)
        &&answer.sha256===expected.get(expectedName)
        &&answer.truncated===false;
      if(isReplay)observations++;
      else dispatched.push({name:expectedName,sha256:answer.sha256,contentVerified:same});
      if(!same){
        eventError='READ_RECEIPT_CONTENT_MISMATCH';
        throw new Error(eventError);
      }
      return answer;
    }
  });
  const workflow=await api.execute('workflow_create',{
    id:'mmz-two-step-read-only',root,
    goal:'Inspect two synthetic files using the ONLY authorized read_text tool. First read requirements.txt, then after its receipt read evidence.txt. No write or shell actions are permitted.',
    acceptance:[
      'Synthetic requirements.txt is unchanged after a recorded read-only call.',
      'Synthetic evidence.txt is unchanged after a second recorded read-only call.'
    ],
    steps:[
      {id:'requirements',title:'Call only read_text with {"path":"requirements.txt"}. This is an authorized isolated read; do not block or use any other tool.'},
      {id:'evidence',title:'After the requirements step is recorded, call only read_text with {"path":"evidence.txt"}; no write or shell actions.',dependsOn:['requirements']}
    ]
  });
  created=true;
  await api.execute('workflow_run_start',{
    id:'mmz-two-step-read-only',runId:'mmz-two-step-read-run',
    expectedRevision:workflow.state.revision,maxActions:2,maxPlannerCalls:2,durationMs:120000,
    checks:[
      {criterion:0,type:'file_sha256',path:firstName,sha256:expected.get(firstName)},
      {criterion:1,type:'file_sha256',path:secondName,sha256:expected.get(secondName)}
    ]
  });
  const start=performance.now();
  const ticks=[];
  for(let n=0;n<3;n++){
    const step=await api.execute('workflow_run_tick',{runId:'mmz-two-step-read-run'});
    ticks.push({status:step?.status??null,code:step?.lastCode??null});
    if(step?.status!=='QUEUED')break;
  }
  const recorded=await api.execute('workflow_run_status',{runId:'mmz-two-step-read-run'});
  const final=await api.execute('workflow_get',{id:'mmz-two-step-read-only'});
  const unchanged=[...files].every(([name,value])=>fs.readFileSync(path.join(root,name),'utf8')===value);
  const statusOk=ticks.length===3&&ticks[0].status==='QUEUED'&&ticks[0].code==='PROJECT_STEP_RECORDED'
    &&ticks[1].status==='QUEUED'&&ticks[1].code==='PROJECT_STEP_RECORDED'
    &&ticks[2].status==='COMPLETED'&&recorded?.status==='COMPLETED'
    &&final?.state?.lifecycleState==='COMPLETED';
  const bothStepsVerified=final?.state?.steps?.length===2
    &&final.state.steps.every(step=>step.status==='verified');
  const pass=statusOk&&bothStepsVerified&&dispatched.length===2
    &&dispatched.every(x=>x.contentVerified)&&unchanged&&!eventError
    &&plannerCalls===2&&observations===1&&priorObservationVerified;
  process.stdout.write(JSON.stringify({
    result:pass?'NATIVE_TWO_STEP_READ_E2E_PASS':'NATIVE_TWO_STEP_READ_E2E_UNPROVEN',
    ticks,recorded:recorded?.status??null,
    workflowLifecycle:final?.state?.lifecycleState??null,
    steps:final?.state?.steps?.map(step=>({id:step.id,status:step.status})),
    reads:dispatched,readCount:dispatched.length,plannerCalls,
    priorObservationCount:observations,priorObservationVerified,
    contentVerified:dispatched.every(x=>x.contentVerified),unchanged,
    internalError:eventError,elapsedMs:Math.round(performance.now()-start),
    autoTick:false,model:'rc-qwen3-4b:q4km'
  })+'\n');
  if(!pass)process.exitCode=1;
}catch(error){
  process.stderr.write(JSON.stringify({
    result:'NATIVE_TWO_STEP_READ_E2E_ERROR',
    stage:created?'run':'setup',
    code:error?.workflowCode??error?.projectCode??error?.code??'UNKNOWN'
  })+'\n');
  process.exitCode=1;
}finally{
  await api?.close();
  if(path.dirname(root)===temp&&path.basename(root).startsWith('rc-mmz-tworead-'))
    fs.rmSync(root,{recursive:true,force:true});
  else{process.stderr.write('TEMP_OWNERSHIP_MISMATCH\n');process.exitCode=1;}
}
