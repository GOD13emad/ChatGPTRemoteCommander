#!/usr/bin/env node
// v0.12 migration: explicit, owner-private Commander-state byte snapshot.
// NOT a live-consistent application backup, browser backup, migration or cutover.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const KINDS = Object.freeze({
  linux: Object.freeze({
    'commander-state': ['home','.local','state','ChatGPTRemoteCommander'],
    'commander-share': ['home','.local','share','ChatGPTRemoteCommander'],
    'commander-config': ['home','.config','ChatGPTRemoteCommander']
  }),
  win32: Object.freeze({
    'commander-state': ['local','chatgpt-remote-commander'],
    'commander-roaming': ['roaming','ChatGPTRemoteCommander'],
    'commander-local': ['local','ChatGPTRemoteCommander']
  })
});
const sha = v=>createHash('sha256').update(v).digest('hex');
function halt(code){throw new Error('V012_STATE_'+code);}
function assertNoAlias(p,{missingLast=false}={}){
  if(!path.isAbsolute(p))halt('PATH_NOT_ABSOLUTE');
  const parsed=path.parse(p);
  let cur=parsed.root;
  const parts=p.slice(cur.length).split(path.sep).filter(Boolean);
  for(let i=0;i<parts.length;i++){
    cur=path.join(cur,parts[i]);
    let st;
    try{st=fs.lstatSync(cur);}catch(e){
      if(e.code==='ENOENT'&&missingLast&&i===parts.length-1)return;
      halt('PATH_MISSING_OR_UNREADABLE');
    }
    if(st.isSymbolicLink()||!st.isDirectory())halt('ALIAS_OR_NONDIRECTORY');
  }
}
function ensurePrivateParent(dest){
  if(!path.isAbsolute(dest))halt('OUTPUT_PATH_NOT_ABSOLUTE');
  const parsed=path.parse(dest);
  let cur=parsed.root;
  for(const part of dest.slice(cur.length).split(path.sep).filter(Boolean)){
    cur=path.join(cur,part);
    try{fs.mkdirSync(cur,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
    const st=fs.lstatSync(cur);
    if(!st.isDirectory()||st.isSymbolicLink())halt('OUTPUT_ALIAS');
  }
  const stat=fs.statSync(dest);
  if(process.platform!=='win32' && (stat.uid!==process.getuid()||(stat.mode&0o077)!==0))
    halt('OUTPUT_NOT_OWNER_PRIVATE');
}
function ownerOnly(stat){
  if(process.platform!=='win32'&&stat.uid!==process.getuid())halt('FOREIGN_OWNER_FILE');
}
function digestFile(file){
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  const hash=createHash('sha256');const buf=Buffer.allocUnsafe(65536);
  let bytes=0;
  try{
    let n;
    while((n=fs.readSync(fd,buf,0,buf.length,null))!==0){hash.update(buf.subarray(0,n));bytes+=n;}
  }finally{fs.closeSync(fd);}
  return {sha256:hash.digest('hex'),bytes};
}
function copyChecked(src,dest,maxBytes){
  const flags=fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0);
  const inFd=fs.openSync(src,flags);
  let outFd;
  try{
    const before=fs.fstatSync(inFd);ownerOnly(before);
    if(!before.isFile())halt('SOURCE_NOT_REGULAR');
    if(before.size>maxBytes)halt('SIZE_LIMIT');
    outFd=fs.openSync(dest,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
    const hash=createHash('sha256');const buf=Buffer.allocUnsafe(65536);let count=0,n;
    while((n=fs.readSync(inFd,buf,0,buf.length,null))>0){
      count+=n;if(count>maxBytes)halt('SIZE_LIMIT');
      hash.update(buf.subarray(0,n));let off=0;
      while(off<n)off+=fs.writeSync(outFd,buf,off,n-off);
    }
    fs.fsyncSync(outFd);
    const after=fs.fstatSync(inFd);
    if(count!==before.size||before.mtimeMs!==after.mtimeMs||
       before.ctimeMs!==after.ctimeMs||before.size!==after.size)halt('SOURCE_CHANGED_DURING_COPY');
    const hashValue=hash.digest('hex');
    if(digestFile(dest).sha256!==hashValue || digestFile(src).sha256!==hashValue)
      halt('SOURCE_OR_DESTINATION_CHANGED');
    return {sha256:hashValue,bytes:count,mode:before.mode&0o777};
  }finally{
    if(outFd!==undefined)fs.closeSync(outFd);
    fs.closeSync(inFd);
  }
}
function walkAndCopy(src,dest,acc,limits,relative=''){
  const s=fs.lstatSync(src);ownerOnly(s);
  if(s.isSymbolicLink()||!s.isDirectory())halt('SOURCE_ALIAS_OR_NONDIRECTORY');
  for(const d of fs.readdirSync(src,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    const from=path.join(src,d.name),to=path.join(dest,d.name),rel=path.join(relative,d.name);
    const st=fs.lstatSync(from);ownerOnly(st);
    if(st.isSymbolicLink())halt('SYMLINK_IN_SOURCE');
    if(st.isDirectory()){
      fs.mkdirSync(to,{mode:0o700});
      walkAndCopy(from,to,acc,limits,rel);
    }else if(st.isFile()){
      if(acc.length>=limits.maxFiles)halt('FILE_COUNT_LIMIT');
      if(st.size>limits.maxBytes-limits.bytes)halt('SIZE_LIMIT');
      const c=copyChecked(from,to,limits.maxBytes-limits.bytes);
      limits.bytes+=c.bytes;
      acc.push({relative:rel.replaceAll(path.sep,'/'),...c});
    }else halt('NONFILE_IN_SOURCE');
  }
}
function resolveRoot({kind,platform,home,appData,localAppData}){
  const spec=KINDS[platform]?.[kind];if(!spec)halt('UNSUPPORTED_KIND');
  const [base,...parts]=spec;
  const root=base==='home'?home:base==='local'?localAppData:appData;
  if(!root||!path.isAbsolute(root))halt('UNAVAILABLE_ACCOUNT_ROOT');
  return path.join(root,...parts);
}
export function snapshotV012OwnerState({
  kind='commander-state',platform=process.platform,home=os.homedir(),
  appData=process.env.APPDATA,localAppData=process.env.LOCALAPPDATA,
  outputParent,maxBytes=100*1024*1024,maxFiles=15000
}={}){
  // POSIX mode 0700 is not an ACL proof on Windows; refuse native copy until
  // a CurrentUserOnly Windows ACL proof and restore path are implemented.
  if(platform!=='linux'||process.platform!=='linux')halt('WINDOWS_ACL_PROOF_REQUIRED');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||
    !Number.isSafeInteger(maxFiles)||maxFiles<1)halt('INVALID_LIMIT');
  if(typeof outputParent!=='string')halt('OUTPUT_REQUIRED');
  const source=resolveRoot({kind,platform,home,appData,localAppData});
  assertNoAlias(source);
  const destination=path.resolve(outputParent);
  if(destination===source||destination.startsWith(source+path.sep)||
     source.startsWith(destination+path.sep))halt('SOURCE_OUTPUT_OVERLAP');
  ensurePrivateParent(destination);
  const root=fs.mkdtempSync(path.join(destination,'v012-'+kind+'-'));
  try{
    fs.chmodSync(root,0o700);
    const data=path.join(root,'data');fs.mkdirSync(data,{mode:0o700});
    const acc=[],limits={maxBytes,maxFiles,bytes:0};
    walkAndCopy(source,data,acc,limits);
    const manifest={schema:1,kind,files:acc.length,bytes:limits.bytes,entries:acc};
    const manifestData=JSON.stringify(manifest)+'\n';
    fs.writeFileSync(path.join(root,'manifest.json'),manifestData,{mode:0o600,flag:'wx'});
    const restored=fs.mkdtempSync(path.join(root,'verify-'));
    try{
      for(const item of acc){
        const from=path.join(data,...item.relative.split('/'));
        const target=path.join(restored,...item.relative.split('/'));
        fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
        const q=copyChecked(from,target,item.bytes);
        if(q.sha256!==item.sha256||q.bytes!==item.bytes)halt('OFFLINE_RESTORE_MISMATCH');
      }
    }finally{fs.rmSync(restored,{recursive:true,force:true});}
    const result=Object.freeze({
      schema:1,kind,snapshotId:path.basename(root),files:acc.length,
      bytes:limits.bytes,manifestSha256:sha(manifestData),
      sourceCopyAndIsolatedRestore:'PASS',
      liveConsistencyVerified:false,allOwnerStateBackedUp:false,
      ownerAuthenticated:false,cutoverAuthorized:false
    });
    fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify(result)+'\n',{mode:0o600,flag:'wx'});
    return result;
  }catch(e){
    // Only delete the uniquely created snapshot directory, never source or prior snapshots.
    fs.rmSync(root,{recursive:true,force:true});
    throw e;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4||process.argv[2]!=='--snapshot'||
     !['commander-state','commander-share','commander-config'].includes(process.argv[3])){
    process.stderr.write('V012_STATE_EXPLICIT_SNAPSHOT_AND_KIND_REQUIRED\n');
    process.exitCode=2;
  }else if(process.platform!=='linux'){
    process.stderr.write('V012_STATE_CLI_LINUX_OWNER_ONLY\n');process.exitCode=2;
  }else{
    try{
      const result=snapshotV012OwnerState({
        kind:process.argv[3],
        outputParent:path.join(os.homedir(),'.local','state','CommanderV2','migration-private')
      });
      process.stdout.write(JSON.stringify(result)+'\n');
    }catch(e){
      process.stderr.write((e.message?.startsWith('V012_STATE_')?e.message:'V012_STATE_SNAPSHOT_FAILED')+'\n');
      process.exitCode=2;
    }
  }
}
