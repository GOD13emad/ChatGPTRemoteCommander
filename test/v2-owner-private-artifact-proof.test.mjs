import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {V2CentralCoordinator} from '../src/v2-central-coordinator.mjs';
import {createV2GuardedArtifactActuator} from '../src/v2-guarded-artifact-actuator.mjs';
import {readV2OwnerPrivateArtifactProof} from '../src/v2-owner-private-artifact-proof.mjs';
const route=()=>({hostId:'host',principalId:'owner',profileId:'profile',conversationId:'chat',
 operationId:'artifact-one',target:{kind:'workflow-root',id:'project'}});
function fixture(){
 let r=route(),allowed=true,consent=true;
 const services={
  sessionHandle:'native-owner-session',expectedPrincipalId:'owner',
  sessions:{resolveNativeRoute:async()=>r},
  observedCaller:async()=>({hostId:r.hostId,principalId:r.principalId,
   profileId:r.profileId,conversationId:r.conversationId}),
  grants:{isAllowed:async(_r,tool)=>{assert.equal(tool,'workflow_read');return allowed;}},
  authorizeRead:async()=>consent,
  coordinator:{getFencedReceipt:async()=>null},
  artifactActuator:{observe:async()=>({committed:false})}
 };
 return {services,denyGrant:()=>allowed=false,denyConsent:()=>consent=false,
  setRoute:next=>r=next};
}
test('without current native attestation and independently authorized proof, no read',async()=>{
 const f=fixture();
 for(const n of [{...f.services,sessions:null},{...f.services,artifactActuator:null},
  {...f.services,expectedPrincipalId:null}]){
  await assert.rejects(readV2OwnerPrivateArtifactProof(n),
   {code:'V2_PRIVATE_PROOF_TRUSTED_BACKEND_REQUIRED'});
 }
 f.denyGrant();
 await assert.rejects(readV2OwnerPrivateArtifactProof(f.services),
  {code:'V2_PRIVATE_PROOF_GRANT_REQUIRED'});
 const g=fixture();g.denyConsent();
 await assert.rejects(readV2OwnerPrivateArtifactProof(g.services),
  {code:'V2_PRIVATE_PROOF_CONSENT_REQUIRED'});
 const h=fixture();
 await assert.rejects(readV2OwnerPrivateArtifactProof({...h.services,
  expectedPrincipalId:'other'}),{code:'V2_PRIVATE_PROOF_OWNER_MISMATCH'});
});
test('no durable receipt and no artifact yields NOT_FOUND, never success',async()=>{
 const x=await readV2OwnerPrivateArtifactProof(fixture().services);
 assert.equal(x.state,'NOT_FOUND');assert.equal(x.privateArtifactVerified,false);
 assert.equal(x.workerEffectVerified,false);assert.equal(x.digest,null);
});
test('inconsistent, extra fields and forged private observation fail',async()=>{
 for(const o of [
 {committed:true,receiptId:'artifact-one',digest:'a'.repeat(64),fence:1},
 {committed:false,extra:'untrusted'},
 {committed:true,receiptId:'wrong',digest:'a'.repeat(64),fence:1}
 ]){
  const f=fixture();
  f.services.artifactActuator.observe=async()=>o;
  await assert.rejects(readV2OwnerPrivateArtifactProof(f.services),
    {code:'V2_PRIVATE_PROOF_INCONSISTENT'});
 }
});
test('real private bytes and Coordinator SQLite receipt cross-check successfully',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rcv2-private-proof-'));
 const coordinator=new V2CentralCoordinator({directory:dir,
   requireGlobalResource:true,authorizeLease:async()=>true,
   resolveGlobalResource:async()=> 'shared-test-root'});
 const artifactActuator=createV2GuardedArtifactActuator({coordinator});
 try{
  const r=route(),lease=await coordinator.acquire({route:r});
  const result=await artifactActuator.create({route:r,lease,
    receiptId:'artifact-one',content:'bounded owner-private test payload'});
  assert.equal(result.committed,true);
  const f=fixture();
  f.services.coordinator=coordinator;f.services.artifactActuator=artifactActuator;
  const verified=await readV2OwnerPrivateArtifactProof(f.services);
  assert.equal(verified.state,'PRIVATE_ARTIFACT_HASH_VERIFIED');
  assert.equal(verified.digest,result.digest);
  assert.equal(verified.fence,lease.fence);
  assert.equal(verified.privateArtifactVerified,true);
  assert.equal(verified.coordinatorCommitted,true);
  assert.equal(verified.workerEffectVerified,false);
  assert.doesNotMatch(JSON.stringify(verified),/bounded owner-private test payload|shared-test-root|profile/);
  // Damage only the isolated test artifact; the observer must reject this.
  const key=path.join(dir,'v2-private-artifacts');
  const folder=fs.readdirSync(key).at(0);
  const target=path.join(key,folder,'artifact-one.artifact');
  fs.writeFileSync(target,'tampered private bytes');
  await assert.rejects(readV2OwnerPrivateArtifactProof(f.services),
    {code:'V2_ARTIFACT_INTEGRITY_FAILED'});
 }finally{coordinator.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('revocation or route change while bytes are inspected denies result',async()=>{
 const f=fixture();
 f.services.artifactActuator.observe=async()=>{f.denyGrant();return {committed:false};};
 await assert.rejects(readV2OwnerPrivateArtifactProof(f.services),
  {code:'V2_PRIVATE_PROOF_GRANT_REQUIRED'});
 const g=fixture();
 g.services.artifactActuator.observe=async()=>{g.setRoute({...route(),conversationId:'other'});return {committed:false};};
 await assert.rejects(readV2OwnerPrivateArtifactProof(g.services),
  {code:'V2_PRIVATE_PROOF_SESSION_CHANGED'});
});
