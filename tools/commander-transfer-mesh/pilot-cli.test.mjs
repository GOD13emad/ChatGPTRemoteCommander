import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const cli=path.resolve(import.meta.dirname,'pilot-cli.mjs');
function create(alias){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ctmesh-fixture-'));
 fs.writeFileSync(path.join(root,'node.json'),JSON.stringify({alias,schema:'ctmesh-node-v1'}));
 return root;
}
function run(root,...args){
 return spawnSync(process.execPath,[cli,...args],{
  encoding:'utf8',env:{...process.env,COMMANDER_TRANSFER_HOME:root},timeout:15000
 });
}
function withFixtures(fn){
 const src=create('PC'),dst=create('Linux');
 try{fn(src,dst)}finally{fs.rmSync(src,{recursive:true,force:true});fs.rmSync(dst,{recursive:true,force:true})}
}
function send(src,id,data){
 const file=path.join(src,'sample.bin');
 fs.writeFileSync(file,data);
 const r=run(src,'send','--peer','Linux','--path',file,'--id',id);
 assert.equal(r.status,0,r.stderr);
 return {file,receipt:JSON.parse(r.stdout)};
}
function mirror(src,dst,id){
 const srcDir=path.join(src,'pairs','Linux','transfers',id);
 const dstDir=path.join(dst,'pairs','PC','transfers',id);
 fs.mkdirSync(path.dirname(dstDir),{recursive:true});
 fs.cpSync(srcDir,dstDir,{recursive:true,errorOnExist:true,force:false});
 return dstDir;
}
test('send -> mirror -> receive validates bytes and hash and no overwrite',()=>{
 withFixtures((src,dst)=>{
  const input=crypto.randomBytes(128*1024);
  const {receipt}=send(src,'test-hash-001',input);
  assert.equal(receipt.sha256,crypto.createHash('sha256').update(input).digest('hex'));
  mirror(src,dst,'test-hash-001');
  const st=run(dst,'status','--peer','PC','--id','test-hash-001');
  assert.equal(JSON.parse(st.stdout).status,'RECEIVED_HASH_VERIFIED');
  const dest=path.join(dst,'inbox');
  const recv=run(dst,'receive','--peer','PC','--id','test-hash-001','--dest',dest);
  assert.equal(recv.status,0,recv.stderr);
  assert.deepEqual(fs.readFileSync(path.join(dest,'sample.bin')),input);
  assert.equal(JSON.parse(recv.stdout).status,'DELIVERED_HASH_VERIFIED');
  const repeated=run(dst,'receive','--peer','PC','--id','test-hash-001','--dest',dest);
  assert.notEqual(repeated.status,0);
  assert.match(repeated.stderr,/Destination exists/);
 });
});
test('same transfer ID cannot be silently reused',()=>{
 withFixtures((src)=>{
  send(src,'test-unique-001',Buffer.from('a'));
  const failed=run(src,'send','--peer','Linux','--path',path.join(src,'sample.bin'),'--id','test-unique-001');
  assert.notEqual(failed.status,0);
  assert.match(failed.stderr,/EEXIST/);
 });
});
test('corrupt incoming payload never reaches inbox',()=>{
 withFixtures((src,dst)=>{
  send(src,'test-corrupt-001',crypto.randomBytes(1024));
  const folder=mirror(src,dst,'test-corrupt-001');
  fs.writeFileSync(path.join(folder,'payload.bin'),'not the intended content');
  const result=run(dst,'receive','--peer','PC','--id','test-corrupt-001','--dest',path.join(dst,'inbox'));
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/SHA256\/size mismatch/);
  assert.equal(fs.existsSync(path.join(dst,'inbox','sample.bin')),false);
 });
});
test('untrusted peer and malformed transfer ID rejected',()=>{
 withFixtures((src)=>{
  const input=path.join(src,'source.bin');
  fs.writeFileSync(input,'a');
  for(const opts of [
   ['--peer','Unknown','--path',input,'--id','valid-id'],
   ['--peer','Linux','--path',input,'--id','../escape'],
   ['--peer','PC','--path',input,'--id','valid-id']
  ]){
   const r=run(src,'send',...opts);
   assert.notEqual(r.status,0);
  }
 });
});
test('symlink input cannot be transferred as a regular file',(t)=>{
 withFixtures((src)=>{
  const file=path.join(src,'secret.bin'),link=path.join(src,'link.bin');
  fs.writeFileSync(file,'data');
  try{fs.symlinkSync(file,link);}catch(e){if(e.code==='EPERM'){t.skip('Windows symlink creation requires privilege');return;}throw e;}
  const r=run(src,'send','--peer','Linux','--path',link,'--id','test-link-001');
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/Unsafe source/);
 });
});
