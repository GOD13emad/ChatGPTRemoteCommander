import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createManifest,apply as installSoftware} from '../tools/v2-universal-install-engine.mjs';
import {
 buildOwnerSnapshotManifest,migrationPlan,importOwnerSnapshot,rollbackOwnerSnapshot
} from '../tools/v2-universal-state-migration.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
function sandbox(fn){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'v2-offline-state-migration-'));
 try{return fn({home,root:path.join(home,'managed'),src:path.join(home,'state-snapshot')});}
 finally{fs.rmSync(home,{recursive:true,force:true});}
}
function software(o){
 const dir=path.join(o.home,'program');
 fs.mkdirSync(dir);
 fs.writeFileSync(path.join(dir,'commander.mjs'),'console.log("V2")\n');
 const m=createManifest({source:dir,version:'0.12.0-qa.1',platform:process.platform,
   arch:process.arch,mode:'desktop',entry:'commander.mjs',files:['commander.mjs']});
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(m));
 const sha=hash(JSON.stringify(m));
 assert.equal(installSoftware({root:o.root,bundle:dir,expectedManifestSha256:sha}).status,'INSTALLED');
}
function state(o,{profile='ownerA',text='original',second=false,folder='state-snapshot'}={}){
 const src=path.join(o.home,folder);
 fs.mkdirSync(path.join(src,'delivery'),{recursive:true});
 fs.writeFileSync(path.join(src,'delivery','queue.sqlite'),'SQLITE-OFFLINE-FIXTURE-'+text);
 fs.writeFileSync(path.join(src,'preferences.json'),JSON.stringify({version:text}));
 const out=buildOwnerSnapshotManifest({source:src,profile,
   files:['delivery/queue.sqlite','preferences.json']});
 return {source:src,manifest:out.manifest,pin:out.manifestSha256};
}
const input=(o,s)=>({root:o.root,source:s.source,manifest:s.manifest,expectedManifestSha256:s.pin});
test('offline state manifest is explicit; plan has no write and does not claim consistency',()=>{
 sandbox(o=>{
  software(o);const s=state(o);
  const p=migrationPlan(input(o,s));
  assert.equal(p.action,'IMPORT');assert.equal(p.changesApplied,false);
  assert.equal(p.realLiveProfileConsistencyProved,false);
  assert.equal(p.fullProfilePreserved,false);
  assert.equal(fs.existsSync(path.join(o.root,'owner-state')),false);
 });
});
test('import verifies bytes, source remains unchanged, repeat is idempotent',()=>{
 sandbox(o=>{
  software(o);const s=state(o);
  const p=importOwnerSnapshot(input(o,s));
  assert.equal(p.action,'IMPORTED');
  assert.equal(p.files,2);
  const saved=path.join(o.root,'owner-state','snapshots',s.pin,'data','delivery','queue.sqlite');
  assert.equal(fs.readFileSync(saved,'utf8'),'SQLITE-OFFLINE-FIXTURE-original');
  assert.equal(fs.readFileSync(path.join(s.source,'delivery','queue.sqlite'),'utf8'),'SQLITE-OFFLINE-FIXTURE-original');
  assert.equal(importOwnerSnapshot(input(o,s)).action,'NOOP');
  const pointer=JSON.parse(fs.readFileSync(path.join(o.root,'owner-state','profiles','ownerA.json'),'utf8'));
  assert.equal(pointer.current,s.pin);assert.equal(pointer.previous,null);
 });
});
test('upgrade the same profile then rollback only its active state',()=>{
 sandbox(o=>{
  software(o);const first=state(o);importOwnerSnapshot(input(o,first));
  const next=state(o,{text:'update',folder:'snapshot-updated'});
  importOwnerSnapshot(input(o,next));
  let p=JSON.parse(fs.readFileSync(path.join(o.root,'owner-state','profiles','ownerA.json'),'utf8'));
  assert.equal(p.current,next.pin);assert.equal(p.previous,first.pin);
  const r=rollbackOwnerSnapshot({root:o.root,profile:'ownerA'});
  assert.equal(r.status,'ROLLBACK');assert.equal(r.current,first.pin);
  assert.equal(rollbackOwnerSnapshot({root:o.root,profile:'ownerA'}).current,next.pin);
 });
});
test('distinct profiles have distinct pointers; rollback does not modify sibling profile',()=>{
 sandbox(o=>{
  software(o);const a=state(o,{profile:'ownerA'});const b=state(o,{profile:'ownerB',folder:'snapshot-b',text:'B'});
  importOwnerSnapshot(input(o,a));importOwnerSnapshot(input(o,b));
  assert.throws(()=>rollbackOwnerSnapshot({root:o.root,profile:'ownerB'}),/NO_PREVIOUS_SNAPSHOT/);
  const newer=state(o,{profile:'ownerA',folder:'snapshot-a2',text:'new'});
  importOwnerSnapshot(input(o,newer));rollbackOwnerSnapshot({root:o.root,profile:'ownerA'});
  const p=JSON.parse(fs.readFileSync(path.join(o.root,'owner-state','profiles','ownerB.json'),'utf8'));
  assert.equal(p.current,b.pin);
 });
});
test('manifest digest pin is required independently and forged pin rejected before writing',()=>{
 sandbox(o=>{
  software(o);const s=state(o);
  assert.throws(()=>importOwnerSnapshot({...input(o,s),expectedManifestSha256:''}),/EXTERNAL_MANIFEST_PIN_REQUIRED/);
  assert.throws(()=>importOwnerSnapshot({...input(o,s),expectedManifestSha256:'0'.repeat(64)}),/MANIFEST_PIN_MISMATCH/);
  assert.equal(fs.existsSync(path.join(o.root,'owner-state')),false);
 });
});
test('changed source data is refused before active state writes',()=>{
 sandbox(o=>{
  software(o);const s=state(o);
  fs.appendFileSync(path.join(s.source,'preferences.json'),'change');
  assert.throws(()=>importOwnerSnapshot(input(o,s)),/SOURCE_HASH_MISMATCH/);
  assert.equal(fs.existsSync(path.join(o.root,'owner-state')),false);
 });
});
test('pre-promotion injected failure leaves no partial import; retry succeeds',()=>{
 sandbox(o=>{
  software(o);const s=state(o);
  assert.throws(()=>importOwnerSnapshot({...input(o,s),injectFailure:'beforePromotion'}),/INJECTED_BEFORE_PROMOTION/);
  const items=fs.readdirSync(path.join(o.root,'owner-state','snapshots'));
  assert.deepEqual(items,[]);
  assert.equal(migrationPlan(input(o,s)).current,null);
  assert.equal(importOwnerSnapshot(input(o,s)).action,'IMPORTED');
 });
});
test('pre-activation injected failure preserves old pointer and can resume imported snapshot',()=>{
 sandbox(o=>{
  software(o);const first=state(o);importOwnerSnapshot(input(o,first));
  const second=state(o,{folder:'new-state',text:'next'});
  assert.throws(()=>importOwnerSnapshot({...input(o,second),injectFailure:'beforeActivation'}),/INJECTED_BEFORE_ACTIVATION/);
  assert.equal(migrationPlan(input(o,second)).current,first.pin);
  assert.equal(importOwnerSnapshot(input(o,second)).action,'IMPORTED');
 });
});
test('corrupted imported content blocks no-op and rollback',()=>{
 sandbox(o=>{
  software(o);const a=state(o);importOwnerSnapshot(input(o,a));
  const b=state(o,{folder:'state2',text:'new'});importOwnerSnapshot(input(o,b));
  const file=path.join(o.root,'owner-state','snapshots',b.pin,'data','preferences.json');
  fs.appendFileSync(file,'X');
  assert.throws(()=>rollbackOwnerSnapshot({root:o.root,profile:'ownerA'}),/STORED_FILE_CHANGED/);
  assert.throws(()=>importOwnerSnapshot(input(o,b)),/STORED_FILE_CHANGED/);
 });
});
test('unsafe paths, duplicate case names, wrong managed root and source overlap rejected',()=>{
 sandbox(o=>{
  software(o);const s=state(o);
  assert.throws(()=>migrationPlan({...input(o,s),manifest:{...s.manifest,files:[...s.manifest.files,
    {...s.manifest.files[0],path:'PREFERENCES.JSON'}]}}),/CASE_COLLISION/);
  const invalid={...s.manifest,files:[{...s.manifest.files[0],path:'../escape'}]};
  assert.throws(()=>migrationPlan({...input(o,s),manifest:invalid}),/FILE_RECORD_INVALID/);
  assert.throws(()=>migrationPlan({...input(o,s),root:path.join(o.home,'unmanaged')}),/NO_VERIFIED_MANAGED_INSTALL/);
  assert.throws(()=>migrationPlan({...input(o,s),source:o.root}),/SOURCE_TARGET_OVERLAP/);
 });
});
test('lock contention refuses concurrent writers without changing active import',()=>{
 sandbox(o=>{
  software(o);const s=state(o);importOwnerSnapshot(input(o,s));
  const lock=path.join(o.root,'owner-state','.writer.lock');
  fs.writeFileSync(lock,'another worker');
  assert.throws(()=>importOwnerSnapshot(input(o,s)),/EEXIST/);
  fs.unlinkSync(lock);
  assert.equal(importOwnerSnapshot(input(o,s)).action,'NOOP');
 });
});
test('reject symlinked source and linked snapshot file on compatible platforms',()=>{
 if(process.platform==='win32')return;
 sandbox(o=>{
  software(o);const s=state(o);
  const real=path.join(o.home,'real');fs.renameSync(s.source,real);
  fs.symlinkSync(real,s.source,'dir');
  assert.throws(()=>importOwnerSnapshot(input(o,s)),/ALIAS_PATH/);
  fs.unlinkSync(s.source);fs.renameSync(real,s.source);
  const one=path.join(s.source,'preferences.json'),other=path.join(s.source,'extra-hardlink.json');
  fs.linkSync(one,other);
  assert.throws(()=>buildOwnerSnapshotManifest({source:s.source,profile:'ownerA',
    files:['extra-hardlink.json']}),/NOT_REGULAR_FILE/);
 });
});

test('private migration directory permissions cannot be relaxed on Linux',()=>{
 if(process.platform==='win32')return;
 sandbox(o=>{
  software(o);const s=state(o);importOwnerSnapshot(input(o,s));
  const owner=path.join(o.root,'owner-state');
  fs.chmodSync(owner,0o755);
  assert.throws(()=>importOwnerSnapshot(input(o,s)),/STATE_NOT_PRIVATE/);
  fs.chmodSync(owner,0o700);
  assert.equal(importOwnerSnapshot(input(o,s)).action,'NOOP');
 });
});
test('corrupted pointer fails closed before migration or rollback',()=>{
 sandbox(o=>{
  software(o);const s=state(o);importOwnerSnapshot(input(o,s));
  const p=path.join(o.root,'owner-state','profiles','ownerA.json');
  fs.writeFileSync(p,'{"schema":1,"current":"tampered","previous":null}');
  assert.throws(()=>importOwnerSnapshot(input(o,s)),/POINTER_INVALID/);
  assert.throws(()=>rollbackOwnerSnapshot({root:o.root,profile:'ownerA'}),/POINTER_INVALID/);
 });
});
