// Pure decision contract. A valid proposal does not authorize execution by itself.
// The installed worker must separately admit host, owner grant, durable budget,
// resources and process ownership. Historical R1/R2 remain immutable.
import path from 'node:path';
import {types} from 'node:util';

export const MODEL='gpt-6.1-sol';
export const disabledFeatures=Object.freeze(['apps','plugins','hooks','shell_snapshot','shell_tool','unified_exec','computer_use','browser_use','browser_use_external','browser_use_full_cdp_access','multi_agent','multi_agent_v2','memories','image_generation','code_mode_host','skill_search','skill_mcp_dependency_install','goals','remote_plugin','tool_suggest','daemon_auto_start','unbounded_connection_retries']);
export const knownDiagnostic='Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.';
export const proposalSchema=Object.freeze({type:'object',properties:Object.freeze({choice:Object.freeze({type:'string',enum:Object.freeze(['CONTINUE_STEP','STOP'])})}),required:Object.freeze(['choice']),additionalProperties:false});
const fail=code=>{throw Object.assign(new Error(code),{code});};
const own=(v,k)=>Object.hasOwn(v,k);
function exact(value,required,optional=[]){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('MODEL_OBJECT_SCHEMA');
 const fields=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(fields);
 if(required.some(k=>!own(fields,k))||names.some(k=>typeof k!=='string'||!required.includes(k)&&!optional.includes(k)||!own(fields[k],'value')||!fields[k].enumerable))fail('MODEL_OBJECT_SCHEMA');
}
function json(text,maxBytes=32768){
 if(typeof text!=='string'||!text.isWellFormed()||Buffer.byteLength(text)>maxBytes)fail('MODEL_JSON_BOUND');
 const stack=[];let tokens=0;
 for(let i=0;i<text.length;i++){
  const c=text[i];if(/[ \r\n\t]/.test(c))continue;if(++tokens>4096)fail('MODEL_JSON_TOKENS');
  if(c==='{'||c==='['){stack.push({object:c==='{',names:new Set()});if(stack.length>8)fail('MODEL_JSON_DEPTH');}
  else if(c==='}'||c===']'){if(!stack.length)fail('MODEL_JSON_SYNTAX');stack.pop();}
  else if(c==='"'){
   const begin=i;let ended=false;for(i++;i<text.length;i++){if(text[i]==='\\'){i++;continue;}if(text[i]==='"'){ended=true;break;}}if(!ended)fail('MODEL_JSON_SYNTAX');
   let next=i+1;while(/[ \r\n\t]/.test(text[next]??'!'))next++;
   if(text[next]===':'&&stack.at(-1)?.object){let key;try{key=JSON.parse(text.slice(begin,i+1));}catch{fail('MODEL_JSON_SYNTAX');}if(!key.isWellFormed()||stack.at(-1).names.has(key))fail('MODEL_JSON_DUPLICATE_KEY');stack.at(-1).names.add(key);}
  }
 }
 if(stack.length)fail('MODEL_JSON_SYNTAX');try{return JSON.parse(text);}catch{fail('MODEL_JSON_SYNTAX');}
}
// Native JSON receipts reuse duplicate-name rejection with explicit byte bounds.
export function parseBoundedJson(text,maxBytes=32768){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>2105344)fail('MODEL_JSON_BOUND');
 return json(text,maxBytes);
}
export function validateProposal(text){
 const value=json(text,1024);exact(value,['choice']);if(!['CONTINUE_STEP','STOP'].includes(value.choice))fail('MODEL_PROPOSAL_DENIED');return Object.freeze({choice:value.choice});
}
function usage(value){
 exact(value,['input_tokens','output_tokens'],['cached_input_tokens','cache_write_input_tokens','reasoning_output_tokens']);
 for(const [key,count]of Object.entries(value))if(!Number.isSafeInteger(count)||count<0||count>(key==='output_tokens'||key==='reasoning_output_tokens'?4096:1000000))fail('MODEL_USAGE_BOUND');
 if((value.cached_input_tokens??0)>value.input_tokens||(value.reasoning_output_tokens??0)>value.output_tokens)fail('MODEL_USAGE_PARITY');
 return Object.freeze({...value});
}
export function validateEvents(text){
 if(typeof text!=='string'||!text.isWellFormed()||Buffer.byteLength(text)>1048576)fail('MODEL_EVENTS_BOUND');
 const raw=text.endsWith('\n')?text.slice(0,-1):text,lines=raw.split('\n');
 if(lines.length<4||lines.length>64||lines.some(row=>!row.trim()))fail('MODEL_EVENTS_COUNT');
 const rows=lines.map(row=>json(row.endsWith('\r')?row.slice(0,-1):row));
 let phase='THREAD',threadId=null,proposal=null,completedUsage=null,diagnostics=0;
 const items=new Map();
 for(let i=0;i<rows.length;i++){
  const event=rows[i];if(phase==='COMPLETE')fail('MODEL_EVENT_AFTER_COMPLETE');
  if(phase==='THREAD'){
   exact(event,['type','thread_id']);if(event.type!=='thread.started'||typeof event.thread_id!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(event.thread_id))fail('MODEL_THREAD_IDENTITY');
   threadId=event.thread_id;phase='PRETURN';continue;
  }
  if(phase==='PRETURN'){
   if(i===1&&event.type==='item.completed'){
    exact(event,['type','item']);exact(event.item,['id','type','message']);if(event.item.id!=='item_0'||event.item.type!=='error'||event.item.message!==knownDiagnostic)fail('MODEL_PRETURN_DIAGNOSTIC_DENIED');diagnostics++;continue;
   }
   exact(event,['type']);if(event.type!=='turn.started')fail('MODEL_TURN_START_REQUIRED');phase='TURN';continue;
  }
  if(event.type==='turn.completed'){
   exact(event,['type','usage']);if(!proposal||[...items.values()].some(item=>!item.completed))fail('MODEL_TURN_INCOMPLETE');completedUsage=usage(event.usage);phase='COMPLETE';continue;
  }
  if(proposal)fail('MODEL_EVENT_AFTER_FINAL_PROPOSAL');
  exact(event,['type','item']);if(!['item.started','item.completed'].includes(event.type))fail('MODEL_EVENT_DENIED');
  exact(event.item,['id','type','text']);const item=event.item;
  if(typeof item.id!=='string'||! /^item_[0-9]{1,7}$/.test(item.id)||!['reasoning','agent_message'].includes(item.type)||typeof item.text!=='string'||!item.text.isWellFormed()||Buffer.byteLength(item.text)>16384||diagnostics&&item.id==='item_0')fail('MODEL_ITEM_DENIED');
  const prior=items.get(item.id);
  if(event.type==='item.started'){
   if(prior)fail('MODEL_ITEM_DUPLICATE');items.set(item.id,{type:item.type,completed:false});
  }else{
   if(prior&&(prior.completed||prior.type!==item.type))fail('MODEL_ITEM_DUPLICATE');items.set(item.id,{type:item.type,completed:true});
   if(item.type==='agent_message')proposal=validateProposal(item.text);
  }
 }
 if(phase!=='COMPLETE')fail('MODEL_NO_COMPLETION');
 return Object.freeze({events:rows.length,messages:1,threadId,proposal,usage:completedUsage,knownDisabledToolDiagnostic:diagnostics,toolsEnabled:false});
}
export function validateModelResult(result){
 exact(result,['stdout','artifact','exitCode','signal','stderr','overflow','pipeError']);
 if(result.exitCode!==0||result.signal!==null||result.stderr!==''||result.overflow!==false||result.pipeError!==null)fail('MODEL_PROCESS_NOT_ACCEPTED');
 const eventProof=validateEvents(result.stdout),artifact=validateProposal(result.artifact);
 if(eventProof.proposal.choice!==artifact.choice)fail('MODEL_ARTIFACT_PARITY');
 return Object.freeze({...eventProof,proposal:artifact,decision:artifact.choice==='STOP'?'STOP_NO_ACTION':'PROPOSAL_REQUIRES_OWNER_EXECUTOR_ADMISSION'});
}
export function argumentsFor(root){
 if(typeof root!=='string'||!path.win32.isAbsolute(root)||path.win32.normalize(root)!==root||root.startsWith('\\\\')||/[\x00-\x1f"]/.test(root)||root.slice(2).includes(':'))fail('MODEL_ROOT_DENIED');
 return Object.freeze(['exec','--sandbox','read-only','--ephemeral','--ignore-user-config','--skip-git-repo-check','--color','never','--json','--output-schema',path.win32.join(root,'proposal.schema.json'),'--output-last-message',path.win32.join(root,'proposal.json'),'--cd',root,'-c','approval_policy="never"','-c','web_search="disabled"','-c','model_reasoning_effort="low"',...disabledFeatures.flatMap(feature=>['--disable',feature]),'--model',MODEL,'-']);
}
export function childEnv(source){
 if(!source||types.isProxy(source))fail('MODEL_ENV_DENIED');const output={};
 for(const [key,descriptor]of Object.entries(Object.getOwnPropertyDescriptors(source))){
  if(!own(descriptor,'value')||typeof descriptor.value!=='string')fail('MODEL_ENV_DENIED');
  if(/^(OPENAI_|AZURE_OPENAI_|CODEX_(API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|BASE_URL|COMMANDER)|COMMANDER_)/i.test(key)||/^(NODE_OPTIONS|NODE_PATH)$/i.test(key))continue;
  output[key]=descriptor.value;
 }
 output.NODE_OPTIONS='';output.NODE_PATH='';return Object.freeze(output);
}
