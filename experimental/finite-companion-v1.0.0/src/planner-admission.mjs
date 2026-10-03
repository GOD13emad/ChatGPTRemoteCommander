// Pure, narrow pre-model admission. No filesystem/model/process/host effects.
import {types} from 'node:util';
const HEX=/^[a-f0-9]{64}$/,ID=/^[a-z][a-z0-9_-]{0,63}$/;
const deny=code=>{throw Object.assign(new Error(code),{code});};
const fields=['schema','bindingSha256','workflowId','runId','owner','authorizationSha256','currentStep','choices','budget'];
function properties(value,expected){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)deny('PLANNER_CONTEXT_OBJECT');
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
 if(keys.length!==expected.length||keys.some(key=>typeof key!=='string'||!expected.includes(key)||!Object.hasOwn(descriptors[key],'value')||!descriptors[key].enumerable))deny('PLANNER_CONTEXT_FIELDS');
 return Object.fromEntries(expected.map(key=>[key,descriptors[key].value]));
}
function choices(value){
 if(!Array.isArray(value)||types.isProxy(value)||Object.getPrototypeOf(value)!==Array.prototype)deny('PLANNER_CONTEXT_CHOICES');
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(descriptors).length!==3||!Object.hasOwn(descriptors,'length')||descriptors.length.value!==2||!Object.hasOwn(descriptors,'0')||!Object.hasOwn(descriptors,'1')||!Object.hasOwn(descriptors[0],'value')||!Object.hasOwn(descriptors[1],'value')||descriptors[0].value!=='CONTINUE_STEP'||descriptors[1].value!=='STOP'||!descriptors[0].enumerable||!descriptors[1].enumerable)deny('PLANNER_CONTEXT_CHOICES');
 return Object.freeze(['CONTINUE_STEP','STOP']);
}
export function admitPlannerContext(context){
 const value=properties(context,fields);
 if(value.schema!==1||value.owner!=='saeed'||typeof value.bindingSha256!=='string'||!HEX.test(value.bindingSha256)||typeof value.authorizationSha256!=='string'||!HEX.test(value.authorizationSha256)||typeof value.workflowId!=='string'||!ID.test(value.workflowId)||typeof value.runId!=='string'||!ID.test(value.runId)||!['observe_status','write_proof'].includes(value.currentStep))deny('PLANNER_CONTEXT_IDENTITY');
 const allowedChoices=choices(value.choices),budget=properties(value.budget,['remainingAttempts','remainingPlannerCalls','callsPerPlan','workerCallsPerPlan']);
 if(Object.values(budget).some(count=>!Number.isSafeInteger(count)||count<0||count>2)||budget.callsPerPlan!==1||budget.workerCallsPerPlan!==0)deny('PLANNER_CONTEXT_BUDGET');
 const snapshot={schema:1,bindingSha256:value.bindingSha256,workflowId:value.workflowId,runId:value.runId,owner:'saeed',authorizationSha256:value.authorizationSha256,currentStep:value.currentStep,choices:allowedChoices,budget:Object.freeze({...budget})};
 // Schema depth is fixed at three levels, below the admitted depth ceiling six.
 if(Buffer.byteLength(JSON.stringify(snapshot))>4096)deny('PLANNER_CONTEXT_BOUND');
 return Object.freeze(snapshot);
}
