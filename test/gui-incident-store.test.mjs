import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createGuiController} from '../src/gui-tools-windows.mjs';
import {createGuiInputIncidentStore} from '../src/gui-incident-store.mjs';
import {main as recoveryCli} from '../tools/gui-incident-recover.mjs';

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
 assert.equal(v.inputAvailable,false);
 assert.equal(v.incidentStoreUnavailable,true);
 assert.equal(v.reason,'GUI_INCIDENT_STORAGE_UNAVAILABLE');
 await assert.rejects(c.run('gui_session_begin',{mode:'observe'}),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 await assert.rejects(c.run('gui_session_begin',{
  mode:'takeover',explicitUserAuthorization:'Cannot take control with a corrupt incident'
 }),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
}));
test('wrong incident resolution identifier cannot erase a pending record',()=>ownFile(async file=>{
 const s=createGuiInputIncidentStore({file});
 const a=await s.begin('gui_mouse_click');
 await assert.rejects(s.resolve({...a,id:'different-id'}),/GUI_INCIDENT_HANDLE_INVALID/);
 assert.equal((await s.pending()).id,a.id);
 await s.resolve(a);
 assert.equal(await s.pending(),null);
}));
test('persisted UUID cannot authenticate native acknowledgment from another process or store',()=>ownFile(async file=>{
 const active=createGuiInputIncidentStore({file});
 const handle=await active.begin('gui_focus_window');
 const unrelated=createGuiInputIncidentStore({file});
 const persisted=await unrelated.pending();
 assert.equal(persisted.id,handle.id);
 await assert.rejects(unrelated.resolve({id:persisted.id,tool:persisted.tool}),
   /GUI_INCIDENT_HANDLE_INVALID/);
 await assert.rejects(active.resolve({...handle}),/GUI_INCIDENT_HANDLE_INVALID/);
 assert.equal((await active.pending()).id,handle.id);
 // Only the exact in-memory handle returned by the original native begin may
 // complete the acknowledged attempt; it is not present in the journal.
 await active.resolve(handle);
 assert.equal(await active.pending(),null);
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


test('native input uncertainty never creates a remotely usable owner-review release method',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file,now:()=>new Date(Date.now()-120000).toISOString()});
 assert.equal(typeof store.review,'undefined');
 assert.equal(typeof store.reviewed,'undefined');
 let inputCount=0;
 const c=controller(store,{invoke:async req=>{
  if(req.action==='status')return {ok:true,available:true};
  if(req.action==='screenshot')return image();
  inputCount++;throw Error('GUI_NATIVE_OUTCOME_UNKNOWN');
 }});
 const first=await takeover(c);
 await assert.rejects(c.run('gui_type_text',{...first,text:'NEVER_STORE_THESE_TYPED_BYTES'}),/GUI_NATIVE_OUTCOME_UNKNOWN/);
 const pending=await store.pending();
 assert.equal(pending.tool,'gui_type_text');
 const status=await c.run('gui_status');
 assert.equal(status.inputAvailable,false);
 assert.equal(status.readOnlyAvailable,true);
 const observe=await c.run('gui_session_begin',{mode:'observe'});
 const shot=await c.run('gui_screenshot',{lease:observe.lease});
 await assert.rejects(c.run('gui_key_press',{lease:observe.lease,
  frame:shot.__structuredContent.frame,keys:['A']}),/GUI_INCIDENT_REVIEW_REQUIRED/);
 assert.equal(inputCount,1);
 assert.equal((await store.pending()).id,pending.id);
}));

