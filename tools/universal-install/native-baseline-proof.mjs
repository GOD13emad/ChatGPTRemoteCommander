// Strict, platform-independent acceptance of a restore-baseline receipt.
// The native adapter must independently derive both file-tree digests from
// the SHA-pinned prior package and live immutable installed payload. A native
// package version or a package SHA alone is never such a receipt.
import {createHash} from 'node:crypto';

export const NATIVE_BASELINE_PROOF_SCHEMA='rc-universal-native-baseline-proof-v1';
const HASH=/^[a-f0-9]{64}$/;
const required=[
  'artifactSha256','archivedPayloadSha256','completeInventory',
  'installedPayloadSha256','nativeRegistrationVerified','ownerRestoreVerified',
  'provenanceVerified','runtimeFingerprint','schema','version'
];
const fail=()=>{throw Object.assign(
  new Error('UNIVERSAL_NATIVE_BASELINE_RESTORE_UNVERIFIED'),
  {code:'UNIVERSAL_NATIVE_BASELINE_RESTORE_UNVERIFIED'}
);};

export function requireNativeBaselineProof(proof,previous,before){
  if(!proof||Object.getPrototypeOf(proof)!==Object.prototype||
    Object.keys(proof).sort().join(',')!==required.join(',').split(',')
      .sort().join(','))fail();
  if(!previous||!before||proof.schema!==NATIVE_BASELINE_PROOF_SCHEMA||
    proof.artifactSha256!==previous.sha256||
    proof.version!==previous.version||proof.version!==before.version||
    !HASH.test(proof.archivedPayloadSha256)||
    !HASH.test(proof.installedPayloadSha256)||
    proof.archivedPayloadSha256!==proof.installedPayloadSha256||
    proof.runtimeFingerprint!==before.runtime?.fingerprint||
    !HASH.test(proof.runtimeFingerprint)||
    proof.completeInventory!==true||
    proof.nativeRegistrationVerified!==true||
    proof.ownerRestoreVerified!==true||
    proof.provenanceVerified!==true)fail();
  const identity=createHash('sha256').update([
    NATIVE_BASELINE_PROOF_SCHEMA,proof.artifactSha256,proof.version,
    proof.archivedPayloadSha256,proof.runtimeFingerprint,
    String(before.registeredInstallCount)
  ].join('\0')).digest('hex');
  return Object.freeze({identity,payloadSha256:proof.archivedPayloadSha256});
}
