import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {managePortablePackage,recoverInterruptedUpgradeQA,inspectInterruptedRecoveryQA,resumeInterruptedRecoveryQA} from '../tools/portable-capability-gap-package.mjs';

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
test('imported package API rejects every mutation without an explicit QA root',{skip:process.platform!=='linux'},()=>{
 const home=qa();
 try{
  const parent=path.join(home,'.local','state','chatgpt-remote-commander');
  fs.mkdirSync(parent,{recursive:true,mode:0o700});
  const pkg=path.join(root,'tools','portable-capability-gap-package.mjs');
  const source='import assert from "node:assert/strict";import os from "node:os";'+
   'import {pathToFileURL} from "node:url";'+
   'assert.equal(os.homedir(),process.env.HOME);'+
   'const m=await import(pathToFileURL(process.argv[2]).href);'+
   'for(const action of ["install","upgrade","rollback"])'+
   'assert.throws(()=>m.managePortablePackage({action}),/PORTABLE3_MUTATION_QA_ONLY/);';
  const r=spawnSync(process.execPath,['--input-type=module','-e',source,'qa-api-probe',pkg],
   {env:{...process.env,HOME:home},encoding:'utf8',timeout:7000});
  assert.equal(r.status,0,r.stderr);
  assert.deepEqual(fs.readdirSync(parent),[]);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
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

function hardCrashAfterOldRename(home){
 const pkg=path.join(root,'tools','portable-capability-gap-package.mjs');
 const source='import {pathToFileURL} from "node:url";'+
   'const m=await import(pathToFileURL(process.argv[1]).href);'+
   'm.managePortablePackage({qaRoot:process.argv[2],action:"upgrade",'+
   'hook:()=>process.exit(73)});';
 const child=spawnSync(process.execPath,['--input-type=module','-e',source,pkg,home],
   {encoding:'utf8',timeout:7000,stdio:['ignore','pipe','pipe']});
 assert.equal(child.status,73,'SYNTHETIC_CRASH_FAILED');
 assert.equal(fs.existsSync(target(home)),false);
 assert.equal(fs.existsSync(backup(home)),true);
 return path.join(home,'state','.capgap-portable-package.lock');
}
test('explicit QA-only crash recovery restores original two files and retains staged three files',{skip:process.platform!=='linux'},()=>{
 const home=qa();
 try{
  const old=seed(home);
  const stale=hardCrashAfterOldRename(home);
  const before=managePortablePackage({qaRoot:home,action:'status'});
  assert.equal(before.state,'interrupted-upgrade');
  assert.equal(before.manualRecoveryRequired,true);
  assert.equal(fs.existsSync(stale),true);
  const res=recoverInterruptedUpgradeQA({qaRoot:home});
  assert.equal(res.oldBytesRecovered,true);
  assert.equal(res.stagedNewRetained,true);
  assert.deepEqual(unpack(target(home)),old);
  assert.deepEqual(unpack(recovery(home)),expected);
  assert.equal(fs.existsSync(stale),false);
  assert.equal(fs.existsSync(path.join(home,'state','.capgap-portable-recovery.lock')),false);
  assert.equal(managePortablePackage({qaRoot:home,action:'status'}).manualRecoveryRequired,false);
  assert.throws(()=>recoverInterruptedUpgradeQA({qaRoot:home}),/PORTABLE3_RECOVERY_TOPOLOGY_INVALID/);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('crash recovery refuses active/wrong owner lock and does not erase old or staged history',{skip:process.platform!=='linux'},()=>{
 const home=qa();
 try{
  const old=seed(home,{adjuncts:true});
  const lock=hardCrashAfterOldRename(home),stalePid=fs.readFileSync(lock,'utf8');
  const stage=fs.readdirSync(path.join(home,'state')).filter(n=>n.startsWith('.capgap-portable-stage-'));
  assert.equal(stage.length,1);
  fs.writeFileSync(lock,String(process.pid)+'\n',{mode:0o600});
  assert.throws(()=>recoverInterruptedUpgradeQA({qaRoot:home}),/PORTABLE3_RECOVERY_ORIGINAL_PROCESS_ACTIVE/);
  assert.deepEqual(unpack(backup(home)),old);
  assert.equal(fs.existsSync(target(home)),false);
  assert.equal(fs.existsSync(path.join(home,'state','.capgap-portable-recovery.lock')),false);
  fs.writeFileSync(lock,stalePid,{mode:0o600});
  const badStage=path.join(home,'state',stage[0],'owner-private-storage.mjs');
  fs.appendFileSync(badStage,'UNAUTHORIZED_MUTATION');
  assert.throws(()=>recoverInterruptedUpgradeQA({qaRoot:home}),/PORTABLE3_FILE_HASH_CONFLICT/);
  assert.deepEqual(unpack(backup(home)),old);
  assert.equal(fs.existsSync(target(home)),false);
  fs.copyFileSync(path.join(root,'src','owner-private-storage.mjs'),badStage);
  const r=recoverInterruptedUpgradeQA({qaRoot:home});
  assert.equal(r.oldBytesRecovered,true);
  assert.deepEqual(unpack(target(home)),old);
  assert.equal(fs.existsSync(lock),false);
  assert.deepEqual(Object.keys(unpack(recovery(home))).sort(),
    Object.keys({...expected,...Object.fromEntries(Object.entries(extras).map(([k,v])=>[k,v.sha]))}).sort());
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('recovery refuses ambiguous stage and forged stale PID before changing any file',{skip:process.platform!=='linux'},()=>{
 const home=qa(),state=path.join(home,'state');
 try{
  const prior=seed(home),lock=hardCrashAfterOldRename(home);
  assert.throws(()=>recoverInterruptedUpgradeQA({}),/PORTABLE3_RECOVERY_QA_ONLY/);
  const fake=fs.mkdtempSync(path.join(state,'.capgap-portable-stage-'));
  assert.throws(()=>recoverInterruptedUpgradeQA({qaRoot:home}),/PORTABLE3_RECOVERY_STAGE_AMBIGUOUS/);
  assert.deepEqual(unpack(backup(home)),prior);
  assert.equal(fs.existsSync(target(home)),false);
  fs.rmdirSync(fake);
  const bytes=fs.readFileSync(lock);
  fs.writeFileSync(lock,'0\n');
  assert.throws(()=>recoverInterruptedUpgradeQA({qaRoot:home}),/PORTABLE3_RECOVERY_LOCK_UNREADABLE/);
  assert.deepEqual(unpack(backup(home)),prior);
  fs.writeFileSync(lock,bytes);
  const result=recoverInterruptedUpgradeQA({qaRoot:home});
  assert.equal(result.oldBytesRecovered,true);
  assert.deepEqual(unpack(target(home)),prior);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
function hardCrashDuringRecovery(home,phase){
 const pkg=path.join(root,'tools','portable-capability-gap-package.mjs');
 const source='import fs from "node:fs";import path from "node:path";'+
   'import {pathToFileURL} from "node:url";'+
   'const m=await import(pathToFileURL(process.argv[2]).href);'+
   'const home=process.argv[3],phase=process.argv[4];'+
   'const rename=fs.renameSync,unlink=fs.unlinkSync;'+
   'fs.renameSync=(a,b)=>{if(phase==="intent-recorded"&&path.basename(a)===".capgap-portable-rollback-v1")process.exit(74);rename(a,b);'+
   'if(phase==="restored-old"&&path.basename(a)===".capgap-portable-rollback-v1")process.exit(74);'+
   'if(phase==="retained-new"&&path.basename(b)===".capgap-portable-recovery-new")process.exit(74);};'+
   'fs.unlinkSync=p=>{unlink(p);if(phase==="removed-original-lock"&&path.basename(p)===".capgap-portable-package.lock")process.exit(74);};'+
   'm.recoverInterruptedUpgradeQA({qaRoot:home});';
 const child=spawnSync(process.execPath,['--input-type=module','-e',source,'qa-recovery-crash',pkg,home,phase],
   {encoding:'utf8',timeout:7000,stdio:['ignore','pipe','pipe']});
 assert.equal(child.status,74,child.stderr);
}
for(const phase of ['restored-old','retained-new','removed-original-lock']){
 test('recovery interruption '+phase+' preserves both packages and blocks mutation',{skip:process.platform!=='linux'},()=>{
  const home=qa(),state=path.join(home,'state');
  try{
   const old=seed(home,{adjuncts:true});
   hardCrashAfterOldRename(home);
   hardCrashDuringRecovery(home,phase);
   const claim=path.join(state,'.capgap-portable-recovery.lock');
   const original=path.join(state,'.capgap-portable-package.lock');
   assert.equal(fs.existsSync(claim),true);
   assert.deepEqual(unpack(target(home)),old);
   assert.equal(fs.existsSync(backup(home)),false);
   const stages=fs.readdirSync(state).filter(n=>n.startsWith('.capgap-portable-stage-'));
   assert.equal(stages.length,phase==='restored-old'?1:0);
   const retained=phase==='restored-old'?path.join(state,stages[0]):recovery(home);
   const next={...expected,...Object.fromEntries(Object.entries(extras).map(([k,v])=>[k,v.sha]))};
   assert.deepEqual(unpack(retained),next);
   assert.equal(fs.existsSync(original),phase!=='removed-original-lock');
   const snapshot=()=>Object.fromEntries(fs.readdirSync(state).sort().map(n=>{
    const p=path.join(state,n);return [n,fs.lstatSync(p).isDirectory()?unpack(p):hash(fs.readFileSync(p))];
   }));
   const before=snapshot();
   const phaseExpected={'restored-old':'old-restored','retained-new':'new-retained','removed-original-lock':'original-lock-retired'}[phase];
   assert.deepEqual(inspectInterruptedRecoveryQA({qaRoot:home}),{phase:phaseExpected,manualRecoveryRequired:true,changed:false});
   const status=managePortablePackage({qaRoot:home});
   assert.equal(status.state,'recovery-claim-present');
   assert.equal(status.manualRecoveryRequired,true);
   assert.equal(status.changed,false);
   for(const action of ['install','upgrade','rollback'])
    assert.throws(()=>managePortablePackage({qaRoot:home,action}),/PORTABLE3_RECOVERY_CONCURRENT/);
   assert.throws(()=>recoverInterruptedUpgradeQA({qaRoot:home}),/PORTABLE3_RECOVERY_CONCURRENT/);
   assert.deepEqual(snapshot(),before);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
 });
}
test('recovery intent is present before first rename and rejects tampering without mutation',{skip:process.platform!=='linux'},()=>{
 const home=qa(),state=path.join(home,'state');
 try{
  const old=seed(home,{adjuncts:true});
  const original=hardCrashAfterOldRename(home);
  hardCrashDuringRecovery(home,'intent-recorded');
  const claim=path.join(state,'.capgap-portable-recovery.lock');
  const bytes=fs.readFileSync(claim,'utf8');
  assert.deepEqual(inspectInterruptedRecoveryQA({qaRoot:home}),{phase:'intent-recorded',manualRecoveryRequired:true,changed:false});
  assert.equal(fs.existsSync(target(home)),false);
  assert.deepEqual(unpack(backup(home)),old);
  const lines=bytes.split('\n'),j=JSON.parse(lines[1]);
  j.stage='../outside';
  fs.writeFileSync(claim,lines[0]+'\n'+JSON.stringify(j)+'\n');
  assert.throws(()=>inspectInterruptedRecoveryQA({qaRoot:home}),/PORTABLE3_RECOVERY_JOURNAL_INVALID/);
  fs.writeFileSync(claim,bytes);
  const oldLock=fs.readFileSync(original,'utf8');
  fs.writeFileSync(original,'1\n');
  assert.throws(()=>inspectInterruptedRecoveryQA({qaRoot:home}),/PORTABLE3_RECOVERY_JOURNAL_LOCK_DRIFT/);
  fs.writeFileSync(original,oldLock);
  assert.equal(inspectInterruptedRecoveryQA({qaRoot:home}).phase,'intent-recorded');
  assert.equal(fs.existsSync(target(home)),false);
  assert.deepEqual(unpack(backup(home)),old);
  assert.equal(fs.readFileSync(claim,'utf8'),bytes);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
for(const phase of ['restored-old','retained-new']){
 test('recovery I/O exception '+phase+' retains claim and both packages',{skip:process.platform!=='linux'},()=>{
  const home=qa(),state=path.join(home,'state');
  try{
   const old=seed(home,{adjuncts:true});
   hardCrashAfterOldRename(home);
   const pkg=path.join(root,'tools','portable-capability-gap-package.mjs');
   const source='import fs from "node:fs";import path from "node:path";'+
    'import assert from "node:assert/strict";import {pathToFileURL} from "node:url";'+
    'const m=await import(pathToFileURL(process.argv[2]).href);'+
    'const rename=fs.renameSync,phase=process.argv[4];let injected=false;'+
    'fs.renameSync=(a,b)=>{rename(a,b);if((phase==="restored-old"&&path.basename(a)===".capgap-portable-rollback-v1")||'+
    '(phase==="retained-new"&&path.basename(b)===".capgap-portable-recovery-new")){injected=true;throw Object.assign(Error("SYNTHETIC_IO_ERROR"),{code:"EIO"});}};'+
    'assert.throws(()=>m.recoverInterruptedUpgradeQA({qaRoot:process.argv[3]}),/SYNTHETIC_IO_ERROR/);assert.equal(injected,true);';
   const child=spawnSync(process.execPath,['--input-type=module','-e',source,'qa-recovery-io',pkg,home,phase],
    {encoding:'utf8',timeout:7000,stdio:['ignore','pipe','pipe']});
   assert.equal(child.status,0,child.stderr);
   assert.deepEqual(unpack(target(home)),old);
   const stages=fs.readdirSync(state).filter(n=>n.startsWith('.capgap-portable-stage-'));
   const retained=phase==='restored-old'?path.join(state,stages[0]):recovery(home);
   const next={...expected,...Object.fromEntries(Object.entries(extras).map(([k,v])=>[k,v.sha]))};
   assert.deepEqual(unpack(retained),next);
   assert.equal(fs.existsSync(path.join(state,'.capgap-portable-recovery.lock')),true);
   assert.equal(managePortablePackage({qaRoot:home}).state,'recovery-claim-present');
   assert.throws(()=>recoverInterruptedUpgradeQA({qaRoot:home}),/PORTABLE3_RECOVERY_CONCURRENT/);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
 });
}
for(const phase of ['intent-recorded','restored-old','retained-new','removed-original-lock']){
 test('QA resume '+phase+' preserves exact old/new bytes',{skip:process.platform!=='linux'},()=>{
  const home=qa(),state=path.join(home,'state');
  try{
   const old=seed(home,{adjuncts:true});
   hardCrashAfterOldRename(home);hardCrashDuringRecovery(home,phase);
   const expectedNew={...expected,...Object.fromEntries(Object.entries(extras).map(([k,v])=>[k,v.sha]))};
   const result=resumeInterruptedRecoveryQA({qaRoot:home});
   assert.equal(result.changed,true);
   assert.deepEqual(unpack(target(home)),old);
   assert.deepEqual(unpack(recovery(home)),expectedNew);
   for(const name of ['.capgap-portable-package.lock','.capgap-portable-recovery.lock','.capgap-portable-resume.lock'])
    assert.equal(fs.existsSync(path.join(state,name)),false);
   assert.equal(managePortablePackage({qaRoot:home}).manualRecoveryRequired,false);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
 });
}
test('QA resume denies live journal owner and never reclaims unknown guard',
 {skip:process.platform!=='linux'},()=>{
 const home=qa(),state=path.join(home,'state');
 try{
  const old=seed(home);hardCrashAfterOldRename(home);
  hardCrashDuringRecovery(home,'intent-recorded');
  const claim=path.join(state,'.capgap-portable-recovery.lock');
  const orig=fs.readFileSync(claim,'utf8'),lines=orig.split('\n');
  const journal=JSON.parse(lines[1]);journal.claimPid=process.pid;
  fs.writeFileSync(claim,String(process.pid)+'\n'+JSON.stringify(journal)+'\n');
  assert.throws(()=>resumeInterruptedRecoveryQA({qaRoot:home}),/PORTABLE3_RECOVERY_RESUME_OWNER_ACTIVE/);
  assert.deepEqual(unpack(backup(home)),old);
  assert.equal(fs.existsSync(path.join(state,'.capgap-portable-resume.lock')),false);
  fs.writeFileSync(claim,orig);
  const guard=path.join(state,'.capgap-portable-resume.lock');
  fs.writeFileSync(guard,'UNKNOWN OWNER\n',{flag:'wx',mode:0o600});
  assert.throws(()=>resumeInterruptedRecoveryQA({qaRoot:home}),/PORTABLE3_RECOVERY_RESUME_CONCURRENT/);
  assert.equal(fs.readFileSync(guard,'utf8'),'UNKNOWN OWNER\n');
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('QA resume process exit leaves guard and both packages intact',
 {skip:process.platform!=='linux'},()=>{
 const home=qa(),state=path.join(home,'state');
 try{
  const old=seed(home,{adjuncts:true});
  hardCrashAfterOldRename(home);hardCrashDuringRecovery(home,'intent-recorded');
  const pkg=path.join(root,'tools','portable-capability-gap-package.mjs');
  const source='import fs from "node:fs";import path from "node:path";'+
   'import {pathToFileURL} from "node:url";'+
   'const rename=fs.renameSync;fs.renameSync=(a,b)=>{rename(a,b);'+
   'if(path.basename(a)===".capgap-portable-rollback-v1")process.exit(78);};'+
   'const m=await import(pathToFileURL(process.argv[2]).href);'+
   'm.resumeInterruptedRecoveryQA({qaRoot:process.argv[3]});';
  const child=spawnSync(process.execPath,['--input-type=module','-e',source,'qa-resume-crash',pkg,home],
   {encoding:'utf8',timeout:7000,stdio:['ignore','pipe','pipe']});
  assert.equal(child.status,78,child.stderr);
  assert.deepEqual(unpack(target(home)),old);
  assert.equal(fs.existsSync(path.join(state,'.capgap-portable-resume.lock')),true);
  assert.equal(fs.existsSync(path.join(state,'.capgap-portable-recovery.lock')),true);
  assert.throws(()=>resumeInterruptedRecoveryQA({qaRoot:home}),/PORTABLE3_RECOVERY_RESUME_CONCURRENT/);
  const stages=fs.readdirSync(state).filter(n=>n.startsWith('.capgap-portable-stage-'));
  assert.equal(stages.length,1);
  assert.deepEqual(unpack(path.join(state,stages[0])),
   {...expected,...Object.fromEntries(Object.entries(extras).map(([k,v])=>[k,v.sha]))});
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('QA resume exit after claim retirement keeps every mutation entry fail-closed',
 {skip:process.platform!=='linux'},()=>{
 const home=qa(),state=path.join(home,'state');
 try{
  const old=seed(home,{adjuncts:true});
  hardCrashAfterOldRename(home);hardCrashDuringRecovery(home,'removed-original-lock');
  const pkg=path.join(root,'tools','portable-capability-gap-package.mjs');
  const source='import fs from "node:fs";import path from "node:path";'+
   'import {pathToFileURL} from "node:url";'+
   'const m=await import(pathToFileURL(process.argv[2]).href);'+
   'const unlink=fs.unlinkSync;fs.unlinkSync=p=>{unlink(p);'+
   'if(path.basename(p)===".capgap-portable-recovery.lock")process.exit(79);};'+
   'm.resumeInterruptedRecoveryQA({qaRoot:process.argv[3]});';
  const child=spawnSync(process.execPath,['--input-type=module','-e',source,'qa-resume-final-crash',pkg,home],
   {encoding:'utf8',timeout:7000,stdio:['ignore','pipe','pipe']});
  assert.equal(child.status,79,child.stderr);
  const guard=path.join(state,'.capgap-portable-resume.lock');
  assert.equal(fs.existsSync(guard),true);
  assert.equal(fs.existsSync(path.join(state,'.capgap-portable-recovery.lock')),false);
  assert.equal(fs.existsSync(path.join(state,'.capgap-portable-package.lock')),false);
  assert.deepEqual(unpack(target(home)),old);
  assert.deepEqual(unpack(recovery(home)),
   {...expected,...Object.fromEntries(Object.entries(extras).map(([k,v])=>[k,v.sha]))});
  const snapshot=()=>Object.fromEntries(fs.readdirSync(state).sort().map(n=>{
   const p=path.join(state,n);return [n,fs.lstatSync(p).isDirectory()?unpack(p):hash(fs.readFileSync(p))];
  }));
  const before=snapshot();
  const status=managePortablePackage({qaRoot:home});
  assert.equal(status.state,'resume-guard-present');
  assert.equal(status.manualRecoveryRequired,true);
  for(const action of ['install','upgrade','rollback'])
   assert.throws(()=>managePortablePackage({qaRoot:home,action}),/PORTABLE3_RECOVERY_RESUME_CONCURRENT/);
  assert.throws(()=>recoverInterruptedUpgradeQA({qaRoot:home}),/PORTABLE3_RECOVERY_RESUME_CONCURRENT/);
  assert.throws(()=>resumeInterruptedRecoveryQA({qaRoot:home}),/PORTABLE3_RECOVERY_RESUME_CONCURRENT/);
  assert.deepEqual(snapshot(),before);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
// Synthetic process exits at ordinary install/rollback rename boundaries.
function hardCrashDuringMutation(home,action,destination){
 const pkg=path.join(root,'tools','portable-capability-gap-package.mjs');
 const source='import fs from "node:fs";import path from "node:path";'+
  'import {pathToFileURL} from "node:url";'+
  'const m=await import(pathToFileURL(process.argv[2]).href);'+
  'const rename=fs.renameSync;fs.renameSync=(a,b)=>{rename(a,b);'+
  'if(path.basename(b)===process.argv[5])process.exit(75);};'+
  'm.managePortablePackage({qaRoot:process.argv[3],action:process.argv[4]});';
 const child=spawnSync(process.execPath,['--input-type=module','-e',source,'qa-mutation-crash',pkg,home,action,destination],
  {encoding:'utf8',timeout:7000,stdio:['ignore','pipe','pipe']});
 assert.equal(child.status,75,child.stderr);
}
for(const [action,destination,stateName] of [
 ['upgrade','gap-client','mutation-lock-present'],
 ['rollback','.capgap-portable-recovery-new','interrupted-rollback'],
 ['rollback','gap-client','mutation-lock-present']
]){
 test('ordinary mutation interruption '+action+' '+destination+' reports unresolved lock without changing bytes',
  {skip:process.platform!=='linux'},()=>{
   const home=qa(),state=path.join(home,'state');
   try{
    const old=seed(home,{adjuncts:true});
    const next={...expected,...Object.fromEntries(Object.entries(extras).map(([k,v])=>[k,v.sha]))};
    if(action==='rollback')managePortablePackage({qaRoot:home,action:'upgrade'});
    hardCrashDuringMutation(home,action,destination);
    const lock=path.join(state,'.capgap-portable-package.lock');
    assert.equal(fs.existsSync(lock),true);
    if(action==='upgrade'){
     assert.deepEqual(unpack(target(home)),next);
     assert.deepEqual(unpack(backup(home)),old);
    }else if(destination==='.capgap-portable-recovery-new'){
     assert.equal(fs.existsSync(target(home)),false);
     assert.deepEqual(unpack(backup(home)),old);
     assert.deepEqual(unpack(recovery(home)),next);
    }else{
     assert.deepEqual(unpack(target(home)),old);
     assert.deepEqual(unpack(recovery(home)),next);
    }
    const snapshot=()=>Object.fromEntries(fs.readdirSync(state).sort().map(n=>{
     const p=path.join(state,n);return [n,fs.lstatSync(p).isDirectory()?unpack(p):hash(fs.readFileSync(p))];
    }));
    const before=snapshot(),status=managePortablePackage({qaRoot:home});
    assert.equal(status.state,stateName);
    assert.equal(status.manualRecoveryRequired,true);
    assert.equal(status.changed,false);
    assert.throws(()=>managePortablePackage({qaRoot:home,action:'upgrade'}),/PORTABLE3_MUTATION_LOCK_OCCUPIED/);
    assert.deepEqual(snapshot(),before);
   }finally{fs.rmSync(home,{recursive:true,force:true});}
  });
}
test('unreviewed production CLI refuses mutation and exposes only status',{skip:process.platform!=='linux'},()=>{
 const cli=path.join(root,'tools','portable-capability-gap-package.mjs');
 const r=spawnSync(process.execPath,[cli,'--upgrade'],{encoding:'utf8',timeout:5000});
 assert.equal(r.status,2);
 assert.match(r.stderr,/PORTABLE3_REVIEW_ONLY_CLI/);
});
