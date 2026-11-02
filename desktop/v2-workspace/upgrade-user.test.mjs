import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {upgradeOwnerWorkspace} from './upgrade-user.mjs';

const files=['server.mjs','desktop-app.mjs','local-evidence.mjs','owner-seat-evidence.mjs','workflow-view.mjs','transport-evidence.mjs','owner-diagnostic-reader.mjs',
 'app.js','app.css','index.html','README.md'];
const OLD_FILES=files.filter(x=>x!=='owner-diagnostic-reader.mjs');
const hash=x=>createHash('sha256').update(x).digest('hex');
async function fixture(t){
 const parent=await mkdtemp(join(tmpdir(),'rcv2-upgrade-'));
 const source=join(parent,'extracted'),destination=join(parent,'installed'),lockPath=join(parent,'owner.lock');
 await mkdir(source);await mkdir(destination);
 t.after(()=>rm(parent,{recursive:true,force:true,maxRetries:4,retryDelay:70}));
 const previous={},manifest=[];
 for(const f of files){
  if(f!=='owner-diagnostic-reader.mjs'){
   const old=Buffer.from('R8:'+f);
   await writeFile(join(destination,f),old);
   previous[f]=hash(old);
  }
  const buf=Buffer.from('R9:'+f);
  await writeFile(join(source,f),buf);
  manifest.push({path:f,sha256:hash(buf),bytes:buf.length});
 }
 await writeFile(join(source,'PREVIOUS_RELEASE.json'),JSON.stringify({
  schema:1,kind:'COMMANDER_V2_WORKSPACE_PREVIOUS_RELEASE',
  previousArchiveSha256:'cdea95fed64a736ba3a6dbd4f0b48a460709001a59ba06b82af174a5c583dbeb',
  files:previous
 }));
 await writeFile(join(source,'MANIFEST.json'),JSON.stringify({
  mode:'LOCAL_GUI_PREVIEW_NO_PROMOTION',files:manifest
 }));
 // User drafts/profile are unrelated files and must survive every migration.
 await mkdir(join(destination,'browser-profile'));
 await writeFile(join(destination,'browser-profile','drafts.db'),'local-user-data');
 return {parent,source,destination,lockPath};
}
async function restored(f){for(const name of OLD_FILES){
 assert.equal((await readFile(join(f.destination,name))).toString(),'R8:'+name);}
 await assert.rejects(lstat(join(f.destination,'owner-diagnostic-reader.mjs')),{code:'ENOENT'});
 assert.equal((await readFile(join(f.destination,'browser-profile','drafts.db'))).toString(),'local-user-data');
}
test('upgrade from exactly pinned R8 runtime and preserve user profile',async t=>{
 const f=await fixture(t);
 const out=await upgradeOwnerWorkspace(f);
 assert.deepEqual(out,{state:'UPGRADED_R8_TO_R9',changed:11});
 for(const name of files)assert.equal((await readFile(join(f.destination,name))).toString(),'R9:'+name);
 assert.equal((await readFile(join(f.destination,'browser-profile','drafts.db'))).toString(),'local-user-data');
 assert.equal((await upgradeOwnerWorkspace(f)).state,'ALREADY_CURRENT');
});
test('foreign local modifications are never overwritten',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.destination,'app.js'),'owner has edited this');
 await assert.rejects(upgradeOwnerWorkspace(f),/V2_UPGRADE_BASELINE_CHANGED/);
 assert.equal((await readFile(join(f.destination,'app.js'))).toString(),'owner has edited this');
});
test('existing running or stale owner lock blocks upgrade',async t=>{
 const f=await fixture(t);
 await writeFile(f.lockPath,'locked');
 await assert.rejects(upgradeOwnerWorkspace(f),/V2_UPGRADE_APP_RUNNING_OR_STALE_LOCK/);
 await restored(f);
});
test('mid-update failure restores every old file and preserves drafts',async t=>{
 const f=await fixture(t);
 await assert.rejects(upgradeOwnerWorkspace({...f,afterMutation:async name=>{
  if(name==='local-evidence.mjs')throw Error('INJECTED_CRASH');
 }}),/INJECTED_CRASH/);
 await restored(f);
 const out=await upgradeOwnerWorkspace(f);
 assert.equal(out.state,'UPGRADED_R8_TO_R9');
});
test('tampered package manifest or payload cannot mutate installation',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.source,'workflow-view.mjs'),'TAMPERED');
 await assert.rejects(upgradeOwnerWorkspace(f),/V2_UPGRADE_SOURCE_HASH_MISMATCH/);
 await restored(f);
});
