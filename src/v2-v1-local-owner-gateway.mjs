// Native same-UID Commander V2 local gateway to the EXISTING V1 MCP.
// This is NOT an HTTP/MCP tool. Do not import it into the noauth V2 server.
// The logged-in OS user already possesses V1's native permissions; V1 still
// validates every tool and enforces its own GUI/browser/session consent.
import {randomUUID} from 'node:crypto';
import {userInfo} from 'node:os';
import {bindV2V1MutationId} from './v2-v1-idempotency-bindings.mjs';

const TOOL=/^[a-z][a-z0-9_]{0,79}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
function assertNativeOwner(){
 if(process.platform!=='linux'||typeof process.getuid!=='function'||
    process.getuid()===0||process.getuid()!==userInfo().uid)
  fail('V2_LOCAL_OWNER_UID_REQUIRED');
}
function checkPayload(obj){
 if(!plain(obj))fail('V2_LOCAL_ARGS_INVALID');
 const body=JSON.stringify(obj);
 if(typeof body!=='string'||Buffer.byteLength(body)>8192)
   fail('V2_LOCAL_ARGS_TOO_LARGE');
 return structuredClone(obj);
}
export function createV2V1LocalOwnerGateway({
 rpc,attestLocalOwner=assertNativeOwner,newId=randomUUID
}={}){
 if(typeof rpc!=='function'||typeof attestLocalOwner!=='function'||
    typeof newId!=='function')fail('V2_LOCAL_TRUSTED_DEPENDENCIES_REQUIRED');
 async function catalog(){
  attestLocalOwner();
  const result=await rpc('tools/list');
  const tools=result?.tools;
  if(!Array.isArray(tools)||tools.length<1||tools.length>256||
     tools.some(t=>!plain(t)||!TOOL.test(t.name)))
    fail('V2_LOCAL_V1_CATALOG_INVALID');
  return tools;
 }
 return Object.freeze({
  async list(){
   return Object.freeze((await catalog()).map(t=>t.name));
  },
  async call({tool,args={},requestId}={}){
   attestLocalOwner();
   if(!TOOL.test(tool??''))fail('V2_LOCAL_TOOL_INVALID');
   const payload=checkPayload(args);
   const id=requestId??newId();
   if(!UUID.test(id))fail('V2_LOCAL_ID_INVALID');
   const definitions=await catalog();
   const bound=bindV2V1MutationId({tool,args:payload,requestId:id,toolDefinitions:definitions});
   attestLocalOwner();
   // Only the already-installed V1's native policy runs this tool.
   const result=await rpc('tools/call',{name:tool,arguments:bound});
   if(!plain(result))fail('V2_LOCAL_V1_RESULT_INVALID');
   return Object.freeze({requestId:id,tool,result});
  }
 });
}
