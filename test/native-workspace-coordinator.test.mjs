import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {createNativeWorkspaceCoordinator} from '../src/native-workspace-coordinator.mjs';

const owner={verified:true,subject:'owner'};
const other={verified:true,subject:'other'};
const supervisor={verified:true,subject:'supervisor'};
const auditor={verified:true,subject:'auditor'};
const verified=ctx=>ctx?.verified===true
  ? {authenticated:true,conversationBound:true,subject:ctx.subject,
     conversationId:ctx.conversationId||'fixture-chat'} : null; // SYNTHETIC tests only.
const deferred=()=>{
  let resolve,reject;
  const promise=new Promise((a,b)=>{resolve=a;reject=b;});
  return {promise,resolve,reject};
};
// Valid 1x1 RGB PNGs for synthetic in-memory observation (no real desktop).
function crc32(buf){
  let c=0xffffffff;
  for(const byte of buf){
    c^=byte;
    for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);
  }
  return (c^0xffffffff)>>>0;
}
function pngChunk(type,data){
  const block=Buffer.concat([Buffer.from(type),data]);
  const len=Buffer.alloc(4),check=Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  check.writeUInt32BE(crc32(block));
  return Buffer.concat([len,block,check]);
}
function frame(name,state){
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);
  ihdr[8]=8;ihdr[9]=2;
  const rgb=Buffer.from([0,(name.charCodeAt(name.length-1)+state)%256,
    (state*17+113)%256,58]);
  const bytes=Buffer.concat([
    Buffer.from('89504e470d0a1a0a','hex'),
    pngChunk('IHDR',ihdr),pngChunk('IDAT',deflateSync(rgb)),
    pngChunk('IEND',Buffer.alloc(0))
  ]);
  return {mimeType:'image/png',data:bytes.toString('base64')};
}
function fixture({capacity=3,authorizeObserver=()=>false,
  authorizeHandoff=()=>false,clock=()=>1000,workerSetup=()=>({}),
  durableJournalFactory=null}={}){
  let seq=0,operationSerial=0;
  const workers=[];
  // Unit tests use an explicit synthetic in-memory journal. Durable behavior
  // is checked separately against real owner-private disk and real Xvfb.
  const qaJournalFactory=()=> {
    const seen=new Set();
    return {
      prepare:async ({operationId})=>{
        if(seen.has(operationId))throw Object.assign(
          Error('NATIVE_JOURNAL_DUPLICATE_OPERATION'),
          {code:'NATIVE_JOURNAL_DUPLICATE_OPERATION'});
        seen.add(operationId);
        return {operationId};
      },
      acknowledge:async()=>({submitted:true}),
      inspect:async()=>({releaseAuthorized:false})
    };
  };
  const native=createNativeWorkspaceCoordinator({
    capacity,identityResolver:verified,authorizeObserver,authorizeHandoff,clock,
    durableJournalFactory:durableJournalFactory??qaJournalFactory,
    launchWorkspace:async()=>{
      const name='worker-'+(++seq),settings=workerSetup(name);
      const item={name,typed:[],viewed:0,closes:0,state:0,...settings};
      item.handle={
        kind:'native-private-x11',physicalDesktopInput:false,
        displayId:':'+(1700+seq),serverPid:60000+seq,
        observe:async()=>{
          item.viewed++;
          if(item.onObserve)return item.onObserve();
          return {frame:frame(name,item.state)};
        },
        input:async(action)=>{
          if(item.onInput)return item.onInput(action);
          item.typed.push(action);
          item.state++;
          return {submitted:true};
        },
        close:async()=>{
          item.closes++;
          if(item.onClose)return item.onClose();
        }
      };
      workers.push(item);
      return item.handle;
    }
  });
  const pool={
    ...native,
    inputOwner:(ctx,lease,action,options={})=>native.inputOwner(
      ctx,lease,action,{...options,
        operationId:options.operationId??'qa-owner-'+(++operationSerial)}),
    inputOperator:(ctx,controlToken,action,options={})=>native.inputOperator(
      ctx,controlToken,action,{...options,
        operationId:options.operationId??'qa-operator-'+(++operationSerial)})
  };
  return {pool,workers};
}

