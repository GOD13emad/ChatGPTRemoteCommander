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
 'workspace_browser_click','workspace_target_reconcile',
 'workspace_agentos_plan','workspace_native_ui_observe','workspace_native_ui_set_value','workspace_native_ui_invoke'
]);
const MUTATIONS=new Set(['workspace_window_click','workspace_browser_attach',
 'workspace_browser_click','workspace_target_reconcile','workspace_native_ui_set_value','workspace_native_ui_invoke']);
const AUTH=/^[a-f0-9]{64}$/;
const REQ=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const fail=(c)=>Object.assign(new Error(c),{code:c});
// Only reviewed, non-sensitive machine codes cross the authenticated owner boundary.
const SAFE_OWNER_ERRORS=new Set(["WORKSPACE_ARGUMENTS_INVALID","WORKSPACE_TARGET_INVALID","WORKSPACE_FRESH_SNAPSHOT_REQUIRED","WORKSPACE_EXPLICIT_AUTHORIZATION_REQUIRED","WORKSPACE_DUPLICATE_REQUEST_NO_REPLAY","WORKSPACE_TARGET_BUSY","WORKSPACE_TARGET_RECONCILIATION_REQUIRED","WORKSPACE_GUI_INPUT_POLICY_DENIED","WORKSPACE_GUI_PREVIEW_POLICY_DENIED","WORKSPACE_OWNER_SESSION_REQUIRED","WORKSPACE_DRIVER_UNAVAILABLE","WORKSPACE_DRIVER_NOT_RUNNING","WORKSPACE_DRIVER_NOT_INSTALLED","WORKSPACE_SEAT_INVALID","WORKSPACE_POWER_MODE_DISABLED","WORKSPACE_BROWSER_CONTROL_DISABLED","WORKSPACE_BROWSER_INPUT_POLICY_DENIED","WORKSPACE_GUI_CONTROL_DISABLED","WORKSPACE_BINDING_INVALID","WORKSPACE_ACTION_UNKNOWN","WORKSPACE_BROWSER_ACTION_UNKNOWN","WORKSPACE_TARGET_GONE_NOT_PROVEN","WORKSPACE_TARGET_GONE_PROOF_DENIED","WORKSPACE_DETERMINATION_INVALID","WORKSPACE_PID_INVALID","WORKSPACE_PREVIEW_INVALID_FRAME","WORKSPACE_PREVIEW_INVALID_PNG","WORKSPACE_TOOL_UNKNOWN","GUI_CURRENT_TASK_AUTHORIZATION_REQUIRED","GUI_OWNER_APPROVAL_PENDING","GUI_OWNER_DENIED","GUI_OWNER_REVOKED","GUI_OWNER_SESSION_MISMATCH","GUI_FOREGROUND_NONINTERFERENCE_UNPROVEN","GUI_INPUT_PROTECTION_NOT_ACQUIRED","GUI_NATIVE_OUTCOME_UNKNOWN","AGENTOS_NATIVE_OWNER_WINDOWS_REQUIRED","AGENTOS_NATIVE_APPLICATION_INVALID","BROWSER_SETUP_REQUIRED","BROWSER_PREPARE_REQUIRED","CONSENT_REQUIRED","WINDOW_MISMATCH","OWNER_REVOKED","ACTION_UNCERTAIN","BUSY"]);
export function createOwnerWorkspaceProxy({config,fetchImpl=globalThis.fetch,readFileImpl=readFile,timeoutSignal=AbortSignal.timeout}={}){
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
  const rekey=(name==='workspace_window_click'||name==='workspace_browser_click'||name==='workspace_native_ui_set_value'||name==='workspace_native_ui_invoke');
  const payload={...args,...(hash&&rekey?{requestId:'owrk-'+hash.slice(0,48)}:{})};
  // No fallback from owner-agent rejection to SYSTEM/Session 0 injection.
  let response;
  try{response=await fetchImpl(endpoint,{method:'POST',redirect:'error',headers:{
   'content-type':'application/json','x-rc-owner-workspace-auth':raw
  },body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',
     params:{name,arguments:payload}}),signal:timeoutSignal(
      name==='workspace_browser_attach'?31000:
      name==='workspace_browser_inspect'?21000:
      name==='workspace_browser_click'?15000:
      name==='workspace_native_ui_observe'?14000:
      (name==='workspace_native_ui_set_value'||name==='workspace_native_ui_invoke')?22000:6500)});}
  catch{throw fail('WORKSPACE_OWNER_AGENT_UNAVAILABLE');}
  if(response.status!==200)throw fail('WORKSPACE_OWNER_AGENT_DENIED');
  const txt=await response.text();
  if(txt.length>8_000_000)throw fail('WORKSPACE_OWNER_REPLY_LIMIT');
  let body;
  try{body=JSON.parse(txt);}catch{throw fail('WORKSPACE_OWNER_INVALID_RESPONSE');}
  if(body?.jsonrpc!=='2.0')throw fail('WORKSPACE_OWNER_INVALID_RESPONSE');
  if(body.error||body.result?.isError===true){
    if(body.id!==1&&body.id!==null)throw fail('WORKSPACE_OWNER_INVALID_RESPONSE');
    // Authenticated owner may supply a machine code, not a human-readable
    // message. Free text / URLs / titles / secrets never cross this boundary.
    const code=body.error?.message??body.result?.structuredContent?.code;
    if(typeof code==='string'&&SAFE_OWNER_ERRORS.has(code))
      throw fail(code);
    throw fail('WORKSPACE_OWNER_REJECTED');
  }
  if(body.id!==1||!body.result)throw fail('WORKSPACE_OWNER_REJECTED');
  const result=body.result;
  if(!result.structuredContent||typeof result.structuredContent!=='object')
    throw fail('WORKSPACE_OWNER_STRUCTURED_RESULT_REQUIRED');
  if(Array.isArray(result.content)&&result.content.some(c=>c?.type==='image'))
    return {handled:true,value:{__mcpContent:result.content,__structuredContent:result.structuredContent}};
  return {handled:true,value:result.structuredContent};
 }};
}
