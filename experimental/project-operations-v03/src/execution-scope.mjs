// BUILD-V03: explicit user pause. This module cannot enable game/video or deploy.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {types} from 'node:util';

const keys=['schema','generation','revision','authority','gameEnabled','videoEnabled','coreBuildEnabled','browserMonitorBuildEnabled','runtimeInstalled','automaticPromotion'];
const fail=code=>{throw Object.assign(new Error(code),{code});};
function plain(value,required) {
  if(!value || typeof value!=='object' || types.isProxy(value) || Object.getPrototypeOf(value)!==Object.prototype) return false;
  const props=Object.getOwnPropertyDescriptors(value),actual=Reflect.ownKeys(props);
  return actual.length===required.length && actual.every(k=>typeof k==='string' && required.includes(k) && Object.hasOwn(props[k],'value'));
}
function validPolicy(policy) {
  return plain(policy,keys) && policy.schema===1 && Number.isSafeInteger(policy.generation) && policy.generation>0
    && typeof policy.revision==='string' && policy.revision.length>0 && policy.revision.length<=128
    && typeof policy.authority==='string' && policy.authority.length>0 && policy.authority.length<=256
    && policy.gameEnabled===false && policy.videoEnabled===false
    && typeof policy.coreBuildEnabled==='boolean' && typeof policy.browserMonitorBuildEnabled==='boolean'
    && policy.runtimeInstalled===false && policy.automaticPromotion===false;
}
export function evaluateExecutionScope(task,policy) {
  const answer=(allowed,code)=>Object.freeze({allowed,code,promotionAllowed:false,runtimeActivationAllowed:false});
  if(!plain(task,['category']) || !validPolicy(policy)) return answer(false,'SCOPE_INVALID');
  if(task.category==='GAME' || task.category==='VIDEO') return answer(false,'USER_PAUSED');
  if(task.category==='CORE_BUILD') return answer(policy.coreBuildEnabled,'CORE_BUILD_ONLY');
  if(task.category==='BROWSER_MONITOR_BUILD') return answer(policy.browserMonitorBuildEnabled,'BROWSER_MONITOR_BUILD_ONLY');
  return answer(false,'CATEGORY_NOT_ADMITTED');
}
export async function dispatchScopedTask(task,policy,executor) {
  const admission=evaluateExecutionScope(task,policy);
  if(!admission.allowed) return admission;
  if(typeof executor!=='function') return Object.freeze({...admission,allowed:false,code:'BUILD_ADAPTER_MISSING'});
  // Explicit injected build adapter only. No CLI, model, GUI or deployment adapter.
  return Object.freeze({...admission,result:await executor()});
}
export function loadExecutionScope(file,expectedSha256) {
  if(typeof file!=='string' || !path.isAbsolute(file)) fail('SCOPE_ABSOLUTE_PATH_REQUIRED');
  if(typeof expectedSha256!=='string' || !/^[a-f0-9]{64}$/.test(expectedSha256)) fail('SCOPE_EXPECTED_HASH_REQUIRED');
  let handle=null,primary=null,result;
  try {
    const before=fs.lstatSync(file);
    if(!before.isFile() || before.isSymbolicLink() || before.nlink!==1 || before.size>8192) fail('SCOPE_FILE_NOT_ADMITTED');
    handle=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
    const held=fs.fstatSync(handle);
    if(held.dev!==before.dev || held.ino!==before.ino || held.size!==before.size || held.nlink!==1 || !held.isFile()) fail('SCOPE_FILE_CHANGED');
    // A growing file must not allocate or read without a finite cap.
    const buffer=Buffer.alloc(8193);let offset=0;
    while(offset<buffer.length) {
      const count=fs.readSync(handle,buffer,offset,buffer.length-offset,offset);
      if(count===0) break;
      offset+=count;
    }
    if(offset>8192) fail('SCOPE_FILE_TOO_LARGE');
    const recheck=()=>{
      for(const stat of [fs.fstatSync(handle),fs.lstatSync(file)])
        if(stat.dev!==held.dev || stat.ino!==held.ino || stat.size!==held.size || stat.nlink!==1 || stat.mtimeMs!==held.mtimeMs || stat.ctimeMs!==held.ctimeMs || !stat.isFile() || stat.isSymbolicLink()) fail('SCOPE_FILE_CHANGED');
    };
    recheck();
    if(offset!==held.size) fail('SCOPE_FILE_CHANGED');
    const bytes=buffer.subarray(0,offset);
    const digest=createHash('sha256').update(bytes).digest('hex');
    if(digest!==expectedSha256) fail('SCOPE_HASH_MISMATCH');
    const policy=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!validPolicy(policy)) fail('SCOPE_INVALID');
    recheck();
    result=Object.freeze({policy:Object.freeze(policy),sha256:digest,privacyAcceptance:'NOT_ESTABLISHED_BY_POLICY_READ'});
  } catch(error) {primary=error;}
  finally {
    if(handle!==null) try {fs.closeSync(handle);} catch(error) {
      if(primary) primary.secondaryCloseFailure=Object.freeze({code:error.code??'SCOPE_CLOSE_FAILED',message:String(error.message).slice(0,256)});
      else primary=error;
    }
  }
  if(primary) throw primary;
  return result;
}
