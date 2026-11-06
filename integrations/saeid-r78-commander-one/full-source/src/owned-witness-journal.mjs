// Private host-only evidence, NOT a recovered authority or public proof format.
import fs from 'node:fs';import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const digest=/^[a-f0-9]{64}$/,uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const fail=code=>{throw Object.assign(Error(code),{code});};
const canonical=x=>JSON.stringify(x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])):Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):x);
function keys(x,names){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join('|')!==[...names].sort().join('|'))fail('WITNESS_JOURNAL_SCHEMA');}
function nativeIdentity(x){keys(x,['pid','creationFileTime']);if(!Number.isSafeInteger(x.pid)||x.pid<=0||typeof x.creationFileTime!=='string'||!/^[1-9][0-9]{0,19}$/.test(x.creationFileTime))fail('WITNESS_JOURNAL_PROCESS_GENERATION');}
function binding(x){keys(x,['workflowId','stepId','operationId','rootFingerprint','leaseStoreFingerprint','leaseFingerprint','profile','device']);
 if(!uuid.test(x.operationId)||!['rootFingerprint','leaseStoreFingerprint','leaseFingerprint'].every(k=>digest.test(x[k]))
 ||!['workflowId','stepId','profile','device'].every(k=>typeof x[k]==='string'&&x[k].length>0&&x[k].length<=128))fail('WITNESS_JOURNAL_BINDING');}
function witness(x){keys(x,['binding','identity','helperPid','proofDigest','completedUtc','attestationId','nativeStatus','ownedJobTerminated','nativeProof']);binding(x.binding);nativeIdentity(x.identity);
 if(!Number.isSafeInteger(x.helperPid)||x.helperPid<=0||x.helperPid===x.identity.pid||!digest.test(x.proofDigest)||!uuid.test(x.attestationId)
 ||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x.completedUtc)||!Number.isFinite(Date.parse(x.completedUtc))
 ||!/^[A-Z0-9_-]{1,64}$/i.test(x.nativeStatus)||typeof x.ownedJobTerminated!=='boolean')fail('WITNESS_JOURNAL_NATIVE_WITNESS');
 keys(x.nativeProof,['pid','creationFileTime','assignedBeforeResume','cleanupConfirmed','cleanupWin32Error','activeJobProcesses','status','ownedJobTerminated']);
 if(x.nativeProof.pid!==x.identity.pid||x.nativeProof.creationFileTime!==x.identity.creationFileTime||x.nativeProof.assignedBeforeResume!==true
 ||x.nativeProof.cleanupConfirmed!==true||x.nativeProof.cleanupWin32Error!==0||x.nativeProof.activeJobProcesses!==0
 ||x.nativeProof.status!==x.nativeStatus||x.nativeProof.ownedJobTerminated!==x.ownedJobTerminated)fail('WITNESS_JOURNAL_NATIVE_WITNESS');}
