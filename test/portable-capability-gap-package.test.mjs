import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {managePortablePackage} from '../tools/portable-capability-gap-package.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const oldCommit='2dec31b85944c806d583688abaf9c61c5624dabc';
const oldHashes={
 'portable-capability-gap-cli.mjs':'8b047e5f7505b555346da562d1d7312c533f6bd43c0ce3062566bc4261e69bfe',
 'capability-gap-registry.mjs':'23f0f7a18133b506fe7273920d91841b8fcbae7317e4b19e0684240b48a33683'
};
const extras={
 'v1-dev23-capgap-native-qa.mjs':{path:'tools/v1-dev23-capgap-native-qa.mjs',sha:'9d01f14f6c2f1d1be32bd11304c07a6f8db5d68e522271167f773da2d8eb2bd1'},
 'v1-dev23-capgap-stage.mjs':{path:'tools/v1-dev23-capgap-stage.mjs',sha:'0cee9cdf96bf2e04ae5b85a81457b6bb23b9dbc2eac9ae05416c4ca708d70bff'}
};
const expected={
 'portable-capability-gap-cli.mjs':'8b047e5f7505b555346da562d1d7312c533f6bd43c0ce3062566bc4261e69bfe',
 'capability-gap-registry.mjs':'14ef40c424eb5429db550e563ad12b9c79d79c7f35ace0d7e4d1ff728fde59cb',
 'owner-private-storage.mjs':'c37ae0c79f11e15dd31adbdac1bed793891ed647135dc36921511dce0ab5ddaa'
};
const qa=()=>{const home=fs.mkdtempSync(path.join(os.tmpdir(),'capgap-portable-qa-'));fs.chmodSync(home,0o700);fs.mkdirSync(path.join(home,'state'),{mode:0o700});return home;};
const target=home=>path.join(home,'state','gap-client');
const backup=home=>path.join(home,'state','.capgap-portable-rollback-v1');
const recovery=home=>path.join(home,'state','.capgap-portable-recovery-new');
const unpack=folder=>Object.fromEntries(fs.readdirSync(folder).sort().map(n=>[n,hash(fs.readFileSync(path.join(folder,n)))]));
const fixture=()=>{
 const b={};
 for(const [name,sha] of Object.entries(oldHashes)){
  const from=name==='portable-capability-gap-cli.mjs'?'tools/portable-capability-gap-cli.mjs':'src/capability-gap-registry.mjs';
  const p=spawnSync('git',['-C',root,'show',oldCommit+':'+from],{encoding:null,timeout:8000});
  if(p.status!==0)throw Error('LEGACY_SOURCE_UNAVAILABLE');
  assert.equal(hash(p.stdout),sha);
  b[name]=p.stdout;
 }
 return b;
};
const seed=(home,{adjuncts=false,other=false}={})=>{
 const dir=target(home);fs.mkdirSync(dir,{mode:0o700});
 for(const [name,bytes] of Object.entries(fixture()))fs.writeFileSync(path.join(dir,name),bytes,{mode:0o600,flag:'wx'});
 if(adjuncts)for(const [name,obj] of Object.entries(extras)){
  const b=fs.readFileSync(path.join(root,obj.path));assert.equal(hash(b),obj.sha);
  // Faithfully model the observed Emad PC Lite 0664 file mode inside private 0700.
  fs.writeFileSync(path.join(dir,name),b,{mode:0o664,flag:'wx'});
 }
 if(other)fs.writeFileSync(path.join(dir,'unexpected.dat'),'must-not-delete',{flag:'wx',mode:0o600});
 return unpack(dir);
};
test('three-file package fresh install is private, exact and idempotent',{skip:process.platform!=='linux'},()=>{
 const home=qa();
 try{
  assert.equal(managePortablePackage({qaRoot:home}).state,'absent');
  const r=managePortablePackage({qaRoot:home,action:'install'});
  assert.equal(r.changed,true);assert.equal(r.rollbackReady,false);
  assert.deepEqual(unpack(target(home)),expected);
  assert.equal(managePortablePackage({qaRoot:home,action:'install'}).changed,false);
  for(const n of Object.keys(expected))assert.equal(fs.statSync(path.join(target(home),n)).mode&0o777,0o600);
  assert.throws(()=>managePortablePackage({qaRoot:home,action:'rollback'}),/PORTABLE3_ROLLBACK_PRECONDITION/);
  assert.equal(fs.readdirSync(path.join(home,'state')).join(','),'gap-client');
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('exact legacy two-file migration and reversible rollback preserve original bytes',{skip:process.platform!=='linux'},()=>{
 const home=qa();
 try{
  const prior=seed(home);
  assert.equal(managePortablePackage({qaRoot:home}).state,'legacy-two-file');
  const r=managePortablePackage({qaRoot:home,action:'upgrade'});
  assert.equal(r.changed,true);assert.equal(r.rollbackReady,true);
  assert.deepEqual(unpack(target(home)),expected);
  assert.deepEqual(unpack(backup(home)),prior);
  assert.equal(managePortablePackage({qaRoot:home,action:'upgrade'}).changed,false);
  const roll=managePortablePackage({qaRoot:home,action:'rollback'});
  assert.equal(roll.changed,true);assert.equal(roll.state,'legacy-two-file');
  assert.deepEqual(unpack(target(home)),prior);
  assert.deepEqual(unpack(recovery(home)),expected);
  assert.equal(fs.existsSync(backup(home)),false);
  assert.throws(()=>managePortablePackage({qaRoot:home,action:'upgrade'}),/PORTABLE3_ROLLBACK_SLOT_OCCUPIED/);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('Emad PC Lite two extra scripts preserve hashes and become private in staged package',{skip:process.platform!=='linux'},()=>{
 const home=qa();
 try{
  const old=seed(home,{adjuncts:true}),names=Object.keys(extras);
  const r=managePortablePackage({qaRoot:home,action:'upgrade'});
  assert.deepEqual(r.adjuncts,names.sort());
  for(const n of names){
   assert.equal(hash(fs.readFileSync(path.join(target(home),n))),old[n]);
   assert.equal(fs.statSync(path.join(target(home),n)).mode&0o777,0o600);
   assert.equal(hash(fs.readFileSync(path.join(backup(home),n))),old[n]);
  }
  const o=managePortablePackage({qaRoot:home,action:'rollback'});
  assert.deepEqual(o.adjuncts,names);
  assert.deepEqual(unpack(target(home)),old);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('hostile unknown file and tampered bytes fail closed without overwriting owner history',{skip:process.platform!=='linux'},()=>{
 const home=qa();
 try{
  const before=seed(home,{other:true});
  assert.throws(()=>managePortablePackage({qaRoot:home,action:'upgrade'}),/PORTABLE3_UNRECOGNIZED_INSTALLATION/);
  assert.deepEqual(unpack(target(home)),before);
  assert.equal(fs.existsSync(backup(home)),false);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
 const second=qa();
 try{
  seed(second);
  fs.appendFileSync(path.join(target(second),'capability-gap-registry.mjs'),'DO-NOT-WRITE');
  const prior=unpack(target(second));
  assert.throws(()=>managePortablePackage({qaRoot:second,action:'upgrade'}),/PORTABLE3_UNRECOGNIZED_INSTALLATION/);
  assert.deepEqual(unpack(target(second)),prior);
 }finally{fs.rmSync(second,{recursive:true,force:true});}
});
test('injected staged upgrade failure atomically restores exact legacy directory',{skip:process.platform!=='linux'},()=>{
 const home=qa();
 try{
  const original=seed(home);
  assert.throws(()=>managePortablePackage({qaRoot:home,action:'upgrade',hook:stage=>{
   assert.equal(stage,'old-renamed');
   assert.equal(fs.existsSync(backup(home)),true);
   throw Error('SYNTHETIC_STAGE_FAILURE');
  }}),/SYNTHETIC_STAGE_FAILURE/);
  assert.deepEqual(unpack(target(home)),original);
  assert.equal(fs.existsSync(backup(home)),false);
  assert.deepEqual(fs.readdirSync(path.join(home,'state')),['gap-client']);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('owner boundary, unsafe scopes and link aliases are denied',{skip:process.platform!=='linux'},()=>{
 const home=qa();
 try{
  assert.throws(()=>managePortablePackage({qaRoot:path.join(home,'state'),action:'install'}),/PORTABLE3_QA_SCOPE_INVALID/);
  const external=fs.mkdtempSync(path.join(os.tmpdir(),'capgap-portable-external-'));
  try{
   fs.symlinkSync(external,target(home),'dir');
   assert.throws(()=>managePortablePackage({qaRoot:home,action:'status'}),/PORTABLE3_SYMLINK_DENIED/);
   assert.deepEqual(fs.readdirSync(external),[]);
  }finally{fs.rmSync(external,{recursive:true,force:true});}
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('stale mutation lock and broken backup symlink block upgrade without data loss',{skip:process.platform!=='linux'},()=>{
 const home=qa(),state=path.join(home,'state');
 try{
  const old=seed(home);
  const lock=path.join(state,'.capgap-portable-package.lock');
  fs.writeFileSync(lock,'CONCURRENT_INSTALLER_MUST_NOT_BE_REMOVED',{flag:'wx',mode:0o600});
  assert.throws(()=>managePortablePackage({qaRoot:home,action:'upgrade'}),/PORTABLE3_MUTATION_LOCK_OCCUPIED/);
  assert.deepEqual(unpack(target(home)),old);
  assert.equal(fs.readFileSync(lock,'utf8'),'CONCURRENT_INSTALLER_MUST_NOT_BE_REMOVED');
  fs.unlinkSync(lock);
  const other=path.join(state,'no-such-destination');
  fs.symlinkSync(other,backup(home),'dir');
  assert.throws(()=>managePortablePackage({qaRoot:home,action:'upgrade'}),/PORTABLE3_ROLLBACK_SLOT_OCCUPIED/);
  assert.throws(()=>managePortablePackage({qaRoot:home,action:'status'}),/PORTABLE3_SYMLINK_DENIED/);
  assert.deepEqual(unpack(target(home)),old);
  assert.equal(fs.lstatSync(backup(home)).isSymbolicLink(),true);
  assert.equal(fs.existsSync(lock),false);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('unreviewed production CLI refuses mutation and exposes only status',{skip:process.platform!=='linux'},()=>{
 const cli=path.join(root,'tools','portable-capability-gap-package.mjs');
 const r=spawnSync(process.execPath,[cli,'--upgrade'],{encoding:'utf8',timeout:5000});
 assert.equal(r.status,2);
 assert.match(r.stderr,/PORTABLE3_REVIEW_ONLY_CLI/);
});
