// QA-only broker contract tests: no actual desktop, input, network or account.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWindowsSessionBrokerQA} from '../src/native-workspace-session-broker-win-qa.mjs';
import {createWindowsNativeJournalQA} from '../src/native-workspace-journal-win-sqlite-qa.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const a='a'.repeat(64),b='b'.repeat(64),frame='f'.repeat(64);
const defer=()=>{
  let resolve,reject;
  const promise=new Promise((a,b)=>{resolve=a;reject=b});
  return {promise,resolve,reject};
};
function fixture({dispatch}={}){
  const agentA=Object.freeze({}),agentB=Object.freeze({}),supervisor=Object.freeze({});
  const trusted=new WeakMap([
    [agentA,{principalId:'agent-a',sessionId:'session-a',role:'agent',allowedWorkspaces:[a]}],
    [agentB,{principalId:'agent-b',sessionId:'session-b',role:'agent',allowedWorkspaces:[b]}],
    [supervisor,{principalId:'owner',sessionId:'owner-session',role:'supervisor',allowedWorkspaces:[a,b]}]
  ]);
  const effects=[],records=new Map();
  let clock=1000;
  const journal={
    async execute({workspaceRef,operationId,kind},nativeEffect){
      const last=[...records.values()].filter(x=>x.workspaceRef===workspaceRef).at(-1);
      if(last?.state==='PREPARED')throw Error('UNCERTAIN_WORKSPACE');
      if(records.has(operationId))throw Error('REPLAY_DENIED');
      records.set(operationId,{workspaceRef,operationId,kind,state:'PREPARED'});
      const result=await nativeEffect();
      records.get(operationId).state='ACKED';
      return result;
    }
  };
  const broker=createWindowsSessionBrokerQA({
    attest:context=>trusted.get(context),
    journal,
    observeNative:async()=>({sha256:frame,effectMode:'qa-simulated'}),
    dispatchNative:async action=>{
      effects.push(action);
      return dispatch?dispatch(action):'SIMULATED';
    },
    now:()=>clock
  });
  return {agentA,agentB,supervisor,broker,effects,records,advance:n=>{clock+=n}};
}

test('unattested profile strings or caller body cannot observe, take over or execute input',async()=>{
  const x=fixture();
  await assert.rejects(x.broker.observe({context:{
    principalId:'owner',role:'supervisor',allowedWorkspaces:[a]},workspaceRef:a}),
    e=>e.code==='BROKER_UNAUTHENTICATED');
  assert.throws(()=>x.broker.takeover({context:{role:'supervisor'},workspaceRef:a}),
    e=>e.code==='BROKER_UNAUTHENTICATED');
  await assert.rejects(x.broker.execute({lease:{workspaceRef:a},operationId:'forged',kind:'click'}),
    e=>e.code==='BROKER_LEASE_INVALID');
  assert.equal(x.effects.length,0);
});

test('a fresh trusted observation grants only one bounded action',async()=>{
  const x=fixture();
  const frameProof=await x.broker.observe({context:x.agentA,workspaceRef:a});
  const lease=x.broker.acquire({context:x.agentA,observation:frameProof,ttlMs:5000});
  assert.equal(await x.broker.execute({context:x.agentA,lease,operationId:'first-op',kind:'click',expectedWorkspaceRef:a}),'SIMULATED');
  assert.equal(x.effects.length,1);
  await assert.rejects(x.broker.execute({context:x.agentA,lease,operationId:'replay',kind:'click'}),
    e=>e.code==='BROKER_LEASE_STALE');
  assert.throws(()=>x.broker.acquire({context:x.agentA,observation:frameProof}),
    e=>e.code==='BROKER_OBSERVATION_STALE');
  const next=await x.broker.observe({context:x.agentA,workspaceRef:a});
  const second=x.broker.acquire({context:x.agentA,observation:next});
  await x.broker.execute({context:x.agentA,lease:second,operationId:'second-op',kind:'drag'});
  assert.equal(x.effects.length,2);
});

test('workspace binding and identity proof cannot be re-used for another worker',async()=>{
  const x=fixture();
  await assert.rejects(x.broker.observe({context:x.agentA,workspaceRef:b}),
    e=>e.code==='BROKER_UNAUTHENTICATED');
  const proof=await x.broker.observe({context:x.agentA,workspaceRef:a});
  assert.throws(()=>x.broker.acquire({context:x.agentB,observation:proof}),
    e=>e.code==='BROKER_UNAUTHENTICATED');
  const lease=x.broker.acquire({context:x.agentA,observation:proof});
  await assert.rejects(x.broker.execute({context:x.agentA,lease,expectedWorkspaceRef:b,operationId:'wrong-target',kind:'click'}),
    e=>e.code==='BROKER_WORKSPACE_MISMATCH');
  assert.equal(x.effects.length,0);
  await x.broker.execute({context:x.agentA,lease,expectedWorkspaceRef:a,operationId:'right-target',kind:'click'});
  assert.equal(x.effects[0].workspaceRef,a);
});

