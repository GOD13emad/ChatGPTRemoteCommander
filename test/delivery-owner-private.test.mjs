import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DeliveryStore} from '../src/delivery-store.mjs';
const onPosix=process.platform!=='win32'&&typeof process.getuid==='function';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-delivery-perm-'));t.after(()=>fs.rmSync(root,{force:true,recursive:true}));return root;}
test('new owner-private state initializes and reopens', {skip:!onPosix},t=>{
 const dir=path.join(fixture(t),'new');const s=new DeliveryStore({directory:dir,scope:'qa'});
 try {assert.deepEqual(s.list().items,[]);}finally{s.close();}
 assert.equal(fs.statSync(dir).mode&0o077,0);assert.equal(fs.statSync(path.join(dir,'delivery.sqlite')).mode&0o077,0);
 new DeliveryStore({directory:dir,scope:'qa'}).close();
});
test('existing world-writable directory rejected before database creation', {skip:!onPosix},t=>{
 const dir=path.join(fixture(t),'unsafe');fs.mkdirSync(dir,{mode:0o700});fs.chmodSync(dir,0o777);
 assert.throws(()=>new DeliveryStore({directory:dir,scope:'qa'}),/DELIVERY_PRIVATE_DIRECTORY_UNSAFE/);
 assert.equal(fs.existsSync(path.join(dir,'delivery.sqlite')),false);
 assert.equal(fs.statSync(dir).mode&0o777,0o777);
});
test('existing world-readable SQLite file rejected without chmod', {skip:!onPosix},t=>{
 const dir=path.join(fixture(t),'existing');fs.mkdirSync(dir,{mode:0o700});
 const db=path.join(dir,'delivery.sqlite');fs.writeFileSync(db,'legacy',{mode:0o600});fs.chmodSync(db,0o644);
 assert.throws(()=>new DeliveryStore({directory:dir,scope:'qa'}),/DELIVERY_PRIVATE_FILE_UNSAFE/);
 assert.equal(fs.statSync(db).mode&0o777,0o644);
});
test('unsafe SQLite journal refused before DB open', {skip:!onPosix},t=>{
 const dir=path.join(fixture(t),'journal');fs.mkdirSync(dir,{mode:0o700});
 const j=path.join(dir,'delivery.sqlite-journal');fs.writeFileSync(j,'legacy',{mode:0o600});fs.chmodSync(j,0o666);
 assert.throws(()=>new DeliveryStore({directory:dir,scope:'qa'}),/DELIVERY_PRIVATE_FILE_UNSAFE/);
 assert.equal(fs.statSync(j).mode&0o777,0o666);
});

const onWindows=process.platform==='win32';
test('Windows NEW delivery SQLite directory obtains owner-private DACL and reopens',{skip:!onWindows},t=>{
 const dir=path.join(fixture(t),'win-new');
 const s=new DeliveryStore({directory:dir,scope:'winqa'});s.close();
 new DeliveryStore({directory:dir,scope:'winqa'}).close();
 assert.ok(fs.statSync(path.join(dir,'delivery.sqlite')).isFile());
});
test('Windows inherited existing folder is rejected without automatic repair',{skip:!onWindows},t=>{
 const dir=path.join(fixture(t),'win-inherited');fs.mkdirSync(dir);
 assert.throws(()=>new DeliveryStore({directory:dir,scope:'winqa'}),/OWNER_PRIVATE_DIRECTORY_UNSAFE/);
 assert.equal(fs.existsSync(path.join(dir,'delivery.sqlite')),false);
});
