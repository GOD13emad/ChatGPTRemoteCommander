#!/usr/bin/env node
// Real owner-encrypted key in a transient systemd unit; NO owner enrollment,
// Worker grant, Core dispatch, registration storage or Tunnel mutation.
// A deliberately unbound QA conversation and zero binding ID make this
// ephemeral signed packet unusable as a live Core registration.
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createLinuxNativeOwnerSessionProvider}
  from '../src/native-owner-session-provider-linux.mjs';
import {readLinuxOwnerTunnelPin,resolvePinnedOwnerTunnelDirectory}
  from '../src/linux-private-tunnel-owner-pin.mjs';
import {createLinuxSignedBrokerTransport}
  from '../src/linux-native-tunnel-broker-client.mjs';
import {createLinuxOwnerWorkerKeyEvidence}
  from '../src/v012-owner-worker-key-evidence-linux.mjs';
import {verifyWorkerRegistration}
  from '../src/worker-identity-authority.mjs';
const PROFILE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const SOCKET_LABELS=Object.freeze({
  'mmz-emad-laptop':'rc012-mmz-witness',
  'saeed-emad-laptop':'rc012-saeed-witness',
  'chatgpt-remote-commander':'rc012-default-witness'
});
const fail=code=>{throw Object.assign(new Error(code),{code});};
async function main(){
  const profile=process.argv[2],uid=process.getuid?.();
  if(process.platform!=='linux'||process.argv.length!==3
    ||typeof profile!=='string'||!PROFILE.test(profile)
    ||!Number.isSafeInteger(uid)||uid<1
    ||process.env.RC012_QA_NATIVE_SIGNER_SCOPE!=='VERIFY_EXISTING_NO_GRANT')
    fail('RC012_SIGNER_QA_SCOPE_REQUIRED');
  const home=os.homedir(),owner=createLinuxNativeOwnerSessionProvider({ownerIdentityMode:'host-uid-v2'});
  const dir=resolvePinnedOwnerTunnelDirectory({home,profile,ownerUid:uid});
  const pin=readLinuxOwnerTunnelPin({directory:dir,ownerUid:uid});
  const socketLabel=SOCKET_LABELS[profile]??'rc012-'+profile+'-witness';
  const transport=await createLinuxSignedBrokerTransport({
    hostId:pin.hostId,profileId:profile,
    expectedOwnerSidHash:await owner.resolveOwnerSidHash(),
    expectedClientLeafDerSha256:pin.expectedClientLeafDerSha256,
    expectedExecutableSha256:pin.expectedExecutableSha256,
    pinFile:path.join(dir,'owner-tunnel-trust.json'),
    socketPath:'/run/user/'+uid+'/'+socketLabel+'/proof.sock',
    publicKeyPath:path.join(home,'.local/state/chatgpt-remote-commander',
      'private-pair-security-'+profile,'native-witness','public.pem'),
    resolveOwnerSidHash:owner.resolveOwnerSidHash
  });
  const evidence=await createLinuxOwnerWorkerKeyEvidence({
    home,profile,hostId:pin.hostId,
    resolveOwnerSidHash:owner.resolveOwnerSidHash,
    resolveTransportIdentity:transport.resolveTransportIdentity
  }).resolveVerifiedWorkerKey();
  const proof=await transport.resolveTransportIdentity();
  const now=Date.now();
  const intent={
    hostId:pin.hostId,profileId:profile,
    principalId:'qa-only-unbound',conversationId:'qa-only-unbound',
    bindingId:'0'.repeat(64),ownerSidHash:evidence.ownerSidHash,
    deviceIdHash:evidence.deviceIdHash,tunnelIdHash:proof.tunnelIdHash,
    capabilityPolicyDigest:evidence.capabilityPolicyDigest,
    grantRevision:1,expiresAtMs:now+30000
  };
  const credential=path.join(home,'.local/state/chatgpt-remote-commander',
    'private-pair-security-'+profile,'worker-identity','worker-ed25519-seed.cred');
  const unit='rc012-qa-sign-'+randomBytes(8).toString('hex');
  const exec='/usr/lib/chatgpt-remote-commander/runtime/node';
  const signer=path.join(path.dirname(new URL(import.meta.url).pathname),
    'v012-native-worker-registration-signer-linux.mjs');
  const cmd=spawnSync('/usr/bin/systemd-run',[
    '--user','--quiet','--pipe','--wait','--collect','--unit='+unit,
    '-p','NoNewPrivileges=yes','-p','RuntimeMaxSec=25s',
    '-p','LoadCredentialEncrypted=worker-ed25519-seed:'+credential,
    '-E','RC012_NATIVE_SIGNER_SCOPE=SIGNED_ENVELOPE_NO_GRANT',
    exec,signer,profile
  ],{
    input:JSON.stringify(intent)+'\n',encoding:'utf8',
    timeout:30000,maxBuffer:16384
  });
  if(cmd.status!==0||cmd.error||!cmd.stdout?.trim())
    fail('RC012_SIGNER_QA_SYSTEMD_SIGNING_FAILED');
  let envelope;
  try{envelope=JSON.parse(cmd.stdout);}
  catch{fail('RC012_SIGNER_QA_ENVELOPE_INVALID');}
  const parsed=verifyWorkerRegistration(envelope,{
    issuer:'commander.local',audience:'remote-commander',
    now:()=>Date.now(),maxTtlMs:120000
  });
  if(parsed.keyId!==evidence.keyId
    ||parsed.claims.bindingId!=='0'.repeat(64)
    ||parsed.claims.principalId!=='qa-only-unbound'
    ||parsed.claims.conversationId!=='qa-only-unbound'
    ||parsed.claims.deviceIdHash!==evidence.deviceIdHash
    ||parsed.claims.tunnelIdHash!==proof.tunnelIdHash)
    fail('RC012_SIGNER_QA_NATIVE_PAIR_BINDING_INVALID');
  console.log(JSON.stringify({
    result:'RC012_ACTUAL_ENCRYPTED_OWNER_WORKER_SIGNER_PASS',
    profile,credentialUnsealedInTransientUnit:true,
    actualNativeKeyVerified:true,signerEnvelopeValid:true,
    coreWorkerRegistered:false,workerGrantIssued:false,
    coreToolDispatched:false,productionTunnelChanged:false
  }));
}
main().catch(error=>{
  console.error(error?.code?.startsWith?.('RC012_')
    ?error.code:'RC012_SIGNER_QA_FAILED');
  process.exitCode=2;
});
