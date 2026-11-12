// PRIVATE v0.12 native J01 composition for the EXISTING per-pair Tunnel.
// This is an unbound, owner-controlled source candidate; it does not listen,
// enable Full Access, issue system privileges or modify installed services.
import path from 'node:path';
import {createWindowsV101OwnerSecurityStack}
  from './v101-windows-owner-security-bootstrap.mjs';
import {createLinuxV101OwnerSecurityStack}
  from './v101-linux-owner-security-bootstrap.mjs';
import {createV2PrivateOwnerSessionProofAuthority}
  from './v2-private-owner-session-proof.mjs';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};

/**
 * This composes mTLS-to-J01 proof with the actual Windows/Linux native
 * owner-session provider, existing V2NativeOwnerSessionBindings and the
 * existing durable V2GrantRegistry. Native consent, not a self-reported
 * ChatGPT session, decides whether a binding may be persisted in memory.
 *
 * resolveOwnerRoute MUST be an owner-controlled mapping, not MCP JSON.
 * A separate signed worker authority + exact tool grant and protected
 * ingress are still required before any privileged command can run.
 */
export function createV101PrivatePairNativeOwnerStack({
  platform=process.platform,directory,profileId,expectedTunnelIdHash,
  expectedOwnerSidHash,attestTransport,resolveOwnerRoute,now=Date.now,
  ownerSessionOptions={}
}={}){
  if(platform!==process.platform||!['win32','linux'].includes(platform)
    ||typeof directory!=='string'||!path.isAbsolute(directory)
    ||typeof profileId!=='string'||!ID.test(profileId)
    ||typeof expectedTunnelIdHash!=='string'||!HASH.test(expectedTunnelIdHash)
    ||typeof expectedOwnerSidHash!=='string'||!HASH.test(expectedOwnerSidHash)
    ||typeof attestTransport!=='function'||typeof resolveOwnerRoute!=='function'
    ||typeof now!=='function'||!ownerSessionOptions
    ||typeof ownerSessionOptions!=='object'||Array.isArray(ownerSessionOptions))
    fail('V101_PRIVATE_OWNER_STACK_BOOTSTRAP_REQUIRED');
  let stack;
  const proof=createV2PrivateOwnerSessionProofAuthority({
    profileId,expectedTunnelIdHash,expectedOwnerSidHash,attestTransport,now,
    resolveCurrentOwnerSidHash:async()=>{
      if(!stack)fail('V101_PRIVATE_OWNER_STACK_NOT_READY');
      return stack.ownerSession.resolveOwnerSidHash();
    }
  });
  try{
    const factory=platform==='win32'
      ?createWindowsV101OwnerSecurityStack
      :createLinuxV101OwnerSecurityStack;
    stack=factory({directory,attestPlatformSession:proof.consume,
      resolveOwnerRoute,now,ownerSessionOptions});
    let closed=false;
    return Object.freeze({
      async requestOwnerBinding({request,sessionHandle}={}){
        if(closed)fail('V101_PRIVATE_OWNER_STACK_CLOSED');
        const capability=await proof.issue({request,sessionHandle});
        // bindTrusted consumes the in-process proof exactly once, then
        // independently inspects the live OS owner and requests native consent.
        return stack.nativeSessionBindings.bindTrusted(capability);
      },
      async resolveOwnerContext(sessionHandle){
        if(closed)fail('V101_PRIVATE_OWNER_STACK_CLOSED');
        const native=await stack.nativeSessionBindings.resolveNativeOwnerContext(sessionHandle);
        return Object.freeze({...native,tunnelIdHash:expectedTunnelIdHash});
      },
      readCurrentOwnerSidHash:()=>stack.ownerSession.resolveOwnerSidHash(),
      nativeSessionBindings:stack.nativeSessionBindings,
      grantRegistry:stack.grantRegistry,
      close(){
        if(closed)return;
        closed=true;
        proof.close();
        stack.close();
      }
    });
  }catch(error){proof.close();stack?.close();throw error;}
}
