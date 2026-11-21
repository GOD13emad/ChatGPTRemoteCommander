import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assembleCandidate} from '../tools/v012-unified-release-assemble.mjs';
import {apply,inspect,rollback} from '../tools/v2-universal-install-engine.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function sandbox(fn){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'v012-real-source-assembly-'));
 try{return fn(folder);}
 finally{fs.rmSync(folder,{recursive:true,force:true});}
}
function b(dir,mode='desktop'){
 return assembleCandidate({sourceRoot:root,outputParent:dir,mode});
}
test('real tracked source produces an exact-version offline bundle, one functional inspect entry',()=>{
 sandbox(dir=>{
  const pkg=b(dir);
  assert.equal(pkg.version,'0.12.0-rc.1');
  assert.equal(pkg.sourceCoreVersion,'0.11.0-dev.19');
  assert.ok(pkg.entries>150);
  assert.equal(pkg.nativeOsInstallerBuilt,false);
  const installed=apply({bundle:pkg.bundle,root:path.join(dir,'managed'),
    expectedManifestSha256:pkg.manifestSha256});
  assert.equal(installed.verified,true);
  assert.equal(installed.version,'0.12.0-rc.1');
  const r=spawnSync(process.execPath,[installed.entry,'inspect'],{encoding:'utf8',timeout:12000});
  assert.equal(r.status,0,r.stderr);
  const status=JSON.parse(r.stdout);
  assert.equal(status.stableRelease,false);
  assert.equal(status.fullPowerReady,false);
  assert.equal(status.chatOwnerGrantEstablished,false);
  assert.equal(status.nativeOsInstallRegistered,false);
  assert.equal(status.sourceCoreVersion,'0.11.0-dev.19');
 });
});
test('same exact source offers a single managed install root with desktop to headless switch and rollback',()=>{
 sandbox(dir=>{
  const desktop=b(dir,'desktop');
  const installRoot=path.join(dir,'managed');
  const first=apply({bundle:desktop.bundle,root:installRoot,
    expectedManifestSha256:desktop.manifestSha256});
  const headless=b(dir,'headless');
  const next=apply({bundle:headless.bundle,root:installRoot,
    expectedManifestSha256:headless.manifestSha256});
  assert.equal(next.mode,'headless');
  assert.equal(inspect({root:installRoot}).release,next.release);
  assert.equal(rollback({root:installRoot}).release,first.release);
  assert.equal(inspect({root:installRoot}).mode,'desktop');
  assert.equal(fs.readdirSync(path.join(installRoot,'releases')).length,2);
 });
});
test('native runtime cannot be started by a bundle inspection or without explicit owner-run',()=>{
 sandbox(dir=>{
  const pkg=b(dir);
  const install=apply({bundle:pkg.bundle,root:path.join(dir,'managed'),
    expectedManifestSha256:pkg.manifestSha256});
  const run=spawnSync(process.execPath,[install.entry,'headless'],{
   encoding:'utf8',timeout:8000,env:{...process.env,V012_EXPLICIT_OWNER_RUN:''}});
  assert.equal(run.status,2);
  assert.match(run.stderr,/EXPLICIT_OWNER_RUN_REQUIRED/);
 });
});
test('integrity mutation of the real candidate refuses install without creating managed root',()=>{
 sandbox(dir=>{
  const pkg=b(dir);
  fs.appendFileSync(path.join(pkg.bundle,'PRODUCT.json'),'tampered');
  const installed=path.join(dir,'managed');
  assert.throws(()=>apply({bundle:pkg.bundle,root:installed,
   expectedManifestSha256:pkg.manifestSha256}),/PAYLOAD_HASH_MISMATCH/);
  assert.equal(fs.existsSync(installed),false);
 });
});
test('invalid root and unrecognized output path refuse source assembly without replacing contents',()=>{
 sandbox(dir=>{
  const guard=path.join(dir,'guard.txt');
  fs.writeFileSync(guard,'valuable');
  assert.throws(()=>assembleCandidate({sourceRoot:dir,outputParent:dir}),/SOURCE_COMPONENT_VERSION_DRIFT|ENOENT/);
  assert.equal(fs.readFileSync(guard,'utf8'),'valuable');
  assert.throws(()=>assembleCandidate({sourceRoot:root,outputParent:path.join(dir,'missing')}),
   /OUTPUT_PARENT_MISSING/);
 });
});
