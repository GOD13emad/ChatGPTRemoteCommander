// One-tunnel v0.12 protected Core composition. This module owns no tunnel,
// client keys, permissions, approval or default listener. All owner/worker
// authority is supplied by the *local* operator's native bootstrap.
import path from 'node:path';
import {createV2OwnerPinnedPrivatePairAttestor}
  from './v2-private-tunnel-mtls-attestor.mjs';
import {createV101PrivatePairNativeOwnerStack}
  from './v101-private-pair-native-owner-stack.mjs';
import {createV2PrivateSignedWorkerGrantAdapter}
  from './v2-private-signed-worker-grant-adapter.mjs';
import {createV2PrivatePairOperationGate}
  from './v2-private-pair-operation-gate.mjs';
import {createV101G1PrivatePairRuntime}
  from './v101-g1-loopback-runtime.mjs';
import {validateJsonSchema} from './schema-validator.mjs';
import {createV012OwnerGrantAdminUnix} from './v012-owner-grant-admin-unix.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;

function validWorkerSecurity(s){
  return !!s&&typeof s==='object'&&!Array.isArray(s)
    &&typeof s.resolveTrustedToolRoute==='function'
    &&typeof s.resolveCurrentOwnerRoute==='function'
    &&typeof s.resolveCurrentWorkerId==='function'
    &&typeof s.withLease==='function'
    &&typeof s.workerAuthority?.authorizeWorker==='function'
    &&typeof s.workerRegistry?.get==='function'
    &&typeof s.workerRegistry?.isRevoked==='function'
    &&typeof s.receiptStore?.execute==='function';
}
// Core's trusted receiptStore is injected by server-v0.3 and is shared with
// BOTH bootstrap modes; it must not be mistaken for a competing Worker grant.
const WORKER_CALLBACK_FIELDS=Object.freeze([
  'resolveTrustedToolRoute','resolveCurrentOwnerRoute',
  'resolveCurrentWorkerId','withLease','workerAuthority',
  'workerRegistry'
]);

/**
 * Attach the real Core catalog and dispatch function to the existing
 * owner-pinned HTTPS/mTLS -> native J01 -> signed exact-action grant pipeline.
 *
 * TLS credentials and callbacks MUST come from an owner-controlled native
 * bootstrap, not an MCP call, config.json or client-controlled _meta.
 * security.withLease MUST be machine-global (no in-process mock lock);
 * its implementation and worker/grant provisioning belong to the owner.
 *
 * Two exclusive owner-local bootstrap modes:
 * - already-bound, trusted security callbacks (existing integration);
 * - a SYNCHRONOUS security.bindWorkerToNativeOwner({ownerStack,identity})
 *   which can reuse the exact fresh native J01 session/registry. This is
 *   called only after the native owner stack is constructed and cannot
 *   create an HTTP/MCP enrollment or bypass OS approval. Bootstrap owns
 *   lifecycle and durable worker store; no automatic grants are issued.
 */
