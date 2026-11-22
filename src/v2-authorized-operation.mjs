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
  return services.withLease(resource, async () => {
    await check(); // Protect the gap between admission and lease acquisition.
    return services.receiptStore.execute(
      { requestId, tool, input: services.receiptInput??{ route: r } },
      async () => {
        await check(); // Protect the gap between receipt reservation and effect.
        return services.execute(r);
      }
    );
  });
}


/**
 * RC013 source-only opt-in primary-host admission for workflow-root effects.
 *
 * This reuses executeV2BoundOperation (authenticated route, revocable grant,
 * existing root lease, durable receipts). It does NOT create a new lease store,
 * trusted device, owner identity, approval, RPC route, or native effect-sink.
 * Never wire this adapter from MCP input. All four additional callbacks below
 * must be installed by trusted native owner/transport bootstrap:
 *
 *   nativeHostId()             the OS-attested local host identifier
 *   readNativePrimary(project) owner-pinned primary/epoch/root registry
 *   verifyNativePrimary(pin)   independently authenticates the registry pin
 *   withEffectSinkFence(pin, execute) performs a native atomic fence check
 *       at the ACTUAL effect sink for the entire execute callback.
 *
 * A lease in process memory, separate SQLite DBs, a Boolean flag, a metadata
 * marker, or a check only before execute is NOT sufficient.
 * This function refuses secondary-host local effects. Authenticated forwarding
 * to the primary must be added separately before multi-host promotion.
 * Until wired to an effect-sink implementation, this is a contract QA candidate.
 */
export async function executeV2PinnedPrimaryWorkflowOperation(route, services, tool) {
  const r=normalizeV2Route(route);
  if(r.target.kind!=='workflow-root')fail('V2_PRIMARY_WORKFLOW_ROOT_REQUIRED');
  if(!services||typeof services!=='object')fail('V2_TRUSTED_DEPENDENCY_REQUIRED');
  for(const name of ['nativeHostId','readNativePrimary','verifyNativePrimary','withEffectSinkFence']){
    requireFunction(services[name]);
  }
  const host=await services.nativeHostId();
  if(typeof host!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(host))
    fail('V2_PRIMARY_NATIVE_HOST_UNVERIFIED');

  // Verify the native owner record, not arbitrary host hints in user-facing args.
  const load=async()=>{
    const p=await services.readNativePrimary(r.target.id);
    if(!p||typeof p!=='object'||Array.isArray(p)
      ||Object.getPrototypeOf(p)!==Object.prototype
      ||Object.keys(p).sort().join(',')!==['authorityEpoch','primaryHostId','projectId','rootFingerprint'].sort().join(',')
      ||typeof p.projectId!=='string'||p.projectId!==r.target.id
      ||typeof p.primaryHostId!=='string'||p.primaryHostId!==host
      ||typeof p.rootFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(p.rootFingerprint)
      ||!Number.isSafeInteger(p.authorityEpoch)||p.authorityEpoch<1)
      fail('V2_PRIMARY_HOST_NOT_AUTHORIZED');
    // The check itself must use native trust/cryptographic provenance, not p flags.
    if(await services.verifyNativePrimary(p)!==true)
      fail('V2_PRIMARY_OWNER_PIN_UNVERIFIED');
    return Object.freeze({
      projectId:p.projectId,primaryHostId:p.primaryHostId,
      rootFingerprint:p.rootFingerprint,authorityEpoch:p.authorityEpoch
    });
  };

  if(r.hostId!==host)fail('V2_PRIMARY_HOST_NOT_AUTHORIZED');
  const first=await load();
  const sinkScope=Object.freeze({
    ...first, operationKey:v2OperationKey(r),resourceKey:v2ResourceLeaseKey(r)
  });
  // Native sink MUST reject stale epochs and duplicate operation keys in the
  // same atomic effect boundary. Callback result/exception is not a release ACK.
  return services.withEffectSinkFence(sinkScope,async()=>{
    const fresh=await load();
    for(const name of ['projectId','primaryHostId','rootFingerprint','authorityEpoch'])
      if(fresh[name]!==first[name])fail('V2_PRIMARY_AUTHORITY_CHANGED');
    return executeV2BoundOperation(r,services,tool);
  });
}
