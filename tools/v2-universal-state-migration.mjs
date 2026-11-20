#!/usr/bin/env node
// Offline, owner-scoped state migration for the shared Commander V2 install engine.
// Never reads arbitrary live profile trees: caller must supply a coherent,
// externally pinned snapshot of explicitly listed files. Never alters V1, services,
// tunnel keys, browser sessions or native package registrations.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspect} from './v2-universal-install-engine.mjs';

const fail=code=>{throw Error('V2_STATE_IMPORT_'+code)};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const validName=name=>typeof name==='string'&&
 /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name);
const relOk=name=>typeof name==='string'&&name.length>0&&name.length<=200&&
 /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)&&!name.includes('//')&&
 !name.split('/').some(x=>x==='.'||x==='..'||x.endsWith('.')||x.endsWith(' ')||
 /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(x));
const realFile=file=>{
 const s=fs.lstatSync(file);
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)fail('NOT_REGULAR_FILE');
 return s;
};
const noAliases=p=>{
 let at=path.resolve(p);
 for(;;){
  if(fs.existsSync(at)&&fs.lstatSync(at).isSymbolicLink())fail('ALIAS_PATH');
  const parent=path.dirname(at);
  if(parent===at)break;
  at=parent;
 }
};
function fileHash(file){
 const h=crypto.createHash('sha256'),b=Buffer.allocUnsafe(65536);
 const fd=fs.openSync(file,'r');
 try{let n;while((n=fs.readSync(fd,b,0,b.length,null))>0)h.update(b.subarray(0,n));}
 finally{fs.closeSync(fd);}
 return h.digest('hex');
}
function ownerSource(paths){
 if(process.platform!=='win32'){
  if(typeof process.getuid!=='function')fail('POSIX_UID_UNKNOWN');
  for(const p of paths)if(fs.statSync(p).uid!==process.getuid())fail('FOREIGN_OWNER');
  return;
 }
 ownerAcl('CheckSources',paths);
}
function ownerAcl(action,files){
 if(process.platform!=='win32')return;
 const script=fileURLToPath(new URL('./v2-universal-owner-acl.ps1',import.meta.url));
 try{
  const out=execFileSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive',
   '-File',script,'-Action',action],{input:JSON.stringify(files),encoding:'utf8',
    timeout:25000,windowsHide:true,maxBuffer:16384});
  if(!out.includes('V2_OWNER_ACL_PASS'))fail('WIN_ACL_UNPROVED');
 }catch{fail('WIN_ACL_UNPROVED')}
}
function markPrivate(dir,files=[]){
 if(process.platform==='win32')ownerAcl('MakePrivate',[dir,...files]);
 else {
  fs.chmodSync(dir,0o700);
  for(const f of files)fs.chmodSync(f,0o600);
 }
}
function checkManifest(m){
 if(!m||m.schema!==1||m.product!=='Commander V2'||
  m.kind!=='owner-state-snapshot'||!validName(m.profile)||
  !Array.isArray(m.files)||!m.files.length||m.files.length>10000)fail('MANIFEST_INVALID');
 let bytes=0;const paths=new Set();
 for(const f of m.files){
  if(!f||!relOk(f.path)||!Number.isSafeInteger(f.bytes)||f.bytes<0||
    !/^[a-f0-9]{64}$/.test(f.sha256||''))fail('FILE_RECORD_INVALID');
  const key=f.path.toLowerCase();if(paths.has(key))fail('CASE_COLLISION');
  paths.add(key);bytes+=f.bytes;
  if(bytes>1024*1024*1024)fail('SNAPSHOT_SIZE_EXCEEDED');
 }
 return {digest:sha(JSON.stringify(m)),bytes,files:m.files.length};
}
function checkSnapshot(source,manifest,pin){
 if(typeof source!=='string'||!path.isAbsolute(source))fail('ABSOLUTE_SOURCE_REQUIRED');
 source=path.resolve(source);noAliases(source);
 if(!fs.existsSync(source)||!fs.lstatSync(source).isDirectory())fail('SOURCE_NOT_DIRECTORY');
 if(!/^[a-f0-9]{64}$/.test(pin||''))fail('EXTERNAL_MANIFEST_PIN_REQUIRED');
 const info=checkManifest(manifest);
 if(info.digest!==pin)fail('MANIFEST_PIN_MISMATCH');
 const paths=[source];
 for(const item of manifest.files){
  const filename=path.join(source,...item.path.split('/'));
  noAliases(filename);
  const st=realFile(filename);
  if(st.size!==item.bytes||fileHash(filename)!==item.sha256)fail('SOURCE_HASH_MISMATCH');
  paths.push(filename);
 }
 ownerSource(paths);
 return info;
}
function managed(root){
 if(typeof root!=='string'||!path.isAbsolute(root))fail('ABSOLUTE_MANAGED_ROOT_REQUIRED');
 root=path.resolve(root);noAliases(root);
 const result=inspect({root});
 if(result.status!=='INSTALLED'||!result.verified)fail('NO_VERIFIED_MANAGED_INSTALL');
 return root;
}
function paths(root,profile){
 const dir=path.join(root,'owner-state');
 return {dir,items:path.join(dir,'snapshots'),pointers:path.join(dir,'profiles'),
    pointer:path.join(dir,'profiles',profile+'.json'),lock:path.join(dir,'.writer.lock')};
}
function readPointer(file){
 if(!fs.existsSync(file))return null;
 noAliases(file);realFile(file);
 const p=JSON.parse(fs.readFileSync(file,'utf8'));
 if(p.schema!==1||!/^[a-f0-9]{64}$/.test(p.current||'')||
   !(p.previous===null||/^[a-f0-9]{64}$/.test(p.previous||'')))fail('POINTER_INVALID');
 return p;
}
function verifiedImport(base,digest,manifest){
 if(!/^[a-f0-9]{64}$/.test(digest||''))fail('SNAPSHOT_ID_INVALID');
 const dir=path.join(base,digest),file=path.join(dir,'manifest.json');
 noAliases(file);realFile(file);
 const stored=JSON.parse(fs.readFileSync(file,'utf8'));
 if(checkManifest(stored).digest!==digest)fail('STORED_MANIFEST_DRIFT');
 if(manifest&&JSON.stringify(stored)!==JSON.stringify(manifest))fail('STORED_MANIFEST_NOT_MATCHING');
 for(const item of stored.files){
  const f=path.join(dir,'data',...item.path.split('/'));
  noAliases(f);
  const st=realFile(f);
  if(st.size!==item.bytes||fileHash(f)!==item.sha256)fail('STORED_FILE_CHANGED');
 }
 return stored;
}
function atomicJson(file,data){
 const tmp=file+'.tmp-'+crypto.randomUUID();
 const fd=fs.openSync(tmp,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(data));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 if(process.platform==='win32')ownerAcl('MakePrivate',[tmp]);
 fs.renameSync(tmp,file);
}
function withLock(dir,fn){
 const lock=path.join(dir,'.writer.lock'),fd=fs.openSync(lock,'wx',0o600);
 try{return fn();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
function prepareState(root){
 const p=paths(root,'placeholder');
 for(const dir of [p.dir,p.items,p.pointers]){
  if(!fs.existsSync(dir)){fs.mkdirSync(dir,{mode:0o700});markPrivate(dir);}
  else {
   noAliases(dir);
   if(!fs.lstatSync(dir).isDirectory())fail('STATE_NOT_DIRECTORY');
   if(process.platform==='win32')ownerAcl('CheckPrivate',[dir]);
   else {
    const st=fs.statSync(dir);
    if(st.uid!==process.getuid())fail('STATE_FOREIGN_OWNER');
    if((st.mode&0o077)!==0)fail('STATE_NOT_PRIVATE');
   }
  }
 }
 if(fs.readdirSync(p.items).some(x=>x.startsWith('.staging-')))fail('UNRECONCILED_STAGING');
 return p;
}
export function buildOwnerSnapshotManifest({source,profile,files}={}){
 if(!Array.isArray(files)||!validName(profile)||typeof source!=='string'||!path.isAbsolute(source))
  fail('BUILD_ARGUMENT_INVALID');
 source=path.resolve(source);noAliases(source);
 const records=files.map(n=>{
  if(!relOk(n))fail('PATH_INVALID');
  const f=path.join(source,...n.split('/')),s=realFile(f);noAliases(f);
  return {path:n,bytes:s.size,sha256:fileHash(f)};
 });
 ownerSource([source,...files.map(n=>path.join(source,...n.split('/')))]);
 const manifest={schema:1,product:'Commander V2',kind:'owner-state-snapshot',profile,files:records};
 const info=checkManifest(manifest);
 return {manifest,manifestSha256:info.digest,files:info.files,bytes:info.bytes,
  sourceQuiescenceVerified:false,fullOwnerProfileCovered:false};
}
export function migrationPlan({source,root,manifest,expectedManifestSha256}={}){
 root=managed(root);source=path.resolve(source||'');
 if(root===source||root.startsWith(source+path.sep)||source.startsWith(root+path.sep))
  fail('SOURCE_TARGET_OVERLAP');
 const info=checkSnapshot(source,manifest,expectedManifestSha256);
 const p=paths(root,manifest.profile),active=readPointer(p.pointer);
 return {schema:1,product:'Commander V2',profile:manifest.profile,manifestSha256:info.digest,
  files:info.files,bytes:info.bytes,current:active?.current??null,
  action:active?.current===info.digest?'VERIFY_OR_NOOP':'IMPORT',
  changesApplied:false,realLiveProfileConsistencyProved:false,fullProfilePreserved:false,
  legacyInstallReplaced:false,hostCutoverAuthorized:false};
}
export function importOwnerSnapshot(options={}){
 const preview=migrationPlan(options);
 const {source,manifest,root,expectedManifestSha256,injectFailure=''}=options;
 const p=prepareState(path.resolve(root));
 return withLock(p.dir,()=>{
  const current=readPointer(paths(root,manifest.profile).pointer);
  if(current?.current===expectedManifestSha256){
   verifiedImport(p.items,expectedManifestSha256,manifest);
   return {...preview,action:'NOOP'};
  }
  const destination=path.join(p.items,expectedManifestSha256);
  if(fs.existsSync(destination))verifiedImport(p.items,expectedManifestSha256,manifest);
  else{
   const stage=path.join(p.items,'.staging-'+crypto.randomUUID());
   fs.mkdirSync(stage,{mode:0o700});markPrivate(stage);
   try{
    const data=path.join(stage,'data');
    fs.mkdirSync(data,{mode:0o700});markPrivate(data);
    const privateFiles=[];
    for(const item of manifest.files){
     const from=path.join(source,...item.path.split('/'));
     const to=path.join(data,...item.path.split('/'));
     fs.mkdirSync(path.dirname(to),{recursive:true,mode:0o700});
     fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);
     fs.chmodSync(to,0o600);privateFiles.push(to);
     if(realFile(to).size!==item.bytes||fileHash(to)!==item.sha256||
       fileHash(from)!==item.sha256)fail('COPIED_SOURCE_CHANGED');
    }
    const mfile=path.join(stage,'manifest.json');
    fs.writeFileSync(mfile,JSON.stringify(manifest),{flag:'wx',mode:0o600});
    privateFiles.push(mfile);
    if(process.platform==='win32'){
      const parentDirs=new Set([data]);
      for(const f of privateFiles){
       let dir=path.dirname(f);
       while(dir.startsWith(data)&&dir!==data){parentDirs.add(dir);dir=path.dirname(dir);}
      }
      ownerAcl('MakePrivate',[...parentDirs,...privateFiles]);
    }
    if(injectFailure==='beforePromotion')fail('INJECTED_BEFORE_PROMOTION');
    fs.renameSync(stage,destination);
   }catch(e){if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});throw e;}
  }
  verifiedImport(p.items,expectedManifestSha256,manifest);
  if(injectFailure==='beforeActivation')fail('INJECTED_BEFORE_ACTIVATION');
  atomicJson(paths(root,manifest.profile).pointer,{
   schema:1,current:expectedManifestSha256,previous:current?.current??null
  });
  return {...preview,action:'IMPORTED'};
 });
}
export function rollbackOwnerSnapshot({root,profile}={}){
 if(!validName(profile))fail('PROFILE_INVALID');
 root=managed(root);const p=prepareState(root);
 return withLock(p.dir,()=>{
  const old=readPointer(paths(root,profile).pointer);
  if(!old?.previous)fail('NO_PREVIOUS_SNAPSHOT');
  verifiedImport(p.items,old.current);verifiedImport(p.items,old.previous);
  atomicJson(paths(root,profile).pointer,{
   schema:1,current:old.previous,previous:old.current
  });
  return {schema:1,status:'ROLLBACK',profile,current:old.previous,
   legacyInstallationChanged:false,fullOwnerProfileCovered:false};
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 console.error('V2_STATE_IMPORT_API_ONLY_OFFLINE_SNAPSHOT');
 process.exitCode=2;
}
