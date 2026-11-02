import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {signV2HpcReceipt,verifyV2HpcReceipt} from '../src/v2-hpc-signed-receipt.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const keys=generateKeyPairSync('ed25519'),other=generateKeyPairSync('ed25519');
function fixture(host='HPC-159-17'){
 const job={schema:1,operationId:'signedReturnQA',kind:'prime-statistics',limit:1000};
 const jobBytes=Buffer.from(JSON.stringify(job)+'\n');
 const result={...job,count:168,sum:76127};
 const r={schema:1,host,scope:'V1_LOCAL_OWNER_QUEUE_NOT_CENTRAL_V2',
  result,inputSha256:sha(jobBytes),digest:sha(JSON.stringify(result))};
 const w={schema:1,scope:'V1_OWNER_SIGNED_QA_NOT_PRODUCTION',
  host,operationId:job.operationId,signedEnvelopeSha256:'a'.repeat(64),
  signedPayloadSha256:'b'.repeat(64),jobSha256:r.inputSha256,keyId:'mmz-hpc-qa-20261102'};
 const receiptBytes=Buffer.from(JSON.stringify(r)+'\n');
 const witnessBytes=Buffer.from(JSON.stringify(w)+'\n');
 const envelope=signV2HpcReceipt({host,receiptBytes,witnessBytes,
  privateKey:keys.privateKey,issuedAtMs:1762120000000});
 const verify=(patch={})=>verifyV2HpcReceipt({envelope,expectedHost:host,
  receiptBytes,witnessBytes,publicKey:keys.publicKey,
  now:1762120001000,...patch});
 return {r,w,envelope,receiptBytes,witnessBytes,verify};
}
test('valid native signed return receipt verifies and cannot attest OAuth',()=>{
 const f=fixture();const r=f.verify();
 assert.equal(r.signatureVerified,true);
 assert.equal(r.count,168);assert.equal(r.sum,76127);
 assert.equal(r.chatGPTOAuthAttested,false);assert.equal(r.productionV2,false);
});
test('reject wrong host, untrusted public key, arbitrary metadata and signature tampering',()=>{
 const f=fixture();
 assert.throws(()=>f.verify({expectedHost:'HPC-154-66'}),{code:'V2_HPC_RESULT_WRONG_HOST'});
 assert.throws(()=>f.verify({publicKey:other.publicKey}),{code:'V2_HPC_RESULT_BAD_SIGNATURE'});
 assert.throws(()=>f.verify({envelope:{...f.envelope,productionV2:true}}),{code:'V2_HPC_RESULT_ENVELOPE_INVALID'});
 assert.throws(()=>f.verify({envelope:{...f.envelope,signature:'not-real'}}),{code:'V2_HPC_RESULT_ENVELOPE_INVALID'});
 const altered=structuredClone(f.envelope);altered.payload.issuedAtMs++;
 assert.throws(()=>f.verify({envelope:altered}),{code:'V2_HPC_RESULT_BAD_SIGNATURE'});
});
test('signed result binds exact receipt bytes, witness bytes, job SHA and digest',()=>{
 const f=fixture();
 const r=structuredClone(f.r);r.result.sum++;
 assert.throws(()=>f.verify({receiptBytes:Buffer.from(JSON.stringify(r)+'\n')}),{code:'V2_HPC_RESULT_SOURCE_CONFLICT'});
 const w=structuredClone(f.w);w.signedEnvelopeSha256='c'.repeat(64);
 assert.throws(()=>f.verify({witnessBytes:Buffer.from(JSON.stringify(w)+'\n')}),{code:'V2_HPC_RESULT_CONTENT_MISMATCH'});
 assert.throws(()=>f.verify({receiptBytes:Buffer.concat([f.receiptBytes,Buffer.from(' ')])}),{code:'V2_HPC_RESULT_CONTENT_MISMATCH'});
});
test('reject unverifiable raw output, fake identity claims and invalid clock',()=>{
 const f=fixture();
 assert.throws(()=>f.verify({now:1762119900000}),{code:'V2_HPC_RESULT_CLOCK_INVALID'});
 const bad=Buffer.from(JSON.stringify({...f.r,scope:'V2_PRODUCTION'})+'\n');
 assert.throws(()=>signV2HpcReceipt({host:'HPC-159-17',receiptBytes:bad,witnessBytes:f.witnessBytes,privateKey:keys.privateKey}),{code:'V2_HPC_RESULT_SOURCE_CONFLICT'});
 const w=Buffer.from(JSON.stringify({...f.w,jobSha256:'f'.repeat(64)})+'\n');
 assert.throws(()=>f.verify({witnessBytes:w}),{code:'V2_HPC_RESULT_SOURCE_CONFLICT'});
});
test('other HPC can sign independent result, but not impersonate another host',()=>{
 const f=fixture('HPC-154-66');
 assert.equal(f.verify().host,'HPC-154-66');
 assert.throws(()=>f.verify({expectedHost:'HPC-159-17'}),{code:'V2_HPC_RESULT_WRONG_HOST'});
});
