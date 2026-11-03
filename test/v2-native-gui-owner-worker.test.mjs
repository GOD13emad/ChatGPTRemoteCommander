import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createV2NativeGuiOwnerWorker} from '../src/v2-native-gui-owner-worker.mjs';
import {createV2NativeOwnerSessionBindings} from '../src/v2-native-owner-session-bindings.mjs';
import {createV2LinuxAtspiProvider} from '../src/v2-linux-atspi-provider.mjs';
import {V2GrantRegistry} from '../src/v2-grant-registry.mjs';
import {MutationIdempotencyStore} from '../src/mutation-idempotency.mjs';

const target={
 targetId:'window-qa',hostId:'host-qa',principalId:'owner-qa',seatId:'seat-qa',
 pid:1023,windowHandle:'window-1',processStartId:'generation-5',
 processStartTicks:'113388',applicationName:'QA.App',
 windowTitle:'QA Window',present:true
};
const route=(operationId,chat='chat-qa')=>({
 hostId:target.hostId,principalId:target.principalId,
 profileId:'profile-qa',conversationId:chat,operationId,
 target:{kind:'app-window',id:target.targetId}
});
function fixture({verified=true}={}){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'native-gui-worker-'));
 let nativeCalls=0,applied=false,seat='seat-qa',consent=true,
  current='observation-handle',nativeResolution=0,leaseCalls=0,
  platformValid=verified,enableNative=true;
 const handles=new Map([
  ['observation-handle',route('op-observe-1')],
  ['mutation-handle',route('op-invoke-1')]
 ]);
 const sessions=createV2NativeOwnerSessionBindings({
  attestPlatformSession:async p=>(platformValid&&p?.trusted===true&&handles.has(p.handle))?p.handle:null,
  resolveOwnerRoute:async handle=>handles.get(handle),
  observedNativeSession:async()=>seat,
  authorizeBinding:async()=>consent,
  authorizeRevocation:async({adminProof})=>adminProof==='owner',
  ttlMs:60000
 });
 const grants=new V2GrantRegistry({
  directory:path.join(folder,'grants'),authorizeAdministration:({actor})=>actor==='owner-admin'
 });
 const receipts=new MutationIdempotencyStore({directory:path.join(folder,'receipts'),scope:'owner-qa'});
 const provider=createV2LinuxAtspiProvider({
  resolveTarget:async()=>({...target}),
  transport:async input=>{
   nativeCalls++;
   if(input.command==='snapshot')return {
    ok:true,valuesRead:false,truncated:false,
    controls:[{path:[1],role:'push button',name:'Apply',
     editable:false,action:'click'}]
   };
   if(input.command==='invoke'){
    applied=true;return {ok:true,effect:'DISPATCHED'};
   }
   throw Error('unsupported fixture native action');
  },
  independentProof:async()=>applied
 });
 const worker=createV2NativeGuiOwnerWorker({
  resolveTrustedInvocation:async()=>({sessionHandle:current,route:handles.get(current)}),
  sessions,grants,receiptStore:receipts,
  withLease:async(_key,work)=>{leaseCalls++;return work();},
  ownerSeat:async()=>seat,
  authorizeNativeSession:async()=>consent,
  authorizeWindow:async()=>consent,
  ownerProviders:async()=>{nativeResolution++;if(!enableNative)throw Error('native not ready');
   return {platform:'linux',providers:{atspi:provider}};
  }
 });
 const grant=(kind,enabled=true)=>{
  const r=kind==='observe'?handles.get('observation-handle'):handles.get('mutation-handle');
  const tool='workspace_window_'+(kind==='observe'?'observe':'invoke');
  const existing=grants.read(r,tool);
  grants.change({route:r,tool,status:enabled?'ENABLED':'REVOKED',
   expectedRevision:existing?.revision??0,actor:'owner-admin',reason:'explicit owner fixture policy'});
 };
 const bind=async handle=>sessions.bindTrusted({trusted:true,handle});
 return {
  worker,grant,bind,
  choose:v=>{current=v},
  setSeat:v=>{seat=v},
  setConsent:v=>{consent=v},
  setVerified:v=>{platformValid=v},
  setNative:v=>{enableNative=v},
  route:handles,
  get nativeCalls(){return nativeCalls},
  get nativeResolution(){return nativeResolution},
  get leaseCalls(){return leaseCalls},
  get applied(){return applied},
  async close(){sessions.close();grants.close();receipts.close();
   fs.rmSync(folder,{recursive:true,force:true})}
 };
}
test('real bound session+durable grant+receipt -> owner worker observe -> invoke exactly once',async()=>{
 const f=fixture();
 try {
  await f.bind('observation-handle');await f.bind('mutation-handle');
  f.grant('observe');f.grant('invoke');
  const read=await f.worker.execute({action:'observe'});
  assert.equal(read.status,'OBSERVED');
  assert.equal(read.elements.length,1);
  const elementId=read.elements[0].id;
  f.choose('mutation-handle');
  const result=await f.worker.execute({action:'invoke',elementId});
  assert.equal(result.status,'VERIFIED');
  assert.equal(f.applied,true);
  const calls=f.nativeCalls;
  const replay=await f.worker.execute({action:'invoke',elementId});
  assert.deepEqual(replay,result);
  assert.ok(f.leaseCalls>=3);
  assert.equal(f.nativeCalls,calls); // no duplicate native effect
 } finally {await f.close()}
});
test('missing native-chat attestation cannot even build a GUI driver',async()=>{
 const f=fixture({verified:false});
 try{
  await assert.rejects(f.bind('observation-handle'),
   {code:'V2_SESSION_PLATFORM_ATTESTATION_REQUIRED'});
  await assert.rejects(f.worker.execute({action:'observe'}),
   {code:'V2_SESSION_NOT_BOUND'});
  assert.equal(f.nativeResolution,0);assert.equal(f.nativeCalls,0);
 }finally{await f.close()}
});
test('per-chat grant is required and revoked grant also blocks cached receipt',async()=>{
 const f=fixture();
 try{
  await f.bind('observation-handle');await f.bind('mutation-handle');
  await assert.rejects(f.worker.execute({action:'observe'}),{code:'V2_GRANT_REQUIRED'});
  assert.equal(f.nativeResolution,0);
  f.grant('observe');const read=await f.worker.execute({action:'observe'});
  f.choose('mutation-handle');
  await assert.rejects(f.worker.execute({action:'invoke',elementId:read.elements[0].id}),
   {code:'V2_GRANT_REQUIRED'});
  f.grant('invoke');
  assert.equal((await f.worker.execute({action:'invoke',elementId:read.elements[0].id})).status,'VERIFIED');
  const before=f.nativeCalls;
  f.grant('invoke',false);
  await assert.rejects(f.worker.execute({action:'invoke',elementId:read.elements[0].id}),
   {code:'V2_GRANT_REQUIRED'});
  assert.equal(f.nativeCalls,before);
 }finally{await f.close()}
});
test('revoked session or changed native seat denies before OS effect',async()=>{
 const f=fixture();
 try{
  await f.bind('observation-handle');await f.bind('mutation-handle');
  f.grant('observe');f.grant('invoke');
  const read=await f.worker.execute({action:'observe'});
  f.choose('mutation-handle');
  f.setSeat('different-seat');
  await assert.rejects(f.worker.execute({action:'invoke',elementId:read.elements[0].id}),
   {code:'V2_SESSION_TRUST_LOST'});
  assert.equal(f.applied,false);
  assert.equal(f.nativeResolution,1);
 }finally{await f.close()}
});
test('separate native consent check blocks even granted current session',async()=>{
 const f=fixture();
 try{
  await f.bind('observation-handle');f.grant('observe');f.setConsent(false);
  await assert.rejects(f.worker.execute({action:'observe'}),
   {code:'V2_GUI_OWNER_NATIVE_SCOPE_CONSENT_REQUIRED'});
  assert.equal(f.nativeCalls,0);
 }finally{await f.close()}
});
test('malformed operation and forged route fields never enter native provider',async()=>{
 const f=fixture();
 try{
  await f.bind('observation-handle');f.grant('observe');
  for(const input of [
   {action:'click',elementId:'button'},
   {action:'type',elementId:'fake',text:'x'},
   {action:'observe',elementId:'fake'},
   {action:'invoke',elementId:'../../escape'}
  ])await assert.rejects(f.worker.execute(input));
  assert.equal(f.applied,false);
 }finally{await f.close()}
});
test('attested worker never accepts caller-supplied host, route, chat or seat',async()=>{
 const f=fixture();
 try{
  await f.bind('observation-handle');f.grant('observe');
  await assert.rejects(f.worker.execute({action:'observe',route:route('forged','foreign'),
   sessionHandle:'forged',principalId:'foreign',seatId:'foreign'}),
   {code:'V2_GUI_OWNER_INPUT_INVALID'});
  assert.equal(f.nativeCalls,0);
  assert.equal(f.applied,false);
 }finally{await f.close()}
});
test('incomplete trusted dependency graph refuses worker bootstrap',()=>{
 assert.throws(()=>createV2NativeGuiOwnerWorker({}),{
  code:'V2_GUI_OWNER_WORKER_TRUSTED_DEPENDENCIES_REQUIRED'
 });
});