test('default factory never grants identity or launches native GUI',async()=>{
  const pool=createNativeWorkspaceCoordinator();
  await assert.rejects(pool.open(owner),/NATIVE_WORKSPACE_IDENTITY_UNVERIFIED/);
  assert.throws(()=>pool.status(owner),/NATIVE_WORKSPACE_IDENTITY_UNVERIFIED/);
  await pool.close();
  const gated=createNativeWorkspaceCoordinator({identityResolver:verified});
  await assert.rejects(gated.open(owner),/NATIVE_WORKSPACE_BACKEND_UNCONFIGURED/);
  await gated.close();
});

test('two private GUI workspaces isolate owners, input, screenshots and close',async()=>{
  const f=fixture();
  const [a,b]=await Promise.all([f.pool.open(owner),f.pool.open(other)]);
  try{
    assert.notEqual(a.lease,b.lease);
    assert.notEqual(a.workspaceRef,b.workspaceRef);
    assert.equal(a.physicalDesktopInput,false);
    assert.equal(f.pool.status(owner).ownedWorkspaces,1);
    assert.equal(f.pool.status(other).ownedWorkspaces,1);
    await assert.rejects(f.pool.observeOwner(other,a.lease),/NATIVE_WORKSPACE_LEASE_DENIED/);
    await assert.rejects(f.pool.inputOwner(owner,a.lease,{kind:'type',text:'A'}),
      /NATIVE_WORKSPACE_REOBSERVATION_REQUIRED/);
    const [av,bv]=await Promise.all([
      f.pool.observeOwner(owner,a.lease),f.pool.observeOwner(other,b.lease)
    ]);
    assert.notEqual(av.frame.data,bv.frame.data);
    const ra=await f.pool.inputOwner(owner,a.lease,{kind:'type',text:'SYNTHETIC_A'},
      {expectedRevision:av.revision});
    assert.equal(ra.nativeEffectConfirmed,false);
    assert.equal(ra.reobserveRequired,true);
    assert.equal(f.workers[0].typed[0].text,'SYNTHETIC_A');
    assert.equal(f.workers[1].typed.length,0);
    await assert.rejects(f.pool.inputOwner(owner,a.lease,{kind:'type',text:'REPLAY'},
      {expectedRevision:av.revision}),/NATIVE_WORKSPACE_REOBSERVATION_REQUIRED/);
    assert.equal(f.workers[0].typed.length,1);
    await f.pool.inputOwner(other,b.lease,{kind:'click',x:12,y:15},
      {expectedRevision:bv.revision});
    assert.equal(f.workers[1].typed.length,1);
  }finally{
    await f.pool.end(owner,a.lease);
    await f.pool.end(other,b.lease);
    await f.pool.close();
  }
  assert.equal(f.workers[0].closes,1);
  assert.equal(f.workers[1].closes,1);
});

test('capacity is reserved while worker startup is pending; shutdown closes late start',async()=>{
  const gate=deferred(),entered=deferred(),closed=[];
  const pool=createNativeWorkspaceCoordinator({
    identityResolver:verified,capacity:1,
    launchWorkspace:async()=>{
      entered.resolve();
      await gate.promise;
      return {kind:'native-private-x11',physicalDesktopInput:false,
        displayId:':1801',serverPid:60101,
        observe:async()=>({frame:frame('one',0)}),
        input:async()=>({submitted:true}),
        close:async()=>closed.push(true)};
    }
  });
  const creating=pool.open(owner);
  await entered.promise;
  await assert.rejects(pool.open(other),/NATIVE_WORKSPACE_CAPACITY/);
  const close=pool.close();
  gate.resolve();
  await assert.rejects(creating,/NATIVE_WORKSPACE_POOL_CLOSED/);
  await close;
  assert.equal(closed.length,1);
  await assert.rejects(pool.open(owner),/NATIVE_WORKSPACE_POOL_CLOSED/);
});

