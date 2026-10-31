import test from 'node:test';
import assert from 'node:assert/strict';
import {V2_V1_READINESS_TOOL,createV2V1SafeObserver} from '../src/v2-v1-safe-observer.mjs';

test('direct V1 readiness uses only four fixed non-mutating tools and removes private fields',async()=>{
 const fixtures={
  gui_status:{available:true,enabled:true,inputAvailable:true,
   consentRequired:true,consentedSessionActive:false,leased:false,busy:false,
   privateTabs:['sensitive'],userProfile:'/home/mmz'},
  browser_status:{available:true,enabled:true,active:false,
   backgroundOnly:true,leased:false,busy:false,cookies:'secret'},
  workflow_health:{ok:true,databaseIntegrity:'ok',
   scheduler:{enabled:true,automaticExecution:false},jobs:['secret']},
  power_status:{enabled:true,fullFilesystem:true,allowShell:true,
   allowProcessControl:true,secretPassword:'secret'}
 };
 const called=[];
 const fn=createV2V1SafeObserver({invokeReadOnly:async tool=>{
  called.push(tool);return fixtures[tool];
 }});
 for(const component of ['gui','browser','workflow','power']){
  const value=await fn({component});
  assert.equal(value.component,component);
  assert.equal(value.source,'V1_REDACTED_SNAPSHOT');
  const out=JSON.stringify(value);
  assert.ok(!out.includes('secret')&&!out.includes('/home/mmz'));
  assert.ok(!out.includes('privateTabs')&&!out.includes('userProfile'));
 }
 assert.deepEqual(called,Object.keys(fixtures));
 assert.equal(V2_V1_READINESS_TOOL.securitySchemes[0].type,'noauth');
});
test('reject custom tools, unvalidated schema and unexpected raw values',async()=>{
 let count=0;
 const f=createV2V1SafeObserver({invokeReadOnly:async()=>{
  count++;return {available:true};
 }});
 for(const args of [undefined,{}, {component:'shell'}, {component:'gui',path:'/etc/passwd'},
  {component:['gui']},{component:'__proto__'}])
  await assert.rejects(()=>f(args));
 assert.equal(count,0);
 await assert.rejects(()=>f({component:'gui'}),{code:'V2_OBSERVER_SOURCE_SCHEMA'});
});
test('malformed sensitive source data is denied instead of passed through',async()=>{
 const f=createV2V1SafeObserver({invokeReadOnly:async()=>({
  ok:true,databaseIntegrity:'\\x1b',scheduler:{enabled:true,automaticExecution:false}
 })});
 await assert.rejects(()=>f({component:'workflow'}),{code:'V2_OBSERVER_SOURCE_SCHEMA'});
});
