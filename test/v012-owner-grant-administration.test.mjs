import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {V2GrantRegistry} from '../src/v2-grant-registry.mjs';
import {createNativeOwnerAdministrationAuthorizer}
  from '../src/native-owner-administration-authorizer.mjs';
import {deriveV101PrivatePairSessionHandle}
  from '../src/v101-private-pair-native-owner-stack.mjs';
import {createV012OwnerGrantAdministration}
  from '../src/v012-owner-grant-administration.mjs';

const OWNER='a'.repeat(64),TUNNEL='b'.repeat(64),KEY='c'.repeat(64),
  DEVICE='d'.repeat(64),POLICY='e'.repeat(64);
function fixture({withSigner=false}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-owner-admin-fixture-'));
  const identity={hostId:'qa-host',profileId:'qa-profile',principalId:'qa-owner',
    expectedTunnelIdHash:TUNNEL,expectedOwnerSidHash:OWNER};
  const pair=deriveV101PrivatePairSessionHandle({
    profileId:identity.profileId,expectedTunnelIdHash:TUNNEL,
    expectedOwnerSidHash:OWNER
  });
  const start=Date.now();
  const state={now:start,bound:true,consent:true,prompts:[],keyId:KEY,
    targetId:'system-status',ownerSidHash:OWNER,ownerExpiresAtMs:start+90000,
    keyTtlMs:80000,approvalDelayMs:0,onConsent:null,signerCalls:0,registrationCalls:0};
  const owner=()=>({
    source:'native-owner-attested',hostId:identity.hostId,
    profileId:identity.profileId,principalId:identity.principalId,
    conversationId:pair,bindingId:'f'.repeat(64),
    ownerSidHash:OWNER,expiresAtMs:state.ownerExpiresAtMs
  });
  const snapshot=()=>({ownerSidHash:OWNER,osSessionId:'linux-logind-4',seatId:'seat0',
    displayId:':0',sessionType:'x11',leaderPid:3519});
  const nativeBindings={
    resolveNativeOwnerContext:async()=>{
      if(!state.bound)throw Error('NOT_BOUND');
      return owner();
    },
    resolveNativeRoute:async()=>{
      if(!state.bound)throw Error('NOT_BOUND');
      return {hostId:identity.hostId,profileId:identity.profileId,
        principalId:identity.principalId,conversationId:pair,
        operationId:'owner-bind',target:{kind:'desktop-seat',id:'current-owner'}};
    }
  };
  const administration=createNativeOwnerAdministrationAuthorizer({
    now:()=>state.now,nativeSessionBindings:nativeBindings,
    ownerSessionProvider:{
      getOwnerSessionSnapshot:async()=>snapshot(),
      requestConsent:async r=>{
        state.prompts.push(r);
        state.now+=state.approvalDelayMs;
        state.onConsent?.();
        return state.consent;
      }
    }
  });
  const grants=new V2GrantRegistry({directory:path.join(root,'grants'),
    now:()=>state.now,authorizeAdministration:administration});
  const ownerStack={
    nativeSessionBindings:nativeBindings,
    resolveOwnerContext:async()=>({...owner(),tunnelIdHash:TUNNEL}),
    readCurrentOwnerSidHash:async()=>state.ownerSidHash,
    grantRegistry:grants
  };
  const trusted=()=>({
    source:'native-worker-key-attestor',hostId:identity.hostId,
    profileId:identity.profileId,ownerSidHash:OWNER,
    keyId:state.keyId,deviceProvider:'native-key-store',
    deviceIdHash:DEVICE,capabilityPolicyDigest:POLICY,
    attestedAtMs:state.now-1000,expiresAtMs:state.now+state.keyTtlMs,
    verified:true
  });
  let evidenceProvider=async()=>trusted();
  const controller=createV012OwnerGrantAdministration({
    ownerStack,identity,now:()=>state.now,
    resolveVerifiedWorkerKey:async()=>evidenceProvider(),
    resolvePinnedCanaryRoute:async({nativeRoute})=>({
      ...nativeRoute,operationId:'system-status-canary',
      target:{kind:'host-shell',id:state.targetId}
    }),
    ...(withSigner?{
      resolveSignedWorkerEnvelope:async({workerContext,grantRevision,expiresAtMs})=>{
        state.signerCalls++;
        return {claims:{
          workerId:workerContext.workerId,bindingId:workerContext.bindingId,
          grantRevision,expiresAtMs
        }};
      },
      workerAuthority:{
        registerSignedWorker:async({envelope})=>{
          state.registrationCalls++;
          return envelope;
        }
      }
    }:{})
  });
  return {root,identity,state,controller,grants,
    setEvidence(fn){evidenceProvider=fn;},
    close(){grants.close();fs.rmSync(root,{recursive:true,force:true});}
  };
}

