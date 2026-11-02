import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm,stat,lstat} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {upgradeR17,OLD_R16,NEW_R17} from './upgrade-r17.mjs';

const local=dirname(fileURLToPath(import.meta.url));
const installed=join(local,'fixtures','r16');
const sha=buf=>createHash('sha256').update(buf).digest('hex');
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'rcv2-r17-'));
 const source=join(root,'source'),destination=join(root,'installed'),lockPath=join(root,'locked');
 await mkdir(source);await mkdir(destination);
 t.after(()=>rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:50}));
 for(const [name,digest] of Object.entries(NEW_R17)){
  const data=await readFile(join(local,name));
  assert.equal(sha(data),digest);
  await writeFile(join(source,name),data);
 }
 for(const [name,digest] of Object.entries(OLD_R16)){
  const data=await readFile(join(installed,name));
  assert.equal(sha(data),digest,'R16 fixture drift for '+name);
  await writeFile(join(destination,name),data);
 }
 await mkdir(join(destination,'browser-profile'));
 await writeFile(join(destination,'browser-profile','local-drafts.db'),'PRESERVE_OWNER_DATA');
 return {root,source,destination,lockPath};
}
test('R17 upgrades only pinned runtime files, preserves owner data and is idempotent',async t=>{
 const f=await fixture(t);
 const out=await upgradeR17(f);
 assert.deepEqual(out,{state:'UPGRADED_R16_TO_R17',changed:2});
 assert.deepEqual(await upgradeR17(f),{state:'ALREADY_R17',changed:0});
 assert.equal((await readFile(join(f.destination,'browser-profile','local-drafts.db'))).toString(),'PRESERVE_OWNER_DATA');
 for(const [name,hash] of Object.entries(NEW_R17))
  assert.equal(sha(await readFile(join(f.destination,name))),hash);
});
test('R17 blocks a modified installed baseline and an owner lock without writes',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.destination,'app.js'),'LOCAL_MODIFICATION');
 await assert.rejects(upgradeR17(f),/R17_BASELINE_CHANGED/);
 assert.equal((await readFile(join(f.destination,'app.js'))).toString(),'LOCAL_MODIFICATION');
 const g=await fixture(t);
 await writeFile(g.lockPath,'LOCK');
 await assert.rejects(upgradeR17(g),/R17_OWNER_APPLICATION_LOCKED/);
 for(const [name,hash] of Object.entries(OLD_R16))
  assert.equal(sha(await readFile(join(g.destination,name))),hash);
});
test('R17 fails closed if source payload differs from pinned source SHA',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.source,'v1-runtime-bridge.mjs'),'TAMPERED');
 await assert.rejects(upgradeR17(f),/R17_SOURCE_CHANGED/);
 for(const [name,hash] of Object.entries(OLD_R16))
  assert.equal(sha(await readFile(join(f.destination,name))),hash);
});
test('R17 injected fault restores the R16 installation byte-for-byte',async t=>{
 const f=await fixture(t);
 await assert.rejects(upgradeR17({...f,afterMutation:async name=>{
  if(name==='app.js')throw Error('FAULT_TEST');
 }}),/FAULT_TEST/);
 for(const [name,hash] of Object.entries(OLD_R16))
  assert.equal(sha(await readFile(join(f.destination,name))),hash);
 assert.equal(sha(await readFile(join(f.destination,'v1-runtime-bridge.mjs'))),OLD_R16['v1-runtime-bridge.mjs']);
 assert.equal((await readFile(join(f.destination,'browser-profile','local-drafts.db'))).toString(),'PRESERVE_OWNER_DATA');
 const names=await (await import('node:fs/promises')).readdir(f.destination);
 assert.equal(names.some(n=>n.startsWith('.r17-transaction-')),false);
});
