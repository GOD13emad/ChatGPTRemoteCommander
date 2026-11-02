// Standalone disposable Windows E2E: scoped UIA/Win32 native worker through
// hybrid V2 driver and V2 Native Window Bridge. No public tool registration.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createV2WindowsNativeQaTransport,createV2WindowsNativeQaProviders}
 from '../src/v2-windows-native-qa-provider.mjs';
import {createV2HybridNativeDriver} from '../src/v2-hybrid-native-driver.mjs';
import {executeV2NativeWindowAction} from '../src/v2-native-window-bridge.mjs';
import {MutationIdempotencyStore} from '../src/mutation-idempotency.mjs';

const [pidValue,hwnd,ticks,title,proofPath,workerScript,scenario]=process.argv.slice(2);
const pid=Number(pidValue);
if(process.platform!=='win32'||!Number.isSafeInteger(pid)||pid<1||
 !/^[1-9][0-9]{0,18}$/.test(hwnd??'')||
 !/^[1-9][0-9]{0,19}$/.test(ticks??'')||
 title!=='Commander V2 Native QA'||!proofPath||!workerScript)
 throw Error('QA_WINDOWS_OWNER_SELECTION_REQUIRED');
const target=Object.freeze({
 targetId:'qa-window',hostId:'qa-windows-host',principalId:'qa-owner',
 seatId:'qa-session',pid,windowHandle:hwnd,
 processStartId:'gen'+ticks,processStartTicks:ticks,
 windowTitle:title,present:true
});
const transport=createV2WindowsNativeQaTransport({scriptPath:workerScript});
const providers=createV2WindowsNativeQaProviders({
 resolveTarget:async()=>({...target}),transport,
 independentProof:async()=>{try{return readFileSync(proofPath,'utf8')==='APPLY_CLICKED'}catch{return false}}
});
const activeProviders=scenario==='simulate-uia-unsupported'
 ? {uia:{...providers.uia,probe:async q=>{
    const observed=await providers.uia.probe(q);
    return {supported:false,targetBound:observed.targetBound};
   }},win32:providers.win32}
 : providers;
const dir=mkdtempSync(join(tmpdir(),'v2-win-owner-qa-'));
const receipts=new MutationIdempotencyStore({directory:dir,scope:'owner-qa'});
const route=id=>({
 hostId:target.hostId,principalId:target.principalId,profileId:'qa-profile',
 conversationId:'qa-exact-test-chat',operationId:id,
 target:{kind:'app-window',id:target.targetId}
});
function services(action,elementId,operationId){
 return {
  sessions:{resolveNativeRoute:async()=>route(operationId)},
  ownerSeat:async()=>target.seatId,
  authorizeWindow:async()=>true, // fixture only: not a real owner grant
  grants:{isAllowed:async()=>true},
  withLease:async(k,fn)=>fn(), // one isolated test writer
  receiptStore:receipts,
  nativeDriver:createV2HybridNativeDriver({platform:'windows',action,
   ...(elementId?{elementId}:{}),providers:activeProviders})
 };
}
try{
 const observed=await executeV2NativeWindowAction({route:route('observe-1'),
  sessionHandle:'qa-owner-bound',action:'observe',
  services:services('observe',undefined,'observe-1')});
 assert.equal(observed.status,'OBSERVED');
 const buttons=observed.elements.filter(e=>e.name==='Apply'&&e.role==='button');
 assert.equal(buttons.length,1);
 const elementId=buttons[0].id;
 const opts={route:route('invoke-1'),sessionHandle:'qa-owner-bound',
  action:'invoke',elementId,services:services('invoke',elementId,'invoke-1')};
 const outcome=await executeV2NativeWindowAction(opts);
 assert.equal(outcome.status,'VERIFIED');
 assert.equal(readFileSync(proofPath,'utf8'),'APPLY_CLICKED');
 const duplicate=await executeV2NativeWindowAction(opts);
 assert.deepEqual(duplicate,outcome);
 console.log('V2_WINDOWS_NATIVE_BRIDGE_E2E_PASS');
 console.log('result=VERIFIED; nativeMethod='+opts.services.nativeDriver.selectedMethod()+
  '; independentProof=APPLY_CLICKED; duplicateEffect=false; scenario='+(scenario??'native'));
}finally{
 receipts.close();rmSync(dir,{recursive:true,force:true});
}