test('live J01 and fresh native owner consent are required for exact read-only canary',async()=>{
  const f=fixture();
  try{
    assert.deepEqual(await f.controller.inspect(),{
      nativeOwnerBound:true,workerActive:false,exactBaseEnabled:false,
      exactWorkerToolEnabled:false,readOnlyCanaryAllowed:false
    });
    await assert.rejects(f.controller.approveReadOnlyCanary(),
      {code:'V012_OWNER_GRANT_PARENT_APPROVAL_REQUIRED'});
    assert.equal(f.state.prompts.length,0);
    f.state.consent=false;
    await assert.rejects(f.controller.approveWorker(),
      {code:'V2_WORKER_GRANT_ADMIN_AUTH_REQUIRED'});
    assert.equal(f.state.prompts.length,1);
    f.state.consent=true;
    const enrolled=await f.controller.approveWorker();
    assert.equal(enrolled.revision,1);
    assert.equal(f.state.prompts.length,2);
    assert.match(f.state.prompts.at(-1).message,/read-only Core migration canary/);
    const approved=await f.controller.approveReadOnlyCanary();
    assert.equal(approved.canaryAllowed,true);
    assert.equal(f.state.prompts.length,4,'base and exact worker tool require distinct native approvals');
    const status=await f.controller.inspect();
    assert.equal(status.readOnlyCanaryAllowed,true);
    const again=await f.controller.approveWorker();
    assert.equal(again.alreadyActive,true);
    assert.equal(f.state.prompts.length,4);
    f.state.bound=false;
    await assert.rejects(f.controller.inspect());
    f.state.bound=true;
    f.state.ownerSidHash='9'.repeat(64);
    await assert.rejects(f.controller.inspect(),{code:'V012_OWNER_GRANT_OWNER_CHANGED'});
  }finally{f.close();}
});

test('owner-local canary Worker can be revoked under real native consent; exact Worker cannot regain the same J01 epoch',async()=>{
  const f=fixture({withSigner:true});
  try{
    await assert.rejects(f.controller.revokeCanaryWorker(),
      {code:'V012_OWNER_GRANT_REVOKE_NO_CURRENT_WORKER'});
    assert.equal(f.state.prompts.length,0);
    await f.controller.approveWorker();
    await f.controller.approveReadOnlyCanary();
    await f.controller.approveSignedRegistration();
    assert.equal((await f.controller.inspect()).readOnlyCanaryAllowed,true);
    const before=f.state.prompts.length;
    f.state.consent=false;
    await assert.rejects(f.controller.revokeCanaryWorker(),
      {code:'V2_WORKER_GRANT_ADMIN_AUTH_REQUIRED'});
    assert.equal(f.state.prompts.length,before+1);
    assert.equal((await f.controller.inspect()).workerActive,true,
      'denied native approval must never revoke a grant');
    f.state.consent=true;
    f.state.bound=false;
    await assert.rejects(f.controller.revokeCanaryWorker());
    assert.equal(f.state.prompts.length,before+1,
      'missing native owner binding must reject before any prompt');
    f.state.bound=true;
    const revoked=await f.controller.revokeCanaryWorker();
    assert.deepEqual(revoked,{revoked:true,alreadyInactive:false});
    assert.equal(f.state.prompts.length,before+2);
    const inactive=await f.controller.inspect();
    assert.equal(inactive.workerActive,false);
    assert.equal(inactive.readOnlyCanaryAllowed,false);
    assert.deepEqual(await f.controller.revokeCanaryWorker(),
      {revoked:true,alreadyInactive:true});
    assert.equal(f.state.prompts.length,before+2,
      'repeat owner-local revoke is idempotent; no new native grant');
    await assert.rejects(f.controller.approveWorker(),
      {code:'V2_WORKER_GRANT_EPOCH_REUSE'});
    assert.equal((await f.controller.inspect()).workerActive,false);
    assert.equal((await f.controller.inspect()).readOnlyCanaryAllowed,false);
  }finally{f.close();}
});

