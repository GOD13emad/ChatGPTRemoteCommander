import test from 'node:test';
import assert from 'node:assert/strict';
import {createV2PrivatePairOperationGate} from '../src/v2-private-pair-operation-gate.mjs';

const OWNER='a'.repeat(64), TUNNEL='b'.repeat(64),BIND='c'.repeat(64), ROOT='d'.repeat(64);
const NOW=1794475200000;
const route=(host='host-a',conversation='chat-a',target={kind:'workflow-root',id:'project-a'})=>({
  hostId:host,principalId:'principal-a',profileId:'profile-a',
  conversationId:conversation,operationId:'op-a',target
});
function fixture({host='host-a',pinHost='host-a',primary=true}={}){
  const history=new Map();
  const s={
    host,pin:{projectId:'project-a',primaryHostId:pinHost,
      rootFingerprint:ROOT,authorityEpoch:1},
    nativeVerified:true,sinkAvailable:true,rotateAtSink:false,grant:true,
    tunnel:true,owner:true,
    effects:0,leases:0,receipts:0,nativeCalls:0,sinkCalls:0,checks:0
  };
  const native={
    nativeHostId:async()=>s.host,
    readNativePrimary:async()=>({...s.pin}),
    verifyNativePrimary:async()=>{s.nativeCalls++;return s.nativeVerified;},
    withEffectSinkFence:async (scope,effect)=>{
      s.sinkCalls++;
      assert.equal(scope.projectId,'project-a');
      assert.equal(scope.resourceKey.includes('project-a'),true);
      if(!s.sinkAvailable)throw Object.assign(new Error('PRIMARY_EFFECT_SINK_DOWN'),{code:'PRIMARY_EFFECT_SINK_DOWN'});
      if(s.rotateAtSink){
        s.pin={...s.pin,authorityEpoch:s.pin.authorityEpoch+1};
        s.rotateAtSink=false;
      }
      return effect();
    }
  };
  const trusted={
    hostId:host,profileId:'profile-a',principalId:'principal-a',
    expectedTunnelIdHash:TUNNEL,expectedOwnerSidHash:OWNER,
    now:()=>NOW,
    attestTransport:async()=>s.tunnel?{authenticated:true,
      peerType:'owner-pinned-private-tunnel-mtls',
      sessionSource:'native-owner-private-pair'}:{authenticated:false},
    readCurrentOwnerSidHash:async()=>s.owner?OWNER:'0'.repeat(64),
    resolveOwnerContext:async selected=>({
      source:'native-owner-attested',hostId:host,profileId:'profile-a',
      principalId:'principal-a',conversationId:selected.conversationId,
      bindingId:BIND,ownerSidHash:OWNER,tunnelIdHash:TUNNEL,
      expiresAtMs:NOW+60000
    }),
    verifyExactNativeGrant:async ({route:r,tool,arguments:args})=>{
      s.checks++;
      assert.equal(tool,'write_text');
      assert.equal(r.target.id,'project-a');
      assert.equal(args.text,'synthetic-no-effect');
      return s.grant;
    },
    withLease:async (_resource,action)=>{s.leases++;return action();},
    receiptStore:{execute:async({requestId},fn)=>{
      s.receipts++;
      if(history.has(requestId))return history.get(requestId);
      const outcome=await fn();history.set(requestId,outcome);return outcome;
    }},
    execute:async(_route,args,tool)=>{
      s.effects++;
      assert.equal(tool,'write_text');
      assert.equal(Object.isFrozen(args),true);
      return {kind:'synthetic-no-effect',operation:'op-a'};
    },
    ...(primary?{requirePrimaryWriter:true,primaryAuthority:native}:{})
  };
  const run=(r=route(host),tool='write_text')=>createV2PrivatePairOperationGate(trusted).execute({
    route:r,request:{},tool,arguments:{text:'synthetic-no-effect'}
  });
  return {state:s,trusted,native,run};
}
const denied=code=>err=>err?.code===code;

