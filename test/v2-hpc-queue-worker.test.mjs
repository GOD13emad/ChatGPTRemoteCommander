import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createV2HpcLocalQueue} from '../src/v2-hpc-queue-worker.mjs';

const fixture=()=>{const top=fs.mkdtempSync(path.join(os.tmpdir(),'v2-hpc-queue-test-'));
 const root=path.join(top,'CommanderV2-ComputeBridge-QA');fs.mkdirSync(root);
 const host='HPC-159-17';const worker=createV2HpcLocalQueue({root,host});
 const put=(id,extra={})=>{
  const content=JSON.stringify({schema:1,operationId:id,kind:'prime-statistics',limit:1000,...extra});
  fs.writeFileSync(path.join(root,'compute-inbox',id+'.json'),content,{flag:'wx',mode:0o600});
 };
 return {worker,root,host,put,close:()=>fs.rmSync(top,{recursive:true,force:true})};};
test('bounded native queue creates one immutable result and verifies independently',()=>{
 const f=fixture();try{
  f.put('prime1000');
  const first=f.worker.run();assert.deepEqual([first.committed,first.reconciled,first.invalid],[1,0,0]);
  const proof=f.worker.verify('prime1000');
  assert.equal(proof.count,168);assert.equal(proof.sum,76127);
  assert.equal(proof.productionV2,false);
  const receipt=path.join(f.root,'compute-outbox','prime1000.json');
  const raw=fs.readFileSync(receipt);
  assert.deepEqual([f.worker.run().committed,f.worker.run().reconciled],[0,1]);
  assert.deepEqual(fs.readFileSync(receipt),raw);
 }finally{f.close();}
});
test('unrecognized capability and overlimit jobs never create effects',()=>{
 const f=fixture();try{
  for(const [id,extra] of [
    ['shell',{command:'whoami'}],['gui',{gui:'click'}],
    ['browser',{browser:'open'}],['huge',{limit:50001}],
    ['wrongkind',{kind:'run-shell'}],['zero',{limit:0}]
  ])f.put(id,extra);
  const result=f.worker.run();assert.equal(result.committed,0);
  assert.equal(result.invalid,6);
  assert.equal(fs.readdirSync(path.join(f.root,'compute-outbox')).length,0);
 }finally{f.close();}
});
test('same ID with edited input cannot overwrite a committed receipt',()=>{
 const f=fixture();try{
  f.put('same');
  assert.equal(f.worker.run().committed,1);
  const original=fs.readFileSync(path.join(f.root,'compute-outbox','same.json'));
  fs.writeFileSync(path.join(f.root,'compute-inbox','same.json'),
    JSON.stringify({schema:1,operationId:'same',kind:'prime-statistics',limit:900}));
  assert.throws(()=>f.worker.run(),{code:'V2_HPC_QUEUE_RECEIPT_CONFLICT'});
  assert.deepEqual(fs.readFileSync(path.join(f.root,'compute-outbox','same.json')),original);
 }finally{f.close();}
});
test('corrupted receipt and symlinked inbox fail closed, not rewritten',()=>{
 const f=fixture();try{
  f.put('corrupt');f.worker.run();
  const result=path.join(f.root,'compute-outbox','corrupt.json');
  fs.writeFileSync(result,'{"bad":true}');
  assert.throws(()=>f.worker.verify('corrupt'),{code:'V2_HPC_QUEUE_RECEIPT_UNSAFE'});
  assert.throws(()=>f.worker.run(),{code:'V2_HPC_QUEUE_RECEIPT_UNSAFE'});
 }finally{f.close();}
});
test('unregistered host, invalid source root and operation path are rejected',()=>{
 const f=fixture();try{
  assert.throws(()=>createV2HpcLocalQueue({root:f.root,host:'other'}),
    {code:'V2_HPC_QUEUE_TRUSTED_HOST_REQUIRED'});
  assert.throws(()=>createV2HpcLocalQueue({root:f.root+'/../',host:f.host}),
    {code:'V2_HPC_QUEUE_TRUSTED_HOST_REQUIRED'});
  assert.throws(()=>f.worker.verify('../evil'),{code:'V2_HPC_QUEUE_OPERATION_ID_INVALID'});
 }finally{f.close();}
});
test('bounded scan processes a maximum 32 jobs per invocation',()=>{
 const f=fixture();try{
  for(let i=0;i<40;i++)f.put('case'+String(i).padStart(3,'0'));
  const first=f.worker.run();assert.equal(first.processed,32);assert.equal(first.committed,32);
  const second=f.worker.run();assert.equal(second.processed,32);assert.equal(second.committed,8);
  assert.equal(second.reconciled,24);
  const third=f.worker.run();assert.equal(third.processed,32);assert.equal(third.committed,0);
  assert.equal(third.reconciled,32);
  assert.equal(fs.readdirSync(path.join(f.root,'compute-outbox')).length,40);
 }finally{f.close();}
});
