// Owner-local evidence from the EXISTING systemd-creds encrypted Worker key.
// Key bytes are unsealed transiently by the existing audited capsule inspector,
// never returned, persisted, logged or sent through MCP. This attests a native
// key-store identity, not hardware identity or OS privilege. The Core/Worker
// runtime must still enforce independent OS filesystem isolation.
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectOwnerWorkerKeyCapsule}
  from '../tools/provision-owner-worker-key-linux.mjs';
import {readLinuxOwnerTunnelPin,resolvePinnedOwnerTunnelDirectory}
  from './linux-private-tunnel-owner-pin.mjs';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEX=/^[a-f0-9]{64}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hash=x=>createHash('sha256').update(x).digest('hex');
export function createLinuxOwnerWorkerKeyEvidence({
  home,profile,hostId,resolveOwnerSidHash,resolveTransportIdentity,
  now=Date.now,inspect=inspectOwnerWorkerKeyCapsule
}={}){
  if(process.platform!=='linux'||typeof process.getuid!=='function'
    ||process.getuid()<1||typeof home!=='string'||!path.isAbsolute(home)
    ||typeof profile!=='string'||!ID.test(profile)
    ||typeof hostId!=='string'||!ID.test(hostId)
    ||typeof resolveOwnerSidHash!=='function'
    ||typeof resolveTransportIdentity!=='function'
    ||typeof now!=='function'||typeof inspect!=='function')
    fail('RC012_OWNER_WORKER_KEY_EVIDENCE_CONFIG_INVALID');
  const uid=process.getuid();
  const pair=resolvePinnedOwnerTunnelDirectory({home,profile,ownerUid:uid});
  const parent=path.join(home,'.local','state','chatgpt-remote-commander');
  const credentialDir=path.join(parent,'private-pair-security-'+profile,'worker-identity');
  async function resolveVerifiedWorkerKey(){
    const initial=now();
    if(!Number.isSafeInteger(initial)||initial<0)
      fail('RC012_OWNER_WORKER_KEY_EVIDENCE_CLOCK_INVALID');
    const beforeSid=await resolveOwnerSidHash();
    if(typeof beforeSid!=='string'||!HEX.test(beforeSid))
      fail('RC012_OWNER_WORKER_KEY_EVIDENCE_OWNER_INVALID');
    const pin=readLinuxOwnerTunnelPin({directory:pair,ownerUid:uid,nowMs:initial});
    if(pin.profileId!==profile||pin.hostId!==hostId||pin.ownerSidHash!==beforeSid)
      fail('RC012_OWNER_WORKER_KEY_EVIDENCE_TUNNEL_SCOPE_INVALID');
    const capsule=inspect({
      directory:credentialDir,profile,
      identity:{
        hostId,profileId:profile,expectedOwnerSidHash:beforeSid,
        expectedClientLeafDerSha256:pin.expectedClientLeafDerSha256
      },ownerUid:uid
    });
    if(capsule.verified!==true||capsule.profileId!==profile
      ||!HEX.test(capsule.keyId)||capsule.receiptSchema!==2)
      fail('RC012_OWNER_WORKER_KEY_EVIDENCE_CAPSULE_INVALID');
    const transport=await resolveTransportIdentity();
    const afterSid=await resolveOwnerSidHash();
    const time=now();
    if(!Number.isSafeInteger(time)||time<initial
      ||afterSid!==beforeSid
      ||transport?.source!=='native-tunnel-attestor'
      ||transport.provider!=='openai-secure-mcp-tunnel'
      ||transport.profileId!==profile||transport.ownerSidHash!==beforeSid
      ||transport.authenticated!==true||transport.controlPlanePollOk!==true
      ||transport.healthzStatus!==200||transport.readyzStatus!==200
      ||typeof transport.tunnelIdHash!=='string'||!HEX.test(transport.tunnelIdHash)
      ||!Number.isSafeInteger(transport.lastPollAtMs)
      ||transport.lastPollAtMs>time||time-transport.lastPollAtMs>120000
      ||!Number.isSafeInteger(transport.expiresAtMs)
      ||transport.expiresAtMs<=time)
      fail('RC012_OWNER_WORKER_KEY_EVIDENCE_TUNNEL_UNVERIFIED');
    // Bind native-key-store device identity to host, OS owner, the existing
    // enrolled client certificate and the already encrypted Worker key.
    const deviceIdHash=hash(JSON.stringify([
      'commander.native-owner-key-store.device.v1',hostId,profile,
      beforeSid,pin.expectedClientLeafDerSha256,capsule.keyId
    ]));
    const capabilityPolicyDigest=hash(JSON.stringify([
      'commander.v012.read-only-canary.policy.v1',
      hostId,profile,'system_status','host-shell','system-status'
    ]));
    return Object.freeze({
      source:'native-worker-key-attestor',hostId,profileId:profile,
      ownerSidHash:beforeSid,keyId:capsule.keyId,
      deviceProvider:'native-key-store',deviceIdHash,capabilityPolicyDigest,
      attestedAtMs:time,expiresAtMs:Math.min(time+30000,transport.expiresAtMs),
      verified:true
    });
  }
  return Object.freeze({resolveVerifiedWorkerKey});
}
