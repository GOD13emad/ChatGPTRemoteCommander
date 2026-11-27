import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resolveLinuxOwnerPairEnrollmentDirectory} from '../tools/enroll-owner-private-tunnel-linux.mjs';

test('legacy Emad Tunnel profile resolves to default pair only before canonical profile exists',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-linux-owner-pair-'));
 try{
  const config=path.join(home,'.config','tunnel-client');
  fs.mkdirSync(config,{recursive:true});
  fs.writeFileSync(path.join(config,'Emad.yaml'),'health:\n  listen_addr: "127.0.0.1:47832"\\n');
  const expected=path.join(home,'.config','chatgpt-remote-commander','private-pair','default');
  assert.equal(resolveLinuxOwnerPairEnrollmentDirectory({home,profileId:'Emad'}),expected);
  fs.writeFileSync(path.join(config,'chatgpt-remote-commander.yaml'),'health:\n  listen_addr: "127.0.0.1:47833"\\n');
  assert.equal(resolveLinuxOwnerPairEnrollmentDirectory({home,profileId:'Emad'}),
   path.join(home,'.config','chatgpt-remote-commander','private-pair','Emad'));
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('canonical default and independent account profiles resolve to their own pair directories',()=>{
 const home=path.join(os.tmpdir(),'rc012-linux-owner-pair-root');
 assert.equal(resolveLinuxOwnerPairEnrollmentDirectory({home,profileId:'chatgpt-remote-commander'}),
  path.join(home,'.config','chatgpt-remote-commander','private-pair','default'));
 assert.equal(resolveLinuxOwnerPairEnrollmentDirectory({home,profileId:'MMZ'}),
  path.join(home,'.config','chatgpt-remote-commander','private-pair','MMZ'));
 assert.equal(resolveLinuxOwnerPairEnrollmentDirectory({home,profileId:'saeed-emad'}),
  path.join(home,'.config','chatgpt-remote-commander','private-pair','saeed-emad'));
});

test('owner pair enrollment path rejects traversal and relative home',()=>{
 assert.throws(()=>resolveLinuxOwnerPairEnrollmentDirectory({home:'/tmp/home',profileId:'../default'}),
  {code:'RC012_LINUX_OWNER_PAIR_ENROLLMENT_SCOPE_REQUIRED'});
 assert.throws(()=>resolveLinuxOwnerPairEnrollmentDirectory({home:'relative',profileId:'Emad'}),
  {code:'RC012_LINUX_OWNER_PAIR_ENROLLMENT_SCOPE_REQUIRED'});
});
