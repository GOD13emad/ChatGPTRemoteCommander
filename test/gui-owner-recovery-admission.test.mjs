import test from 'node:test';
import assert from 'node:assert/strict';
import {createIncidentReviewChallenge} from '../src/gui-owner-review-challenge.mjs';
import {assessGuiOwnerRecoveryEvidence} from '../src/gui-owner-recovery-admission.mjs';

const incident=()=>({
 id:'11111111-2222-4333-8444-555555555555',
 tool:'gui_focus_window',startedUtc:'2026-10-21T00:00:00.000Z',
 status:'PENDING_NATIVE_EFFECT',nativeOutcome:'UNKNOWN',
 evidenceSha256:'ab'.repeat(32),evidenceBytes:127
});
const challenge=()=>createIncidentReviewChallenge({
 incident:incident(),nonce:'cd'.repeat(32),
 issuedUtc:'2026-10-21T00:00:10.000Z',
 expiryUtc:'2026-10-21T00:01:10.000Z'
});
const input=()=>({
 challenge:challenge(),observedIncident:incident(),
 signedReview:{signatureValid:true,ownerAuthenticated:false,releaseAuthorized:false},
 diagnosticClaim:{claimRecorded:true,storageTrusted:false,releaseAuthorized:false},
 dispatcherScan:{scan:'ADVISORY_ONLY',coverage:'PROCESS_CENSUS_ONLY',
    active:[],activeCount:0,quiescenceProven:false,releaseAuthorized:false}
});
const denied=r=>{
 assert.equal(r.releaseAuthorized,false);
 assert.equal(r.ownerAuthenticated,false);
 assert.equal(r.protectedNonceConsumed,false);
 assert.equal(r.fleetQuiescenceProven,false);
 assert.equal(r.archiveTrusted,false);
 assert.equal(r.nativeOutcome,'UNKNOWN');
 assert.equal(r.noReplay,true);
 assert.equal(r.scope,'SOURCE_ONLY_UNTRUSTED_EVIDENCE');
 assert.ok(Object.isFrozen(r));
 assert.ok(Object.isFrozen(r.blockers));
 assert.ok(r.blockers.includes('OS_PROTECTED_BROKER_NOT_ATTESTED'));
 assert.ok(r.blockers.includes('NATIVE_FLEET_QUIESCENCE_NOT_ATTESTED'));
 assert.ok(r.blockers.includes('CRASH_SAFE_J01_ARCHIVE_NOT_ATTESTED'));
};
test('empty and null data never unlock or throw',()=>{
 for(const x of [undefined,null,false,[],{},'trusted']) {
  const r=assessGuiOwnerRecoveryEvidence(x);
  assert.equal(r.releaseAuthorized,false);
  assert.ok(r.blockers.includes('EVIDENCE_INVALID')||
            r.blockers.includes('INCIDENT_BINDING_INVALID'));
 }
});
test('matching incident and all positive *diagnostic* receipts are not permission',()=>{
 const r=assessGuiOwnerRecoveryEvidence(input());
 denied(r);
 assert.equal(r.incidentBindingSha256,input().challenge.challengeSha256);
 assert.equal(r.blockers.includes('INCIDENT_SNAPSHOT_MISMATCH'),false);
});
test('old original J01 SHA cannot be substituted by a new fingerprint',()=>{
 const x=input();x.observedIncident.evidenceSha256='ff'.repeat(32);
 const r=assessGuiOwnerRecoveryEvidence(x);denied(r);
 assert.ok(r.blockers.includes('INCIDENT_SNAPSHOT_MISMATCH'));
});
test('different incident ID or J01 tool is rejected',()=>{
 for(const k of ['id','tool','startedUtc','evidenceBytes','nativeOutcome','status']) {
  const x=input();
  x.observedIncident[k]=k==='evidenceBytes'?999:'forged';
  const r=assessGuiOwnerRecoveryEvidence(x);denied(r);
  assert.ok(r.blockers.includes('INCIDENT_SNAPSHOT_MISMATCH'));
 }
});
test('missing incident snapshot cannot be interpreted as resolved',()=>{
 const x=input();delete x.observedIncident;
 const r=assessGuiOwnerRecoveryEvidence(x);denied(r);
 assert.ok(r.blockers.includes('INCIDENT_SNAPSHOT_MISSING'));
});
test('forged digest and release flag in canonical challenge are invalid',()=>{
 for(const change of [{challengeSha256:'00'.repeat(32)},{releaseAuthorized:true}]) {
  const x=input();x.challenge={...x.challenge,...change};
  const r=assessGuiOwnerRecoveryEvidence(x);
  assert.equal(r.releaseAuthorized,false);
  assert.deepEqual(r.blockers,['INCIDENT_BINDING_INVALID']);
 }
});
test('boolean-like strings do not count as verified review or claim',()=>{
 const x=input();
 x.signedReview.signatureValid='true';x.diagnosticClaim.claimRecorded=1;
 const r=assessGuiOwnerRecoveryEvidence(x);denied(r);
 assert.ok(r.blockers.includes('SIGNATURE_NOT_VERIFIED'));
 assert.ok(r.blockers.includes('NONCE_CLAIM_NOT_RECORDED'));
});
test('census is not quiescence even with zero observed processes',()=>{
 const r=assessGuiOwnerRecoveryEvidence(input());denied(r);
 assert.equal(r.blockers.includes('DISPATCHERS_OBSERVED'),false);
 assert.equal(r.blockers.includes('DISPATCHER_CENSUS_INCOMPLETE'),false);
});
test('legacy or mixed dispatcher observation forces explicit diagnostic blocker',()=>{
 const x=input();x.dispatcherScan.active=[
  {pid:420,role:'core',session:1,observedVersion:'0.10.24'}
 ];x.dispatcherScan.activeCount=1;
 const r=assessGuiOwnerRecoveryEvidence(x);denied(r);
 assert.ok(r.blockers.includes('DISPATCHERS_OBSERVED'));
});
test('failed and contradictory census is never accepted as complete',()=>{
 for(const scan of [
   {scan:'FAILED',coverage:'UNKNOWN',active:null,activeCount:null},
   {scan:'ADVISORY_ONLY',coverage:'PROCESS_CENSUS_ONLY',active:[],activeCount:1}
 ]) {
   const x=input();x.dispatcherScan=scan;
   const r=assessGuiOwnerRecoveryEvidence(x);denied(r);
   assert.ok(r.blockers.includes('DISPATCHER_CENSUS_INCOMPLETE'));
 }
});
test('all caller claimed privilege, archive and owner approval flags are rejected',()=>{
 const x=input();
 x.signedReview.ownerAuthenticated=true;
 x.diagnosticClaim.storageTrusted=true;
 x.dispatcherScan.fleetQuiescenceProven=true;
 x.brokerProof={ownerAuthenticated:true,releaseAuthorized:true,
   principal:'SYSTEM',ownerPresent:true,clientLogonSid:'S-1-5-5-1-2'};
 x.archiveProof={archiveTrusted:true,j01Restored:true};
 const r=assessGuiOwnerRecoveryEvidence(x);denied(r);
 assert.ok(r.blockers.includes('CALLER_AUTHORITY_ASSERTION_REJECTED'));
});
test('getters throwing cannot turn observation errors into permission',()=>{
 const x=input();x.brokerProof={get releaseAuthorized(){throw Error('spoof')}};
 const r=assessGuiOwnerRecoveryEvidence(x);
 assert.equal(r.releaseAuthorized,false);
 assert.deepEqual(r.blockers,['EVIDENCE_UNREADABLE']);
});
test('all output blocker labels stable and deduplicated',()=>{
 const a=assessGuiOwnerRecoveryEvidence(input());
 const b=assessGuiOwnerRecoveryEvidence(input());
 assert.deepEqual(a,b);
 assert.equal(new Set(a.blockers).size,a.blockers.length);
 assert.equal(typeof a.incidentBindingSha256,'string');
});
