// Commander V2 Workspace R10 — bounded, read-only adapter to the EXISTING V1 Core.
// V1 remains the only operation/workflow/coordinator authority. No workflow or tool mutation.
import {execFileSync} from 'node:child_process';
const DEFAULT_V1_URL='http://127.0.0.1:47831/mcp';
const DEFAULT_V1_PROFILE='default';
const PROFILE=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
/** A verified local-owner configuration is a selector, never an OAuth grant. */
export function resolveV1Target({endpoint=process.env.RC_V2_V1_MCP_URL,
 expectedProfile=process.env.RC_V2_V1_PROFILE}={}){
  if(endpoint===undefined&&expectedProfile===undefined)
    return {state:'CONFIGURED',endpoint:DEFAULT_V1_URL,expectedProfile:DEFAULT_V1_PROFILE};
  if(typeof endpoint!=='string'||typeof expectedProfile!=='string'||!PROFILE.test(expectedProfile))
    return {state:'PROFILE_TARGET_INVALID'};
  try{
    const v=new URL(endpoint);
    if(v.protocol!=='http:'||v.hostname!=='127.0.0.1'||!v.port||
      Number(v.port)<1024||Number(v.port)>65535||v.pathname!=='/mcp'||
      v.username||v.password||v.search||v.hash||v.href!==endpoint)
      return {state:'PROFILE_TARGET_INVALID'};
    return {state:'CONFIGURED',endpoint:v.href,expectedProfile};
  }catch{return {state:'PROFILE_TARGET_INVALID'};}
}
const NAMES=Object.freeze(['system_status','gui_status','browser_status','workflow_health','power_status','workflow_list','agent_extension_list','delegation_status','delivery_status']);
const LIMIT=262144;
const clean=(v,max=96)=>typeof v==='string'?v.slice(0,max):null;
const bool=v=>typeof v==='boolean'?v:null;
const count=v=>Number.isSafeInteger(v)&&v>=0&&v<=1000000?v:null;
function unwrap(response){
  if(!response||typeof response!=='object'||response.error)throw Error('MCP_UNVERIFIED');
  const data=response.result;
  if(!data||typeof data!=='object'||data.isError===true)throw Error('MCP_UNVERIFIED');
  if(Array.isArray(data.content)){
    const str=data.content.find(x=>x?.type==='text')?.text;
    if(typeof str!=='string'||str.length>LIMIT)throw Error('MCP_UNVERIFIED');
    const parsed=JSON.parse(str);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('MCP_UNVERIFIED');
    return parsed;
  }
  return data;
}
async function invoke(name, request=fetch, args={}, endpoint=DEFAULT_V1_URL){
  if(name!=='tools/list'&&!NAMES.includes(name)&&!['workflow_get','workflow_operations','conversation_status','workflow_run_status'].includes(name))throw Error('V1_TOOL_FORBIDDEN');
  if(['workflow_get','workflow_operations'].includes(name)&&(!args||typeof args.id!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(args.id)))
    throw Error('V1_PROJECT_ID_INVALID');
  if(name==='conversation_status'&&(!args||typeof args.projectId!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(args.projectId)))
    throw Error('V1_PROJECT_ID_INVALID');
  const body=name==='tools/list'
    ?{jsonrpc:'2.0',id:1,method:'tools/list'}
    :{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:name==='workflow_list'?{limit:25}:['workflow_get','workflow_operations'].includes(name)?{id:args.id}:name==='conversation_status'?{projectId:args.projectId}:{}}};
  const res=await request(endpoint,{method:'POST',redirect:'error',
    headers:{'content-type':'application/json','accept':'application/json, text/event-stream'},
    body:JSON.stringify(body),signal:AbortSignal.timeout(1400)});
  if(!res.ok||!String(res.headers?.get('content-type')||'').includes('application/json'))throw Error('V1_NOT_READY');
  const length=Number(res.headers.get('content-length')||0);
  if(length>LIMIT)throw Error('RESPONSE_TOO_LARGE');
  const txt=await res.text();
  if(txt.length>LIMIT)throw Error('RESPONSE_TOO_LARGE');
  return unwrap(JSON.parse(txt));
}
export async function readLocalV1Runtime({request=fetch,os=process.platform,uid=process.getuid?.(),
 username=process.env.USERNAME||'',endpoint=process.env.RC_V2_V1_MCP_URL,
 expectedProfile=process.env.RC_V2_V1_PROFILE}={}){
  // Verify the actual Windows token, never inherited environment variables.
  // If native identity is unavailable, do not read V1 through a privileged service.
  let deniedWindows=(os==='win32'&&username.toUpperCase()==='SYSTEM');
  if(os==='win32'&&process.platform==='win32'){
    try{
      const actual=execFileSync('whoami',[],{encoding:'utf8',timeout:1500,windowsHide:true}).trim().toLowerCase();
      const usernamePart=actual.split('\\').pop();
      if(!actual||!usernamePart||['system','local service','network service'].includes(usernamePart))deniedWindows=true;
    }catch{deniedWindows=true;}
  }
  if((os!=='win32'&&uid===0)||deniedWindows)
    return {state:'OWNER_SESSION_REQUIRED',source:'V1_LOCAL_CORE',toolCount:null,
      core:null,gui:null,browser:null,workflow:null,power:null,projects:null,agents:null,harness:null,delivery:null};
  const target=resolveV1Target({endpoint,expectedProfile});
  if(target.state!=='CONFIGURED')
    return {state:'PROFILE_TARGET_INVALID',source:'V1_LOCAL_CORE',canExecute:false,
      core:null,projects:null};
  // Do not query a profile's project metadata until its status claims the
  // explicitly selected instance. An MCP profile label is not authentication.
  let sys;
  try{sys=await invoke('system_status',request,{},target.endpoint);}catch{}
  if(!sys||!PROFILE.test(sys.instance?.profile||''))return {
    state:'PROFILE_UNVERIFIED',source:'V1_LOCAL_CORE',canExecute:false,
    core:null,projects:null};
  if(sys.instance.profile!==target.expectedProfile)return {
    state:'PROFILE_MISMATCH',source:'V1_LOCAL_CORE',canExecute:false,
    expectedProfile:target.expectedProfile,observedProfile:clean(sys.instance.profile,64),
    core:null,projects:null};
  const settled=await Promise.allSettled([...NAMES.slice(1),'tools/list'].map(n=>
    invoke(n,request,{},target.endpoint)));
  const fields=settled.map(x=>x.status==='fulfilled'?x.value:null);
  // Fixed-name, bounded probe telemetry; never return raw exceptions, URIs,
  // upstream bodies, prompts or identifiers. TIMEOUT is not an auth grant.
  const telemetryNames=['gui','browser','workflow','power','projects','extensions','delegation','delivery','catalog'];
  const telemetry=Object.fromEntries(telemetryNames.map((key,i)=>[
    key,settled[i].status==='fulfilled'?'AVAILABLE':
      settled[i].reason?.name==='TimeoutError'?'TIMEOUT':'UNVERIFIED'
  ]));
  const [gui,browser,workflow,power,projectRuns,extensions,delegation,delivery,catalog]=fields;
  const successes=fields.filter(Boolean).length+1;
  if(!successes)return {state:'UNREACHABLE',source:'V1_LOCAL_CORE',toolCount:null,
    core:null,gui:null,browser:null,workflow:null,power:null,projects:null,agents:null,harness:null,delivery:null};
  // Optional, read-only V1 worker runner evidence. Never an execution grant.
  let runStatus=null;
  let runnerProbe='UNVERIFIED';
  try{
    runStatus=await invoke('workflow_run_status',request,{},target.endpoint);
    runnerProbe='AVAILABLE';
  }catch(error){
    runnerProbe=error?.name==='TimeoutError'?'TIMEOUT':'UNVERIFIED';
  }
  telemetry.runner=runnerProbe;
  const runStates=Array.isArray(runStatus?.runs)&&runStatus.runs.length<=1000?runStatus.runs:null;
  const recordedStates={BLOCKED:0,EXHAUSTED:0,COMPLETED:0,RUNNING:0,OTHER:0};
  if(runStates){for(const run of runStates){const st=run?.status;
    if(st==='BLOCKED'||st==='EXHAUSTED'||st==='COMPLETED'||st==='RUNNING')recordedStates[st]++;
    else recordedStates.OTHER++;
  }}
  const tools=Array.isArray(catalog?.tools)?catalog.tools:null;
  return {
    state:successes===fields.length+1?'LIVE_READ_ONLY':'DEGRADED_READ_ONLY',
    selectedProfile:target.expectedProfile,identityBasis:'LOCAL_PROFILE_LABEL_NOT_AUTHENTICATION',
    probes:telemetry,
    source:'V1_LOCAL_CORE',transport:'LOCAL_LOOPBACK',canExecute:false,
    observedAt:new Date().toISOString(),
    toolCount:tools&&tools.length<=1000?tools.length:null,
    core:sys?{version:clean(sys.version,64),platform:clean(sys.platform,20),
      tier:clean(sys.capabilityProfile?.tier,36),profile:clean(sys.instance?.profile,60),
      automaticExecution:bool(sys.durableWorkflows?.automaticExecution)}:null,
    gui:gui?{available:bool(gui.available),backend:clean(gui.backend,70),
      consentRequired:bool(gui.consentRequired),
      consentedSessionActive:bool(gui.consentedSessionActive),
      leased:bool(gui.leased)}:null,
    browser:browser?{available:bool(browser.available),backend:clean(browser.backend,70),
      active:bool(browser.active),backgroundOnly:bool(browser.backgroundOnly),
      leased:bool(browser.leased)}:null,
    workflow:workflow?{healthy:bool(workflow.ok),
      databaseIntegrity:clean(workflow.databaseIntegrity,30),
      automaticExecution:bool(workflow.scheduler?.automaticExecution),
      runnerConfigured:bool(workflow.scheduler?.runnerConfigured),
      pending:count(workflow.scheduler?.pending)}:null,
    power:power?{enabled:bool(power.enabled),
      allowShell:bool(power.allowShell),fullFilesystem:bool(power.fullFilesystem)}:null,
    projects:projectRuns?{source:'V1_WORKFLOW_STORE',authenticatedChat:false,
      items:Array.isArray(projectRuns.workflows)?projectRuns.workflows.slice(0,25)
      .filter(x=>x&&typeof x.id==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(x.id))
      .map(x=>({id:x.id,revision:count(x.revision),lifecycle:clean(x.lifecycle,40),
        schedulerEnabled:bool(x.schedulerEnabled)})):[]}:null,
    agents:extensions?{source:'V1_AGENT_EXTENSIONS',activeWorkersAttested:false,
      registeredCount:Array.isArray(extensions.items)&&extensions.items.length<=1000?extensions.items.length:null}:null,
    harness:delegation?{source:'V1_DELEGATION_POLICY',active:bool(delegation.active),
      policy:clean(delegation.policy,72),defaultRoute:clean(delegation.default,72),
      commanderMayLaunchCodex:bool(delegation.commanderMayLaunchCodex)}:null,
    runner:runStatus?{source:'V1_STORED_RUN_STATUS',configured:bool(runStatus.configured),
      enabled:bool(runStatus.enabled),providerAvailable:bool(runStatus.provider?.available),
      providerMode:clean(runStatus.provider?.mode,40),workerEnabled:bool(runStatus.policy?.worker?.enabled),
      observedRunCount:runStates?runStates.length:null,storedRunStates:runStates?recordedStates:null,
      canExecuteFromWorkspace:false,externalEffectsAttested:false}:null,
    delivery:delivery?{source:'V1_DURABLE_DELIVERY',durable:bool(delivery.durable),
      pending:count(delivery.pending),deadLetter:count(delivery.deadLetter),
      unfinishedRequests:count(delivery.unfinishedRequests),
      transportReceipts:count(delivery.transportReceipts),authenticatedChat:false}:null
  };
}

