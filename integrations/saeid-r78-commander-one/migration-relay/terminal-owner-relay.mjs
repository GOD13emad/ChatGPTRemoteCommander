// Private host integration, not an MCP tool. All backends/authorization/once-ledger
// are trusted host dependencies. This source never reads credentials or installs.
import {createHash,randomUUID} from 'node:crypto';
import {coreFingerprint} from './legacy-r75-adapter.mjs';
import {isTerminalId} from './terminal-id.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const sha=x=>createHash('sha256').update(x).digest('hex');
const copy=x=>structuredClone(x),idOk=isTerminalId;
const exact=(x,keys)=>plain(x)&&Object.keys(x).sort().join('|')===[...keys].sort().join('|');
const snapshotKeys=['id','pid','running','exitCode','signal','stdout','stderr','stdoutOffset','stderrOffset','nextStdoutOffset','nextStderrOffset','stdoutRemainingChars','stderrRemainingChars','maxChars','truncated','interactive','autoClose'];
export const TERMINAL_METADATA_PROBE=Object.freeze({consume:false,waitMs:0,stdoutOffset:Number.MAX_SAFE_INTEGER,stderrOffset:Number.MAX_SAFE_INTEGER,maxChars:1});
function decodeProbe(raw,rpcId,terminalId){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>8192)fail('MIGRATION_TERMINAL_PROBE_UNPROVEN');
 let envelope;try{envelope=JSON.parse(raw);}catch{fail('MIGRATION_TERMINAL_PROBE_UNPROVEN');}
 if(!plain(envelope)||envelope.jsonrpc!=='2.0'||envelope.id!==rpcId||envelope.error||!plain(envelope.result))fail('MIGRATION_TERMINAL_PROBE_UNPROVEN');
 const result=envelope.result,content=result.content;
 if(!Array.isArray(content)||content.length!==1||!exact(content[0],['type','text'])||content[0].type!=='text')fail('MIGRATION_TERMINAL_PROBE_UNPROVEN');
 if(result.isError===true){
  if(content[0].text===`unknown terminal session: ${terminalId}`&&result.structuredContent===undefined)return {owner:false};
  fail('MIGRATION_TERMINAL_PROBE_UNPROVEN');
 }
 const s=result.structuredContent;
 if(result.isError!==false||!exact(s,snapshotKeys)||s.id!==terminalId||!Number.isSafeInteger(s.pid)||s.pid<=0||typeof s.running!=='boolean'
  ||!(s.exitCode===null||Number.isSafeInteger(s.exitCode))||!(s.signal===null||typeof s.signal==='string'&&/^SIG[A-Z0-9]{1,20}$/.test(s.signal))
  ||s.stdout!==''||s.stderr!==''||s.nextStdoutOffset!==null||s.nextStderrOffset!==null||s.stdoutRemainingChars!==0||s.stderrRemainingChars!==0
  ||!Number.isSafeInteger(s.stdoutOffset)||s.stdoutOffset<0||!Number.isSafeInteger(s.stderrOffset)||s.stderrOffset<0||s.maxChars!==1
  ||typeof s.truncated!=='boolean'||typeof s.interactive!=='boolean'||s.autoClose!==!s.interactive)fail('MIGRATION_TERMINAL_PROBE_UNPROVEN');
 let text;try{text=JSON.parse(content[0].text);}catch{fail('MIGRATION_TERMINAL_PROBE_UNPROVEN');}
 if(JSON.stringify(text)!==JSON.stringify(s))fail('MIGRATION_TERMINAL_PROBE_UNPROVEN');
 return {owner:true,terminalPid:s.pid,running:s.running,interactive:s.interactive};
}
function validateOriginal(request){
 if(!exact(request,['name','arguments'])||!plain(request.arguments)||!idOk(request.arguments.id))fail('MIGRATION_TERMINAL_REQUEST');
 const a=request.arguments;
 if(request.name==='read_terminal'){
  if(Object.keys(a).some(k=>!['id','consume','stdoutOffset','stderrOffset','maxChars','waitMs'].includes(k)))fail('MIGRATION_TERMINAL_REQUEST');
  if(a.consume!==false||!Number.isSafeInteger(a.stdoutOffset)||a.stdoutOffset<0||!Number.isSafeInteger(a.stderrOffset)||a.stderrOffset<0
   ||!Number.isSafeInteger(a.maxChars)||a.maxChars<1||a.maxChars>4096||!(a.waitMs===undefined||a.waitMs===0))fail('MIGRATION_TERMINAL_REQUEST');
 }else if(request.name==='send_terminal'){
  if(Object.keys(a).some(k=>!['id','input','newline'].includes(k))||typeof a.input!=='string'||!a.input.isWellFormed()||Buffer.byteLength(a.input)>65536
   ||!(a.newline===undefined||typeof a.newline==='boolean'))fail('MIGRATION_TERMINAL_REQUEST');
 }else fail('MIGRATION_TERMINAL_REQUEST_ALLOWLIST');
}
export function createTerminalOwnerRelay({backends,authorizeFreshRequest,consumeFreshIntent,clock=Date.now}){
 if(!Array.isArray(backends)||backends.length!==2||typeof authorizeFreshRequest!=='function'||typeof consumeFreshIntent!=='function'||typeof clock!=='function')fail('MIGRATION_TERMINAL_HOST_DEPENDENCY');
 const configured=backends.map(b=>{if(!exact(b,['id','expectedCore','readIdentity','callMcp'])||!['legacy','candidate'].includes(b.id)||typeof b.readIdentity!=='function'||typeof b.callMcp!=='function')fail('MIGRATION_TERMINAL_HOST_DEPENDENCY');
  return {...b,expectedCore:copy(b.expectedCore),fingerprint:coreFingerprint(b.expectedCore)};});
 if(new Set(configured.map(b=>b.id)).size!==2||configured[0].expectedCore.device!==configured[1].expectedCore.device||configured[0].expectedCore.port===configured[1].expectedCore.port)fail('MIGRATION_TERMINAL_BACKEND_SET');
 const attempted=new Set(); // Additional same-process no-replay latch; not durable authority.
 async function fresh(b){let identity;try{identity=await b.readIdentity();}catch{fail('MIGRATION_TERMINAL_BACKEND_IDENTITY_UNPROVEN');}
  if(!exact(identity,['core','observedAtMs'])||coreFingerprint(identity.core)!==b.fingerprint||!Number.isSafeInteger(identity.observedAtMs)||identity.observedAtMs>clock()||clock()-identity.observedAtMs>5000)fail('MIGRATION_TERMINAL_BACKEND_IDENTITY_CHANGED');}
 return Object.freeze({
  async routeFresh({requestKey,request,authorization}){
   if(typeof requestKey!=='string'||!/^[a-f0-9]{64}$/.test(requestKey))fail('MIGRATION_TERMINAL_FRESH_REQUEST_KEY');
   request=copy(request);validateOriginal(request);
   if(await authorizeFreshRequest({requestKey,request:copy(request),authorization})!==true)fail('MIGRATION_TERMINAL_CURRENT_AUTHORIZATION_REQUIRED');
   const observations=[];
   for(const b of configured){
    await fresh(b);const rpcId=randomUUID(),body={jsonrpc:'2.0',id:rpcId,method:'tools/call',params:{name:'read_terminal',arguments:{id:request.arguments.id,...TERMINAL_METADATA_PROBE}}};
    let raw;try{raw=await b.callMcp({expectedCore:copy(b.expectedCore),body:JSON.stringify(body),purpose:'METADATA_OWNER_PROBE_ONLY'});}catch{fail('MIGRATION_TERMINAL_PROBE_UNPROVEN');}
    const observation=decodeProbe(raw,rpcId,request.arguments.id);await fresh(b);observations.push({backend:b,...observation});
   }
   const owners=observations.filter(x=>x.owner);if(owners.length!==1)fail(owners.length?'MIGRATION_TERMINAL_OWNER_AMBIGUOUS':'MIGRATION_TERMINAL_OWNER_UNKNOWN');
   const chosen=owners[0].backend;
   if(request.name==='send_terminal'&&(!owners[0].running||!owners[0].interactive))fail('MIGRATION_TERMINAL_NOT_INTERACTIVE');
   // Revalidate both generations before committing any original request.
   for(const b of configured)await fresh(b);
   if(await authorizeFreshRequest({requestKey,request:copy(request),authorization})!==true)fail('MIGRATION_TERMINAL_AUTHORIZATION_CHANGED');
   const requestDigest=sha(JSON.stringify({requestKey,request,ownerFingerprint:chosen.fingerprint}));
   if(attempted.has(requestKey))fail('MIGRATION_TERMINAL_INTENT_ALREADY_CONSUMED');
   attempted.add(requestKey);
   let claim;try{claim=await consumeFreshIntent({requestKey,requestDigest,ownerFingerprint:chosen.fingerprint});}
   catch{fail('MIGRATION_TERMINAL_INTENT_UNCERTAIN_NO_REPLAY');}
   if(!exact(claim,['consumed','requestDigest'])||claim.consumed!==true||claim.requestDigest!==requestDigest)fail('MIGRATION_TERMINAL_INTENT_ALREADY_CONSUMED');
   const rpcId=randomUUID(),body={jsonrpc:'2.0',id:rpcId,method:'tools/call',params:request};
   try{
    // The host transport must bind its private credential and the exact expected
    // generation. It must not silently re-resolve or retry another backend.
    const opaqueResponse=await chosen.callMcp({expectedCore:copy(chosen.expectedCore),body:JSON.stringify(body),purpose:'ONE_FRESH_ORIGINAL_REQUEST'});
    if(typeof opaqueResponse!=='string'||Buffer.byteLength(opaqueResponse)>8*1024*1024)fail('MIGRATION_TERMINAL_ORIGINAL_RESPONSE_BOUND');
    return {status:'ONE_FRESH_REQUEST_FORWARDED',ownerBackend:chosen.id,ownerFingerprint:chosen.fingerprint,requestDigest,opaqueResponse,
      oldCoreStopped:false,replayed:false,globalDrainRequired:false,productionBinding:'HOST_INTEGRATION_NOT_QUALIFIED'};
   }catch{fail('MIGRATION_TERMINAL_DISPATCH_UNCERTAIN_NO_REPLAY');}
  }
 });
}
