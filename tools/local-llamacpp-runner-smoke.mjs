// Isolated, reproducible ProjectEngine + TeamPlanner live smoke.
// Runs only on disposable synthetic file/journal; never enrolls a real project.
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createCommandPlanner} from '../src/project-planner.mjs';
import {createTeamPlanner} from '../src/project-team.mjs';
import {createProjectEngine} from '../src/project-engine.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const MARKER='SYNTHETIC_QA_BRIDGE_MMZ_LOCAL_ENGINE';
const RESULT_VERSION=1;

export async function runLocalPlannerE2e({basePlanner}={}){
 const root=mkdtempSync(path.join(os.tmpdir(),'rc-llama-qa-'));
 const filename=path.join(root,'PROJECT_BRAIN.md');
 writeFileSync(filename,'# '+MARKER+'\nDisposable QA only; no actual user project data.\n');
 const before=digest(readFileSync(filename));
 let reads=0,finalizations=0,engine;
 const workflow={
  id:'qa_local_llama_bridge',root,device:os.hostname(),
  goal:'Synthetic QA only. Use read_text exactly for PROJECT_BRAIN.md with argumentsJson {"path":"PROJECT_BRAIN.md"}. Never call other tools or edit files.',
  acceptance:['Disposable PROJECT_BRAIN.md contains synthetic marker.'],
  authority:{profileId:'qa_readonly',tier:'READ_ONLY',capabilities:['read_text']},
  executionProfile:{fallbackPolicy:'allow-any'},control:{intent:'ACTIVE'},
  lifecycleState:'ACTIVE',revision:1,notes:[],
  steps:[{id:'inspect_brain',title:'Use read_text with exactly path PROJECT_BRAIN.md',dependsOn:[],status:'pending'}]
 };
 const execute=async(name,args)=>{
  if(name==='workflow_get')return {state:workflow};
  if(name==='workflow_resume')return {
   state:workflow,blockers:[],readyForNextStep:true,
   nextStep:workflow.steps.find(s=>s.status==='pending'),
   nextAction:'Call read_text with relative path PROJECT_BRAIN.md only'
  };
  if(name==='workflow_call'){
   if(args.tool!=='read_text'||args.arguments?.path!=='PROJECT_BRAIN.md'||
      Object.keys(args.arguments).length!==1)throw Error('QA_DISPATCH_DENIED');
   if(!readFileSync(filename,'utf8').includes(MARKER))throw Error('QA_SOURCE_CHANGED');
   reads++;workflow.steps[0].status='verified';workflow.revision++;
   return {outcome:'EXECUTED',operation:{operationId:'qa-read-only-1'}};
  }
  if(name==='workflow_finalize'){
   if(!args.acceptanceResults?.every(Boolean)||workflow.steps[0].status!=='verified')
     throw Error('QA_FINALIZE_DENIED');
   workflow.lifecycleState='COMPLETED';workflow.revision++;finalizations++;
   return {state:workflow,brainSync:{ok:true,mode:'disposable-qa'}};
  }
  throw Error('QA_TOOL_NOT_ALLOWED');
 };
 try{
  const base=basePlanner??createCommandPlanner({
   kind:'command',executable:process.execPath,
   args:[fileURLToPath(new URL('./local-llamacpp-planner.mjs',import.meta.url))],
   timeoutMs:30000,maxOutputBytes:4096
  });
  const team=createTeamPlanner({planner:base,workers:[
   {id:'builder',role:'Propose only read_text with exactly {"path":"PROJECT_BRAIN.md"}.'},
   {id:'reviewer',role:'Verify exact tool read_text and exact path PROJECT_BRAIN.md; reject anything else.'}
  ],maxParallel:1});
  engine=createProjectEngine({directory:path.join(root,'journal'),planner:team,execute,
   lookup:name=>name==='read_text'?{name:'read_text',description:'Read only PROJECT_BRAIN.md',
    inputSchema:{type:'object',additionalProperties:false,required:['path'],
     properties:{path:{type:'string'}}}}:null,
   policy:{allowedTools:['read_text'],maxActions:1,maxPlannerCalls:3,maxDurationMs:120000,
    adaptive:{enabled:false},worker:{enabled:false}}
  });
  const checks=[{criterion:0,type:'text_includes',path:'PROJECT_BRAIN.md',text:MARKER}];
  const started=await engine.start({
   runId:'qa_local_llama_bridge_1',id:workflow.id,expectedRevision:workflow.revision,
   maxActions:1,maxPlannerCalls:3,durationMs:120000,checks
  });
  const first=await engine.tick(started.runId);
  const second=first.status==='QUEUED'?await engine.tick(started.runId):{status:'NOT_TICKED'};
  const unchanged=before===digest(readFileSync(filename));
  const accepted=first.status==='QUEUED'&&first.lastCode==='PROJECT_STEP_RECORDED'&&
   second.status==='COMPLETED'&&second.lastCode==='PROJECT_ACCEPTANCE_VERIFIED'&&
   reads===1&&finalizations===1&&unchanged&&workflow.lifecycleState==='COMPLETED';
  return {schema:RESULT_VERSION,status:accepted?'PASS':'NOT_ACCEPTED',
   firstStatus:first.status,firstCode:first.lastCode??null,
   finalStatus:second.status,finalCode:second.lastCode??null,
   plannerType:team.describe().kind,modelProviderCalls:team.describe().callsPerPlan,
   realReadOnlyToolExecutions:reads,fixtureUnmodified:unchanged,
   finished:workflow.lifecycleState==='COMPLETED',
   actualProjectTouched:false};
 }finally{
  try{await engine?.close();}finally{rmSync(root,{recursive:true,force:true});}
 }
}
async function main(){
 try{
  const result=await runLocalPlannerE2e();
  process.stdout.write(JSON.stringify(result)+'\n');
  if(result.status!=='PASS')process.exitCode=2;
 }catch(e){
  process.stdout.write(JSON.stringify({schema:RESULT_VERSION,status:'FAILED',
   code:String(e?.projectCode??e?.code??'PROJECT_QA_FAILED').slice(0,100),
   actualProjectTouched:false})+'\n');
  process.exitCode=3;
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
