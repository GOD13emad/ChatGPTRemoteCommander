import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createOwnerNativeSignedWorkerClient}
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
   const client=createOwnerNativeSignedWorkerClient(ownerWitnessOptions(root));
   await assert.rejects(client.sign({}),{code:'RC012_OWNER_SIGNER_CREDENTIAL_NOT_PRIVATE'});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
