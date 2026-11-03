// Windows WinForms native UIA through V2 owner-worker composition. Private QA
// only: synthetic platform proof, fixture-approved grant, single test lease.
// Not a production MCP deployment or a real ChatGPT session attestation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createV2NativeGuiOwnerWorker} from '../src/v2-native-gui-owner-worker.mjs';
import {createV2NativeOwnerSessionBindings} from '../src/v2-native-owner-session-bindings.mjs';
import {createV2WindowsNativeQaProviders,createV2WindowsNativeQaTransport}
 from '../src/v2-windows-native-qa-provider.mjs';
import {V2GrantRegistry} from '../src/v2-grant-registry.mjs';
import {MutationIdempotencyStore} from '../src/mutation-idempotency.mjs';

const [pidStr,hwnd,ticks,title,proof,script,scenario]=process.argv.slice(2);
const pid=Number(pidStr);
if(process.platform!=='win32'||!Number.isSafeInteger(pid)||pid<1||
 !/^[1-9][0-9]{0,18}$/.test(hwnd??'')||
 !/^[1-9][0-9]{0,19}$/.test(ticks??'')||
 title!=='Commander V2 Native QA'||!proof||!script)
 throw Error('QA_WIN_OWNER_WINDOW_REQUIRED');
const target={
 targetId:'qa-winform',hostId:'qa-win-host',principalId:'qa-win-owner',
 seatId:'qa-session-2',pid,windowHandle:hwnd,processStartId:'gen'+ticks,
 processStartTicks:ticks,windowTitle:title,present:true
};
const route=id=>({
 hostId:target.hostId,principalId:target.principalId,
 profileId:'qa-profile',conversationId:'qa-conversation',operationId:id,
 target:{kind:'app-window',id:target.targetId}
});
const bound=new Map([['observation',route('op-observe')],
 ['mutation',route('op-mutate')]]);
let current='observation';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v2-win-gui-worker-'));
const sessions=createV2NativeOwnerSessionBindings({
 attestPlatformSession:async p=>p?.syntheticQA===true&&bound.has(p.handle)?p.handle:null,
 resolveOwnerRoute:async handle=>bound.get(handle),
 observedNativeSession:async()=>target.seatId,
 authorizeBinding:async()=>true, // only the created private fixture
 authorizeRevocation:async()=>true,ttlMs:120000
});
const grants=new V2GrantRegistry({directory:path.join(dir,'grants'),
 authorizeAdministration:({actor})=>actor==='qa-owner'});
const receipts=new MutationIdempotencyStore({directory:path.join(dir,'receipts'),scope:'qa-win'});
const provider=createV2WindowsNativeQaProviders({
 resolveTarget:async()=>({...target}),
 transport:createV2WindowsNativeQaTransport({scriptPath:script}),
 independentProof:async()=>{try{return fs.readFileSync(proof,'utf8')==='APPLY_CLICKED'}
 catch{return false}}
});
const selectedProviders=scenario==='simulate-uia-unsupported'
 ? {uia:{...provider.uia,probe:async args=>{
    const result=await provider.uia.probe(args);
    return {supported:false,targetBound:result.targetBound};
   }},win32:provider.win32}
 : provider;
let leaseCalls=0;
const worker=createV2NativeGuiOwnerWorker({
 resolveTrustedInvocation:async()=>({sessionHandle:current,route:bound.get(current)}),
 sessions,grants,receiptStore:receipts,
 withLease:async(_key,callback)=>{leaseCalls++;return callback()},
 ownerSeat:async()=>target.seatId,
 authorizeNativeSession:async({route:r,seatId})=>
  r.target.id===target.targetId&&seatId===target.seatId,
 authorizeWindow:async({descriptor})=>descriptor.pid===pid,
 ownerProviders:async()=>({platform:'windows',providers:selectedProviders})
});
function grant(h,tool,status='ENABLED'){
 const r=bound.get(h),previous=grants.read(r,tool);
 grants.change({route:r,tool,status,expectedRevision:previous?.revision??0,
  actor:'qa-owner',reason:'private owner QA approval'});
}
try {
 for(const handle of bound.keys())await sessions.bindTrusted({syntheticQA:true,handle});
 grant('observation','workspace_window_observe');
 grant('mutation','workspace_window_invoke');
 const observed=await worker.execute({action:'observe'});
 assert.equal(observed.status,'OBSERVED');
 const matches=observed.elements.filter(e=>e.role==='button'&&e.name==='Apply');
 assert.equal(matches.length,1);
 current='mutation';
 const input={action:'invoke',elementId:matches[0].id};
 const result=await worker.execute(input);
 assert.equal(result.status,'VERIFIED');
 assert.equal(fs.readFileSync(proof,'utf8'),'APPLY_CLICKED');
 assert.deepEqual(await worker.execute(input),result);
 grant('mutation','workspace_window_invoke','REVOKED');
 await assert.rejects(worker.execute(input),{code:'V2_GRANT_REQUIRED'});
 assert.ok(leaseCalls>=3);
 console.log('V2_WINDOWS_OWNER_SESSION_WORKER_E2E_PASS');
 console.log('nativeMethod='+(scenario==='simulate-uia-unsupported'?'Win32':'UIA')+'; outcome=VERIFIED; independentProof=APPLY_CLICKED; duplicateEffect=false; revokedGrantBlocks=true; scenario='+(scenario??'native'));
 console.log('identity=synthetic-fixture-only; lease=single-QA-writer; publicMCP=false');
}finally{
 sessions.close();grants.close();receipts.close();
 fs.rmSync(dir,{recursive:true,force:true});
}
