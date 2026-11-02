// CoS-style Compact/Resume preview over canonical V1 *observed* WorkflowStore data.
// Never an authority, portable credential, verified chat identity, or automatic resume.
import {createHash} from 'node:crypto';

const fail=(code)=>{throw Object.assign(new Error(code),{code})};
const scalar=(v,n)=>{
 if(v===null||v===undefined)return null;
 if(typeof v!=='string'||v.length>n||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))
  fail('V2_HANDOFF_UNTRUSTED_METADATA');
 return v;
};
const safeId=(v)=>typeof v==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(v);
const natural=v=>Number.isSafeInteger(v)&&v>=0&&v<=1000000?v:null;
const lines=(arr)=>arr.map(s=>'- '+s).join('\n');
export function compactV1ProjectForContinuation(observed){
 if(!observed||observed.state!=='PERSISTED_WORKFLOW_OBSERVED'||
   observed.canExecute!==false||observed.ownerChatAuthenticated!==false||
   observed.activeWorkerAttested!==false)
  fail('V2_HANDOFF_NO_VERIFIED_V1_SNAPSHOT');
 const p=observed.project,graph=p?.goalGraph;
 if(!p||!safeId(p.id)||!Array.isArray(p.steps)||p.steps.length>50||
   !graph||!['PERSISTED_DEPENDENCY_GRAPH','UNVERIFIED'].includes(graph.state)||
   graph.canExecute!==false)
  fail('V2_HANDOFF_PROJECT_GRAPH_REQUIRED');
 const steps=p.steps.map(s=>{
  if(!s||typeof s.id!=='string'||s.id.length>80)fail('V2_HANDOFF_STEP_INVALID');
  return {id:scalar(s.id,80),title:scalar(s.title,100),status:scalar(s.status,50),
    dependencyCount:natural(s.dependsOn)};
 });
 const record={
  schema:'commander.v2.workspace.continuation-preview.v1',
  intent:'MANUAL_HANDOFF_ONLY',
  source:'V1_WORKFLOW_STORE_OBSERVED',
  project:{id:p.id,goal:scalar(p.goal,250),revision:natural(p.revision),
    lifecycle:scalar(p.lifecycle,48),acceptance:scalar(p.acceptance,50),
    checkpointPresent:p.checkpointPresent===true,steps},
  graph:{state:graph.state,reason:scalar(graph.reason,80),
    nodes:Array.isArray(graph.nodes)?graph.nodes.slice(0,50).map(n=>({
      id:scalar(n.id,80),status:scalar(n.status,70),
      dependencies:Array.isArray(n.dependencies)?n.dependencies.slice(0,50).map(x=>scalar(x,80)):[]})):[],
    counts:graph.counts?{
      complete:natural(graph.counts.recordedComplete),
      dependenciesSatisfied:natural(graph.counts.dependencySatisfied),
      blocked:natural(graph.counts.dependencyBlocked),
      unknown:natural(graph.counts.unknown)}:null},
  journal:{count:natural(observed.recordedOperations?.count),
    entries:Array.isArray(observed.recordedOperations?.items)?observed.recordedOperations.items.slice(0,20).map(o=>({
      stepId:scalar(o.stepId,64),status:scalar(o.status,40),
      resultStatus:scalar(o.resultStatus,48),hasPostStateHash:o.hasPostStateHash===true
    })):[]},
  authority:{chatAttested:false,ownerGrant:false,mayExecute:false,
    activeWorkerAttested:false,operationEffectVerified:false},
  omissions:['credentials','cookies','checkpoint payload','filesystem paths',
    'conversation identifiers','tool parameters','private operation responses']
 };
 const canonical=JSON.stringify(record);
 if(Buffer.byteLength(canonical,'utf8')>26000)fail('V2_HANDOFF_TOO_LARGE');
 const sha256=createHash('sha256').update(canonical).digest('hex');
 const summary=[
  '# Commander V2 — Manual continuation context (not an execution receipt)',
  'Project: '+record.project.id+' | revision: '+(record.project.revision??'?'),
  'Goal: '+(record.project.goal??'not verified'),
  'Lifecycle (stored): '+(record.project.lifecycle??'unverified'),
  'Acceptance (stored): '+(record.project.acceptance??'unverified'),
  'Stored checkpoint exists: '+(record.project.checkpointPresent?'yes':'no (or not verified)'),
  'Dependency graph: '+record.graph.state+'; blocked: '+(record.graph.counts?.blocked??'?'),
  'Steps:',
  lines(steps.map(s=>s.id+' | '+(s.status??'unknown')+' | dependencies '+(s.dependencyCount??'?'))),
  'Recorded journal entries (not independent effect proof): '+(record.journal.count??'?'),
  'Snapshot digest SHA-256: '+sha256,
  'This text does not authorize tool use, identify the current ChatGPT conversation,',
  'carry a checkpoint payload, or resume any Worker. Re-attest owner, grant and',
  'fresh WorkflowStore revision before any future execution.'
 ].join('\n');
 return Object.freeze({state:'MANUAL_CONTINUATION_PREVIEW',sha256,
  content:summary,canExecute:false,canResume:false,
  authoritative:false,source:'V1_WORKFLOW_STORE_OBSERVED'});
}
