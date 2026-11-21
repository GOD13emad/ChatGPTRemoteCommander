import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {
  keyIdForSeed,inspectOwnerWorkerKeyCapsule
} from '../tools/provision-owner-worker-key-linux.mjs';

const dir=path.dirname(fileURLToPath(import.meta.url));
const script=path.resolve(dir,'../tools/provision-owner-worker-key-linux.mjs');
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
const OWNER='a'.repeat(64),TUNNEL='b'.repeat(64);
const id={
  hostId:'synthetic-host',profileId:'synthetic-profile',
  expectedOwnerSidHash:OWNER,expectedTunnelIdHash:TUNNEL
};
const make=()=>fs.mkdtempSync(path.join(os.tmpdir(),'rc012-sealed-worker-'));
function capsule(root){
  const folder=path.join(root,'worker-identity');
  fs.mkdirSync(folder,{mode:0o700});
  const seed=randomBytes(32);
  const cipher=Buffer.from('SYNTHETIC_NOT_REAL_ENCRYPTED_WORKER_SEED_FOR_QA');
  const keyId=keyIdForSeed(seed);
  fs.writeFileSync(path.join(folder,'worker-ed25519-seed.cred'),cipher,{mode:0o600});
  const manifest={schema:1,hostId:id.hostId,profileId:id.profileId,
    ownerSidHash:OWNER,tunnelIdHash:TUNNEL,keyId,cipherSha256:hash(cipher)};
  fs.writeFileSync(path.join(folder,'worker-key-id.json'),
    JSON.stringify(manifest)+'\n',{mode:0o600});
  function inspect(patch={}) {
    return inspectOwnerWorkerKeyCapsule({
      directory:folder,profile:id.profileId,
      identity:{...id,...patch},ownerUid:process.getuid?.(),
      // Never a production decryption. The synthetic fixture verifies only
      // manifest/ACL checks, Ed25519 key derivation and replay rejection.
      unseal:()=>Buffer.from(seed)
    });
  }
  return {folder,seed,cipher,manifest,keyId,inspect};
}

test('one owner/pair sealed Worker capsule validates exact hash, Ed25519 key and strict file owner ACL without showing seed',{
  skip:process.platform!=='linux'
},()=>{
  const root=make();
  try{
    const f=capsule(root);
    const proof=f.inspect();
    assert.equal(proof.verified,true);
    assert.equal(proof.keyId,f.keyId);
    assert.equal(proof.profileId,id.profileId);
    assert.equal(fs.readdirSync(f.folder).length,2);
    assert.deepEqual(fs.readFileSync(path.join(f.folder,'worker-key-id.json'),'utf8'),
      JSON.stringify(f.manifest)+'\n');
    assert.throws(()=>f.inspect({expectedTunnelIdHash:'c'.repeat(64)}),
      {code:'RC012_WORKER_KEY_RECEIPT_INVALID'});
    assert.throws(()=>f.inspect({expectedOwnerSidHash:'c'.repeat(64)}),
      {code:'RC012_WORKER_KEY_RECEIPT_INVALID'});
    const pathCred=path.join(f.folder,'worker-ed25519-seed.cred');
    fs.chmodSync(pathCred,0o644);
    assert.throws(()=>f.inspect(),{code:'RC012_WORKER_KEY_FILE_NOT_PRIVATE'});
    fs.chmodSync(pathCred,0o600);
    fs.appendFileSync(pathCred,'tampered');
    assert.throws(()=>f.inspect(),{code:'RC012_WORKER_KEY_RECEIPT_INVALID'});
    assert.notEqual(f.keyId,'0'.repeat(64));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('sealed Worker capsule refuses unexpected files, aliases and an unrelated key even when ciphertext matches',{
  skip:process.platform!=='linux'
},()=>{
  const root=make();
  try{
    const f=capsule(root);
    const extra=path.join(f.folder,'extra.json');
    fs.writeFileSync(extra,'synthetic',{mode:0o600});
    assert.throws(()=>f.inspect(),{code:'RC012_WORKER_KEY_CAPSULE_UNEXPECTED_FILES'});
    fs.unlinkSync(extra);
    const keyfile=path.join(f.folder,'worker-ed25519-seed.cred');
    const other=path.join(root,'copied.cred');
    fs.copyFileSync(keyfile,other);
    fs.unlinkSync(keyfile);fs.symlinkSync(other,keyfile);
    assert.throws(()=>f.inspect(),{code:'RC012_WORKER_KEY_FILE_NOT_PRIVATE'});
    fs.unlinkSync(keyfile);fs.copyFileSync(other,keyfile);fs.chmodSync(keyfile,0o600);
    const manifest=path.join(f.folder,'worker-key-id.json');
    const changed={...f.manifest,keyId:'f'.repeat(64)};
    fs.writeFileSync(manifest,JSON.stringify(changed)+'\n',{mode:0o600});
    assert.throws(()=>f.inspect(),{code:'RC012_WORKER_KEY_IDENTITY_MISMATCH'});
    assert.throws(()=>keyIdForSeed(Buffer.alloc(31)),
      {code:'RC012_WORKER_KEY_SEED_INVALID'});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('owner-native worker key CLI cannot be used to stage with invalid modes or profile traversal',()=>{
  for(const args of [
    [],['--enroll'],['--stage','synthetic-profile'],
    ['--enroll','../another-owner'],['--preflight','../another-owner'],
    ['--enroll','a/b']
  ]){
    const result=spawnSync(process.execPath,[script,...args],{
      encoding:'utf8',timeout:4500,maxBuffer:2048
    });
    assert.equal(result.status,2,JSON.stringify(args));
    assert.equal(result.stdout.trim(),'');
    assert.match(result.stderr,/RC012_WORKER_KEY_OWNER_ARGS_REQUIRED/);
  }
  const source=fs.readFileSync(script,'utf8');
  for(const token of [
    'createPinnedLinuxPrivateTunnelIdentity',
    'createLinuxNativeOwnerSessionProvider',
    "ownerIdentityMode:'host-uid-v2'",
    'native.requestConsent',
    'systemd-creds','--with-key=host','--refuse-null',
    'O_EXCL','O_NOFOLLOW','privateDir','fs.renameSync(stage,directory)',
    'workerGrantIssued:false','fullAccessActive:false'
  ])assert.ok(source.includes(token),'missing fail-closed native owner gate: '+token);
});
