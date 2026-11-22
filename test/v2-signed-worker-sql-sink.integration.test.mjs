import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { deriveWorkerId } from '../src/worker-identity-authority.mjs';
import { createV2PrivateSignedWorkerGrantAdapter } from '../src/v2-private-signed-worker-grant-adapter.mjs';
import { createV2PrivatePairOperationGate } from '../src/v2-private-pair-operation-gate.mjs';
import { v2OperationKey } from '../src/v2-routing-contract.mjs';
import { MutationIdempotencyStore } from '../src/mutation-idempotency.mjs';
import { Rc013SqliteEffectSink } from '../src/rc013-sqlite-effect-sink.mjs';

// QA ONLY: real Ed25519 and two real owner-local SQLite stores;
// the mTLS peer, OS-owner approval and machine-global resource lease
// are *deliberately synthetic*. The only effect is a SQL fixture counter.
const NOW=1794475200000;
const OWNER='a'.repeat(64),TUNNEL='b'.repeat(64),BINDING='c'.repeat(64);
const DEVICE='d'.repeat(64),POLICY='e'.repeat(64),ROOT='f'.repeat(64);
const FIELDS=['issuer','audience','hostId','profileId','principalId',
  'conversationId','bindingId','workerId','ownerSidHash','deviceProvider',
  'deviceIdHash','tunnelProvider','tunnelIdHash','capabilityPolicyDigest',
  'grantRevision','issuedAtMs','expiresAtMs','nonce'];