/** Owner-local, read-only CoS-style task detail projection of canonical V1 WorkflowStore.
 * The requested ID must be present in the fresh server-side V1 list.
 * It cannot schedule, resume, mutate or attest a running Worker.
 */
export async function readLocalV1Project(id,{request=fetch,os=process.platform,
 uid=process.getuid?.(),username=process.env.USERNAME||'',
 endpoint=process.env.RC_V2_V1_MCP_URL,expectedProfile=process.env.RC_V2_V1_PROFILE}={}){
 const unavailable=(state)=>({state,source:'V1_WORKFLOW_STORE',project:null,canExecute:false});
 if(typeof id!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(id))return unavailable('INVALID_ID');
 const target=resolveV1Target({endpoint,expectedProfile});
 if(target.state!=='CONFIGURED')return unavailable('PROFILE_TARGET_INVALID');
 const snapshot=await readLocalV1Runtime({request,os,uid,username,endpoint,expectedProfile});
 if(!['LIVE_READ_ONLY','DEGRADED_READ_ONLY'].includes(snapshot.state))return unavailable(snapshot.state);
 if(!Array.isArray(snapshot.projects?.items)||!snapshot.projects.items.some(p=>p.id===id))
   return unavailable('NOT_AVAILABLE');
 try{
   const raw=await invoke('workflow_get',request,{id},target.endpoint);
   const state=raw?.state;
   if(!state||typeof state!=='object'||Array.isArray(state)||state.id!==id)
     return unavailable('UNVERIFIED');
   const extras=await Promise.allSettled([
     invoke('workflow_operations',request,{id},target.endpoint),invoke('conversation_status',request,{projectId:id},target.endpoint)
   ]);
   const ops=extras[0].status==='fulfilled'?extras[0].value:null;
   const conversation=extras[1].status==='fulfilled'?extras[1].value:null;
   const validOperations=ops?.id===id&&Array.isArray(ops.operations)&&ops.operations.length<=2000;
   const persistedOperations=validOperations?ops.operations.filter(o=>o&&typeof o==='object'):[];
   const validConversation=conversation?.projectId===id&&typeof conversation?.bound==='boolean';
   const steps=Array.isArray(state.steps)?state.steps:[];
   if(steps.length>1000)return unavailable('UNVERIFIED');
   return {
     state:'PERSISTED_WORKFLOW_OBSERVED',source:'V1_WORKFLOW_STORE',
     canExecute:false,isExecutionReceipt:false,ownerChatAuthenticated:false,activeWorkerAttested:false,
     recordedOperations:validOperations?{
       source:'V1_WORKFLOW_OPERATION_JOURNAL',count:persistedOperations.length,
       truncated:persistedOperations.length>20,
       items:persistedOperations.slice(0,20).map(o=>({
         stepId:clean(o.stepId,64),status:clean(o.status,40),
         classification:clean(o.classification,40),resultStatus:clean(o.resultStatus,48),
         hasPreStateHash:typeof o.preStateHash==='string'&&/^[a-f0-9]{64}$/.test(o.preStateHash),
         hasPostStateHash:typeof o.postStateHash==='string'&&/^[a-f0-9]{64}$/.test(o.postStateHash)
       }))
     }:null,
     binding:validConversation?{
       source:'V1_CONVERSATION_STORE',projectHasConversationBinding:conversation.bound,
       currentChatAttested:false,mayWakeWorker:false
     }:null,
     project:{
       id,
       goal:clean(state.goal,250),
       lifecycle:clean(state.lifecycleState,48),
       revision:count(state.revision),
       acceptance:clean(raw.acceptanceStatus,50),
       checkpointPresent:state.checkpoint!==null&&typeof state.checkpoint==='object'&&Object.keys(state.checkpoint).length>0,
       goalGraph:projectGoalGraph(steps),
       steps:steps.slice(0,50).filter(v=>v&&typeof v==='object'&&typeof v.id==='string')
         .map(v=>({id:clean(v.id,80),title:clean(v.title,100),
           status:clean(v.status,50),dependsOn:Array.isArray(v.dependsOn)?v.dependsOn.length:null}))
     }
   };
 }catch{return unavailable('UNVERIFIED');}
}


