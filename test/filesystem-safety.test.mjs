import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  mkdtemp, mkdir, readFile, rm, symlink, writeFile
} from 'node:fs/promises';
import { safeExistingPath, safeWritablePath } from '../src/security-v0.3.mjs';
import { withPathLocks } from '../src/locks.mjs';
import { copyPath, movePath, deletePath, writeAnyFile } from '../src/power-tools-v0.3.mjs';

async function temp() {
  return mkdtemp(path.join(os.tmpdir(), 'rc-fs-safe-'));
}
function ctx(root, backups) {
  return {
    roots: [root],
    config: {
      powerMode: {
        enabled: true,
        fullFilesystem: false,
        allowShell: false,
        allowProcessControl: false,
        allowPermanentDelete: false,
        backupRoot: backups,
        maxFileBytes: 1024 * 1024
      }
    }
  };
}

test('restricted existing and writable paths reject symlink/junction escape', async (t) => {
  const root = await temp();
  const outside = await temp();
  t.after(async () => { await rm(root,{recursive:true,force:true}); await rm(outside,{recursive:true,force:true}); });
  await writeFile(path.join(outside,'secret.txt'),'outside');
  const link = path.join(root,'escape');
  try {
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform === 'win32' && (error.code === 'EPERM' || error.code === 'EACCES')) {
      t.skip('Windows junction/symlink creation unavailable for this user');
      return;
    }
    throw error;
  }
  await assert.rejects(() => safeExistingPath(path.join(link,'secret.txt'), [root]), /escapes allowed roots/);
  await assert.rejects(() => safeWritablePath(path.join(link,'new.txt'), [root]), /escapes allowed roots/);
});