test('observer is default-deny, view-only, scope-bound, stale and revocable',async()=>{
  const denied=fixture();
  const leased=await denied.pool.open(owner);
  await assert.rejects(denied.pool.grantObserver(owner,leased.lease,auditor),
    /NATIVE_WORKSPACE_OBSERVER_DENIED/);
  await denied.pool.close();
  const f=fixture({authorizeObserver:()=>true});
  const a=await f.pool.open(owner),b=await f.pool.open(other);
  try{
    const grant=await f.pool.grantObserver(owner,a.lease,auditor,{ttlSeconds:60});
    assert.equal(grant.canInput,false);
    assert.equal(grant.canAcquireFocus,false);
    assert.throws(()=>f.pool.readObserver(auditor,grant.viewerToken),
      /NATIVE_WORKSPACE_FRAME_UNAVAILABLE/);
    await assert.rejects(f.pool.grantObserver(other,a.lease,auditor),
      /NATIVE_WORKSPACE_LEASE_DENIED/);
    const av=await f.pool.observeOwner(owner,a.lease);
    const seen=f.pool.readObserver(auditor,grant.viewerToken);
    assert.equal(seen.frameRevision,av.revision);
    assert.equal(seen.stale,false);
    assert.throws(()=>f.pool.readObserver(supervisor,grant.viewerToken),
      /NATIVE_WORKSPACE_OBSERVER_DENIED/);
    await f.pool.inputOwner(owner,a.lease,{kind:'click',x:8,y:8},
      {expectedRevision:av.revision});
    assert.equal(f.pool.readObserver(auditor,grant.viewerToken).stale,true);
    assert.equal(f.workers[1].viewed,0);
    assert.deepEqual(f.pool.revokeObserver(owner,a.lease,grant.viewerToken),
      {revoked:true,canInput:false});
    assert.throws(()=>f.pool.readObserver(auditor,grant.viewerToken),
      /NATIVE_WORKSPACE_OBSERVER_DENIED/);
  }finally{await f.pool.close();}
});

test('grant authorizer exception cannot issue observer or operator token',async()=>{
  const f=fixture({authorizeObserver:()=>{throw Error('secret');},
    authorizeHandoff:()=>{throw Error('secret');}});
  const a=await f.pool.open(owner);
  try{
    await assert.rejects(f.pool.grantObserver(owner,a.lease,auditor),
      /NATIVE_WORKSPACE_OBSERVER_DENIED/);
    await assert.rejects(f.pool.beginHandoff(owner,a.lease,supervisor),
      /NATIVE_WORKSPACE_HANDOFF_DENIED/);
  }finally{await f.pool.close();}
});

test('selected human handoff pauses owner only, requires operator and resumed-agent re-observation',async()=>{
  const f=fixture({authorizeObserver:()=>true,
    authorizeHandoff:()=>true});
  const a=await f.pool.open(owner),b=await f.pool.open(other);
  try{
    const av=await f.pool.observeOwner(owner,a.lease);
    const bv=await f.pool.observeOwner(other,b.lease);
    const handoff=await f.pool.beginHandoff(owner,a.lease,supervisor);
    await assert.rejects(f.pool.inputOwner(owner,a.lease,{kind:'type',text:'blocked'},
      {expectedRevision:av.revision}),/NATIVE_WORKSPACE_CONTROL_HELD/);
    assert.throws(()=>f.pool.endHandoff(auditor,handoff.controlToken),
      /NATIVE_WORKSPACE_CONTROL_DENIED/);
    await assert.rejects(f.pool.inputOperator(auditor,handoff.controlToken,
      {kind:'type',text:'denied'},{expectedRevision:av.revision}),
      /NATIVE_WORKSPACE_CONTROL_DENIED/);
    const operatorView=await f.pool.observeOperator(supervisor,handoff.controlToken);
    assert.equal(operatorView.ownerInputPaused,true);
    const otherAction=await f.pool.inputOwner(other,b.lease,
      {kind:'type',text:'OTHER_UNTOUCHED'},
      {expectedRevision:bv.revision});
    assert.equal(otherAction.submitted,true);
    const controlled=await f.pool.inputOperator(supervisor,handoff.controlToken,
      {kind:'type',text:'ONLY_A'}, {expectedRevision:operatorView.revision});
    assert.equal(controlled.submitted,true);
    assert.equal(f.workers[0].typed.at(-1).text,'ONLY_A');
    assert.equal(f.workers[1].typed.at(-1).text,'OTHER_UNTOUCHED');
    await assert.rejects(f.pool.inputOperator(supervisor,handoff.controlToken,
      {kind:'type',text:'UNOBSERVED'},{expectedRevision:operatorView.revision}),
      /NATIVE_WORKSPACE_REOBSERVATION_REQUIRED/);
    // Even owner's observation under an active handoff grants no input.
    await f.pool.observeOwner(owner,a.lease);
    await assert.rejects(f.pool.inputOwner(owner,a.lease,
      {kind:'click',x:1,y:2},{expectedRevision:controlled.revision}),
      /NATIVE_WORKSPACE_CONTROL_HELD/);
    assert.equal(f.pool.endHandoff(supervisor,handoff.controlToken).ownerReobserveRequired,true);
    await assert.rejects(f.pool.inputOwner(owner,a.lease,{kind:'click',x:1,y:2},
      {expectedRevision:controlled.revision}),
      /NATIVE_WORKSPACE_REOBSERVATION_REQUIRED/);
    const after=await f.pool.observeOwner(owner,a.lease);
    assert.equal((await f.pool.inputOwner(owner,a.lease,
      {kind:'click',x:1,y:2},{expectedRevision:after.revision})).submitted,true);
  }finally{await f.pool.close();}
});

