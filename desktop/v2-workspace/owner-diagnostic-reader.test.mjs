import test from 'node:test';
import assert from 'node:assert/strict';
import {createV2DiagnosticProofReaders,createV2OwnerDiagnosticReaders} from './owner-diagnostic-reader.mjs';
import {normalizeCoordinatorReceiptView,normalizePrivateArtifactProof} from './workflow-view.mjs';

const route={operationId:'ali-tailnet-proof-20261031'};
const receipt={committed:true,receiptId:route.operationId,digest:'a'.repeat(64),fence:2};
const artifact={...receipt};
const client=(r=receipt,a=artifact)=>({
 getFencedReceipt:async({receiptId})=>{assert.equal(receiptId,route.operationId);return r;},
 observePrivateArtifact:async({receiptId})=>{assert.equal(receiptId,route.operationId);return a;}
});
test('two independent central proofs become only safe diagnostic presentation data',async()=>{
 const d=createV2DiagnosticProofReaders({client:client(),route});
 const r=normalizeCoordinatorReceiptView(await d.trustedReceiptReader());
 const a=normalizePrivateArtifactProof(await d.trustedPrivateArtifactReader());
 assert.equal(r.digest,a.digest);assert.equal(r.fence,a.fence);
 assert.equal(r.coordinatorCommitted,true);assert.equal(a.privateArtifactVerified,true);
 assert.equal(r.workerEffectVerified,false);assert.equal(a.workerEffectVerified,false);
 assert.doesNotMatch(JSON.stringify({r,a}),/authorization|Bearer|token|principalId/);
});
test('missing, conflicting, malformed, stale fenced proofs fail closed',async()=>{
 for(const [r,a]of [
  [null,artifact],[receipt,null],
  [{...receipt,committed:false},artifact],
  [receipt,{...artifact,digest:'b'.repeat(64)}],
  [receipt,{...artifact,fence:3}],
  [{...receipt,receiptId:'other'},artifact],
  [receipt,{...artifact,receiptId:'other'}],
  [{...receipt,fence:0},artifact],
  [{...receipt,digest:'not-a-sha'},artifact]
 ]){
  const d=createV2DiagnosticProofReaders({client:client(r,a),route});
  await assert.rejects(d.trustedReceiptReader(),/V2_OWNER_DIAGNOSTIC_PROOF_UNVERIFIED/);
  await assert.rejects(d.trustedPrivateArtifactReader(),/V2_OWNER_DIAGNOSTIC_PROOF_UNVERIFIED/);
 }
});
test('remote errors never become an apparently verified GUI receipt',async()=>{
 const d=createV2DiagnosticProofReaders({route,client:{
  getFencedReceipt:async()=>{throw Error('UNTRUSTED_PRIVATE_EXCEPTION');},
  observePrivateArtifact:async()=>artifact
 }});
 await assert.rejects(d.trustedReceiptReader(),/UNTRUSTED_PRIVATE_EXCEPTION/);
});
test('unsupported host, incorrect OS and SYSTEM/root do not load credentials',async()=>{
 let imports=0;
 for(const opts of [
  {currentHost:'Emad-PC-Ultimate',currentUser:'Aa.Emad',currentPlatform:'win32',uid:101},
  {currentHost:'aliemad-Labtop',currentUser:'other',currentPlatform:'linux',uid:101},
  {currentHost:'aliemad-Labtop',currentUser:'aliemad',currentPlatform:'linux',uid:0},
  {currentHost:'unknown',currentUser:'aliemad',currentPlatform:'linux',uid:101},
  {currentHost:'mmz-LOQ-15IRX9',currentUser:'mmz',currentPlatform:'win32',uid:101}
 ]){
  const d=await createV2OwnerDiagnosticReaders({...opts,importRpc:async()=>{imports++;return {};}});
  assert.equal(d,null);
 }
 assert.equal(imports,0);
});
test('misconfigured source/credential causes silent disconnection without granting access',async()=>{
 const out=await createV2OwnerDiagnosticReaders({
  currentHost:'aliemad-Labtop',currentUser:'aliemad',currentPlatform:'linux',
  uid:1001,home:'/nonexistent-commander-owner',
  importRpc:async()=>{throw Error('DO_NOT_LEAK_TOKEN');}
 });
 assert.equal(out,null);
});
