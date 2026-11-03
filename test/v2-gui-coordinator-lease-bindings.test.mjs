import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {V2CentralCoordinator} from '../src/v2-central-coordinator.mjs';
import {createV2GuiCoordinatorLeaseBindings} from '../src/v2-gui-coordinator-lease-bindings.mjs';
import {createV2NativeGuiOwnerWorker} from '../src/v2-native-gui-owner-worker.mjs';
import {V2GrantRegistry} from '../src/v2-grant-registry.mjs';
import {MutationIdempotencyStore} from '../src/mutation-idempotency.mjs';
import {v2ResourceLeaseKey} from '../src/v2-routing-contract.mjs';

const route=(chat='a',op='op')=>({
 hostId:'host-qa',principalId:'owner',profileId:'profile',
 conversationId:chat,operationId:op,
 target:{kind:'app-window',id:'window1'}
});
function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'v2-gui-fence-'));
 let now=100000,active={sessionHandle:'session-a',route:route()},effect=0;
 const routes=new Map([['session-a',route()],['session-b',route('b','opb')]]);
 const sessions={
  resolveNativeRoute:async h=>{
   const result=routes.get(h);
   if(!result)throw Object.assign(Error('V2_SESSION_NOT_BOUND'),{code:'V2_SESSION_NOT_BOUND'});
   return result;
  }
 };
 const coordinator=()=>new V2CentralCoordinator({
  directory:path.join(directory,'central'),now:()=>now,
  authorizeLease:async()=>true
 });
 const c=coordinator(),c2=coordinator();
 const calls=[];
 const provider={
  async probe(){return {supported:true,targetBound:true}},
  async observe(targetId){return {
   targetId,hostId:'host-qa',principalId:'owner',seatId:'seat',
   pid:234,windowHandle:'win',processStartId:'gen',present:true
  }},
  async readAccessibility(){return {elements:[{id:'apply',role:'button',name:'Apply',enabled:true}]}},
  async authorizeElement(){return true},
  async apply(){calls.push('native-apply');effect++;return {dispatched:true}},
  async verify(){return effect>0}
 };
 const identity=async()=>active;
 const ownerProviders=async()=>({platform:'linux',providers:{atspi:provider}});
 const lease=createV2GuiCoordinatorLeaseBindings({
  coordinator:c,sessions,resolveTrustedInvocation:identity,ownerProviders,ttlMs:1000
 });
 const grants=new V2GrantRegistry({
  directory:path.join(directory,'grants'),authorizeAdministration:({actor})=>actor==='qa'
 });
 const receipts=new MutationIdempotencyStore({
  directory:path.join(directory,'receipts'),scope:'owner-fence'
 });
 const worker=createV2NativeGuiOwnerWorker({
  resolveTrustedInvocation:identity,sessions,grants,
  withLease:lease.withLease,ownerProviders:lease.ownerProviders,
  receiptStore:receipts,
  ownerSeat:async()=> 'seat',
  authorizeNativeSession:async()=>true,
  authorizeWindow:async()=>true
 });
 function allow(r,tool){
  grants.change({route:r,tool,status:'ENABLED',
   expectedRevision:0,actor:'qa',reason:'owner-authorized fixture'});
 }
 return {directory,lease,c,c2,sessions,worker,grants,allow,receipts,calls,
  route,identity,ownerProviders,
  setActive:x=>{active=x},setRoute:(h,r)=>routes.set(h,r),
  setNow:x=>{now=x},advance:n=>now+=n,
  get effect(){return effect},
  close(){receipts.close();grants.close();c.close();c2.close();
   fs.rmSync(directory,{recursive:true,force:true})}
 };
}
test('actual central SQLite fence controls owner worker and idempotent GUI effect',async()=>{
 const f=fixture();try{
  const observeRoute=route('a','observe-op');
  const invokeRoute=route('a','invoke-op');
  const a='workspace_window_';
  f.allow(observeRoute,a+'observe');f.allow(invokeRoute,a+'invoke');
  f.setRoute('session-a',observeRoute);
  f.setActive({sessionHandle:'session-a',route:observeRoute});
  const read=await f.worker.execute({action:'observe'});
  assert.equal(read.status,'OBSERVED');
  f.setRoute('session-a',invokeRoute);
  f.setActive({sessionHandle:'session-a',route:invokeRoute});
  const output=await f.worker.execute({action:'invoke',elementId:'apply'});
  assert.equal(output.status,'VERIFIED');
  assert.equal(f.effect,1);
  assert.deepEqual(await f.worker.execute({action:'invoke',elementId:'apply'}),output);
  assert.equal(f.effect,1);
  const lease=await f.c2.acquire({route:route('b','fresh')});
  assert.ok(lease.fence>=3);
  await f.c2.release({route:route('b','fresh'),lease});
 }finally{f.close()}
});
test('no physical effect can run outside actual coordinator lease',async()=>{
 const f=fixture();try{
  const selection=await f.lease.ownerProviders({route:route(),sessionHandle:'session-a'});
  await assert.rejects(selection.providers.atspi.apply({action:'invoke'}),
   {code:'V2_GUI_COORDINATOR_EFFECT_WITHOUT_LEASE'});
  assert.equal(f.effect,0);
 }finally{f.close()}
});
test('two independent coordinator clients serialize shared app window, no reentry effect',async()=>{
 const f=fixture();let release,started;const hold=new Promise(r=>release=r);
 const entered=new Promise(r=>started=r);
 try{
  const a=f.lease.withLease(v2ResourceLeaseKey(route()),async()=>{started();return hold});
  await entered;
  const other=createV2GuiCoordinatorLeaseBindings({
   coordinator:f.c2,sessions:f.sessions,ownerProviders:f.ownerProviders,
   resolveTrustedInvocation:async()=>({sessionHandle:'session-b',route:route('b','opb')}),
   ttlMs:1000
  });
  let ran=false;
  await assert.rejects(other.withLease(v2ResourceLeaseKey(route('b','opb')),
   async()=>{ran=true}),{code:'GUI_LEASE_BUSY'});
  assert.equal(ran,false);
  release();
  await a;
  assert.equal(f.effect,0);
 }finally{release?.();f.close()}
});
test('expired coordinator fence rejects before any actual GUI effect',async()=>{
 const f=fixture();try{
  const provider=await f.lease.ownerProviders({route:route(),sessionHandle:'session-a'});
  await assert.rejects(f.lease.withLease(v2ResourceLeaseKey(route()),async()=>{
   f.advance(1001);
   await provider.providers.atspi.apply({action:'invoke'});
  }),{code:'V2_COORDINATOR_STALE_LEASE'});
  assert.equal(f.effect,0);
 }finally{f.close()}
});
test('replaced session identity refuses effect with still-current lease',async()=>{
 const f=fixture();try{
  const provider=await f.lease.ownerProviders({route:route(),sessionHandle:'session-a'});
  await assert.rejects(f.lease.withLease(v2ResourceLeaseKey(route()),async()=>{
   f.setActive({sessionHandle:'session-b',route:route('b','opb')});
   await provider.providers.atspi.apply({action:'invoke'});
  }),{code:'V2_GUI_COORDINATOR_SESSION_CHANGED'});
  assert.equal(f.effect,0);
 }finally{f.close()}
});
test('wrong lease key, missing attestation, wrong provider route fail closed',async()=>{
 const f=fixture();try{
  await assert.rejects(f.lease.withLease('forged-key',async()=>{}),
   {code:'V2_GUI_COORDINATOR_RESOURCE_MISMATCH'});
  await assert.rejects(f.lease.ownerProviders({
   route:route('b','opb'),sessionHandle:'session-a'}),
   {code:'V2_GUI_COORDINATOR_PROVIDER_SCOPE_CHANGED'});
  f.setActive(null);
  await assert.rejects(f.lease.withLease(v2ResourceLeaseKey(route()),async()=>{}),
   {code:'V2_GUI_COORDINATOR_NATIVE_INVOCATION_REQUIRED'});
  assert.equal(f.effect,0);
 }finally{f.close()}
});
test('a different chat cannot reuse another chat provider under its valid lease',async()=>{
 const f=fixture();try{
  const provider=await f.lease.ownerProviders({route:route(),sessionHandle:'session-a'});
  f.setActive({sessionHandle:'session-b',route:route('b','opb')});
  await assert.rejects(f.lease.withLease(v2ResourceLeaseKey(route('b','opb')),
   async()=>provider.providers.atspi.apply({action:'invoke'})),
   {code:'V2_GUI_COORDINATOR_EFFECT_WITHOUT_LEASE'});
  assert.equal(f.effect,0);
 }finally{f.close()}
});
test('unsafe construction or missing coordinator methods cannot create permissive binding',()=>{
 assert.throws(()=>createV2GuiCoordinatorLeaseBindings({}),
  {code:'V2_GUI_COORDINATOR_TRUSTED_BOOTSTRAP_REQUIRED'});
});


test('BUSY thrown after lease callback admission is never classified retry-safe',async()=>{
 const current=route(),resource=v2ResourceLeaseKey(current);
 let invoked=0;
 const source=createV2GuiCoordinatorLeaseBindings({
  coordinator:{withFencedLease:async({run})=>{
   await run({lease:{id:'qa-lease',fence:1},
    assertCurrent:async()=>true});
   throw Object.assign(Error('effect already entered'),{
    code:'V2_COORDINATOR_RESOURCE_BUSY'});
  }},
  resolveTrustedInvocation:async()=>({sessionHandle:'qa-current',route:current}),
  sessions:{resolveNativeRoute:async()=>current},
  ownerProviders:async()=>({platform:'linux',providers:{}})
 });
 await assert.rejects(source.withLease(resource,async()=>{invoked++}),
  {code:'V2_COORDINATOR_RESOURCE_BUSY'});
 assert.equal(invoked,1);
});