export function createOwnedWitnessJournal({directory,pins,hostGeneration,verifyPrivateDirectory,create=false}){
 if(typeof verifyPrivateDirectory!=='function'||typeof directory!=='string'||!path.isAbsolute(directory)||/^(?:\\\\|\/\/)/.test(directory))fail('WITNESS_JOURNAL_PRIVATE_STORAGE_REQUIRED');
 keys(pins,['oracle','nativeRunner','modelContract','nativeHelper','executable','containedActionPolicy']);
 if(!Object.values(pins).every(x=>typeof x==='string'&&digest.test(x)))fail('WITNESS_JOURNAL_DEPENDENCY_PINS');
 nativeIdentity(hostGeneration);pins=structuredClone(pins);hostGeneration=structuredClone(hostGeneration);
 const root=path.resolve(directory),identityFile=path.join(root,'identity.json'),logFile=path.join(root,'witness.jsonl'),lockFile=path.join(root,'writer.lock');
 let closed=false,poisoned=false,identity,heldLock,expectedHead=null,expectedCount=null;
 const readBounded=(file,limit)=>{const fd=fs.openSync(file,'r');try{const pre=fs.fstatSync(fd);
  if(!pre.isFile()||pre.nlink!==1||pre.size>limit)fail('WITNESS_JOURNAL_LIMIT_OR_FILE_TYPE');
  const buffer=Buffer.alloc(pre.size+1);let size=0;
  while(size<buffer.length){const n=fs.readSync(fd,buffer,size,buffer.length-size,size);if(!n)break;size+=n;}
  const post=fs.fstatSync(fd);if(pre.dev!==post.dev||pre.ino!==post.ino||pre.size!==post.size||pre.mtimeMs!==post.mtimeMs||size!==post.size)fail('WITNESS_JOURNAL_CHANGED_DURING_READ');
  return buffer.subarray(0,size);
 }finally{fs.closeSync(fd);}};
 const checkStorage=()=>{
  if(verifyPrivateDirectory(root)!==true)fail('WITNESS_JOURNAL_PRIVATE_STORAGE_UNVERIFIED');
  for(const p of [root,...function*(){let p=path.dirname(root);while(true){yield p;const next=path.dirname(p);if(next===p)break;p=next;}}()])if(fs.lstatSync(p).isSymbolicLink())fail('WITNESS_JOURNAL_ALIAS');
  if(fs.realpathSync.native(root)!==root)fail('WITNESS_JOURNAL_ALIAS');
  for(const name of fs.readdirSync(root)){if(!['identity.json','witness.jsonl','writer.lock'].includes(name))fail('WITNESS_JOURNAL_UNKNOWN_FILE');
   const s=fs.lstatSync(path.join(root,name));if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)fail('WITNESS_JOURNAL_ALIAS');}
 };
 const writeNew=(file,data)=>{const fd=fs.openSync(file,'wx',0o600);try{const bytes=Buffer.from(data,'utf8');if(fs.writeSync(fd,bytes)!==bytes.length)fail('WITNESS_JOURNAL_PARTIAL_WRITE');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 const parse=()=>{try{
  checkStorage();const b=readBounded(identityFile,4096);const id=JSON.parse(b.toString('utf8'));keys(id,['schema','journalId','pins']);
  if(!Buffer.from(b.toString('utf8'),'utf8').equals(b)||canonical(id)!==b.toString('utf8'))fail('WITNESS_JOURNAL_IDENTITY_NONCANONICAL');
  if(id.schema!==1||!uuid.test(id.journalId)||canonical(id.pins)!==canonical(pins)||(identity&&canonical(id)!==canonical(identity)))fail('WITNESS_JOURNAL_IDENTITY_DRIFT');
  const bytes=readBounded(logFile,8*1024*1024);
  const text=bytes.toString('utf8');if(!Buffer.from(text,'utf8').equals(bytes)||(bytes.length&&!text.endsWith('\n')))fail('WITNESS_JOURNAL_PARTIAL_OR_ENCODING');
  const intents=new Map(),witnesses=new Map();let head='0'.repeat(64),count=0;
  for(const line of text?text.slice(0,-1).split('\n'):[]){if(Buffer.byteLength(line)>16384||count>=2000)fail('WITNESS_JOURNAL_LIMIT');const row=JSON.parse(line);keys(row,['schema','journalId','sequence','previous','type','body','hash']);
   if(canonical(row)!==line)fail('WITNESS_JOURNAL_NONCANONICAL_OR_DUPLICATE_KEYS');
   const {hash:given,...payload}=row;
   if(row.schema!==1||row.journalId!==id.journalId||row.sequence!==++count||row.previous!==head||given!==hash(canonical(payload)))fail('WITNESS_JOURNAL_CHAIN');
   if(row.type==='LAUNCH'){
    keys(row.body,['binding','producer','generationId','argsDigest','inputDigest','nativeConfigDigest']);binding(row.body.binding);nativeIdentity(row.body.producer);
    if(!uuid.test(row.body.generationId)||!['argsDigest','inputDigest','nativeConfigDigest'].every(k=>digest.test(row.body[k]))||intents.has(row.body.binding.operationId))fail('WITNESS_JOURNAL_DUPLICATE_OR_LAUNCH');
    intents.set(row.body.binding.operationId,row.body);
   }else if(row.type==='WITNESS'){
    keys(row.body,['operationId','generationId','witness']);const launch=intents.get(row.body.operationId);witness(row.body.witness);
    if(!launch||witnesses.has(row.body.operationId)||row.body.generationId!==launch.generationId||canonical(row.body.witness.binding)!==canonical(launch.binding))fail('WITNESS_JOURNAL_ORDER_OR_BINDING');
    witnesses.set(row.body.operationId,row.body.witness);
   }else fail('WITNESS_JOURNAL_RECORD_TYPE');head=given;
  }
  if(expectedHead!==null&&(head!==expectedHead||count!==expectedCount))fail('WITNESS_JOURNAL_CHANGED_AFTER_COMMIT');
  return {identity:id,intents,witnesses,head,count};
 }catch(error){poisoned=true;throw error;}};
 checkStorage();
 if(create){if(fs.readdirSync(root).length)fail('WITNESS_JOURNAL_CREATE_NOT_EMPTY');
  identity={schema:1,journalId:randomUUID(),pins};writeNew(identityFile,canonical(identity));writeNew(logFile,'');}
 let loaded=parse();identity=loaded.identity;expectedHead=loaded.head;expectedCount=loaded.count;
 const generationId=randomUUID(),lock={journalId:identity.journalId,generationId,producer:hostGeneration};
 writeNew(lockFile,canonical(lock));heldLock=fs.statSync(lockFile);
 const live=()=>{if(closed||poisoned)fail('WITNESS_JOURNAL_CLOSED_OR_POISONED');try{checkStorage();const s=fs.statSync(lockFile);
  if(s.dev!==heldLock.dev||s.ino!==heldLock.ino||readBounded(lockFile,4096).toString('utf8')!==canonical(lock))fail('WITNESS_JOURNAL_WRITER_IDENTITY_CHANGED');
 }catch(error){poisoned=true;throw error;}};
 function append(type,body){live();const state=parse();const payload={schema:1,journalId:identity.journalId,sequence:state.count+1,previous:state.head,type,body};
  const row={...payload,hash:hash(canonical(payload))},bytes=Buffer.from(canonical(row)+'\n','utf8');
  // Every consumed intent reserves one maximum-size terminal row. A known
  // full journal must refuse BEFORE an effect, never discover this afterwards.
  const pending=state.intents.size-state.witnesses.size,maximumTerminalBytes=16385;
  const reservedRows=type==='LAUNCH'?pending+2:pending;
  const requiredBytes=fs.statSync(logFile).size+bytes.length
   +(type==='LAUNCH'?pending+1:Math.max(0,pending-1))*maximumTerminalBytes;
  if(bytes.length>maximumTerminalBytes||state.count+reservedRows>2000||requiredBytes>8*1024*1024)fail('WITNESS_JOURNAL_CAPACITY_BEFORE_WRITE');
  try{const fd=fs.openSync(logFile,'a');try{if(fs.writeSync(fd,bytes)!==bytes.length)fail('WITNESS_JOURNAL_PARTIAL_WRITE');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   expectedCount++;expectedHead=row.hash;loaded=parse();
  }catch(error){poisoned=true;throw error;}
 }
 return Object.freeze({
  recordLaunch(b,{argsDigest,inputDigest,nativeConfigDigest}){binding(b);live();const state=parse();if(state.intents.has(b.operationId))fail('WITNESS_JOURNAL_NO_EXECUTION_REPLAY');
   append('LAUNCH',{binding:structuredClone(b),producer:hostGeneration,generationId,argsDigest,inputDigest,nativeConfigDigest});},
  recordWitness(operationId,record){witness(record);const state=parse(),launch=state.intents.get(operationId);if(state.witnesses.has(operationId))fail('WITNESS_JOURNAL_DUPLICATE_WITNESS');if(!launch||launch.generationId!==generationId)fail('WITNESS_JOURNAL_NO_ORPHAN_ADOPTION');
   append('WITNESS',{operationId,generationId,witness:structuredClone(record)});},
  evidence(operationId){live();const state=parse(),record=state.witnesses.get(operationId);return record?{authorityRestored:false,record:structuredClone(record),journalId:identity.journalId,head:state.head}:null;},
  attemptedOperationIds(){live();return [...parse().intents.keys()];},
  assertCommittedWitness(operationId,record){live();const stored=parse().witnesses.get(operationId);if(!stored||canonical(stored)!==canonical(record))fail('WITNESS_JOURNAL_WITNESS_CHANGED');return true;},
  close(){if(closed)return;live();fs.unlinkSync(lockFile);closed=true;},
  status(){return {authorityRestoration:false,powerLossDurability:'UNPROVEN',journalId:identity.journalId};}
 });
}
