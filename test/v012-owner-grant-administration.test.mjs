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
function fixture(){
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
    keyTtlMs:80000,approvalDelayMs:0,onConsent:null};
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
    })
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
