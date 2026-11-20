import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {snapshotV012OwnerState} from '../tools/v2-owner-state-snapshot.mjs';

function fixture(fn){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'v012-snapshot-test-'));
  try{
    const home=path.join(root,'owner');
    const source=path.join(home,'.local','state','ChatGPTRemoteCommander');
    const outputParent=path.join(home,'.local','state','CommanderV2','migration-private');
    fs.mkdirSync(source,{recursive:true,mode:0o700});
    return fn({root,home,source,outputParent});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('private Commander-state byte copy and isolated restore, never final cutover',()=>{
  fixture(({home,source,outputParent})=>{
    const original=Buffer.from('SECRET_FIXTURE_ONLY\0with-data');
    fs.mkdirSync(path.join(source,'profiles'),{mode:0o700});
    fs.writeFileSync(path.join(source,'profiles','state.bin'),original,{mode:0o600});
    fs.writeFileSync(path.join(source,'zero.bin'),Buffer.alloc(0),{mode:0o600});
    const before=fs.statSync(path.join(source,'profiles','state.bin')).mtimeMs;
    const r=snapshotV012OwnerState({kind:'commander-state',home,outputParent,maxBytes:4096});
    assert.equal(r.files,2);
    assert.equal(r.bytes,original.length);
    assert.equal(r.sourceCopyAndIsolatedRestore,'PASS');
    assert.equal(r.liveConsistencyVerified,false);
    assert.equal(r.allOwnerStateBackedUp,false);
    assert.equal(r.ownerAuthenticated,false);
    assert.equal(r.cutoverAuthorized,false);
    assert.ok(!JSON.stringify(r).includes('SECRET_FIXTURE_ONLY'));
    assert.ok(!JSON.stringify(r).includes(home));
    const base=path.join(outputParent,r.snapshotId);
    const snapshotFile=path.join(base,'data','profiles','state.bin');
    assert.deepEqual(fs.readFileSync(snapshotFile),original);
    assert.equal(fs.statSync(snapshotFile).mode&0o077,0);
    assert.equal(fs.statSync(base).mode&0o077,0);
    assert.equal(fs.statSync(path.join(base,'manifest.json')).mode&0o077,0);
    assert.equal(fs.statSync(path.join(source,'profiles','state.bin')).mtimeMs,before);
    assert.deepEqual(fs.readdirSync(base).sort(),['data','manifest.json','receipt.json']);
    const reread=JSON.parse(fs.readFileSync(path.join(base,'receipt.json'),'utf8'));
    assert.deepEqual(reread,r);
  });
});
test('reject symlinks inside owner state and leave original bytes untouched',()=>{
  if(process.platform!=='linux')return;
  fixture(({home,source,outputParent,root})=>{
    const external=path.join(root,'external');
    fs.writeFileSync(external,'KEEP_ORIGINAL');
    fs.symlinkSync(external,path.join(source,'outside'));
    assert.throws(()=>snapshotV012OwnerState({home,outputParent,maxBytes:4096}),/V012_STATE_SYMLINK_IN_SOURCE/);
    assert.equal(fs.readFileSync(external,'utf8'),'KEEP_ORIGINAL');
    assert.deepEqual(fs.readdirSync(outputParent),[]);
  });
});
test('reject source alias, output alias and source-output overlap',()=>{
  if(process.platform!=='linux')return;
  fixture(({home,source,outputParent,root})=>{
    assert.throws(()=>snapshotV012OwnerState({home,outputParent:source}),/V012_STATE_SOURCE_OUTPUT_OVERLAP/);
    const foreign=path.join(root,'foreign');fs.mkdirSync(foreign,{mode:0o700});
    fs.mkdirSync(path.dirname(outputParent),{recursive:true});
    fs.symlinkSync(foreign,outputParent);
    assert.throws(()=>snapshotV012OwnerState({home,outputParent}),/V012_STATE_OUTPUT_ALIAS/);
    fs.rmSync(outputParent);
    fs.rmSync(source,{recursive:true});
    fs.symlinkSync(foreign,source);
    assert.throws(()=>snapshotV012OwnerState({home,outputParent}),/V012_STATE_ALIAS_OR_NONDIRECTORY/);
  });
});
test('size budget fails without leaving partial snapshot',()=>{
  fixture(({home,source,outputParent})=>{
    fs.writeFileSync(path.join(source,'too-big.bin'),Buffer.alloc(2048,1));
    assert.throws(()=>snapshotV012OwnerState({home,outputParent,maxBytes:1024}),/V012_STATE_SIZE_LIMIT/);
    assert.deepEqual(fs.readdirSync(outputParent),[]);
  });
});
test('source roots absent or unsupported are not silently treated as a backup',()=>{
  fixture(({home,outputParent})=>{
    assert.throws(()=>snapshotV012OwnerState({home,outputParent,kind:'commander-config'}),/V012_STATE_PATH_MISSING_OR_UNREADABLE/);
    assert.throws(()=>snapshotV012OwnerState({home,outputParent,kind:'browser-userdata'}),/V012_STATE_UNSUPPORTED_KIND/);
  });
});
test('CLI refuses implicit backup or unknown snapshot kinds',()=>{
  const script=new URL('../tools/v2-owner-state-snapshot.mjs',import.meta.url);
  const file=fileURLToPath(script);
  const noArgs=spawnSync(process.execPath,[file],{encoding:'utf8'});
  const browser=spawnSync(process.execPath,[file,'--snapshot','brave-userdata'],{encoding:'utf8'});
  assert.equal(noArgs.status,2);assert.match(noArgs.stderr,/EXPLICIT_SNAPSHOT/);
  assert.equal(browser.status,2);assert.match(browser.stderr,/EXPLICIT_SNAPSHOT/);
});

test('Windows snapshot refuses until native owner-only ACL proof exists',()=>{
  fixture(({home,outputParent})=>{
    assert.throws(()=>snapshotV012OwnerState({platform:'win32',home,outputParent,localAppData:home}),
      /V012_STATE_WINDOWS_ACL_PROOF_REQUIRED/);
  });
});
