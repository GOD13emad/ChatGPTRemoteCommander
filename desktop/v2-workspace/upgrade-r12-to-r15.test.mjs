import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm,stat,lstat} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {upgradeR12ToR15,OLD_R12,NEW_R15} from './upgrade-r12-to-r15.mjs';

const local=dirname(fileURLToPath(import.meta.url));
const installed=join(local,'fixtures','r12');
const sha=buf=>createHash('sha256').update(buf).digest('hex');
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'rcv2-r12r15-'));
 const source=join(root,'source'),destination=join(root,'installed'),lockPath=join(root,'locked');
 await mkdir(source);await mkdir(destination);
 t.after(()=>rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:50}));
 for(const [name,digest] of Object.entries(NEW_R15)){
  const data=await readFile(name==='server.mjs'?join(local,'fixtures','r14','server.mjs'):['app.js','v1-runtime-bridge.mjs'].includes(name)?join(local,'fixtures','r15',name):join(local,name));
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
test('R12→R15 upgrades only pinned runtime files, preserves owner data and is idempotent',async t=>{
 const f=await fixture(t);
 const out=await upgradeR12ToR15(f);
 assert.deepEqual(out,{state:'UPGRADED_R12_TO_R15',changed:4});
 assert.deepEqual(await upgradeR12ToR15(f),{state:'ALREADY_R15',changed:0});
 assert.equal((await readFile(join(f.destination,'browser-profile','local-drafts.db'))).toString(),'PRESERVE_OWNER_DATA');
 for(const [name,hash] of Object.entries(NEW_R15))
  assert.equal(sha(await readFile(join(f.destination,name))),hash);
});
test('R12→R15 blocks a modified installed baseline and an owner lock without writes',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.destination,'app.js'),'LOCAL_MODIFICATION');
 await assert.rejects(upgradeR12ToR15(f),/R15_BASELINE_CHANGED/);
 assert.equal((await readFile(join(f.destination,'app.js'))).toString(),'LOCAL_MODIFICATION');
 const g=await fixture(t);
 await writeFile(g.lockPath,'LOCK');
 await assert.rejects(upgradeR12ToR15(g),/R15_OWNER_APPLICATION_LOCKED/);
 for(const [name,hash] of Object.entries(OLD_R12))
  assert.equal(sha(await readFile(join(g.destination,name))),hash);
});
test('R12→R15 fails closed if source payload differs from pinned source SHA',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.source,'v1-runtime-bridge.mjs'),'TAMPERED');
 await assert.rejects(upgradeR12ToR15(f),/R15_SOURCE_CHANGED/);
 for(const [name,hash] of Object.entries(OLD_R12))
  assert.equal(sha(await readFile(join(f.destination,name))),hash);
});
test('R12→R15 injected fault restores the R12 installation byte-for-byte',async t=>{
 const f=await fixture(t);
 await assert.rejects(upgradeR12ToR15({...f,afterMutation:async name=>{
  if(name==='app.js')throw Error('FAULT_TEST');
 }}),/FAULT_TEST/);
 for(const [name,hash] of Object.entries(OLD_R12))
  assert.equal(sha(await readFile(join(f.destination,name))),hash);
 await assert.rejects(lstat(join(f.destination,'continuation-handoff.mjs')),{code:'ENOENT'});
 assert.equal((await readFile(join(f.destination,'browser-profile','local-drafts.db'))).toString(),'PRESERVE_OWNER_DATA');
 const names=await (await import('node:fs/promises')).readdir(f.destination);
 assert.equal(names.some(n=>n.startsWith('.r12r15-transaction-')),false);
});
