import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectOwnerUiaChrome,normalizeOwnerUiaChrome,isOwnerUiaTopBandBounds} from '../tools/v2-owner-uia-chrome.mjs';

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

test('UIA top window band excludes webpage controls before reading labels',()=>{
 const window={x:0,y:0,width:1720,height:1392};
 assert.equal(isOwnerUiaTopBandBounds({window,control:{x:7,y:46,width:28,height:28}}),true);
 for(const control of [
  {x:7,y:190,width:28,height:28},
  {x:7,y:46,width:300,height:28},
  {x:7,y:46,width:28,height:100},
  {x:-100,y:46,width:28,height:28},
  {x:7,y:NaN,width:28,height:28},
  {x:7,y:46,width:0,height:28},
  {x:1700,y:46,width:40,height:28}
 ]) assert.equal(isOwnerUiaTopBandBounds({window,control}),false);
 assert.equal(isOwnerUiaTopBandBounds({window:{x:-300,y:-150,width:1000,height:800},control:{x:-280,y:-104,width:28,height:28}}),true);
});
test('native UIA gates geometry and Document ancestry before label access',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {fileURLToPath}=await import('node:url');
 const {URL}=await import('node:url');
 const src=await readFile(fileURLToPath(new URL('../tools/v2-owner-uia-chrome.mjs',import.meta.url)),'utf8');
 const bounds=src.indexOf(' $b=$candidate.Current.BoundingRectangle');
 const document=src.indexOf(' $ancestor=$walker.GetParent($candidate)');
 const name=src.indexOf(' $v=$candidate.Current.Name');
 assert.ok(bounds>0&&document>bounds&&name>document);
 assert.match(src,/\$ancestor\.Current\.ControlType -eq \$document/);
 assert.match(src,/\$candidate\.Current\.IsOffscreen/);
 assert.match(src,/\$atRoot/);
});
