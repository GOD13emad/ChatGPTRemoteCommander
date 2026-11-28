import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createOwnerNativeSignedWorkerClient,safeOwnerSignerFailureCode,nativeSignerSourceTrustFailure,packagedSignerRootMappedTrust}
  from '../src/v012-owner-worker-signer-client-linux.mjs';
function ownerWitnessOptions(home,profile='qa-profile'){
 return {
   home,profile,witnessSocketPath:'/run/user/'+process.getuid()+'/qa-private-witness/proof.sock',
   witnessPublicKeyPath:path.join(home,'.local/state/chatgpt-remote-commander',
     'private-pair-security-'+profile,'native-witness','public.pem')
 };
}
test('one-shot owner signer client refuses missing native sealed credential before spawning systemd', {skip:process.platform!=='linux'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-owner-signer-client-'));
 try{
   const client=createOwnerNativeSignedWorkerClient(ownerWitnessOptions(root));
   await assert.rejects(client.sign({tool:'run_shell',grant:'FULL'}),
     error=>error?.code==='ENOENT'||error?.code==='RC012_OWNER_SIGNER_CREDENTIAL_NOT_PRIVATE');
   assert.throws(()=>createOwnerNativeSignedWorkerClient(ownerWitnessOptions(root,'../other')),
     {code:'RC012_OWNER_SIGNER_PROFILE_INVALID'});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('client refuses user-writable external credential and never falls back to plaintext', {skip:process.platform!=='linux'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-owner-signer-client-'));
 try{
   const dir=path.join(root,'.local/state/chatgpt-remote-commander/private-pair-security-qa-profile/worker-identity');
   fs.mkdirSync(dir,{recursive:true,mode:0o700});
   const file=path.join(dir,'worker-ed25519-seed.cred');
   fs.writeFileSync(file,Buffer.alloc(64),{mode:0o644});
   fs.chmodSync(file,0o644);
   const client=createOwnerNativeSignedWorkerClient(ownerWitnessOptions(root));
   await assert.rejects(client.sign({}),{code:'RC012_OWNER_SIGNER_CREDENTIAL_NOT_PRIVATE'});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('bounded transient signer stderr classification never exposes mixed data',()=>{
 const nl=String.fromCharCode(10);
 assert.equal(safeOwnerSignerFailureCode('RC012_NATIVE_SIGNER_INTENT_IDENTITY_MISMATCH'+nl),
  'RC012_NATIVE_SIGNER_INTENT_IDENTITY_MISMATCH');
 assert.equal(safeOwnerSignerFailureCode('NATIVE_WORKER_KEY_ID_MISMATCH'+nl),
  'NATIVE_WORKER_KEY_ID_MISMATCH');
 assert.equal(safeOwnerSignerFailureCode('SECRET'+nl+'RC012_NATIVE_SIGNER_INPUT_INVALID'+nl),
  'RC012_OWNER_SIGNER_UNIT_FAILED');
 assert.equal(safeOwnerSignerFailureCode('RC012_NATIVE_SIGNER_INPUT_INVALID'+nl+'../../private'),
  'RC012_OWNER_SIGNER_UNIT_FAILED');
 assert.equal(safeOwnerSignerFailureCode('X'.repeat(20000)),
  'RC012_OWNER_SIGNER_UNIT_FAILED');
});

test('packaged native signer source trust rejects each unsafe metadata cause without exception text',()=>{
 const good={isFile:()=>true,isSymbolicLink:()=>false,
  nlink:1,uid:0,mode:0o100644,size:4698};
 const classify=x=>nativeSignerSourceTrustFailure(x,1000);
 assert.equal(classify(good),null);
 assert.equal(classify({...good,uid:1000,mode:0o100600}),null);
 assert.equal(classify({...good,isFile:()=>false}),'RC012_OWNER_SIGNER_SOURCE_NOT_FILE');
 assert.equal(classify({...good,isSymbolicLink:()=>true}),'RC012_OWNER_SIGNER_SOURCE_ALIAS');
 assert.equal(classify({...good,nlink:2}),'RC012_OWNER_SIGNER_SOURCE_LINK_COUNT');
 assert.equal(classify({...good,uid:2000}),'RC012_OWNER_SIGNER_SOURCE_OWNER_CHANGED');
 assert.equal(classify({...good,mode:0o100664}),'RC012_OWNER_SIGNER_SOURCE_WRITABLE');
 assert.equal(classify({...good,mode:0o100646}),'RC012_OWNER_SIGNER_SOURCE_WRITABLE');
 assert.equal(classify({...good,size:262145}),'RC012_OWNER_SIGNER_SOURCE_BOUNDS');
 assert.equal(nativeSignerSourceTrustFailure(good,0),'RC012_OWNER_SIGNER_SOURCE_OWNER_INVALID');
 assert.equal(nativeSignerSourceTrustFailure(null,1000),'RC012_OWNER_SIGNER_SOURCE_NOT_FILE');
});

test('systemd user-namespace root overflow is accepted only for exact signed package member', {skip:process.platform!=='linux'},()=>{
  const p='/usr/lib/chatgpt-remote-commander/app/tools/v012-native-worker-registration-signer-linux.mjs';
  const uid=process.getuid(),stat=fs.lstatSync(p);
  const lines=fs.readFileSync('/proc/self/uid_map','utf8').trim().split(/\r?\n/);
  const row=lines.length===1?lines[0].trim().split(/\s+/).map(Number):[];
  const mapped=row.length===3&&row[0]===uid&&row[1]===uid&&row[2]===1&&stat.uid===65534;
  assert.equal(mapped,process.env.RC012_EXPECT_USERNS==='1');
  assert.equal(packagedSignerRootMappedTrust(p,uid),mapped);
  assert.equal(packagedSignerRootMappedTrust(p+'.untrusted',uid),false);
  const bad={isFile:()=>true,isSymbolicLink:()=>false,
    uid:65534,nlink:2,mode:0o100644,size:4698};
  assert.equal(packagedSignerRootMappedTrust(p,uid,bad),false);
  assert.equal(packagedSignerRootMappedTrust(p,0),false);
  assert.equal(packagedSignerRootMappedTrust('/tmp/arbitrary-signer.mjs',uid),false);
});