/**
 * CoS-style dependency projection from an already-stored V1 WorkflowStore snapshot.
 * No worker, scheduling, lease, checkpoint mutation or execution permission.
 * A satisfied dependency is not a tool grant, a runnable Worker or proof of effect.
 */
export function projectGoalGraph(steps){
 const unverified=reason=>({state:'UNVERIFIED',reason,canExecute:false,nodes:[],counts:null});
 if(!Array.isArray(steps)||steps.length>50)return unverified('INCOMPLETE_OR_OVERSIZED');
 const idPattern=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
 const nodes=new Map();
 for(const s of steps){
  if(!s||typeof s!=='object'||Array.isArray(s)||typeof s.id!=='string'||
     !idPattern.test(s.id)||nodes.has(s.id)||!Array.isArray(s.dependsOn)||
     s.dependsOn.length>50||s.dependsOn.some(d=>typeof d!=='string'||!idPattern.test(d)))
   return unverified('INVALID_OR_DUPLICATE_NODE');
  if(new Set(s.dependsOn).size!==s.dependsOn.length)return unverified('DUPLICATE_DEPENDENCY');
  nodes.set(s.id,s);
 }
 for(const s of nodes.values()){
  if(s.dependsOn.some(d=>!nodes.has(d)))return unverified('UNRESOLVED_DEPENDENCY');
 }
 const colors=new Map();
 function cycle(id){
  const c=colors.get(id)||0;
  if(c===1)return true;
  if(c===2)return false;
  colors.set(id,1);
  for(const dep of nodes.get(id).dependsOn)if(cycle(dep))return true;
  colors.set(id,2);
  return false;
 }
 for(const id of nodes.keys())if(cycle(id))return unverified('DEPENDENCY_CYCLE');
 const complete=new Set(['DONE','COMPLETED','SUCCESS','SUCCEEDED']);
 const counts={recordedComplete:0,dependencySatisfied:0,dependencyBlocked:0,unknown:0};
 const out=[];
 for(const n of nodes.values()){
  const rawStatus=typeof n.status==='string'?n.status.toUpperCase():'';
  let type;
  if(complete.has(rawStatus))type='COMPLETE_RECORDED_ONLY';
  else if(!['PENDING','QUEUED','WAITING','TODO','BLOCKED','INTERRUPTED','READY'].includes(rawStatus)){
   type='UNKNOWN';counts.unknown++;
  }else if(n.dependsOn.every(dep=>complete.has(String(nodes.get(dep)?.status||'').toUpperCase()))){
   type='DEPENDENCIES_SATISFIED_STORED_ONLY';counts.dependencySatisfied++;
  }else{
   type='DEPENDENCY_BLOCKED_STORED_ONLY';counts.dependencyBlocked++;
  }
  if(type==='COMPLETE_RECORDED_ONLY')counts.recordedComplete++;
  out.push({id:n.id,status:type,dependencies:[...n.dependsOn],
    title:clean(n.title,100)});
 }
 return {state:'PERSISTED_DEPENDENCY_GRAPH',reason:null,canExecute:false,
   source:'V1_WORKFLOW_STORE',counts,nodes:out};
}
