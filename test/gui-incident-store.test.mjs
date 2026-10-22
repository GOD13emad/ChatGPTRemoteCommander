import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createGuiController} from '../src/gui-tools-windows.mjs';
import {createGuiInputIncidentStore} from '../src/gui-incident-store.mjs';
import {createGuiProcessClient} from '../src/gui-process.mjs';

const ownFile=async(run)=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-gui-incident-j01-'));
 const file=path.join(root,'gui-input-pending.json');
 try{return await run(file);}
 finally{await fs.rm(root,{recursive:true,force:true});}
};
const image=()=>({
  ok:true,data:Buffer.from('89504e470d0a1a0a00000000','hex').toString('base64'),
  mimeType:'image/png',width:800,height:600,
  snapshot:{screenIndex:0,bounds:{left:0,top:0,width:800,height:600},foreground:'test',processId:42}
});
const config={config:{powerMode:{enabled:true,guiControl:{
 enabled:true,allowScreenshot:true,allowMouse:true,allowKeyboard:true,allowWindowFocus:true
}}}};
function controller(incidentStore,{invoke=async(req)=>(req.action==='screenshot'?image():{ok:true,available:true}),platform='win32'}={}){
 let calls=0;
 const c=createGuiController({
  platform,incidentStore,token:()=>('a'.repeat(48)),isStopped:async()=>false,
  invoke:async req=>{calls++;return invoke(req);},closeInvoke:()=>{},
  now:()=>1000
 });
 return {run:(name,args={})=>c.execute(config,name,args),get calls(){return calls}};
}
async function takeover(c){
 const s=await c.run('gui_session_begin',{mode:'takeover',explicitUserAuthorization:'Disposable fixture permission'});
 const shot=await c.run('gui_screenshot',{lease:s.lease});
 return {lease:s.lease,frame:shot.__structuredContent.frame};
}
test('successful input creates minimum private evidence BEFORE dispatch and clears it on ack',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 let seen;
 const c=controller(store,{invoke:async req=>{
  if(req.action==='status')return {ok:true,available:true};
  if(req.action==='screenshot')return image();
  seen=JSON.parse(await fs.readFile(file,'utf8'));
  return {ok:true};
 }});
 const a=await takeover(c);
 const out=await c.run('gui_key_press',{...a,keys:['A']});
 assert.equal(out.submitted,true);
 assert.equal(out.visualVerificationRequired,true);
 assert.equal(seen.tool,'gui_key_press');
 assert.equal(seen.status,'PENDING_NATIVE_EFFECT');
 assert.deepEqual(Object.keys(seen).sort(),['id','schema','startedUtc','status','tool']);
 await assert.rejects(fs.readFile(file),{code:'ENOENT'});
 assert.equal(await store.pending(),null);
}));
test('unknown native input persists across fresh controller and never replays',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 const c=controller(store,{invoke:async req=>{
  if(req.action==='status')return {ok:true,available:true};
  if(req.action==='screenshot')return image();
  throw Error('GUI_SENDINPUT_FAILED secret-do-not-record');
 }});
 const a=await takeover(c);
 await assert.rejects(c.run('gui_type_text',{...a,text:'PRIVATE-INPUT-MUST-NOT-PERSIST'}),/GUI_SENDINPUT_FAILED/);
 const json=await fs.readFile(file,'utf8');
 assert.equal(json.includes('PRIVATE-INPUT'),false);
 assert.equal(json.includes('secret-do-not-record'),false);
 assert.equal(JSON.parse(json).tool,'gui_type_text');
 const fresh=controller(createGuiInputIncidentStore({file}));
 const status=await fresh.run('gui_status');
 assert.equal(status.uncertain,true);
 assert.equal(status.incidentPending,true);
 assert.equal(status.reason,'GUI_INCIDENT_REVIEW_REQUIRED');
 assert.equal(status.readOnlyAvailable,true);
 assert.equal(status.inputAvailable,false);
 const lease=await fresh.run('gui_session_begin',{mode:'observe'});
 assert.equal(lease.mode,'observe');
 await assert.rejects(fresh.run('gui_key_press',{lease:lease.lease,frame:'ignored',keys:['A']}),/GUI_INCIDENT_REVIEW_REQUIRED/);
 assert.equal(fresh.calls,2);
 assert.equal(await fs.readFile(file,'utf8'),json);
}));
test('strong Linux pre-dispatch no-effect proof clears pending evidence without replay',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 let attempted=0;
 const c=controller(store,{platform:'linux',invoke:async req=>{
  if(req.action==='status')return {ok:true,available:true};
  if(req.action==='screenshot')return image();
  attempted++;
  throw Object.assign(new Error('GUI_FOREGROUND_OR_GEOMETRY_CHANGED'),{
   guiCode:'GUI_FOREGROUND_OR_GEOMETRY_CHANGED',guiNotApplied:true
  });
 }});
 const a=await takeover(c);
 await assert.rejects(c.run('gui_mouse_click',{...a,x:7,y:8}),/GUI_FOREGROUND_OR_GEOMETRY_CHANGED/);
 assert.equal(await store.pending(),null);
 assert.equal(attempted,1);
 assert.equal((await c.run('gui_status')).available,true);
 const again=await c.run('gui_session_begin',{mode:'observe'});
 assert.equal(again.mode,'observe');
}));
test('corrupt incident fails closed; GUI helper is never invoked',()=>ownFile(async file=>{
 await fs.writeFile(file,'not-a-valid-incident');
 const store=createGuiInputIncidentStore({file});
 const c=controller(store);
 const v=await c.run('gui_status');
 assert.equal(v.available,false);
 assert.equal(v.incidentStoreUnavailable,true);
 assert.equal(v.reason,'GUI_INCIDENT_STORAGE_UNAVAILABLE');
 await assert.rejects(c.run('gui_session_begin',{mode:'observe'}),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 assert.equal(c.calls,0);
}));
test('wrong incident resolution identifier cannot erase a pending record',()=>ownFile(async file=>{
 const s=createGuiInputIncidentStore({file});
 const a=await s.begin('gui_mouse_click');
 await assert.rejects(s.resolve({...a,id:'different-id'}),/GUI_INCIDENT_RESOLUTION_MISMATCH/);
 assert.equal((await s.pending()).id,a.id);
 await s.resolve(a);
 assert.equal(await s.pending(),null);
}));
test('two processes cannot begin the same desktop input concurrently',()=>ownFile(async file=>{
 const x=createGuiInputIncidentStore({file}),y=createGuiInputIncidentStore({file});
 const [a,b]=await Promise.allSettled([x.begin('gui_mouse_click'),y.begin('gui_mouse_click')]);
 assert.equal([a,b].filter(z=>z.status==='fulfilled').length,1);
 assert.equal([a,b].filter(z=>z.status==='rejected').length,1);
 assert.ok(await x.pending());
}));
test('real child process termination leaves private pending evidence and blocks fresh controller',()=>ownFile(async file=>{
 const url=pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../src/gui-incident-store.mjs')).href;
 const script=[
  'import {createGuiInputIncidentStore} from '+JSON.stringify(url)+';',
  'const s=createGuiInputIncidentStore({file:process.argv.at(-1)});',
  "await s.begin('gui_mouse_click');",
  "process.kill(process.pid,'SIGKILL');"
 ].join('\n');
 const killed=spawnSync(process.execPath,['--input-type=module','-e',script,file],{
  encoding:'utf8',timeout:10000,windowsHide:true
 });
 assert.notEqual(killed.status,0);
 const fresh=controller(createGuiInputIncidentStore({file}));
 const status=await fresh.run('gui_status');
 assert.equal(status.available,false);
 assert.equal(status.inputAvailable,false);
 assert.equal(status.incidentPending,true);
 assert.equal(status.uncertain,true);
 const observed=await fresh.run('gui_session_begin',{mode:'observe'});
 assert.equal(observed.mode,'observe');
 await assert.rejects(fresh.run('gui_mouse_click',{lease:observed.lease,frame:'ignored',x:1,y:1}),/GUI_INCIDENT_REVIEW_REQUIRED/);
 assert.equal(fresh.calls,2);
 assert.equal((await fs.readFile(file,'utf8')).includes('PENDING_NATIVE_EFFECT'),true);
}));
test('read-only status and screenshot do not create a phantom incident',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 const c=controller(store);
 const s=await c.run('gui_status');
 assert.equal(s.available,true);
 const begin=await c.run('gui_session_begin',{mode:'observe'});
 await c.run('gui_screenshot',{lease:begin.lease});
 assert.equal(await store.pending(),null);
 await assert.rejects(fs.lstat(file),{code:'ENOENT'});
}));
test('incident file mode is private on POSIX hosts',()=>ownFile(async file=>{
 const s=createGuiInputIncidentStore({file});
 const receipt=await s.begin('gui_key_press');
 const mode=(await fs.stat(file)).mode;
 if(process.platform!=='win32')assert.equal(mode&0o077,0);
 await s.resolve(receipt);
}));

