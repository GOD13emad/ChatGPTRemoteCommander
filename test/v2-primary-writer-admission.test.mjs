import test from 'node:test';
import assert from 'node:assert/strict';
import { executeV2PinnedPrimaryWorkflowOperation as admission } from '../src/v2-authorized-operation.mjs';

const mkRoute=(override={})=>({
  hostId:'host-a',principalId:'principal-a',profileId:'profile-a',
  conversationId:'chat-a',operationId:'op-01',
  target:{kind:'workflow-root',id:'project-a'},...override
});
const safePin=(override={})=>({
  projectId:'project-a',primaryHostId:'host-a',
  rootFingerprint:'a'.repeat(64),authorityEpoch:7,...override
});
const denied=(code)=>e=>e?.code===code;
function harness(){
  const ledger=new Map(), events={execute:0,leases:0,sink:0,verify:0,grant:0};
  let pin=safePin(), currentHost='host-a', caller={hostId:'host-a',principalId:'principal-a',profileId:'profile-a',conversationId:'chat-a'};
  let verifyPin=true, grant=true, sinkAllowed=true, changeEpochOnSink=false;
  const services={
    nativeHostId:async()=>currentHost,
    readNativePrimary:async()=>({...pin}),
    verifyNativePrimary:async()=>{events.verify++;return verifyPin;},
    withEffectSinkFence:async(s,act)=>{
      events.sink++;
      if(!sinkAllowed)throw Object.assign(new Error('NATIVE_EFFECT_FENCE_UNAVAILABLE'),{code:'NATIVE_EFFECT_FENCE_UNAVAILABLE'});
      if(changeEpochOnSink){pin={...pin,authorityEpoch:pin.authorityEpoch+1};changeEpochOnSink=false;}
      return act();
    },
    observedCaller:async()=>caller,
    hasGrant:async()=>{events.grant++;return grant;},
    withLease:async(_,act)=>{events.leases++;return act();},
    receiptStore:{execute:async({requestId},act)=>{
      if(ledger.has(requestId))return ledger.get(requestId);
      const receipt=await act();
      ledger.set(requestId,receipt);
      return receipt;
    }},
    execute:async()=>{events.execute++;return {ok:true,receipt:'synthetic-no-effect'};}
  };
  return {services,events,
    pin:v=>{pin=v;},host:v=>{currentHost=v;},caller:v=>{caller=v;},
    verify:v=>{verifyPin=v;},grant:v=>{grant=v;},
    sink:v=>{sinkAllowed=v;},rotateOnSink:()=>{changeEpochOnSink=true;}};
}
test('pinned primary reuses native V2 route, grant, lease and durable receipt; replay is cached',async()=>{
  const h=harness(), r=mkRoute();
  const one=await admission(r,h.services,'write_text');
  assert.equal(one.ok,true);
  const two=await admission(r,h.services,'write_text');
  assert.deepEqual(two,one);
  assert.equal(h.events.execute,1);
  assert.equal(h.events.leases,2);
  assert.equal(h.events.sink,2);
});
test('no remote effect without native owner primary callbacks',async()=>{
  const h=harness(); delete h.services.withEffectSinkFence;
  await assert.rejects(admission(mkRoute(),h.services,'write_text'),denied('V2_TRUSTED_DEPENDENCY_REQUIRED'));
  assert.equal(h.events.execute,0);
});
test('secondary host cannot execute shared workflow root locally',async()=>{
  const h=harness();
  h.host('host-b');
  await assert.rejects(admission(mkRoute(),h.services,'write_text'),denied('V2_PRIMARY_HOST_NOT_AUTHORIZED'));
  assert.equal(h.events.execute,0);
});
test('request with a nonprimary target host is rejected before effect',async()=>{
  const h=harness();
  await assert.rejects(admission(mkRoute({hostId:'host-b'}),h.services,'write_text'),denied('V2_PRIMARY_HOST_NOT_AUTHORIZED'));
  assert.equal(h.events.execute,0);
});
test('native primary root, project and epoch must be exact and authenticated',async()=>{
  const h=harness();
  h.pin(safePin({rootFingerprint:'not-a-digest'}));
  await assert.rejects(admission(mkRoute(),h.services,'write_text'),denied('V2_PRIMARY_HOST_NOT_AUTHORIZED'));
  h.pin(safePin({projectId:'other-project'}));
  await assert.rejects(admission(mkRoute(),h.services,'write_text'),denied('V2_PRIMARY_HOST_NOT_AUTHORIZED'));
  h.pin(safePin());
  h.verify(false);
  await assert.rejects(admission(mkRoute(),h.services,'write_text'),denied('V2_PRIMARY_OWNER_PIN_UNVERIFIED'));
  assert.equal(h.events.execute,0);
});
test('owner authority rotating while acquiring native sink fence fails closed',async()=>{
  const h=harness();h.rotateOnSink();
  await assert.rejects(admission(mkRoute(),h.services,'write_text'),denied('V2_PRIMARY_AUTHORITY_CHANGED'));
  assert.equal(h.events.execute,0);
});
test('native sink outage or partition cannot fall back to per-host SQLite writer',async()=>{
  const h=harness();h.sink(false);
  await assert.rejects(admission(mkRoute(),h.services,'write_text'),denied('NATIVE_EFFECT_FENCE_UNAVAILABLE'));
  assert.equal(h.events.execute,0);assert.equal(h.events.leases,0);
});
test('revoked worker grant is still checked by original protected operation',async()=>{
  const h=harness();h.grant(false);
  await assert.rejects(admission(mkRoute(),h.services,'write_text'),denied('V2_GRANT_REQUIRED'));
  assert.equal(h.events.execute,0);
});
test('wrong exact chat identity still rejected by original protected operation',async()=>{
  const h=harness();h.caller({hostId:'host-a',principalId:'principal-a',profileId:'profile-a',conversationId:'chat-other'});
  await assert.rejects(admission(mkRoute(),h.services,'write_text'),denied('V2_ROUTE_CALLER_MISMATCH'));
  assert.equal(h.events.execute,0);
});
test('existing V2 policy only permits workflow-root target for this adapter',async()=>{
  const h=harness();
  await assert.rejects(admission(mkRoute({target:{kind:'desktop-seat',id:'seat-a'}}),h.services,'gui_click'),
    denied('V2_PRIMARY_WORKFLOW_ROOT_REQUIRED'));
  assert.equal(h.events.execute,0);
});
