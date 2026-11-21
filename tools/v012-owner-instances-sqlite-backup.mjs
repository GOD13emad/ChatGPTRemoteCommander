#!/usr/bin/env node
// v0.12: owner-local Windows SQLite backup of the fixed Commander instances tree.
// Separate live databases are individually consistent; this is NOT whole-service
// consistency, browser/DPAPI preservation, authenticated Chat binding or cutover.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync,backup} from 'node:sqlite';

const fail=code=>{throw Error('V012_INSTANCES_SQLITE_'+code)};
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const fileHash=file=>{
 const h=crypto.createHash('sha256'),b=Buffer.allocUnsafe(65536),fd=fs.openSync(file,'r');
 try{let n;while((n=fs.readSync(fd,b,0,b.length,null))>0)h.update(b.subarray(0,n));}
 finally{fs.closeSync(fd);}return h.digest('hex');
};
function noAliases(p){
 let at=path.resolve(p);
 while(true){
  if(fs.existsSync(at)&&fs.lstatSync(at).isSymbolicLink())fail('ALIAS_SOURCE_OR_DEST');
  const parent=path.dirname(at);if(parent===at)break;at=parent;
 }
}
function acl(action,paths){
 const adapter=fileURLToPath(new URL('./v2-universal-owner-acl.ps1',import.meta.url));
 const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File',adapter,
  '-Action',action],{input:JSON.stringify(paths),encoding:'utf8',timeout:20000,
   windowsHide:true,maxBuffer:4096,stdio:['pipe','pipe','pipe']});
 if(result.error||result.status!==0||typeof result.stdout!=='string'||
    !result.stdout.includes('V2_OWNER_ACL_PASS'))fail('ACL_NOT_VERIFIED');
}
function sources(root){
 noAliases(root);
 const s=fs.lstatSync(root);
 if(!s.isDirectory())fail('INSTANCES_NOT_DIRECTORY');
 const found=[],counters={all:0,bytes:0};
 function walk(dir,depth){
  if(depth>5)fail('DEPTH_BUDGET');
  for(const item of fs.readdirSync(dir,{withFileTypes:true})){
   const full=path.join(dir,item.name);
   const st=fs.lstatSync(full);counters.all++;
   if(counters.all>5000)fail('ENTRY_BUDGET');
   if(st.isSymbolicLink())fail('ALIAS_SOURCE');
   if(st.isDirectory()){walk(full,depth+1);continue;}
   if(!st.isFile()||st.nlink!==1)fail('NONREGULAR_SOURCE');
   if(path.extname(item.name).toLowerCase()!=='.sqlite')continue;
   if(st.size<4096||st.size>64*1024*1024)fail('DB_FILE_BUDGET');
   const fd=fs.openSync(full,'r'),magic=Buffer.alloc(16);
   try{fs.readSync(fd,magic,0,16,0);}finally{fs.closeSync(fd);}
   if(!magic.equals(Buffer.from('SQLite format 3\0','binary')))fail('NON_SQLITE_DB');
   counters.bytes+=st.size;
   if(counters.bytes>128*1024*1024||found.length>=64)fail('TOTAL_DB_BUDGET');
   noAliases(full);
   found.push({file:full,relative:path.relative(root,full).replaceAll(path.sep,'/')});
  }
 }
 walk(root,0);
 if(!found.length)fail('NO_SQLITE_DATABASES');
 found.sort((a,b)=>a.relative.localeCompare(b.relative));
 const folded=new Set();
 for(const f of found){
  if(f.relative.split('/').some(x=>!x||x==='.'||x==='..'))fail('UNSAFE_RELATIVE_PATH');
  const key=f.relative.toLowerCase();
  if(folded.has(key))fail('CASE_COLLISION');
  folded.add(key);
 }
 return found;
}
// Partial mode preserves every DB the *current token* can lawfully access.
// A denied source remains explicitly excluded; never claim complete restore.
export function selectEligibleDatabases(candidates,assertSourceAllowed){
 const eligible=[];let excludedBySourceAcl=0;
 for(const f of candidates){
  try{assertSourceAllowed(f.file);eligible.push(f);}
  catch{excludedBySourceAcl++;}
 }
 if(eligible.length===0)fail('NO_TOKEN_ELIGIBLE_DATABASES');
 return {eligible,excludedBySourceAcl};
}
export async function snapshotOneSqlite(source,target,restored){
 if(fs.existsSync(target)||fs.existsSync(restored))fail('OUTPUT_EXISTS');
 const db=new DatabaseSync(source,{readOnly:true});
 try{await backup(db,target,{rate:128});}finally{db.close();}
 const check=new DatabaseSync(target,{readOnly:true});
 try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')
  fail('BACKUP_INTEGRITY_FAILED');}
 finally{check.close();}
 const digest=fileHash(target),bytes=fs.statSync(target).size;
 try{
  fs.copyFileSync(target,restored,fs.constants.COPYFILE_EXCL);
  const r=new DatabaseSync(restored,{readOnly:true});
  try{if(r.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')
   fail('RESTORE_INTEGRITY_FAILED');}
  finally{r.close();}
  if(fileHash(restored)!==digest||fs.statSync(restored).size!==bytes)
   fail('RESTORE_HASH_MISMATCH');
 }finally{if(fs.existsSync(restored))fs.unlinkSync(restored);}
 return {sha256:digest,bytes};
}
async function run(){
 if(process.platform!=='win32'||process.argv.length!==3||
    !['--snapshot','--snapshot-eligible-subset'].includes(process.argv[2]))
   fail('EXPLICIT_WINDOWS_SNAPSHOT_REQUIRED');
 const allowPartial=process.argv[2]==='--snapshot-eligible-subset';
 if(!process.env.LOCALAPPDATA)fail('LOCALAPPDATA_NOT_SET');
 const base=path.resolve(process.env.LOCALAPPDATA);
 const root=path.join(base,'ChatGPTRemoteCommander','instances');
 const parent=path.join(base,'CommanderV2','migration-private');
 noAliases(root);noAliases(parent);
 acl('CheckSources',[root]);
 acl('CheckPrivate',[parent]);
 const discovered=sources(root);
 let selected,excludedBySourceAcl=0;
 if(allowPartial){
   ({eligible:selected,excludedBySourceAcl}=selectEligibleDatabases(
     discovered,file=>acl('CheckSources',[file])));
 }else{
   acl('CheckSources',discovered.map(x=>x.file));
   selected=discovered;
 }
 const id='v012-instances-sqlite-'+(allowPartial?'eligible-subset-':'')+crypto.randomUUID();
 const dest=path.join(parent,id);
 fs.mkdirSync(dest,{recursive:false});
 let accepted=false;
 try{
  acl('MakePrivate',[dest]);
  const data=path.join(dest,'data');
  fs.mkdirSync(data);acl('MakePrivate',[data]);
  const records=[];let total=0;
  for(let i=0;i<selected.length;i++){
   const f=selected[i],index=String(i+1).padStart(3,'0');
   const target=path.join(data,'db-'+index+'.sqlite');
   const restored=path.join(data,'temporary-restore-'+index+'.sqlite');
   const result=await snapshotOneSqlite(f.file,target,restored);
   acl('MakePrivate',[target]);
   total+=result.bytes;
   if(total>128*1024*1024)fail('OUTPUT_BYTES_BUDGET');
   records.push({relative:f.relative,backup:'db-'+index+'.sqlite',
    sha256:result.sha256,bytes:result.bytes});
  }
  const manifest={schema:1,scope:allowPartial?'current-token-eligible-instances-sqlite':'owner-local-instances-sqlite',
   discoveredDatabases:discovered.length,excludedBySourceAcl,
   allDiscoveredDatabasesCovered:excludedBySourceAcl===0,
   entries:records,files:records.length,bytes:total};
  const json=JSON.stringify(manifest),digest=sha(json),mf=path.join(dest,'manifest.json');
  fs.writeFileSync(mf,json,{flag:'wx'});acl('MakePrivate',[mf]);
  if(sha(fs.readFileSync(mf))!==digest)fail('MANIFEST_READBACK_FAILED');
  acl('CheckPrivate',[dest,data,mf,...records.map(x=>path.join(data,x.backup))]);
  const receipt={schema:1,snapshotId:id,files:records.length,bytes:total,
   manifestSha256:digest,discoveredDatabases:discovered.length,
   excludedBySourceAcl,allDiscoveredDatabasesCovered:excludedBySourceAcl===0,
   sourceSelectionMode:allowPartial?'explicit-token-eligible-subset':'all-candidates',
   sqliteOnlineBackup:'PASS',
   sqliteIntegrity:'PASS',disposableRestore:'PASS',privateOwnerAcl:'PASS',
   originalDatabasesReplaced:false,wholeServiceConsistent:false,
   credentialScopeCovered:false,cutoverAuthorized:false};
  const rf=path.join(dest,'receipt.json');
  fs.writeFileSync(rf,JSON.stringify(receipt),{flag:'wx'});acl('MakePrivate',[rf]);
  const read=JSON.parse(fs.readFileSync(rf,'utf8'));
  if(read.manifestSha256!==digest||read.files!==records.length)
   fail('RECEIPT_READBACK_FAILED');
  accepted=true;
  process.stdout.write('V012_INSTANCES_SQLITE_RECEIPT='+JSON.stringify(receipt)+'\n');
 }finally{
  if(!accepted&&fs.existsSync(dest))fs.rmSync(dest,{recursive:true,force:true});
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 run().catch(e=>{
  const code=e?.message?.startsWith('V012_INSTANCES_SQLITE_')?e.message:
   'V012_INSTANCES_SQLITE_BACKUP_FAILED';
  process.stderr.write(code+'\n');process.exitCode=2;
 });
}