test('supervisor takeover revokes prior lease and requires new native observation',async()=>{
  const x=fixture();
  const observation=await x.broker.observe({context:x.agentA,workspaceRef:a});
  const lease=x.broker.acquire({context:x.agentA,observation});
  assert.throws(()=>x.broker.takeover({context:x.agentA,workspaceRef:a}),
    e=>e.code==='BROKER_SUPERVISOR_REQUIRED');
  assert.equal(x.broker.takeover({context:x.supervisor,workspaceRef:a}).requiresNewObservation,true);
  await assert.rejects(x.broker.execute({context:x.agentA,lease,operationId:'stale-click',kind:'click'}),
    e=>e.code==='BROKER_LEASE_STALE');
  assert.throws(()=>x.broker.acquire({context:x.agentA,observation}),
    e=>e.code==='BROKER_OBSERVATION_STALE');
  const fresh=await x.broker.observe({context:x.supervisor,workspaceRef:a});
  const ownerLease=x.broker.acquire({context:x.supervisor,observation:fresh});
  await x.broker.execute({context:x.supervisor,lease:ownerLease,operationId:'owner-click',kind:'click'});
  assert.equal(x.effects.length,1);
});

test('expired leases are rejected without dispatch; control can be reassigned',async()=>{
  const x=fixture();
  const frameProof=await x.broker.observe({context:x.agentB,workspaceRef:b});
  const lease=x.broker.acquire({context:x.agentB,observation:frameProof,ttlMs:200});
  x.advance(201);
  await assert.rejects(x.broker.execute({context:x.agentB,lease,operationId:'expired-op',kind:'click'}),
    e=>e.code==='BROKER_LEASE_STALE');
  assert.equal(x.effects.length,0);
  const next=await x.broker.observe({context:x.agentB,workspaceRef:b});
  const replacement=x.broker.acquire({context:x.agentB,observation:next});
  await x.broker.execute({context:x.agentB,lease:replacement,operationId:'valid-op',kind:'click'});
  assert.equal(x.effects.length,1);
});

test('in-flight action cannot be displaced by supervisor takeover',async()=>{
  const gate=defer();
  const x=fixture({dispatch:()=>gate.promise});
  const proof=await x.broker.observe({context:x.agentA,workspaceRef:a});
  const lease=x.broker.acquire({context:x.agentA,observation:proof});
  const inflight=x.broker.execute({context:x.agentA,lease,operationId:'slow-op',kind:'click'});
  assert.throws(()=>x.broker.takeover({context:x.supervisor,workspaceRef:a}),
    e=>e.code==='BROKER_WORKSPACE_BUSY');
  await assert.rejects(x.broker.observe({context:x.supervisor,workspaceRef:a}),
    e=>e.code==='BROKER_WORKSPACE_BUSY');
  gate.resolve('DONE');
  assert.equal(await inflight,'DONE');
  assert.equal(x.broker.takeover({context:x.supervisor,workspaceRef:a}).requiresNewObservation,true);
});

test('uncertain result isolates only its workspace, other workspace still works',async()=>{
  const x=fixture({dispatch:action=>{
    if(action.operationId==='faulted')throw Error('UNKNOWN_NATIVE_OUTCOME');
    return 'OK';
  }});
  const p=await x.broker.observe({context:x.agentA,workspaceRef:a});
  const lease=x.broker.acquire({context:x.agentA,observation:p});
  await assert.rejects(x.broker.execute({context:x.agentA,lease,operationId:'faulted',kind:'click'}));
  const fresh=await x.broker.observe({context:x.agentA,workspaceRef:a});
  const again=x.broker.acquire({context:x.agentA,observation:fresh});
  await assert.rejects(x.broker.execute({context:x.agentA,lease:again,operationId:'not-replayed',kind:'click'}),
    /UNCERTAIN_WORKSPACE/);
  const independent=await x.broker.observe({context:x.agentB,workspaceRef:b});
  const second=x.broker.acquire({context:x.agentB,observation:independent});
  assert.equal(await x.broker.execute({context:x.agentB,lease:second,operationId:'other-ok',kind:'click'}),'OK');
  assert.equal(x.effects.filter(v=>v.workspaceRef===b).length,1);
});