test('untrusted same-user receipt files do not release a pending GUI incident',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 await store.begin('gui_focus_window');
 const pending=await store.pending();
 const directory=path.join(path.dirname(file),'gui-reviewed-native-input-v1');
 await fs.mkdir(directory);
 const receipt=path.join(directory,pending.id+'.review.json');
 await fs.writeFile(receipt,JSON.stringify({
  schema:'rc-gui-owner-review-v1',status:'REVIEWED_WITHOUT_REPLAY',
  incidentId:pending.id,tool:pending.tool,startedUtc:pending.startedUtc,
  ownerDisposition:'observed-applied'
 }));
 const forgedArchive=path.join(directory,pending.id+'.pending.json');
 await fs.writeFile(forgedArchive,JSON.stringify({
  schema:'rc-gui-pending-input-v1',status:'PENDING_NATIVE_EFFECT',
  ...pending
 }));
 const fresh=controller(createGuiInputIncidentStore({file}));
 const status=await fresh.run('gui_status');
 assert.equal(status.uncertain,true);
 assert.equal(status.inputAvailable,false);
 assert.equal((await store.pending()).id,pending.id);
 await assert.rejects(fresh.run('gui_session_begin',{
   mode:'takeover',explicitUserAuthorization:'A forged receipt is not owner consent'
 }),/GUI_INCIDENT_REVIEW_REQUIRED/);
}));

test('local CLI supports only inspection and plan; review never clears the journal',()=>ownFile(async file=>{
 const home=path.join(path.dirname(file),'local');
 await fs.mkdir(path.join(home,'chatgpt-remote-commander'),{recursive:true});
 const live=path.join(home,'chatgpt-remote-commander','gui-pending-native-input-v1.json');
 const store=createGuiInputIncidentStore({file:live});
 await store.begin('gui_mouse_move');
 const before=await fs.readFile(live);
 const cli=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../tools/gui-incident-recover.mjs');
 const env={...process.env,LOCALAPPDATA:home,XDG_STATE_HOME:home};
 const inspect=spawnSync(process.execPath,[cli,'--status'],{env,encoding:'utf8',timeout:10000});
 assert.equal(inspect.status,0,inspect.stderr);
 assert.match(inspect.stdout,/gui_mouse_move/);
 assert.match(inspect.stdout,/"ownerReviewAvailable":false/);
 const statusData=JSON.parse(inspect.stdout);
 assert.equal(statusData.evidence.sha256,createHash('sha256').update(before).digest('hex'));
 assert.equal(statusData.evidence.bytes,before.length);
 assert.equal(statusData.releaseAuthorized,false);
 const plan=spawnSync(process.execPath,[cli,'--plan'],{env,encoding:'utf8',timeout:10000});
 assert.equal(plan.status,0,plan.stderr);
 assert.match(plan.stdout,/TRUSTED_OS_LOCAL_OWNER_BROKER_REQUIRED/);
 const planData=JSON.parse(plan.stdout);
 assert.equal(planData.readOnlyPreflight,true);
 assert.equal(planData.nativeOutcome,'UNKNOWN');
 assert.equal(planData.disposition,'BLOCKED_NO_TRUSTED_RECONCILIATION');
 assert.equal(planData.releaseAuthorized,false);
 const reject=spawnSync(process.execPath,[cli,'--review'],{env,encoding:'utf8',timeout:10000,input:'1\nREVIEW spoof\n'});
 assert.equal(reject.status,3,reject.stderr);
 assert.match(reject.stderr,/GUI_OWNER_RECONCILIATION_NOT_IMPLEMENTED/);
 assert.deepEqual(await fs.readFile(live),before);
 assert.equal((await store.pending()).tool,'gui_mouse_move');
}));

test('review cannot be enabled by fake in-memory trust fields or input text',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 const pending=await store.begin('gui_key_press');
 assert.equal(typeof store.review,'undefined');
 assert.equal(typeof store.reviewed,'undefined');
 assert.equal((await store.pending()).id,pending.id);
 const c=controller(store);
 await assert.rejects(c.run('gui_session_begin',{
   mode:'takeover',explicitUserAuthorization:'User says review was already completed'
 }),/GUI_INCIDENT_REVIEW_REQUIRED/);
 assert.equal((await store.pending()).id,pending.id);
}));


