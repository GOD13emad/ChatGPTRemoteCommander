#!/usr/bin/env node
// Owner Firefox MCP bridge for ChatGPT clients whose connector tool list is stale.
// Invokes ONLY same-owner Workspace tools on local loopback. No browser profile,
// cookie, credential, or WebDriver access. Never retries an uncertain mutation.
import * as crypto from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const commands={
  list:{tool:'workspace_target_list',read:true,fields:[]},
  open:{tool:'workspace_accessibility_open',fields:['processId','handle','mode','explicitUserAuthorization']},
  snapshot:{tool:'workspace_accessibility_snapshot',read:true,fields:['processId','handle','lease']},
  invoke:{tool:'workspace_accessibility_invoke',fields:['processId','handle','lease','elementId']},
  type:{tool:'workspace_accessibility_type',fields:['processId','handle','lease','elementId','text']},
  end:{tool:'workspace_accessibility_end',read:true,fields:['lease']}
};
function reject(code){const e=new Error(code);e.code=code;throw e}
export function requestFor(command,args={}){
 const def=commands[command];if(!def)reject('OWNER_COMMAND_UNKNOWN');
 if(args===null||Array.isArray(args)||typeof args!=='object')reject('OWNER_ARGS_INVALID');
 const data={};
 for(const k of def.fields)if(args[k]!==undefined)data[k]=args[k];
 if(command==='list')data.application='firefox';
 if(command==='open'&&!['observe','takeover'].includes(data.mode))reject('OWNER_MODE_REQUIRED');
 if(command==='open'&&data.mode==='takeover'&&
   (typeof data.explicitUserAuthorization!=='string'||data.explicitUserAuthorization.length<8||
    data.explicitUserAuthorization.length>128))reject('OWNER_AUTH_REQUIRED');
 if(command!=='list'&&!def.read){
  if(typeof args.requestId!=='string'||!(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(args.requestId)))reject('OWNER_REQUEST_ID_REQUIRED');
  data.requestId=args.requestId;
 }
 return {tool:def.tool,args:data};
}
export async function executeOwnerCommand(command,args={},{
 fetchImpl=fetch,port=47831,timeoutMs=8000
}={}){
 if(!Number.isInteger(port)||port<1024||port>65535)reject('OWNER_PORT_INVALID');
 const {tool, args:data}=requestFor(command,args);
 const meta={
  'io.modelcontextprotocol/protocolVersion':'2026-07-28',
  'io.modelcontextprotocol/clientInfo':{name:'commander-owner-workspace-bridge',version:'1.0.0'},
  'io.modelcontextprotocol/clientCapabilities':{}
 };
 let value;
 // Retry only the unambiguous pre-admission GUI_BUSY response from lease-open.
 // Never retry click, typing, end, or unknown effects.
 for(let attempt=0;attempt<(command==='open'?3:1);attempt++){
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),timeoutMs);
  const payload=attempt===0?data:{...data,requestId:
   'rc-owner-retry-'+crypto.randomUUID()};
  try{
   const response=await fetchImpl('http://127.0.0.1:'+port+'/mcp',{
    method:'POST',signal:c.signal,headers:{
     'content-type':'application/json','MCP-Protocol-Version':'2026-07-28',
     'Mcp-Method':'tools/call','Mcp-Name':tool
    },body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',
      params:{name:tool,arguments:payload,_meta:meta}})
   });
   const d=await response.json();
   if(!response.ok||d.error||d.result?.isError){
    const reason=d.error?.message??d.result?.content?.[0]?.text??'UNVERIFIED_RESPONSE';
    if(command==='open'&&String(reason).trim()==='GUI_BUSY'&&attempt<2){
     await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)));
     continue;
    }
    reject('OWNER_MCP_'+String(reason).slice(0,160));
   }
   value=d.result?.structuredContent;
   if(value?.ok!==true)reject('OWNER_RESPONSE_NOT_CONFIRMED');
   break;
  }finally{clearTimeout(timer)}
 }
  if(command==='list')return {ok:true,windows:(value.windows??[]).map(w=>({
    processId:w.processId,handle:w.handle,focused:w.focused,
    appName:w.appName,screenIndex:w.screenIndex,bounds:w.bounds
  }))};
  if(command==='snapshot')return {ok:true,controls:value.controls??[],valuesRead:value.valuesRead,
    nodesVisited:value.nodesVisited,truncated:value.truncated};
  if(command==='open')return {ok:true,lease:value.lease,mode:value.mode,processId:value.processId,handle:value.handle};
  if(command==='invoke'||command==='type')return {ok:true,effect:value.effect,semanticOnly:value.semanticOnly};
  return {ok:true};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const [command,json='{}',port='47831']=process.argv.slice(2);
 let args;
 try{args=JSON.parse(json)}catch{console.error('OWNER_ARGS_JSON_INVALID');process.exitCode=2}
 if(args!==undefined)executeOwnerCommand(command,args,{port:Number(port)})
  .then(r=>console.log(JSON.stringify(r)))
  .catch(e=>{console.error(e.code??'OWNER_OPERATION_FAILED');process.exitCode=2});
}
