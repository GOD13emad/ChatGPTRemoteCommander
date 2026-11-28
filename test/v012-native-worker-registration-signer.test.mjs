import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {signV012NativeWorkerEnrollment}
  from '../src/v012-native-worker-registration-signer.mjs';
import {verifyWorkerRegistration} from '../src/worker-identity-authority.mjs';
const now=1780000000000;
const intent=()=>({
  hostId:'qa-host',profileId:'qa-profile',
  principalId:'qa-owner',conversationId:'pair-123',
  bindingId:'1'.repeat(64),ownerSidHash:'2'.repeat(64),
  deviceIdHash:'3'.repeat(64),tunnelIdHash:'4'.repeat(64),
  capabilityPolicyDigest:'5'.repeat(64),grantRevision:1,expiresAtMs:now+60000
});
test('native private signer emits authentic pinned Worker identity, not a grant',()=>{
  const keys=generateKeyPairSync('ed25519'),value=signV012NativeWorkerEnrollment({
    intent:intent(),privateKey:keys.privateKey,now
  });
  assert.equal(verifyWorkerRegistration(value,{
    issuer:'commander.local',audience:'remote-commander',
    now:()=>now,maxTtlMs:120000
  }).keyId,value.keyId);
  assert.match(value.claims.workerId,/^cw_[a-f0-9]{64}$/);
  assert.equal(value.claims.issuer,'commander.local');
  assert.equal(value.claims.audience,'remote-commander');
  assert.equal(Object.hasOwn(value,'privateKey'),false);
  assert.equal(Object.hasOwn(value,'authorized'),false);
  assert.equal(Object.hasOwn(value,'grant'),false);
});
test('native signer denies claims with unknown fields, accessors or extended lifetime',async t=>{
  const keys=generateKeyPairSync('ed25519'),base=intent();
  const bad=[
    {...base,expiresAtMs:now+120001},
    {...base,expiresAtMs:now},
    {...base,grantRevision:0},
    {...base,tool:'run_shell'},
    {...base,profileId:'../another'},
    {...base,ownerSidHash:'z'.repeat(64)}
  ];
  let invoked=0;
  const accessor={...base};
  Object.defineProperty(accessor,'hostId',{enumerable:true,get(){invoked++;return 'qa-host';}});
  bad.push(accessor);
  for(const entry of bad)await t.test(JSON.stringify(Object.keys(entry).sort()),()=>{
    assert.throws(()=>signV012NativeWorkerEnrollment({
      intent:entry,privateKey:keys.privateKey,now
    }));
  });
  assert.equal(invoked,0);
  assert.throws(()=>signV012NativeWorkerEnrollment({
    intent:base,privateKey:keys.publicKey,now
  }));
});
