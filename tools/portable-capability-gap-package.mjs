// Three-file Capability Gap portable package: conservative owner-local QA
// installer/rollback candidate. Product installer activation is not authorized
// by source tests; this CLI intentionally supports --status only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const sourceRoot=path.resolve(here,'..');
const hash=b=>createHash('sha256').update(b).digest('hex');
const CURRENT=Object.freeze({
 'portable-capability-gap-cli.mjs':{source:'tools/portable-capability-gap-cli.mjs',sha:'8b047e5f7505b555346da562d1d7312c533f6bd43c0ce3062566bc4261e69bfe'},
 'capability-gap-registry.mjs':{source:'src/capability-gap-registry.mjs',sha:'14ef40c424eb5429db550e563ad12b9c79d79c7f35ace0d7e4d1ff728fde59cb'},
 'owner-private-storage.mjs':{source:'src/owner-private-storage.mjs',sha:'c37ae0c79f11e15dd31adbdac1bed793891ed647135dc36921511dce0ab5ddaa'}
});
const LEGACY=Object.freeze({
 'portable-capability-gap-cli.mjs':'8b047e5f7505b555346da562d1d7312c533f6bd43c0ce3062566bc4261e69bfe',
 'capability-gap-registry.mjs':'23f0f7a18133b506fe7273920d91841b8fcbae7317e4b19e0684240b48a33683'
});
// Observed on Emad PC Lite, two adjunct QA scripts must never be deleted
// or re-authored by the portable upgrade.
const KEEP=Object.freeze({
 'v1-dev23-capgap-native-qa.mjs':'9d01f14f6c2f1d1be32bd11304c07a6f8db5d68e522271167f773da2d8eb2bd1',
 'v1-dev23-capgap-stage.mjs':'0cee9cdf96bf2e04ae5b85a81457b6bb23b9dbc2eac9ae05416c4ca708d70bff'
});
const names=Object.keys(CURRENT),oldNames=Object.keys(LEGACY);
const fail=x=>{throw Object.assign(Error('PORTABLE3_'+x),{code:'PORTABLE3_'+x});};
function existsNoFollow(p){
 try{fs.lstatSync(p);return true;}
 catch(e){if(e.code==='ENOENT')return false;throw e;}
}
// Owner-private parent, exclusive O_NOFOLLOW lock; never break stale locks.
function mutationLock(parent,callback){
 const lock=path.join(parent,'.capgap-portable-package.lock');
 if(existsNoFollow(lock))fail('MUTATION_LOCK_OCCUPIED');
 let fd,owned;
 try{
  fd=fs.openSync(lock,fs.constants.O_CREAT|fs.constants.O_EXCL|
    fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  owned=fs.fstatSync(fd);
  fs.writeFileSync(fd,String(process.pid)+'\n');
  fs.fsyncSync(fd);
 }catch(e){
  if(owned&&existsNoFollow(lock)&&fs.lstatSync(lock).ino===owned.ino)fs.unlinkSync(lock);
  fail('MUTATION_LOCK_DENIED');
 }finally{if(fd!==undefined)fs.closeSync(fd);}
 try{return callback();}
 finally{
  const now=fs.lstatSync(lock);
  if(!now.isFile()||now.isSymbolicLink()||now.ino!==owned.ino||
    now.uid!==process.getuid()||now.nlink!==1)fail('MUTATION_LOCK_INTEGRITY_CHANGED');
  fs.unlinkSync(lock);
 }
}
function noAlias(p){
 let part=path.parse(path.resolve(p)).root;
 for(const component of path.resolve(p).slice(part.length).split(path.sep).filter(Boolean)){
  part=path.join(part,component);
  if(existsNoFollow(part)&&fs.lstatSync(part).isSymbolicLink())fail('SYMLINK_DENIED');
 }
}
function directory(p,strict=true){
 const st=fs.lstatSync(p);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid())fail('DIRECTORY_UNSAFE');
 if(strict&&(st.mode&0o077)!==0)fail('DIRECTORY_NOT_PRIVATE');
}
function checked(file,expected){
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||
    st.uid!==process.getuid()||st.size<1||st.size>1024*1024)fail('FILE_UNSAFE');
 const b=fs.readFileSync(file);
 if(hash(b)!==expected)fail('FILE_HASH_CONFLICT');
 return b;
}
function inspect(target,expected){
 if(!existsNoFollow(target))return null;
 noAlias(target);directory(target);
 const contents=fs.readdirSync(target).sort();
 const required=Object.keys(expected);
 if(required.some(n=>!contents.includes(n))||
    contents.some(n=>!required.includes(n)&&!Object.hasOwn(KEEP,n))||
    contents.length>required.length+2)fail('UNRECOGNIZED_INSTALLATION');
 for(const n of contents)checked(path.join(target,n),expected[n]?.sha??expected[n]??KEEP[n]);
 return {version:expected===CURRENT?'three-file':'legacy-two-file',
   adjuncts:contents.filter(n=>Object.hasOwn(KEEP,n))};
}
function classify(target){
 if(!existsNoFollow(target))return {version:'absent',adjuncts:[]};
 try{return inspect(target,CURRENT);}
 catch(e){if(e.code==='PORTABLE3_SYMLINK_DENIED'||e.code==='PORTABLE3_DIRECTORY_UNSAFE'||e.code==='PORTABLE3_DIRECTORY_NOT_PRIVATE')throw e;}
 try{return inspect(target,LEGACY);}
 catch{fail('UNRECOGNIZED_INSTALLATION');}
}
function writeNew(file,bytes){
 const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}
 finally{fs.closeSync(fd);}
}
function syncDir(p){const fd=fs.openSync(p,fs.constants.O_RDONLY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function sources(){
 const b={};
 for(const [name,o] of Object.entries(CURRENT)){
  const p=path.join(sourceRoot,o.source);
  noAlias(p);
  const st=fs.lstatSync(p);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>1024*1024)fail('SOURCE_UNSAFE');
  const data=fs.readFileSync(p);
  if(hash(data)!==o.sha)fail('SOURCE_DRIFT');
  b[name]=data;
 }
 return b;
}
function context(qaRoot){
 if(process.platform!=='linux'||typeof process.getuid!=='function')fail('LINUX_VALIDATION_ONLY');
 let target,parent;
 if(qaRoot!==undefined){
  if(typeof qaRoot!=='string'||!path.isAbsolute(qaRoot))fail('QA_SCOPE_INVALID');
  const real=fs.realpathSync(qaRoot);
  if(real!==path.resolve(qaRoot)||path.dirname(real)!==fs.realpathSync(os.tmpdir())||
     !path.basename(real).startsWith('capgap-portable-qa-'))fail('QA_SCOPE_INVALID');
  directory(real);parent=path.join(real,'state');target=path.join(parent,'gap-client');
 }else{
  parent=path.join(os.homedir(),'.local','state','chatgpt-remote-commander');
  target=path.join(parent,'gap-client');
 }
 noAlias(parent);directory(parent);
 return {target,parent,backup:path.join(parent,'.capgap-portable-rollback-v1'),
   recovery:path.join(parent,'.capgap-portable-recovery-new')};
}
/**
 * QA-only guarded evaluation. Never performs account/host promotion.
 * Production CLI refuses mutation until this source is reviewed and released.
 */
export function managePortablePackage({action='status',qaRoot,hook}={}){
 if(!['status','install','upgrade','rollback'].includes(action))fail('ACTION_INVALID');
 if(action!=='status'&&qaRoot===undefined)fail('MUTATION_QA_ONLY');
 const {target,parent,backup,recovery}=context(qaRoot);
 const recoveryClaim=path.join(parent,'.capgap-portable-recovery.lock');
 // A claim can outlive its recovery process. Do not infer a completed
 // recovery from the restored legacy target or the absent original lock.
 // Claim ownership/retirement requires separate explicit adjudication.
 if(action!=='status'&&existsNoFollow(recoveryClaim))fail('RECOVERY_CONCURRENT');
 const initial=classify(target);
 if(action==='status'){
   if(existsNoFollow(backup))inspect(backup,LEGACY);
   const claimed=existsNoFollow(recoveryClaim);
   const locked=existsNoFollow(path.join(parent,'.capgap-portable-package.lock'));
   const interrupted=locked&&initial.version==='absent'&&existsNoFollow(backup);
   // Presence of a lock is not evidence that its owner is dead. Expose
   // unresolved mutation state without deleting, retiring or trusting a lock.
   const state=claimed?'recovery-claim-present':
     interrupted?(existsNoFollow(recovery)?'interrupted-rollback':'interrupted-upgrade'):
     locked?'mutation-lock-present':initial.version;
   return {state,adjuncts:initial.adjuncts,rollbackReady:existsNoFollow(backup),
     manualRecoveryRequired:claimed||locked,changed:false};
 }
 return mutationLock(parent,()=>{
 // Recheck under the original exclusive mutation lock. Recovery itself
 // checks that this lock's owner is not alive before moving any package.
 if(existsNoFollow(recoveryClaim))fail('RECOVERY_CONCURRENT');
 if(action==='rollback'){
  if(initial.version!=='three-file'||!existsNoFollow(backup)||existsNoFollow(recovery))
   fail('ROLLBACK_PRECONDITION');
  const prior=inspect(backup,LEGACY);
  if(prior.adjuncts.join(',')!==initial.adjuncts.join(','))fail('ROLLBACK_ADJUNCT_DRIFT');
  fs.renameSync(target,recovery);
  try{
   fs.renameSync(backup,target);
   const restored=inspect(target,LEGACY);
   syncDir(parent);
   return {state:'legacy-two-file',adjuncts:restored.adjuncts,changed:true,
     recoveredThreeFile:true};
  }catch(e){
   if(!existsNoFollow(target)&&existsNoFollow(recovery))fs.renameSync(recovery,target);
   throw e;
  }
 }
 if(initial.version==='three-file')return {state:'three-file',changed:false};
 if(action==='upgrade'&&initial.version!=='legacy-two-file')fail('EXACT_LEGACY_REQUIRED');
 if(action==='install'&&initial.version!=='absent')fail('EXPLICIT_UPGRADE_REQUIRED');
 if(existsNoFollow(backup)||existsNoFollow(recovery))fail('ROLLBACK_SLOT_OCCUPIED');
 const source=sources();
 const stage=fs.mkdtempSync(path.join(parent,'.capgap-portable-stage-'));
 fs.chmodSync(stage,0o700);
 let consumed=false,movedOld=false;
 try{
  for(const name of names)writeNew(path.join(stage,name),source[name]);
  for(const n of initial.adjuncts)writeNew(path.join(stage,n),checked(path.join(target,n),KEEP[n]));
  inspect(stage,CURRENT);
  syncDir(stage);
  if(initial.version==='legacy-two-file'){
   if(classify(target).version!=='legacy-two-file')fail('CONCURRENT_SOURCE_DRIFT');
   fs.renameSync(target,backup);movedOld=true;
   if(hook)hook('old-renamed');
  }else if(existsNoFollow(target))fail('DESTINATION_RACE');
  fs.renameSync(stage,target);consumed=true;
  const done=inspect(target,CURRENT);
  if(done.adjuncts.join(',')!==initial.adjuncts.join(','))fail('ADJUNCT_DRIFT');
  syncDir(parent);
  return {state:'three-file',adjuncts:done.adjuncts,
    rollbackReady:movedOld,changed:true};
 }catch(e){
  if(movedOld){
   if(!existsNoFollow(target)&&existsNoFollow(backup)){
    fs.renameSync(backup,target);
   }else if(existsNoFollow(target)&&existsNoFollow(backup)){
    // Fail-closed: never remove an unexpected active target to force rollback.
    fail('POST_PROMOTION_MANUAL_RECOVERY_REQUIRED');
   }
  }
  throw e;
 }finally{
  if(!consumed&&existsNoFollow(stage)){
   const st=fs.lstatSync(stage);
   if(st.isDirectory()&&!st.isSymbolicLink()&&path.dirname(stage)===parent)
    fs.rmSync(stage,{recursive:true,force:true});
  }
 }
 });
}

/**
 * Synthetic recovery proof ONLY. Deliberately requires a fresh, recognized
 * owner-private QA root: cannot recover or unlock a live user's installation.
 * Recovery is never exposed by the production status-only CLI.
 *
 * Exact accepted interrupted upgrade: old target absent, one exact trusted old
 * backup, one exact trusted staged new package and a private lock left by a
 * confirmed non-running PID. Preserve the new stage as a separate recovery
 * directory. Never delete/rewrite arbitrary unknown files or active locks.
 */
export function recoverInterruptedUpgradeQA({qaRoot}={}){
 if(qaRoot===undefined)fail('RECOVERY_QA_ONLY');
 const {target,parent,backup,recovery}=context(qaRoot);
 const lock=path.join(parent,'.capgap-portable-package.lock');
 const claim=path.join(parent,'.capgap-portable-recovery.lock');
 if(existsNoFollow(claim))fail('RECOVERY_CONCURRENT');
 let claimFd,claimStat;
 try{
  claimFd=fs.openSync(claim,fs.constants.O_CREAT|fs.constants.O_EXCL|
    fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  claimStat=fs.fstatSync(claimFd);
  fs.writeFileSync(claimFd,String(process.pid)+'\n');
  fs.fsyncSync(claimFd);
 }catch{
  fail('RECOVERY_CLAIM_DENIED');
 }finally{if(claimFd!==undefined)fs.closeSync(claimFd);}
 try{
  if(existsNoFollow(target)||!existsNoFollow(backup)||!existsNoFollow(lock)||
     existsNoFollow(recovery))fail('RECOVERY_TOPOLOGY_INVALID');
  const stages=fs.readdirSync(parent).filter(n=>n.startsWith('.capgap-portable-stage-'));
  if(stages.length!==1||!/^[.]capgap-portable-stage-[A-Za-z0-9]{6}$/.test(stages[0]))
   fail('RECOVERY_STAGE_AMBIGUOUS');
  const stage=path.join(parent,stages[0]);
  const prior=inspect(backup,LEGACY),next=inspect(stage,CURRENT);
  if(!prior||!next||prior.adjuncts.join(',')!==next.adjuncts.join(','))
   fail('RECOVERY_SOURCE_INVALID');
  noAlias(lock);
  const fd=fs.openSync(lock,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  let stat,pidBytes;
  try{
   stat=fs.fstatSync(fd);
   if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid()||
      (stat.mode&0o077)!==0||stat.size>24||stat.size<2)fail('RECOVERY_LOCK_UNSAFE');
   pidBytes=fs.readFileSync(fd,'utf8');
  }finally{fs.closeSync(fd);}
  if(!/^[1-9][0-9]{0,9}\n$/.test(pidBytes))fail('RECOVERY_LOCK_UNREADABLE');
  const pid=Number(pidBytes.trim());
  if(!Number.isSafeInteger(pid)||pid<=1)fail('RECOVERY_LOCK_UNREADABLE');
  if(pid===process.pid)fail('RECOVERY_ORIGINAL_PROCESS_ACTIVE');
  try{process.kill(pid,0);fail('RECOVERY_ORIGINAL_PROCESS_ACTIVE');}
  catch(e){if(e.code!=='ESRCH')throw e;}
  if(existsNoFollow(target)||fs.lstatSync(lock).ino!==stat.ino)
   fail('RECOVERY_CONCURRENT_SOURCE_DRIFT');
  // The sole target may not be overwritten by a competing installer; all
  // managed installs are already blocked by the original stale owner lock.
  fs.renameSync(backup,target);
  const restored=inspect(target,LEGACY);
  syncDir(parent);
  // Do not delete a verified staged package; retain for forensic rollback.
  fs.renameSync(stage,recovery);
  const retained=inspect(recovery,CURRENT);
  syncDir(parent);
  if(restored.adjuncts.join(',')!==retained.adjuncts.join(',')||
     !existsNoFollow(lock)||fs.lstatSync(lock).ino!==stat.ino)
   fail('RECOVERY_FINAL_SOURCE_DRIFT');
  try{process.kill(pid,0);fail('RECOVERY_ORIGINAL_PROCESS_ACTIVE');}
  catch(e){if(e.code!=='ESRCH')throw e;}
  fs.unlinkSync(lock);
  syncDir(parent);
  return {state:'legacy-two-file',changed:true,oldBytesRecovered:true,
    stagedNewRetained:true,adjuncts:restored.adjuncts};
 }finally{
  if(!existsNoFollow(claim))fail('RECOVERY_CLAIM_DISAPPEARED');
  const current=fs.lstatSync(claim);
  if(!current.isFile()||current.isSymbolicLink()||current.uid!==process.getuid()||
    current.nlink!==1||current.ino!==claimStat.ino)
   fail('RECOVERY_CLAIM_INTEGRITY_CHANGED');
  fs.unlinkSync(claim);
 }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3||process.argv[2]!=='--status')fail('REVIEW_ONLY_CLI');
  console.log(JSON.stringify(managePortablePackage({action:'status'})));
 }catch(e){console.error(/^PORTABLE3_[A-Z0-9_]+$/.test(e?.code??'')?e.code:'PORTABLE3_DENIED');process.exitCode=2;}
}
