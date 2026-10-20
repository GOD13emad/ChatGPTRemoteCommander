// Pure cryptographic transcript checks. NEVER a native owner authority or GUI release.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createGuiInputIncidentStore} from '../src/gui-incident-store.mjs';
import {
 createIncidentReviewChallenge, verifyIncidentReviewSignature,
 reviewSignatureBytes
} from '../src/gui-owner-review-challenge.mjs';

const incident=()=>({
 id:'00000000-1111-4222-8333-444444444444',
 tool:'gui_focus_window',startedUtc:'2026-10-20T21:25:00.000Z',
 status:'PENDING_NATIVE_EFFECT',nativeOutcome:'UNKNOWN',
 evidenceSha256:'11'.repeat(32),
 evidenceBytes:182
});
const nonce='ab'.repeat(32);
const issuedUtc='2026-10-21T00:00:00.000Z';
const expiryUtc='2026-10-21T00:01:00.000Z';
const make=(overrides={})=>createIncidentReviewChallenge({
 incident:incident(),nonce,issuedUtc,expiryUtc,...overrides
});
const keys=()=>generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{
 type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const signed=(challenge,privateKey)=>({
 schema:'rc-gui-owner-signed-review-v1',
 challengeSha256:challenge.challengeSha256,
 signatureBase64:sign('sha256',reviewSignatureBytes(challenge),{
  key:privateKey,padding:1
 }).toString('base64')
});
const verdict=(challenge,response,publicKey,nowUtc=issuedUtc)=>verifyIncidentReviewSignature({
 challenge,response,publicKey,nowUtc
});

test('incident-bound OS-owner challenge describes UNKNOWN history, NEVER releases input',()=>{
 const challenge=make();
 assert.equal(challenge.originalSha256,incident().evidenceSha256);
 assert.equal(challenge.originalBytes,182);
 assert.equal(challenge.incidentId,incident().id);
 assert.equal(challenge.nativeOutcome,'UNKNOWN');
 assert.equal(challenge.releaseAuthorized,false);
 assert.equal(challenge.ownerAuthenticated,false);
 assert.equal(challenge.fleetQuiescenceProven,false);
 assert.match(challenge.challengeSha256,/^[a-f0-9]{64}$/);
 assert.equal(challenge.challengeSha256,make().challengeSha256);
 assert.equal(Object.isFrozen(challenge),true);
});
test('a copied original incident with altered SHA is rejected, not reviewed',()=>{
 for(const patch of [{evidenceSha256:'xx'},{nativeOutcome:'NOT_APPLIED'},
  {status:'REVIEWED'},{tool:'shell'},{evidenceBytes:-1},
  {id:'bogus/../../secret'},{startedUtc:''}]){
  assert.throws(()=>make({incident:{...incident(),...patch}}),/GUI_OWNER_REVIEW_/);
 }
});
test('nonce, expiry and canonical clock validation reject stale/weak challenges',()=>{
 for(const args of [{nonce:'abcd'},{nonce:'zz'.repeat(32)},
  {expiryUtc:'2026-10-21T00:03:00.000Z'},
  {expiryUtc:'2026-10-20T23:59:59.000Z'},
  {issuedUtc:'2026-10-21 00:00:00'},
  {issuedUtc:'invalid'}])assert.throws(()=>make(args),/GUI_OWNER_REVIEW_/);
});
test('signature from fixture key verifies cryptographically but can NEVER itself grant owner consent',()=>{
 const key=keys(),c=make(),s=signed(c,key.privateKey);
 const result=verdict(c,s,key.publicKey);
 assert.equal(result.signatureValid,true);
 assert.equal(result.ownerAuthenticated,false);
 assert.equal(result.releaseAuthorized,false);
 assert.equal(result.noReplay,true);
 assert.equal(result.nativeOutcome,'UNKNOWN');
 assert.equal(result.reason,'OS_PROTECTED_OWNER_BROKER_NOT_AVAILABLE');
});
test('attacker-controlled public key can still match; signer identity is explicitly UNTRUSTED',()=>{
 const attacker=keys(),c=make();
 const result=verdict(c,signed(c,attacker.privateKey),attacker.publicKey);
 assert.equal(result.signatureValid,true);
 assert.equal(result.ownerAuthenticated,false);
 assert.equal(result.releaseAuthorized,false);
});
test('wrong pinned public key cannot validate a forged signature',()=>{
 const right=keys(),wrong=keys(),c=make();
 assert.equal(verdict(c,signed(c,wrong.privateKey),right.publicKey).signatureValid,false);
});
test('signature replay on different J01 SHA is rejected',()=>{
 const key=keys(),a=make(),b=make({incident:{...incident(),
  evidenceSha256:'aa'.repeat(32)}});
 const s=signed(a,key.privateKey);
 assert.notEqual(a.challengeSha256,b.challengeSha256);
 assert.equal(verdict(b,s,key.publicKey).signatureValid,false);
});
test('signature replay on new nonce is rejected',()=>{
 const key=keys(),a=make(),b=make({nonce:'cc'.repeat(32)});
 assert.notEqual(a.challengeSha256,b.challengeSha256);
 assert.equal(verdict(b,signed(a,key.privateKey),key.publicKey).signatureValid,false);
});
test('signed proof expires within the bounded interval',()=>{
 const key=keys(),c=make(),s=signed(c,key.privateKey);
 assert.equal(verdict(c,s,key.publicKey,'2026-10-21T00:01:01.000Z').signatureValid,false);
});
test('malformed or overlong signatures are rejected, no exception leaks',()=>{
 const key=keys(),c=make();
 for(const signatureBase64 of ['','aaa','a'.repeat(12000),'/'.repeat(32)]){
  assert.equal(verdict(c,{schema:'rc-gui-owner-signed-review-v1',
   challengeSha256:c.challengeSha256,signatureBase64},key.publicKey).releaseAuthorized,false);
 }
});
test('a signed response that forges privileged claims is rejected outright',()=>{
 const key=keys(),c=make(),s=signed(c,key.privateKey);
 assert.equal(verdict(c,{...s,ownerAuthenticated:true,releaseAuthorized:true},
  key.publicKey).signatureValid,false);
});

test('real isolated J01 store can bind a challenge without archiving or changing original bytes',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-owner-protocol-fixture-'));
 const file=path.join(root,'pending.json');
 try{
  const store=createGuiInputIncidentStore({file});
  const issued=await store.begin('gui_mouse_click');
  const original=await fs.readFile(file);
  const event=await store.inspect();
  assert.equal(event.id,issued.id);
  const challenge=createIncidentReviewChallenge({incident:event,nonce,
   issuedUtc,expiryUtc});
  assert.equal(challenge.originalSha256,event.evidenceSha256);
  assert.equal(challenge.nativeOutcome,'UNKNOWN');
  assert.equal(challenge.releaseAuthorized,false);
  assert.deepEqual(await fs.readFile(file),original);
  assert.equal((await fs.readdir(root)).length,1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
