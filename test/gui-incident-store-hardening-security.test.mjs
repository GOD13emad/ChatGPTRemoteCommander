import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createGuiController} from '../src/gui-tools-windows.mjs';
import {createGuiInputIncidentStore} from '../src/gui-incident-store.mjs';

const ownFile=async(run)=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-gui-incident-j01-'));
 const file=path.join(root,'gui-input-pending.json');
 try{return await run(file);}
 finally{await fs.rm(root,{recursive:true,force:true});}
};
test('POSIX evidence refuses a group-readable incident directory',t=>ownFile(async file=>{
  if(process.platform==='win32'||typeof process.getuid!=='function'){
    t.skip('POSIX private directory ownership contract');return;
  }
  const folder=path.dirname(file),store=createGuiInputIncidentStore({file});
  await fs.chmod(folder,0o755);
  try{
    await assert.rejects(store.pending(),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
    await assert.rejects(store.begin('gui_mouse_click'),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
    await assert.rejects(fs.access(file),{code:'ENOENT'});
  }finally{await fs.chmod(folder,0o700);}
  const token=await store.begin('gui_mouse_click');
  assert.equal((await store.pending()).id,token.id);
  await store.resolve(token);
}));

test('incident file mode is private on POSIX hosts',()=>ownFile(async file=>{
 const s=createGuiInputIncidentStore({file});
 const receipt=await s.begin('gui_key_press');
 const mode=(await fs.stat(file)).mode;
 if(process.platform!=='win32')assert.equal(mode&0o077,0);
 await s.resolve(receipt);
}));


test('pending record refuses symlinks and hardlinks instead of reading their targets',()=>ownFile(async file=>{
 const externalRoot=await fs.mkdtemp(path.join(os.tmpdir(),'rc-gui-incident-external-'));
 const external=path.join(externalRoot,'incident.json');
 try{
  await fs.writeFile(external,JSON.stringify({
   schema:'rc-gui-pending-input-v1',status:'PENDING_NATIVE_EFFECT',tool:'gui_mouse_click',
   id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',startedUtc:new Date().toISOString()
  }));
  await fs.link(external,file);
  const store=createGuiInputIncidentStore({file});
  await assert.rejects(store.pending(),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
  await fs.unlink(file);
  try{await fs.symlink(external,file,'file');}
  catch(e){if(['EPERM','EACCES','ENOTSUP'].includes(e.code))return;throw e;}
  await assert.rejects(store.pending(),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
  await fs.unlink(file);
  await fs.unlink(external);
  await fs.symlink(external,file,'file');
  await assert.rejects(store.pending(),/GUI_INCIDENT_STORAGE_UNAVAILABLE/,
   'a dangling incident symlink is unsafe, never evidence of no pending effect');
 }finally{await fs.rm(externalRoot,{recursive:true,force:true});}
}));

test('incident pending reads a verified file handle and refuses oversized records',()=>ownFile(async file=>{
 const s=createGuiInputIncidentStore({file});
 const h=await s.begin('gui_mouse_click');
 assert.equal((await s.pending()).id,h.id);
 await fs.appendFile(file,' '.repeat(2050));
 await assert.rejects(s.pending(),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
}));


test('POSIX incident pending refuses FIFO and symlink-to-FIFO without blocking',t=>ownFile(async file=>{
 if(process.platform==='win32'){t.skip('mkfifo is POSIX-only');return;}
 const fifo=file+'.fifo';
 const mk=spawnSync('mkfifo',[fifo],{encoding:'utf8',timeout:2000});
 if(mk.error?.code==='ENOENT'){t.skip('mkfifo unavailable');return;}
 assert.equal(mk.status,0,mk.stderr||String(mk.error));
 const url=pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../src/gui-incident-store.mjs')).href;
 const script=[
   'import {createGuiInputIncidentStore} from '+JSON.stringify(url)+';',
   'try {',
   ' await createGuiInputIncidentStore({file:process.argv.at(-1)}).pending();',
   " process.exitCode=5;",
   '} catch(error) {',
   " if(error?.message==='GUI_INCIDENT_STORAGE_UNAVAILABLE')console.log('SAFE_DENY');",
   ' else { console.error(error?.code||error?.name);process.exitCode=6; }',
   '}'
 ].join('\n');
 const run=()=>spawnSync(process.execPath,['--input-type=module','-e',script,file],{
   encoding:'utf8',timeout:1500,windowsHide:true
 });
 await fs.symlink(fifo,file,'file');
 const viaLink=run();
 assert.equal(viaLink.status,0,'symlink->FIFO must fail before blocking: '+String(viaLink.error||viaLink.stderr));
 assert.match(viaLink.stdout,/SAFE_DENY/);
 await fs.unlink(file);
 await fs.rename(fifo,file);
 const directFifo=run();
 assert.equal(directFifo.status,0,'direct FIFO must fail before blocking: '+String(directFifo.error||directFifo.stderr));
 assert.match(directFifo.stdout,/SAFE_DENY/);
}));

test('resolving stale GUI incident never deletes a newly substituted pending incident',()=>ownFile(async file=>{
 const store=createGuiInputIncidentStore({file});
 const stale=await store.begin('gui_mouse_click');
 const replacementId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
 const originalUnlink=fs.unlink,originalRename=fs.rename;
 let changed=false;
 const substitute=async()=>{
  if(changed)return;
  changed=true;
  await originalRename.call(fs,file,file+'.former');
  await fs.writeFile(file,JSON.stringify({
   schema:'rc-gui-pending-input-v1',status:'PENDING_NATIVE_EFFECT',
   tool:'gui_mouse_click',id:replacementId,startedUtc:new Date().toISOString()
  })+'\n',{mode:0o600});
 };
 fs.unlink=async function(f,...args){
  if(String(f)===file)await substitute();
  return originalUnlink.call(this,f,...args);
 };
 fs.rename=async function(from,to,...args){
  if(String(from)===file && String(to).includes('.gui-incident-resolving-'))
   await substitute();
  return originalRename.call(this,from,to,...args);
 };
 try{
  await assert.rejects(store.resolve(stale),/GUI_INCIDENT_RESOLUTION_MISMATCH|GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 }finally{fs.unlink=originalUnlink;fs.rename=originalRename;}
 assert.equal(changed,true,'Actual rename/unlink boundary must be exercised');
 assert.equal((await store.pending()).id,replacementId,
  'The new uncertain native-effect record must survive an old acknowledgement');
}));
test('crash-left GUI incident guard fails closed instead of clearing on restart',()=>ownFile(async file=>{
 const s=createGuiInputIncidentStore({file});
 const receipt=await s.begin('gui_mouse_click');
 await fs.writeFile(file+'.exclusive-incident-v1','interrupted operation',{flag:'wx',mode:0o600});
 const restarted=createGuiInputIncidentStore({file});
 await assert.rejects(restarted.pending(),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 await assert.rejects(restarted.begin('gui_key_press'),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
 await assert.rejects(restarted.resolve(receipt),/GUI_INCIDENT_STORAGE_UNAVAILABLE/);
}));
