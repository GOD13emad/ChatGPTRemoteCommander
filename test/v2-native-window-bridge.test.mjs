import test from 'node:test';
import assert from 'node:assert/strict';
import { executeV2NativeWindowAction } from '../src/v2-native-window-bridge.mjs';

const route=(chat='chat-a',id='window-one')=>({
 hostId:'host',principalId:'owner',profileId:'profile',conversationId:chat,
 operationId:'click-1',target:{kind:'app-window',id}
});
function fixture(){
 const granted=new Set(),receipts=new Map(),leases=[],effects=[],calls=[];
 let chat='chat-a',owner='owner',seat='seat-a',handle='native-h1',
  start='proc-start-1',consent=true,allowElement=true,verify=true,
  failure=false,rebinding=false,afterPolicy;
 const driver={
  async observe(id){calls.push('observe');return {targetId:id,hostId:'host',
   principalId:owner,seatId:seat,pid:1234,windowHandle:handle,
   processStartId:start,present:true};},
  async authorizeElement(){calls.push('element');if(afterPolicy)await afterPolicy();
   return allowElement;},
  async apply(payload){calls.push('apply');effects.push(payload);
   if(failure)throw Error('possibly executed');},
  async verify(){calls.push('verify');return verify;}
 };
 const services={
  sessions:{resolveNativeRoute:async()=>route(chat)},
  ownerSeat:async()=>seat,
  authorizeWindow:async()=>consent,
  nativeDriver:driver,
  grants:{isAllowed:(r,tool)=>granted.has(r.conversationId+':'+tool)},
  withLease:async(resource,work)=>{leases.push(resource);return work();},
  receiptStore:{execute:async(input,work)=>{
    const key=input.requestId;
    const seen=receipts.get(key);
    if(seen){assert.deepEqual(input,seen.input);return seen.result;}
    const result=await work(); receipts.set(key,{input,result});return result;
  }}
 };
 return {services,granted,effects,leases,calls,
  grant:(c='chat-a',t='workspace_window_invoke')=>granted.add(c+':'+t),
  chat:x=>{chat=x;},seat:x=>{seat=x;},owner:x=>{owner=x;},
  handle:x=>{handle=x;},start:x=>{start=x;},
  consent:x=>{consent=x;},element:x=>{allowElement=x;},
  verify:x=>{verify=x;},failure:x=>{failure=x;},
  afterPolicy:x=>{afterPolicy=x;}
 };
}
const doAction=(f,opts={})=>executeV2NativeWindowAction({
 route:route(),sessionHandle:'trusted-chat-handle',action:'invoke',
 elementId:'button.refresh',services:f.services,...opts
});
test('approved accessibility action observes, executes and verifies exact owner window',async()=>{
 const f=fixture();f.grant();
 const result=await doAction(f);
 assert.equal(result.status,'VERIFIED');
 assert.equal(f.effects.length,1);assert.equal(f.effects[0].elementId,'button.refresh');
 assert.equal(f.calls.includes('verify'),true);
 assert.equal(f.leases.length,1);
});
test('observe uses independent grant, does not touch app or enable unscoped input',async()=>{
 const f=fixture();f.grant('chat-a','workspace_window_observe');
 const out=await doAction(f,{action:'observe',elementId:undefined});
 assert.equal(out.status,'OBSERVED');assert.equal(f.effects.length,0);
 await assert.rejects(doAction(f),{code:'V2_GRANT_REQUIRED'});
});
test('an unverified conversation and wrong app resource cannot borrow native session',async()=>{
 const f=fixture();f.grant();
 f.chat('chat-b');
 await assert.rejects(doAction(f),{code:'V2_WINDOW_SESSION_ROUTE_CHANGED'});
 f.chat('chat-a');f.owner('different-principal');
 await assert.rejects(doAction(f),{code:'V2_WINDOW_NATIVE_OWNER_MISMATCH'});
 assert.equal(f.effects.length,0);
});
test('native owner consent and separate per-action grant are mandatory',async()=>{
 const f=fixture();f.grant();f.consent(false);
 await assert.rejects(doAction(f),{code:'V2_WINDOW_OWNER_CONSENT_REQUIRED'});
 f.consent(true);f.granted.clear();
 await assert.rejects(doAction(f),{code:'V2_GRANT_REQUIRED'});
 assert.equal(f.effects.length,0);
});
test('reject raw pointer, unsupported actions and unchecked typed text',async()=>{
 const f=fixture();
 for(const input of [
  {action:'click',elementId:'button.refresh'},
  {action:'invoke',elementId:'../../unsafe'},
  {action:'type',elementId:'input',text:''},
  {action:'type',elementId:'input',text:'z'.repeat(4097)},
  {action:'observe',elementId:'button.refresh'},
  {action:'invoke',text:'should-not-be-present'}
 ])await assert.rejects(doAction(f,input));
 assert.equal(f.effects.length,0);
});
test('replacement of process/window during deferred element authorization blocks effect',async()=>{
 const f=fixture();f.grant();
 f.afterPolicy(()=>f.handle('new-handle'));
 await assert.rejects(doAction(f),{code:'V2_WINDOW_REPLACED_BEFORE_EFFECT'});
 assert.equal(f.effects.length,0);
});
test('owner seat changes while permission pending block the action',async()=>{
 const f=fixture();f.grant();
 f.afterPolicy(()=>f.seat('changed-seat'));
 await assert.rejects(doAction(f),{code:'V2_WINDOW_REPLACED_BEFORE_EFFECT'});
 assert.equal(f.effects.length,0);
});
test('uncertain native effect is durably held, duplicate id never blindly replays',async()=>{
 const f=fixture();f.grant();f.failure(true);
 const a=await doAction(f),b=await doAction(f);
 assert.equal(a.status,'UNCERTAIN');assert.equal(b.status,'UNCERTAIN');
 assert.equal(f.effects.length,1);
});
test('post-action verification failure yields UNCERTAIN, no second physical action',async()=>{
 const f=fixture();f.grant();f.verify(false);
 const a=await doAction(f);
 assert.equal(a.status,'UNCERTAIN');assert.equal(f.effects.length,1);
});
test('accessible typing passes exact element and text only with type grant',async()=>{
 const f=fixture();f.grant('chat-a','workspace_window_type');
 const r=await doAction(f,{action:'type',elementId:'field.query',text:'original owner text'});
 assert.equal(r.status,'VERIFIED');
 assert.equal(f.effects[0].text,'original owner text');
 assert.equal(f.effects.length,1);
});
