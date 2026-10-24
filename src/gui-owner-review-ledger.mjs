// STAGING ONLY: atomic, no-retry bookkeeping for proposed GUI review challenges.
// This is NOT a protected owner-broker, an authentication check, a trusted
// durable archive, native dispatcher quiescence or native GUI authorization.
// Storage supplied by the caller is untrusted unless independently isolated
// under a distinct OS principal and audited by a future product broker.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {reviewSignatureBytes} from './gui-owner-review-challenge.mjs';

const sha=s=>createHash('sha256').update(s).digest('hex');
const reject=(code)=>Object.assign(new Error(code),{code});
const prefix='rc-gui-owner-review-consumed-v1-';
const noGrant=(recorded,reason)=>Object.freeze({
 claimRecorded:recorded,reason,
 ownerAuthenticated:false,fleetQuiescenceProven:false,
 releaseAuthorized:false,noReplay:true,storageTrusted:false
});

export function createOwnerReviewNonceLedger({directory}={}){
 if(typeof directory!=='string'||!path.isAbsolute(directory))
  throw reject('GUI_OWNER_LEDGER_PATH_INVALID');
 const root=path.resolve(directory);
 const flags=constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW||0);
 const validateRoot=async()=>{
  const stat=await fs.lstat(root,{bigint:true});
  if(!stat.isDirectory()||stat.isSymbolicLink())
   throw reject('GUI_OWNER_LEDGER_DIRECTORY_UNTRUSTED');
  // POSIX safety check only. Windows requires an independently reviewed,
  // protected NTFS DACL / OS service identity, which this module cannot prove.
  if(process.platform!=='win32'){
   if(stat.uid!==BigInt(process.getuid())||(stat.mode&0o077n)!==0n)
    throw reject('GUI_OWNER_LEDGER_DIRECTORY_UNTRUSTED');
  }
  return stat;
 };
 const stable=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&
  a.mode===b.mode&&a.uid===b.uid;
 async function claim(challenge){
  // This validates canonical syntax and digest only; no identity proof.
  const transcript=reviewSignatureBytes(challenge);
  const expectedSha=sha(transcript);
  if(expectedSha!==challenge.challengeSha256)
   throw reject('GUI_OWNER_LEDGER_CHALLENGE_INVALID');
  const token=sha('RC-GUI-OWNER-CONSUME-V1\n'+expectedSha+'\n');
  const file=path.join(root,prefix+token+'.json');
  let before;
  try{before=await validateRoot();}
  catch{return noGrant(false,'STORAGE_NOT_PROVEN');}
  const record={schema:'rc-gui-owner-review-consumed-v1',challengeSha256:expectedSha};
  let h;
  try{
   h=await fs.open(file,flags,0o600); // Atomic across cooperating processes
  }catch(error){
   if(error?.code==='EEXIST')return noGrant(false,'CHALLENGE_ALREADY_RECORDED');
   return noGrant(false,'STORAGE_NOT_PROVEN');
  }
  try{
   await h.writeFile(JSON.stringify(record)+'\n','utf8');
   await h.sync();
   const stat=await h.stat({bigint:true});
   if(!stat.isFile()||stat.nlink!==1n)throw reject('GUI_OWNER_LEDGER_UNSAFE_RECORD');
  }catch{
   // Never delete an incomplete claim: a partial marker must deny reuse.
   return noGrant(false,'CLAIM_INCOMPLETE_BLOCKED');
  }finally{await h.close().catch(()=>{});}
  try{
   const after=await validateRoot();
   if(!stable(before,after))return noGrant(false,'STORAGE_CHANGED_BLOCKED');
  }catch{return noGrant(false,'STORAGE_NOT_PROVEN');}
  // Windows directory metadata durability and OS principal ownership are
  // not attested by this code: it cannot authorize any review or GUI input.
  return noGrant(true,'DIAGNOSTIC_CLAIM_RECORDED_NO_AUTHORITY');
 }
 return Object.freeze({claim});
}
