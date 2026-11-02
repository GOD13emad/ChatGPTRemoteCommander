import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {createV2HpcSignedAutoAdmission} from '../src/v2-hpc-signed-queue-admission.mjs';
import {signV2HpcBoundedJob} from '../src/v2-hpc-signed-job.mjs';
import {createV2HpcLocalQueue} from '../src/v2-hpc-queue-worker.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const start=1762120000000;
function fixture(host='HPC-159-17'){
 const top=fs.mkdtempSync(path.join(os.tmpdir(),'v2-signed-auto-test-'));
 const root=path.join(top,'CommanderV2-ComputeBridge-QA');fs.mkdirSync(root);
 const k=generateKeyPairSync('ed25519');
 const publicKey=Buffer.from(k.publicKey.export({format:'pem',type:'spki'}));
 const worker=createV2HpcSignedAutoAdmission({root,host,publicKey,
  expectedPublicKeySha256:sha(publicKey),now:()=>start+1000});
 const sign=(id,options={})=>{
  const envelope=signV2HpcBoundedJob({
   hostId:options.hostId||host,keyId:'mmz-hpc-qa-20261102',
   issuedAtMs:start,expiresAtMs:start+180000,
   job:{schema:1,operationId:id,kind:'prime-statistics',limit:1000},
   privateKey:k.privateKey});
  const dir=path.join(root,'signed-qa-inbox');
  fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify(envelope)+'\n');
  return envelope;
 };
 const file=(directory,id)=>path.join(root,directory,id+'.json');
 return {root,worker,sign,file,close:()=>fs.rmSync(top,{recursive:true,force:true}),
  keys:k,publicKey};
}
test('valid host-bound signature is auto-admitted with immutable witness once',()=>{
 const f=fixture();try{
  f.sign('job01');const first=f.worker.run();
  assert.equal(first.admitted,1);assert.equal(first.invalid,0);
  const job=JSON.parse(fs.readFileSync(f.file('compute-inbox','job01')));
  assert.equal(job.kind,'prime-statistics');assert.equal(job.limit,1000);
  const proof=JSON.parse(fs.readFileSync(f.file('signed-qa-admissions','job01')));
  assert.equal(proof.scope,'V1_OWNER_SIGNED_QA_NOT_PRODUCTION');
  const before=fs.readFileSync(f.file('compute-inbox','job01'));
  const replay=f.worker.run();assert.equal(replay.reconciled,1);
  assert.deepEqual(fs.readFileSync(f.file('compute-inbox','job01')),before);
 }finally{f.close();}
});
test('cross-host valid signature and tampered limit create no job',()=>{
 const f=fixture();try{
  f.sign('wrong',{hostId:'HPC-154-66'});
  const tamper=f.sign('tamper');
  tamper.payload.job.limit=1111;
  fs.writeFileSync(f.file('signed-qa-inbox','tamper'),JSON.stringify(tamper)+'\n');
  const r=f.worker.run();
  assert.equal(r.invalid,2);assert.equal(r.admitted,0);
  assert.equal(fs.readdirSync(path.join(f.root,'compute-inbox')).length,0);
 }finally{f.close();}
});
test('expired signature cannot be first admitted',()=>{
 const f=fixture();try{
  f.sign('expired');
  const old=createV2HpcSignedAutoAdmission({root:f.root,host:'HPC-159-17',
   publicKey:f.publicKey,expectedPublicKeySha256:sha(f.publicKey),
   now:()=>start+190000});
  const r=old.run();assert.equal(r.invalid,1);assert.equal(r.admitted,0);
  assert.equal(fs.existsSync(f.file('compute-inbox','expired')),false);
 }finally{f.close();}
});
test('prior legacy unsigned job is not silently attested as signed',()=>{
 const f=fixture();try{
  f.sign('legacy');
  fs.writeFileSync(f.file('compute-inbox','legacy'),
   JSON.stringify({schema:1,operationId:'legacy',kind:'prime-statistics',limit:1000})+'\n');
  const r=f.worker.run();assert.equal(r.preexisting,1);
  assert.equal(fs.existsSync(f.file('signed-qa-admissions','legacy')),false);
 }finally{f.close();}
});
test('changed signed input or committed job conflicts with witness',()=>{
 const f=fixture();try{
  f.sign('locked');f.worker.run();
  let original=fs.readFileSync(f.file('compute-inbox','locked'));
  fs.writeFileSync(f.file('compute-inbox','locked'),JSON.stringify({schema:1,operationId:'locked',kind:'prime-statistics',limit:999})+'\\n');
  assert.throws(()=>f.worker.run(),{code:'V2_SIGNED_AUTO_WITNESS_CONFLICT'});
  fs.writeFileSync(f.file('compute-inbox','locked'),original);
  const env=JSON.parse(fs.readFileSync(f.file('signed-qa-inbox','locked')));
  env.payload.job.limit=999;
  fs.writeFileSync(f.file('signed-qa-inbox','locked'),JSON.stringify(env)+'\n');
  assert.throws(()=>f.worker.run(),{code:'V2_SIGNED_AUTO_WITNESS_CONFLICT'});
 }finally{f.close();}
});
test('scan is bounded and pending-first, avoiding stale witness starvation',()=>{
 const f=fixture();try{
  for(let i=0;i<35;i++)f.sign('job'+String(i).padStart(3,'0'));
  assert.equal(f.worker.run().admitted,32);
  const second=f.worker.run();assert.equal(second.admitted,3);
  assert.equal(fs.readdirSync(path.join(f.root,'compute-inbox')).length,35);
 }finally{f.close();}
});


