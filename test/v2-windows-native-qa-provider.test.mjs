import test from 'node:test';
import assert from 'node:assert/strict';
import {createV2WindowsNativeQaProviders} from '../src/v2-windows-native-qa-provider.mjs';
import {createV2HybridNativeDriver} from '../src/v2-hybrid-native-driver.mjs';
import {executeV2NativeWindowAction} from '../src/v2-native-window-bridge.mjs';

const TARGET={targetId:'qa-win',hostId:'windows-host',principalId:'owner',
 seatId:'seat2',pid:7123,windowHandle:'100200',processStartId:'generation1',
 processStartTicks:'638977112123345678',windowTitle:'Commander V2 Native QA',present:true};
function setup({uia=true,success=true,proof=true}={}){
 const calls=[];let applied=0;
 const transport=async(mode,payload)=>{
  calls.push({mode,...payload});
  if(mode==='Probe')return {ok:true,pid:TARGET.pid,hwnd:TARGET.windowHandle,
   elementHandle:'200300',role:'button',name:'Apply',win32Bound:true,
   uiaInvokeAvailable:uia,targetBound:true};
  if(mode==='Invoke'){
   applied++;
   if(!success)throw Error('uncertain');
   return {ok:true,method:payload.method,effect:'DISPATCHED'};
  }
  throw Error('unknown method');
 };
 const providers=createV2WindowsNativeQaProviders({
  resolveTarget:async()=>({...TARGET}),transport,
  ...(proof?{independentProof:async()=>applied===1}:{})
 });
 const receipts=new Map();
 const route=(operationId='invoke1')=>({
  hostId:TARGET.hostId,principalId:TARGET.principalId,profileId:'p1',
  conversationId:'chat1',operationId,
  target:{kind:'app-window',id:TARGET.targetId}
 });
 const services=(action,elementId,operationId)=>({
  sessions:{resolveNativeRoute:async()=>route(operationId)},
  ownerSeat:async()=>TARGET.seatId,
  authorizeWindow:async()=>true,
  grants:{isAllowed:async()=>true},
  withLease:async(_key,fn)=>fn(),
  receiptStore:{execute:async({requestId},fn)=>{
   if(receipts.has(requestId))return receipts.get(requestId);
   const out=await fn();receipts.set(requestId,out);return out;
  }},
  nativeDriver:createV2HybridNativeDriver({platform:'windows',action,
   ...(elementId?{elementId}:{}),providers})
 });
 const observe=async()=>executeV2NativeWindowAction({
  route:route('observe1'),action:'observe',sessionHandle:'bound-qa',
  services:services('observe',undefined,'observe1')
 });
 const invoke=async elementId=>executeV2NativeWindowAction({
  route:route(),action:'invoke',elementId,sessionHandle:'bound-qa',
  services:services('invoke',elementId,'invoke1')
 });
 return {calls,observe,invoke,get applied(){return applied}};
}
test('owner-window UIA route completes Bridge with independent effect proof',async()=>{
 const f=setup({uia:true});
 const snapshot=await f.observe();assert.equal(snapshot.status,'OBSERVED');
 assert.equal(snapshot.elements[0].name,'Apply');
 const result=await f.invoke(snapshot.elements[0].id);
 assert.equal(result.status,'VERIFIED');
 assert.equal(f.calls.filter(x=>x.mode==='Invoke').length,1);
 assert.equal(f.calls.find(x=>x.mode==='Invoke').method,'uia');
});
test('UIA without InvokePattern selects Win32 BM_CLICK native method',async()=>{
 const f=setup({uia:false});
 const snapshot=await f.observe();
 const result=await f.invoke(snapshot.elements[0].id);
 assert.equal(result.status,'VERIFIED');
 assert.equal(f.calls.find(x=>x.mode==='Invoke').method,'win32');
 assert.equal(f.applied,1);
});
test('unknown Win32 physical outcome cannot trigger retry through UIA',async()=>{
 const f=setup({uia:false,success:false});
 const snapshot=await f.observe();
 const first=await f.invoke(snapshot.elements[0].id);
 const second=await f.invoke(snapshot.elements[0].id);
 assert.equal(first.status,'UNCERTAIN');assert.deepEqual(second,first);
 assert.equal(f.applied,1);
});
test('native dispatch alone is not verified without an independent postcondition',async()=>{
 const f=setup({uia:true,proof:false});
 const snapshot=await f.observe();
 const result=await f.invoke(snapshot.elements[0].id);
 assert.equal(result.status,'UNCERTAIN');
});
test('stale unknown selector is rejected before input',async()=>{
 const f=setup();
 await f.observe();
 await assert.rejects(f.invoke('bogus'),{code:'V2_WIN_ELEMENT_UNBOUND'});
 assert.equal(f.applied,0);
});
test('new operation cannot reuse consumed selector or bypass a receipt',async()=>{
 const f=setup();
 const snap=await f.observe();
 assert.equal((await f.invoke(snap.elements[0].id)).status,'VERIFIED');
 assert.equal((await f.invoke(snap.elements[0].id)).status,'VERIFIED');
 assert.equal(f.applied,1);
});
test('invalid owner process/generation rejects native preflight',async()=>{
 let called=0;
 const providers=createV2WindowsNativeQaProviders({
  resolveTarget:async()=>({...TARGET,processStartTicks:'unknown'}),
  transport:async()=>{called++;return {}}
 });
 await assert.rejects(providers.uia.probe({targetId:'qa-win',action:'observe'}),
  {code:'V2_WIN_OWNER_TARGET_INVALID'});
 assert.equal(called,0);
});
test('typing unsupported, no silent cross-control input fallback',async()=>{
 const f=setup();
 const out=await f.observe();
 await assert.rejects(f.invoke('another-button'),{code:'V2_WIN_ELEMENT_UNBOUND'});
 assert.equal(f.applied,0);
});
