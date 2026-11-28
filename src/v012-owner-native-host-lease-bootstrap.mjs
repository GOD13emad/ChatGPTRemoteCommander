// Owner-bootstrap-only selection of the verified native, host-global SQLite
// operation lease. No new directory, authority, grant or service is created.
// Every protected Core process on the SAME physical host must use a single
// canonical owner-private directory; this helper cannot prove peer enrollment.
import {createV012HostGlobalOperationLease,
  createV012WindowsHostGlobalOperationLease}
  from './v012-host-global-operation-lease.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Called by the local, pinned owner startup module before the protected
 * runtime opens its listener. Storage is validated by the existing OS-native
 * lease factory. No MCP caller-supplied path or host identity is accepted.
 * Do not synthesize a directory from the per-profile grant database path.
 */
export async function createV012OwnerNativeHostLease({directory,hostId}={}){
  if(typeof hostId!=='string'||!ID.test(hostId)
    ||hostId==='.'||hostId==='..'
    ||typeof directory!=='string'||directory.length===0)
    fail('V012_OWNER_HOST_LEASE_CONFIGURATION_REQUIRED');
  let lease;
  if(process.platform==='win32'){
    lease=await createV012WindowsHostGlobalOperationLease({directory,hostId});
  }else if(process.platform==='linux'){
    lease=createV012HostGlobalOperationLease({directory,hostId});
  }else{
    fail('V012_OWNER_HOST_LEASE_UNSUPPORTED_PLATFORM');
  }
  return Object.freeze({
    hostId,
    withLease:(resource,work)=>lease.withLease(resource,work),
    reconcileDeferred:(resource,readCompletion)=>lease.reconcileDeferred(resource,readCompletion),
    close:()=>lease.close()
  });
}