test('operator grant expiry never grants owner silent takeover; observer TTL expires',async()=>{
  let timestamp=1_000;
  const f=fixture({clock:()=>timestamp,authorizeHandoff:()=>true,
    authorizeObserver:()=>true});
  const a=await f.pool.open(owner,{ttlSeconds:90});
  try{
    const vg=await f.pool.grantObserver(owner,a.lease,auditor,{ttlSeconds:10});
    const hg=await f.pool.beginHandoff(owner,a.lease,supervisor,{ttlSeconds:10});
    timestamp+=11_000;
    assert.throws(()=>f.pool.readObserver(auditor,vg.viewerToken),
      /NATIVE_WORKSPACE_OBSERVER_DENIED/);
    assert.throws(()=>f.pool.endHandoff(supervisor,hg.controlToken),
      /NATIVE_WORKSPACE_CONTROL_DENIED/);
    await assert.rejects(f.pool.inputOwner(owner,a.lease,{kind:'click',x:1,y:1},
      {expectedRevision:0}),/NATIVE_WORKSPACE_REOBSERVATION_REQUIRED/);
    const next=await f.pool.observeOwner(owner,a.lease);
    assert.equal((await f.pool.inputOwner(owner,a.lease,{kind:'click',x:1,y:1},
      {expectedRevision:next.revision})).submitted,true);
  }finally{await f.pool.close();}
});

test('last expired observer grant releases cached screenshot bytes',async()=>{
  let timestamp=2_000;
  const f=fixture({clock:()=>timestamp,authorizeObserver:()=>true});
  const a=await f.pool.open(owner);
  try{
    const grant=await f.pool.grantObserver(owner,a.lease,auditor,{ttlSeconds:10});
    await f.pool.observeOwner(owner,a.lease);
    assert.ok(f.pool.readObserver(auditor,grant.viewerToken).data);
    timestamp+=11_000;
    assert.throws(()=>f.pool.readObserver(auditor,grant.viewerToken),
      /NATIVE_WORKSPACE_OBSERVER_DENIED/);
    // No API path can access the expired raw frame after grant removal.
    assert.equal(f.pool.status(owner).ownedWorkspaces,1);
    await assert.rejects(f.pool.grantObserver(other,a.lease,auditor),
      /NATIVE_WORKSPACE_LEASE_DENIED/);
    const replacement=await f.pool.grantObserver(owner,a.lease,auditor);
    assert.throws(()=>f.pool.readObserver(auditor,replacement.viewerToken),
      /NATIVE_WORKSPACE_FRAME_UNAVAILABLE/);
  }finally{await f.pool.close();}
});

test('unknown native effect latches only affected workspace with no replay',async()=>{
  const f=fixture({workerSetup:name=>name==='worker-1'?
    {onInput:async()=>{throw Error('Native returned ambiguous response');}}:{}});
  const a=await f.pool.open(owner),b=await f.pool.open(other);
  try{
    const av=await f.pool.observeOwner(owner,a.lease);
    const bv=await f.pool.observeOwner(other,b.lease);
    await assert.rejects(f.pool.inputOwner(owner,a.lease,
      {kind:'click',x:1,y:1},{expectedRevision:av.revision}),
      /NATIVE_WORKSPACE_NATIVE_OUTCOME_UNKNOWN/);
    await assert.rejects(f.pool.inputOwner(owner,a.lease,
      {kind:'click',x:1,y:1},{expectedRevision:av.revision}),
      /NATIVE_WORKSPACE_UNCERTAIN_NO_REPLAY/);
    assert.equal((await f.pool.inputOwner(other,b.lease,
      {kind:'click',x:5,y:5},{expectedRevision:bv.revision})).submitted,true);
  }finally{await f.pool.close();}
});

