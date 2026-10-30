// V2 R3: compose existing WorkflowStore + native-identity grants with a central
// fenced lease. Candidate only: no public HTTP route or production deployment.
// commitWithFence MUST be a trusted actuator that checks the fencing epoch
// atomically with the protected mutation; a preflight check alone is not enough.
import { normalizeV2Route, v2ResourceLeaseKey } from './v2-routing-contract.mjs';
import { executeV2WorkflowStep } from './v2-workflow-gateway.mjs';

function fail(code){throw Object.assign(new Error(code),{code});}
export async function executeV2CoordinatedWorkflowStep({
  coordinator,commitWithFence,route,ttlMs=30000,...params
}={}){
  const r=normalizeV2Route(route);
  if(r.target.kind!=='workflow-root')
    fail('V2_COORDINATED_WORKFLOW_ROOT_REQUIRED');
  if(!coordinator||typeof coordinator.withFencedLease!=='function'||
     typeof commitWithFence!=='function'||Object.hasOwn(params,'dispatch'))
    fail('V2_COORDINATED_TRUSTED_BACKEND_REQUIRED');
  const resource=v2ResourceLeaseKey(r);
  return coordinator.withFencedLease({route:r,ttlMs,run:async({lease,assertCurrent})=>{
    await assertCurrent();
    return executeV2WorkflowStep({
      ...params,route:r,
      dispatch:async(tool,args,state)=>{
        await assertCurrent();
        // The native actuator owns the atomic fence+effect boundary.
        // No caller-controlled headers, route parameters or SQL statements
        // are accepted as a replacement for that enforcement.
        return commitWithFence({
          tool,args,state,resource,leaseId:lease.id,
          fence:lease.fence,assertCurrent
        });
      }
    });
  }});
}