function route(over={}) {
  return {
    hostId:'host-a',profileId:'profile-a',principalId:'account-a',
    conversationId:'chat-a',operationId:'op-a',
    target:{kind:'workflow-root',id:'project-a'},...over
  };
}
const owner=()=>({
  source:'native-owner-attested',hostId:'host-a',profileId:'profile-a',
  principalId:'account-a',conversationId:'chat-a',
  bindingId:BINDING,ownerSidHash:OWNER,tunnelIdHash:TUNNEL,expiresAtMs:NOW+30000
});
function fixture(t){
  const dir=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'rc013-signed-sql-integration-'));
  const sink=new Rc013SqliteEffectSink({
    databasePath:path.join(dir,'owner.sqlite'),
    verifyOwner:()=>true // synthetic native-owner *enrollment* only
  });
  const receipt=new MutationIdempotencyStore({
    directory:path.join(dir,'receipts'),scope:'signed-sql-integration'
  });
  t.after(()=>{receipt.close();sink.close();fs.rmSync(dir,{recursive:true,force:true});});
  sink.enroll({projectId:'project-a',hostId:'host-a',rootFingerprint:ROOT,epoch:1});

  const keys=generateKeyPairSync('ed25519');
  const der=keys.publicKey.export({type:'spki',format:'der'});
  const keyId=createHash('sha256').update(der).digest('hex');
  const workerId=deriveWorkerId({
    hostId:'host-a',profileId:'profile-a',ownerSidHash:OWNER,
    deviceProvider:'native-key-store',deviceIdHash:DEVICE,keyId
  });
  const claims={
    issuer:'commander.local',audience:'remote-commander',
    hostId:'host-a',profileId:'profile-a',principalId:'account-a',
    conversationId:'chat-a',bindingId:BINDING,workerId,
    ownerSidHash:OWNER,deviceProvider:'native-key-store',deviceIdHash:DEVICE,
    tunnelProvider:'openai-secure-mcp-tunnel',tunnelIdHash:TUNNEL,
    capabilityPolicyDigest:POLICY,grantRevision:1,
    issuedAtMs:NOW-1000,expiresAtMs:NOW+20000,nonce:'1'.repeat(32)
  };
  const encoded=Buffer.from(JSON.stringify([
    'commander.worker.identity.v1',keyId,...FIELDS.map(x=>claims[x])
  ]));
  const signed={
    schema:1,keyId,publicKey:der.toString('base64url'),claims,
    signature:sign(null,encoded,keys.privateKey).toString('base64url')
  };
  const state={
    grantActive:true,peerActive:true,ownerSidHash:OWNER,route:route(),
    epoch:1,invocations:0,grantChecks:0,workerReads:0,authorityReads:0,
    enrollment:signed
  };
  const verifiedGrant=createV2PrivateSignedWorkerGrantAdapter({
    hostId:'host-a',profileId:'profile-a',principalId:'account-a',
    expectedTunnelIdHash:TUNNEL,expectedOwnerSidHash:OWNER,
    issuer:'commander.local',audience:'remote-commander',now:()=>NOW,
    workerRegistry:{get:async()=>{state.workerReads++;return state.enrollment;}},
    workerAuthority:{authorizeWorker:async({workerId:id,invocation})=>{
      state.authorityReads++;
      if(!state.grantActive||id!==workerId||invocation.tool!=='rc013_sql_counter'
        ||!['accepted','other'].includes(invocation.arguments.counterKey))return null;
      return {authorized:true,workerId,keyId,bindingId:BINDING,
        capabilityPolicyDigest:POLICY,grantRevision:1,expiresAtMs:NOW+20000};
    }},
    resolveCurrentWorkerId:async()=>workerId,
    resolveCurrentOwnerRoute:async()=>state.route
  });
  const gate=createV2PrivatePairOperationGate({
    hostId:'host-a',profileId:'profile-a',principalId:'account-a',
    expectedTunnelIdHash:TUNNEL,expectedOwnerSidHash:OWNER,now:()=>NOW,
    attestTransport:async()=>({
      authenticated:state.peerActive,
      peerType:'owner-pinned-private-tunnel-mtls',
      sessionSource:'native-owner-private-pair'
    }),
    resolveOwnerContext:async()=>owner(),
    readCurrentOwnerSidHash:async()=>state.ownerSidHash,
    verifyExactNativeGrant:async req=>{
      state.grantChecks++;
      return verifiedGrant(req);
    },
    // DO NOT substitute this test-only lease for a machine-global root lease.
    withLease:async(_key,effect)=>effect(),
    receiptStore:receipt,
    execute:async(r,args,tool)=>{
      state.invocations++;
      const digest=createHash('sha256')
        .update(JSON.stringify([tool,args])).digest('hex');
      return sink.increment({
        projectId:r.target.id,hostId:r.hostId,
        rootFingerprint:ROOT,epoch:state.epoch,
        operationKey:v2OperationKey(r),payloadHash:digest,
        counterKey:args.counterKey
      });
    }
  });
  async function call({r=route(),args={counterKey:'accepted'}}={}){
    state.route=r;
    return gate.execute({
      request:{},route:r,tool:'rc013_sql_counter',arguments:args
    });
  }
  return {dir,sink,receipt,state,call};
}
test('real Ed25519 scoped worker -> private gate -> durable receipt -> one native SQLite mutation',async t=>{
  const h=fixture(t);
  assert.deepEqual(await h.call(),{status:'APPLIED',epoch:1});
  assert.deepEqual(await h.call(),{status:'APPLIED',epoch:1},
    'duplicate returns cached durable receipt; not a second write');
  assert.equal(h.sink.inspect('project-a','accepted'),1);
  assert.equal(h.state.invocations,1);
  assert.equal(h.state.grantChecks,5, '3 first-call checks + 2 cache-read checks');
  assert.ok(h.state.workerReads>=2);
  assert.deepEqual(h.receipt.status().states,{SUCCEEDED:1});
});
test('revoked signed worker grant denies even a cached operation receipt',async t=>{
  const h=fixture(t);
  await h.call();
  h.state.grantActive=false;
  await assert.rejects(h.call(),{code:'V2_GRANT_REQUIRED'});
  assert.equal(h.state.invocations,1);
  assert.equal(h.sink.inspect('project-a','accepted'),1);
});
test('stale native owner epoch fences SQL effect although signed grant remains valid',async t=>{
  const h=fixture(t);
  h.sink.rotate({
    projectId:'project-a',expectedEpoch:1,
    nextHostId:'host-b',nextRootFingerprint:ROOT
  });
  await assert.rejects(h.call(),{code:'RC013_SINK_AUTHORITY_FENCE_REJECTED'});
  assert.equal(h.sink.inspect('project-a','accepted'),0);
  assert.equal(h.receipt.status().states.UNCERTAIN,1);
  await assert.rejects(h.call(),e=>e?.mutationIdempotencyCode==='MUTATION_OUTCOME_UNCERTAIN');
  assert.equal(h.sink.inspect('project-a','accepted'),0);
});
test('forged signed worker envelope, disconnected pair and changed OS owner fail closed',async t=>{
  const h=fixture(t);
  h.state.enrollment={...h.state.enrollment,signature:'A'.repeat(86)};
  await assert.rejects(h.call(),{code:'V2_GRANT_REQUIRED'});
  assert.equal(h.sink.inspect('project-a','accepted'),0);
  h.state.peerActive=false;
  await assert.rejects(h.call(),{code:'V2_PRIVATE_OPERATION_TRANSPORT_REQUIRED'});
  h.state.peerActive=true;
  h.state.ownerSidHash='0'.repeat(64);
  await assert.rejects(h.call(),{code:'V2_PRIVATE_OPERATION_OWNER_CHANGED'});
  assert.equal(h.state.invocations,0);
});
test('same operationId with changed exact SQL arguments is a receipt conflict',async t=>{
  const h=fixture(t);
  await h.call();
  // Both exact counters are grant-allowed by the synthetic action policy;
  // immutable receipt input must still detect a changed argument for the ID.
  await assert.rejects(h.call({args:{counterKey:'other'}}),e=>
    e?.mutationIdempotencyCode==='MUTATION_REQUEST_ID_CONFLICT');
  assert.equal(h.sink.inspect('project-a','accepted'),1);
  assert.equal(h.sink.inspect('project-a','other'),0);
});
test('other ChatGPT conversation cannot borrow the signed worker registration',async t=>{
  const h=fixture(t);
  await assert.rejects(h.call({r:route({conversationId:'chat-b'})}),e=>
    e?.code==='V2_PRIVATE_OPERATION_BINDING_REQUIRED'||
    e?.code==='V2_GRANT_REQUIRED');
  assert.equal(h.state.invocations,0);
  assert.equal(h.sink.inspect('project-a','accepted'),0);
});
