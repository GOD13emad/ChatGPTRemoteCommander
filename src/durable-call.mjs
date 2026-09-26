import { digest, stableJson } from './delivery-store.mjs';

const id = { type:'string', minLength:1, maxLength:128, pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' };
const action = { readOnlyHint:false, destructiveHint:true, idempotentHint:true, openWorldHint:true };
const FORBIDDEN_PREFIXES = ['workflow_','operation_','delivery_'];
const COMMAND_TOOLS = new Set(['run_shell','run_project_command']);

export const durableCallDefinition = {
  name:'durable_call',
  description:'Execute one bounded mutating tool with a durable requestId/correlationId receipt. Exact retries never repeat the effect. Commands are not accepted here: use operation_start for run_shell/run_project_command. If outcome cannot be proven, returns UNCERTAIN and requires reconciliation.',
  inputSchema:{
    type:'object',
    properties:{requestId:id,correlationId:id,tool:{type:'string',minLength:1,maxLength:128},arguments:{type:'object'}},
    required:['requestId','tool','arguments'],
    additionalProperties:false
  },
  annotations:action
};

function codeOf(error) {
  for (const key of ['deliveryCode','browserCode','guiCode','workflowCode','projectCode','code']) {
    const value=error?.[key];
    if (typeof value==='string' && /^[A-Z][A-Z0-9_]{1,100}$/.test(value)) return value;
  }
  return 'MUTATION_OUTCOME_UNCERTAIN';
}

export function isDurableMutationTarget(name, definition) {
  if (!definition || name === 'durable_call' || FORBIDDEN_PREFIXES.some(prefix=>name.startsWith(prefix))) return false;
  return definition.annotations?.readOnlyHint !== true;
}

export function createDurableCall({deliveryStore,lookup,validateSchema,dispatch,durationMs=300000}) {
  if(!deliveryStore||typeof lookup!=='function'||typeof validateSchema!=='function'||typeof dispatch!=='function') {
    throw new Error('DURABLE_CALL_RUNTIME_REQUIRED');
  }
  async function execute(input) {
    const definition=lookup(input.tool);
    if(!definition) throw new Error('DURABLE_CALL_UNKNOWN_TOOL');
    if(!isDurableMutationTarget(input.tool,definition)) throw new Error('DURABLE_CALL_MUTATION_REQUIRED');
    if(COMMAND_TOOLS.has(input.tool)) throw new Error('DURABLE_COMMAND_REQUIRES_OPERATION_START');
    const errors=validateSchema(input.arguments,definition.inputSchema);
    if(errors.length) throw new Error('DURABLE_CALL_ARGUMENTS_INVALID');
    const correlationId=input.correlationId??input.requestId;
    const inputHash=digest(stableJson({tool:input.tool,arguments:input.arguments}));
    const reservation=deliveryStore.reserve({
      requestId:input.requestId,correlationId,tool:input.tool,inputHash,durationMs
    });
    if(reservation.duplicate) {
      return {
        requestId:reservation.requestId,jobId:reservation.jobId,correlationId:reservation.correlationId,
        tool:reservation.tool,status:reservation.status,deliveryId:reservation.deliveryId??null,
        duplicate:true,replayedEffect:false,
        ...(reservation.status==='UNCERTAIN'?{reconcileRequired:true}:{})
      };
    }
    try {
      const result=await dispatch(input.tool,input.arguments);
      const event=deliveryStore.finish(input.requestId,result,'COMPLETED');
      return {
        requestId:input.requestId,jobId:reservation.jobId,correlationId,tool:input.tool,
        status:'COMPLETED',deliveryId:event?.deliveryId??null,duplicate:false,replayedEffect:false,result
      };
    } catch(error) {
      const code=codeOf(error);
      const event=deliveryStore.uncertain(input.requestId,code);
      return {
        requestId:input.requestId,jobId:reservation.jobId,correlationId,tool:input.tool,
        status:'UNCERTAIN',errorCode:code,deliveryId:event?.deliveryId??null,
        duplicate:false,replayedEffect:false,reconcileRequired:true
      };
    }
  }
  return {definition:durableCallDefinition,execute};
}
