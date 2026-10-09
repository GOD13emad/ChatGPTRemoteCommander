import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runGuiProcess, createGuiProcessClient } from '../src/gui-process.mjs';
import { createGuiController } from '../src/gui-tools-windows.mjs';

const fixture=fileURLToPath(new URL('./fixtures/gui-native-busy-stub.mjs',import.meta.url));
const config={config:{powerMode:{enabled:true,guiControl:{enabled:true,allowScreenshot:true,allowMouse:true,allowKeyboard:true,allowWindowFocus:true}}}};
const image=()=>({ok:true,mimeType:'image/png',data:Buffer.from('89504e470d0a1a0a00000000','hex').toString('base64'),
width:800,height:600,snapshot:{screenIndex:0,bounds:{left:0,top:0,width:800,height:600},foreground:'526674',processId:39176}});
const make=(mutator)=>{
 let tokenCounter=0,mutations=0,closeCount=0;
 const native=async r=>{
  if(r.action==='status')return {ok:true,available:true};
  if(r.action==='screenshot')return image();
  mutations++;
  return mutator(r);
 };
 const c=createGuiController({platform:'win32',now:()=>1000,token:()=>String(++tokenCounter).padStart(48,'0'),isStopped:async()=>false,
  invoke:native,closeInvoke:()=>{closeCount++}});
 return {run:(name,args={})=>c.execute(config,name,args),mutations:()=>mutations,closeCount:()=>closeCount};
};
const arm=async s=>{
 const {lease}=await s.run('gui_session_begin',{mode:'takeover',explicitUserAuthorization:'Fixture user authorization'});
 const frame=(await s.run('gui_screenshot',{lease})).__structuredContent.frame;
 return {lease,frame};
};
test('exact native busy receipt parses without downgrading any other helper error (one-shot)',async()=>{
 const result=await runGuiProcess({action:'status'},{file:process.execPath,args:[fixture,'oneshot','valid'],timeoutMs:5000});
 assert.deepEqual(result,{ok:false,error:'GUI_NATIVE_BUSY',submission:'NOT_SUBMITTED'});
 for(const code of ['missing','extra','other']){
  await assert.rejects(runGuiProcess({action:'status'},{file:process.execPath,args:[fixture,'oneshot',code],timeoutMs:5000}),/GUI_NATIVE_BUSY|GUI_NATIVE_FAILED/);
 }
});
test('same exact native receipt survives bounded persistent helper parsing',async()=>{
 const h=createGuiProcessClient({file:process.execPath,args:[fixture,'persistent','valid'],timeoutMs:5000,startupTimeoutMs:5000});
 try{const result=await h.invoke({action:'focusWindow'});assert.deepEqual(result,{ok:false,error:'GUI_NATIVE_BUSY',submission:'NOT_SUBMITTED'});}finally{h.close();}
});
test('verified non-submission invalidates old lease and frame but does not mark input uncertain',async()=>{
 const s=make(()=>({ok:false,error:'GUI_NATIVE_BUSY',submission:'NOT_SUBMITTED'}));
 const a=await arm(s);
 await assert.rejects(s.run('gui_focus_window',{...a,handle:'18943002'}),/GUI_NATIVE_BUSY/);
 const status=await s.run('gui_status');
 assert.notEqual(status.uncertain,true);assert.equal(status.available,true);
 await assert.rejects(s.run('gui_screenshot',{lease:a.lease}),/GUI_LEASE_REQUIRED_OR_EXPIRED/);
 assert.equal(s.mutations(),1);assert.equal(s.closeCount(),1);
 const next=await s.run('gui_session_begin',{mode:'observe'});
 assert.notEqual(next.lease,a.lease);
 await assert.rejects(s.run('gui_focus_window',{lease:next.lease,frame:a.frame,handle:'526674'}),/GUI_FRESH_FRAME_REQUIRED|GUI_TAKEOVER_NOT_AUTHORIZED/);
 assert.equal(s.mutations(),1);
});
for(const [label,response] of [
 ['naked',()=>({ok:false,error:'GUI_NATIVE_BUSY'})],
 ['other error with forged marker',()=>({ok:false,error:'GUI_NATIVE_FAILED',submission:'NOT_SUBMITTED'})],
 ['exception',()=>{throw Error('GUI_NATIVE_BUSY')}]
]){
 test('unproven '+label+' is still fail-closed and cannot be retried',async()=>{
  const s=make(response),a=await arm(s);
  await assert.rejects(s.run('gui_focus_window',{...a,handle:'18943002'}),/GUI_/);
  const status=await s.run('gui_status');assert.equal(status.uncertain,true);
  await assert.rejects(s.run('gui_screenshot',{lease:a.lease}),/GUI_OUTCOME_UNCERTAIN/);
  assert.equal(s.mutations(),1);
 });
}
test('read-only status receiving busy native receipt rejects without false readiness or uncertain latch',async()=>{
 let n=0;
 const c=createGuiController({platform:'win32',now:()=>1000,isStopped:async()=>false,invoke:async()=>{n++;return {ok:false,error:'GUI_NATIVE_BUSY',submission:'NOT_SUBMITTED'}}});
 await assert.rejects(c.execute(config,'gui_status',{}),/GUI_NATIVE_BUSY/);
 await assert.rejects(c.execute(config,'gui_session_begin',{}),/GUI_NATIVE_BUSY/);
 assert.equal(n,2);
});
