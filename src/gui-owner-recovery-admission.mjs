// Source-only E39 diagnostic admission assessment: NEVER native GUI authority.
// Every input below is caller-controlled (even if labelled privileged).
// Only a future OS-protected broker can attest owner presence, trusted nonce
// storage, a cross-session/all-version dispatch barrier and original J01 archive.
// In particular, this module MUST NOT become a GUI unlock condition.
import {createHash} from 'node:crypto';
import {reviewSignatureBytes} from './gui-owner-review-challenge.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = ['id','tool','startedUtc','evidenceSha256','evidenceBytes'];
const denied = (blockers,bindingSha256=null) => Object.freeze({
  schema:'rc-gui-owner-recovery-diagnostic-v1',
  scope:'SOURCE_ONLY_UNTRUSTED_EVIDENCE',
  incidentBindingSha256:bindingSha256,
  nativeOutcome:'UNKNOWN',
  ownerAuthenticated:false,
  protectedNonceConsumed:false,
  fleetQuiescenceProven:false,
  archiveTrusted:false,
  releaseAuthorized:false,
  noReplay:true,
  blockers:Object.freeze([...new Set(blockers)])
});

export function assessGuiOwnerRecoveryEvidence(input={}) {
  const blockers=[];
  let digest=null;
  try {
    if (!object(input)) return denied(['EVIDENCE_INVALID']);
    const {challenge,observedIncident,signedReview,diagnosticClaim,dispatcherScan,brokerProof,archiveProof}=input;
    try {
      const canonical=reviewSignatureBytes(challenge);
      digest=sha(canonical);
      if (challenge.challengeSha256!==digest)
        throw Error('CHALLENGE_DIGEST_MISMATCH');
    } catch {
      return denied(['INCIDENT_BINDING_INVALID']);
    }

    // Compare incident-specific data for *inconsistency* only. Even a matching
    // mutable same-user snapshot cannot prove the original J01 bytes.
    if (!object(observedIncident)) blockers.push('INCIDENT_SNAPSHOT_MISSING');
    else if (fields.some(k=>observedIncident[k]!==({
      id:challenge.incidentId,
      tool:challenge.incidentTool,
      startedUtc:challenge.incidentStartedUtc,
      evidenceSha256:challenge.originalSha256,
      evidenceBytes:challenge.originalBytes
    })[k]) ||
      observedIncident.status!=='PENDING_NATIVE_EFFECT' ||
      observedIncident.nativeOutcome!=='UNKNOWN')
      blockers.push('INCIDENT_SNAPSHOT_MISMATCH');
    blockers.push('ORIGINAL_J01_BYTES_NOT_ATTESTED');

    if (!object(signedReview) || signedReview.signatureValid!==true)
      blockers.push('SIGNATURE_NOT_VERIFIED');
    blockers.push('OS_OWNER_IDENTITY_NOT_ATTESTED');

    if (!object(diagnosticClaim) || diagnosticClaim.claimRecorded!==true)
      blockers.push('NONCE_CLAIM_NOT_RECORDED');
    blockers.push('PROTECTED_NONCE_LEDGER_NOT_ATTESTED');

    if (!object(dispatcherScan)||dispatcherScan.scan!=='ADVISORY_ONLY'||
        dispatcherScan.coverage!=='PROCESS_CENSUS_ONLY'||
        !Array.isArray(dispatcherScan.active)||
        dispatcherScan.activeCount!==dispatcherScan.active.length)
      blockers.push('DISPATCHER_CENSUS_INCOMPLETE');
    else if (dispatcherScan.activeCount>0)
      blockers.push('DISPATCHERS_OBSERVED');
    // A positive or empty census is never a distributed input dispatch barrier.
    blockers.push('NATIVE_FLEET_QUIESCENCE_NOT_ATTESTED');

    // Never trust caller flags such as ownerAuthenticated, releaseAuthorized,
    // archiveTrusted or arbitrary broker names. They cannot be authority.
    if ([signedReview,diagnosticClaim,dispatcherScan,brokerProof,archiveProof]
      .some(v=>object(v) && (
        v.releaseAuthorized===true || v.ownerAuthenticated===true ||
        v.storageTrusted===true || v.fleetQuiescenceProven===true ||
        v.archiveTrusted===true || v.protectedNonceConsumed===true
      ))) blockers.push('CALLER_AUTHORITY_ASSERTION_REJECTED');

    blockers.push('OS_PROTECTED_BROKER_NOT_ATTESTED');
    blockers.push('CRASH_SAFE_J01_ARCHIVE_NOT_ATTESTED');
    return denied(blockers,digest);
  } catch {
    return denied(['EVIDENCE_UNREADABLE'],digest);
  }
}