test('primary path composes private pair owner, signed grant, lease and receipt; replay cached',async()=>{
  const h=fixture();
  assert.equal((await h.run()).kind,'synthetic-no-effect');
  assert.equal((await h.run()).operation,'op-a');
  assert.equal(h.state.effects,1);
  assert.equal(h.state.leases,2);
  assert.equal(h.state.receipts,2);
  assert.equal(h.state.sinkCalls,2);
  assert.ok(h.state.checks>=5);
});
test('multi-host activation refuses missing or partial owner-native fence functions',()=>{
  const h=fixture();
  assert.throws(()=>createV2PrivatePairOperationGate({
    ...h.trusted,primaryAuthority:undefined
  }),denied('V2_PRIVATE_OPERATION_PRIMARY_BOOTSTRAP_REQUIRED'));
  assert.throws(()=>createV2PrivatePairOperationGate({
    ...h.trusted,primaryAuthority:{...h.native,withEffectSinkFence:null}
  }),denied('V2_PRIVATE_OPERATION_PRIMARY_BOOTSTRAP_REQUIRED'));
  assert.throws(()=>createV2PrivatePairOperationGate({
    ...h.trusted,requirePrimaryWriter:false
  }),denied('V2_PRIVATE_OPERATION_PRIMARY_BOOTSTRAP_REQUIRED'));
  assert.throws(()=>createV2PrivatePairOperationGate({
    ...h.trusted,primaryAuthority:{...h.native,unexpected:()=>true}
  }),denied('V2_PRIVATE_OPERATION_PRIMARY_BOOTSTRAP_REQUIRED'));
});
test('Proxy or accessor bootstrapped primary is rejected without invoking native traps',()=>{
  const h=fixture();
  let traps=0;
  const proxy=new Proxy(h.native,{get(t,k,r){traps++;return Reflect.get(t,k,r);}});
  assert.throws(()=>createV2PrivatePairOperationGate({
    ...h.trusted,primaryAuthority:proxy
  }),denied('V2_PRIVATE_OPERATION_PRIMARY_BOOTSTRAP_REQUIRED'));
  assert.equal(traps,0);
  const getter={...h.native};
  Object.defineProperty(getter,'verifyNativePrimary',{
    enumerable:true,get(){traps++;return async()=>true;}
  });
  assert.throws(()=>createV2PrivatePairOperationGate({
    ...h.trusted,primaryAuthority:getter
  }),denied('V2_PRIVATE_OPERATION_PRIMARY_BOOTSTRAP_REQUIRED'));
  assert.equal(traps,0);
});
test('second physical host with independent local receipt cannot execute when primary is elsewhere',async()=>{
  const h=fixture({host:'host-b',pinHost:'host-a'});
  await assert.rejects(h.run(route('host-b')),denied('V2_PRIMARY_HOST_NOT_AUTHORIZED'));
  assert.equal(h.state.effects,0);
  assert.equal(h.state.leases,0);
  assert.equal(h.state.receipts,0);
  assert.equal(h.state.sinkCalls,0);
});
test('stale epoch between initial native pin and sink acquisition is denied',async()=>{
  const h=fixture();
  h.state.rotateAtSink=true;
  await assert.rejects(h.run(),denied('V2_PRIMARY_AUTHORITY_CHANGED'));
  assert.equal(h.state.effects,0);
  assert.equal(h.state.leases,0);
  assert.equal(h.state.receipts,0);
  assert.equal(h.state.sinkCalls,1);
});
test('native sink unavailable fails closed rather than run local legacy effect',async()=>{
  const h=fixture();
  h.state.sinkAvailable=false;
  await assert.rejects(h.run(),denied('PRIMARY_EFFECT_SINK_DOWN'));
  assert.equal(h.state.effects,0);
  assert.equal(h.state.receipts,0);
});
test('revoked grant, invalid native owner, absent mTLS peer each deny before tool effect',async()=>{
  for(const change of [
    h=>{h.state.grant=false;},
    h=>{h.state.owner=false;},
    h=>{h.state.tunnel=false;}
  ]){
    const h=fixture();change(h);
    await assert.rejects(h.run());
    assert.equal(h.state.effects,0);
  }
});
test('non-workflow target cannot use primary workflow-root authority',async()=>{
  const h=fixture();
  await assert.rejects(h.run(route('host-a','chat-a',
    {kind:'desktop-seat',id:'seat-a'})),denied('V2_PRIMARY_WORKFLOW_ROOT_REQUIRED'));
  assert.equal(h.state.effects,0);
});
test('single-host mode without opt-in keeps existing private pair behavior',async()=>{
  const h=fixture({primary:false});
  const outcome=await h.run();
  assert.equal(outcome.kind,'synthetic-no-effect');
  assert.equal(h.state.effects,1);
  assert.equal(h.state.sinkCalls,0);
});

