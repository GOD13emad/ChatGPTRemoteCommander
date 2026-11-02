import test from 'node:test';
import assert from 'node:assert/strict';
import {createV2HybridNativeDriver} from '../src/v2-hybrid-native-driver.mjs';
import {executeV2NativeWindowAction} from '../src/v2-native-window-bridge.mjs';

function provider(name,trace,{supported=true,targetBound=true,backgroundTargeted=true,
 failure=false,verified=true,owner='owner',start='generation-1'}={}){
 const data={supported,targetBound,backgroundTargeted};
 return {
  async probe(args){trace.push(name+':probe:'+args.action);return {...data};},
  async observe(targetId){trace.push(name+':observe');return {
   targetId,hostId:'host',principalId:owner,seatId:'seat',pid:1122,
   windowHandle:'h1',processStartId:start,present:true
  };},
  async readAccessibility(){trace.push(name+':read');return {elements:[
   {id:'button.apply',role:'button',name:'Apply',enabled:true}
  ]};},
  async authorizeElement(){trace.push(name+':authorize');return true;},
  async apply(){trace.push(name+':apply');if(failure)throw Error('effect unknown');},
  async verify(){trace.push(name+':verify');return verified;}
 };
}
const route=()=>({
 hostId:'host',principalId:'owner',profileId:'p1',conversationId:'chat1',
 operationId:'op1',target:{kind:'app-window',id:'window-1'}
});
function bindings(driver){
 const receipts=new Map();
 return {
  sessions:{resolveNativeRoute:async()=>route()},
  ownerSeat:async()=> 'seat',
  authorizeWindow:async()=>true,
  nativeDriver:driver,
  grants:{isAllowed:async()=>true},
  withLease:async(key,fn)=>fn(),
  receiptStore:{execute:async(input,fn)=>{
   if(receipts.has(input.requestId))return receipts.get(input.requestId);
   const output=await fn();receipts.set(input.requestId,output);return output;
  }}
 };
}
const execute=(driver,action='invoke',elementId='button.apply')=>
 executeV2NativeWindowAction({
  route:route(),sessionHandle:'owner-session',action,
  ...(action==='observe'?{}:{elementId}),services:bindings(driver)
 });
