import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, realpath, writeFile, rm } from 'node:fs/promises';
import { copyPath, movePath } from '../src/power-tools-v0.3.mjs';
import { withPathLocks, lockStats } from '../src/locks.mjs';

const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'rc-fs-main-')));
const backups = await realpath(await mkdtemp(path.join(os.tmpdir(), 'rc-fs-main-backup-')));
const ctx = { roots:[root], config:{powerMode:{enabled:true,fullFilesystem:false,allowShell:false,allowProcessControl:false,allowPermanentDelete:false,backupRoot:backups,maxFileBytes:1024*1024}}};

try {
  await writeFile(path.join(root,'src.txt'),'SOURCE');
  await writeFile(path.join(root,'dst.txt'),'DEST');
  await mkdir(path.join(root,'dir'),{recursive:true});
  await writeFile(path.join(root,'dir','a.txt'),'A');

  await assert.rejects(()=>copyPath(ctx,{source:path.join(root,'src.txt'),destination:path.join(root,'src.txt'),overwrite:true}),/different paths/);
  await assert.rejects(()=>copyPath(ctx,{source:path.join(root,'dir'),destination:path.join(root,'dir','nested'),overwrite:true}),/inside source/);
  await assert.rejects(()=>movePath(ctx,{source:path.join(root,'dir'),destination:root,overwrite:true}),/contain source/);

  const copied=await copyPath(ctx,{source:path.join(root,'src.txt'),destination:path.join(root,'dst.txt'),overwrite:true});
  assert.equal(await readFile(path.join(root,'dst.txt'),'utf8'),'SOURCE');
  assert.ok(copied.backupPath);
  assert.equal(await readFile(copied.backupPath,'utf8'),'DEST');

  const events=[]; let releaseParent;
  const parent=withPathLocks([path.join(root,'dir')],async()=>{events.push('parent-start');await new Promise(r=>{releaseParent=r});events.push('parent-end');});
  while(!releaseParent) await new Promise(r=>setTimeout(r,1));
  let childStarted=false;
  const child=withPathLocks([path.join(root,'dir','a.txt')],async()=>{childStarted=true;events.push('child')});
  await new Promise(r=>setTimeout(r,20));
  assert.equal(childStarted,false);
  assert.equal(lockStats().queued,1);
  releaseParent(); await Promise.all([parent,child]);
  assert.deepEqual(events,['parent-start','parent-end','child']);

  console.log('FS_SAFETY_PASS');
} finally {
  await rm(root,{recursive:true,force:true});
  await rm(backups,{recursive:true,force:true});
}
