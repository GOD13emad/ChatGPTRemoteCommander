import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import {
  writeBrowserLeaseMarker, readBrowserLeaseMarker, removeBrowserLeaseMarker,
  reapOrphanedIsolatedBrowserProfiles
} from '../src/browser-lease-store.mjs';

const iso=name=>path.join(name,'isolated-mustest1a-0123456789ab');

test('browser lease marker is exact, private and removable', async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'rc-browser-lease-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const profile=iso(root);
  const marker=writeBrowserLeaseMarker({profileDir:profile,instance:'default',isolated:true,createdAt:1000,expiresAt:9000,ownerPid:123});
  assert.equal(marker.profileDir,path.resolve(profile));
  const stored=readBrowserLeaseMarker(profile);
  assert.equal(stored.ownerPid,123);
  assert.equal(stored.expiresAt,9000);
  const mode=fs.statSync(path.join(profile,'.remote-commander-lease.json')).mode & 0o777;
  if(process.platform!=='win32')assert.equal(mode,0o600);
  assert.equal(removeBrowserLeaseMarker(profile),true);
  assert.equal(readBrowserLeaseMarker(profile),null);
});

test('startup reaper preserves a live unexpired isolated profile', async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'rc-browser-reap-live-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const profile=iso(root);
  await writeFile(path.join(profile,'keep.txt'),'keep',{flag:'w'}).catch(async()=>{
    fs.mkdirSync(profile,{recursive:true});await writeFile(path.join(profile,'keep.txt'),'keep');
  });
  writeBrowserLeaseMarker({profileDir:profile,isolated:true,createdAt:1000,expiresAt:9000,ownerPid:321});
  const result=reapOrphanedIsolatedBrowserProfiles({instanceRoot:root,now:5000,processAlive:()=>true});
  assert.equal(result.scanned,1);
  assert.equal(result.skippedActive,1);
  assert.equal(result.reaped,0);
  assert.equal(fs.existsSync(profile),true);
});

test('startup reaper removes owner-dead and expired isolated profiles only', async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'rc-browser-reap-dead-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const dead=path.join(root,'isolated-mustest2b-111111111111');
  const expired=path.join(root,'isolated-mustest3c-222222222222');
  const invalid=path.join(root,'isolated-mustest4d-333333333333');
  const persistent=path.join(root,'default');
  for(const p of [dead,expired,invalid,persistent])fs.mkdirSync(p,{recursive:true});
  writeBrowserLeaseMarker({profileDir:dead,isolated:true,createdAt:1000,expiresAt:9000,ownerPid:111});
  writeBrowserLeaseMarker({profileDir:expired,isolated:true,createdAt:1000,expiresAt:2000,ownerPid:222});
  fs.writeFileSync(path.join(invalid,'user-data'),'preserve');
  fs.writeFileSync(path.join(persistent,'user-data'),'preserve');
  const result=reapOrphanedIsolatedBrowserProfiles({
    instanceRoot:root,now:5000,
    processAlive:pid=>pid===222
  });
  assert.equal(result.scanned,3);
  assert.equal(result.reaped,2);
  assert.equal(result.invalid,1);
  assert.equal(fs.existsSync(dead),false);
  assert.equal(fs.existsSync(expired),false);
  assert.equal(fs.existsSync(invalid),true,'unowned/invalid isolated directory must fail closed');
  assert.equal(fs.existsSync(persistent),true,'persistent profile must never be startup-reaped');
});

test('persistent profile cannot receive an isolated lease marker', async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'rc-browser-persistent-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const persistent=path.join(root,'default');
  fs.mkdirSync(persistent,{recursive:true});
  assert.equal(writeBrowserLeaseMarker({profileDir:persistent,isolated:false,expiresAt:9000}),null);
  assert.equal(fs.existsSync(path.join(persistent,'.remote-commander-lease.json')),false);
});
