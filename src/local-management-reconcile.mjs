/**
 * Read-only native control reconciliation against the EXISTING Core WorkflowStore.
 *
 * No separate workflow database, replay, repair, shell, UI or network channel.
 * The same resident Core (or its correctly reopened SQLite store) must provide
 * workflow_export. Its integrity-checked event chain is evidence that one
 * explicit control intent was recorded, NOT that an external worker stopped.
 *
 * An ABSENT event is always UNRESOLVED (never NOT_APPLIED), because the original
 * request could still be in-flight or may have been lost before an ACK.
 */
import { createHash } from 'node:crypto';

const REASON_PREFIX = 'Explicit native Control Center action request=';
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const WORKFLOW_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const TARGET_KEYS = ['deviceId', 'profileId', 'configSha256', 'routeGeneration'];
const INTENTS = Object.freeze({ 'workflow.pause':'PAUSED', 'workflow.cancel':'CANCELLED' });
const ACTIONS = Object.freeze({ 'workflow.pause':'pause', 'workflow.cancel':'cancel' });
const MAX_EVENTS = 10000;
const fail = code => { const e = new Error(code); e.managementCode = code; throw e; };
const hasExactKeys = (v,names) => v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).length === names.length && names.every(k=>Object.hasOwn(v,k));
const safeId = v => typeof v === 'string' && REQUEST_ID.test(v);
const targetValid = v => hasExactKeys(v,TARGET_KEYS) &&
  typeof v.deviceId==='string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v.deviceId) &&
  typeof v.profileId==='string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v.profileId) &&
  typeof v.configSha256==='string' && HEX64.test(v.configSha256) &&
  Number.isSafeInteger(v.routeGeneration) && v.routeGeneration>=1;
const targetEqual = (a,b) => targetValid(a) && targetValid(b) &&
  TARGET_KEYS.every(k => a[k]===b[k]);
const sha = s => createHash('sha256').update(s,'utf8').digest('hex');

export function localManagementReason(requestId) {
  if (!safeId(requestId)) fail('MANAGEMENT_REQUEST_ID');
  return REASON_PREFIX + requestId;
}

export async function inspectLocalManagementEvent({target,readIdentity,workflowTools,
  workflowId,requestId,action,expectedRevision,timeoutMs=3000}={}) {
  if (!targetValid(target) || typeof readIdentity !== 'function' ||
      typeof workflowTools?.execute !== 'function' ||
      !Array.isArray(workflowTools.definitions) ||
      !workflowTools.definitions.some(d=>d.name==='workflow_export') ||
      typeof workflowId!=='string' || !WORKFLOW_ID.test(workflowId) ||
      !safeId(requestId) || !Object.hasOwn(ACTIONS,action) ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision<1 || expectedRevision>10000 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>10000)
    fail('MANAGEMENT_RECOVERY_ADAPTER_REQUIRED');

  const base={schema:1,action,workflowId,requestId,expectedRevision,
    evidenceKind:'CORE_VERIFIED_EVENT_CHAIN_ONLY',replayed:false,mutated:false};
  const result=(state,code,evidence=null) => ({...base,state,code,evidence});
  let current=false;
  try {current=targetEqual(readIdentity(),target);}
  catch {current=false;}
  if(!current)return result('UNVERIFIED','MANAGEMENT_TARGET_CHANGED');

  let timer;
  let exportResult;
  try {
    // The tool implementation is exactly workflow_export, not another command
    // selected by untrusted workflow content. It returns no transport output.
    exportResult=await Promise.race([
      Promise.resolve().then(()=>workflowTools.execute('workflow_export',{id:workflowId})),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('READ_TIMEOUT')),timeoutMs);}),
    ]);
  } catch {return result('UNVERIFIED','MANAGEMENT_JOURNAL_UNAVAILABLE');}
  finally {clearTimeout(timer);}

  try {
    if(!targetEqual(readIdentity(),target))return result('UNVERIFIED','MANAGEMENT_TARGET_CHANGED');
    const bundle=exportResult?.bundle;
    const state=bundle?.state;
    const rows=bundle?.events;
    if(bundle?.schema!==2 || state?.id!==workflowId ||
        state.device!==target.deviceId || state.configSha256!==target.configSha256 ||
        state.authority?.profileId!==target.profileId ||
        !Number.isSafeInteger(state.revision) || state.revision<1 ||
        !Array.isArray(rows) || rows.length!==state.revision || rows.length>MAX_EVENTS)
      return result('UNVERIFIED','MANAGEMENT_JOURNAL_INVALID');

    // Independent structural and content-digest check. Core already verifies
    // the whole event chain when exporting; fail closed if it changes en route.
    let previous='0'.repeat(64);
    const matches=[];
    const reason=localManagementReason(requestId);
    for(let index=0;index<rows.length;index++){
      const record=rows[index];
      if(typeof record?.body!=='string'||typeof record?.sha256!=='string'||!HEX64.test(record.sha256)||
         sha(record.body)!==record.sha256)return result('UNVERIFIED','MANAGEMENT_JOURNAL_INVALID');
      const body=JSON.parse(record.body);
      if(body?.schema!==1 || body.id!==workflowId ||
         body.seq!==index+1 || body.previous!==previous)
        return result('UNVERIFIED','MANAGEMENT_JOURNAL_INVALID');
      previous=record.sha256;
      if(body.kind==='control' && body.data?.reason===reason)
        matches.push({body,hash:record.sha256});
    }
    if(exportResult?.bundle?.headSha256!==undefined &&
        exportResult.bundle.headSha256!==previous)
      return result('UNVERIFIED','MANAGEMENT_JOURNAL_INVALID');
    if(matches.length>1)return result('CONFLICT','MANAGEMENT_REQUEST_MARKER_DUPLICATED');
    if(matches.length===0)return result('UNRESOLVED','MANAGEMENT_NO_EXACT_CONTROL_EVENT');
    const only=matches[0];
    if(only.body.seq!==expectedRevision+1 ||
       only.body.data?.action!==ACTIONS[action] ||
       only.body.data?.control?.intent!==INTENTS[action])
      return result('CONFLICT','MANAGEMENT_REQUEST_MARKER_MISMATCH');
    // Historic evidence of this control intent, not current scheduler state.
    return result('JOURNALED_APPLIED','MANAGEMENT_CONTROL_EVENT_VERIFIED',
      {schema:1,eventRevision:only.body.seq,eventSha256:only.hash,
       currentRevision:state.revision,workerTerminationVerified:false});
  } catch {return result('UNVERIFIED','MANAGEMENT_JOURNAL_INVALID');}
}
