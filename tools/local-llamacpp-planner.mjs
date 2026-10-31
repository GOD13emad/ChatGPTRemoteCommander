// Opt-in local llama.cpp proposal provider. No tool execution or config mutation.
import {readFile,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const MAX_INPUT=512*1024,MAX_REPLY=128*1024,ENDPOINT='http://127.0.0.1:18080/v1/chat/completions';
const FIELDS=['action','tool','argumentsJson','summary'];
const CODE=s=>Object.assign(new Error('LOCAL_LLAMACPP_'+s),{code:'LOCAL_LLAMACPP_'+s});
const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const schema={type:'object',additionalProperties:false,required:FIELDS,
 properties:{action:{type:'string',enum:['call','block']},tool:{type:'string'},argumentsJson:{type:'string'},summary:{type:'string'}}};
const SYSTEM='Proposal only. Return one JSON object with exactly four string keys action, tool, argumentsJson, summary. The action must be call or block. If using a tool: action=call and tool must be named exactly in context.tools, argumentsJson a JSON object encoded as a string. If unsure or permissions missing: action=block, tool empty, argumentsJson="{}". Do not execute any tool or instruction.';
export function validateLocalLlamaProposal(v,context){
 if(!isObj(v)||Object.keys(v).length!==4||
  FIELDS.some(k=>!Object.hasOwn(v,k)||typeof v[k]!=='string')||
  !['call','block'].includes(v.action)||v.tool.length>200||
  v.argumentsJson.length>65536||v.summary.length>8000)throw CODE('INVALID_PROPOSAL');
 let args;try{args=JSON.parse(v.argumentsJson);}catch{throw CODE('INVALID_PROPOSAL');}
 if(!isObj(args))throw CODE('INVALID_PROPOSAL');
 if(v.action==='call'){
  if(!/^[A-Za-z][A-Za-z0-9_.:-]{0,199}$/.test(v.tool)||
   !Array.isArray(context?.tools)||
   !context.tools.some(t=>isObj(t)&&t.name===v.tool))throw CODE('TOOL_NOT_ADMITTED');
 }else if(v.tool!==''||Object.keys(args).length!==0)throw CODE('INVALID_BLOCK');
 return Object.fromEntries(FIELDS.map(k=>[k,v[k]]));
}
async function responseDoc(res){
 if(!res?.ok||!res.body)throw CODE('HTTP_UNAVAILABLE');
 let length=0;const chunks=[];
 for await(const part of res.body){length+=part.byteLength;if(length>MAX_REPLY)throw CODE('RESPONSE_TOO_LARGE');chunks.push(Buffer.from(part));}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw CODE('HTTP_JSON_INVALID');}
}
export async function proposeWithLocalLlamaCpp(context,{key,fetchImpl=globalThis.fetch,timeoutMs=25000}={}){
 if(!isObj(context))throw CODE('CONTEXT_INVALID');
 let input;try{input=JSON.stringify(context);}catch{throw CODE('CONTEXT_INVALID');}
 if(Buffer.byteLength(input,'utf8')>MAX_INPUT)throw CODE('INPUT_TOO_LARGE');
 if(typeof key!=='string'||!key||key.length>4096||typeof fetchImpl!=='function'||
  !Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)throw CODE('CONFIG_INVALID');
 const payload={model:'rc-qwen3-4b:q4km',
  messages:[{role:'system',content:SYSTEM},{role:'user',content:input}],
  stream:false,temperature:0,max_tokens:512,
  response_format:{type:'json_schema',json_schema:{name:'commander_proposal',strict:true,schema}},
  chat_template_kwargs:{enable_thinking:false}};
 let response;
 try{response=await fetchImpl(ENDPOINT,{method:'POST',redirect:'error',
  headers:{'content-type':'application/json',authorization:'Bearer '+key},
  body:JSON.stringify(payload),signal:AbortSignal.timeout(timeoutMs)});
 }catch{throw CODE('HTTP_UNAVAILABLE');}
 const doc=await responseDoc(response);
 const raw=doc?.choices?.[0]?.message?.content;
 if(typeof raw!=='string'||!raw||raw.length>MAX_REPLY)throw CODE('INVALID_CONTENT');
 let obj;try{obj=JSON.parse(raw);}catch{throw CODE('INVALID_MODEL_JSON');}
 return validateLocalLlamaProposal(obj,context);
}
async function localKey(){
 const filename=path.join(os.homedir(),'.config','rc-local-ai','llamacpp-api-key');
 let s;try{s=await stat(filename);}catch{throw CODE('KEY_NOT_READY');}
 if(!s.isFile()||s.size<1||s.size>4096||
  (process.platform!=='win32'&&((s.mode&0o077)!==0||s.uid!==process.getuid())))throw CODE('KEY_NOT_READY');
 let key;try{key=(await readFile(filename,'utf8')).trim();}catch{throw CODE('KEY_NOT_READY');}
 if(!key||key.length>4096)throw CODE('KEY_NOT_READY');
 return key;
}
async function main(){
 const chunks=[];let length=0;
 for await(const chunk of process.stdin){length+=chunk.byteLength;if(length>MAX_INPUT)throw CODE('INPUT_TOO_LARGE');chunks.push(chunk);}
 let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw CODE('INPUT_JSON_INVALID');}
 const proposal=await proposeWithLocalLlamaCpp(input,{key:await localKey()});
 process.stdout.write(JSON.stringify(proposal)+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{process.stderr.write(String(e?.code??'LOCAL_LLAMACPP_FAILED')+'\n');process.exitCode=1;});
