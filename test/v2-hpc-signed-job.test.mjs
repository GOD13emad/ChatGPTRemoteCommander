import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {signV2HpcBoundedJob,verifyV2HpcBoundedJob}
 from '../src/v2-hpc-signed-job.mjs';

const keys=generateKeyPairSync('ed25519');
const alternate=generateKeyPairSync('ed25519');
const start=1762120000000;
function fixture(host='HPC-159-17'){
 const job={schema:1,operationId:'signedPrime18000',kind:'prime-statistics',limit:18000};
 const envelope=signV2HpcBoundedJob({job,hostId:host,keyId:'mmz-hpc-qa-20261102',
  issuedAtMs:start,expiresAtMs:start+180000,privateKey:keys.privateKey});
 return {envelope,job};
}
function verify(envelope,overrides={}){
 return verifyV2HpcBoundedJob({envelope,expectedHostId:'HPC-159-17',
 expectedKeyId:'mmz-hpc-qa-20261102',publicKey:keys.publicKey,
 now:start+1000,...overrides});
}
test('Ed25519 exact bounded job accepted for pinned HPC and key ID',()=>{
 const {envelope}=fixture(),v=verify(envelope);
 assert.equal(v.hostId,'HPC-159-17');
 assert.equal(v.boundedJob.limit,18000);
 assert.match(v.signedPayloadSha256,/^[a-f0-9]{64}$/);
 assert.equal(v.chatGPTOAuthAttested,false);
 assert.equal(v.productionWorkerEnrolled,false);
});
test('target host and key ID are both cryptographically and contract bound',()=>{
 const {envelope}=fixture();
 assert.throws(()=>verify(envelope,{expectedHostId:'HPC-154-66'}),{code:'V2_SIGNED_JOB_WRONG_RECIPIENT'});
 assert.throws(()=>verify(envelope,{expectedKeyId:'other-key'}),{code:'V2_SIGNED_JOB_WRONG_RECIPIENT'});
 assert.throws(()=>verify(envelope,{publicKey:alternate.publicKey}),{code:'V2_SIGNED_JOB_BAD_SIGNATURE'});
 const modified=structuredClone(envelope);modified.payload.hostId='HPC-154-66';
 assert.throws(()=>verify(modified,{expectedHostId:'HPC-154-66'}),{code:'V2_SIGNED_JOB_BAD_SIGNATURE'});
});
test('tampered limit or operationId cannot produce a signed accepted job',()=>{
 for(const [field,value] of [['limit',50000],['operationId','different']]){
  const bad=structuredClone(fixture().envelope);bad.payload.job[field]=value;
  assert.throws(()=>verify(bad),{code:'V2_SIGNED_JOB_BAD_SIGNATURE'});
 }
});
test('reject shell, GUI, browser and over-limit jobs before signatures',()=>{
 const base={schema:1,operationId:'test',kind:'prime-statistics',limit:150};
 for(const patch of [{command:'whoami'},{gui:'click'},{browser:'open'},
  {limit:50001},{kind:'shell'},{operationId:'../bad'}]){
  assert.throws(()=>signV2HpcBoundedJob({job:{...base,...patch},
   hostId:'HPC-159-17',keyId:'mmz-hpc-qa-20261102',
   issuedAtMs:start,expiresAtMs:start+2000,
   privateKey:keys.privateKey}),{code:'V2_SIGNED_JOB_NOT_BOUNDED'});
 }
});
test('reject expiry, excessive lifespan, not-yet-issued and untrusted key type',()=>{
 const {envelope}=fixture();
 assert.throws(()=>verify(envelope,{now:start+180000}),{code:'V2_SIGNED_JOB_OUTSIDE_TIME_WINDOW'});
 assert.throws(()=>verify(envelope,{now:start-30001}),{code:'V2_SIGNED_JOB_OUTSIDE_TIME_WINDOW'});
 assert.throws(()=>signV2HpcBoundedJob({job:fixture().job,hostId:'HPC-159-17',
  keyId:'mmz-hpc-qa-20261102',issuedAtMs:start,expiresAtMs:start+300001,
  privateKey:keys.privateKey}),{code:'V2_SIGNED_JOB_BOUNDARY_INVALID'});
});
test('strict signed envelope rejects extra metadata and corrupt signature',()=>{
 const {envelope}=fixture();
 assert.throws(()=>verify({...envelope,chatGPTOAuthAttested:true}),
  {code:'V2_SIGNED_JOB_ENVELOPE_INVALID'});
 assert.throws(()=>verify({...envelope,signature:'not-a-signature'}),
  {code:'V2_SIGNED_JOB_ENVELOPE_INVALID'});
 assert.throws(()=>verify({...envelope,payload:{...envelope.payload,command:'whoami'}}),
  {code:'V2_SIGNED_JOB_BOUNDARY_INVALID'});
});
