import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const G=1024n**3n;
export const TEN_GIB=10n*G;
const PEERS=new Set(['PC','Linux','EmadServer','Amirreza']);
const str=v=>typeof v==='string'&&v.length>0;
export function evaluateLargeTransfer({bytes,freeBytes,pendingBytes=0n,maxSourceBytes=16n*G,maxPendingBytes=64n*G,activeJobs=0,maxActiveJobs=3,role='send',backendCompatible=true}){
  if(typeof bytes!=='bigint'||bytes<=0n||!['send','receive'].includes(role))throw Error('INVALID_PREFLIGHT_REQUEST');
  if([freeBytes,pendingBytes,maxSourceBytes,maxPendingBytes].some(x=>typeof x!=='bigint'||x<0n))throw Error('INVALID_PREFLIGHT_STORAGE');
  if(!Number.isSafeInteger(activeJobs)||activeJobs<0||!Number.isSafeInteger(maxActiveJobs)||maxActiveJobs<1)throw Error('INVALID_PREFLIGHT_CONCURRENCY');
  // Conservative per-device estimate only: sender stages locally and publishes to its pair folder;
  // receiver may need Syncthing incoming temp + completed payload + a separate final copy.
  const multiplier=role==='receive'?3n:2n;
  const reservedBytes=bytes*multiplier+pendingBytes+2n*G;
  const checks={
    configuredFileSize:bytes<=maxSourceBytes,
    pendingCapacity:pendingBytes+bytes<=maxPendingBytes,
    singleLargeJobSlot:activeJobs<maxActiveJobs,
    diskHeadroom:freeBytes>=reservedBytes,
    compatibleDurableBackend:backendCompatible
  };
  return {safeToAttempt:Object.values(checks).every(Boolean),checks,reservedBytes,role,networkValidated:false,
    note:'Read-only local preflight, not a reservation. Run on BOTH sender and receiver; network throughput is not assessed.'};
}

function opt(a,k,def){const i=a.indexOf('--'+k);return i<0?def:a[i+1];}
function readJournal(root){
  let pending=0n,active=0;
  const jobs=path.join(root,'jobs');
  if(!fs.existsSync(jobs))return {pending,active};
  for(const p of fs.readdirSync(jobs,{withFileTypes:true})){
    if(!p.isDirectory()||!PEERS.has(p.name))continue;
    for(const j of fs.readdirSync(path.join(jobs,p.name),{withFileTypes:true})){
      if(!j.name.endsWith('.json'))continue;
      if(!j.isFile()||j.isSymbolicLink())throw Error('UNSAFE_JOB_RECORD');
      const v=JSON.parse(fs.readFileSync(path.join(jobs,p.name,j.name),'utf8'));
      if(!Number.isSafeInteger(v.bytes)||v.bytes<0)throw Error('INVALID_JOB_RECORD');
      if(['PUBLISHED','CANCELLED'].includes(v.status))continue;
      pending+=BigInt(v.bytes);
      if(['QUEUED','COPYING','VERIFYING','CANCEL_REQUESTED'].includes(v.status))active++;
    }
  }
  return {pending,active};
}
function compatible(root){
 const cli=path.join(root,'durable-send.mjs');
 if(!fs.existsSync(cli)||!fs.statSync(cli).isFile())return false;
 try{
   const out=execFileSync(process.execPath,[cli,'capabilities'],{env:{...process.env,COMMANDER_TRANSFER_HOME:root},encoding:'utf8',timeout:4000,maxBuffer:4096,windowsHide:true,stdio:['ignore','pipe','ignore']});
   const v=JSON.parse(out);
   return v.schema==='ctmesh-durable-v1'&&v.contractVersion===2&&v.admissionQuotas===true;
 }catch{return false;}
}
function main(){
 const argv=process.argv.slice(2);
 const root=path.resolve(opt(argv,'root',process.env.COMMANDER_TRANSFER_HOME||
   (process.platform==='win32'?path.join(process.env.LOCALAPPDATA||os.homedir(),'CommanderTransferPilot'):path.join(os.homedir(),'.local/share/commander-transfer-pilot'))));
 const role=opt(argv,'role','send'),peer=opt(argv,'peer'),num=opt(argv,'bytes',TEN_GIB.toString());
 if(!PEERS.has(peer)||!fs.existsSync(root)||!/^[1-9][0-9]*$/.test(num))throw Error('INVALID_PREFLIGHT_ARGUMENTS');
 const bytes=BigInt(num);
 const alias=JSON.parse(fs.readFileSync(path.join(root,'node.json'),'utf8')).alias;
 if(!PEERS.has(alias)||alias===peer)throw Error('PREFLIGHT_PEER_IDENTITY_INVALID');
 const stat=fs.statfsSync(root,{bigint:true}),j=readJournal(root);
 const configMax=BigInt(opt(argv,'max-source-bytes',(16n*G).toString()));
 const configPending=BigInt(opt(argv,'max-pending-bytes',(64n*G).toString()));
 const maxJobs=Number(opt(argv,'max-active-jobs','3'));
 const result=evaluateLargeTransfer({bytes,freeBytes:stat.bavail*stat.bsize,pendingBytes:j.pending,
  maxSourceBytes:configMax,maxPendingBytes:configPending,activeJobs:j.active,maxActiveJobs:maxJobs,role,
  backendCompatible:compatible(root)});
 const response={schema:'ctmesh-large-preflight-v1',alias,peer,root,bytes:bytes.toString(),
   freeBytes:(stat.bavail*stat.bsize).toString(),pendingBytes:j.pending.toString(),
   reservedBytes:result.reservedBytes.toString(),safeToAttempt:result.safeToAttempt,
   checks:result.checks,networkValidated:false,warning:result.note};
 console.log(JSON.stringify(response));
 if(!response.safeToAttempt)process.exitCode=2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main()}catch(e){console.error('CTMESH_PREFLIGHT_ERROR:'+String(e.message||e));process.exitCode=1;}
}
