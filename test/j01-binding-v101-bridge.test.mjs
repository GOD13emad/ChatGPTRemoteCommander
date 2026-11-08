// QA ONLY: synthetic signer and token attestation. No real IdP, J01 enrollment,
// owner prompt, OS control, HTTP listener or protected-G1 release.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, randomUUID, sign, createHash} from 'node:crypto';
import {canonicalJ01Grant, createJ01OwnerGrantVerifier}
  from '../src/gui-j01-owner-grant-verifier.mjs';
import {createV101ProtectedRouterBridge}
  from '../src/full-access-protected-router-bridge.mjs';

test('new signed J01 grant rotates V1-01 trusted binding epoch and retires old ticket',async()=>{
  const keys=generateKeyPairSync('ed25519'); // volatile test keys; never enrolled
  const now=Date.now();
  const hostId='qa-host',profileId='qa-profile',principalId='qa-owner';
  const issuer='https://qa-idp.invalid',audience='https://qa-resource.invalid/mcp';
  const token='QA-ONLY-MOCK-OAUTH-NOT-A-TOKEN';
  const tokenSha256=createHash('sha256').update(token).digest('hex');
  const session={ownerPrincipal:'qa-owner-os',sessionId:'2',
    seatId:'qa-seat',displayId:'qa-display'};
  const expected={incidentId:'qa-incident',operationId:'qa-operation',
    callerPrincipal:'qa-attested-caller',session,
    requestedInput:{pointer:true,keyboard:false},ttlSeconds:15};
  const nonces=new Set(),archive=[];
  const verify=createJ01OwnerGrantVerifier({
    pinnedPublicKey:keys.publicKey,signerPrincipal:'qa-signer',
    keyId:'QA-ED-KEY-NOT-ENROLLED',
    consumeNonce:async record=>{
      if(nonces.has(record.consentNonce))return {consumed:false};
      nonces.add(record.consentNonce);
      return {consumed:true};
    },
    archiveExactGrant:async record=>{archive.push(record);return {archived:true};},
    clock:()=>now
  });
  function newGrant(){
    const consentNonce=randomUUID(),p={
      protocol:'Commander-J01-OS-OWNER-GRANT-V1',
      origin:'OS_PROTECTED_OWNER_SIGNER',signerPrincipal:'qa-signer',
      keyId:'QA-ED-KEY-NOT-ENROLLED',incidentId:expected.incidentId,
      operationId:expected.operationId,callerPrincipal:expected.callerPrincipal,
      ownerPrincipal:session.ownerPrincipal,sessionId:session.sessionId,
      seatId:session.seatId,displayId:session.displayId,consentNonce,
      requestedInput:{...expected.requestedInput},ttlSeconds:15,
      issuedAtMs:now,expiresAtMs:now+14000,ownerInteracted:true
    };
    return {consentNonce,signedOwnerGrant:{
      payload:p,signature:sign(null,canonicalJ01Grant(p),keys.privateKey)
        .toString('base64url')}};
  }
  const g1=newGrant(),g2=newGrant();
  const v1=await verify({signedOwnerGrant:g1.signedOwnerGrant,
    expected:{...expected,consentNonce:g1.consentNonce}});
  assert.equal(v1.verified,true);
  assert.match(v1.bindingId,/^[a-f0-9]{64}$/);
  assert.equal(v1.bindingId,v1.grantSha256);
  const bound=new Map();
  const route={hostId,profileId,principalId,conversationId:'qa-chat',
    operationId:'qa-route-op',target:{kind:'desktop-seat',id:'qa-seat'}};
  function rotate(v){
    bound.set(tokenSha256,Object.freeze({source:'native-owner-attested',
      tokenSha256,bindingId:v.bindingId,sessionHandle:'qa-chat',
      expiresAtMs:now+18000}));
  }
  rotate(v1);
  const bridge=createV101ProtectedRouterBridge({
    hostId,profileId,issuer,audience,now:()=>now,
    verifyAccessToken:async t=>t===token?{
      issuer,audience,subject:'qa-subject',notBeforeMs:now-1000,
      expiresAtMs:now+60000,scopes:['commander.workflow']}:null,
    resolvePrincipal:async sub=>sub==='qa-subject'?principalId:null,
    resolveAttestedTokenBinding:async digest=>bound.get(digest)??null,
    nativeSessionBindings:{resolveNativeRoute:async()=>route},
    grantRegistry:{isAllowed:()=>true},
    authorizeExactInvocation:async()=>true
  });
  try{
    const original=await bridge.verifyCaller(token);
    assert.equal(original?.verified,true);
    const invocation={rpcMethod:'tools/call',tool:'gui_cursor_position',
      arguments:{fixture:'read-only'}};
    assert.equal(await bridge.authorizeTool(original,invocation),true);
    assert.equal((await bridge.verifyCaller(token))?.ticket,original.ticket);
    const v2=await verify({signedOwnerGrant:g2.signedOwnerGrant,
      expected:{...expected,consentNonce:g2.consentNonce}});
    assert.equal(v2.verified,true);
    assert.match(v2.bindingId,/^[a-f0-9]{64}$/);
    assert.notEqual(v2.bindingId,v1.bindingId);
    rotate(v2); // trusted owner provider updates its single current epoch
    assert.equal(await bridge.authorizeTool(original,invocation),false);
    const current=await bridge.verifyCaller(token);
    assert.equal(current?.verified,true);
    assert.notEqual(current.ticket,original.ticket);
    assert.equal(await bridge.authorizeTool(current,invocation),true);
    assert.equal(await bridge.verifyCaller('FORGED'),null);
    const replay=await verify({signedOwnerGrant:g1.signedOwnerGrant,
      expected:{...expected,consentNonce:g1.consentNonce}});
    assert.equal(replay.verified,false);
    assert.equal(Object.hasOwn(replay,'bindingId'),false);
    assert.equal(archive.length,2);
  }finally{bridge.close();}
});
