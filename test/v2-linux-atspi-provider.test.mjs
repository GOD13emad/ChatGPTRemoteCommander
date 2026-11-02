import test from 'node:test';
import assert from 'node:assert/strict';
import {createV2LinuxAtspiProvider} from '../src/v2-linux-atspi-provider.mjs';
import {createV2HybridNativeDriver} from '../src/v2-hybrid-native-driver.mjs';
import {executeV2NativeWindowAction} from '../src/v2-native-window-bridge.mjs';

const TARGET=Object.freeze({
 targetId:'window1',hostId:'host1',principalId:'owner1',seatId:'seat1',
 pid:1234,windowHandle:'window-handle1',processStartId:'generation1',
 processStartTicks:'889988',applicationName:'QA.App',windowTitle:'QA Fixture',
 present:true
});
const route=operationId=>({
 hostId:TARGET.hostId,principalId:TARGET.principalId,profileId:'p1',
 conversationId:'chat1',operationId,target:{kind:'app-window',id:TARGET.targetId}
});
function fixture({proof=true,throwEffect=false}={}){
 let effect=false,calls=[],requests=[],controls=[
  {path:[0],role:'push button',name:'Apply',editable:false,action:'click'},
  {path:[1],role:'entry',name:'Query field',editable:true,action:null},
  {path:[2],role:'entry',name:'Password token',editable:true,action:null}
 ];
 const native=async request=>{
  requests.push(request);
  if(request.command==='snapshot'){
   calls.push('snapshot');return {ok:true,controls,valuesRead:false,truncated:false};
  }
  if(request.command==='invoke'||request.command==='type'){
   calls.push('native-effect');
   effect=true;
   if(throwEffect)throw Error('unknown result');
   return {ok:true,effect:'DISPATCHED'};
  }
  throw Error('bad command');
 };
 const provider=createV2LinuxAtspiProvider({
  resolveTarget:async id=>({...TARGET,targetId:id}),
  transport:native,
  ...(proof?{independentProof:async()=>effect}: {})
 });
 const receipts=new Map();
 const services=(action,elementId)=>{
  const driver=createV2HybridNativeDriver({platform:'linux',action,
   ...(elementId?{elementId}:{}),providers:{atspi:provider}});
  return {
   sessions:{resolveNativeRoute:async()=>route(action==='observe'?'observe1':'invoke1')},
   ownerSeat:async()=>TARGET.seatId,
   authorizeWindow:async()=>true,
   nativeDriver:driver,
   grants:{isAllowed:async()=>true},
   withLease:async(k,fn)=>fn(),
   receiptStore:{execute:async(input,fn)=>{
    const prior=receipts.get(input.requestId);
    if(prior)return prior;
    const result=await fn();receipts.set(input.requestId,result);return result;
   }}
  };
 };
 return {services,calls,requests,native,get effect(){return effect}};
}
async function takeSnapshot(f){
 const services=f.services('observe');
 return executeV2NativeWindowAction({route:route('observe1'),
  sessionHandle:'bound-session',action:'observe',services});
}
async function click(f,elementId){
 const services=f.services('invoke',elementId);
 return executeV2NativeWindowAction({route:route('invoke1'),
  sessionHandle:'bound-session',action:'invoke',elementId,services});
}
test('Linux provider -> Hybrid -> V2 Bridge: observe then exact invoke verified',async()=>{
 const f=fixture();
 const read=await takeSnapshot(f);
 assert.equal(read.status,'OBSERVED');
 assert.equal(read.elements.length,2);
 assert.equal(JSON.stringify(read).includes('Password token'),false);
 const button=read.elements.find(x=>x.name==='Apply');
 assert.equal(button.role,'button');
 const result=await click(f,button.id);
 assert.equal(result.status,'VERIFIED');
 assert.equal(f.calls.filter(x=>x==='native-effect').length,1);
 assert.deepEqual(f.requests.at(-1).path,[0]);
 assert.equal(f.requests.at(-1).expectedName,'Apply');
 assert.equal(f.requests.at(-1).expectedStartTicks,'889988');
});
test('native dispatch without independent owner proof remains UNCERTAIN',async()=>{
 const f=fixture({proof:false});
 const read=await takeSnapshot(f);
 const result=await click(f,read.elements[0].id);
 assert.equal(result.status,'UNCERTAIN');
 assert.equal(f.calls.filter(x=>x==='native-effect').length,1);
});
test('native exception after dispatch is UNCERTAIN and does not retry',async()=>{
 const f=fixture({throwEffect:true});
 const read=await takeSnapshot(f);
 const result=await click(f,read.elements[0].id);
 assert.equal(result.status,'UNCERTAIN');
 assert.equal(f.calls.filter(x=>x==='native-effect').length,1);
});
test('fresh element cannot be reused as a second physical effect',async()=>{
 const f=fixture();
 const read=await takeSnapshot(f);
 assert.equal((await click(f,read.elements[0].id)).status,'VERIFIED');
 // Existing durable receipt reuses the outcome for the same scoped request ID.
 assert.equal((await click(f,read.elements[0].id)).status,'VERIFIED');
 assert.equal(f.calls.filter(x=>x==='native-effect').length,1);
});
test('invalid owner metadata refuses before native helper calls',async()=>{
 let calls=0;
 const provider=createV2LinuxAtspiProvider({
  resolveTarget:async id=>({...TARGET,targetId:id,processStartTicks:'not-a-number'}),
  transport:async()=>{calls++;return {ok:true,controls:[],valuesRead:false}}
 });
 await assert.rejects(provider.probe({targetId:'window1',action:'observe'}),
  {code:'V2_ATSPI_TARGET_UNVERIFIED'});
 assert.equal(calls,0);
});
test('unknown output/changed element fails closed with no input',async()=>{
 const f=fixture();
 const read=await takeSnapshot(f);
 const original=f.requests.length;
 await assert.rejects(click(f,'no-such-element'),{code:'V2_ATSPI_ELEMENT_UNBOUND'});
 assert.equal(f.calls.filter(x=>x==='native-effect').length,0);
 assert.equal(f.requests.length,original);
});
