import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {stageCoSAfterPack} from '../tools/stage-v2-cos-afterpack.mjs';

function checkout(t,{version='2.1.50',hook='afterPack: scripts/afterpack-macos-adhoc-seal.mjs'}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v2-cos-overlay-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.mkdirSync(path.join(dir,'scripts'));
 fs.writeFileSync(path.join(dir,'.commander-v2-isolated-qa'),'V2_COS_DISPOSABLE_SOURCE_QA_ONLY\n');
 fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'chat-on-steroids',version}));
 fs.writeFileSync(path.join(dir,'electron-builder.yml'), 'linux:\n  target: deb\n'+hook+'\n');
 fs.writeFileSync(path.join(dir,'scripts','afterpack-macos-adhoc-seal.mjs'),'export default async () => "UPSTREAM_MAC_OK";\n');
 return dir;
}
const fixtureBlobs=dir=>Object.fromEntries(['package.json','electron-builder.yml','scripts/afterpack-macos-adhoc-seal.mjs'].map(name=>{
 const b=fs.readFileSync(path.join(dir,name));return [name,createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex')];
}));
test('overlay safely chains original macOS hook and Linux staged mode repair',async t=>{
 const dir=checkout(t);
 const mac=fs.readFileSync(path.join(dir,'scripts','afterpack-macos-adhoc-seal.mjs'));
 const result=stageCoSAfterPack(dir,{expectedBlobs:fixtureBlobs(dir)});
 assert.equal(result.status,'SOURCE_OVERLAY_STAGED_NOT_BUILT');
 assert.equal(fs.readFileSync(path.join(dir,'scripts','afterpack-macos-adhoc-seal.mjs')).toString(),mac.toString());
 assert.match(fs.readFileSync(path.join(dir,'electron-builder.yml'),'utf8'),/afterPack: scripts\/commander-v2-afterpack\.mjs/);
 const {default:chain}=await import(pathToFileURL(path.join(dir,'scripts','commander-v2-afterpack.mjs')).href);
 assert.equal(await chain({electronPlatformName:'darwin'}),'UPSTREAM_MAC_OK');
 assert.equal(await chain({electronPlatformName:'win32'}),undefined);
 const app=path.join(dir,'linux-unpacked');
 fs.mkdirSync(path.join(app,'resources'),{recursive:true});
 fs.writeFileSync(path.join(app,'chat-on-steroids'),'exe');
 fs.writeFileSync(path.join(app,'resources','app.asar'),'asar');
 fs.chmodSync(app,0o700);
 fs.chmodSync(path.join(app,'resources'),0o700);
 fs.chmodSync(path.join(app,'chat-on-steroids'),0o700);
 fs.chmodSync(path.join(app,'resources','app.asar'),0o600);
 const p=await chain({electronPlatformName:'linux',appOutDir:app});
 assert.equal(p.status,'LINUX_STAGED_MODES_REPAIRED');
 assert.equal(fs.statSync(app).mode&0o777,0o755);
 assert.equal(fs.statSync(path.join(app,'resources','app.asar')).mode&0o777,0o644);
 assert.throws(()=>stageCoSAfterPack(dir,{expectedBlobs:fixtureBlobs(dir)}),/ORIGINAL_HOOK_MISMATCH/);
});
test('rejects changed vendor versions or original hook, preserving vendor checkout',t=>{
 for(const opt of [{version:'2.1.49'},{version:'2.1.51'},{hook:'afterPack: scripts/other-hook.mjs'}]){
  const dir=checkout(t,opt);
  const before=fs.readFileSync(path.join(dir,'electron-builder.yml'));
  assert.throws(()=>stageCoSAfterPack(dir,{expectedBlobs:fixtureBlobs(dir)}),/V2_COS_STAGE_/);
  assert.equal(fs.readFileSync(path.join(dir,'electron-builder.yml')).toString(),before.toString());
  assert.equal(fs.existsSync(path.join(dir,'scripts','commander-v2-afterpack.mjs')),false);
  assert.equal(fs.existsSync(path.join(dir,'scripts','v2-cos-linux-afterpack.mjs')),false);
 }
});

test('vendor pin is checked before changes, and QA marker is mandatory',t=>{
 const dir=checkout(t);
 const pins=fixtureBlobs(dir);
 fs.appendFileSync(path.join(dir,'electron-builder.yml'),'# local modified vendor source\n');
 assert.throws(()=>stageCoSAfterPack(dir,{expectedBlobs:pins}),/UPSTREAM_SOURCE_PIN_MISMATCH/);
 assert.equal(fs.existsSync(path.join(dir,'scripts','commander-v2-afterpack.mjs')),false);
 const fresh=checkout(t);
 fs.unlinkSync(path.join(fresh,'.commander-v2-isolated-qa'));
 assert.throws(()=>stageCoSAfterPack(fresh,{expectedBlobs:fixtureBlobs(fresh)}),/ISOLATED_QA_MARKER_REQUIRED/);
});