test('non-data action properties fail closed before any native dispatch',async()=>{
  const f=fixture();
  const a=await f.pool.open(owner);
  try{
    const view=await f.pool.observeOwner(owner,a.lease);
    const click={kind:'click',x:15,y:20};
    Object.defineProperty(click,'x',{enumerable:true,
      get(){return 15;}});
    await assert.rejects(f.pool.inputOwner(owner,a.lease,click,
      {expectedRevision:view.revision,operationId:'accessor-click'}),
      /NATIVE_WORKSPACE_ACTION_INVALID/);
    let reads=0;
    const from={y:16};
    Object.defineProperty(from,'x',{enumerable:true,get(){
      // Old validator read safe coordinates repeatedly, then dispatched a
      // different point on its final spread. No untrusted getter may run.
      return ++reads<=4?15:-500;
    }});
    await assert.rejects(f.pool.inputOwner(owner,a.lease,{
      kind:'drag',from,to:{x:85,y:90},durationMs:240
    },{expectedRevision:view.revision,operationId:'accessor-drag'}),
    /NATIVE_WORKSPACE_ACTION_INVALID/);
    assert.equal(reads,0,'do not execute untrusted native-action getters');
    assert.equal(f.workers[0].typed.length,0);
  }finally{await f.pool.close();}
});

test('claimed MCP client identity never authorizes a native workspace by default',async()=>{
  let launches=0;
  const pool=createNativeWorkspaceCoordinator({
    launchWorkspace:async()=>{launches++;throw Error('SHOULD_NOT_RUN');}
  });
  try{
    await assert.rejects(pool.open({
      profile:'default',subject:'forged-user',conversationId:'forged-chat',
      authenticated:true,conversationBound:true,
      _meta:{'io.modelcontextprotocol/clientInfo':{
        name:'ChatGPT',version:'999.0'},chatId:'forged-chat'}
    }),/NATIVE_WORKSPACE_IDENTITY_UNVERIFIED/);
    assert.equal(launches,0);
  }finally{await pool.close();}
});

test('private input never accepts DISPLAY, environment, shell or unknown action kinds',async()=>{
  const f=fixture();
  const a=await f.pool.open(owner);
  try{
    const obs=await f.pool.observeOwner(owner,a.lease);
    for(const bad of [
      {kind:'type',text:'x',display:':0'},
      {kind:'click',x:0,y:0,env:{DISPLAY:':0'}},
      {kind:'shell',command:'never'},
      {kind:'scroll',XAUTHORITY:'/tmp/fake'},
      null
    ]){
      await assert.rejects(f.pool.inputOwner(owner,a.lease,bad,
        {expectedRevision:obs.revision}),/NATIVE_WORKSPACE_(TARGET_OVERRIDE_DENIED|ACTION_INVALID)/);
    }
    assert.equal(f.workers[0].typed.length,0);
  }finally{await f.pool.close();}
});

