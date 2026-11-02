import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {signV2HpcBoundedJob} from '../src/v2-hpc-signed-job.mjs';
import {createV2HpcSignedAutoAdmission} from '../src/v2-hpc-signed-queue-admission.mjs';
import {createV2HpcLocalQueue} from '../src/v2-hpc-queue-worker.mjs';
import {createV2HpcSignedReturnQueue} from '../src/v2-hpc-signed-return-queue.mjs';
import {verifyV2HpcReceipt} from '../src/v2-hpc-signed-receipt.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const now=1762120001000;
function setup(host='HPC-159-17'){
 const top=fs.mkdtempSync(path.join(os.tmpdir(),'v2-hpc-return-'));
 const root=path.join(top,'CommanderV2-ComputeBridge-QA');fs.mkdirSync(root);
 const owner=generateKeyPairSync('ed25519'),hpc=generateKeyPairSync('ed25519');
 const ownerPub=Buffer.from(owner.publicKey.export({type:'spki',format:'pem'}));
 const receiptPub=Buffer.from(hpc.publicKey.export({type:'spki',format:'pem'}));
 const receiptPriv=Buffer.from(hpc.privateKey.export({type:'pkcs8',format:'pem'}));
 const admission=createV2HpcSignedAutoAdmission({root,host,publicKey:ownerPub,
  expectedPublicKeySha256:sha(ownerPub),now:()=>now});
 const worker=createV2HpcLocalQueue({root,host});
 const returnQueue=createV2HpcSignedReturnQueue({root,host,privateKey:receiptPriv,
  receiptPublicKey:receiptPub,ownerPublicKey:ownerPub,worker,now:()=>now});
 const id='signedOne';
 const signed=signV2HpcBoundedJob({hostId:host,keyId:'mmz-hpc-qa-20261102',
  issuedAtMs:now-1000,expiresAtMs:now+180000,privateKey:owner.privateKey,
  job:{schema:1,operationId:id,kind:'prime-statistics',limit:1000}});
 fs.writeFileSync(path.join(root,'signed-qa-inbox',id+'.json'),JSON.stringify(signed)+'\n');
 const file=(directory)=>path.join(root,directory,id+'.json');
 return {root,id,admission,worker,returnQueue,file,receiptPub,
  close:()=>fs.rmSync(top,{recursive:true,force:true})};
}
test('sign native self-verifiable receipt after signed-only admitted effect',()=>{
 const f=setup();try{
  assert.equal(f.admission.run().admitted,1);
  assert.equal(f.worker.run({authorizePendingJob:(id,h)=>f.admission.verifyForExecution(id,h)}).committed,1);
  assert.equal(f.returnQueue.seal().created,1);
  const b=fs.readFileSync(f.file('signed-qa-return-receipts'));
  const verified=verifyV2HpcReceipt({envelope:JSON.parse(b),expectedHost:'HPC-159-17',
   receiptBytes:fs.readFileSync(f.file('compute-outbox')),
   witnessBytes:fs.readFileSync(f.file('signed-qa-admissions')),
   publicKey:f.receiptPub,now});
  assert.equal(verified.signatureVerified,true);assert.equal(verified.count,168);
  assert.equal(f.returnQueue.seal().reconciled,1);
  assert.deepEqual(fs.readFileSync(f.file('signed-qa-return-receipts')),b);
 }finally{f.close();}
});
test('missing effect has no signed result; cannot forge receipt from admission alone',()=>{
 const f=setup();try{
  assert.equal(f.admission.run().admitted,1);
  assert.equal(f.returnQueue.seal().waiting,1);
  assert.equal(fs.existsSync(f.file('signed-qa-return-receipts')),false);
 }finally{f.close();}
});
test('tampering native witness or receipt after sealing fails closed',()=>{
 const f=setup();try{
  f.admission.run();
  f.worker.run({authorizePendingJob:(id,h)=>f.admission.verifyForExecution(id,h)});
  f.returnQueue.seal();
  const witness=JSON.parse(fs.readFileSync(f.file('signed-qa-admissions')));
  witness.signedPayloadSha256='0'.repeat(64);
  fs.writeFileSync(f.file('signed-qa-admissions'),JSON.stringify(witness)+'\n');
  assert.throws(()=>f.returnQueue.seal(),{code:'V2_HPC_RETURN_QA_ORIGIN_INVALID'});
 }finally{f.close();}
});
test('HPC signer private/public mismatch cannot be used to sign',()=>{
 const f=setup();try{
  const attacker=generateKeyPairSync('ed25519');
  assert.throws(()=>createV2HpcSignedReturnQueue({root:f.root,host:'HPC-159-17',
   privateKey:Buffer.from(attacker.privateKey.export({type:'pkcs8',format:'pem'})),
   receiptPublicKey:f.receiptPub,ownerPublicKey:f.receiptPub,worker:f.worker}),
   {code:'V2_HPC_RETURN_QA_KEY_PAIR_MISMATCH'});
 }finally{f.close();}
});
