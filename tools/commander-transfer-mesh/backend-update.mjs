#!/usr/bin/env node
// R16: one-owner, exact-SHA portable Mesh backend update with explicit rollback.
// This does NOT modify Commander Core, Syncthing configuration or GUI state.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const fail=(msg)=>{throw Error('R16_'+msg)};
const sha=(buffer)=>crypto.createHash('sha256').update(buffer).digest('hex');
const shaFile=(file)=>sha(fs.readFileSync(file));
const validSHA=(s)=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const getArgs=(args)=>{
 const out={};
 for(let i=0;i<args.length;i+=2){
  if(!/^--[a-z][a-z-]*$/.test(args[i])||!args[i+1]||out[args[i].slice(2)]!==undefined)fail('INVALID_FLAGS');
  out[args[i].slice(2)]=args[i+1];
 }
 return out;
};
function requireAbsolute(p){
 if(typeof p!=='string'||!path.isAbsolute(p)||p.includes('\0'))fail('ABSOLUTE_PATH_REQUIRED');
 return path.resolve(p);
}
function safeRegular(file,{allowAbsent=false}={}){
 let s;
 try{s=fs.lstatSync(file)}catch(e){if(allowAbsent&&e.code==='ENOENT')return null;throw e;}
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)fail('UNTRUSTED_FILE');
 return s;
}
function safeDir(folder){
 const s=fs.lstatSync(folder);
 if(!s.isDirectory()||s.isSymbolicLink())fail('UNTRUSTED_DIRECTORY');
 return folder;
}
function absoluteExternal(root,file){
 requireAbsolute(file);
 const rel=path.relative(root,file);
 if(rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)))fail('ARTIFACT_MUST_BE_EXTERNAL');
 safeDir(path.dirname(file));
 return file;
}
function fileTree(folder){
 if(!fs.existsSync(folder))return [];
 safeDir(folder);
 const found=[];
 const descend=(current)=>{
  for(const e of fs.readdirSync(current,{withFileTypes:true})){
   const file=path.join(current,e.name);
   if(e.isSymbolicLink())fail('JOURNAL_SYMLINK');
   if(e.isDirectory()){safeDir(file);descend(file);}
   else if(e.isFile()){safeRegular(file);found.push({path:path.relative(folder,file).replaceAll('\\','/'),full:file});}
   else fail('JOURNAL_SPECIAL_FILE');
  }
 };
 descend(folder);
 return found.sort((a,b)=>a.path.localeCompare(b.path));
}
function inspect(root){
 safeDir(root);
 const backend=path.join(root,'durable-send.mjs'),node=path.join(root,'node.json');
 safeRegular(backend);safeRegular(node);
 const info=JSON.parse(fs.readFileSync(node,'utf8'));
 if(!['PC','Linux','EmadServer','Amirreza'].includes(info.alias))fail('NODE_ALIAS_INVALID');
 const jobs=fileTree(path.join(root,'jobs')),staging=fileTree(path.join(root,'staging'));
 if(staging.length)fail('ACTIVE_STAGING_FILES');
 const digests=[];
 for(const item of jobs){
  if(!item.path.endsWith('.json'))fail('ACTIVE_OR_UNKNOWN_JOURNAL_FILE');
  if(fs.statSync(item.full).size>512*1024)fail('JOURNAL_TOO_LARGE');
  const j=JSON.parse(fs.readFileSync(item.full,'utf8'));
  if(!['PUBLISHED','CANCELLED'].includes(j.status))fail('JOBS_NOT_TERMINAL');
  digests.push({path:item.path,sha256:shaFile(item.full),status:j.status});
 }
 const lock=path.join(root,'.rc-backend-updater.lock');
 if(fs.existsSync(lock))fail('UPDATE_LOCK_PRESENT');
 return {installedSha:shaFile(backend),nodeSha:shaFile(node),alias:info.alias,
         journalSha:sha(Buffer.from(JSON.stringify(digests))),jobs:jobs.length,staging:staging.length};
}
function caps(candidate,root){
 safeRegular(candidate);
 const r=spawnSync(process.execPath,[candidate,'capabilities'],{
   env:{...process.env,COMMANDER_TRANSFER_HOME:root},encoding:'utf8',
   timeout:5000,maxBuffer:16000,windowsHide:true,stdio:['ignore','pipe','pipe']
 });
 if(r.error||r.status!==0)fail('CANDIDATE_CAPABILITY_EXECUTION');
 let d;
 try{d=JSON.parse(r.stdout.trim());}catch{fail('CANDIDATE_CAPABILITY_JSON');}
 if(d.schema!=='ctmesh-durable-v1'||d.contractVersion!==2||d.admissionQuotas!==true)fail('CANDIDATE_CONTRACT_MISMATCH');
 return {schema:d.schema,contractVersion:d.contractVersion,admissionQuotas:d.admissionQuotas};
}
function put(file,obj){
 safeRegular(file,{allowAbsent:true})&&fail('RECEIPT_EXISTS');
 const fd=fs.openSync(file,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(obj,null,2)+'\n');fs.fsyncSync(fd);}
 finally{fs.closeSync(fd);}
}
function saveBytesExclusive(file,data){
 const fd=fs.openSync(file,'wx',0o600);
 try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function loadPlan(file,expected){
 if(!validSHA(expected)||shaFile(file)!==expected)fail('PLAN_HASH_MISMATCH');
 safeRegular(file);
 const p=JSON.parse(fs.readFileSync(file,'utf8'));
 if(p.schema!=='rc-mesh-backend-tx-v1'||p.version!==1||
    !validSHA(p.oldSha)||!validSHA(p.newSha)||!validSHA(p.journalSha)||!validSHA(p.nodeSha)||
    typeof p.root!=='string'||typeof p.backup!=='string'||typeof p.candidate!=='string')fail('PLAN_SCHEMA');
 return p;
}
function update(root,body){
 const lock=path.join(root,'.rc-backend-updater.lock');
 let fd;
 try{fd=fs.openSync(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')fail('UPDATE_LOCK_BUSY');throw e;}
 const own=fs.fstatSync(fd);
 try{fs.writeFileSync(fd,JSON.stringify({schema:'rc-updater-lock-v1',pid:process.pid,at:new Date().toISOString()}));fs.fsyncSync(fd);return body();}
 finally{
  try{const s=fs.lstatSync(lock);if(s.dev===own.dev&&s.ino===own.ino&&!s.isSymbolicLink())fs.unlinkSync(lock);}catch(e){if(e.code!=='ENOENT')throw e;}
  fs.closeSync(fd);
 }
}
function replace(root,backend,data){
 const tmp=path.join(root,'.rc-backend-v2-'+crypto.randomUUID()+'.tmp');
 saveBytesExclusive(tmp,data);
 if(shaFile(tmp)!==sha(data))fail('STAGED_SHA_MISMATCH');
 try{fs.renameSync(tmp,backend);}catch(e){fail('ATOMIC_RENAME_'+e.code);}
}
function validateMatch(current,plan,expectedInstalled){
 if(current.installedSha!==expectedInstalled||current.nodeSha!==plan.nodeSha||
   current.alias!==plan.alias||current.journalSha!==plan.journalSha||current.jobs!==plan.jobs)
   fail('PRESTATE_MISMATCH');
}
function main(){
 const [mode,...flags]=process.argv.slice(2),a=getArgs(flags);
 if(!['plan','apply','rollback'].includes(mode))fail('MODE');
 const allowed=mode==='plan'
   ? ['root','candidate','backup','out','old-sha','new-sha']
   : ['root','plan','sha','out'];
 if(Object.keys(a).length!==allowed.length||Object.keys(a).some(k=>!allowed.includes(k)))fail('INVALID_FLAGS');
 if(mode==='plan'){
  const root=requireAbsolute(a.root),candidate=requireAbsolute(a.candidate);
  const backup=absoluteExternal(root,requireAbsolute(a.backup));
  const planFile=absoluteExternal(root,requireAbsolute(a.out));
  if(fs.existsSync(backup)||fs.existsSync(planFile))fail('ARTIFACT_ALREADY_EXISTS');
  if(!validSHA(a['old-sha'])||!validSHA(a['new-sha']))fail('EXPECTED_SHA');
  const state=inspect(root);
  if(state.installedSha!==a['old-sha']||shaFile(candidate)!==a['new-sha'])fail('SOURCE_PIN_DRIFT');
  const capability=caps(candidate,root);
  const plan={schema:'rc-mesh-backend-tx-v1',version:1,root,candidate,backup,
    oldSha:state.installedSha,newSha:a['new-sha'],nodeSha:state.nodeSha,
    alias:state.alias,journalSha:state.journalSha,jobs:state.jobs,
    capability,source:'source-only QA, not Commander Core stable promotion'};
  put(planFile,plan);
  process.stdout.write(JSON.stringify({status:'PLAN_PASS_NO_MUTATION',planSha:shaFile(planFile),
    backendSha:state.installedSha,alias:state.alias,jobs:state.jobs,contract:capability.contractVersion})+'\n');
  return;
 }
 const planFile=requireAbsolute(a.plan),plan=loadPlan(planFile,a.sha);
 if(requireAbsolute(a.root)!==plan.root)fail('ROOT_SCOPE_MISMATCH');
 absoluteExternal(plan.root,plan.backup);
 const root=plan.root,backend=path.join(root,'durable-send.mjs');
 const output=absoluteExternal(root,requireAbsolute(a.out));
 if(fs.existsSync(output))fail('RECEIPT_EXISTS');
 if(mode==='apply'){
  const candidate=requireAbsolute(plan.candidate);
  const state=inspect(root);
  validateMatch(state,plan,plan.oldSha);
  if(shaFile(candidate)!==plan.newSha)fail('CANDIDATE_CHANGED');
  caps(candidate,root);
  if(fs.existsSync(plan.backup))fail('BACKUP_ALREADY_EXISTS');
  update(root,()=>{
    const refreshed=inspectAfterLock(root);
    validateMatch(refreshed,plan,plan.oldSha);
    const oldBytes=fs.readFileSync(backend),newBytes=fs.readFileSync(candidate);
    saveBytesExclusive(plan.backup,oldBytes);
    if(shaFile(plan.backup)!==plan.oldSha)fail('BACKUP_HASH_MISMATCH');
    replace(root,backend,newBytes);
    if(shaFile(backend)!==plan.newSha)fail('ACTIVATED_SHA_MISMATCH');
    caps(backend,root);
    const final=inspectAfterLock(root);
    validateMatch(final,plan,plan.newSha);
  });
  put(output,{status:'APPLIED_IN_OWNER_PILOT_ONLY',planSHA:a.sha,oldSha:plan.oldSha,newSha:plan.newSha,
              journalUnchanged:true,backupSHA:shaFile(plan.backup),root,coreStableUntouched:true});
  process.stdout.write(JSON.stringify({status:'APPLIED_IN_OWNER_PILOT_ONLY',sha256:shaFile(backend),receiptSHA:shaFile(output)})+'\n');
 }else{
  const state=inspect(root);
  validateMatch(state,plan,plan.newSha);
  safeRegular(plan.backup);
  if(shaFile(plan.backup)!==plan.oldSha)fail('ROLLBACK_BACKUP_DRIFT');
  update(root,()=>{
    const before=inspectAfterLock(root);
    validateMatch(before,plan,plan.newSha);
    replace(root,backend,fs.readFileSync(plan.backup));
    const after=inspectAfterLock(root);
    validateMatch(after,plan,plan.oldSha);
  });
  put(output,{status:'ROLLBACK_VERIFIED',planSHA:a.sha,oldSha:plan.oldSha,newSha:plan.newSha,
              journalUnchanged:true,backupPreserved:true,root,coreStableUntouched:true});
  process.stdout.write(JSON.stringify({status:'ROLLBACK_VERIFIED',sha256:shaFile(backend),receiptSHA:shaFile(output)})+'\n');
 }
}
// The upgrade lock is ours here; otherwise the ordinary inspect() would reject it.
function inspectAfterLock(root){
 const lock=path.join(root,'.rc-backend-updater.lock');
 if(!fs.existsSync(lock))fail('UPDATER_LOCK_LOST');
 const contents=fs.readFileSync(lock,'utf8');
 let o;try{o=JSON.parse(contents);}catch{fail('UPDATER_LOCK_INVALID');}
 if(o.pid!==process.pid)fail('UPDATER_LOCK_FOREIGN');
 const fd=fs.openSync(lock,'r');
 try{const s=fs.fstatSync(fd);if(!s.isFile()||s.nlink!==1)fail('LOCK_NOT_REGULAR');}finally{fs.closeSync(fd);}
 // inspect other inputs without temporarily removing or mutating our lock.
 const backend=path.join(root,'durable-send.mjs'),node=path.join(root,'node.json');
 safeRegular(backend);safeRegular(node);
 const alias=JSON.parse(fs.readFileSync(node,'utf8')).alias;
 const jobs=fileTree(path.join(root,'jobs')),staging=fileTree(path.join(root,'staging'));
 if(staging.length)fail('ACTIVE_STAGING_FILES');
 const digests=[];
 for(const f of jobs){
  if(!f.path.endsWith('.json'))fail('ACTIVE_OR_UNKNOWN_JOURNAL_FILE');
  const j=JSON.parse(fs.readFileSync(f.full,'utf8'));
  if(!['PUBLISHED','CANCELLED'].includes(j.status))fail('JOBS_NOT_TERMINAL');
  digests.push({path:f.path,sha256:shaFile(f.full),status:j.status});
 }
 return {installedSha:shaFile(backend),nodeSha:shaFile(node),alias,
         journalSha:sha(Buffer.from(JSON.stringify(digests))),jobs:jobs.length};
}
try{main();}catch(error){console.error('R16_BACKEND_UPDATE_DENIED:'+String(error.message||error));process.exitCode=2;}