const privateClipDiag=()=>({
 schema:'rc-clipboard-transfer-observation-v1',reason:'NO_REQUEST',
 ownerConfirmed:true,selectionRequests:0,unsupportedRequests:0,
 successfulTransfers:0,waitMs:800
});

test('failed Linux paste stores only fixed phase counters and never clears uncertain incident',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 const c=controller(store,{platform:'linux',invoke:async req=>{
   if(req.action==='status')return {ok:true,available:true};
   if(req.action==='screenshot')return image();
   throw Object.assign(new Error('GUI_CLIPBOARD_PASTE_NOT_CONFIRMED'),{
      guiCode:'GUI_CLIPBOARD_PASTE_NOT_CONFIRMED',
      guiClipboardDiagnostic:privateClipDiag()
   });
 }});
 const a=await takeover(c);
 await assert.rejects(c.run('gui_type_text',{...a,text:'PRIVATE-PROJECT-USER-CONTENT-MUST-NOT-STORE'}),/GUI_CLIPBOARD_PASTE_NOT_CONFIRMED/);
 const bytes=await fs.readFile(file,'utf8'),record=JSON.parse(bytes);
 assert.equal(bytes.includes('PRIVATE-PROJECT-USER-CONTENT-MUST-NOT-STORE'),false);
 assert.equal(Object.hasOwn(record,'clipboardDiagnostic'),false,
   'original pending input identity must remain immutable');
 assert.deepEqual((await store.pending()).clipboardDiagnostic,privateClipDiag());
 assert.equal(record.status,'PENDING_NATIVE_EFFECT');
 assert.equal(record.tool,'gui_type_text');
 const fresh=controller(createGuiInputIncidentStore({file}),{platform:'linux'});
 const status=await fresh.run('gui_status');
 assert.equal(status.available,false);
 assert.equal(status.incidentPending,true);
 await assert.rejects(fresh.run('gui_session_begin',{mode:'observe'}),/GUI_OUTCOME_UNCERTAIN/);
 assert.equal(fresh.calls,0);
}));

