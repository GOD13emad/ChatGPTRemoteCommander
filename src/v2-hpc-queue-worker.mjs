// Bounded native HPC compute-only local queue: one-shot, no shell/GUI/browser/network.
// Local Windows ACL and the currently authorized V1 owner must secure input queue.
// This is not a ChatGPT OAuth attestor or a central V2 Coordinator enrollment.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const HASH=/^[a-f0-9]{64}$/;
const HOSTS=new Set(['HPC-159-17','HPC-154-66']);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const sha=data=>createHash('sha256').update(data).digest('hex');
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
function sameKeys(x,keys){
 return plain(x)&&Object.keys(x).length===keys.length&&
 Object.keys(x).every(k=>keys.includes(k));
}
function safeDirectory(dir,make=false){
 if(typeof dir!=='string'||!path.isAbsolute(dir))fail('V2_HPC_QUEUE_ROOT_INVALID');
 const absolute=path.resolve(dir),p=path.parse(absolute);
 let cursor=p.root;
 for(const segment of absolute.slice(p.root.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,segment);
  if(fs.existsSync(cursor)){
   const st=fs.lstatSync(cursor);
   if(st.isSymbolicLink()||!st.isDirectory())fail('V2_HPC_QUEUE_ALIAS_FORBIDDEN');
  }else if(make){fs.mkdirSync(cursor,{mode:0o700});}
  else fail('V2_HPC_QUEUE_DIR_MISSING');
 }
 return fs.realpathSync.native(absolute);
}
function readJob(filename,id){
 const st=fs.lstatSync(filename);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||
    st.size<20||st.size>512)fail('V2_HPC_QUEUE_JOB_FILE_INVALID');
 const buffer=fs.readFileSync(filename);
 if(buffer.byteLength!==st.size)fail('V2_HPC_QUEUE_JOB_CHANGED');
 let parsed;
 try{parsed=JSON.parse(buffer.toString('utf8'))}
 catch{fail('V2_HPC_QUEUE_JOB_INVALID')}
 if(!sameKeys(parsed,['schema','operationId','kind','limit'])||
    parsed.schema!==1||parsed.operationId!==id||
    parsed.kind!=='prime-statistics'||!Number.isSafeInteger(parsed.limit)||
    parsed.limit<2||parsed.limit>50000)
  fail('V2_HPC_QUEUE_JOB_NOT_ALLOWLISTED');
 return {inputSha256:sha(buffer),job:Object.freeze({
  schema:1,operationId:id,kind:'prime-statistics',limit:parsed.limit
 })};
}
function countPrimes(limit){
 const sieve=new Uint8Array(limit+1);
 let count=0,sum=0;
 for(let n=2;n<=limit;n++){
  if(sieve[n])continue;
  count++;sum+=n;
  if(n*n<=limit)for(let j=n*n;j<=limit;j+=n)sieve[j]=1;
 }
 return {count,sum};
}
function independentPrimes(limit){
 let count=0,sum=0;
 for(let n=2;n<=limit;n++){
  let prime=true;
  for(let i=2;i*i<=n;i++){if(n%i===0){prime=false;break;}}
  if(prime){count++;sum+=n;}
 }
 return {count,sum};
}
function immutableWrite(target,text){
 const tmp=path.join(path.dirname(target),'.'+randomUUID()+'.tmp');
 let fd;
 try{
  fd=fs.openSync(tmp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
  fs.writeFileSync(fd,text,'utf8');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  fs.linkSync(tmp,target);
  return true;
 }catch(error){
  if(error.code==='EEXIST')return false;
  throw error;
 }finally{
  if(fd!==undefined)fs.closeSync(fd);
  if(fs.existsSync(tmp))fs.unlinkSync(tmp);
 }
}
function readReceipt(filename,host,job,inputSha256){
 if(!fs.existsSync(filename))return null;
 const st=fs.lstatSync(filename);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||
   st.size<100||st.size>3000)fail('V2_HPC_QUEUE_RECEIPT_UNSAFE');
 let record;
 try{record=JSON.parse(fs.readFileSync(filename,'utf8'))}
 catch{fail('V2_HPC_QUEUE_RECEIPT_CORRUPT')}
 const expected=Object.freeze({
  schema:1,host,scope:'V1_LOCAL_OWNER_QUEUE_NOT_CENTRAL_V2',
  result:Object.freeze({
   schema:1,operationId:job.operationId,
   kind:'prime-statistics',limit:job.limit,...countPrimes(job.limit)
  }),
  inputSha256
 });
 const resultDigest=sha(JSON.stringify(expected.result));
 if(!sameKeys(record,['schema','host','scope','result','inputSha256','digest'])||
  record.schema!==1||record.host!==expected.host||
  record.scope!==expected.scope||
  record.inputSha256!==inputSha256||record.digest!==resultDigest||
  JSON.stringify(record.result)!==JSON.stringify(expected.result))
  fail('V2_HPC_QUEUE_RECEIPT_CONFLICT');
 return record;
}
export function createV2HpcLocalQueue({root,host}={}){
 if(typeof host!=='string'||!HOSTS.has(host)||typeof root!=='string'||
    !path.isAbsolute(root)||path.basename(root)!=='CommanderV2-ComputeBridge-QA')
  fail('V2_HPC_QUEUE_TRUSTED_HOST_REQUIRED');
 const parent=safeDirectory(root);
 const inbox=safeDirectory(path.join(parent,'compute-inbox'),true);
 const outbox=safeDirectory(path.join(parent,'compute-outbox'),true);
 return Object.freeze({
  run({authorizePendingJob}={}){
   if(authorizePendingJob!==undefined &&
      typeof authorizePendingJob!=='function')
    fail('V2_HPC_QUEUE_SIGNED_AUTHORIZER_INVALID');
   let committed=0,reconciled=0,invalid=0,unsignedRejected=0;
   const listed=fs.readdirSync(inbox).filter(name=>name.endsWith('.json')).sort();
   // Pending first: existing receipts must not permanently starve later jobs
   // once 32 committed entries have accumulated.
   const pending=listed.filter(name=>!fs.existsSync(path.join(outbox,name)));
   const known=listed.filter(name=>fs.existsSync(path.join(outbox,name)));
   const eligible=[];
   const authorizedHashes=new Map();
   // Filter BEFORE slicing; unsigned stale inputs must never starve signed
   // jobs placed later in lexicographic order.
   for(const name of pending){
    const id=name.slice(0,-5);
    if(!ID.test(id)){invalid++;continue;}
    if(authorizePendingJob){
     let record;
     try{record=readJob(path.join(inbox,name),id)}
     catch(e){
      if(['V2_HPC_QUEUE_JOB_FILE_INVALID','V2_HPC_QUEUE_JOB_INVALID',
       'V2_HPC_QUEUE_JOB_NOT_ALLOWLISTED'].includes(e.code)){invalid++;continue;}
      throw e;
     }
     if(!authorizePendingJob(id,record.inputSha256)){
      unsignedRejected++;continue;
     }
     authorizedHashes.set(id,record.inputSha256);
    }
    eligible.push(name);
   }
   const jobs=[...eligible,...known].slice(0,32);
   for(const file of jobs){
    const id=file.slice(0,-5);
    if(!ID.test(id)){invalid++;continue;}
    try{
     const {job,inputSha256}=readJob(path.join(inbox,file),id);
     if(authorizedHashes.has(id)&&authorizedHashes.get(id)!==inputSha256)
      fail('V2_HPC_QUEUE_SIGNED_INPUT_CHANGED');
     const target=path.join(outbox,id+'.json');
     if(readReceipt(target,host,job,inputSha256)){reconciled++;continue;}
     const result={schema:1,operationId:id,kind:job.kind,
      limit:job.limit,...countPrimes(job.limit)};
     const receipt={schema:1,host,scope:'V1_LOCAL_OWNER_QUEUE_NOT_CENTRAL_V2',
      result,inputSha256,digest:sha(JSON.stringify(result))};
     const published=immutableWrite(target,JSON.stringify(receipt)+'\n');
     if(!readReceipt(target,host,job,inputSha256))
      fail('V2_HPC_QUEUE_EFFECT_UNVERIFIED');
     if(published)committed++;else reconciled++;
    }catch(error){
     // Only known invalid input may be skipped. A contradictory/unsafe on-disk
     // effect is a hard stop for operator reconciliation, not silent repair.
     if(['V2_HPC_QUEUE_JOB_FILE_INVALID','V2_HPC_QUEUE_JOB_INVALID',
       'V2_HPC_QUEUE_JOB_NOT_ALLOWLISTED'].includes(error?.code)){invalid++;continue;}
     throw error;
    }
   }
   return Object.freeze({host,processed:jobs.length,committed,reconciled,invalid,
    unsignedRejected,signedPendingEnforced:Boolean(authorizePendingJob),
    productionV2:false});
  },
  verify(operationId){
   if(!ID.test(operationId))fail('V2_HPC_QUEUE_OPERATION_ID_INVALID');
   const input=path.join(inbox,operationId+'.json');
   const {job,inputSha256}=readJob(input,operationId);
   const observed=readReceipt(path.join(outbox,operationId+'.json'),
    host,job,inputSha256);
   if(!observed)fail('V2_HPC_QUEUE_RECEIPT_NOT_FOUND');
   const independent=independentPrimes(job.limit);
   if(observed.result.count!==independent.count||
      observed.result.sum!==independent.sum)
    fail('V2_HPC_QUEUE_INDEPENDENT_VERIFICATION_FAILED');
   return Object.freeze({host,operationId,limit:job.limit,
    ...independent,digest:observed.digest,productionV2:false});
  }
 });
}
