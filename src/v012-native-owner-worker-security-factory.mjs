// V0.12 production composition seam: existing Native J01 owner, exact pinned
// transport and Ed25519 WorkerIdentityAuthority share the SAME authority.
// No keys, grants, operating-system privileges, listeners or Tunnels created.
// Only an owner-controlled bootstrap supplies the signed Worker registry,
// current route, device proof, exact argument policy and machine-global lease.
import {createWorkerIdentityAuthority}
  from './worker-identity-authority.mjs';
import {createV012PrivateNativeWorkerGrantAdapter}
  from './v012-private-native-worker-adapter.mjs';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const validId=value=>typeof value==='string'&&ID.test(value)
  &&value!=='.'&&value!=='..';
const callable=value=>typeof value==='function';

/**
 * The returned synchronous function fits security.bindWorkerToNativeOwner.
 * It is deliberately NOT a Worker enrollment endpoint. To authorize a real
 * operation, the owner must separately approve the SAME native J01 epoch and
 * record exact Worker, tool, target and expiring grant revisions. No caller
 * can supply identity or route through MCP arguments or _meta.
 *
 * receiptStore MUST be supplied by the installed Core's server-v0.3 code,
 * never manufactured by this factory. Transport comes from the very same
 * owner-pinned attestor passed into Core, not from a parallel trust source.
 */
export function createV012NativeOwnerWorkerSecurityFactory({
  issuer,audience,workerRegistry,
  resolveDeviceIdentity,resolveCapabilityPolicyDigest,
  resolveTrustedToolRoute,authorizeExactArguments,
  resolveCurrentOwnerRoute,resolveCurrentWorkerId,
  withLease,now=Date.now
}={}){
  if(!validId(issuer)||!validId(audience)
    ||!workerRegistry
    ||['get','register','revoke','isRevoked'].some(k=>
      !callable(workerRegistry[k]))
    ||[resolveDeviceIdentity,resolveCapabilityPolicyDigest,
      resolveTrustedToolRoute,authorizeExactArguments,
      resolveCurrentOwnerRoute,resolveCurrentWorkerId,withLease,now]
      .some(fn=>!callable(fn)))
    fail('V012_NATIVE_WORKER_SECURITY_FACTORY_REQUIRED');

  return function bindWorkerToNativeOwner({
    ownerStack,identity,receiptStore
  }={}){
    if(!ownerStack||!identity
      ||!validId(identity.hostId)||!validId(identity.profileId)
      ||!validId(identity.principalId)
      ||![identity.expectedTunnelIdHash,identity.expectedOwnerSidHash]
        .every(h=>typeof h==='string'&&HASH.test(h))
      ||!callable(identity.resolveTransportIdentity)
      ||!callable(receiptStore?.execute))
      fail('V012_NATIVE_WORKER_CURRENT_OWNER_REQUIRED');
    // The narrower native adapter intentionally refuses extra fields.
    const identityScope=Object.freeze({
      hostId:identity.hostId,profileId:identity.profileId,
      principalId:identity.principalId,
      expectedTunnelIdHash:identity.expectedTunnelIdHash,
      expectedOwnerSidHash:identity.expectedOwnerSidHash
    });
    const native=createV012PrivateNativeWorkerGrantAdapter({
      ownerStack,identity:identityScope,
      resolveTrustedToolRoute,authorizeExactArguments,now
    });
    const workerAuthority=createWorkerIdentityAuthority({
      hostId:identity.hostId,profileId:identity.profileId,
      issuer,audience,registry:workerRegistry,
      resolveDeviceIdentity,
      resolveTransportIdentity:identity.resolveTransportIdentity,
      resolveOwnerContext:native.resolveOwnerContext,
      resolveOwnerGrant:native.resolveOwnerGrant,
      resolveCapabilityPolicyDigest,
      authorizeExactInvocation:native.authorizeExactInvocation,now
    });
    return Object.freeze({
      resolveTrustedToolRoute,resolveCurrentOwnerRoute,
      resolveCurrentWorkerId,withLease,receiptStore,
      workerRegistry,workerAuthority
    });
  };
}
