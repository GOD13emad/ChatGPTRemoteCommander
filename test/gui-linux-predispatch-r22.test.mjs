// R22 coverage: stale GNOME frame must be rejected BEFORE focus or mouse input.
// Isolated synthetic callbacks. Never interacts with the actual user's desktop.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createGuiController} from '../src/gui-tools-windows.mjs';

const cfg={config:{powerMode:{enabled:true,guiControl:{
  enabled:true,allowScreenshot:true,allowMouse:true,allowKeyboard:true,allowWindowFocus:true
}}}};
function make(answer){
  let n=0,calls=0,closed=0;
  const inv=async req=>{
    if(req.action==='status') return {ok:true,available:true};
    if(req.action==='screenshot') return {
      ok:true,mimeType:'image/png',
      data:Buffer.from('89504e470d0a1a0a00000000','hex').toString('base64'),
      width:800,height:600,
      snapshot:{screenIndex:0,bounds:{left:0,top:0,width:800,height:600},
        foreground:'526674',processId:39176}
    };
    calls++;
    return answer(req);
  };
  const c=createGuiController({platform:'linux',now:()=>1000,
    token:()=>String(++n).padStart(48,'0'),isStopped:async()=>false,
    invoke:inv,closeInvoke:()=>closed++});
  return {run:(tool,args={})=>c.execute(cfg,tool,args),
    counts:()=>({calls,closed})};
}
async function arm(h){
  const {lease}=await h.run('gui_session_begin',{
    mode:'takeover',ttlSeconds:60,
    explicitUserAuthorization:'R22 synthetic isolated tests ONLY, no real input'
  });
  const image=await h.run('gui_screenshot',{lease});
  const frame=image.__structuredContent.frame;
  assert.ok(typeof frame==='string' && frame.length>30);
  return {lease,frame};
}
const inputCases=[
 {tool:'gui_focus_window',params:{handle:'18943002'}},
 {tool:'gui_mouse_click',params:{x:120,y:90,button:'left',clicks:1}},
 {tool:'gui_mouse_move',params:{x:120,y:90}},
 {tool:'gui_mouse_scroll',params:{delta:120}},
 {tool:'gui_mouse_drag',params:{from:{x:30,y:60},to:{x:160,y:120},button:'left'}},
 {tool:'gui_key_press',params:{keys:['A']}}
];
const certificate=()=>({ok:false,error:'GUI_FOREGROUND_OR_GEOMETRY_CHANGED',submission:'NOT_SUBMITTED'});
for(const {tool,params} of inputCases){
 test('R22 Linux '+tool+' pre-input geometry refusal drops stale lease/frame, never replays, stays ready',async()=>{
   const h=make(certificate),a=await arm(h);
   await assert.rejects(h.run(tool,{...a,...params}),/GUI_FOREGROUND_OR_GEOMETRY_CHANGED/);
   assert.equal((await h.run('gui_status')).available,true);
   assert.notEqual((await h.run('gui_status')).uncertain,true);
   assert.deepEqual(h.counts(),{calls:1,closed:1});
   await assert.rejects(h.run('gui_screenshot',{lease:a.lease}),/GUI_LEASE_REQUIRED_OR_EXPIRED/);
   const next=await h.run('gui_session_begin',{mode:'observe'});
   assert.notEqual(next.lease,a.lease);
   await assert.rejects(h.run(tool,{...params,lease:next.lease,frame:a.frame}),
     /GUI_TAKEOVER_NOT_AUTHORIZED|GUI_FRESH_FRAME_REQUIRED/);
   assert.equal(h.counts().calls,1);
 });
 for(const [kind,reply] of [
  ['extra',()=>({...certificate(),unexpected:true})],
  ['wrong-phase',()=>({ok:false,error:'GUI_OPERATION_TIMEOUT',submission:'NOT_SUBMITTED'})],
  ['missing',()=>({ok:false,error:'GUI_FOREGROUND_OR_GEOMETRY_CHANGED'})],
  ['exception',()=>{throw Error('GUI_FOREGROUND_OR_GEOMETRY_CHANGED')}]
 ]){
   test('R22 Linux '+tool+' '+kind+' remains fail-closed, no input replay',async()=>{
     const h=make(reply),a=await arm(h);
     await assert.rejects(h.run(tool,{...a,...params}),/GUI_/);
     assert.equal((await h.run('gui_status')).uncertain,true);
     await assert.rejects(h.run('gui_session_begin',{mode:'observe'}),/GUI_OUTCOME_UNCERTAIN/);
     assert.equal(h.counts().calls,1);
   });
 }
}
test('R22 GNOME exact pinned focus guard occurs before Meta.Window.activate',async()=>{
 const ext=await readFile(new URL('../gnome-extension/chatgpt-remote-commander-linux-safe-v2@god13emad/extension.js',import.meta.url),'utf8');
 const guard=ext.indexOf("if(action==='focusWindow'){this._guard(req);");
 const focus=ext.indexOf('matches[0].activate(',guard);
 assert.ok(guard>=0&&focus>guard,'focus native change requires prior geometry guard');
});
test('R22 Python AST-only helper proves no Mutter session on pre-input reject, including click and focus',t=>{
 if(process.platform!=='linux'){t.skip('Linux-specific Python helper');return;}
 const helper=fileURLToPath(new URL('../tools/gui-control-linux.py',import.meta.url));
 const offline=fileURLToPath(new URL('./gui-python-predispatch-r22.py',import.meta.url));
 const source=process.env.R22_EVIDENCE_OLD_HELPER ?? helper;
 const r=spawnSync('python3',['-B',offline,source],{encoding:'utf8',timeout:12000,maxBuffer:131072});
 assert.equal(r.status,0,'offline AST contract failure: '+String(r.stderr||r.stdout).slice(0,650));
 assert.match(r.stdout,/R22_PYTHON_PREINPUT_AST_PASS/);
});
