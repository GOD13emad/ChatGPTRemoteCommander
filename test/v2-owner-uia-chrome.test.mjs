import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectOwnerUiaChrome,normalizeOwnerUiaChrome} from '../tools/v2-owner-uia-chrome.mjs';

const target={seat:1,pid:68640,windowId:'7870792',
 processStartTicks:'639289441985526694'};
test('native UIA keeps only safe browser chrome buttons, never private labels',async()=>{
 const result=await inspectOwnerUiaChrome({...target,probe:async x=>{
  assert.deepEqual(x,target);
  return {status:'OBSERVED',controls:['Back','Reload','Search'],
   pageTitle:'secret page',password:'fake',cookie:'fake'};
 }});
 assert.deepEqual(result,{status:'OBSERVED',controls:['Back','Reload','Search']});
 assert.equal(JSON.stringify(result).includes('secret'),false);
 assert.equal(Object.isFrozen(result),true);
});
test('untrusted UIA results fail closed, with no action authority',async()=>{
 for(const input of [
  {status:'OBSERVED',controls:['Password']},
  {status:'OBSERVED',controls:['Back','Back']},
  {status:'OBSERVED',controls:'Back'}
 ]){
  assert.deepEqual(await inspectOwnerUiaChrome({...target,probe:async()=>input}),
    {status:'UNAVAILABLE',controls:[]});
 }
 assert.throws(()=>normalizeOwnerUiaChrome({status:'OBSERVED',controls:['private typed text']}),
  {code:'V2_OWNER_UIA_PROOF_INVALID'});
});
test('wrong session/handle/generation blocked before native probing',async()=>{
 for(const targetChange of [{seat:0},{pid:-1},{windowId:'0'},{processStartTicks:'invalid'}]){
  let invoked=false;
  await assert.rejects(inspectOwnerUiaChrome({...target,...targetChange,
   probe:async()=>{invoked=true;return {status:'OBSERVED',controls:[]};}}),
   {code:'V2_OWNER_UIA_TARGET_INVALID'});
  assert.equal(invoked,false);
 }
});
