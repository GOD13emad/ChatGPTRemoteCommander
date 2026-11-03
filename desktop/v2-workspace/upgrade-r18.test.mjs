import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,lstat,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {upgradeR18,OLD_R17,NEW_R18} from './upgrade-r18.mjs';

const sourceRoot=dirname(fileURLToPath(import.meta.url));
const sha=buf=>createHash('sha256').update(buf).digest('hex');
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'v2-r18-'));
  const source=join(root,'source'),destination=join(root,'installed'),lockPath=join(root,'app-instance.lock');
  await mkdir(source);await mkdir(destination);
  t.after(()=>rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:50}));
  for(const [name,hash]of Object.entries(NEW_R18)){
    const file=join(sourceRoot,name);
    const data=await readFile(file);
    assert.equal(sha(data),hash,'R18 source drift: '+name);
    await copyFile(file,join(source,name));
  }
  for(const [name,hash]of Object.entries(OLD_R17)){
    const f=join(sourceRoot,'fixtures','r17',name);
    const data=await readFile(f);
    assert.equal(sha(data),hash,'historical R17 fixture drift '+name);
    await copyFile(f,join(destination,name));
  }
  await mkdir(join(destination,'owner-profile'));
  await writeFile(join(destination,'owner-profile','drafts.db'),'SENTINEL_OWNER_DATA');
  return {root,source,destination,lockPath};
}
test('R18 preserves owner data and upgrades only four pinned files, idempotently',async t=>{
 const f=await fixture(t);
 assert.deepEqual(await upgradeR18(f),{state:'UPGRADED_R17_TO_R18',changed:4});
 assert.deepEqual(await upgradeR18(f),{state:'ALREADY_R18',changed:0});
 for(const [name,hash]of Object.entries(NEW_R18))
   assert.equal(sha(await readFile(join(f.destination,name))),hash);
 assert.equal((await readFile(join(f.destination,'owner-profile','drafts.db'))).toString(),'SENTINEL_OWNER_DATA');
});
test('R18 refuses owner edits, unrecognized module and active lock with no writes',async t=>{
 const a=await fixture(t);
 await writeFile(join(a.destination,'app.js'),'OWNER_CHANGE');
 await assert.rejects(upgradeR18(a),/R18_BASELINE_CHANGED/);
 assert.equal((await readFile(join(a.destination,'app.js'))).toString(),'OWNER_CHANGE');
 const b=await fixture(t);
 await writeFile(join(b.destination,'local-model-evidence.mjs'),'UNKNOWN_MODEL_PATCH');
 await assert.rejects(upgradeR18(b),/R18_UNKNOWN_MODULE_PRESENT/);
 const c=await fixture(t);
 await writeFile(c.lockPath,'ACTIVE');
 await assert.rejects(upgradeR18(c),/R18_OWNER_APP_LOCKED/);
});
test('R18 tampered source fails before changing any installation bytes',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.source,'server.mjs'),'MUTATION');
 await assert.rejects(upgradeR18(f),/R18_SOURCE_CHANGED/);
 for(const [name,hash]of Object.entries(OLD_R17))
   assert.equal(sha(await readFile(join(f.destination,name))),hash);
});
test('R18 injected write fault rolls back original exact bytes and removes new module',async t=>{
 const f=await fixture(t);
 await assert.rejects(upgradeR18({...f,afterMutation:async name=>{
   if(name==='local-model-evidence.mjs')throw Error('FAULT_INJECT');
 }}),/FAULT_INJECT/);
 for(const [name,hash]of Object.entries(OLD_R17))
   assert.equal(sha(await readFile(join(f.destination,name))),hash);
 await assert.rejects(lstat(join(f.destination,'local-model-evidence.mjs')),{code:'ENOENT'});
 const names=await readdir(f.destination);
 assert.equal(names.some(x=>x.startsWith('.r18-transaction-')),false);
 assert.equal((await readFile(join(f.destination,'owner-profile','drafts.db'))).toString(),'SENTINEL_OWNER_DATA');
});
