import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeWindowsUIACall} from '../src/agentos-native-win.mjs';
const req={pid:1234,windowId:9876};
const goodObserve={ok:true,mode:'NATIVE_UIA_OBSERVE',provider:'windows-uia-native',...req,windowHandle:req.windowId,
 physicalInputTouched:false,foregroundTouched:false,foregroundStatus:'PRESERVED',
 elements:[{name:'No',fingerprint:'0123456789abcdef01234567',invokeAvailable:true}]};
test('real Windows UIA subprocess argv is literal, bounded and shell-free',async()=>{
 let call=null;
 const runner=async (...args)=>{call=args;return {stdout:JSON.stringify(goodObserve)};};
 const r=await nativeWindowsUIACall('Observe',req,{platform:'win32',runner});
 assert.equal(r.elements[0].name,'No');
 assert.equal(call[0],'pwsh.exe');
 assert.equal(call[2].shell,false);
 assert.equal(call[2].windowsHide,true);
 assert.deepEqual(call[1].slice(-6),['-TargetPid','1234','-WindowHandle','9876','-MaxElements','70']);
});
test('native UIA mutation requires exact fingerprint, request and owner authorization',async()=>{
 let calls=0;
 const runner=async()=>{calls++;return {stdout:'{}'};};
 const input={...req,fingerprint:'0123456789abcdef01234567',controlName:'No',
  requestId:'rc011-once-exact-01',explicitUserAuthorization:'Owner authorizes one No button'};
 for(const bad of [{fingerprint:'x'},{requestId:8},{explicitUserAuthorization:'short'}, {controlName:''}]){
  await assert.rejects(nativeWindowsUIACall('Invoke',{...input,...bad},{platform:'win32',runner}),/AGENTOS_NATIVE_INVOKE_CONTRACT_INVALID/);
 }
 assert.equal(calls,0);
});
test('native UIA response is not treated as user-goal completion',async()=>{
 const input={...req,fingerprint:'0123456789abcdef01234567',controlName:'No',
  requestId:'rc011-once-exact-01',explicitUserAuthorization:'Owner authorizes one No button'};
 const runner=async()=>({stdout:JSON.stringify({...input,ok:true,mode:'NATIVE_UIA_INVOKE',provider:'windows-uia-native',windowHandle:req.windowId,
  physicalInputTouched:false,foregroundTouched:false,foregroundStatus:'PRESERVED',invocationIssued:true,userGoalVerified:false})});
 const r=await nativeWindowsUIACall('Invoke',input,{platform:'win32',runner});
 assert.equal(r.invocationIssued,true);assert.equal(r.userGoalVerified,false);
});
test('refuse wrong process identity, platform and forged native output',async()=>{
 await assert.rejects(nativeWindowsUIACall('Observe',req,{platform:'linux',runner:async()=>{throw Error('unexpected')}}),/AGENTOS_NATIVE_WINDOWS_ONLY/);
 const runner=async()=>({stdout:JSON.stringify({...goodObserve,pid:444})});
 await assert.rejects(nativeWindowsUIACall('Observe',req,{platform:'win32',runner}),/AGENTOS_NATIVE_RESPONSE_UNTRUSTED/);
});
test('on process timeout native effect cannot be silently repeated',async()=>{
 const runner=async()=>{throw Object.assign(Error('lost transport'),{killed:true});};
 await assert.rejects(nativeWindowsUIACall('Observe',req,{platform:'win32',runner}),/AGENTOS_NATIVE_OUTCOME_UNCERTAIN/);
});

test('do not falsify measured foreground changes or unobservable focus',async()=>{
 const input={...req,fingerprint:'0123456789abcdef01234567',controlName:'No',
  requestId:'rc011-focus-measured-01',explicitUserAuthorization:'Owner allowed isolated native UIAutomation No test'};
 for(const [status,touched] of [['CHANGED',true],['UNOBSERVABLE',null]]){
  const runner=async()=>({stdout:JSON.stringify({
   ok:true,mode:'NATIVE_UIA_INVOKE',provider:'windows-uia-native',
   pid:req.pid,windowHandle:req.windowId,requestId:input.requestId,
   foregroundStatus:status,foregroundTouched:touched,physicalInputTouched:false,
   invocationIssued:true,userGoalVerified:false
  })});
  const result=await nativeWindowsUIACall('Invoke',input,{platform:'win32',runner});
  assert.equal(result.foregroundStatus,status);assert.equal(result.foregroundTouched,touched);
 }
 for(const [status,touched] of [['CHANGED',false],['PRESERVED',true],['UNOBSERVABLE',false]]){
  const runner=async()=>({stdout:JSON.stringify({
   ok:true,mode:'NATIVE_UIA_INVOKE',provider:'windows-uia-native',
   pid:req.pid,windowHandle:req.windowId,requestId:input.requestId,
   foregroundStatus:status,foregroundTouched:touched,physicalInputTouched:false,
   invocationIssued:true,userGoalVerified:false
  })});
  await assert.rejects(nativeWindowsUIACall('Invoke',input,{platform:'win32',runner}),/AGENTOS_NATIVE_RESPONSE_UNTRUSTED/);
 }
});
