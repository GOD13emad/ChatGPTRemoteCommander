// Cryptographically bound native HPC result QA, triggered by existing Scheduled Task.
// No production worker enrollment, ChatGPT OAuth, browser, GUI or network calls.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID,createPublicKey,createPrivateKey} from 'node:crypto';
import {verifyV2HpcBoundedJob} from './v2-hpc-signed-job.mjs';
import {signV2HpcReceipt,verifyV2HpcReceipt} from './v2-hpc-signed-receipt.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
function safeRead(filename,min,max){
 const s=fs.lstatSync(filename);
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size<min||s.size>max)
 fail('V2_HPC_RETURN_QA_UNSAFE_FILE');
 const b=fs.readFileSync(filename);
 if(b.length!==s.size)fail('V2_HPC_RETURN_QA_CHANGED_FILE');
 return b;
}
function putOnce(file,bytes){
 const temp=path.join(path.dirname(file),'.'+randomUUID()+'.tmp');
 let fd;
 try{
  fd=fs.openSync(temp,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);
  fs.writeSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  fs.linkSync(temp,file);return true;
 }catch(e){if(e.code==='EEXIST')return false;throw e;}
 finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
export function createV2HpcSignedReturnQueue({root,host,privateKey,receiptPublicKey,
 ownerPublicKey,worker,now=()=>Date.now()}={}){
 if(!['HPC-159-17','HPC-154-66'].includes(host)||
 typeof root!=='string'||!path.isAbsolute(root)||
 path.basename(root)!=='CommanderV2-ComputeBridge-QA'||
 !worker||typeof worker.verify!=='function'||
 !Buffer.isBuffer(privateKey)||!Buffer.isBuffer(receiptPublicKey)||
 !Buffer.isBuffer(ownerPublicKey))
 fail('V2_HPC_RETURN_QA_TRUSTED_ARGS_REQUIRED');
 let derived;
 try{derived=createPublicKey(createPrivateKey(privateKey)).export({format:'pem',type:'spki'});}
 catch{fail('V2_HPC_RETURN_QA_KEY_PAIR_INVALID');}
 if(!Buffer.from(derived).equals(receiptPublicKey))
 fail('V2_HPC_RETURN_QA_KEY_PAIR_MISMATCH');
 const dir=path.join(root,'signed-qa-return-receipts');
 if(!fs.existsSync(dir))fs.mkdirSync(dir,{mode:0o700});
 if(!fs.lstatSync(dir).isDirectory()||fs.lstatSync(dir).isSymbolicLink())
 fail('V2_HPC_RETURN_QA_FOLDER_UNSAFE');
 return Object.freeze({
  seal(){
   let created=0,reconciled=0,waiting=0;
   const witnesses=path.join(root,'signed-qa-admissions');
   const names=fs.readdirSync(witnesses).filter(n=>n.endsWith('.json')).sort();
   const pending=names.filter(n=>!fs.existsSync(path.join(dir,n)));
   const existing=names.filter(n=>fs.existsSync(path.join(dir,n)));
   const selected=[...pending,...existing].slice(0,32);
   for(const name of selected){
    const id=name.slice(0,-5);
    if(!ID.test(id))fail('V2_HPC_RETURN_QA_ID_INVALID');
    const receiptPath=path.join(root,'compute-outbox',name);
    if(!fs.existsSync(receiptPath)){waiting++;continue;}
    const witnessBytes=safeRead(path.join(witnesses,name),100,2000);
    const receiptBytes=safeRead(receiptPath,100,3000);
    const signedOriginalBytes=safeRead(path.join(root,'signed-qa-inbox',name),50,1800);
    const jobBytes=safeRead(path.join(root,'compute-inbox',name),20,512);
    let original,w;
    try{
     original=JSON.parse(signedOriginalBytes.toString('utf8'));
     w=JSON.parse(witnessBytes.toString('utf8'));
    }catch{fail('V2_HPC_RETURN_QA_CONTENT_INVALID');}
    if(w.host!==host||w.operationId!==id||w.signedEnvelopeSha256!==sha(signedOriginalBytes)||
       w.jobSha256!==sha(jobBytes)||w.keyId!=='mmz-hpc-qa-20261102')
     fail('V2_HPC_RETURN_QA_WITNESS_INVALID');
    // Historical cryptographic revalidation at original issue-time is NOT
    // permission to run expired tasks; the signed-only Worker already enforced
    // live validity before producing a NEW effect.
    const x=verifyV2HpcBoundedJob({envelope:original,expectedHostId:host,
     expectedKeyId:'mmz-hpc-qa-20261102',publicKey:ownerPublicKey,
     now:original?.payload?.issuedAtMs});
    if(x.operationId!==id||x.signedPayloadSha256!==w.signedPayloadSha256||
      !Buffer.from(JSON.stringify(x.boundedJob)+'\n').equals(jobBytes))
     fail('V2_HPC_RETURN_QA_ORIGIN_INVALID');
    const verified=worker.verify(id);
    const observed=JSON.parse(receiptBytes.toString('utf8'));
    if(verified.digest!==observed.digest||verified.count!==observed.result.count||
       verified.sum!==observed.result.sum)
     fail('V2_HPC_RETURN_QA_INDEPENDENT_RESULT_MISMATCH');
    const target=path.join(dir,name);
    if(fs.existsSync(target)){
     const previous=safeRead(target,150,1800);
     const envelope=JSON.parse(previous.toString('utf8'));
     verifyV2HpcReceipt({envelope,expectedHost:host,receiptBytes,witnessBytes,
      publicKey:receiptPublicKey,now:now()});
     reconciled++;continue;
    }
    const envelope=signV2HpcReceipt({host,receiptBytes,witnessBytes,
     privateKey,issuedAtMs:now()});
    const out=Buffer.from(JSON.stringify(envelope)+'\n');
    const inserted=putOnce(target,out);
    const observedSigned=safeRead(target,150,1800);
    verifyV2HpcReceipt({envelope:JSON.parse(observedSigned.toString('utf8')),
     expectedHost:host,receiptBytes,witnessBytes,publicKey:receiptPublicKey,
     now:now()});
    if(inserted)created++;else reconciled++;
   }
   return Object.freeze({host,selected:selected.length,created,reconciled,waiting,
    productionV2:false,chatGPTOAuthAttested:false});
  }
 });
}
