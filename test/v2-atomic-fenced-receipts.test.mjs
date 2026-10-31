import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash} from 'node:crypto';
import {V2CentralCoordinator} from '../src/v2-central-coordinator.mjs';
import {createV2CoordinatorRpcServer,createV2RpcTokenLookup} from '../src/v2-coordinator-rpc.mjs';
import {createV2CoordinatorRpcClient} from '../src/v2-coordinator-rpc-client.mjs';

const digest=v=>createHash('sha256').update(v).digest('hex');
const a={hostId:'host-one',principalId:'owner',profileId:'p',conversationId:'chat-one',
 operationId:'write',target:{kind:'workflow-root',id:'shared'}};
const b={...a,hostId:'host-two',conversationId:'chat-two'};
const binding=r=>({hostId:r.hostId,principalId:r.principalId,
 profileId:r.profileId,conversationId:r.conversationId});
const fixture=()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rc-v2-atomic-'));
 let now=100000;
 const options={directory,now:()=>now,authorizeLease:async()=>true,
  resolveGlobalResource:async()=> 'physical-project-one',requireGlobalResource:true};
 const central=new V2CentralCoordinator(options);
 return {directory,central,options,advance:delta=>now+=delta,
  close:()=>{central.close();fs.rmSync(directory,{recursive:true,force:true});}};
};
test('atomic receipt belongs to the current fenced lease and survives fresh SQLite process',async()=>{
 const f=fixture();
 try{
  const held=await f.central.acquire({route:a,ttlMs:2000});
  const r=await f.central.commitFencedReceipt({route:a,lease:held,
    receiptId:'step-1',digest:digest('bounded effect')});
  assert.deepEqual(r,{receiptId:'step-1',digest:digest('bounded effect'),
    fence:1,committed:true,replayed:false});
  assert.deepEqual(await f.central.commitFencedReceipt({route:a,lease:held,
    receiptId:'step-1',digest:digest('bounded effect')}),{...r,replayed:true});
  const second=new V2CentralCoordinator(f.options);
  try{
   assert.deepEqual(await second.getFencedReceipt({route:a,receiptId:'step-1'}),
    {receiptId:'step-1',digest:digest('bounded effect'),fence:1,committed:true});
  }finally{second.close();}
  await assert.rejects(f.central.commitFencedReceipt({route:a,lease:held,
    receiptId:'step-1',digest:digest('changed effect')}),
    {code:'V2_COORDINATOR_RECEIPT_CONFLICT'});
  await f.central.release({route:a,lease:held});
  const next=await f.central.acquire({route:b});
  assert.equal(next.fence,2);
  await assert.rejects(f.central.commitFencedReceipt({route:a,lease:held,
    receiptId:'step-2',digest:digest('stale')}),
    {code:'V2_COORDINATOR_STALE_LEASE'});
  await assert.rejects(f.central.commitFencedReceipt({route:b,lease:next,
    receiptId:'step-1',digest:digest('different holder')}),
    {code:'V2_COORDINATOR_RECEIPT_CONFLICT'});
  assert.equal(await f.central.getFencedReceipt({route:b,receiptId:'step-2'}),null);
 }finally{f.close();}
});
test('expiry, permission and wrong target cause no fenced receipt mutation',async()=>{
 const f=fixture();
 try{
  const held=await f.central.acquire({route:a,ttlMs:1000});
  f.advance(1001);
  await assert.rejects(f.central.commitFencedReceipt({route:a,lease:held,
   receiptId:'expired',digest:digest('late')}),{code:'V2_COORDINATOR_STALE_LEASE'});
  assert.equal(await f.central.getFencedReceipt({route:a,receiptId:'expired'}),null);
  await assert.rejects(f.central.commitFencedReceipt({route:b,lease:held,
   receiptId:'other',digest:digest('fake')}),{code:'V2_COORDINATOR_STALE_LEASE'});
  await assert.rejects(f.central.commitFencedReceipt({route:a,lease:held,
   receiptId:'bad/id',digest:digest('invalid')}),{code:'V2_COORDINATOR_RECEIPT_INPUT_INVALID'});
  await assert.rejects(f.central.commitFencedReceipt({route:a,lease:held,
   receiptId:'valid',digest:'raw-secret-not-a-digest'}),
   {code:'V2_COORDINATOR_RECEIPT_INPUT_INVALID'});
 }finally{f.close();}
});
test('SQLite 1 -> 2 schema upgrades in place without losing active lease',async()=>{
 const f=fixture();
 try{
  const held=await f.central.acquire({route:a});
  f.central.close();
  const dbfile=path.join(f.directory,'v2-central-leases.sqlite');
  const db=new DatabaseSync(dbfile);
  db.exec('DROP TABLE v2_fenced_receipt; PRAGMA user_version=1;');
  db.close();
  const upgraded=new V2CentralCoordinator(f.options);
  try{
   assert.equal(await upgraded.assertCurrent({route:a,lease:held}),true);
   const receipt=await upgraded.commitFencedReceipt({route:a,lease:held,
    receiptId:'upgrade',digest:digest('preserved')});
   assert.equal(receipt.fence,held.fence);
   const verify=new DatabaseSync(dbfile);
   try{assert.equal(verify.prepare('PRAGMA user_version').get().user_version,2);}
   finally{verify.close();}
  }finally{upgraded.close();}
 }finally{fs.rmSync(f.directory,{recursive:true,force:true});}
});
test('authenticated HTTP two-host clients receive real atomic receipt and reconcile lost ACK',async()=>{
 const f=fixture();
 const secrets=[randomBytes(32).toString('base64url'),randomBytes(32).toString('base64url')];
 const look=createV2RpcTokenLookup([a,b].map((r,i)=>({
   tokenSha256:digest(secrets[i]),binding:binding(r)})));
 const server=createV2CoordinatorRpcServer({coordinator:f.central,lookupToken:look});
 try{
  const {port}=await server.listen();
  const endpoint='http://127.0.0.1:'+port;
  const mk=(i)=>createV2CoordinatorRpcClient({endpoint,
   tokenProvider:async()=>secrets[i],observedCaller:async()=>binding(i===0?a:b)});
  const first=mk(0),second=mk(1);
  const lease=await first.acquire({route:a});
  const result=await first.commitFencedReceipt({route:a,lease,receiptId:'remote-step',
    digest:digest('remote-recorded')});
  assert.equal(result.committed,true);
  assert.equal(result.replayed,false);
  const reconstructed=await first.getFencedReceipt({route:a,receiptId:'remote-step'});
  assert.equal(reconstructed.digest,result.digest);
  assert.equal(reconstructed.fence,lease.fence);
  await assert.rejects(second.commitFencedReceipt({route:b,lease,
    receiptId:'borrowed',digest:digest('foreign')}),
   {code:'V2_COORDINATOR_STALE_LEASE'});
  await first.release({route:a,lease});
  const next=await second.acquire({route:b});
  assert.equal(next.fence,2);
  await assert.rejects(second.commitFencedReceipt({route:b,lease:next,
    receiptId:'remote-step',digest:digest('attempt overwrite')}),
   {code:'V2_COORDINATOR_RECEIPT_CONFLICT'});
  await assert.rejects(second.commitFencedReceipt({route:b,lease:next,
    receiptId:'malformed',digest:'this is not sha256'}),
   {code:'V2_RPC_CLIENT_INVALID_RECEIPT'});
  const ok=await second.commitFencedReceipt({route:b,lease:next,
    receiptId:'next-step',digest:digest('next')});
  assert.equal(ok.fence,2);
 }finally{await server.close();f.close();}
});
