import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildBundle} from '../tools/v2-universal-bundle-build.mjs';
import {plan,apply,inspect} from '../tools/v2-universal-install-engine.mjs';
const builder=fileURLToPath(new URL('../tools/v2-universal-bundle-build.mjs',import.meta.url));
function sandbox(fn){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'v2-builder-'));
  try {return fn(root);} finally {fs.rmSync(root,{recursive:true,force:true});}
}
test('one offline build creates hash-pinned cross-platform bundle consumable by universal engine',()=>{
  sandbox(root=>{
    const source=path.join(root,'bundle'),target=path.join(root,'managed');
    fs.mkdirSync(path.join(source,'bin'),{recursive:true});
    fs.writeFileSync(path.join(source,'bin','v2.mjs'),'console.log("Commander V2")\n');
    fs.writeFileSync(path.join(source,'bin','state.txt'),'fixture');
    const built=buildBundle({source,version:'0.12.0-qa.5',platform:process.platform,
      arch:process.arch,mode:'headless',entry:'bin/v2.mjs'});
    assert.equal(built.executableTrustedByPublisher,false);
    assert.equal(built.sourceFiles,2);
    assert.equal(plan({root:target,bundle:source}).sourceManifestSha256,built.manifestSha256);
    const r=apply({root:target,bundle:source,expectedManifestSha256:built.manifestSha256});
    assert.equal(r.status,'INSTALLED');assert.equal(r.mode,'headless');
    assert.equal(spawnSync(process.execPath,[inspect({root:target}).entry],{encoding:'utf8'}).stdout.trim(),'Commander V2');
    assert.throws(()=>buildBundle({source,version:'0.12.0-qa.5',platform:process.platform,arch:process.arch,mode:'headless',entry:'bin/v2.mjs'}),/MANIFEST_ALREADY_PRESENT/);
  });
});
test('bundle build refuses symlink, hardlink and case-colliding inputs without emitting manifest',()=>{
  sandbox(root=>{
    const source=path.join(root,'payload');fs.mkdirSync(source);
    const opts={source,version:'0.12.0-qa.2',platform:process.platform,arch:process.arch,mode:'desktop',entry:'app.mjs'};
    fs.writeFileSync(path.join(source,'app.mjs'),'original');
    fs.linkSync(path.join(source,'app.mjs'),path.join(source,'hardlink.mjs'));
    assert.throws(()=>buildBundle(opts),/NONREGULAR_OR_HARDLINKED/);
    fs.unlinkSync(path.join(source,'hardlink.mjs'));
    if(process.platform!=='win32'){
      // NTFS case-insensitive hosted Windows cannot materialize both aliases.
      fs.writeFileSync(path.join(source,'App.mjs'),'alias');
      assert.throws(()=>buildBundle(opts),/CASE_COLLIDING_PATH/);
      fs.unlinkSync(path.join(source,'App.mjs'));
      fs.symlinkSync(path.join(source,'app.mjs'),path.join(source,'shadow.mjs'));
      assert.throws(()=>buildBundle(opts),/SYMLINK_IN_BUNDLE/);
    }
    assert.equal(fs.existsSync(path.join(source,'manifest.json')),false);
  });
});
test('single bundle-builder CLI returns independent release pin without launching package',()=>{
  sandbox(root=>{
    const source=path.join(root,'payload');fs.mkdirSync(source);
    fs.writeFileSync(path.join(source,'commander.mjs'),'console.log("ready")\n');
    const r=spawnSync(process.execPath,[builder,'--source',source,'--version','0.12.0-qa.3',
      '--platform',process.platform,'--arch',process.arch,'--mode','desktop','--entry','commander.mjs'],
      {encoding:'utf8',timeout:5000});
    assert.equal(r.status,0,r.stderr);
    const j=JSON.parse(r.stdout);
    assert.equal(j.changesInstalled,false);
    assert.match(j.manifestSha256,/^[a-f0-9]{64}$/);
    assert.equal(fs.existsSync(path.join(source,'manifest.json')),true);
  });
});
