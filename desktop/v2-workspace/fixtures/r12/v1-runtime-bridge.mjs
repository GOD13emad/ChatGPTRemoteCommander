// Commander V2 Workspace R10 — bounded, read-only adapter to the EXISTING V1 Core.
// V1 remains the only operation/workflow/coordinator authority. No workflow or tool mutation.
import {execFileSync} from 'node:child_process';
const V1_URL='http://127.0.0.1:47831/mcp';
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
async function invoke(name, request=fetch, args={}){
  if(name!=='tools/list'&&!NAMES.includes(name)&&!['workflow_get','workflow_operations','conversation_status'].includes(name))throw Error('V1_TOOL_FORBIDDEN');
  if(['workflow_get','workflow_operations'].includes(name)&&(!args||typeof args.id!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(args.id)))
    throw Error('V1_PROJECT_ID_INVALID');
  if(name==='conversation_status'&&(!args||typeof args.projectId!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(args.projectId)))
    throw Error('V1_PROJECT_ID_INVALID');
  const body=name==='tools/list'
    ?{jsonrpc:'2.0',id:1,method:'tools/list'}
    :{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:name==='workflow_list'?{limit:25}:['workflow_get','workflow_operations'].includes(name)?{id:args.id}:name==='conversation_status'?{projectId:args.projectId}:{}}};
  const res=await request(V1_URL,{method:'POST',redirect:'error',
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
 username=process.env.USERNAME||''}={}){
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
  const settled=await Promise.allSettled([...NAMES,'tools/list'].map(n=>invoke(n,request)));
  const fields=settled.map(x=>x.status==='fulfilled'?x.value:null);
  const [sys,gui,browser,workflow,power,projectRuns,extensions,delegation,delivery,catalog]=fields;
  const successes=fields.filter(Boolean).length;
  if(!successes)return {state:'UNREACHABLE',source:'V1_LOCAL_CORE',toolCount:null,
    core:null,gui:null,browser:null,workflow:null,power:null,projects:null,agents:null,harness:null,delivery:null};
  const tools=Array.isArray(catalog?.tools)?catalog.tools:null;
  return {
    state:successes===fields.length?'LIVE_READ_ONLY':'DEGRADED_READ_ONLY',
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
 uid=process.getuid?.(),username=process.env.USERNAME||''}={}){
 const unavailable=(state)=>({state,source:'V1_WORKFLOW_STORE',project:null,canExecute:false});
 if(typeof id!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(id))return unavailable('INVALID_ID');
 const snapshot=await readLocalV1Runtime({request,os,uid,username});
 if(snapshot.state==='OWNER_SESSION_REQUIRED')return unavailable('OWNER_SESSION_REQUIRED');
 if(!Array.isArray(snapshot.projects?.items)||!snapshot.projects.items.some(p=>p.id===id))
   return unavailable('NOT_AVAILABLE');
 try{
   const raw=await invoke('workflow_get',request,{id});
   const state=raw?.state;
   if(!state||typeof state!=='object'||Array.isArray(state)||state.id!==id)
     return unavailable('UNVERIFIED');
   const extras=await Promise.allSettled([
     invoke('workflow_operations',request,{id}),invoke('conversation_status',request,{projectId:id})
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
       steps:steps.slice(0,50).filter(v=>v&&typeof v==='object'&&typeof v.id==='string')
         .map(v=>({id:clean(v.id,80),title:clean(v.title,100),
           status:clean(v.status,50),dependsOn:Array.isArray(v.dependsOn)?v.dependsOn.length:null}))
     }
   };
 }catch{return unavailable('UNVERIFIED');}
}