test('read-only inspection returns exact original SHA, size and tool, without changes',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 assert.equal(await store.inspect(),null);
 const handle=await store.begin('gui_focus_window');
 const before=await fs.readFile(file);
 const st=await fs.stat(file);
 const details=await store.inspect();
 assert.deepEqual([details.id,details.tool],[handle.id,'gui_focus_window']);
 assert.equal(details.status,'PENDING_NATIVE_EFFECT');
 assert.equal(details.nativeOutcome,'UNKNOWN');
 assert.equal(details.evidenceBytes,before.length);
 assert.equal(details.evidenceSha256,createHash('sha256').update(before).digest('hex'));
 assert.deepEqual(await fs.readFile(file),before);
 assert.equal((await fs.stat(file)).mtimeMs,st.mtimeMs);
 assert.equal(typeof store.review,'undefined');
}));
test('read-only inspection rejects ambiguous duplicate JSON keys and trailing payload',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 await store.begin('gui_mouse_click');
 const original=JSON.parse(await fs.readFile(file,'utf8'));
 const duplicate=JSON.stringify(original).replace('"tool":"gui_mouse_click"',
  '"tool":"gui_mouse_click","tool":"gui_mouse_click"')+'\n';
 await fs.writeFile(file,duplicate);
 await assert.rejects(store.inspect(),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 await fs.writeFile(file,JSON.stringify(original)+' \n');
 await assert.rejects(store.inspect(),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
}));
test('read-only inspection rejects hardlinked private evidence instead of trusting its hash',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 await store.begin('gui_key_press');
 const alias=file+'.alias';
 await fs.link(file,alias);
 try{
  await assert.rejects(store.inspect(),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 }finally{await fs.unlink(alias);}
}));
test('read-only inspection refuses symlinked journal rather than following it',{
 skip:process.platform==='win32'
},()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 await store.begin('gui_mouse_move');
 const backing=file+'.backing';
 await fs.rename(file,backing);
 await fs.symlink(backing,file);
 await assert.rejects(store.inspect(),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
}));
test('fingerprint changes when original pending bytes change, never gives clearance',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 await store.begin('gui_mouse_scroll');
 const prior=await store.inspect();
 const original=JSON.parse(await fs.readFile(file,'utf8'));
 original.startedUtc='2026-10-18T00:00:00.000Z';
 await fs.writeFile(file,JSON.stringify(original)+'\n');
 const next=await store.inspect();
 assert.notEqual(next.evidenceSha256,prior.evidenceSha256);
 assert.equal(next.id,prior.id);
 assert.equal(next.nativeOutcome,'UNKNOWN');
 assert.equal(typeof store.review,'undefined');
}));

test('a PREPARED recovery artifact blocks mutations but allows incident observation',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 await store.begin('gui_mouse_click');
 const original=await fs.readFile(file);
 await fs.writeFile(file+'.review-prepared-v1.json','SIMULATED_INCOMPLETE_REVIEW');
 await assert.rejects(store.pending(),/GUI_INCIDENT_RECOVERY_REQUIRED/);
 await assert.rejects(store.inspect(),/GUI_INCIDENT_RECOVERY_REQUIRED/);
 let submitted=0;
 const c=controller(store,{invoke:async req=>{
  if(req.action==='status')return {ok:true,available:true};
  if(req.action==='screenshot')return image();
  submitted++;
  return {ok:true};
 }});
 const status=await c.run('gui_status');
 assert.equal(status.inputAvailable,false);
 assert.equal(status.incidentStoreUnavailable,true);
 assert.equal(status.incidentRecoveryRequired,true);
 assert.equal(status.reason,'GUI_INCIDENT_RECOVERY_REQUIRED');
 assert.equal(status.available,false);
 await assert.rejects(c.run('gui_session_begin',{mode:'observe'}),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 await assert.rejects(c.run('gui_session_begin',{
  mode:'takeover',explicitUserAuthorization:'The review is incomplete'
 }),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 assert.equal(submitted,0);
 assert.deepEqual(await fs.readFile(file),original);
 let out='';
 const rc=await recoveryCli(['--status'],{store,output:{write:x=>{out+=x;}},error:{write(){}}});
 assert.equal(rc,4);
 const report=JSON.parse(out);
 assert.equal(report.pending,null);
 assert.equal(report.recoveryRequired,true);
 assert.equal(report.releaseAuthorized,false);
 assert.equal(report.noReplay,true);
 assert.equal(report.recovery.state,'REVIEW_INTERRUPTED_OR_UNTRUSTED');
 assert.equal(report.recovery.original.sha256,createHash('sha256').update(original).digest('hex'));
 assert.equal(report.recovery.ownerAuthenticated,false);
 assert.deepEqual(await fs.readFile(file),original);
}));