test('actual owner-local SQLite effect rejects stale epoch after protected private grant and durable receipt',async t=>{
  const fs=await import('node:fs');
  const os=await import('node:os');
  const path=await import('node:path');
  const {createHash}=await import('node:crypto');
  const {MutationIdempotencyStore}=await import('../src/mutation-idempotency.mjs');
  const {Rc013SqliteEffectSink}=await import('../src/rc013-sqlite-effect-sink.mjs');
  const {v2OperationKey}=await import('../src/v2-routing-contract.mjs');

  const root=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'rc013-primary-real-sql-'));
  let receipts,sink;
  t.after(()=>{
    receipts?.close();sink?.close();
    fs.rmSync(root,{recursive:true,force:true});
  });
  sink=new Rc013SqliteEffectSink({
    databasePath:path.join(root,'owner.sqlite'),
    verifyOwner:()=>true // simulated OS-owner trust; never production
  });
  sink.enroll({
    projectId:'project-a',hostId:'host-a',
    rootFingerprint:ROOT,epoch:1
  });
  receipts=new MutationIdempotencyStore({
    directory:path.join(root,'receipts'),scope:'rc013-private-primary-sql'
  });

  const h=fixture();
  h.trusted.receiptStore=receipts;
  h.trusted.execute=async(r,args,tool)=>{
    h.state.effects++;
    const payloadHash=createHash('sha256')
      .update(JSON.stringify([tool,args])).digest('hex');
    return sink.increment({
      projectId:'project-a',hostId:r.hostId,
      rootFingerprint:ROOT,epoch:h.state.pin.authorityEpoch,
      operationKey:v2OperationKey(r),payloadHash,counterKey:'accepted'
    });
  };
  assert.deepEqual(await h.run(),{status:'APPLIED',epoch:1});
  assert.deepEqual(await h.run(),{status:'APPLIED',epoch:1});
  assert.equal(sink.inspect('project-a','accepted'),1);
  assert.equal(h.state.effects,1);
  assert.deepEqual(receipts.status().states,{SUCCEEDED:1});

  // Change SQL sink's current owner, leaving the originally issued synthetic
  // authority pin and signed-grant simulation stale. New operation ID must
  // be denied AT THE SQL effect and leave its counter unchanged.
  sink.rotate({
    projectId:'project-a',expectedEpoch:1,
    nextHostId:'host-b',nextRootFingerprint:ROOT
  });
  await assert.rejects(h.run({...route(),operationId:'op-after-revoke'}),
    denied('RC013_SINK_AUTHORITY_FENCE_REJECTED'));
  assert.equal(sink.inspect('project-a','accepted'),1);
  assert.equal(h.state.effects,2);
  assert.equal(receipts.status().states.UNCERTAIN,1);
});

