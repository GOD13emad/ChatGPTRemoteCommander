import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {V2CentralCoordinator} from '../src/v2-central-coordinator.mjs';
import {readV2OwnerFencedReceipt} from '../src/v2-owner-fenced-receipt.mjs';
const route=()=>({hostId:'host-one',principalId:'owner',profileId:'profile-one',
 conversationId:'chat-one',operationId:'step-one',
 target:{kind:'workflow-root',id:'project-one'}});
function fixture(){
 let current=route(),allowed=true,consent=true,reads=0;
 const services={
  sessionHandle:'native-seat-one',expectedPrincipalId:'owner',
  sessions:{resolveNativeRoute:async()=>current},
  observedCaller:async()=>({hostId:current.hostId,principalId:current.principalId,
   profileId:current.profileId,conversationId:current.conversationId}),
  grants:{isAllowed:async(_r,tool)=>{assert.equal(tool,'workflow_read');return allowed;}},
  authorizeRead:async()=>consent,
  resolveReceiptId:async()=>current.operationId,
  coordinator:{getFencedReceipt:async()=>{reads++;return null;}}
 };
 return {services,denyGrant:()=>allowed=false,denyConsent:()=>consent=false,
  setRoute:r=>current=r,get reads(){return reads;}};
}
test('default fail-closed without owner native identity or coordinator',async()=>{
 const f=fixture();
 for(const item of [{...f.services,coordinator:null},
  {...f.services,sessions:null},{...f.services,expectedPrincipalId:null},
  {...f.services,resolveReceiptId:null}]){
  await assert.rejects(readV2OwnerFencedReceipt(item),{
   code:'V2_OWNER_RECEIPT_TRUSTED_WORKER_REQUIRED'});
 }
 assert.equal(f.reads,0);
});
test('no receipt is explicitly NOT_FOUND and never a verified external worker effect',async()=>{
 const f=fixture();
 const x=await readV2OwnerFencedReceipt(f.services);
 assert.equal(x.state,'NOT_FOUND');
 assert.equal(x.coordinatorCommitted,false);
 assert.equal(x.workerEffectVerified,false);
 assert.equal(x.receiptId,'step-one');
 assert.equal(f.reads,1);
});
test('no grant, no consent, mismatched owner, or forged worker route cannot read',async()=>{
 const f=fixture();f.denyGrant();
 await assert.rejects(readV2OwnerFencedReceipt(f.services),
  {code:'V2_OWNER_RECEIPT_GRANT_REQUIRED'});
 assert.equal(f.reads,0);
 const g=fixture();g.denyConsent();
 await assert.rejects(readV2OwnerFencedReceipt(g.services),
  {code:'V2_OWNER_RECEIPT_CONSENT_REQUIRED'});
 assert.equal(g.reads,0);
 const h=fixture();
 await assert.rejects(readV2OwnerFencedReceipt({...h.services,
  expectedPrincipalId:'different-user'}),{code:'V2_OWNER_RECEIPT_PRINCIPAL_MISMATCH'});
 assert.equal(h.reads,0);
 const i=fixture();
 await assert.rejects(readV2OwnerFencedReceipt({...i.services,
  observedCaller:async()=>({...route(),hostId:'forged'})}),{
    code:'V2_ROUTE_UNKNOWN_OR_MISSING_FIELD'});
 assert.equal(i.reads,0);
});
test('changing route or revoking grant during coordinator read denies output',async()=>{
 const f=fixture();
 f.services.coordinator.getFencedReceipt=async()=>{
  f.setRoute({...route(),conversationId:'different-chat'});
  return {receiptId:'step-one',digest:'a'.repeat(64),fence:1,committed:true};
 };
 await assert.rejects(readV2OwnerFencedReceipt(f.services),
  {code:'V2_OWNER_RECEIPT_SESSION_CHANGED'});
 const g=fixture();
 g.services.coordinator.getFencedReceipt=async()=>{g.denyGrant();return null;};
 await assert.rejects(readV2OwnerFencedReceipt(g.services),
  {code:'V2_OWNER_RECEIPT_GRANT_REQUIRED'});
});
test('malformed, extra-key and wrong-fence coordinator results fail-closed',async()=>{
 for(const receipt of [
  {receiptId:'step-one',digest:'a'.repeat(64),fence:1,committed:true,secret:'leak'},
  {receiptId:'step-other',digest:'a'.repeat(64),fence:1,committed:true},
  {receiptId:'step-one',digest:'a'.repeat(64),fence:0,committed:true},
  {receiptId:'step-one',digest:'a'.repeat(64),fence:2,committed:false}
 ]){
  const f=fixture();
  f.services.coordinator.getFencedReceipt=async()=>receipt;
  await assert.rejects(readV2OwnerFencedReceipt(f.services),
   {code:'V2_OWNER_RECEIPT_INVALID_COORDINATOR_DATA'});
 }
});
test('actual SQLite Coordinator committed fenced receipt is reconciled read-only',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rcv2-fenced-receipt-test-'));
 const coord=new V2CentralCoordinator({directory:dir,authorizeLease:async()=>true});
 try{
  const r=route();
  const lease=await coord.acquire({route:r,ttlMs:10000});
  const digest='b'.repeat(64);
  const committed=await coord.commitFencedReceipt({
   route:r,lease,receiptId:'step-one',digest
  });
  assert.equal(committed.committed,true);
  const f=fixture();
  f.services.coordinator=coord;
  const x=await readV2OwnerFencedReceipt(f.services);
  assert.equal(x.state,'COMMITTED_FENCED_RECEIPT');
  assert.equal(x.digest,digest);
  assert.equal(x.fence,lease.fence);
  assert.equal(x.coordinatorCommitted,true);
  assert.equal(x.workerEffectVerified,false);
  assert.doesNotMatch(JSON.stringify(x),/profile-one|chat-one|lease_id|holder/);
  assert.deepEqual(await coord.getFencedReceipt({route:r,receiptId:'step-one'}),
   {receiptId:'step-one',digest,fence:lease.fence,committed:true});
 }finally{coord.close();rmSync(dir,{recursive:true,force:true});}
});


test('receipt identifier is pinned to native bound operation not arbitrary trusted selector',async()=>{
 const f=fixture();
 await assert.rejects(readV2OwnerFencedReceipt({...f.services,
   resolveReceiptId:async()=> 'some-other-operation'
 }),{code:'V2_OWNER_RECEIPT_OPERATION_ID_REQUIRED'});
 assert.equal(f.reads,0);
});