test('diagnostic cannot persist clipboard text, forged schema or annotation for different handle',()=>ownFile(async file=>{
 const s=createGuiInputIncidentStore({file});
 const h=await s.begin('gui_type_text');
 await assert.rejects(s.annotateFailure(h,{...privateClipDiag(),text:'SECRET'}),/GUI_INCIDENT_DIAGNOSTIC_INVALID/);
 await assert.rejects(s.annotateFailure({...h,id:'wrong-id'},privateClipDiag()),/GUI_INCIDENT_RESOLUTION_MISMATCH/);
 const rec=JSON.parse(await fs.readFile(file,'utf8'));
 assert.equal(Object.hasOwn(rec,'clipboardDiagnostic'),false);
 await s.annotateFailure(h,privateClipDiag());
 await s.annotateFailure(h,privateClipDiag()); // identical repeat is a semantic NO-OP
 await assert.rejects(s.annotateFailure(h,{...privateClipDiag(),reason:'UNSUPPORTED_REQUEST',selectionRequests:1,unsupportedRequests:1}),/GUI_INCIDENT_DIAGNOSTIC_CONFLICT/);
 assert.equal((await s.pending()).id,h.id);
 assert.equal((await fs.readFile(file,'utf8')).includes('SECRET'),false);
}));

test('persistent GUI helper forwards only an exact approved clipboard observation schema',async ()=>{
 const diag=privateClipDiag();
 const script=[
  'process.stdout.write(JSON.stringify({ok:true,ready:true,protocol:1})+"\\n");',
  'process.stdin.on("data",()=>{process.stdout.write(JSON.stringify({ok:false,error:"GUI_CLIPBOARD_PASTE_NOT_CONFIRMED",clipboardDiagnostic:'+JSON.stringify(diag)+'})+"\\n");});'
 ].join('');
 const c=createGuiProcessClient({file:process.execPath,args:['-e',script],timeoutMs:5000,startupTimeoutMs:5000});
 try {
   await assert.rejects(c.invoke({action:'typeText'}),e=>{
     assert.equal(e.guiCode,'GUI_CLIPBOARD_PASTE_NOT_CONFIRMED');
     assert.notEqual(e.guiNotApplied,true);
     assert.deepEqual(e.guiClipboardDiagnostic,diag);
     return true;
   });
 } finally {c.close();}
});

