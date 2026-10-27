import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createOwnerReviewedGuiStore} from '../src/gui-owner-recovery-store.mjs';
import {createGuiInputIncidentStore} from '../src/gui-incident-store.mjs';
import {createGuiController} from '../src/gui-tools-windows.mjs';
const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tempRoot=path.join(sourceRoot,'.gui-recovery-tests');
const digest=x=>createHash('sha256').update(x).digest('hex');
async function fixture(fn){
  await fs.mkdir(tempRoot,{recursive:true});
  const dir=await fs.mkdtemp(path.join(tempRoot,'owned-'));
  const legacyFile=path.join(dir,'gui-pending-native-input-v1.json');
  const old={schema:'rc-gui-pending-input-v1',status:'PENDING_NATIVE_EFFECT',
    tool:'gui_mouse_click',id:randomUUID(),startedUtc:'2026-10-18T20:10:42.397Z'};
  const bytes=JSON.stringify(old)+'\n';await fs.writeFile(legacyFile,bytes);
  const receiptFile=path.join(dir,'gui-owner-recovery-v1.json');
  const receipt={schema:'rc-gui-owner-recovery-v1',decision:'OWNER_REVIEWED_FRESH_INPUT_ONLY',
    historicalOutcome:'UNKNOWN_NO_REPLAY',noReplay:true,reviewMethod:'LOCAL_INTERACTIVE_BUTTON',
    host:'test-host',user:'test-user',sourceRoot,sourceSha256:'test-source',epoch:randomUUID(),
    incidentId:old.id,incidentTool:old.tool,incidentSha256:digest(bytes),
    reviewedUtc:'2026-10-27T16:00:00.000Z',
    quiescence:{nativeMutexAcquired:true,guiBusy:false,guiLeased:false}};
  const make=()=>createOwnerReviewedGuiStore({legacyFile,root:sourceRoot,host:'test-host',
    user:'test-user',sourceIdentity:async()=>'test-source',now:()=>Date.parse('2026-10-27T17:00:00Z')});
  const approve=()=>fs.writeFile(receiptFile,JSON.stringify(receipt));
  try{await fn({dir,legacyFile,old,bytes,receipt,receiptFile,make,approve});}
  finally{
    assert.equal(path.dirname(dir),tempRoot);
    await fs.rm(dir,{recursive:true,force:true});
  }
}
test('no local receipt: historical intent still blocks new input',()=>fixture(async f=>{
  assert.equal((await f.make().pending()).id,f.old.id);
  await assert.rejects(f.make().begin('gui_mouse_click'),/GUI_INCIDENT_UNRESOLVED/);
  assert.equal(await fs.readFile(f.legacyFile,'utf8'),f.bytes);
}));
test('reviewed historical UNKNOWN preserved; only fresh separate intent resolves',()=>fixture(async f=>{
  await f.approve();const store=f.make();assert.equal(await store.pending(),null);
  const info=await store.recoveryState();assert.equal(info.historicalOutcome,'UNKNOWN_NO_REPLAY');
  const a=await store.begin('gui_type_text');
  assert.equal((await store.pending()).id,a.id);
  assert.notEqual(a.id,f.old.id);
  await store.resolve(a);assert.equal(await store.pending(),null);
  assert.equal(await fs.readFile(f.legacyFile,'utf8'),f.bytes);
}));
test('a new unknown effect blocks another controller and survives restart',()=>fixture(async f=>{
  await f.approve();const a=await f.make().begin('gui_key_press');
  assert.equal((await f.make().pending()).id,a.id);
  await assert.rejects(f.make().begin('gui_mouse_click'),/GUI_INCIDENT_UNRESOLVED/);
}));
test('only an issued live handle resolves; old identifier and cloned handles fail',()=>fixture(async f=>{
  await f.approve();const store=f.make();const handle=await store.begin('gui_mouse_click');
  await assert.rejects(store.resolve({...handle}),/GUI_OWNER_RECOVERY_UNVERIFIED/);
  await assert.rejects(store.resolve({id:f.old.id,tool:f.old.tool}),/GUI_OWNER_RECOVERY_UNVERIFIED/);
  await store.resolve(handle);
  await assert.rejects(store.resolve(handle),/GUI_OWNER_RECOVERY_UNVERIFIED/);
}));
for(const [field,value] of Object.entries({schema:'other',decision:'AUTO_RESUME',
  historicalOutcome:'NOT_APPLIED',noReplay:false,reviewMethod:'REMOTE_SHELL',
  host:'another-host',user:'another-user',sourceRoot:'C:\\other',sourceSha256:'changed-code',
  incidentId:'other-id',incidentTool:'gui_key_press',incidentSha256:'bad-hash',
  epoch:'../../escape',reviewedUtc:'2020-01-01T00:00:00Z'})){
  test('reject receipt drift: '+field,()=>fixture(async f=>{
    f.receipt[field]=value;await f.approve();
    await assert.rejects(f.make().pending(),/GUI_OWNER_RECOVERY_UNVERIFIED/);
  }));
}
for(const field of ['nativeMutexAcquired','guiBusy','guiLeased']){
  test('reject unverified native quiescence: '+field,()=>fixture(async f=>{
    f.receipt.quiescence[field]=!f.receipt.quiescence[field];await f.approve();
    await assert.rejects(f.make().pending(),/GUI_OWNER_RECOVERY_UNVERIFIED/);
  }));
}
test('corrupt receipt fails closed and does not fall back to legacy store',()=>fixture(async f=>{
  await fs.writeFile(f.receiptFile,'{bad-json');
  await assert.rejects(f.make().pending(),/GUI_OWNER_RECOVERY_UNVERIFIED/);
}));
test('original evidence mutation invalidates review and keeps new pending',()=>fixture(async f=>{
  await f.approve();const store=f.make();const a=await store.begin('gui_mouse_click');
  await fs.appendFile(f.legacyFile,' ');
  await assert.rejects(store.resolve(a),/GUI_OWNER_RECOVERY_UNVERIFIED/);
  const active=path.join(f.dir,'gui-pending-reviewed-'+f.receipt.epoch+'.json');
  assert.equal((await createGuiInputIncidentStore({file:active}).pending()).id,a.id);
}));
test('receipt deletion or epoch rotation during a live controller fails closed',()=>fixture(async f=>{
  await f.approve();const store=f.make();const a=await store.begin('gui_mouse_click');
  await fs.unlink(f.receiptFile);
  await assert.rejects(store.pending(),/GUI_OWNER_RECOVERY_UNVERIFIED/);
  f.receipt.epoch=randomUUID();await f.approve();
  await assert.rejects(store.resolve(a),/GUI_OWNER_RECOVERY_UNVERIFIED/);
}));
test('exclusive active intent prevents competing controllers',()=>fixture(async f=>{
  await f.approve();
  const values=await Promise.allSettled([f.make().begin('gui_mouse_click'),f.make().begin('gui_key_press')]);
  assert.equal(values.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(values.filter(x=>x.status==='rejected').length,1);
}));
test('hardlinked owner receipt cannot grant admission',()=>fixture(async f=>{
  await f.approve();await fs.link(f.receiptFile,path.join(f.dir,'link.json'));
  await assert.rejects(f.make().pending(),/GUI_OWNER_RECOVERY_UNVERIFIED/);
}));
test('controller still honors local emergency stop after owner review',()=>fixture(async f=>{
  await f.approve();let calls=0;
  const c=createGuiController({platform:'win32',isStopped:async()=>true,
    incidentStore:f.make(),invoke:async()=>{calls++;return {ok:true,available:true};}});
  const ctx={config:{powerMode:{enabled:true,guiControl:{enabled:true}}}};
  const s=await c.execute(ctx,'gui_status',{});
  assert.equal(s.available,false);assert.equal(s.reason,'LOCAL_GUI_STOP');
  assert.equal(s.historicalOutcome,'UNKNOWN_NO_REPLAY');
  await assert.rejects(c.execute(ctx,'gui_session_begin',{mode:'observe'}),/GUI_LOCAL_STOP/);
  assert.equal(calls,0);
}));