test('observation completed after takeover is stale and grants no control',async()=>{
  const frameGate=defer(),agent=Object.freeze({}),owner=Object.freeze({});
  const trusted=new WeakMap([
    [agent,{principalId:'agent',sessionId:'agent-session',role:'agent',allowedWorkspaces:[a]}],
    [owner,{principalId:'owner',sessionId:'owner-session',role:'supervisor',allowedWorkspaces:[a]}]
  ]);
  const broker=createWindowsSessionBrokerQA({
    attest:context=>trusted.get(context),journal:{execute:async()=>{}},
    observeNative:()=>frameGate.promise,dispatchNative:async()=>{}
  });
  const observing=broker.observe({context:agent,workspaceRef:a});
  broker.takeover({context:owner,workspaceRef:a});
  frameGate.resolve({sha256:frame,effectMode:'qa-simulated'});
  await assert.rejects(observing,e=>e.code==='BROKER_OBSERVATION_STALE');
});

test('closed broker denies new observation and gives no provisioning interface',async()=>{
  const x=fixture();
  assert.equal(Object.hasOwn(x.broker,'provision'),false);
  x.broker.close();
  await assert.rejects(x.broker.observe({context:x.agentA,workspaceRef:a}),
    e=>e.code==='BROKER_CLOSED');
  assert.equal(x.effects.length,0);
});


test('real Windows SQLite journal requires a trusted broker lease before simulated dispatch',
  {skip:process.platform!=='win32'},async()=>{
    const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-broker-journal-win-qa-')));
    const agent=Object.freeze({});
    let effects=0;
    const journal=createWindowsNativeJournalQA({root});
    try{
      journal.provision();
      const broker=createWindowsSessionBrokerQA({
        attest:ctx=>ctx===agent
          ?{principalId:'qa-agent',sessionId:'qa-session',role:'agent',allowedWorkspaces:[a]}:null,
        journal,
        observeNative:async()=>({sha256:frame,effectMode:'qa-simulated'}),
        dispatchNative:async()=>{effects++;return 'SIMULATED_ONLY'}
      });
      await assert.rejects(broker.execute({context:agent,lease:{workspaceRef:a},operationId:'no-lease',kind:'click'}),
        e=>e.code==='BROKER_LEASE_INVALID');
      assert.equal(effects,0);
      const proof=await broker.observe({context:agent,workspaceRef:a});
      const lease=broker.acquire({context:agent,observation:proof,ttlMs:5000});
      assert.equal(await broker.execute({context:agent,lease,operationId:'recorded-simulated-only',kind:'click'}),
        'SIMULATED_ONLY');
      assert.equal(effects,1);
      assert.equal(journal.inspect('recorded-simulated-only').state,'ACKED');
      await assert.rejects(broker.execute({context:agent,lease,operationId:'repeat',kind:'click'}),
        e=>e.code==='BROKER_LEASE_STALE');
      broker.close();
    }finally{
      journal.close();
      fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
    }
  });


test('two independent agents may execute concurrently without shared-workspace lock',async()=>{
  const slow=defer();
  const x=fixture({dispatch:action=>action.workspaceRef===a?slow.promise:'SECOND_WORKSPACE_OK'});
  const pa=await x.broker.observe({context:x.agentA,workspaceRef:a});
  const pb=await x.broker.observe({context:x.agentB,workspaceRef:b});
  const la=x.broker.acquire({context:x.agentA,observation:pa});
  const lb=x.broker.acquire({context:x.agentB,observation:pb});
  const first=x.broker.execute({context:x.agentA,lease:la,operationId:'long-agent-a',kind:'drag'});
  const second=await x.broker.execute({context:x.agentB,lease:lb,operationId:'independent-agent-b',kind:'click'});
  assert.equal(second,'SECOND_WORKSPACE_OK');
  assert.equal(x.records.get('independent-agent-b').state,'ACKED');
  assert.equal(x.records.get('long-agent-a').state,'PREPARED');
  assert.equal(x.effects.length,2);
  slow.resolve('FIRST_WORKSPACE_OK');
  assert.equal(await first,'FIRST_WORKSPACE_OK');
  assert.equal(x.records.get('long-agent-a').state,'ACKED');
});


