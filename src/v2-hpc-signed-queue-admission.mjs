// Signed, allowlisted intake for the existing headless HPC QA worker.
// This does NOT attest ChatGPT OAuth or admit a production V2 worker.
// The Scheduled Task may call this before processing its legacy local queue.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {verifyV2HpcBoundedJob} from './v2-hpc-signed-job.mjs';

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const HOSTS=new Set(['HPC-159-17','HPC-154-66']);
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const invalidCodes=new Set([
 'V2_SIGNED_JOB_ENVELOPE_INVALID','V2_SIGNED_JOB_BOUNDARY_INVALID',
 'V2_SIGNED_JOB_NOT_BOUNDED','V2_SIGNED_JOB_WRONG_RECIPIENT',
 'V2_SIGNED_JOB_OUTSIDE_TIME_WINDOW','V2_SIGNED_JOB_BAD_SIGNATURE']);
function readRegular(p,min,max){
 const st=fs.lstatSync(p);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||
  st.size<min||st.size>max)fail('V2_SIGNED_AUTO_FILE_UNSAFE');
 const b=fs.readFileSync(p);
 if(b.length!==st.size)fail('V2_SIGNED_AUTO_FILE_CHANGED');
 return b;
}
function safeDir(root,name,create){
 const dir=path.join(root,name);
 if(!fs.existsSync(dir)){
  if(!create)fail('V2_SIGNED_AUTO_DIRECTORY_MISSING');
  fs.mkdirSync(dir,{mode:0o700});
 }
 const st=fs.lstatSync(dir);
 if(!st.isDirectory()||st.isSymbolicLink())
  fail('V2_SIGNED_AUTO_DIRECTORY_UNSAFE');
 return dir;
}
function publishOnce(filename,contents){
 const tmp=path.join(path.dirname(filename),'.'+randomUUID()+'.tmp');
 let fd;
 try{
  fd=fs.openSync(tmp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
  fs.writeFileSync(fd,contents);
  fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  fs.linkSync(tmp,filename);
  return true;
 }catch(e){if(e.code==='EEXIST')return false;throw e;}
 finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
export function createV2HpcSignedAutoAdmission({root,host,publicKey,
 expectedPublicKeySha256,keyId='mmz-hpc-qa-20261102',now=()=>Date.now()}={}){
 if(!HOSTS.has(host)||typeof root!=='string'||!path.isAbsolute(root)||
  path.basename(root)!=='CommanderV2-ComputeBridge-QA')
  fail('V2_SIGNED_AUTO_HOST_OR_ROOT_UNTRUSTED');
 if(!Buffer.isBuffer(publicKey)||!(/^[a-f0-9]{64}$/).test(expectedPublicKeySha256)||
  hash(publicKey)!==expectedPublicKeySha256)
  fail('V2_SIGNED_AUTO_PUBLIC_KEY_UNTRUSTED');
 const rootStat=fs.lstatSync(root);
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink())
  fail('V2_SIGNED_AUTO_DIRECTORY_UNSAFE');
 const signed=safeDir(root,'signed-qa-inbox',true);
 const jobs=safeDir(root,'compute-inbox',true);
 const witnesses=safeDir(root,'signed-qa-admissions',true);
 return Object.freeze({
  // Only pending effects may be computed. The exact signed source and immutable
  // admission witness must both agree with the canonical local queue bytes.
  // An expired signature cannot authorize a NEW effect, even if it was admitted.
  verifyForExecution(id,jobSha256){
   if(typeof id!=='string'||!ID.test(id)||typeof jobSha256!=='string'||
    !/^[a-f0-9]{64}$/.test(jobSha256))
    fail('V2_SIGNED_AUTO_EXECUTION_ARGUMENT_INVALID');
   const envelopeFile=path.join(signed,id+'.json');
   const jobFile=path.join(jobs,id+'.json');
   const witnessFile=path.join(witnesses,id+'.json');
   if(!fs.existsSync(envelopeFile)||!fs.existsSync(witnessFile))
    return false;
   const signedRaw=readRegular(envelopeFile,50,1800);
   const jobRaw=readRegular(jobFile,20,512);
   const witnessRaw=readRegular(witnessFile,100,2000);
   let envelope,witness;
   try{
    envelope=JSON.parse(signedRaw.toString('utf8'));
    witness=JSON.parse(witnessRaw.toString('utf8'));
   }catch{fail('V2_SIGNED_AUTO_EXECUTION_CORRUPT')}
   if(witness===null||typeof witness!=='object'||
    Array.isArray(witness)||Object.keys(witness).length!==8||
    witness.schema!==1||
    witness.scope!=='V1_OWNER_SIGNED_QA_NOT_PRODUCTION'||
    witness.host!==host||witness.operationId!==id||
    witness.keyId!==keyId||
    witness.signedEnvelopeSha256!==hash(signedRaw)||
    witness.jobSha256!==hash(jobRaw)||
    witness.jobSha256!==jobSha256)
    fail('V2_SIGNED_AUTO_EXECUTION_WITNESS_CONFLICT');
   let verified;
   try{
    verified=verifyV2HpcBoundedJob({
     envelope,expectedHostId:host,expectedKeyId:keyId,
     publicKey,now:now()
    });
   }catch(e){
    if(e.code==='V2_SIGNED_JOB_OUTSIDE_TIME_WINDOW')return false;
    throw e;
   }
   const body=Buffer.from(JSON.stringify(verified.boundedJob)+'\n');
   if(verified.operationId!==id||!body.equals(jobRaw)||
    verified.signedPayloadSha256!==witness.signedPayloadSha256)
    fail('V2_SIGNED_AUTO_EXECUTION_BINDING_CONFLICT');
   return true;
  },
  run(){
   let admitted=0,invalid=0,reconciled=0,preexisting=0;
   const files=fs.readdirSync(signed).filter(n=>n.endsWith('.json')).sort();
   // Prioritize entries missing an admission witness, not stale signed inputs.
   const missing=files.filter(n=>!fs.existsSync(path.join(witnesses,n)));
   const known=files.filter(n=>fs.existsSync(path.join(witnesses,n)));
   const selected=[...missing,...known].slice(0,32);
   for(const file of selected){
    const id=file.slice(0,-5);
    if(!ID.test(id)){invalid++;continue;}
    const signedFile=path.join(signed,file),jobFile=path.join(jobs,file);
    const witnessFile=path.join(witnesses,file);
    const raw=readRegular(signedFile,50,1800);
    let envelope;
    try{envelope=JSON.parse(raw.toString('utf8'))}
    catch{invalid++;continue;}
    // Existing witness can be read after expiry only to reconcile EXACT prior
    // admission. A newly admitted job must always have a fresh signature.
    if(fs.existsSync(witnessFile)){
     const b=readRegular(witnessFile,100,2000);
     let w;try{w=JSON.parse(b)}catch{fail('V2_SIGNED_AUTO_WITNESS_CORRUPT');}
     if(w.schema!==1||w.host!==host||w.operationId!==id||
       w.signedEnvelopeSha256!==hash(raw)||typeof w.jobSha256!=='string'||
       !fs.existsSync(jobFile)||hash(readRegular(jobFile,20,512))!==w.jobSha256)
       fail('V2_SIGNED_AUTO_WITNESS_CONFLICT');
     reconciled++;continue;
    }
    // Existing unsigned/previously manually admitted job cannot be silently
    // reclassified as auto-signed; no overwrite, no fabricated witness.
    if(fs.existsSync(jobFile)){preexisting++;continue;}
    let verified;
    try{
     verified=verifyV2HpcBoundedJob({
      envelope,expectedHostId:host,expectedKeyId:keyId,publicKey,now:now()});
    }catch(e){if(invalidCodes.has(e.code)){invalid++;continue;}throw e;}
    if(verified.operationId!==id){invalid++;continue;}
    const body=Buffer.from(JSON.stringify(verified.boundedJob)+'\n');
    if(!publishOnce(jobFile,body)){
     if(!fs.readFileSync(jobFile).equals(body))
      fail('V2_SIGNED_AUTO_ADMISSION_CONFLICT');
     preexisting++;continue;
    }
    const witness=Buffer.from(JSON.stringify({
     schema:1,scope:'V1_OWNER_SIGNED_QA_NOT_PRODUCTION',host,operationId:id,
     signedEnvelopeSha256:hash(raw),signedPayloadSha256:verified.signedPayloadSha256,
     jobSha256:hash(body),keyId
    })+'\n');
    if(!publishOnce(witnessFile,witness))
      fail('V2_SIGNED_AUTO_WITNESS_CONFLICT');
    if(hash(readRegular(jobFile,20,512))!==hash(body)||
       !readRegular(witnessFile,100,2000).equals(witness))
      fail('V2_SIGNED_AUTO_POSTCOMMIT_MISMATCH');
    admitted++;
   }
   return Object.freeze({host,scanned:selected.length,admitted,invalid,
    reconciled,preexisting,productionV2:false,chatGPTOAuthAttested:false});
  }
 });
}