test('human native approval can outlive ephemeral signed Tunnel witness but must re-attest same key',async()=>{
  const f=fixture();
  try{
    f.state.keyTtlMs=4000;
    f.state.approvalDelayMs=15000;
    const response=await f.controller.approveWorker();
    assert.equal(response.revision,1);
    assert.equal(f.state.prompts.length,1);
    const status=await f.controller.inspect();
    assert.equal(status.workerActive,true,
      'grant is bounded by the owner J01 epoch, not the 4s witness TTL');
    f.state.approvalDelayMs=10000;
    const canary=await f.controller.approveReadOnlyCanary();
    assert.equal(canary.canaryAllowed,true);
    assert.equal(f.state.prompts.length,3);
  }finally{f.close();}
});

test('key rotation during native owner dialog denies positive post-approval acceptance',async()=>{
  const f=fixture();
  try{
    f.state.keyTtlMs=4000;
    f.state.onConsent=()=>{f.state.keyId='7'.repeat(64);};
    await assert.rejects(f.controller.approveWorker(),
      {code:'V012_OWNER_GRANT_POST_APPROVAL_UNVERIFIED'});
    assert.equal(f.state.prompts.length,1);
    const after=await f.controller.inspect();
    assert.equal(after.workerActive,false,
      'the changed trusted key never inherits the prior native grant');
  }finally{f.close();}
});

test('signed Worker registration requires separate native approval and exact current Worker epoch',async()=>{
 const f=fixture({withSigner:true});
 try{
   await assert.rejects(f.controller.registerSignedWorker(),
     {code:'V012_OWNER_GRANT_WORKER_REGISTER_APPROVAL_REQUIRED'});
   assert.equal(f.state.signerCalls,0);
   await f.controller.approveWorker();
   await assert.rejects(f.controller.registerSignedWorker(),
     {code:'V012_OWNER_GRANT_WORKER_REGISTER_APPROVAL_REQUIRED'});
   assert.equal(f.state.signerCalls,0);
   await f.controller.approveSignedRegistration();
   assert.equal(f.state.prompts.length,3,
     'one Worker, one base register tool and one exact worker.register approval');
   const enrolled=await f.controller.registerSignedWorker();
   assert.equal(enrolled.registered,true);
   assert.equal(f.state.signerCalls,1);
   assert.equal(f.state.registrationCalls,1);
   assert.equal((await f.controller.inspect()).readOnlyCanaryAllowed,false,
     'registering a Worker is not permission to run system_status');
   f.state.keyId='7'.repeat(64);
   await assert.rejects(f.controller.registerSignedWorker(),
     {code:'V012_OWNER_GRANT_WORKER_REGISTER_APPROVAL_REQUIRED'});
   assert.equal(f.state.registrationCalls,1);
 }finally{f.close();}
});

test('native J01 key change during actual signing prevents registration side effects',async()=>{
 const f=fixture({withSigner:true});
 try{
   await f.controller.approveWorker();
   await f.controller.approveSignedRegistration();
   f.state.signerCalls=0;f.state.registrationCalls=0;
   f.state.keyId='7'.repeat(64);
   await assert.rejects(f.controller.registerSignedWorker(),
     {code:'V012_OWNER_GRANT_WORKER_REGISTER_APPROVAL_REQUIRED'});
   assert.equal(f.state.registrationCalls,0);
 }finally{f.close();}
});

test('wrong native device key, route target, missing J01 and stale key evidence never create grants',async()=>{
  for(const mode of ['unbound','wrong-route','stale-evidence','wrong-profile','wrong-owner']){
    const f=fixture();
    try{
      if(mode==='unbound')f.state.bound=false;
      if(mode==='wrong-route')f.state.targetId='other-target';
      if(mode==='stale-evidence')f.setEvidence(async()=>({
        source:'native-worker-key-attestor',hostId:f.identity.hostId,
        profileId:f.identity.profileId,ownerSidHash:OWNER,
        keyId:KEY,deviceProvider:'native-key-store',deviceIdHash:DEVICE,
        capabilityPolicyDigest:POLICY,attestedAtMs:f.state.now-70000,
        expiresAtMs:f.state.now+80000,verified:true
      }));
      if(mode==='wrong-profile')f.setEvidence(async()=>({
        source:'native-worker-key-attestor',hostId:f.identity.hostId,
        profileId:'other-profile',ownerSidHash:OWNER,
        keyId:KEY,deviceProvider:'native-key-store',deviceIdHash:DEVICE,
        capabilityPolicyDigest:POLICY,attestedAtMs:f.state.now-1000,
        expiresAtMs:f.state.now+80000,verified:true
      }));
      if(mode==='wrong-owner')f.state.ownerSidHash='9'.repeat(64);
      await assert.rejects(f.controller.approveWorker());
      assert.equal(f.state.prompts.length,0,mode+' must fail before native consent');
    }finally{f.close();}
  }
});