test('atomic drag uses workspace lease, fresh frame, journal and strict native shape',async()=>{
  const f=fixture();
  const a=await f.pool.open(owner),b=await f.pool.open(other);
  try{
    const view=await f.pool.observeOwner(owner,a.lease);
    const bad=[
      {kind:'drag',from:{x:3,y:4},to:{x:80,y:40},durationMs:0},
      {kind:'drag',from:{x:3,y:4},to:{x:3,y:4},durationMs:240},
      {kind:'drag',from:{x:-1,y:4},to:{x:80,y:40},durationMs:240},
      {kind:'drag',from:{x:3,y:4},to:{x:80,y:40},durationMs:240,DISPLAY:':0'},
      {kind:'drag',from:{x:3,y:4,DISPLAY:':0'},to:{x:80,y:40},durationMs:240},
      {kind:'drag',from:{x:3,y:4},to:{x:80,y:40},durationMs:240,button:4},
      {kind:'drag',fromX:3,fromY:4,toX:80,toY:40,durationMs:240},
      {kind:'mousedown',button:1}
    ];
    for(const action of bad)await assert.rejects(
      f.pool.inputOwner(owner,a.lease,action,
        {expectedRevision:view.revision,operationId:'invalid-drag'}),
      /NATIVE_WORKSPACE_(TARGET_OVERRIDE_DENIED|ACTION_INVALID)/);
    assert.equal(f.workers[0].typed.length,0);
    const drag={kind:'drag',from:{x:3,y:4},to:{x:80,y:40},durationMs:240};
    await assert.rejects(f.pool.inputOwner(other,a.lease,drag,
      {expectedRevision:view.revision,operationId:'wrong-owner-drag'}),
      /NATIVE_WORKSPACE_LEASE_DENIED/);
    const received=await f.pool.inputOwner(owner,a.lease,drag,
      {expectedRevision:view.revision,operationId:'one-atomic-drag'});
    assert.equal(received.submitted,true);
    assert.deepEqual(f.workers[0].typed,[drag]);
    assert.equal(f.workers[1].typed.length,0);
    await assert.rejects(f.pool.inputOwner(owner,a.lease,drag,
      {expectedRevision:view.revision,operationId:'second-drag'}),
      /NATIVE_WORKSPACE_REOBSERVATION_REQUIRED/);
    const fresh=await f.pool.observeOwner(owner,a.lease);
    await assert.rejects(f.pool.inputOwner(owner,a.lease,drag,
      {expectedRevision:fresh.revision,operationId:'one-atomic-drag'}),
      /NATIVE_WORKSPACE_DUPLICATE_OPERATION_NO_DISPATCH/);
    assert.equal(f.workers[0].typed.length,1);
    const bv=await f.pool.observeOwner(other,b.lease);
    const otherDrag=await f.pool.inputOwner(other,b.lease,drag,
      {expectedRevision:bv.revision,operationId:'independent-drag'});
    assert.equal(otherDrag.submitted,true);
    assert.equal(f.workers[1].typed.length,1);
  }finally{await f.pool.close();}
});

test('busy workspace cannot be closed and Core close drains accepted input',async()=>{
  const accepted=deferred(),finish=deferred();
  const f=fixture({workerSetup:()=>({onInput:async()=>{
    accepted.resolve();
    await finish.promise;
    return {submitted:true};
  }})});
  const a=await f.pool.open(owner);
  const observed=await f.pool.observeOwner(owner,a.lease);
  const input=f.pool.inputOwner(owner,a.lease,{kind:'click',x:10,y:10},
    {expectedRevision:observed.revision});
  await accepted.promise;
  await assert.rejects(f.pool.end(owner,a.lease),/NATIVE_WORKSPACE_BUSY/);
  const draining=f.pool.close();
  await assert.rejects(f.pool.open(owner),/NATIVE_WORKSPACE_POOL_CLOSED/);
  assert.equal(f.workers[0].closes,0);
  finish.resolve();
  assert.equal((await input).submitted,true);
  await draining;
  assert.equal(f.workers[0].closes,1);
});

test('cleanup failure remains a failed gate, not success or reusable capacity',async()=>{
  const f=fixture({capacity:1,workerSetup:()=>({onClose:async()=>{
    throw Error('Synthetic teardown failure');
  }})});
  const a=await f.pool.open(owner);
  await assert.rejects(f.pool.end(owner,a.lease),
    /NATIVE_WORKSPACE_CLEANUP_FAILED/);
  assert.equal(f.pool.status(owner).availableSlots,0);
  await assert.rejects(f.pool.close(),/NATIVE_WORKSPACE_POOL_CLEANUP_FAILED/);
});

test('two chats under the same account are distinct trusted lease owners',async()=>{
  const f=fixture();
  const first={verified:true,subject:'same-profile',conversationId:'chat-1'};
  const second={verified:true,subject:'same-profile',conversationId:'chat-2'};
  const a=await f.pool.open(first),b=await f.pool.open(second);
  try{
    await assert.rejects(f.pool.observeOwner(second,a.lease),/NATIVE_WORKSPACE_LEASE_DENIED/);
    await assert.rejects(f.pool.end(first,b.lease),/NATIVE_WORKSPACE_LEASE_DENIED/);
    const [av,bv]=await Promise.all([
      f.pool.observeOwner(first,a.lease),f.pool.observeOwner(second,b.lease)
    ]);
    assert.notEqual(av.frame.data,bv.frame.data);
  }finally{await f.pool.close();}
});