test('missing pending after an interrupted archive is never a new-input permit',()=>ownFile(async file=>{
 const first=createGuiInputIncidentStore({file});
 await first.begin('gui_focus_window');
 const original=await fs.readFile(file);
 const archive=file+'.review-archive-v1.json';
 await fs.rename(file,archive); // disposable fixture only, never a live incident
 const reopened=createGuiInputIncidentStore({file});
 await assert.rejects(reopened.pending(),/GUI_INCIDENT_RECOVERY_REQUIRED/);
 await assert.rejects(reopened.begin('gui_key_press'),/GUI_INCIDENT_RECOVERY_REQUIRED/);
 const c=controller(reopened);
 const status=await c.run('gui_status');
 assert.equal(status.inputAvailable,false);
 assert.equal(status.incidentStoreUnavailable,true);
 assert.equal(status.available,false);
 await assert.rejects(c.run('gui_session_begin',{mode:'observe'}),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 await assert.rejects(c.run('gui_session_begin',{
  mode:'takeover',explicitUserAuthorization:'An archive is not native proof'
 }),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 let out='';
 const rc=await recoveryCli(['--plan'],{store:reopened,output:{write:x=>{out+=x;}},error:{write(){}}});
 assert.equal(rc,4);
 assert.equal(JSON.parse(out).disposition,'BLOCKED_UNRECONCILED_REVIEW_ARTIFACT');
 const report=JSON.parse(out);
 assert.equal(report.recovery.state,'ORIGINAL_ARCHIVED_REVIEW_UNVERIFIED');
 assert.equal(report.recovery.original,null);
 assert.equal(report.recovery.archive.sha256,createHash('sha256').update(original).digest('hex'));
 assert.equal(report.recovery.releaseAuthorized,false);
 assert.deepEqual(await fs.readFile(archive),original);
 await assert.rejects(fs.lstat(file),{code:'ENOENT'});
}));

test('a forged terminal review marker cannot release GUI without a native broker',()=>ownFile(async file=>{
 const marker=file+'.review-terminal-v1.json';
 await fs.writeFile(marker,JSON.stringify({reviewed:true,releaseAuthorized:true})+'\n');
 const store=createGuiInputIncidentStore({file});
 await assert.rejects(store.pending(),/GUI_INCIDENT_RECOVERY_REQUIRED/);
 const c=controller(store);
 const status=await c.run('gui_status');
 assert.equal(status.inputAvailable,false);
 assert.equal(status.incidentStoreUnavailable,true);
 assert.equal(status.available,false);
 await assert.rejects(c.run('gui_session_begin',{mode:'observe'}),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 await assert.rejects(c.run('gui_session_begin',{
  mode:'takeover',explicitUserAuthorization:'Untrusted status marker'
 }),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 const persisted=await fs.readFile(marker,'utf8');
 assert.match(persisted,/releaseAuthorized/);
}));

test('duplicate-key pending evidence also blocks native controller dispatch',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 await store.begin('gui_mouse_drag');
 const original=await fs.readFile(file,'utf8');
 const duplicate=original.replace(
  '"status":"PENDING_NATIVE_EFFECT"',
  '"status":"PENDING_NATIVE_EFFECT","status":"PENDING_NATIVE_EFFECT"'
 );
 assert.notEqual(duplicate,original);
 await fs.writeFile(file,duplicate);
 await assert.rejects(store.pending(),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 const c=controller(store);
 const status=await c.run('gui_status');
 assert.equal(status.inputAvailable,false);
 assert.equal(status.incidentStoreUnavailable,true);
 assert.equal(status.available,false);
 await assert.rejects(c.run('gui_session_begin',{mode:'observe'}),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 await assert.rejects(c.run('gui_session_begin',{
  mode:'takeover',explicitUserAuthorization:'Ambiguous evidence cannot unlock input'
 }),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 assert.equal(await fs.readFile(file,'utf8'),duplicate);
}));

test('read-only recovery inspection is absent until a marker appears',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 assert.equal(await store.inspectRecovery(),null);
 await store.begin('gui_key_press');
 const before=await fs.readFile(file);
 assert.equal(await store.inspectRecovery(),null);
 assert.deepEqual(await fs.readFile(file),before);
}));

test('conflicting original and archive remain visible without granting permission',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 await store.begin('gui_mouse_click');
 const original=await fs.readFile(file);
 await fs.writeFile(file+'.review-archive-v1.json',original,{flag:'wx'});
 const result=await store.inspectRecovery();
 assert.equal(result.state,'CONFLICTING_ORIGINALS');
 assert.equal(result.recoveryRequired,true);
 assert.equal(result.original.sha256,result.archive.sha256);
 assert.equal(result.nativeOutcome,'UNKNOWN');
 assert.equal(result.releaseAuthorized,false);
 await assert.rejects(store.begin('gui_mouse_move'),/GUI_INCIDENT_RECOVERY_REQUIRED/);
 assert.deepEqual(await fs.readFile(file),original);
}));

test('corrupt archived bytes never become authenticated recovery evidence',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 await store.begin('gui_focus_window');
 const archive=file+'.review-archive-v1.json';
 await fs.rename(file,archive);
 const before=await fs.readFile(archive);
 const forged=before.toString('utf8').replace('PENDING_NATIVE_EFFECT','NOT_APPLIED');
 await fs.writeFile(archive,forged);
 await assert.rejects(store.inspectRecovery(),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 await assert.rejects(store.pending(),/GUI_INCIDENT_RECOVERY_REQUIRED/);
 let out='';
 const code=await recoveryCli(['--status'],{store,output:{write:x=>{out+=x;}},error:{write(){}}});
 assert.equal(code,5);
 const report=JSON.parse(out);
 assert.equal(report.releaseAuthorized,false);
 assert.equal(report.recovery,null);
 assert.equal(report.inspectionError,'GUI_INCIDENT_STORAGE_UNAVAILABLE');
 assert.equal(report.noReplay,true);
 assert.equal(await fs.readFile(archive,'utf8'),forged);
}));

