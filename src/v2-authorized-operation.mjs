// V2-G1 guarded operation adapter. NOT wired to the legacy loopback MCP HTTP endpoint.
// The endpoint transport guard is not a user/chat authenticator. The four callbacks
// below must come from an authorized principal/session worker and existing Commander
// access/lease/receipt services, not from request headers, tool arguments, or model text.
import { createHash } from 'node:crypto';
import {
  normalizeV2Route, assertV2CallerBinding, v2ResourceLeaseKey,
  v2OperationKey
} from './v2-routing-contract.mjs';

function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function requireFunction(value) {
  if (typeof value !== 'function') fail('V2_TRUSTED_DEPENDENCY_REQUIRED');
}
/**
 * Fail-closed single-operation admission.
 * @param {object} route - Requested, untrusted routing selection.
 * @param {object} services - Trusted host dependencies (never composed from RPC args).
 *   observedCaller(): immutable authenticated principal/profile/conversation/host binding
 *   hasGrant(route): true iff registry currently permits this exact target and action
 *   withLease(resourceKey, work): invokes work only while holding a host-global lease
 *   receiptStore: existing MutationIdempotencyStore (durable scoped at-most-once)
 *   execute(route): effect through the already-authorized Commander tool entrypoint
 * @param {string} tool - Exact approved Commander tool identity for receipt conflict checking.
 */
export async function executeV2BoundOperation(route, services, tool) {
  const r = normalizeV2Route(route);
  if (!services || typeof services !== 'object') fail('V2_TRUSTED_DEPENDENCY_REQUIRED');
  for (const name of ['observedCaller', 'hasGrant', 'withLease', 'execute']) {
    requireFunction(services[name]);
  }
  if (!services.receiptStore || typeof services.receiptStore.execute !== 'function') fail('V2_TRUSTED_DEPENDENCY_REQUIRED');
  if (typeof tool !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(tool)) fail('V2_INVALID_TOOL');

  const check = async () => {
    // Fail closed if the identity provider cannot supply a verified exact identity.
    const observed = await services.observedCaller();
    assertV2CallerBinding(r, observed);
    if (await services.hasGrant(r, tool) !== true) fail('V2_GRANT_REQUIRED');
  };
  await check();  // No queue/receipt reservation on wrong principal or denied grant.
  const resource = v2ResourceLeaseKey(r);
  const requestId = createHash('sha256').update(v2OperationKey(r)).digest('hex');
  // The caller's shared lease implementation must be machine-global and canonical,
  // NOT an in-process Map or a per-chat lock. The existing WorkflowStore owns roots.
  return services.withLease(resource, async (leaseContext) => {
    try{
      await check(); // Protect the gap between admission and lease acquisition.
    }catch(error){
      // This request has not entered the durable receipt or Core effect.
      leaseContext?.markSafePreEffectDenial?.();
      throw error;
    }
    let effectStarted=false;
    const receipt=services.receiptStore;
    const preflight=typeof receipt.executeWithPreflight==='function';
    const details={ requestId, tool, input: services.receiptInput??{ route: r } };
    const dispatch=()=>{
      // This is the LAST safe point before entering the external Core effect.
      // Never classify a thrown tool error as a pre-effect denial.
      effectStarted=true;
      leaseContext?.markEffectStarted?.();
      return services.execute(r);
    };
    try{
      if(preflight)
        return await receipt.executeWithPreflight(details,check,dispatch);
      // Compatibility with older receipt providers: keep the last check,
      // and conservatively quarantine an unclassified failure.
      return await receipt.execute(details,async()=>{
        await check();
        return dispatch();
      });
    }catch(error){
      // Only a DURABLY recorded pre-effect denial, never a tool's claimed
      // error code, can release this lease. A denied ID remains terminal
      // and a replay cannot later execute even under a new grant.
      if(preflight&&!effectStarted
        &&typeof receipt.readRequestState==='function'
        &&receipt.readRequestState(requestId)==='DENIED'){
        leaseContext?.markSafePreEffectDenial?.();
        throw error;
      }
      // A persisted UNCERTAIN receipt may predate this lease instance.
      // Quarantine it rather than permitting a different operation ID to
      // proceed while its former external effect could still be running.
      if(!effectStarted&&error?.mutationIdempotencyCode==='MUTATION_REQUEST_ID_CONFLICT'
        &&typeof services.receiptStore.readRequestState==='function'
        &&services.receiptStore.readRequestState(requestId)==='SUCCEEDED'){
        // The prior request is durably terminal. The conflicting call was
        // rejected BEFORE any new effect, so the new resource lease can go.
        // A PREPARED/UNCERTAIN prior receipt must NEVER use this exemption.
        leaseContext?.markSafePreEffectDenial?.();
      }
      if(error?.mutationIdempotencyCode==='MUTATION_OUTCOME_UNCERTAIN')
        leaseContext?.markEffectStarted?.();
      throw error;
    }
  });
}