test('scheduled signed-only queue refuses new unsigned job but executes signed one',()=>{
 const f=fixture();try{
  const queue=createV2HpcLocalQueue({root:f.root,host:'HPC-159-17'});
  fs.writeFileSync(f.file('compute-inbox','unsigned'),
   JSON.stringify({schema:1,operationId:'unsigned',kind:'prime-statistics',limit:1000})+'\n');
  let r=queue.run({authorizePendingJob:(id,sha)=>f.worker.verifyForExecution(id,sha)});
  assert.equal(r.committed,0);assert.equal(r.unsignedRejected,1);
  assert.equal(fs.existsSync(f.file('compute-outbox','unsigned')),false);
  f.sign('signed');assert.equal(f.worker.run().admitted,1);
  r=queue.run({authorizePendingJob:(id,sha)=>f.worker.verifyForExecution(id,sha)});
  assert.equal(r.committed,1);assert.equal(r.unsignedRejected,1);
  assert.equal(queue.verify('signed').count,168);
  assert.equal(fs.existsSync(f.file('compute-outbox','unsigned')),false);
 }finally{f.close();}
});
test('signed-only worker reconciles historical unsigned receipts without new unsigned effects',()=>{
 const f=fixture();try{
  const queue=createV2HpcLocalQueue({root:f.root,host:'HPC-159-17'});
  fs.writeFileSync(f.file('compute-inbox','historical'),
   JSON.stringify({schema:1,operationId:'historical',kind:'prime-statistics',limit:1000})+'\n');
  assert.equal(queue.run().committed,1);
  fs.writeFileSync(f.file('compute-inbox','newUnsigned'),
   JSON.stringify({schema:1,operationId:'newUnsigned',kind:'prime-statistics',limit:1000})+'\n');
  const r=queue.run({authorizePendingJob:(id,sha)=>f.worker.verifyForExecution(id,sha)});
  assert.equal(r.committed,0);assert.equal(r.reconciled,1);
  assert.equal(r.unsignedRejected,1);
  assert.equal(fs.existsSync(f.file('compute-outbox','newUnsigned')),false);
 }finally{f.close();}
});
test('expired admitted signature cannot cause a NEW signed-only compute effect',()=>{
 const f=fixture();try{
  f.sign('stale');assert.equal(f.worker.run().admitted,1);
  const expired=createV2HpcSignedAutoAdmission({root:f.root,host:'HPC-159-17',
   publicKey:f.publicKey,expectedPublicKeySha256:sha(f.publicKey),
   now:()=>start+200000});
  const q=createV2HpcLocalQueue({root:f.root,host:'HPC-159-17'});
  const r=q.run({authorizePendingJob:(id,h)=>expired.verifyForExecution(id,h)});
  assert.equal(r.committed,0);assert.equal(r.unsignedRejected,1);
  assert.equal(fs.existsSync(f.file('compute-outbox','stale')),false);
 }finally{f.close();}
});
test('signed-only queue denies altered committed witness or input',()=>{
 const f=fixture();try{
  f.sign('signed');f.worker.run();
  const file=f.file('compute-inbox','signed');
  const old=fs.readFileSync(file);
  fs.writeFileSync(file,JSON.stringify({schema:1,operationId:'signed',kind:'prime-statistics',limit:999})+'\n');
  const queue=createV2HpcLocalQueue({root:f.root,host:'HPC-159-17'});
  assert.throws(()=>queue.run({authorizePendingJob:(id,h)=>f.worker.verifyForExecution(id,h)}),
   {code:'V2_SIGNED_AUTO_EXECUTION_WITNESS_CONFLICT'});
  fs.writeFileSync(file,old);
  const witness=f.file('signed-qa-admissions','signed');
  const w=JSON.parse(fs.readFileSync(witness,'utf8'));
  w.signedPayloadSha256='0'.repeat(64);
  fs.writeFileSync(witness,JSON.stringify(w)+'\n');
  assert.throws(()=>queue.run({authorizePendingJob:(id,h)=>f.worker.verifyForExecution(id,h)}),
   {code:'V2_SIGNED_AUTO_EXECUTION_BINDING_CONFLICT'});
  assert.equal(fs.existsSync(f.file('compute-outbox','signed')),false);
 }finally{f.close();}
});