test('untrusted terminal marker is forensic metadata, never a clearance token',()=>ownFile(async file=>{
 const marker=file+'.review-terminal-v1.json';
 await fs.writeFile(marker,'{"authorization":true,"state":"REVIEWED_WITH_UNKNOWN_NATIVE_OUTCOME"}\\n');
 const store=createGuiInputIncidentStore({file});
 const recovery=await store.inspectRecovery();
 assert.equal(recovery.state,'ORIGINAL_MISSING_RECOVERY_REQUIRED');
 assert.equal(recovery.ownerAuthenticated,false);
 assert.equal(recovery.releaseAuthorized,false);
 assert.equal(recovery.original,null);
 assert.ok(recovery.terminal.sha256);
 assert.equal(recovery.terminal.incident,undefined);
 await assert.rejects(store.begin('gui_type_text'),/GUI_INCIDENT_RECOVERY_REQUIRED/);
}));

test('hardlinked archived recovery evidence is rejected',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 await store.begin('gui_mouse_drag');
 const archive=file+'.review-archive-v1.json';
 await fs.rename(file,archive);
 const link=archive+'.alias';
 await fs.link(archive,link);
 try{
  await assert.rejects(store.inspectRecovery(),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
  await assert.rejects(store.begin('gui_type_text'),/GUI_INCIDENT_RECOVERY_REQUIRED/);
 }finally{await fs.unlink(link);}
}));

test('recovery inspection cannot follow a symlinked archived original',{
 skip:process.platform==='win32'
},()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 await store.begin('gui_focus_window');
 const archive=file+'.review-archive-v1.json';
 await fs.rename(file,archive);
 const backing=file+'.original';
 await fs.rename(archive,backing);
 await fs.symlink(backing,archive);
 await assert.rejects(store.inspectRecovery(),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 await assert.rejects(store.pending(),/GUI_INCIDENT_RECOVERY_REQUIRED/);
}));