export function createV012PrivateCoreRuntime({
  port,identity,tls,security,core,nativeHostLease=null,physicalRootFence=null,now=Date.now
}={}){
  if(!Number.isInteger(port)||port<0||port>65535
    ||!identity||!tls||!security||!core
    ||typeof now!=='function'
    ||![identity.hostId,identity.profileId,identity.principalId,
      security.issuer,security.audience].every(v=>
      typeof v==='string'&&ID.test(v)&&v!=='.'&&v!=='..')
    ||![identity.expectedTunnelIdHash,identity.expectedOwnerSidHash]
      .every(v=>typeof v==='string'&&HASH.test(v))
    ||typeof identity.resolveTransportIdentity!=='function'
    ||typeof security.resolveOwnerRoute!=='function'
    ||typeof core.dispatch!=='function'
    ||!Array.isArray(core.catalog)||core.catalog.length===0
    ||typeof security.directory!=='string'
    ||!path.isAbsolute(security.directory))
    fail('V012_PRIVATE_CORE_BOOTSTRAP_REQUIRED');
  // Installed owner bootstrap may pin an OS-validated shared host lease.
  // Never replace the native lease with a per-process Worker mock once pinned.
  if(nativeHostLease!==null
    &&(typeof nativeHostLease?.withLease!=='function'
      ||typeof nativeHostLease?.close!=='function'
      ||nativeHostLease.hostId!==identity.hostId))
    fail('V012_PRIVATE_NATIVE_HOST_LEASE_INVALID');
  if(nativeHostLease!==null
    &&(typeof physicalRootFence?.withDirectRouteLease!=='function'
      ||typeof physicalRootFence?.withWorkflowRootLease!=='function'))
    fail('V012_PRIVATE_SHARED_PHYSICAL_ROOT_FENCE_REQUIRED');
  if(nativeHostLease===null&&physicalRootFence!==null)
    fail('V012_PRIVATE_NATIVE_HOST_LEASE_REQUIRED');
  const factory=security.bindWorkerToNativeOwner;
  const ownerAdminFactory=security.createOwnerGrantAdministration;
  if(ownerAdminFactory!==undefined
    &&(typeof ownerAdminFactory!=='function'||typeof factory!=='function'))
    fail('V012_PRIVATE_OWNER_ADMIN_FACTORY_REQUIRED');
  if(factory!==undefined
    ? typeof factory!=='function'
      ||WORKER_CALLBACK_FIELDS.some(key=>Object.hasOwn(security,key))
    : !validWorkerSecurity(security))
    fail('V012_PRIVATE_CORE_WORKER_BOOTSTRAP_AMBIGUOUS_OR_MISSING');

  // No function/body injected by a caller may become an executable Core tool.
  // The installed Core is authoritative for both names and schemas.
  const names=new Map();
  for(const definition of core.catalog){
    if(!definition||typeof definition.name!=='string'
      ||!ID.test(definition.name)
      ||!definition.inputSchema||definition.inputSchema.type!=='object'
      ||names.has(definition.name))
      fail('V012_PRIVATE_CORE_CATALOG_INVALID');
    names.set(definition.name,definition);
  }
  let ownerStack;
  const readOwner=async()=>{
    if(!ownerStack)fail('V012_PRIVATE_OWNER_STACK_NOT_READY');
    return ownerStack.readCurrentOwnerSidHash();
  };
  const attestTransport=createV2OwnerPinnedPrivatePairAttestor({
    expectedClientLeafDerSha256:tls.expectedClientLeafDerSha256,
    profileId:identity.profileId,
    expectedTunnelIdHash:identity.expectedTunnelIdHash,
    expectedOwnerSidHash:identity.expectedOwnerSidHash,
    resolveTransportIdentity:identity.resolveTransportIdentity,
    resolveCurrentOwnerSidHash:readOwner,now
  });
  try{
    ownerStack=createV101PrivatePairNativeOwnerStack({
      directory:security.directory,profileId:identity.profileId,
      expectedTunnelIdHash:identity.expectedTunnelIdHash,
      expectedOwnerSidHash:identity.expectedOwnerSidHash,
      attestTransport,resolveOwnerRoute:security.resolveOwnerRoute,
      ownerSessionOptions:security.ownerSessionOptions??{},now
    });
    // The factory may bind to the already verified native J01 state and
    // durable grant registry, avoiding a circular owner/worker dependency.
    // It is NOT an authorization grant: the exact signed Worker authority,
    // current caller and global lease are still checked per tool invocation.
    const worker=factory
      ?factory(Object.freeze({ownerStack,identity:Object.freeze({
        hostId:identity.hostId,profileId:identity.profileId,
        principalId:identity.principalId,
        expectedTunnelIdHash:identity.expectedTunnelIdHash,
        expectedOwnerSidHash:identity.expectedOwnerSidHash,
        // The Worker authority must attest the EXACT same host-pinned
        // transport as Core, never a separately selected client callback.
        resolveTransportIdentity:identity.resolveTransportIdentity
      }),receiptStore:security.receiptStore}))
      :security;
    if(!validWorkerSecurity(worker))
      fail('V012_PRIVATE_CORE_WORKER_BOOTSTRAP_REQUIRED');
    if(factory&&security.receiptStore!==undefined
      &&worker.receiptStore!==security.receiptStore)
      fail('V012_PRIVATE_CORE_RECEIPT_STORE_MISMATCH');
    const verifyExactNativeGrant=createV2PrivateSignedWorkerGrantAdapter({
      hostId:identity.hostId,profileId:identity.profileId,
      principalId:identity.principalId,
      expectedTunnelIdHash:identity.expectedTunnelIdHash,
      expectedOwnerSidHash:identity.expectedOwnerSidHash,
      issuer:security.issuer,audience:security.audience,
      workerAuthority:worker.workerAuthority,
      workerRegistry:worker.workerRegistry,
      resolveCurrentWorkerId:worker.resolveCurrentWorkerId,
      resolveCurrentOwnerRoute:worker.resolveCurrentOwnerRoute,now
    });
    const gate=createV2PrivatePairOperationGate({
      hostId:identity.hostId,profileId:identity.profileId,
      principalId:identity.principalId,
      expectedTunnelIdHash:identity.expectedTunnelIdHash,
      expectedOwnerSidHash:identity.expectedOwnerSidHash,
      attestTransport,
      resolveOwnerContext:route=>
        ownerStack.resolveOwnerContext(route.conversationId),
      readCurrentOwnerSidHash:readOwner,verifyExactNativeGrant,
      withLease:nativeHostLease?.withLease??worker.withLease,
      withRouteLease:physicalRootFence===null?null:
        (route,work,tool)=>{
          // Control-plane observation/cancellation cannot enter the project
          // sink. Exact Native Worker grants still apply; a running writer
          // must remain observable and cancellable without taking its lock.
          const control=['system_status','operation_status','operation_result','operation_cancel'].includes(tool);
          const definition=names.get(tool);
          if(control&&(definition?.annotations?.readOnlyHint===true
            ||tool==='operation_cancel'&&definition?.annotations?.idempotentHint===true)){
            const key=JSON.stringify([1,route.hostId,route.target.kind,route.target.id]);
            return nativeHostLease.withLease(key,work);
          }
          return physicalRootFence.withDirectRouteLease(route,work);
        },
      receiptStore:worker.receiptStore,now,
      execute:async(route,args,tool,nativeAuthorization)=>{
        if(!names.has(tool)
          ||validateJsonSchema(args,names.get(tool).inputSchema).length!==0)
          fail('V012_PRIVATE_CORE_TOOL_DENIED');
        // This IS the installed Core dispatcher, not a mock, legacy HTTP
        // proxy, second plugin or separate process with weaker access checks.
        return core.dispatch(tool,args,route,nativeAuthorization);
      }
    });
    // The optional native-administration controller is strictly local to
    // this Core instance. Neither MCP tools nor the HTTPS gateway receive
    // it; all its grant mutations must independently request native consent.
    const localOwnerAdministration=ownerAdminFactory?.(Object.freeze({
      ownerStack,identity:Object.freeze({
        hostId:identity.hostId,profileId:identity.profileId,
        principalId:identity.principalId,
        expectedOwnerSidHash:identity.expectedOwnerSidHash,
        expectedTunnelIdHash:identity.expectedTunnelIdHash
      }),
      worker:Object.freeze({
        workerAuthority:worker.workerAuthority,
        workerRegistry:worker.workerRegistry
      })
    }));
    if(ownerAdminFactory&&[
      'inspect','approveWorker','approveReadOnlyCanary',
      'revokeCanaryWorker'
    ].some(k=>typeof localOwnerAdministration?.[k]!=='function'))
      fail('V012_PRIVATE_OWNER_ADMIN_RESULT_INVALID');
    if(security.ownerAdminSocketPath!==undefined&&!ownerAdminFactory)
      fail('V012_PRIVATE_OWNER_ADMIN_FACTORY_REQUIRED');
    // A user-private Unix socket can request ONLY fixed owner-native consent
    // actions. No identity/tool/route is supplied by its peer.
    const localOwnerSocket=security.ownerAdminSocketPath===undefined?null:
      createV012OwnerGrantAdminUnix({
        socketPath:security.ownerAdminSocketPath,
        administration:localOwnerAdministration
      });
    const protectedRuntime=createV101G1PrivatePairRuntime({
      port,
      hostOptions:{
        certificatePem:tls.certificatePem,
        privateKeyPem:tls.privateKeyPem,
        clientCaPem:tls.clientCaPem,
        expectedClientLeafDerSha256:tls.expectedClientLeafDerSha256,
        profileId:identity.profileId,
        resolveTransportIdentity:identity.resolveTransportIdentity,now,
        privateOwnerPair:{
          expectedTunnelIdHash:identity.expectedTunnelIdHash,
          expectedOwnerSidHash:identity.expectedOwnerSidHash,
          resolveCurrentOwnerSidHash:readOwner,
          ownerStack,operationGate:gate,
          trustedToolCatalog:core.catalog,
          validateToolInput:async(tool,args)=>
            names.has(tool)
            &&validateJsonSchema(args,names.get(tool).inputSchema).length===0,
          resolveTrustedToolRoute:worker.resolveTrustedToolRoute
        }
      }
    });
    if(!ownerAdminFactory)return protectedRuntime;
    return Object.freeze({
      get status(){return protectedRuntime.status;},
      async start(){
        try{
          const state=await protectedRuntime.start();
          await localOwnerSocket?.start();
          return state;
        }catch(error){
          await localOwnerSocket?.close().catch(()=>{});
          await protectedRuntime.close().catch(()=>{});
          throw error;
        }
      },
      async close(){
        // Close the owner stack concurrently with the local socket, so a
        // pending approval cannot commit after this Core begins shutdown.
        const outcomes=await Promise.allSettled([
          localOwnerSocket?.close(),protectedRuntime.close()
        ]);
        const failed=outcomes.find(x=>x.status==='rejected');
        if(failed)throw failed.reason;
      },
      // Local-only authority; never included in the MCP tool catalog.
      ownerAdministration:localOwnerAdministration
    });
  }catch(error){
    ownerStack?.close();
    throw error;
  }
}
