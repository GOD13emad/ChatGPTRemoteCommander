// Exact owner-enrolled Linux private Tunnel identity for the v0.12 Core.
// This module is a transport dependency only: it does not open a listener,
// edit a tunnel, request native J01 consent, register a worker or issue grants.
import path from 'node:path';
import {isProxy} from 'node:util/types';
import {createLinuxNativeOwnerSessionProvider}
  from './native-owner-session-provider-linux.mjs';
import {createLinuxTunnelClientObserver}
  from './native-tunnel-client-observer-linux.mjs';
import {createNativeTunnelAttestor}
  from './native-tunnel-attestor.mjs';

const HASH=/^[a-f0-9]{64}$/;
const HOST=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROFILE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FIELDS=Object.freeze([
  'hostId','profileId','expectedExecutablePath','expectedExecutableSha256',
  'healthPort','expectedOwnerSidHash','expectedTunnelIdHash'
]);
const fail=code=>{throw Object.assign(new Error(code),{code});};

function pinnedConfig(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||isProxy(value)
    ||![Object.prototype,null].includes(Object.getPrototypeOf(value))
    ||Reflect.ownKeys(value).length!==FIELDS.length)
    fail('RC012_NATIVE_PAIR_CONFIG_INVALID');
  const v=Object.create(null);
  for(const key of FIELDS){
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(!d||!d.enumerable||!Object.hasOwn(d,'value'))
      fail('RC012_NATIVE_PAIR_CONFIG_INVALID');
    v[key]=d.value;
  }
  if(typeof v.hostId!=='string'||!HOST.test(v.hostId)
    ||v.hostId==='.'||v.hostId==='..'
    ||typeof v.profileId!=='string'||!PROFILE.test(v.profileId)
    ||v.profileId==='.'||v.profileId==='..'
    ||typeof v.expectedExecutablePath!=='string'
    ||!path.isAbsolute(v.expectedExecutablePath)
    ||v.expectedExecutablePath.includes('\0')
    ||v.expectedExecutablePath.length>4096
    ||![v.expectedExecutableSha256,v.expectedOwnerSidHash,
      v.expectedTunnelIdHash].every(x=>typeof x==='string'&&HASH.test(x))
    ||!Number.isInteger(v.healthPort)||v.healthPort<1024
    ||v.healthPort>65535)
    fail('RC012_NATIVE_PAIR_CONFIG_INVALID');
  return Object.freeze(v);
}

/**
 * Supply these seven values only from owner-controlled local enrollment.
 * In particular, the expected tunnel-instance hash must NOT be learned
 * automatically from the just-observed process: owner consent/enrollment
 * pins that identity independently of arbitrary MCP inputs.
 *
 * Each call rechecks the OS owner, exact executable and PID, socket and
 * fresh authenticated control-plane poll; a restart/profile switch fails
 * closed until the owner explicitly re-enrolls its new tunnel instance.
 */
export async function createV012LinuxOwnerPinnedTransport(options){
  if(process.platform!=='linux')fail('RC012_NATIVE_PAIR_LINUX_REQUIRED');
  const v=pinnedConfig(options);
  const ownerSession=createLinuxNativeOwnerSessionProvider();
  const ownerSidHash=await ownerSession.resolveOwnerSidHash();
  if(ownerSidHash!==v.expectedOwnerSidHash)
    fail('RC012_NATIVE_PAIR_OWNER_MISMATCH');
  const observer=createLinuxTunnelClientObserver({
    profileId:v.profileId,expectedExecutablePath:v.expectedExecutablePath,
    expectedExecutableSha256:v.expectedExecutableSha256,
    healthPort:v.healthPort,
    resolveOwnerSidHash:()=>ownerSession.resolveOwnerSidHash()
  });
  const attestor=createNativeTunnelAttestor({
    hostId:v.hostId,profileId:v.profileId,
    expectedExecutablePath:v.expectedExecutablePath,
    expectedExecutableSha256:v.expectedExecutableSha256,
    resolveOwnerSidHash:()=>ownerSession.resolveOwnerSidHash(),
    resolveOwnedTunnelProcess:observer.resolveOwnedTunnelProcess,
    probeTunnelHealth:observer.probeTunnelHealth
  });
  async function resolveTransportIdentity(){
    if(await ownerSession.resolveOwnerSidHash()!==v.expectedOwnerSidHash)
      fail('RC012_NATIVE_PAIR_OWNER_MISMATCH');
    const observed=await attestor.resolveTransportIdentity();
    if(observed.ownerSidHash!==v.expectedOwnerSidHash
      ||observed.profileId!==v.profileId
      ||observed.tunnelIdHash!==v.expectedTunnelIdHash
      ||observed.authenticated!==true||observed.controlPlanePollOk!==true)
      fail('RC012_NATIVE_PAIR_TUNNEL_MISMATCH');
    return observed;
  }
  // Initialization is not a trust-on-first-use enrollment.
  await resolveTransportIdentity();
  return Object.freeze({
    profileId:v.profileId,
    expectedTunnelIdHash:v.expectedTunnelIdHash,
    expectedOwnerSidHash:v.expectedOwnerSidHash,
    resolveTransportIdentity
  });
}
