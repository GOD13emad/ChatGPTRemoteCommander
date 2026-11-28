#!/usr/bin/env node
// One-shot owner-provisioned systemd LoadCredentialEncrypted signer.
// This yields only a PUBLIC Ed25519 registration envelope. It cannot grant
// a Worker, register in the Core, authorize a tool or change Tunnel routing.
// The Core must call registerSignedWorker under current genuine native J01
// and exact per-worker owner approvals before storing this envelope.
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLinuxNativeOwnerSessionProvider}
  from '../src/native-owner-session-provider-linux.mjs';
import {readLinuxOwnerTunnelPin,resolvePinnedOwnerTunnelDirectory}
  from '../src/linux-private-tunnel-owner-pin.mjs';
import {createLinuxSignedBrokerTransport}
  from '../src/linux-native-tunnel-broker-client.mjs';
import {createLinuxOwnerWorkerKeyEvidence}
  from '../src/v012-owner-worker-key-evidence-linux.mjs';
import {createSystemdWorkerKeyProvider}
  from '../src/native-worker-key-provider-linux.mjs';
import {signV012NativeWorkerEnrollment}
  from '../src/v012-native-worker-registration-signer.mjs';
import {resolveLinuxNativeOwnerWitnessPaths}
  from '../src/linux-native-owner-witness-paths.mjs';

const PROFILE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
export async function oneShotNativeWorkerSigner({profile,readInput}={}){
  if(process.platform!=='linux'||process.getuid?.()<1
    ||typeof profile!=='string'||!PROFILE.test(profile)
    ||profile==='.'||profile==='..'
    ||typeof process.env.CREDENTIALS_DIRECTORY!=='string'
    ||typeof readInput!=='function')
    fail('RC012_NATIVE_SIGNER_CREDENTIAL_SCOPE_REQUIRED');
  const home=os.homedir(),uid=process.getuid();
  const witness=resolveLinuxNativeOwnerWitnessPaths({
    home,profile,uid,
    socketPath:process.env.RC012_OWNER_WITNESS_SOCKET_PATH,
    publicKeyPath:process.env.RC012_OWNER_WITNESS_PUBLIC_KEY_PATH
  });
  const owner=createLinuxNativeOwnerSessionProvider({ownerIdentityMode:'host-uid-v2'});
  const dir=resolvePinnedOwnerTunnelDirectory({home,profile,ownerUid:uid});
  const pin=readLinuxOwnerTunnelPin({directory:dir,ownerUid:uid});
  const transport=await createLinuxSignedBrokerTransport({
    hostId:pin.hostId,profileId:profile,
    expectedOwnerSidHash:await owner.resolveOwnerSidHash(),
    expectedClientLeafDerSha256:pin.expectedClientLeafDerSha256,
    expectedExecutableSha256:pin.expectedExecutableSha256,
    pinFile:path.join(dir,'owner-tunnel-trust.json'),
    socketPath:witness.socketPath,
    publicKeyPath:witness.publicKeyPath,
    resolveOwnerSidHash:owner.resolveOwnerSidHash
  });
  const keyEvidence=createLinuxOwnerWorkerKeyEvidence({
    home,profile,hostId:pin.hostId,
    resolveOwnerSidHash:owner.resolveOwnerSidHash,
    resolveTransportIdentity:transport.resolveTransportIdentity
  });
  const evidence=await keyEvidence.resolveVerifiedWorkerKey();
  const raw=await readInput();
  if(typeof raw!=='string'||Buffer.byteLength(raw)<2||Buffer.byteLength(raw)>4096)
    fail('RC012_NATIVE_SIGNER_INPUT_INVALID');
  let intent;
  try{intent=JSON.parse(raw);}
  catch{fail('RC012_NATIVE_SIGNER_INPUT_INVALID');}
  const current=await transport.resolveTransportIdentity();
  if(intent.hostId!==evidence.hostId||intent.profileId!==profile
    ||intent.ownerSidHash!==evidence.ownerSidHash
    ||intent.deviceIdHash!==evidence.deviceIdHash
    ||intent.capabilityPolicyDigest!==evidence.capabilityPolicyDigest
    ||intent.tunnelIdHash!==current.tunnelIdHash)
    fail('RC012_NATIVE_SIGNER_INTENT_IDENTITY_MISMATCH');
  const privateKey=await createSystemdWorkerKeyProvider({
    profileId:profile,expectedKeyId:evidence.keyId
  }).loadPrivateKey();
  const envelope=signV012NativeWorkerEnrollment({
    intent,privateKey,now:Date.now()
  });
  // The issuer writes no key or envelope to disk and cannot mutate grants.
  return envelope;
}
async function main(){
  if(process.argv.length!==3
    ||process.env.RC012_NATIVE_SIGNER_SCOPE!=='SIGNED_ENVELOPE_NO_GRANT')
    fail('RC012_NATIVE_SIGNER_COMMAND_SCOPE_REQUIRED');
  const readInput=async()=>{
    let text='';
    for await(const part of process.stdin){
      text+=part.toString('utf8');
      if(Buffer.byteLength(text)>4096)
        fail('RC012_NATIVE_SIGNER_INPUT_INVALID');
    }
    return text.trim();
  };
  const envelope=await oneShotNativeWorkerSigner({
    profile:process.argv[2],readInput
  });
  process.stdout.write(JSON.stringify(envelope)+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{
    console.error(String(error?.code??'RC012_NATIVE_SIGNER_DENIED'));
    process.exitCode=2;
  });
