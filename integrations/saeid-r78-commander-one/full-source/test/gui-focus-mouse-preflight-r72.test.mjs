import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runGuiProcess,createGuiProcessClient} from '../src/gui-process.mjs';
import {createGuiController} from '../src/gui-tools-windows.mjs';
function fixtureTakeoverProvider(platform='win32'){
 const providerId='fixture-native-'+platform;
 const session={ownerPrincipal:'fixture-owner',sessionId:'fixture-session',seatId:'fixture-seat',displayId:'fixture-display',interactive:true,ownerAuthenticated:true};
 const grant=async({ttlSeconds=60}={})=>{
  const nowMs=Date.now();
  return {ok:true,takeoverEvidence:{provider:{providerId,platform,transport:'synthetic-test-provider',session,
   activityEvidenceSource:'physical',activityEvidenceIncludesSynthetic:false,isolationAuthority:null,
   capabilities:{observe:true,screenshot:true,activityDetection:true,physicalInputProtection:true,emergencyRelease:true,pointer:true,keyboard:true,semanticInvoke:true,isolatedDesktop:false}},
   expectedSession:session,activityEvidence:{source:'physical',reliable:true,excludesSyntheticInput:true,observedAtMs:nowMs,idleMs:60000},explicitOwnerApproval:false},
   inputProtectionReceipt:{active:true,kind:'NATIVE_PHYSICAL_INPUT_PROTECTION',providerId,sessionId:session.sessionId,
    leaseId:'fixture-protection-lease',releaseOnAgentExit:true,releaseOnEmergency:true,expiresAtMs:nowMs+ttlSeconds*1000}};
 };
 grant.release=async()=>({ok:true,released:true});
 return grant;
}
const root=fileURLToPath(new URL('..',import.meta.url));
const fixture=fileURLToPath(new URL('./fixtures/gui-r72-focus-receipt.mjs',import.meta.url));
const ctx={config:{powerMode:{enabled:true,guiControl:{enabled:true,allowScreenshot:true,allowMouse:true,allowKeyboard:true,allowWindowFocus:true}}}};
const image=()=>({ok:true,data:Buffer.from('89504e470d0a1a0a00000000','hex').toString('base64'),mimeType:'image/png',width:800,height:600,snapshot:{screenIndex:0,bounds:{left:0,top:0,width:800,height:600},foreground:'fixture-only',processId:33}});
const native=variant=>runGuiProcess({action:'focusWindow'},{file:process.execPath,args:[fixture,'oneshot',variant],timeoutMs:6000});
function setup({variant='valid',tool='gui_focus_window',pending=null,storageFailure=false,platform='win32'}={}){
 let calls=0,seq=0,resolves=0,record=pending;
 const store={pending:async()=>record,begin:async name=>{assert.equal(record,null);return record={id:'test-only-'+(++seq),tool:name};},resolve:async h=>{resolves++;if(storageFailure)throw Error('STORAGE_FAILED');assert.equal(h,record);record=null;}};
 const c=createGuiController({takeoverProvider:fixtureTakeoverProvider(platform),platform,now:()=>1000,token:()=>String(++seq).padStart(48,'0'),isStopped:async()=>false,incidentStore:store,
 invoke:async r=>r.action==='status'?{ok:true,available:true}:r.action==='screenshot'?image():(calls++,native(variant)),closeInvoke:()=>{}});
 return {run:(n,a={})=>c.execute(ctx,n,a),calls:()=>calls,resolves:()=>resolves,pending:()=>record};
}
async function arm(s){const {lease}=await s.run('gui_session_begin',{mode:'takeover',explicitUserAuthorization:'Private R72 protocol fixture only'});const pic=await s.run('gui_screenshot',{lease});return {lease,frame:pic.__structuredContent.frame};}
test('exact native receipt recognized in both one-shot and persistent clients',async()=>{
 await assert.rejects(native('valid'),e=>e.guiWindowsFocusMouseGuard===true&&e.guiNotApplied===true);
 const p=createGuiProcessClient({file:process.execPath,args:[fixture,'persistent','valid'],timeoutMs:6000});
 try{await assert.rejects(p.invoke({action:'focusWindow'}),e=>e.guiWindowsFocusMouseGuard===true&&e.guiNotApplied===true);}finally{p.close();}
});
for(const variant of ['missing','extra','wrongAction','wrongPhase','wrongEffect','wrongError'])test('reject malformed proof '+variant,async()=>{
 await assert.rejects(native(variant),e=>e.guiWindowsFocusMouseGuard!==true&&e.guiNotApplied!==true);
 const s=setup({variant});const old=await arm(s);await assert.rejects(s.run('gui_focus_window',{...old,handle:'111'}));
 assert.equal((await s.run('gui_status')).uncertain,true);assert.equal(s.resolves(),0);assert.equal(s.calls(),1);
});
test('fresh proven-not-applied focus resolves only its own pending intent; revokes lease/frame; no replay',async()=>{
 const s=setup(),old=await arm(s);await assert.rejects(s.run('gui_focus_window',{...old,handle:'111'}),/GUI_PHYSICAL_MOUSE_HELD/);
 assert.equal(s.pending(),null);assert.equal(s.resolves(),1);assert.equal(s.calls(),1);assert.equal((await s.run('gui_status')).available,true);
 await assert.rejects(s.run('gui_focus_window',{...old,handle:'111'}),/GUI_LEASE_REQUIRED_OR_EXPIRED/);assert.equal(s.calls(),1);
});
for(const [tool,args] of [['gui_mouse_click',{x:1,y:1}],['gui_mouse_move',{x:1,y:1}],['gui_key_press',{keys:['END']}],['gui_type_text',{text:'fixture'}]])test('focus proof cannot discharge '+tool,async()=>{
 const s=setup(),old=await arm(s);await assert.rejects(s.run(tool,{...old,...args}));assert.equal(s.resolves(),0);assert.equal((await s.run('gui_status')).uncertain,true);
});
test('historical pending incident is never dispatched or removed',async()=>{
 const incident={id:'historic-pending',tool:'gui_focus_window'},s=setup({pending:incident});
 await assert.rejects(s.run('gui_session_begin',{mode:'takeover',explicitUserAuthorization:'Private fixture authorization'}),/GUI_INCIDENT_REVIEW_REQUIRED/);
 assert.equal(s.pending(),incident);assert.equal(s.calls(),0);assert.equal(s.resolves(),0);
});
test('storage failure stays uncertain despite no-effect receipt',async()=>{
 const s=setup({storageFailure:true}),old=await arm(s);await assert.rejects(s.run('gui_focus_window',{...old,handle:'111'}),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);assert.notEqual(s.pending(),null);assert.equal((await s.run('gui_status')).uncertain,true);
});
test('Linux cannot consume the Windows Focus attestation',async()=>{
 const s=setup({platform:'linux'}),old=await arm(s);await assert.rejects(s.run('gui_focus_window',{...old,handle:'111'}));assert.equal(s.resolves(),0);assert.equal((await s.run('gui_status')).uncertain,true);
});
