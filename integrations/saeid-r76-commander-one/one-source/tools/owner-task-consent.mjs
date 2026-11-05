// Exact-window owner-native consent for one non-replayable mutation.
// Explicit chat authorization is only an intent hint: it never grants input.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
const execFileAsync=promisify(execFile);
const requestPattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const tokenPattern=/^s[0-9a-f]{8}:[0-9]+$/;
const operations=new Set(['workspace_window_click','workspace_browser_click',
 'workspace_native_ui_set_value','workspace_native_ui_invoke']);
const code=c=>Object.assign(new Error(c),{code:c});
const dig=s=>createHash('sha256').update(s,'utf8').digest('hex');
const integer=v=>Number.isSafeInteger(v)&&v>0;
export function taskIntent(input,operation,{ownerSid,ownerSessionId,ownerPid}){
 if(!operations.has(operation))throw code('WORKSPACE_NATIVE_CONSENT_SCOPE_INVALID');
 if(!input||!integer(input.pid)||!integer(input.windowId)||
    !requestPattern.test(input.requestId||'')||
    typeof input.explicitUserAuthorization!=='string'||
    input.explicitUserAuthorization.trim().length<12)
   throw code('WORKSPACE_NATIVE_CONSENT_TASK_INVALID');
 if(operation==='workspace_window_click'&&!tokenPattern.test(input.elementToken||''))
   throw code('WORKSPACE_BINDING_INVALID');
 if(operation==='workspace_browser_click'&&
    !['targetId','tabId','ref'].every(k=>typeof input[k]==='string'&&input[k].length>0))
   throw code('WORKSPACE_BINDING_INVALID');
 const operationKey=({
  workspace_window_click:'window_click',
  workspace_browser_click:'browser_click',
  workspace_native_ui_set_value:'native_set_value',
  workspace_native_ui_invoke:'native_invoke'
 })[operation];
 let element;
 if(operationKey==='window_click')element=input.elementToken;
 else if(operationKey==='browser_click')element=[input.targetId,input.tabId,input.ref].join(':');
 else {
  if(!['brave','chrome','msedge','firefox'].includes(input.application)||
     !/^[a-f0-9]{24}$/.test(input.fingerprint||'')||
     typeof input.controlName!=='string'||input.controlName.length<1||
     input.controlName.length>150||typeof input.foregroundChangeAuthorized!=='boolean')
    throw code('WORKSPACE_BINDING_INVALID');
  const valueHash=operationKey==='native_set_value'?
    (typeof input.value==='string'&&input.value.length>=1&&input.value.length<=1024?
      dig(input.value):null):null;
  if(operationKey==='native_set_value'&&!valueHash)throw code('WORKSPACE_BINDING_INVALID');
  element=JSON.stringify({application:input.application,fingerprint:input.fingerprint,
    controlName:input.controlName,foregroundChangeAuthorized:input.foregroundChangeAuthorized,
    valueHash});
 }
 const displayName=operationKey==='window_click'?('Snapshot element '+input.elementToken):
   operationKey==='browser_click'?('Browser target '+input.ref):input.controlName;
 const controlDisplay=String(displayName||'').replace(/[\x00-\x1f\x7f\r\n]/g,' ').trim().slice(0,95);
 if(controlDisplay.length<1)throw code('WORKSPACE_BINDING_INVALID');
 const binding={principal:ownerSid,session:ownerSessionId,ownerPid,
   pid:input.pid,windowId:input.windowId,operation:operationKey,
   requestId:input.requestId,element,controlDisplay};
 return Object.freeze({...binding,requestDigest:dig(JSON.stringify(binding))});
}
export async function windowsOwnerPrompt(binding,{
 scriptPath,expectedScriptSha,
 readFileImpl=readFile,execFileImpl=execFileAsync,powershell='pwsh.exe'
}={}){
 if(process.platform!=='win32')throw code('WORKSPACE_NATIVE_CONSENT_PLATFORM_UNSUPPORTED');
 if(!path.isAbsolute(scriptPath||'')||!/^[a-f0-9]{64}$/.test(expectedScriptSha||''))
   throw code('WORKSPACE_NATIVE_CONSENT_HELPER_INVALID');
 let raw;
 try{raw=await readFileImpl(scriptPath)}catch{throw code('WORKSPACE_NATIVE_CONSENT_HELPER_UNAVAILABLE')}
 const actual=createHash('sha256').update(raw).digest('hex');
 if(actual!==expectedScriptSha)throw code('WORKSPACE_NATIVE_CONSENT_HELPER_CHANGED');
 let stdout;
 try{
  ({stdout}=await execFileImpl(powershell,[
   '-NoLogo','-NoProfile','-STA','-File',scriptPath,
   '-OwnerPid',String(binding.ownerPid),
   '-TargetPid',String(binding.pid),
   '-WindowId',String(binding.windowId),
   '-Operation',binding.operation,
   '-RequestDigest',binding.requestDigest,
   '-TargetControl',binding.controlDisplay,
   '-TimeoutSeconds','45'
  ],{windowsHide:false,shell:false,timeout:54000,maxBuffer:8192,encoding:'utf8'}));
 }catch(e){
  const stderr=String(e?.stderr??'');
  if(/\bCONSENT_WINDOW_MISMATCH\b/.test(stderr))throw code('WORKSPACE_WINDOW_MISMATCH');
  if(/\bCONSENT_OWNER_SESSION_MISMATCH\b/.test(stderr))throw code('WORKSPACE_NATIVE_CONSENT_OWNER_MISMATCH');
  if(e?.killed===true||e?.signal==='SIGTERM')throw code('WORKSPACE_NATIVE_CONSENT_EXPIRED');
  throw code('WORKSPACE_NATIVE_CONSENT_UNAVAILABLE');
 }
 try{return JSON.parse(String(stdout).trim())}
 catch{throw code('WORKSPACE_NATIVE_CONSENT_RESPONSE_INVALID')}
}
export function createOwnerTaskConsentGate({
 ownerSid,ownerSessionId,ownerPid=process.pid,
 now=Date.now,
 prompt,
 onResult=()=>{}
}={}){
 if(!/^S-1-[0-9-]+$/.test(ownerSid||'')||!integer(ownerSessionId)||!integer(ownerPid)||
    typeof prompt!=='function')throw code('WORKSPACE_NATIVE_CONSENT_CONFIG_INVALID');
 const attempted=new Set(),targetBusy=new Set();
 return Object.freeze({async runApproved(operation,input,action){
  if(typeof action!=='function')throw code('WORKSPACE_NATIVE_CONSENT_ACTION_INVALID');
  const binding=taskIntent(input,operation,{ownerSid,ownerSessionId,ownerPid});
  const key=binding.pid+':'+binding.windowId;
  if(attempted.has(binding.requestId))throw code('WORKSPACE_DUPLICATE_REQUEST_NO_REPLAY');
  if(targetBusy.has(key))throw code('WORKSPACE_TARGET_BUSY');
  attempted.add(binding.requestId);targetBusy.add(key);
  try{
   const at=now();
   let decision;
   try{decision=await prompt(binding)}catch(e){
    const reason=typeof e?.code==='string'&&/^WORKSPACE_[A-Z0-9_]{1,80}$/.test(e.code)?
      e.code:'WORKSPACE_NATIVE_CONSENT_UNAVAILABLE';
    onResult({requestDigest:binding.requestDigest,code:reason});
    throw code(reason);
   }
   const status=String(decision?.status??'');
   if(status==='WINDOW_MISMATCH')throw code('WORKSPACE_WINDOW_MISMATCH');
   if(status==='DENIED')throw code('WORKSPACE_NATIVE_CONSENT_DENIED');
   if(status==='EXPIRED')throw code('WORKSPACE_NATIVE_CONSENT_EXPIRED');
   if(status!=='APPROVED'||decision?.approved!==true)
      throw code('WORKSPACE_NATIVE_CONSENT_RESPONSE_INVALID');
   if(decision.parentPid!==binding.ownerPid||decision.targetPid!==binding.pid||
      decision.windowId!==binding.windowId||decision.operation!==binding.operation||
      decision.requestDigest!==binding.requestDigest||
      decision.sessionId!==ownerSessionId||decision.ownerSid!==ownerSid)
      throw code('WORKSPACE_NATIVE_CONSENT_BINDING_MISMATCH');
   if(!Number.isSafeInteger(decision.approvedAtEpochMs)||
      decision.approvedAtEpochMs<at||decision.approvedAtEpochMs>now()+1000||
      now()-decision.approvedAtEpochMs>15000||now()-at>55000)
      throw code('WORKSPACE_NATIVE_CONSENT_EXPIRED');
   onResult({requestDigest:binding.requestDigest,code:'WORKSPACE_NATIVE_CONSENT_GRANTED'});
   // No local replay. Downstream target journal owns uncertain effects.
   return await action();
  }finally{targetBusy.delete(key);}
 }});
}
