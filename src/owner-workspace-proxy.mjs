// Owner-bound workspace broker: never crosses the Windows interactive SID boundary.
// The existing authenticated owner agent must expose the same workspace tool and
// authorize it under its own effective policy. Legacy GUI global locks are not
// consulted for per-window/background tools.
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const ALLOWED=new Set([
 'workspace_plan','workspace_list_windows','workspace_window_observe','workspace_window_preview',
 'workspace_window_click','workspace_browser_inspect','workspace_browser_attach',
 'workspace_browser_click','workspace_target_reconcile'
]);
const MUTATIONS=new Set(['workspace_window_click','workspace_browser_attach',
 'workspace_browser_click','workspace_target_reconcile']);
const AUTH=/^[a-f0-9]{64}$/;
const REQ=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const fail=(c)=>Object.assign(new Error(c),{code:c});
export function createOwnerWorkspaceProxy({config,fetchImpl=globalThis.fetch,readFileImpl=readFile}={}){
 const policy=config?.ownerWorkspaceDelegation;
 if(policy?.enabled!==true)return null;
 if(!Number.isSafeInteger(policy.port)||policy.port<1024||policy.port>65535||
    typeof policy.authFile!=='string'||!path.isAbsolute(policy.authFile))
    throw fail('WORKSPACE_OWNER_PROXY_CONFIG_INVALID');
 const endpoint='http://127.0.0.1:'+policy.port+'/mcp';
 return {async execute(name,args={},context={}){
  if(!ALLOWED.has(name))return {handled:false};
  if(MUTATIONS.has(name)){
   if(!REQ.test(context.requestId??''))throw fail('WORKSPACE_OWNER_REQUEST_ID_REQUIRED');
   if(name!=='workspace_target_reconcile'&&
      (typeof args.explicitUserAuthorization!=='string'||
      args.explicitUserAuthorization.trim().length<12))
     throw fail('WORKSPACE_EXPLICIT_AUTHORIZATION_REQUIRED');
  }
  const raw=(await readFileImpl(policy.authFile,'utf8')).trim();
  if(!AUTH.test(raw))throw fail('WORKSPACE_OWNER_CREDENTIAL_INVALID');
  const hash=MUTATIONS.has(name)?
   createHash('sha256').update('workspace-v1:'+name+':'+context.requestId).digest('hex'):null;
  const rekey=(name==='workspace_window_click'||name==='workspace_browser_click');
  const payload={...args,...(hash&&rekey?{requestId:'owrk-'+hash.slice(0,48)}:{})};
  // No fallback from owner-agent rejection to SYSTEM/Session 0 injection.
  let response;
  try{response=await fetchImpl(endpoint,{method:'POST',redirect:'error',headers:{
   'content-type':'application/json','x-rc-owner-workspace-auth':raw
  },body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',
     params:{name,arguments:payload}}),signal:AbortSignal.timeout(name==='workspace_browser_attach'?31000:name==='workspace_browser_inspect'?21000:name==='workspace_browser_click'?15000:6500)});}
  catch{throw fail('WORKSPACE_OWNER_AGENT_UNAVAILABLE');}
  if(response.status!==200)throw fail('WORKSPACE_OWNER_AGENT_DENIED');
  const txt=await response.text();
  if(txt.length>8_000_000)throw fail('WORKSPACE_OWNER_REPLY_LIMIT');
  let body;
  try{body=JSON.parse(txt);}catch{throw fail('WORKSPACE_OWNER_INVALID_RESPONSE');}
  if(body.jsonrpc!=='2.0'||body.id!==1)throw fail('WORKSPACE_OWNER_REJECTED');
  // Authenticated owner broker returns a narrow machine code on a native failure.
  // Preserve only known non-sensitive error classifications; never forward arbitrary
  // broker text, credential material, or introduce a Session-0 fallback.
  if(body.error){
   const allow=new Set(['WORKSPACE_DRIVER_UNAVAILABLE',
    'WORKSPACE_DRIVER_NOT_RUNNING','WORKSPACE_DRIVER_NOT_INSTALLED',
    'WORKSPACE_OWNER_SESSION_REQUIRED','WORKSPACE_TARGET_INVALID',
    'WORKSPACE_TARGET_RECONCILIATION_REQUIRED']);
   const message=body.error?.message;
   if(Number.isInteger(body.error?.code)&&allow.has(message))throw fail(message);
   throw fail('WORKSPACE_OWNER_REJECTED');
  }
  if(!body.result||body.result.isError===true)throw fail('WORKSPACE_OWNER_REJECTED');
  const result=body.result;
  if(!result.structuredContent||typeof result.structuredContent!=='object')
    throw fail('WORKSPACE_OWNER_STRUCTURED_RESULT_REQUIRED');
  if(Array.isArray(result.content)&&result.content.some(c=>c?.type==='image'))
    return {handled:true,value:{__mcpContent:result.content,__structuredContent:result.structuredContent}};
  return {handled:true,value:result.structuredContent};
 }};
}
