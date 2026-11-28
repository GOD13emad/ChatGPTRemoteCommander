import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const builder=path.join(repo,'tools','build-candidate-config.mjs');
const defaults=path.join(repo,'config.json');
const LINUX=process.platform==='linux';
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-candidate-owner-pin-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const home=path.join(root,'home');
  fs.mkdirSync(home,{mode:0o700});
  const pair=path.join(home,'.config','chatgpt-remote-commander','private-pair','default');
  fs.mkdirSync(pair,{recursive:true,mode:0o700});
  const record={
    schema:1,kind:'linux-owner-private-one-tunnel',
    hostId:'pinned-existing-host',profileId:'Emad',
    ownerSidHash:'a'.repeat(64),
    expectedExecutablePath:'/usr/bin/tunnel-client',
    expectedExecutableSha256:'b'.repeat(64),healthPort:47901,
    expectedClientLeafDerSha256:'c'.repeat(64),
    enrolledAtMs:Date.now()
  };
  const pinFile=path.join(pair,'owner-tunnel-trust.json');
  fs.writeFileSync(pinFile,JSON.stringify(record)+'\n',{mode:0o600});
  const out=path.join(root,'candidate.json');
  const state=path.join(root,'state');
  const args=['--default',defaults,'--output',out,'--profile-id','v012qa',
    '--port','49998','--state-dir',state,'--mode','standard',
    '--owner-pin-profile','Emad'];
  const run=(extra=[],environment={})=>spawnSync(process.execPath,
    [builder,...args,...extra],{
      env:{...process.env,HOME:home,...environment},
      cwd:repo,encoding:'utf8',timeout:15000,maxBuffer:10000
    });
  return {root,home,pair,pinFile,out,record,run};
}

test('candidate builder accepts only the currently pinned exact Linux owner host', {skip:!LINUX},t=>{
  const f=fixture(t);
  const result=f.run();
  assert.equal(result.status,0,result.stderr);
  const data=JSON.parse(fs.readFileSync(f.out,'utf8'));
  assert.equal(data.deviceName,f.record.hostId);
  assert.equal(data.instance.profile,'v012qa');
  assert.equal(data.host,'127.0.0.1');
  assert.equal(data.capabilityProfile.tier,'STANDARD');
  assert.equal(fs.statSync(f.out).mode&0o077,0);
});

test('candidate builder refuses explicit device name with native pinned identity', {skip:!LINUX},t=>{
  const f=fixture(t);
  const result=f.run(['--device-name','unverified-other-host']);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/CANDIDATE_OWNER_PIN_AMBIGUOUS_DEVICE/);
  assert.equal(fs.existsSync(f.out),false);
});

test('candidate builder does not borrow default PIN from another profile', {skip:!LINUX},t=>{
  const f=fixture(t);
  const result=f.run(['--owner-pin-profile','Other']);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/RC012_WORKER_KEY_PINNED_TUNNEL_REQUIRED/);
  assert.equal(fs.existsSync(f.out),false);
});

test('candidate builder rejects publicly readable owner trust PIN before writing', {skip:!LINUX},t=>{
  const f=fixture(t);
  fs.chmodSync(f.pinFile,0o644);
  const result=f.run();
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/RC012_LINUX_OWNER_TRUST_FILE_UNSAFE/);
  assert.equal(fs.existsSync(f.out),false);
});

test('native Linux PIN candidate mode rejects Windows without modifying a config', {skip:LINUX},t=>{
  const f=fixture(t);
  const result=f.run();
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/CANDIDATE_OWNER_PIN_LINUX_REQUIRED/);
  assert.equal(fs.existsSync(f.out),false);
});