test('claimed principal without trusted conversation binding cannot open a workspace',async()=>{
  const pool=createNativeWorkspaceCoordinator({
    identityResolver:()=>({authenticated:true,subject:'profile',conversationBound:false,
      conversationId:'caller-claimed-id'})
  });
  await assert.rejects(pool.open(owner),/NATIVE_WORKSPACE_IDENTITY_UNVERIFIED/);
  await pool.close();
});

test('duplicate native display/pid is refused without closing the active workspace',async()=>{
  let builds=0,closes=0;
  const pool=createNativeWorkspaceCoordinator({
    identityResolver:verified,capacity:2,
    launchWorkspace:async()=>{
      builds++;
      return {
        kind:'native-private-x11',physicalDesktopInput:false,
        displayId:':1855',serverPid:60555,
        observe:async()=>({frame:frame('dup',builds)}),
        input:async()=>({submitted:true}),
        close:async()=>{closes++;}
      };
    }
  });
  const first=await pool.open(owner);
  try{
    await assert.rejects(pool.open(other),/NATIVE_WORKSPACE_TARGET_COLLISION/);
    assert.equal(pool.status(owner).ownedWorkspaces,1);
    assert.equal((await pool.observeOwner(owner,first.lease)).revision,0);
  }finally{
    await assert.rejects(pool.close(),/NATIVE_WORKSPACE_POOL_CLEANUP_FAILED/);
  }
  assert.equal(closes,1,'Duplicate target must NOT close the active server');
});

test('pending open reserves token and rejects collision before native worker is launched',async()=>{
  const waiting=deferred(),started=deferred();
  let launchCalls=0;
  const pool=createNativeWorkspaceCoordinator({
    capacity:2,identityResolver:verified,token:()=> 'f'.repeat(64),
    launchWorkspace:async()=>{
      launchCalls++;
      started.resolve();
      await waiting.promise;
      return {kind:'native-private-x11',physicalDesktopInput:false,
        displayId:':1856',serverPid:60556,
        observe:async()=>({frame:frame('one',0)}),
        input:async()=>({submitted:true}),
        close:async()=>{}};
    }
  });
  const first=pool.open(owner);
  await started.promise;
  await assert.rejects(pool.open(other),/NATIVE_WORKSPACE_LEASE_COLLISION/);
  assert.equal(launchCalls,1);
  waiting.resolve();
  const a=await first;
  await pool.end(owner,a.lease);
  await pool.close();
});

test('forged PNG framing cannot become a fresh observation or unlock native input',async()=>{
  const f=fixture({workerSetup:()=>({
    onObserve:async()=>({frame:{mimeType:'image/png',
      data:Buffer.from('not-a-PNG').toString('base64')}})
  })});
  const a=await f.pool.open(owner);
  try{
    await assert.rejects(f.pool.observeOwner(owner,a.lease),/NATIVE_WORKSPACE_FRAME_INVALID/);
    await assert.rejects(f.pool.inputOwner(owner,a.lease,{kind:'click',x:1,y:1},
      {expectedRevision:0}),/NATIVE_WORKSPACE_REOBSERVATION_REQUIRED/);
  }finally{await f.pool.close();}
});

test('production Core has no implicit native-workspace QA auto-activation',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../src/server-v0.3.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/native-workspace-coordinator/);
  // A successful test/metadata discovery does not install a native worker.
  const pool=createNativeWorkspaceCoordinator({identityResolver:verified});
  await assert.rejects(pool.open(owner),/NATIVE_WORKSPACE_BACKEND_UNCONFIGURED/);
  await pool.close();
});

test('real GUI input is denied without an explicit durable journal binding',async()=>{
  let nativeInputs=0,closed=0;
  const pool=createNativeWorkspaceCoordinator({
    identityResolver:verified,
    launchWorkspace:async()=>({
      kind:'native-private-x11',physicalDesktopInput:false,
      displayId:':1858',serverPid:60558,
      observe:async()=>({frame:frame('default-deny',0)}),
      input:async()=>{nativeInputs++;return {submitted:true};},
      close:async()=>{closed++;}
    })
  });
  const a=await pool.open(owner);
  const seen=await pool.observeOwner(owner,a.lease);
  await assert.rejects(pool.inputOwner(owner,a.lease,
    {kind:'click',x:3,y:4},
    {expectedRevision:seen.revision,operationId:'caller-stable-action'}),
    /NATIVE_WORKSPACE_DURABLE_JOURNAL_REQUIRED/);
  assert.equal(nativeInputs,0);
  await pool.close();
  assert.equal(closed,1);
});

