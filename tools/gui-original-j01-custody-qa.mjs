// E42 standalone original-J01 custody QA. NO installed broker or GUI grant.
// Source is READ ONLY. Destination is disposable untrusted QA storage.
// This cannot prove physical-owner authentication, protected ACL or power-loss durability.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';

const hash=b=>createHash('sha256').update(b).digest('hex');
const err=code=>Object.assign(new Error(code),{code});
const safeSha=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const regular=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n;
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs;
const noGrant=(state,expectedSha256,archiveSha256=null,dirSync=false)=>Object.freeze({
 schema:'rc-j01-original-custody-qa-v1',state,expectedSha256,archiveSha256,
 sourceOriginalRetained:true,originalNativeOutcome:'UNKNOWN',
 archivedByteMatch:state==='ARCHIVE_BYTES_VERIFIED',
 posixDirectoryFsync:dirSync,physicalPowerLossProven:false,
 storageTrusted:false,ownerAuthenticated:false,protectedBroker:false,
 releaseAuthorized:false,fleetQuiescenceProven:false,noReplay:true
});

// Prevent even accidental use on an installed live J01. Require the QA fixture
// to be a directly created child of os.tmpdir(), never an arbitrary path.
async function checkDisposableRoot(qaRoot, sourceFile, archiveDir){
 if(typeof qaRoot!=='string'||!path.isAbsolute(qaRoot))
  throw err('J01_QA_ROOT_REQUIRED');
 const dir=path.resolve(qaRoot);
 if(path.dirname(dir)!==path.resolve(os.tmpdir())||
    !path.basename(dir).startsWith('rc-e42-j01-qa-')||
    !path.basename(dir).match(/^rc-e42-j01-qa-[A-Za-z0-9]+$/))
  throw err('J01_QA_ROOT_NOT_DISPOSABLE');
 const st=await fs.lstat(dir,{bigint:true});
 if(!st.isDirectory()||st.isSymbolicLink())throw err('J01_QA_ROOT_UNSAFE');
 if(sourceFile!==null&&path.dirname(path.resolve(sourceFile))!==dir)
  throw err('J01_QA_SOURCE_OUTSIDE_ROOT');
 if(path.dirname(path.resolve(archiveDir))!==dir)
  throw err('J01_QA_ARCHIVE_OUTSIDE_ROOT');
 return dir;
}

async function trustedShape(file,type) {
 const s=await fs.lstat(file,{bigint:true});
 if(type==='source'&&!regular(s))throw err('J01_SOURCE_NOT_SINGLE_REGULAR_FILE');
 if(type==='directory'&&(!s.isDirectory()||s.isSymbolicLink()))
  throw err('J01_ARCHIVE_DIR_INVALID');
 return s;
}
async function readBoundedAndStable(file, expectedSize){
 const initial=await trustedShape(file,'source');
 if(initial.size!==BigInt(expectedSize))throw err('J01_SOURCE_SIZE_MISMATCH');
 // O_NOFOLLOW protects final component on POSIX; on Windows this flag is not available.
 const h=await fs.open(file,constants.O_RDONLY|(process.platform==='win32'?0:(constants.O_NOFOLLOW||0)));
 try {
  const opened=await h.stat({bigint:true});
  if(!regular(opened)||!same(initial,opened))throw err('J01_SOURCE_CHANGED_DURING_OPEN');
  const bytes=await h.readFile();
  const after=await h.stat({bigint:true});
  if(!same(opened,after)||bytes.length!==expectedSize)
   throw err('J01_SOURCE_CHANGED_DURING_READ');
  const now=await trustedShape(file,'source');
  if(!same(after,now))throw err('J01_SOURCE_REPLACED');
  return bytes;
 } finally {await h.close()}
}

/** Copy only to an unused deterministic archival filename in a caller-owned disposable directory.
 * Never deletes/renames the live original, never retries or cleans a partially written archive.
 * A same-user attacker can still mutate this directory; it is NOT a broker trust boundary.
 */
