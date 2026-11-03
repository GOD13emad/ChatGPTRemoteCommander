// Private Linux GTK3/Xvfb integration for the owner-session composition.
// Actual native AT-SPI input; synthetic attested chat and grants are TEST ONLY.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createV2NativeGuiOwnerWorker} from '../src/v2-native-gui-owner-worker.mjs';
import {createV2NativeOwnerSessionBindings} from '../src/v2-native-owner-session-bindings.mjs';
import {createV2AtspiTransport,createV2LinuxAtspiProvider} from '../src/v2-linux-atspi-provider.mjs';
import {V2GrantRegistry} from '../src/v2-grant-registry.mjs';
import {MutationIdempotencyStore} from '../src/mutation-idempotency.mjs';
import {V2CentralCoordinator} from '../src/v2-central-coordinator.mjs';
import {createV2GuiCoordinatorLeaseBindings} from '../src/v2-gui-coordinator-lease-bindings.mjs';
const [pidRaw,appName,startTicks,hwnd,proofPath]=process.argv.slice(2);
const pid=Number(pidRaw),display=process.env.DISPLAY;
if(process.platform!=='linux'||!Number.isSafeInteger(pid)||pid<=0||
 !appName||!/^[1-9][0-9]{0,22}$/.test(startTicks??'')||
 !/^[1-9][0-9]{0,19}$/.test(hwnd??'')||!proofPath||
 !/^:[0-9]+$/.test(display??'')||!process.env.DBUS_SESSION_BUS_ADDRESS)
 throw Error('PRIVATE_XVFB_OWNER_QA_REQUIRED');
const target=Object.freeze({
 targetId:'qa-owner-window',hostId:'qa-linux',principalId:'qa-owner',
 seatId:'qa-xvfb-seat',pid,windowHandle:hwnd,processStartId:'gen'+startTicks,
 processStartTicks:startTicks,applicationName:appName,windowTitle:'Commander Bridge QA',
 present:true
});
const route=operationId=>({
 hostId:target.hostId,principalId:target.principalId,profileId:'qa-profile',
 conversationId:'qa-test-chat',operationId,
 target:{kind:'app-window',id:target.targetId}
});
const routes=new Map([['qa-observe',route('qa-operation-observe')],
 ['qa-invoke',route('qa-operation-invoke')]]);
let activeHandle='qa-observe';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v2-gui-owner-qa-'));
const sessions=createV2NativeOwnerSessionBindings({
 attestPlatformSession:async proof=>proof?.qaSynthetic===true&&routes.has(proof.handle)?proof.handle:null,
 resolveOwnerRoute:async h=>routes.get(h),
 observedNativeSession:async()=>target.seatId,
 authorizeBinding:async()=>true, // fixture approval, NOT real ChatGPT attestation
 authorizeRevocation:async()=>true,ttlMs:120000
});
const grants=new V2GrantRegistry({directory:path.join(dir,'grants'),
 authorizeAdministration:({actor})=>actor==='qa-owner'});
const receipts=new MutationIdempotencyStore({
 directory:path.join(dir,'receipts'),scope:'qa-owner-native'
});
const transport=createV2AtspiTransport({ownerEnvironment:{
 DISPLAY:display,DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS,
 GTK_MODULES:'gail:atk-bridge'
}});
const provider=createV2LinuxAtspiProvider({
 resolveTarget:async()=>({...target}),transport,
 independentProof:async()=>{try{return fs.readFileSync(proofPath,'utf8')==='APPLY_CLICKED'}
 catch{return false}}
});
let leaseCount=0;
const centralized=process.env.V2_QA_COORDINATOR_MODE==='central';
const trustedInvocation=async()=>({sessionHandle:activeHandle,route:routes.get(activeHandle)});
const rawOwnerProviders=async()=>({platform:'linux',providers:{atspi:provider}});
const coordinator=centralized?new V2CentralCoordinator({
 directory:path.join(dir,'central'),ttlMs:30000,
 authorizeLease:async r=>r.hostId===target.hostId&&r.principalId===target.principalId,
 resolveGlobalResource:async r=>r.target.kind==='app-window'?'qa-private-xvfb-seat':null,
 requireGlobalResource:true
}):null;
const central=centralized?createV2GuiCoordinatorLeaseBindings({
 coordinator,resolveTrustedInvocation:trustedInvocation,sessions,
 ownerProviders:rawOwnerProviders,ttlMs:30000
}):null;
const worker=createV2NativeGuiOwnerWorker({
 resolveTrustedInvocation:trustedInvocation,
 sessions,grants,receiptStore:receipts,
 withLease:async(resource,run)=>{
  leaseCount++;
  return centralized?central.withLease(resource,run):run();
 },
 ownerSeat:async()=>target.seatId,
 authorizeNativeSession:async({seatId,route:r})=>
  seatId===target.seatId&&r.target.id===target.targetId,
 authorizeWindow:async({descriptor})=>descriptor.pid===target.pid,
 ownerProviders:centralized?central.ownerProviders:rawOwnerProviders
});
function grant(handle,tool,status='ENABLED'){
 const r=routes.get(handle),existing=grants.read(r,tool);
 grants.change({route:r,tool,status,expectedRevision:existing?.revision??0,
  actor:'qa-owner',reason:'isolated authorized test operation'});
}
try{
 for(const h of routes.keys())await sessions.bindTrusted({qaSynthetic:true,handle:h});
 grant('qa-observe','workspace_window_observe');
 grant('qa-invoke','workspace_window_invoke');
 const observed=await worker.execute({action:'observe'});
 assert.equal(observed.status,'OBSERVED');
 const buttons=observed.elements.filter(e=>e.role==='button'&&e.name==='Apply');
 assert.equal(buttons.length,1);
 activeHandle='qa-invoke';
 const input={action:'invoke',elementId:buttons[0].id};
 const once=await worker.execute(input);
 assert.equal(once.status,'VERIFIED');
 assert.equal(fs.readFileSync(proofPath,'utf8'),'APPLY_CLICKED');
 const twice=await worker.execute(input);
 assert.deepEqual(twice,once);
 grant('qa-invoke','workspace_window_invoke','REVOKED');
 await assert.rejects(worker.execute(input),{code:'V2_GRANT_REQUIRED'});
 assert.ok(leaseCount>=3);
 console.log(centralized?'V2_LINUX_OWNER_SESSION_CENTRAL_FENCE_E2E_PASS':'V2_LINUX_OWNER_SESSION_WORKER_E2E_PASS');
 console.log('native=AT-SPI; outcome=VERIFIED; independentProof=APPLY_CLICKED; duplicateEffect=false; revokedGrantBlocks=true');
 console.log('identity=synthetic-fixture-only; lease='+(centralized?'durable-central-sqlite-global-qa-fence':'single-QA-writer')+'; publicMCP=false');
}finally{
 sessions.close();grants.close();receipts.close();coordinator?.close();
 fs.rmSync(dir,{recursive:true,force:true});
}
