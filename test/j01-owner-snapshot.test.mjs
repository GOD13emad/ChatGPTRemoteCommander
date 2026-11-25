import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {
  canonicalJ01Grant,createJ01OwnerGrantVerifier
} from '../src/gui-j01-owner-grant-verifier.mjs';

const now=1795450000000;
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const sid={ownerPrincipal:'os-owner',sessionId:'wts-3',seatId:'seat-3',
  displayId:'display-3'};
const expected=(nonce,op='op-signed')=>({
  incidentId:'incident-a',operationId:op,callerPrincipal:'trusted-caller',
  session:sid,requestedInput:{pointer:true,keyboard:false},
  ttlSeconds:15,consentNonce:nonce
});
function signedPayload(nonce=randomUUID()){
 return {
   protocol:'Commander-J01-OS-OWNER-GRANT-V1',
   origin:'OS_PROTECTED_OWNER_SIGNER',
   signerPrincipal:'native-owner',keyId:'enrolled-public-key',
   incidentId:'incident-a',operationId:'op-signed',
   callerPrincipal:'trusted-caller',ownerPrincipal:'os-owner',
   sessionId:'wts-3',seatId:'seat-3',displayId:'display-3',
   consentNonce:nonce,requestedInput:{pointer:true,keyboard:false},
   ttlSeconds:15,issuedAtMs:now-1000,expiresAtMs:now+13000,
   ownerInteracted:true
 };
}
function makeVerifier(){
 const nonces=new Set(),archive=[];
 const verify=createJ01OwnerGrantVerifier({
   pinnedPublicKey:publicKey,signerPrincipal:'native-owner',
   keyId:'enrolled-public-key',
   consumeNonce:async r=>{
     if(nonces.has(r.consentNonce))return {consumed:false};
     nonces.add(r.consentNonce);return {consumed:true};
   },
   archiveExactGrant:async r=>{archive.push(r);return {archived:true};},
   clock:()=>now
 });
 return {verify,nonces,archive};
}
function signature(p){
 return sign(null,canonicalJ01Grant(p),privateKey).toString('base64url');
}
test('signed plain-data J01 grant remains valid and replay is rejected',async()=>{
 const {verify,archive,nonces}=makeVerifier();
 const p=signedPayload(),s=signature(p),e=expected(p.consentNonce);
 const good=await verify({signedOwnerGrant:{payload:p,signature:s},expected:e});
 assert.equal(good.verified,true);
 assert.equal(archive.length,1);assert.equal(nonces.size,1);
 assert.equal(archive[0].grant.payload.operationId,'op-signed');
 assert.equal(Object.isFrozen(archive[0].grant.payload),true);
 const replay=await verify({signedOwnerGrant:{payload:p,signature:s},expected:e});
 assert.equal(replay.verified,false);
 assert.equal(archive.length,1);assert.equal(nonces.size,1);
});
test('signed payload getter cannot rebind operation after canonical signature bytes',async()=>{
 const {verify,archive,nonces}=makeVerifier();
 const p=signedPayload(),signed=signature(p);
 let calls=0;
 Object.defineProperty(p,'operationId',{
   enumerable:true,configurable:true,
   get(){calls++;return calls<=2?'op-signed':'op-swapped';}
 });
 const result=await verify({signedOwnerGrant:{payload:p,signature:signed},
   expected:expected(p.consentNonce,'op-swapped')});
 assert.equal(result.verified,false);
 assert.equal(calls,0);
 assert.equal(archive.length,0);
 assert.equal(nonces.size,0);
});
test('nested requestedInput getter never alters signed consent scope',async()=>{
 const {verify,archive,nonces}=makeVerifier();
 const p=signedPayload(),signed=signature(p);
 let calls=0;
 Object.defineProperty(p.requestedInput,'pointer',{
   enumerable:true,configurable:true,
   get(){calls++;return calls<=2?true:false;}
 });
 const result=await verify({signedOwnerGrant:{payload:p,signature:signed},
   expected:expected(p.consentNonce)});
 assert.equal(result.verified,false);
 assert.equal(calls,0);
 assert.equal(archive.length,0);assert.equal(nonces.size,0);
});
test('Proxy envelope and Proxy payload are rejected without semantic reads',async()=>{
 const {verify,archive,nonces}=makeVerifier();
 const p=signedPayload(),signed=signature(p);
 let reads=0;
 const proxyPayload=new Proxy(p,{
   get(t,k,r){reads++;return Reflect.get(t,k,r);}
 });
 const first=await verify({signedOwnerGrant:{
   payload:proxyPayload,signature:signed
 },expected:expected(p.consentNonce)});
 assert.equal(first.verified,false);
 const proxyEnvelope=new Proxy({payload:p,signature:signed},{
   get(t,k,r){reads++;return Reflect.get(t,k,r);}
 });
 const second=await verify({signedOwnerGrant:proxyEnvelope,
   expected:expected(p.consentNonce)});
 assert.equal(second.verified,false);assert.equal(reads,0);
 assert.equal(archive.length,0);assert.equal(nonces.size,0);
});
test('hidden, Symbol, accessor fields on signed grant are not silently ignored',async()=>{
 const {verify,archive,nonces}=makeVerifier();
 const p=signedPayload(),signed=signature(p);
 Object.defineProperty(p,'hidden',{enumerable:false,configurable:true,value:'attack'});
 assert.equal((await verify({signedOwnerGrant:{payload:p,signature:signed},
   expected:expected(p.consentNonce)})).verified,false);
 delete p.hidden;
 p[Symbol('covert')]=true;
 assert.equal((await verify({signedOwnerGrant:{payload:p,signature:signed},
   expected:expected(p.consentNonce)})).verified,false);
 delete p[Object.getOwnPropertySymbols(p)[0]];
 const envelope={payload:p,signature:signed};
 Object.defineProperty(envelope,'invisible',{enumerable:false,value:1});
 assert.equal((await verify({signedOwnerGrant:envelope,
   expected:expected(p.consentNonce)})).verified,false);
 assert.equal(archive.length,0);assert.equal(nonces.size,0);
});
test('trusted expected context with accessor or Proxy fields must deny',async()=>{
 const {verify,archive,nonces}=makeVerifier();
 const p=signedPayload(),signed=signature(p);
 let calls=0;
 const e=expected(p.consentNonce);
 Object.defineProperty(e,'operationId',{enumerable:true,
   get(){calls++;return 'op-signed';}});
 assert.equal((await verify({signedOwnerGrant:{payload:p,signature:signed},
   expected:e})).verified,false);
 const e2=expected(p.consentNonce);
 e2.session=new Proxy(e2.session,{get(t,k,r){calls++;return Reflect.get(t,k,r);}});
 assert.equal((await verify({signedOwnerGrant:{payload:p,signature:signed},
   expected:e2})).verified,false);
 assert.equal(calls,0);assert.equal(nonces.size,0);assert.equal(archive.length,0);
});
