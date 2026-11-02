import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {upgradeR14,OLD_R13,NEW_R14} from './upgrade-r14.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
async function setup(t){
 const home=await mkdtemp(join(tmpdir(),'commander-r14-'));
 t.after(()=>rm(home,{recursive:true,force:true,maxRetries:3,retryDelay:30}));
 const source=join(home,'source'),destination=join(home,'owner'),lockPath=join(home,'lock');
 await mkdir(source);await mkdir(destination);
 for(const [n,h] of Object.entries(NEW_R14)){
  const b=await readFile(['app.js'].includes(n)?join(root,'fixtures','r14',n):join(root,n));assert.equal(sha(b),h);
  await writeFile(join(source,n),b);
 }
 for(const [n,h] of Object.entries(OLD_R13)){
  const b=await readFile(join(root,'fixtures','r13',n));assert.equal(sha(b),h);
  await writeFile(join(destination,n),b);
 }
 await mkdir(join(destination,'browser-profile'));
 await writeFile(join(destination,'browser-profile','drafts.db'),'PRESERVE');
 return {source,destination,lockPath};
}
test('R14 exact source+R13 baseline upgrade and idempotence preserve owner drafts',async t=>{
 const a=await setup(t);
 const r=await upgradeR14(a);
 assert.deepEqual(r,{state:'UPGRADED_R13_TO_R14',changed:3});
 assert.deepEqual(await upgradeR14(a),{state:'ALREADY_R14',changed:0});
 for(const [n,h] of Object.entries(NEW_R14))
   assert.equal(sha(await readFile(join(a.destination,n))),h);
 assert.equal((await readFile(join(a.destination,'browser-profile','drafts.db'))).toString(),'PRESERVE');
});
test('R14 refuses unknown local edits and an active owner lock without mutation',async t=>{
 const a=await setup(t);
 await writeFile(join(a.destination,'app.js'),'OWNER_EDIT');
 await assert.rejects(upgradeR14(a),/R14_BASELINE_CHANGED/);
 assert.equal((await readFile(join(a.destination,'app.js'))).toString(),'OWNER_EDIT');
 const b=await setup(t);
 await writeFile(b.lockPath,'LIVE');
 await assert.rejects(upgradeR14(b),/R14_OWNER_APPLICATION_LOCKED/);
 assert.equal(sha(await readFile(join(b.destination,'app.js'))),OLD_R13['app.js']);
});
test('R14 refuses changed source and preserves exact baseline',async t=>{
 const a=await setup(t);
 await writeFile(join(a.source,'continuation-handoff.mjs'),'TAMPERED');
 await assert.rejects(upgradeR14(a),/R14_SOURCE_CHANGED/);
 assert.equal(sha(await readFile(join(a.destination,'server.mjs'))),OLD_R13['server.mjs']);
});
test('R14 partial failure restores R13 bytes and removes new module',async t=>{
 const a=await setup(t);
 await assert.rejects(upgradeR14({...a,afterMutation:async n=>{
  if(n==='app.js')throw Error('FAULT_INJECTION');
 }}),/FAULT_INJECTION/);
 for(const [n,h] of Object.entries(OLD_R13))
   assert.equal(sha(await readFile(join(a.destination,n))),h);
 await assert.rejects(stat(join(a.destination,'continuation-handoff.mjs')),{code:'ENOENT'});
 assert.equal((await readFile(join(a.destination,'browser-profile','drafts.db'))).toString(),'PRESERVE');
});
