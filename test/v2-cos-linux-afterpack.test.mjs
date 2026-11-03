import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import afterPack,{repairLinuxAfterPack} from '../tools/v2-cos-linux-afterpack.mjs';

function fixture(t){
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'v2-cos-staging-'));
 t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const root=path.join(parent,'linux-unpacked');
 fs.mkdirSync(path.join(root,'resources'),{recursive:true});
 fs.writeFileSync(path.join(root,'chat-on-steroids'), 'binary');
 fs.writeFileSync(path.join(root,'resources','app.asar'),'asar-content');
 fs.writeFileSync(path.join(root,'resources','other.txt'),'test-resource');
 fs.chmodSync(root,0o700);
 fs.chmodSync(path.join(root,'resources'),0o700);
 fs.chmodSync(path.join(root,'chat-on-steroids'),0o700);
 fs.chmodSync(path.join(root,'resources','app.asar'),0o600);
 fs.chmodSync(path.join(root,'resources','other.txt'),0o600);
 return root;
}
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
test('Linux staged output repaired in place, content exact, repeat idempotent',async t=>{
 const root=fixture(t);
 const asar=path.join(root,'resources','app.asar');
 const before=sha(asar);
 const ctx={electronPlatformName:'linux',appOutDir:root};
 const result=await afterPack(ctx);
 assert.deepEqual(result,{status:'LINUX_STAGED_MODES_REPAIRED',files:3,directories:2});
 assert.equal(fs.statSync(root).mode&0o777,0o755);
 assert.equal(fs.statSync(asar).mode&0o777,0o644);
 assert.equal(fs.statSync(path.join(root,'chat-on-steroids')).mode&0o777,0o755);
 assert.equal(sha(asar),before);
 assert.deepEqual(repairLinuxAfterPack(ctx),result);
});
test('nonlinux is unchanged, malformed/stale layouts fail closed', t=>{
 const root=fixture(t);
 assert.equal(repairLinuxAfterPack({electronPlatformName:'win32',appOutDir:root}).status,'OTHER_PLATFORM_NOOP');
 assert.equal(fs.statSync(root).mode&0o777,0o700);
 assert.throws(()=>repairLinuxAfterPack({electronPlatformName:'linux',appOutDir:'/opt'}),/STAGING_ROOT_INVALID/);
 assert.throws(()=>repairLinuxAfterPack({electronPlatformName:'linux',appOutDir:root.replace('linux-unpacked','other')}),/STAGING_ROOT_INVALID/);
 fs.unlinkSync(path.join(root,'resources','app.asar'));
 assert.throws(()=>repairLinuxAfterPack({electronPlatformName:'linux',appOutDir:root}),/ASAR_MISSING/);
 assert.equal(fs.statSync(root).mode&0o777,0o700);
});
test('preflight prevents partial writes on hardlinks and privileged modes',t=>{
 const root=fixture(t);
 const file=path.join(root,'resources','other.txt');
 const hard=path.join(root,'resources','hardlink.txt');
 fs.linkSync(file,hard);
 assert.throws(()=>repairLinuxAfterPack({electronPlatformName:'linux',appOutDir:root}),/SPECIAL_FILE_OR_HARDLINK/);
 assert.equal(fs.statSync(root).mode&0o777,0o700);
 fs.unlinkSync(hard);
 fs.chmodSync(file,0o4755);
 assert.throws(()=>repairLinuxAfterPack({electronPlatformName:'linux',appOutDir:root}),/SPECIAL_MODE_UNEXPECTED/);
 assert.equal(fs.statSync(root).mode&0o777,0o700);
});