test('annotation must never overwrite a different live pending input',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-incident-concurrent-'));
 const file=path.join(root,'pending.json');
 const s=createGuiInputIncidentStore({file});
 const other=createGuiInputIncidentStore({file});
 let interrupted;
 let release;
 const intercept=new Promise(ok=>{interrupted=ok});
 const resume=new Promise(ok=>{release=ok});
 const realRename=fs.rename;
 const realLink=fs.link;
 let hit=false;
 try {
  const old=await s.begin('gui_type_text');
  fs.rename=async(from,to)=>{
   if(!hit && to===file && path.basename(from).startsWith('.gui-input-diagnostic-')){
      hit=true; interrupted();
      await resume;
   }
   return realRename(from,to);
  };
  fs.link=async(from,to)=>{
   if(!hit && path.basename(to).startsWith('.gui-clipboard-observation-')){
      hit=true; interrupted();
      await resume;
   }
   return realLink(from,to);
  };
  const annotating=s.annotateFailure(old,privateClipDiag());
  let timeout;
  try {
    await Promise.race([
      intercept,
      new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('DIAGNOSTIC_PUBLICATION_NOT_REACHED')),1500)})
    ]);
  } finally {clearTimeout(timeout);}
  await assert.rejects(other.resolve(old),/GUI_INCIDENT_MUTATION_BUSY/);
  await assert.rejects(other.begin('gui_key_press'),/GUI_INCIDENT_MUTATION_BUSY/);
  await assert.rejects(other.pending(),/GUI_INCIDENT_MUTATION_BUSY/);
  release();
  await annotating;
  const observed=await other.pending();
  assert.equal(observed?.id,old.id,'annotation cannot delete the pending identity');
  assert.deepEqual(observed?.clipboardDiagnostic,privateClipDiag());
  await other.resolve(old);
  const later=await other.begin('gui_key_press');
  const found=await other.pending();
  assert.equal(found?.id,later.id,'new PENDING input must survive older annotation');
  assert.equal(found?.tool,'gui_key_press');
 }finally{
  release?.();
  fs.rename=realRename;
  fs.link=realLink;
  await fs.rm(root,{recursive:true,force:true});
 }
});

test('original pending identity is immutable and owner-private ID-scoped note cleans on resolve',()=>ownFile(async file=>{
 const s=createGuiInputIncidentStore({file});
 const h=await s.begin('gui_type_text');
 const original=await fs.readFile(file,'utf8');
 await s.annotateFailure(h,privateClipDiag());
 assert.equal(await fs.readFile(file,'utf8'),original,
   'annotation must not replace the original pending identity');
 const note=path.join(path.dirname(file),'.gui-clipboard-observation-'+h.id+'.json');
 const stat=await fs.lstat(note);
 assert.equal(stat.nlink,1);
 if(process.platform!=='win32')assert.equal(stat.mode&0o077,0);
 const contents=await fs.readFile(note,'utf8');
 assert.equal(contents.includes('PRIVATE'),false);
 assert.deepEqual((await s.pending()).clipboardDiagnostic,privateClipDiag());
 await s.resolve(h);
 await assert.rejects(fs.lstat(file),{code:'ENOENT'});
 await assert.rejects(fs.lstat(note),{code:'ENOENT'});
 assert.equal(await s.pending(),null);
}));