test('UIA supports target: prefer its semantic invoke; no Win32/CUA effect',async()=>{
 const trace=[];
 const driver=createV2HybridNativeDriver({platform:'windows',action:'invoke',
  elementId:'button.apply',providers:{
   uia:provider('uia',trace),win32:provider('win32',trace),cua:provider('cua',trace)
  }});
 const result=await execute(driver);
 assert.equal(result.status,'VERIFIED');
 assert.equal(driver.selectedMethod(),'uia');
 assert.equal(trace.filter(x=>x.endsWith(':apply')).join(','),'uia:apply');
 assert.equal(trace.some(x=>x.startsWith('win32:')),false);
});
test('UIA InvokePattern unsupported: trusted Win32 fallback before effect',async()=>{
 const trace=[];
 const driver=createV2HybridNativeDriver({platform:'windows',action:'invoke',
  elementId:'button.apply',providers:{
   uia:provider('uia',trace,{supported:false}),
   win32:provider('win32',trace),
   cua:provider('cua',trace)
  }});
 const result=await execute(driver);
 assert.equal(result.status,'VERIFIED');
 assert.equal(driver.selectedMethod(),'win32');
 assert.equal(trace.filter(x=>x.endsWith(':apply')).join(','),'win32:apply');
 assert.equal(trace.some(x=>x.startsWith('cua:')),false);
});
test('Linux AT-SPI is selected for a generic app window, not a Firefox default',async()=>{
 const trace=[];
 const driver=createV2HybridNativeDriver({platform:'linux',action:'invoke',
  elementId:'button.apply',providers:{
   atspi:provider('atspi',trace),cua:provider('cua',trace)
  }});
 assert.equal((await execute(driver)).status,'VERIFIED');
 assert.equal(driver.selectedMethod(),'atspi');
 assert.equal(trace.filter(x=>x.endsWith(':apply')).join(','),'atspi:apply');
});
test('AT-SPI explicit unsupported can select background-targeted CUA',async()=>{
 const trace=[];
 const driver=createV2HybridNativeDriver({platform:'linux',action:'invoke',
  elementId:'button.apply',providers:{
   atspi:provider('atspi',trace,{supported:false}),
   cua:provider('cua',trace,{backgroundTargeted:true})
  }});
 assert.equal((await execute(driver)).status,'VERIFIED');
 assert.equal(driver.selectedMethod(),'cua');
 assert.equal(trace.filter(x=>x.endsWith(':apply')).join(','),'cua:apply');
});
test('non-targeted CUA is refused without an effect',async()=>{
 const trace=[];
 const driver=createV2HybridNativeDriver({platform:'linux',action:'invoke',
  elementId:'button.apply',providers:{
   atspi:provider('atspi',trace,{supported:false}),
   cua:provider('cua',trace,{backgroundTargeted:false})
  }});
 await assert.rejects(execute(driver),{code:'V2_HYBRID_CUA_NOT_TARGETED'});
 assert.equal(trace.some(x=>x.endsWith(':apply')),false);
});
test('ambiguous probe is not a fallback license',async()=>{
 const trace=[];
 const uia=provider('uia',trace);
 uia.probe=async()=>{throw Error('UIA transport timeout');};
 const driver=createV2HybridNativeDriver({platform:'windows',action:'invoke',
  elementId:'button.apply',providers:{
   uia,win32:provider('win32',trace)
  }});
 await assert.rejects(execute(driver),/UIA transport timeout/);
 assert.equal(trace.some(x=>x.startsWith('win32:')),false);
});
test('method lost after consent check cannot switch to a different driver',async()=>{
 const trace=[];
 const uia=provider('uia',trace);
 let count=0;
 uia.probe=async()=>({supported:++count===1,targetBound:true});
 const driver=createV2HybridNativeDriver({platform:'windows',action:'invoke',
  elementId:'button.apply',providers:{
   uia,win32:provider('win32',trace)
  }});
 await assert.rejects(execute(driver),{code:'V2_HYBRID_SELECTED_METHOD_LOST'});
 assert.equal(trace.some(x=>x.endsWith(':apply')),false);
 assert.equal(trace.some(x=>x.startsWith('win32:')),false);
});
test('unknown physical effect returns UNCERTAIN, never calls next method',async()=>{
 const trace=[];
 const driver=createV2HybridNativeDriver({platform:'windows',action:'invoke',
  elementId:'button.apply',providers:{
   uia:provider('uia',trace,{failure:true}),
   win32:provider('win32',trace)
  }});
 const out=await execute(driver);
 assert.equal(out.status,'UNCERTAIN');
 assert.equal(trace.filter(x=>x.endsWith(':apply')).join(','),'uia:apply');
});
test('untrusted/stale descriptor cannot be fed directly to native effect',async()=>{
 const trace=[];
 const driver=createV2HybridNativeDriver({platform:'linux',action:'invoke',
  elementId:'button.apply',providers:{atspi:provider('atspi',trace)}});
 await driver.observe('window-1');
 await assert.rejects(driver.apply({descriptor:{targetId:'window-1'},
  action:'invoke',elementId:'button.apply'}),{code:'V2_HYBRID_DESCRIPTOR_UNBOUND'});
 assert.equal(trace.some(x=>x.endsWith(':apply')),false);
});
test('same driver cannot reapply a completed or ambiguous operation',async()=>{
 const trace=[];
 const driver=createV2HybridNativeDriver({platform:'windows',action:'invoke',
  elementId:'button.apply',providers:{uia:provider('uia',trace)}});
 const descriptor=await driver.observe('window-1');
 const args={descriptor,action:'invoke',elementId:'button.apply'};
 await driver.apply(args);
 await assert.rejects(driver.apply(args),{code:'V2_HYBRID_EFFECT_ALREADY_ATTEMPTED'});
 assert.equal(trace.filter(x=>x.endsWith(':apply')).length,1);
});
test('observation retains bounded accessibility view with no physical action',async()=>{
 const trace=[];
 const driver=createV2HybridNativeDriver({platform:'linux',action:'observe',
  providers:{atspi:provider('atspi',trace)}});
 const result=await execute(driver,'observe');
 assert.equal(result.status,'OBSERVED');
 assert.equal(result.elements[0].name,'Apply');
 assert.equal(trace.filter(x=>x.endsWith(':apply')).length,0);
});
test('backend contract and unsupported configuration fail closed',async()=>{
 assert.throws(()=>createV2HybridNativeDriver({platform:'linux',action:'invoke',
  elementId:'button.apply',providers:{portal:{}}}),{code:'V2_HYBRID_DRIVER_CONFIG_INVALID'});
 assert.throws(()=>createV2HybridNativeDriver({platform:'windows',action:'invoke',
  elementId:'button.apply',providers:{uia:{}}}),{code:'V2_HYBRID_PROVIDER_CONTRACT_INVALID'});
 const trace=[];
 const d=createV2HybridNativeDriver({platform:'linux',action:'invoke',
  elementId:'button.apply',providers:{atspi:provider('atspi',trace,{supported:false})}});
 await assert.rejects(execute(d),{code:'V2_HYBRID_NO_SUPPORTED_METHOD'});
 assert.equal(trace.some(x=>x.endsWith(':apply')),false);
});
