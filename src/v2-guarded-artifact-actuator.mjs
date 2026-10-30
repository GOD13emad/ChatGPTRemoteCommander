// R3 candidate: central-host-only, create-once physical artifact actuator.
//
// The *same* SQLite BEGIN IMMEDIATE transaction checks the global lease and
// serializes the immutable artifact publication. This is not a general file,
// GUI or browser actuator. SQLite and filesystem are not one ACID store:
// post-link/pre-receipt crashes are reconciled by checking the actual digest,
// never by overwriting or blindly repeating a physical effect.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DEVICE=/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
function validArtifactId(id){
 return typeof id==='string'&&ID.test(id)&&!id.endsWith('.')&&
  !DEVICE.test(id);
}
const SHA=/^[a-f0-9]{64}$/;
function fail(code){throw Object.assign(new Error(code),{code});}
function privateDir(folder){
 if(typeof folder!=='string'||!path.isAbsolute(folder))
  fail('V2_ARTIFACT_ROOT_INVALID');
 const full=path.resolve(folder);
 let current=path.parse(full).root;
 for(const segment of full.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,segment);
  if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())
   fail('V2_ARTIFACT_ALIAS_REJECTED');
 }
 fs.mkdirSync(full,{recursive:true,mode:0o700});
 const st=fs.lstatSync(full);
 if(!st.isDirectory()||st.isSymbolicLink()||
  (process.platform!=='win32'&&(st.uid!==process.getuid()||(st.mode&0o077)!==0)))
  fail('V2_ARTIFACT_PRIVATE_ROOT_REQUIRED');
 return fs.realpathSync.native(full);
}
function safeFileHash(filename){
 const st=fs.lstatSync(filename);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>65536)
  fail('V2_ARTIFACT_EXISTING_UNSAFE');
 const buf=fs.readFileSync(filename);
 if(buf.byteLength!==st.size)fail('V2_ARTIFACT_EXISTING_UNSAFE');
 return createHash('sha256').update(buf).digest('hex');
}
function syncDir(dir){
 if(process.platform==='win32')return; // Windows link file is flushed by OS
 const fd=fs.openSync(dir,fs.constants.O_RDONLY);
 try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
export function createV2GuardedArtifactActuator({coordinator}={}){
 if(!coordinator||typeof coordinator.scope!=='function'||
    typeof coordinator.transaction!=='function'||typeof coordinator.row!=='function'||
    typeof coordinator.clock!=='function'||!coordinator.requireGlobalResource||
    !coordinator.db||typeof coordinator.directory!=='string')
    fail('V2_ARTIFACT_TRUSTED_COORDINATOR_REQUIRED');
 const base=privateDir(path.join(coordinator.directory,'v2-private-artifacts'));
 return Object.freeze({
  // Single bounded create-once new file; no user-selected file path, truncation,
  // arbitrary command or mutation outside the coordinator's private store.
  async create({route,lease,receiptId,content}={}){
   if(!validArtifactId(receiptId)||
      typeof content!=='string'||Buffer.byteLength(content,'utf8')>65536)
      fail('V2_ARTIFACT_ARGUMENT_INVALID');
   if(!lease||typeof lease.id!=='string'||!/^[-a-f0-9]{36}$/.test(lease.id)||
      !Number.isSafeInteger(lease.fence)||lease.fence<1)
      fail('V2_ARTIFACT_LEASE_INVALID');
   const {resource,holder}=await coordinator.scope(route);
   if(typeof lease.resource!=='string'||lease.resource!==resource||
      !resource.startsWith('["global-v1",'))
      fail('V2_COORDINATOR_STALE_LEASE');
   const bytes=Buffer.from(content,'utf8');
   const digest=createHash('sha256').update(bytes).digest('hex');
   if(!SHA.test(digest))fail('V2_ARTIFACT_DIGEST_INVALID');
   const resourceKey=createHash('sha256').update(resource).digest('hex');
   const folder=privateDir(path.join(base,resourceKey));
   const target=path.join(folder,receiptId+'.artifact');
   return coordinator.transaction(()=>{
    const now=coordinator.clock();
    const current=coordinator.row(resource);
    coordinator.checkClock(current,now);
    if(!current||current.holder!==holder||current.lease_id!==lease.id||
        current.fence!==lease.fence||current.expires_at_ms<=now)
      fail('V2_COORDINATOR_STALE_LEASE');
    const old=coordinator.db.prepare(`SELECT * FROM v2_fenced_receipt
      WHERE resource=? AND receipt_id=?`).get(resource,receiptId);
    if(old&&(old.digest!==digest||old.holder!==holder||
       old.lease_id!==lease.id||old.fence!==lease.fence))
      fail('V2_ARTIFACT_RECEIPT_CONFLICT');
    const published=fs.existsSync(target);
    if(published&&safeFileHash(target)!==digest)
      fail('V2_ARTIFACT_EXISTING_CONFLICT');
    if(old&&!published)fail('V2_ARTIFACT_RECEIPT_WITHOUT_FILE');
    let recovered=published&&!old;
    if(!published){
      const temp=path.join(folder,'.'+randomUUID()+'.tmp');
      let fd;
      try{
       fd=fs.openSync(temp,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);
       fs.writeFileSync(fd,bytes);
       fs.fsyncSync(fd);
       fs.closeSync(fd);fd=undefined;
       // Hard-link creates the final name exactly once, refusing overwrite.
       // Both names are on the same owner-private volume. Atomic visibility.
       fs.linkSync(temp,target);
       syncDir(folder);
      }catch(e){
       if(fd!==undefined)fs.closeSync(fd);
       if(e?.code==='EEXIST')fail('V2_ARTIFACT_EXISTING_CONFLICT');
       throw e;
      }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
    }
    if(!old)coordinator.db.prepare(`INSERT INTO v2_fenced_receipt
      (resource,receipt_id,digest,holder,lease_id,fence,committed_at_ms)
      VALUES (?,?,?,?,?,?,?)`).run(
      resource,receiptId,digest,holder,lease.id,lease.fence,now);
    return Object.freeze({
      receiptId,digest,fence:lease.fence,committed:true,
      replayed:!!old,recovered
    });
   });
  },
  async observe({route,receiptId}={}){
   if(!validArtifactId(receiptId))
    fail('V2_ARTIFACT_ARGUMENT_INVALID');
   const {resource}=await coordinator.scope(route);
   const resourceKey=createHash('sha256').update(resource).digest('hex');
   const folder=path.join(base,resourceKey);
   const target=path.join(folder,receiptId+'.artifact');
   const row=coordinator.db.prepare(`SELECT digest,fence FROM v2_fenced_receipt
    WHERE resource=? AND receipt_id=?`).get(resource,receiptId);
   if(!row)return Object.freeze({committed:false});
   if(!fs.existsSync(target)||safeFileHash(target)!==row.digest)
    fail('V2_ARTIFACT_INTEGRITY_FAILED');
   return Object.freeze({committed:true,receiptId,digest:row.digest,fence:row.fence});
  }
 });
}
