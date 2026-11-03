// Additive bridge: policy projections -> durable monitor, never OS effects.
import path from 'node:path';
import {types} from 'node:util';
import {evaluateExecutionScope} from './execution-scope.mjs';
import {retrieveProjectContext,scheduleReadyTasks,detectProjectStall,classifyErrorRecurrence,
  reconcileUncertainEffect,arbitrateResources,verifyThreeHostIdentity,evaluateUpgradeReadiness,
  evaluateMeaningfulNotification} from './project-autopilot.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const definitions=Object.freeze({
  'DEV-01':{name:'Resumable evidence context',evaluate:retrieveProjectContext},
  'DEV-02':{name:'Dependency-ready tasks',evaluate:scheduleReadyTasks},
  'DEV-03':{name:'Stall observer',evaluate:detectProjectStall},
  'DEV-04':{name:'Error recurrence guard',evaluate:classifyErrorRecurrence},
  'DEV-05':{name:'Uncertain-effect reconciliation',evaluate:reconcileUncertainEffect},
  'DEV-06':{name:'Resource and human-busy arbitration',evaluate:arbitrateResources},
  'DEV-07':{name:'Exact three-host declaration check',evaluate:verifyThreeHostIdentity},
  'DEV-08':{name:'Rollback readiness, not deployment',evaluate:evaluateUpgradeReadiness},
  'DEV-09':{name:'Game cost fuse - user paused',evaluate:null},
  'DEV-10':{name:'Meaningful-delta notification',evaluate:evaluateMeaningfulNotification}
});
function copyJson(input) {
  let nodes=0;const seen=new Set();
  function visit(value,depth) {
    if(++nodes>4096 || depth>12) fail('FEATURE_INPUT_LIMIT');
    if(value===null || typeof value==='boolean') return value;
    if(typeof value==='number') {if(!Number.isFinite(value)) fail('FEATURE_INPUT_INVALID');return value;}
    if(typeof value==='string') {if(value.length>4096) fail('FEATURE_INPUT_LIMIT');return value;}
    if(!value || typeof value!=='object' || types.isProxy(value) || seen.has(value)) fail('FEATURE_INPUT_INVALID');
    seen.add(value);const p=Object.getPrototypeOf(value),props=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(props);
    let result;
    if(Array.isArray(value)) {
      const length=props.length?.value;
      if(p!==Array.prototype || !Number.isSafeInteger(length) || length>128 || names.length!==length+1) fail('FEATURE_INPUT_INVALID');
      result=[];
      for(let i=0;i<length;i++) {const field=props[String(i)];if(!field || !Object.hasOwn(field,'value') || !field.enumerable) fail('FEATURE_INPUT_INVALID');result.push(visit(field.value,depth+1));}
    } else {
      if(p!==Object.prototype && p!==null || names.length>64) fail('FEATURE_INPUT_INVALID');
      result=Object.create(null);
      for(const k of names) {const field=props[k];if(typeof k!=='string' || k.length>128 || !Object.hasOwn(field,'value') || !field.enumerable) fail('FEATURE_INPUT_INVALID');result[k]=visit(field.value,depth+1);}
    }
    seen.delete(value);return result;
  }
  return visit(input,0);
}
function projection(policy) {
  const d=policy.decision;
  if(d==='UNPROVEN') return 'UNPROVEN';
  if(['STOP','RECONCILE_REQUIRED','DEEP_RESEARCH_REQUIRED'].includes(d)) return 'DENY';
  if(['USER_PAUSED','EXPECTED_WAIT','NEW_AUTHORIZATION_REQUIRED','SUPPRESS_UNCHANGED_OR_NO_DECISION_VALUE'].includes(d)
    || typeof d==='string' && (d.startsWith('PAUSE_') || d.startsWith('WAIT'))) return 'PAUSED';
  // ALLOW denotes a proposal only; an unknown decision never implies permission.
  if(['CONTEXT_READY','READY_SUGGESTIONS','COMPLETE_OBSERVED','RUNNING_OBSERVED','RECORD_AND_DIAGNOSE',
    'COMPLETE_RECEIPT_OBSERVED','RESOURCE_SUGGESTIONS_READY','IDENTITY_DECLARATIONS_MATCH',
    'READY_FOR_SEPARATE_EXECUTION_GATE','NOTIFY_RECOMMENDED'].includes(d)) return 'ALLOW';
  return 'UNPROVEN';
}
export function createProjectFeatureService(options) {
  if(!options || typeof options!=='object' || types.isProxy(options) || Object.getPrototypeOf(options)!==Object.prototype) fail('FEATURE_OPTIONS_INVALID');
  const fields=Object.getOwnPropertyDescriptors(options),names=Reflect.ownKeys(fields);
  if(names.some(k=>typeof k!=='string') || names.sort().join(',')!=='binding,monitor,scope'
    || Object.values(fields).some(p=>!Object.hasOwn(p,'value') || !p.enumerable)) fail('FEATURE_OPTIONS_INVALID');
  const {monitor,scope,binding}=Object.fromEntries(names.map(k=>[k,fields[k].value]));
  const adapter=monitor && !types.isProxy(monitor) && Object.getOwnPropertyDescriptor(monitor,'recordFeatureDecision')?.value;
  if(typeof adapter!=='function') fail('FEATURE_DURABLE_ADAPTER_MISSING');
  const pinnedScope=copyJson(scope);
  // copyJson uses null-prototype records; scope verifier requires a plain record.
  if(!evaluateExecutionScope({category:'CORE_BUILD'},{...pinnedScope}).allowed) fail('FEATURE_SCOPE_NOT_ADMITTED');
  const identity=copyJson(binding);
  if(Object.keys(identity).sort().join(',')!=='hostId,profileId,projectId,root'
    || !['SAEED_WINDOWS','EMAD_WINDOWS','EMAD_LINUX'].includes(identity.hostId)
    || typeof identity.profileId!=='string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(identity.profileId)
    || typeof identity.projectId!=='string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(identity.projectId)
    || typeof identity.root!=='string' || identity.root.length>2048
    || !path.win32.isAbsolute(identity.root) && !path.posix.isAbsolute(identity.root)) fail('FEATURE_BINDING_INVALID');
  const contextAdapter=Object.getOwnPropertyDescriptor(monitor,'getContext')?.value;
  if(typeof contextAdapter!=='function') fail('FEATURE_DURABLE_ADAPTER_MISSING');
  const context=copyJson(contextAdapter.call(monitor,{maxBytes:16384,maxEvents:0}));
  if(!context?.binding || ['hostId','profileId','projectId','root'].some(k=>context.binding[k]!==identity[k])) fail('FEATURE_JOURNAL_BINDING_MISMATCH');
  Object.freeze(identity);
  return Object.freeze({
    getCapabilities:()=>Object.freeze(Object.entries(definitions).map(([featureId,d])=>Object.freeze({featureId,name:d.name,state:d.evaluate?'BUILT_POLICY_DURABLE_BRIDGE':'USER_PAUSED',executionAuthority:'NONE',installed:false}))),
    async evaluate(request) {
      if(!request || typeof request!=='object' || types.isProxy(request) || Object.getPrototypeOf(request)!==Object.prototype) fail('FEATURE_REQUEST_INVALID');
      const descriptors=Object.getOwnPropertyDescriptors(request);
      const requestKeys=Reflect.ownKeys(descriptors);
      if(requestKeys.some(k=>typeof k!=='string') || requestKeys.sort().join(',')!=='expectedSequence,featureId,input'
        || Object.values(descriptors).some(p=>!Object.hasOwn(p,'value') || !p.enumerable)) fail('FEATURE_REQUEST_INVALID');
      const req={featureId:descriptors.featureId.value,expectedSequence:descriptors.expectedSequence.value};
      if(typeof req.featureId!=='string') fail('FEATURE_NOT_REGISTERED');
      if(!Object.hasOwn(definitions,req.featureId)) fail('FEATURE_NOT_REGISTERED');
      if(!Number.isSafeInteger(req.expectedSequence) || req.expectedSequence<0) fail('FEATURE_SEQUENCE_INVALID');
      let policy;
      try {
        if(req.featureId==='DEV-09') policy={schema:1,feature:'BUDGET_FUSE',decision:'USER_PAUSED',reasonCodes:['USER_PAUSED'],actionAllowed:false};
        else {
          const input=copyJson(descriptors.input.value);
          if(input && Object.hasOwn(input,'projectId') && input.projectId!==identity.projectId
            || input && Object.hasOwn(input,'hostId') && input.hostId!==identity.hostId
            || req.featureId==='DEV-10' && input?.current?.projectId!==identity.projectId) fail('FEATURE_BINDING_MISMATCH');
          // Paused game/video tasks cannot leak through resource recommendations.
          if(req.featureId==='DEV-06' && Array.isArray(input?.jobs) && input.jobs.some(job=>['GAME','VIDEO'].includes(job?.kind))) fail('USER_PAUSED');
          policy=definitions[req.featureId].evaluate(input);
        }
      } catch(error) {
        policy={schema:1,feature:req.featureId,decision:'STOP',reasonCodes:[error.code??'FEATURE_INPUT_INVALID'],actionAllowed:false};
      }
      const observed=projection(policy);
      const receipt=await adapter.call(monitor,{featureId:req.featureId,decision:observed,reasonCodes:policy.reasonCodes,expectedSequence:req.expectedSequence});
      return Object.freeze({featureId:req.featureId,policy,projection:observed,receipt,executionAuthority:'NONE',installed:false});
    }
  });
}