test('a stable action id cannot silently repeat after a new observation',async()=>{
  const f=fixture();
  const a=await f.pool.open(owner);
  try{
    const first=await f.pool.observeOwner(owner,a.lease);
    await f.pool.inputOwner(owner,a.lease,{kind:'key',key:'Return'},
      {expectedRevision:first.revision,operationId:'same-logical-action'});
    const second=await f.pool.observeOwner(owner,a.lease);
    await assert.rejects(f.pool.inputOwner(owner,a.lease,
      {kind:'key',key:'Return'},
      {expectedRevision:second.revision,operationId:'same-logical-action'}),
      /NATIVE_WORKSPACE_DUPLICATE_OPERATION_NO_DISPATCH/);
    assert.equal(f.workers[0].typed.length,1);
  }finally{await f.pool.close();}
});

test('failed durable pre-dispatch Intent blocks only affected workspace',async()=>{
  let journals=0,nativeA=0,nativeB=0;
  const f=fixture({
    durableJournalFactory:async()=>{
      journals++;
      if(journals===1)return {
        prepare:async()=>{throw Error('disk sync refused');},
        acknowledge:async()=>{},
        inspect:async()=>({releaseAuthorized:false})
      };
      return {
        prepare:async()=>({valid:true}),
        acknowledge:async()=>({submitted:true}),
        inspect:async()=>({releaseAuthorized:false})
      };
    },
    workerSetup:name=>name==='worker-1'
      ? {onInput:async()=>{nativeA++;return {submitted:true};}}
      : {onInput:async()=>{nativeB++;return {submitted:true};}}
  });
  const a=await f.pool.open(owner),b=await f.pool.open(other);
  try{
    const [av,bv]=await Promise.all([
      f.pool.observeOwner(owner,a.lease),f.pool.observeOwner(other,b.lease)
    ]);
    await assert.rejects(f.pool.inputOwner(owner,a.lease,
      {kind:'key',key:'Return'},
      {expectedRevision:av.revision,operationId:'write-denied'}),
      /NATIVE_WORKSPACE_JOURNAL_UNAVAILABLE_NO_INPUT/);
    assert.equal(nativeA,0);
    await assert.rejects(f.pool.inputOwner(owner,a.lease,
      {kind:'key',key:'Return'},
      {expectedRevision:av.revision,operationId:'blind-retry'}),
      /NATIVE_WORKSPACE_UNCERTAIN_NO_REPLAY/);
    assert.equal((await f.pool.inputOwner(other,b.lease,
      {kind:'key',key:'Return'},
      {expectedRevision:bv.revision,operationId:'other-workspace'})).submitted,true);
    assert.equal(nativeB,1);
  }finally{await f.pool.close();}
});

test('post-native ACK failure leaves workspace uncertain and never replays',async()=>{
  let inputs=0;
  const f=fixture({
    durableJournalFactory:async()=>({
      prepare:async()=>({intent:true}),
      acknowledge:async()=>{throw Error('lost durable ack');},
      inspect:async()=>({releaseAuthorized:false})
    }),
    workerSetup:()=>({onInput:async()=>{inputs++;return {submitted:true};}})
  });
  const a=await f.pool.open(owner);
  try{
    const view=await f.pool.observeOwner(owner,a.lease);
    await assert.rejects(f.pool.inputOwner(owner,a.lease,
      {kind:'key',key:'Return'},
      {expectedRevision:view.revision,operationId:'exact-action'}),
      /NATIVE_WORKSPACE_NATIVE_OUTCOME_UNKNOWN/);
    assert.equal(inputs,1);
    await assert.rejects(f.pool.inputOwner(owner,a.lease,
      {kind:'key',key:'Return'},
      {expectedRevision:view.revision,operationId:'exact-action'}),
      /NATIVE_WORKSPACE_UNCERTAIN_NO_REPLAY/);
    assert.equal(inputs,1);
  }finally{await f.pool.close();}
});