test('stolen lease and revoked principal never authorize simulated native input',async()=>{
  const alice=Object.freeze({}),bob=Object.freeze({});
  let active=true,effects=0;
  const identities=new WeakMap([
    [alice,{principalId:'same-owner',sessionId:'session-a',role:'agent',allowedWorkspaces:[a]}],
    [bob,{principalId:'same-owner',sessionId:'session-b',role:'agent',allowedWorkspaces:[a]}]
  ]);
  const broker=createWindowsSessionBrokerQA({
    attest:context=>context===alice&&!active?null:identities.get(context),
    observeNative:async()=>({sha256:frame,effectMode:'qa-simulated'}),
    dispatchNative:async()=>{effects++;},
    journal:{execute:async(args,fn)=>fn()}
  });
  const proof=await broker.observe({context:alice,workspaceRef:a});
  assert.throws(()=>broker.acquire({context:bob,observation:proof}),
    e=>e.code==='BROKER_OBSERVATION_OWNER_MISMATCH');
  const lease=broker.acquire({context:alice,observation:proof});
  await assert.rejects(broker.execute({
    context:bob,lease,operationId:'stolen',kind:'click'
  }),e=>e.code==='BROKER_LEASE_OWNER_MISMATCH');
  assert.throws(()=>broker.release({context:bob,lease}),
    e=>e.code==='BROKER_LEASE_OWNER_MISMATCH');
  active=false;
  await assert.rejects(broker.execute({
    context:alice,lease,operationId:'revoked',kind:'click'
  }),e=>e.code==='BROKER_UNAUTHENTICATED');
  assert.equal(effects,0);
});

test('revocation during awaited observation cannot mint a lease',async()=>{
  const alice=Object.freeze({}),gate=defer();
  let active=true;
  const broker=createWindowsSessionBrokerQA({
    attest:context=>context===alice&&active
      ?{principalId:'alice',sessionId:'session-a',role:'agent',allowedWorkspaces:[a]}
      :null,
    observeNative:()=>gate.promise,dispatchNative:async()=>{},
    journal:{execute:async()=>{}}
  });
  const pending=broker.observe({context:alice,workspaceRef:a});
  active=false;
  gate.resolve({sha256:frame,effectMode:'qa-simulated'});
  await assert.rejects(pending,e=>e.code==='BROKER_UNAUTHENTICATED');
});


test('revocation after journal preparation but before dispatch prevents native effect',async()=>{
  const alice=Object.freeze({}),gate=defer();
  let allowed=true,effects=0;
  const broker=createWindowsSessionBrokerQA({
    attest:context=>context===alice&&allowed
      ?{principalId:'alice',sessionId:'session-a',role:'agent',allowedWorkspaces:[a]}
      :null,
    observeNative:async()=>({sha256:frame,effectMode:'qa-simulated'}),
    journal:{execute:async(_details,effect)=>{await gate.promise;return effect();}},
    dispatchNative:async()=>{effects++;}
  });
  const proof=await broker.observe({context:alice,workspaceRef:a});
  const lease=broker.acquire({context:alice,observation:proof});
  const pending=broker.execute({context:alice,lease,operationId:'revoked-before-effect',kind:'click'});
  allowed=false;
  gate.resolve();
  await assert.rejects(pending,e=>e.code==='BROKER_UNAUTHENTICATED');
  assert.equal(effects,0);
});

test('lease expiring during journal preparation cannot dispatch native effect',async()=>{
  const alice=Object.freeze({}),gate=defer();
  let clock=1000,effects=0;
  const broker=createWindowsSessionBrokerQA({
    attest:context=>context===alice
      ?{principalId:'alice',sessionId:'session-a',role:'agent',allowedWorkspaces:[a]}
      :null,
    observeNative:async()=>({sha256:frame,effectMode:'qa-simulated'}),
    now:()=>clock,
    journal:{execute:async(_details,effect)=>{await gate.promise;return effect();}},
    dispatchNative:async()=>{effects++;}
  });
  const proof=await broker.observe({context:alice,workspaceRef:a});
  const lease=broker.acquire({context:alice,observation:proof,ttlMs:100});
  const pending=broker.execute({context:alice,lease,operationId:'expired-before-effect',kind:'click'});
  clock+=101;
  gate.resolve();
  await assert.rejects(pending,e=>e.code==='BROKER_LEASE_STALE');
  assert.equal(effects,0);
});

test('even a misbehaving journal calling a native callback twice causes one effect',async()=>{
  const alice=Object.freeze({});
  let effects=0;
  const broker=createWindowsSessionBrokerQA({
    attest:context=>context===alice
      ?{principalId:'alice',sessionId:'session-a',role:'agent',allowedWorkspaces:[a]}
      :null,
    observeNative:async()=>({sha256:frame,effectMode:'qa-simulated'}),
    journal:{execute:async(_details,effect)=>{await effect();return effect();}},
    dispatchNative:async()=>{effects++;}
  });
  const proof=await broker.observe({context:alice,workspaceRef:a});
  const lease=broker.acquire({context:alice,observation:proof});
  await assert.rejects(broker.execute({context:alice,lease,operationId:'double-callback',kind:'click'}),
    e=>e.code==='BROKER_EFFECT_ALREADY_REQUESTED');
  assert.equal(effects,1);
});