export async function copyOriginalJ01QADenyOnly({qaRoot,sourceFile,archiveDir,expectedSha256,expectedBytes}={}){
 if(typeof sourceFile!=='string'||!path.isAbsolute(sourceFile)||
    typeof archiveDir!=='string'||!path.isAbsolute(archiveDir)||
    !safeSha(expectedSha256)||!Number.isSafeInteger(expectedBytes)||
    expectedBytes<1||expectedBytes>4096)
    throw err('J01_CUSTODY_ARGUMENT_INVALID');
 await checkDisposableRoot(qaRoot,sourceFile,archiveDir);
 const root=path.resolve(archiveDir);
 const src=path.resolve(sourceFile);
 if(root===path.dirname(src)||root===src)throw err('J01_CUSTODY_NOT_ISOLATED');
 const dirBefore=await trustedShape(root,'directory');
 if(process.platform!=='win32'){
  if(dirBefore.uid!==BigInt(process.getuid())||(dirBefore.mode&0o077n)!==0n)
   throw err('J01_ARCHIVE_DIR_NOT_PRIVATE');
 }
 const orig=await readBoundedAndStable(src,expectedBytes);
 if(hash(orig)!==expectedSha256)throw err('J01_ORIGINAL_HASH_MISMATCH');
 const name='j01-original-'+expectedSha256+'.bin';
 const destination=path.join(root,name);
 const flags=constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|
   (process.platform==='win32'?0:(constants.O_NOFOLLOW||0));
 // Preserve EXCLUSIVE created file even on error; never erase ambiguous crash evidence.
 const h=await fs.open(destination,flags,0o600);
 try{
  const ds=await h.stat({bigint:true});
  if(!regular(ds))throw err('J01_ARCHIVE_FILE_UNSAFE');
  await h.writeFile(orig);
  await h.sync();
 } finally {await h.close()}
 // Do not accept data merely because a write or fsync returned.
 const copied=await readBoundedAndStable(destination,expectedBytes);
 if(hash(copied)!==expectedSha256)throw err('J01_ARCHIVE_READBACK_MISMATCH');
 const still=await readBoundedAndStable(src,expectedBytes);
 if(!still.equals(orig))throw err('J01_ORIGINAL_CHANGED_AFTER_COPY');
 const dirAfter=await trustedShape(root,'directory');
 if(dirBefore.dev!==dirAfter.dev||dirBefore.ino!==dirAfter.ino)
  throw err('J01_ARCHIVE_DIR_SWAPPED');
 let dirSynced=false;
 if(process.platform!=='win32'){
  const dh=await fs.open(root,constants.O_RDONLY|constants.O_DIRECTORY);
  try {await dh.sync();dirSynced=true;} finally {await dh.close()}
 }
 return noGrant('ARCHIVE_BYTES_VERIFIED',expectedSha256,hash(copied),dirSynced);
}

/** Read-only inspection; even a valid archive is NEVER release authority. */
export async function inspectOriginalJ01QADenyOnly({qaRoot,archiveDir,expectedSha256,expectedBytes}={}){
 if(typeof archiveDir!=='string'||!path.isAbsolute(archiveDir)||
    !safeSha(expectedSha256)||!Number.isSafeInteger(expectedBytes)||
    expectedBytes<1||expectedBytes>4096)throw err('J01_CUSTODY_ARGUMENT_INVALID');
 await checkDisposableRoot(qaRoot,null,archiveDir);
 const root=path.resolve(archiveDir);
 await trustedShape(root,'directory');
 const file=path.join(root,'j01-original-'+expectedSha256+'.bin');
 try{
  const bytes=await readBoundedAndStable(file,expectedBytes);
  const digest=hash(bytes);
  return noGrant(digest===expectedSha256?'ARCHIVE_BYTES_VERIFIED':'ARCHIVE_CORRUPT_DENY',
    expectedSha256,digest,false);
 }catch(e){
  if(e.code==='ENOENT')return noGrant('ARCHIVE_MISSING_DENY',expectedSha256);
  if(e.code==='J01_SOURCE_SIZE_MISMATCH'||e.code==='J01_SOURCE_NOT_SINGLE_REGULAR_FILE')
    return noGrant('ARCHIVE_UNSAFE_DENY',expectedSha256);
  throw e;
 }
}