test('parent and child path mutations serialize while sibling trees may run concurrently', async () => {
  const root = path.resolve(os.tmpdir(),'rc-lock-root');
  const events = [];
  let releaseParent;
  const parent = withPathLocks([path.join(root,'a')], async () => {
    events.push('parent-start');
    await new Promise((resolve) => { releaseParent = resolve; });
    events.push('parent-end');
  });
  await new Promise((resolve) => setImmediate(resolve));

  let childStarted = false;
  const child = withPathLocks([path.join(root,'a','b.txt')], async () => {
    childStarted = true;
    events.push('child');
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(childStarted,false);

  let siblingStarted = false;
  const sibling = withPathLocks([path.join(root,'z','c.txt')], async () => {
    siblingStarted = true;
    events.push('sibling');
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(siblingStarted,true);

  releaseParent();
  await Promise.all([parent,child,sibling]);
  assert.ok(events.indexOf('child') > events.indexOf('parent-end'));
});

test('copy and move reject self/ancestor/descendant hazards before mutation', async (t) => {
  const root = await temp();
  const backups = await temp();
  t.after(async()=>{await rm(root,{recursive:true,force:true});await rm(backups,{recursive:true,force:true});});
  await mkdir(path.join(root,'tree','child'),{recursive:true});
  await writeFile(path.join(root,'tree','a.txt'),'A');
  const c=ctx(root,backups);

  await assert.rejects(() => copyPath(c,{source:path.join(root,'tree'),destination:path.join(root,'tree'),overwrite:true}), /different paths/);
  await assert.rejects(() => copyPath(c,{source:path.join(root,'tree'),destination:path.join(root,'tree','child','copy'),overwrite:true}), /inside source/);
  await assert.rejects(() => movePath(c,{source:path.join(root,'tree','child'),destination:path.join(root,'tree'),overwrite:true}), /contain source/);

  assert.equal(await readFile(path.join(root,'tree','a.txt'),'utf8'),'A');
});

test('copy overwrite stages first and preserves old destination with recoverable backup', async (t) => {
  const root=await temp(), backups=await temp();
  t.after(async()=>{await rm(root,{recursive:true,force:true});await rm(backups,{recursive:true,force:true});});
  const c=ctx(root,backups);
  await writeFile(path.join(root,'src.txt'),'new');
  await writeFile(path.join(root,'dst.txt'),'old');
  const result=await copyPath(c,{source:path.join(root,'src.txt'),destination:path.join(root,'dst.txt'),overwrite:true});
  assert.equal(await readFile(path.join(root,'dst.txt'),'utf8'),'new');
  assert.ok(result.backupPath);
  assert.equal(await readFile(result.backupPath,'utf8'),'old');
});

test('move leaves source untouched when destination exists without overwrite', async (t) => {
  const root=await temp(), backups=await temp();
  t.after(async()=>{await rm(root,{recursive:true,force:true});await rm(backups,{recursive:true,force:true});});
  const c=ctx(root,backups);
  await writeFile(path.join(root,'src.txt'),'source');
  await writeFile(path.join(root,'dst.txt'),'dest');
  await assert.rejects(() => movePath(c,{source:path.join(root,'src.txt'),destination:path.join(root,'dst.txt')}),/destination exists/);
  assert.equal(await readFile(path.join(root,'src.txt'),'utf8'),'source');
  assert.equal(await readFile(path.join(root,'dst.txt'),'utf8'),'dest');
});

test('move commits destination before removing source and reports sourceRemoved', async (t) => {
  const root=await temp(), backups=await temp();
  t.after(async()=>{await rm(root,{recursive:true,force:true});await rm(backups,{recursive:true,force:true});});
  const c=ctx(root,backups);
  await writeFile(path.join(root,'src.txt'),'payload');
  const result=await movePath(c,{source:path.join(root,'src.txt'),destination:path.join(root,'dst.txt')});
  assert.equal(result.sourceRemoved,true);
  assert.equal(await readFile(path.join(root,'dst.txt'),'utf8'),'payload');
  await assert.rejects(readFile(path.join(root,'src.txt'),'utf8'),/ENOENT/);
});
test('recoverable delete refuses a target that contains the backup root', async (t) => {
  const root=await temp();
  const backups=path.join(root,'tree','.chatgpt-backups');
  t.after(async()=>{await rm(root,{recursive:true,force:true});});
  await mkdir(backups,{recursive:true});
  await writeFile(path.join(root,'tree','keep.txt'),'keep');
  const c=ctx(root,backups);
  await assert.rejects(() => deletePath(c,{path:path.join(root,'tree')}),/backupRoot is inside target/);
  assert.equal(await readFile(path.join(root,'tree','keep.txt'),'utf8'),'keep');
});

test('move refuses a source tree that contains the configured backup root', async (t) => {
  const root=await temp();
  const backups=path.join(root,'source','.chatgpt-backups');
  t.after(async()=>{await rm(root,{recursive:true,force:true});});
  await mkdir(backups,{recursive:true});
  await writeFile(path.join(root,'source','keep.txt'),'keep');
  const c=ctx(root,backups);
  await assert.rejects(() => movePath(c,{source:path.join(root,'source'),destination:path.join(root,'dest')}),/backupRoot is inside target/);
  assert.equal(await readFile(path.join(root,'source','keep.txt'),'utf8'),'keep');
});
test('restricted write refuses an existing symbolic-link target', async (t) => {
  const root=await temp(), outside=await temp(), backups=await temp();
  t.after(async()=>{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});await rm(backups,{recursive:true,force:true});});
  const target=path.join(outside,'target.txt');
  await writeFile(target,'outside');
  const link=path.join(root,'link.txt');
  try {
    await symlink(target,link,'file');
  } catch (error) {
    if (process.platform === 'win32' && (error.code === 'EPERM' || error.code === 'EACCES')) {
      t.skip('Windows file symlink creation unavailable for this user');
      return;
    }
    throw error;
  }
  await assert.rejects(() => writeAnyFile(ctx(root,backups),{path:link,content:'NO'}), /symbolic-link writes|escapes allowed roots/);
  assert.equal(await readFile(target,'utf8'),'outside');
});