test('corrupt, linked or overbroad private diagnostic fails closed without deleting pending identity',()=>ownFile(async file=>{
 const s=createGuiInputIncidentStore({file});
 const h=await s.begin('gui_type_text');
 const original=await fs.readFile(file,'utf8');
 await s.annotateFailure(h,privateClipDiag());
 const note=path.join(path.dirname(file),'.gui-clipboard-observation-'+h.id+'.json');
 await fs.writeFile(note,JSON.stringify({
   schema:'rc-gui-clipboard-note-v1',incidentId:h.id,
   diagnostic:{...privateClipDiag(),text:'INTRUSIVE_PAYLOAD'}
 }));
 await assert.rejects(s.pending(),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 assert.equal(await fs.readFile(file,'utf8'),original);
 await fs.unlink(note);
 await s.resolve(h);
 assert.equal(await s.pending(),null);
}));


test('stale resolution cannot delete a new pending native input',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-gui-resolve-interleaving-'));
 const file=path.join(root,'incident.json');
 const a=createGuiInputIncidentStore({file});
 const b=createGuiInputIncidentStore({file});
 const original=fs.unlink;
 let pause, resume;
 const entered=new Promise(resolve=>{pause=resolve});
 const continued=new Promise(resolve=>{resume=resolve});
 let held=false;
 try{
   const first=await a.begin('gui_type_text');
   fs.unlink=async target=>{
      if(target===file && !held){held=true;pause();await continued;}
      return original(target);
   };
   const staleResolve=a.resolve(first);
   await Promise.race([entered,new Promise((_,reject)=>setTimeout(()=>reject(Error('NOT_INTERLEAVED')),1500))]);
   await assert.rejects(b.resolve(first),/GUI_INCIDENT_MUTATION_BUSY/);
   await assert.rejects(b.begin('gui_mouse_click'),/GUI_INCIDENT_MUTATION_BUSY/);
   await assert.rejects(b.pending(),/GUI_INCIDENT_MUTATION_BUSY/);
   resume();
   await staleResolve;
   const second=await b.begin('gui_mouse_click');
   const current=await b.pending();
   assert.equal(current?.id,second.id,'the newly created incident must remain pending');
   assert.equal(current?.tool,'gui_mouse_click');
 }finally{
   resume?.();
   fs.unlink=original;
   await fs.rm(root,{recursive:true,force:true});
 }
});

test('a persisted mutation lock fails closed on new controller, never auto-expires',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 const receipt=await store.begin('gui_type_text');
 const lock=path.join(path.dirname(file),'.gui-pending-input-mutation.lock');
 await fs.mkdir(lock,{mode:0o700});
 try {
   const restarted=createGuiInputIncidentStore({file});
   await assert.rejects(restarted.pending(),/GUI_INCIDENT_MUTATION_BUSY/);
   await assert.rejects(restarted.begin('gui_key_press'),/GUI_INCIDENT_MUTATION_BUSY/);
   await assert.rejects(restarted.resolve(receipt),/GUI_INCIDENT_MUTATION_BUSY/);
   const guarded=controller(restarted,{platform:'linux'});
   const status=await guarded.run('gui_status');
   assert.equal(status.available,false);
   assert.equal(status.incidentStoreUnavailable,true);
   assert.equal(guarded.calls,0);
   assert.equal((await fs.lstat(lock)).isDirectory(),true);
   assert.equal((await fs.lstat(file)).isFile(),true);
 } finally { await fs.rmdir(lock); }
 await store.resolve(receipt);
 assert.equal(await store.pending(),null);
}));
