// Real isolated GUI integration: owner-bound Linux AT-SPI provider through
// Hybrid Driver + V2 Native Bridge + actual durable mutation receipt.
// Invoked only by test/test_v2_linux_atspi_bridge_live.py on disposable Xvfb.
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createV2AtspiTransport,createV2LinuxAtspiProvider} from '../src/v2-linux-atspi-provider.mjs';
import {createV2HybridNativeDriver} from '../src/v2-hybrid-native-driver.mjs';
import {executeV2NativeWindowAction} from '../src/v2-native-window-bridge.mjs';
import {MutationIdempotencyStore} from '../src/mutation-idempotency.mjs';

const [pidRaw,app,start,windowHandle,proofFile]=process.argv.slice(2);
const pid=Number(pidRaw),display=process.env.DISPLAY;
if(!Number.isSafeInteger(pid)||pid<1||!app||!start||!windowHandle||!proofFile||
 !process.env.DBUS_SESSION_BUS_ADDRESS||!/^:[0-9]+$/.test(display??''))
 throw Error('PRIVATE_XVFB_OWNER_BINDING_REQUIRED');
const target={
 targetId:'qa-window',hostId:'qa-linux',principalId:'qa-owner',seatId:'qa-seat',
 pid,windowHandle,processStartId:'gen-'+start,processStartTicks:start,
 applicationName:app,windowTitle:'Commander Bridge QA',present:true
};
const route=operationId=>({
 hostId:target.hostId,principalId:target.principalId,profileId:'qa-profile',
 conversationId:'qa-private-conversation',operationId,
 target:{kind:'app-window',id:target.targetId}
});
const transport=createV2AtspiTransport({
 ownerEnvironment:{DISPLAY:display,
  DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS,
  GTK_MODULES:'gail:atk-bridge',
  ...(process.env.XDG_RUNTIME_DIR?{XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR}:{})
 }
});
const provider=createV2LinuxAtspiProvider({
 resolveTarget:async()=>({...target}),transport,
 independentProof:async()=>{try{return readFileSync(proofFile,'utf8')==='APPLY_CLICKED'}
  catch{return false}}
});
const dir=mkdtempSync(join(tmpdir(),'v2-ats-bridge-'));
const receiptStore=new MutationIdempotencyStore({directory:dir,scope:'qa-native-bridge'});
function services(operationId,action,elementId){
 const nativeDriver=createV2HybridNativeDriver({platform:'linux',action,
  ...(elementId?{elementId}:{}),providers:{atspi:provider}});
 return {
  sessions:{resolveNativeRoute:async()=>route(operationId)},
  ownerSeat:async()=>target.seatId,
  authorizeWindow:async()=>true, // private fixture only, not user consent
  grants:{isAllowed:async()=>true}, // private fixture only
  nativeDriver,receiptStore,
  withLease:async(_key,fn)=>fn() // one local test writer, not a production lock
 };
}
try{
 const observation=await executeV2NativeWindowAction({
  route:route('observe-qa-1'),sessionHandle:'qa-owner-seat',
  action:'observe',services:services('observe-qa-1','observe')
 });
 assert.equal(observation.status,'OBSERVED');
 const buttons=observation.elements.filter(x=>x.name==='Apply'&&x.role==='button');
 assert.equal(buttons.length,1);
 const button=buttons[0];
 const actionServices=services('invoke-qa-1','invoke',button.id);
 const result=await executeV2NativeWindowAction({
  route:route('invoke-qa-1'),sessionHandle:'qa-owner-seat',
  action:'invoke',elementId:button.id,services:actionServices
 });
 assert.equal(result.status,'VERIFIED');
 assert.equal(readFileSync(proofFile,'utf8'),'APPLY_CLICKED');
 const second=await executeV2NativeWindowAction({
  route:route('invoke-qa-1'),sessionHandle:'qa-owner-seat',
  action:'invoke',elementId:button.id,services:actionServices
 });
 assert.deepEqual(second,result);
 console.log('V2_LINUX_ATSPI_NATIVE_BRIDGE_E2E_PASS');
 console.log('physicalDesktopInput=false; app=GTK3; result=VERIFIED; duplicateReceiptSame=true');
}finally{
 receiptStore.close();
 rmSync(dir,{recursive:true,force:true});
}
