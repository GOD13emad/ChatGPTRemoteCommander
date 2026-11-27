import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectNativeReleaseInventory} from '../tools/universal-install/native-release-inventory.mjs';
import {nativeV012ReleaseAssetSet} from '../tools/universal-install/release-admission-0.12.mjs';
const version='0.12.1';
const names=['Remote-Commander-Unified-'+version+'-Windows-x64.exe','Remote-Commander-Unified-'+version+'-Linux-amd64.deb'];
const fixture=t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-release-inventory-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const [i,n] of names.entries())fs.writeFileSync(path.join(dir,n),Buffer.alloc(1500+i,i+1));
 return dir;
};
test('publisher inventory agrees with updater asset-set policy, without implying signature or approval',async t=>{
 const directory=fixture(t);
 const r=await inspectNativeReleaseInventory({version,directory});
 assert.equal(r.inventoryOnly,true);
 assert.equal(r.publicationApproved,false);
 assert.equal(r.provenanceVerified,false);
 assert.ok(nativeV012ReleaseAssetSet(r));
 for(const a of r.assets){
  const data=fs.readFileSync(path.join(directory,a.name));
  assert.equal(a.size,data.length);
  assert.equal(a.digest,'sha256:'+createHash('sha256').update(data).digest('hex'));
 }
});
test('rejects historical mixed files, incomplete sets, directories and cross-train or dev versions',async t=>{
 const directory=fixture(t);
 const inspect=(v=version)=>inspectNativeReleaseInventory({version:v,directory});
 for(const v of ['0.11.0','0.13.0','0.12.01','0.12.0-dev.24'])await assert.rejects(inspect(v));
 const extra=path.join(directory,'legacy.zip');fs.writeFileSync(extra,'fixture');
 await assert.rejects(inspect());fs.unlinkSync(extra);
 const f=path.join(directory,names[0]);fs.unlinkSync(f);
 await assert.rejects(inspect());fs.mkdirSync(f);
 await assert.rejects(inspect());fs.rmdirSync(f);
 fs.writeFileSync(f,Buffer.alloc(12));await assert.rejects(inspect());
});
test('rejects an alias hard link even with an otherwise valid pair',async t=>{
 const directory=fixture(t);
 const original=path.join(directory,names[0]);
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-release-inventory-alias-'));
 t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
 fs.linkSync(original,path.join(outside,'copy'));
 await assert.rejects(inspectNativeReleaseInventory({version,directory}));
});
