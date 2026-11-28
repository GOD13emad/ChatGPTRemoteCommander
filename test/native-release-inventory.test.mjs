import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
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

test('development inventory must be explicitly selected and remain non-promoting',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-dev-inventory-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const dev='0.12.0-dev.25';
 const devNames=['Remote-Commander-Unified-'+dev+'-Windows-x64.exe','Remote-Commander-Unified-'+dev+'-Linux-amd64.deb'];
 for(const n of devNames)fs.writeFileSync(path.join(directory,n),Buffer.alloc(1500,3));
 await assert.rejects(inspectNativeReleaseInventory({version:dev,directory}));
 const result=await inspectNativeReleaseInventory({version:dev,directory,channel:'development'});
 assert.equal(result.channel,'development');
 assert.equal(result.tag_name,'v'+dev);
 assert.equal(result.inventoryOnly,true);
 assert.equal(result.publicationApproved,false);
 assert.equal(result.provenanceVerified,false);
 assert.equal(nativeV012ReleaseAssetSet(result),null);
 const {nativeV012DevCandidateAssetSet}=await import('../tools/universal-install/release-admission-0.12.mjs');
 assert.ok(nativeV012DevCandidateAssetSet(result));
 for(const v of ['0.12.0-dev.0','0.12.0-dev.025','0.12.1-dev.25','0.13.0-dev.25','0.12.0','0.12.0-rc.25'])
   await assert.rejects(inspectNativeReleaseInventory({version:v,directory,channel:'development'}));
 await assert.rejects(inspectNativeReleaseInventory({version:dev,directory,channel:'unknown'}));
 const extra=path.join(directory,'legacy.zip');
 fs.writeFileSync(extra,'fixture');
 await assert.rejects(inspectNativeReleaseInventory({version:dev,directory,channel:'development'}));
 fs.unlinkSync(extra);
 fs.unlinkSync(path.join(directory,devNames[1]));
 await assert.rejects(inspectNativeReleaseInventory({version:dev,directory,channel:'development'}));
});

test('CLI requires an explicit development channel and cannot promote a candidate',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-dev-inventory-cli-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const dev='0.12.0-dev.25';
 for(const suffix of ['Windows-x64.exe','Linux-amd64.deb'])
  fs.writeFileSync(path.join(directory,'Remote-Commander-Unified-'+dev+'-'+suffix),Buffer.alloc(1500,7));
 const cli=fileURLToPath(new URL('../tools/universal-install/native-release-inventory.mjs',import.meta.url));
 const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:10000,windowsHide:true});
 for(const args of [[dev,directory],[dev,directory,'--unknown'],[dev,directory,'--development','extra'],['0.12.0',directory,'--development']]){
  const out=run(...args);
  assert.equal(out.status,2);
  assert.equal(out.stdout,'');
  assert.match(out.stderr,/RC012_NATIVE_RELEASE_INVENTORY_DENIED/);
 }
 const out=run(dev,directory,'--development');
 assert.equal(out.status,0,out.stderr);
 const result=JSON.parse(out.stdout);
 assert.equal(result.channel,'development');
 assert.equal(result.draft,true);
 assert.equal(result.prerelease,true);
 assert.equal(result.inventoryOnly,true);
 assert.equal(result.publicationApproved,false);
 assert.equal(result.provenanceVerified,false);
 assert.equal(result.assets.length,2);
 assert.equal(nativeV012ReleaseAssetSet(result),null);
});