test('Ed25519 Worker + primary pin + private gate + durable receipt + real SQL epoch fence compose as one chain',async t=>{
  const {createHash,generateKeyPairSync,sign}=await import('node:crypto');
  const {deriveWorkerId}=await import('../src/worker-identity-authority.mjs');
  const {createV2PrivateSignedWorkerGrantAdapter}=await import(
    '../src/v2-private-signed-worker-grant-adapter.mjs');
  const {MutationIdempotencyStore}=await import('../src/mutation-idempotency.mjs');
  const {Rc013SqliteEffectSink}=await import('../src/rc013-sqlite-effect-sink.mjs');
  const {v2OperationKey}=await import('../src/v2-routing-contract.mjs');
  const fs=await import('node:fs');
  const os=await import('node:os');
  const path=await import('node:path');
  const root=fs.mkdtempSync(path.join(
    fs.realpathSync.native(os.tmpdir()),'rc013-primary-signed-sql-'));
  let sink,receipt;
  t.after(()=>{
    receipt?.close();sink?.close();
    fs.rmSync(root,{recursive:true,force:true});
  });
  sink=new Rc013SqliteEffectSink({
    databasePath:path.join(root,'owner.sqlite'),verifyOwner:()=>true
  });
  sink.enroll({
    projectId:'project-a',hostId:'host-a',rootFingerprint:ROOT,epoch:1
  });
  receipt=new MutationIdempotencyStore({
    directory:path.join(root,'receipts'),scope:'rc013-primary-signed-sql'
  });
  const keys=generateKeyPairSync('ed25519');
  const der=keys.publicKey.export({type:'spki',format:'der'});
  const keyId=createHash('sha256').update(der).digest('hex');
  const DEVICE='e'.repeat(64),POLICY='f'.repeat(64);
  const workerId=deriveWorkerId({
    hostId:'host-a',profileId:'profile-a',ownerSidHash:OWNER,
    deviceProvider:'native-key-store',deviceIdHash:DEVICE,keyId
  });
  const claims={
    issuer:'commander.local',audience:'remote-commander',
    hostId:'host-a',profileId:'profile-a',principalId:'principal-a',
    conversationId:'chat-a',bindingId:BIND,workerId,
    ownerSidHash:OWNER,deviceProvider:'native-key-store',deviceIdHash:DEVICE,
    tunnelProvider:'openai-secure-mcp-tunnel',tunnelIdHash:TUNNEL,
    capabilityPolicyDigest:POLICY,grantRevision:1,
    issuedAtMs:NOW-1000,expiresAtMs:NOW+20000,nonce:'1'.repeat(32)
  };
  const fields=['issuer','audience','hostId','profileId','principalId',
    'conversationId','bindingId','workerId','ownerSidHash','deviceProvider',
    'deviceIdHash','tunnelProvider','tunnelIdHash','capabilityPolicyDigest',
    'grantRevision','issuedAtMs','expiresAtMs','nonce'];
  const encoded=Buffer.from(JSON.stringify([
    'commander.worker.identity.v1',keyId,...fields.map(key=>claims[key])
  ]));
  const enrolled={
    schema:1,keyId,publicKey:der.toString('base64url'),claims,
    signature:sign(null,encoded,keys.privateKey).toString('base64url')
  };
  const state={grantActive:true,registryReads:0,workerChecks:0,sqlEffects:0};
  let currentOwnerRoute=route('host-a');
  const verified=createV2PrivateSignedWorkerGrantAdapter({
    hostId:'host-a',profileId:'profile-a',principalId:'principal-a',
    expectedTunnelIdHash:TUNNEL,expectedOwnerSidHash:OWNER,
    issuer:'commander.local',audience:'remote-commander',
    now:()=>NOW,
    workerRegistry:{get:async()=>{state.registryReads++;return enrolled;}},
    workerAuthority:{authorizeWorker:async({workerId:id,invocation})=>{
      state.workerChecks++;
      if(!state.grantActive||id!==workerId||
        invocation.tool!=='write_text'||
        invocation.arguments.text!=='synthetic-no-effect')return null;
      return {authorized:true,workerId,keyId,bindingId:BIND,
        capabilityPolicyDigest:POLICY,grantRevision:1,
        expiresAtMs:NOW+20000};
    }},
    resolveCurrentWorkerId:async()=>workerId,
    resolveCurrentOwnerRoute:async()=>currentOwnerRoute
  });

  const h=fixture();
  h.trusted.verifyExactNativeGrant=verified;
  h.trusted.receiptStore=receipt;
  h.trusted.execute=async (r,args,tool)=>{
    state.sqlEffects++;
    const payloadHash=createHash('sha256')
      .update(JSON.stringify([tool,args])).digest('hex');
    return sink.increment({
      projectId:r.target.id,hostId:r.hostId,
      rootFingerprint:ROOT,epoch:1,operationKey:v2OperationKey(r),
      payloadHash,counterKey:'signed'
    });
  };
  assert.deepEqual(await h.run(),{status:'APPLIED',epoch:1});
  assert.deepEqual(await h.run(),{status:'APPLIED',epoch:1});
  assert.equal(sink.inspect('project-a','signed'),1);
  assert.equal(state.sqlEffects,1);
  assert.ok(state.registryReads>=2);
  assert.ok(state.workerChecks>=2);
  assert.deepEqual(receipt.status().states,{SUCCEEDED:1});

  // A revoked native signed grant must block *before* the cached receipt.
  state.grantActive=false;
  await assert.rejects(h.run(),denied('V2_GRANT_REQUIRED'));
  assert.equal(sink.inspect('project-a','signed'),1);
  state.grantActive=true;

  // A stale native primary epoch must be rejected at the REAL SQL mutation
  // boundary even if the signed worker grant and old primary pin still pass.
  sink.rotate({projectId:'project-a',expectedEpoch:1,
    nextHostId:'host-b',nextRootFingerprint:ROOT});
  currentOwnerRoute={...route('host-a'),operationId:'op-after-rotation'};
  await assert.rejects(
    h.run(currentOwnerRoute),
    denied('RC013_SINK_AUTHORITY_FENCE_REJECTED'));
  assert.equal(sink.inspect('project-a','signed'),1);
  assert.equal(receipt.status().states.UNCERTAIN,1);
});
