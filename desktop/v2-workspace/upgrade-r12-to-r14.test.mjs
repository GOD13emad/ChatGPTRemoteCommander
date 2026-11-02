import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm,stat,lstat} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {upgradeR12ToR14,OLD_R12,NEW_R14} from './upgrade-r12-to-r14.mjs';

const local=dirname(fileURLToPath(import.meta.url));
const installed=join(local,'fixtures','r12');
const sha=buf=>createHash('sha256').update(buf).digest('hex');
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'rcv2-r12r14-'));
 const source=join(root,'source'),destination=join(root,'installed'),lockPath=join(root,'locked');
 await mkdir(source);await mkdir(destination);
 t.after(()=>rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:50}));
 for(const [name,digest] of Object.entries(NEW_R14)){
  const data=await readFile(['app.js','v1-runtime-bridge.mjs'].includes(name)?join(local,'fixtures','r14',name):join(local,name));
  assert.equal(sha(data),digest);
  await writeFile(join(source,name),data);
 }
 for(const [name,digest] of Object.entries(OLD_R12)){
  const data=await readFile(join(installed,name));
  assert.equal(sha(data),digest,'R12 fixture drift for '+name);
  await writeFile(join(destination,name),data);
 }
 await mkdir(join(destination,'browser-profile'));
 await writeFile(join(destination,'browser-profile','local-drafts.db'),'PRESERVE_OWNER_DATA');
 return {root,source,destination,lockPath};
}
test('R12→R14 upgrades only pinned runtime files, preserves owner data and is idempotent',async t=>{
 const f=await fixture(t);
 const out=await upgradeR12ToR14(f);
 assert.deepEqual(out,{state:'UPGRADED_R12_TO_R14',changed:4});
 assert.deepEqual(await upgradeR12ToR14(f),{state:'ALREADY_R14',changed:0});
 assert.equal((await readFile(join(f.destination,'browser-profile','local-drafts.db'))).toString(),'PRESERVE_OWNER_DATA');
 for(const [name,hash] of Object.entries(NEW_R14))
  assert.equal(sha(await readFile(join(f.destination,name))),hash);
});
test('R12→R14 blocks a modified installed baseline and an owner lock without writes',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.destination,'app.js'),'LOCAL_MODIFICATION');
 await assert.rejects(upgradeR12ToR14(f),/R14_BASELINE_CHANGED/);
 assert.equal((await readFile(join(f.destination,'app.js'))).toString(),'LOCAL_MODIFICATION');
 const g=await fixture(t);
 await writeFile(g.lockPath,'LOCK');
 await assert.rejects(upgradeR12ToR14(g),/R14_OWNER_APPLICATION_LOCKED/);
 for(const [name,hash] of Object.entries(OLD_R12))
  assert.equal(sha(await readFile(join(g.destination,name))),hash);
});
test('R12→R14 fails closed if source payload differs from pinned source SHA',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.source,'v1-runtime-bridge.mjs'),'TAMPERED');
 await assert.rejects(upgradeR12ToR14(f),/R14_SOURCE_CHANGED/);
 for(const [name,hash] of Object.entries(OLD_R12))
  assert.equal(sha(await readFile(join(f.destination,name))),hash);
});
test('R12→R14 injected fault restores the R12 installation byte-for-byte',async t=>{
 const f=await fixture(t);
 await assert.rejects(upgradeR12ToR14({...f,afterMutation:async name=>{
  if(name==='app.js')throw Error('FAULT_TEST');
 }}),/FAULT_TEST/);
 for(const [name,hash] of Object.entries(OLD_R12))
  assert.equal(sha(await readFile(join(f.destination,name))),hash);
 await assert.rejects(lstat(join(f.destination,'continuation-handoff.mjs')),{code:'ENOENT'});
 assert.equal((await readFile(join(f.destination,'browser-profile','local-drafts.db'))).toString(),'PRESERVE_OWNER_DATA');
 const names=await (await import('node:fs/promises')).readdir(f.destination);
 assert.equal(names.some(n=>n.startsWith('.r12r14-transaction-')),false);
});
