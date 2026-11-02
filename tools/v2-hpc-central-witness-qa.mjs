// QA cross-host receipt bridge. A ChatGPT-initiated authorized V1 MCP call
// carries each job/receipt; this script NEVER attests ChatGPT identity nor
// dispatches over a production V2 cross-host channel.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {V2CentralCoordinator} from '../src/v2-central-coordinator.mjs';
import {createV2GuardedArtifactActuator} from '../src/v2-guarded-artifact-actuator.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const hosts=['HPC-159-17','HPC-154-66'];
const jobId='centralqa30000_20261102';
const root=path.join(os.homedir(),'.local/state/CommanderV2/QA/central-hpc-e2e-20261102');
function fail(code){throw Object.assign(new Error(code),{code});}
function safeFile(target){
 const st=fs.lstatSync(target);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>4096)
  fail('V2_HPC_WITNESS_FILE_UNSAFE');
 return fs.readFileSync(target,'utf8');
}
function strictFile(target,content){
 if(fs.existsSync(target)){
  if(safeFile(target)!==content)fail('V2_HPC_WITNESS_FILE_CONFLICT');
  return false;
 }
 fs.writeFileSync(target,content,{flag:'wx',mode:0o600});
 return true;
}
function ensurePrivate(p){
 fs.mkdirSync(p,{recursive:true,mode:0o700});
 const st=fs.lstatSync(p);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||
    (st.mode&0o077)!==0)fail('V2_HPC_WITNESS_ROOT_UNTRUSTED');
}
function primeStats(limit){
 let count=0,sum=0;
 for(let n=2;n<=limit;n++){
  let prime=true;
  for(let f=2;f*f<=n;f++)if(n%f===0){prime=false;break;}
  if(prime){count++;sum+=n;}
 }
 return {count,sum};
}
function exactKeys(o,names){
 return o!==null&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join(',')===names.sort().join(',');
}
const [,,action,host]=process.argv;
if(!['prepare','seal','verify'].includes(action)||!hosts.includes(host)||process.argv.length!==4)
 fail('V2_HPC_WITNESS_COMMAND_UNSUPPORTED');
if(process.platform!=='linux'||process.getuid?.()===0)
 fail('V2_HPC_WITNESS_OWNER_LINUX_ONLY');
ensurePrivate(root);
const requests=path.join(root,'requests');
const evidence=path.join(root,'remote-evidence');
ensurePrivate(requests);ensurePrivate(evidence);
const request={schema:1,operationId:jobId,kind:'prime-statistics',limit:30000};
const requestText=JSON.stringify(request)+'\n';
const requestPath=path.join(requests,host+'.json');
const evidencePath=path.join(evidence,host+'.json');
const route=Object.freeze({hostId:host,principalId:'mmz-v1-owner-authorized-qa',
 profileId:'v1-routed',conversationId:'qa-compute-bridge',
 operationId:jobId,target:Object.freeze({kind:'workflow-root',id:'local-compute'})});
const coordinator=new V2CentralCoordinator({
 directory:path.join(root,'central-qa-coordinator'),
 authorizeLease:async r=>JSON.stringify(r)===JSON.stringify(route),
 resolveGlobalResource:async()=> 'hpc-centralqa-'+host,
 requireGlobalResource:true
});
try{
 const actuator=createV2GuardedArtifactActuator({coordinator});
 const receiptId='remote-'+jobId;
 if(action==='prepare'){
  const created=strictFile(requestPath,requestText);
  console.log(JSON.stringify({status:created?'PREPARED':'PREPARED_RECONCILED',
   host,jobId,jobSha256:sha(requestText),qa:true}));
 }else{
  if(safeFile(requestPath)!==requestText)fail('V2_HPC_WITNESS_REQUEST_MISMATCH');
  const evidenceText=safeFile(evidencePath);
  let r;try{r=JSON.parse(evidenceText);}catch{fail('V2_HPC_WITNESS_INVALID_JSON')}
  if(!exactKeys(r,['schema','host','scope','result','inputSha256','digest'])||
     r.schema!==1||r.host!==host||
     r.scope!=='V1_LOCAL_OWNER_QUEUE_NOT_CENTRAL_V2'||
     r.inputSha256!==sha(requestText)||
     !exactKeys(r.result,['schema','operationId','kind','limit','count','sum'])||
     r.result.schema!==1||r.result.operationId!==jobId||
     r.result.kind!=='prime-statistics'||r.result.limit!==30000||
     r.digest!==sha(JSON.stringify(r.result)))
   fail('V2_HPC_WITNESS_REMOTE_RECEIPT_INVALID');
  const checked=primeStats(30000);
  if(r.result.count!==checked.count||r.result.sum!==checked.sum)
   fail('V2_HPC_WITNESS_INDEPENDENT_COMPUTE_MISMATCH');
  // No claims about cryptographic origin of V1 MCP metadata. The operator
  // only supplies a manually received, authenticated-channel QA receipt.
  const witness={schema:1,host,scope:'QA_V1_MCP_OBSERVED_LOCAL_HPC_EFFECT',
    requestedJobSha256:sha(requestText),remoteReceiptFileSha256:sha(evidenceText),
    result:r.result,resultDigest:r.digest,
    coordinatorIdentity:'MMZ_LOCAL_QA_NOT_PRODUCTION',
    chatGPTOAuthAttested:false,centrallyEnrolledWorker:false};
  const artifactText=JSON.stringify(witness);
  const digest=sha(artifactText);
  if(action==='seal'){
   let observed=await actuator.observe({route,receiptId});
   if(observed.committed){
    if(observed.digest!==digest)fail('V2_HPC_WITNESS_IMMUTABLE_CONFLICT');
    console.log(JSON.stringify({status:'SEALED_RECONCILED',host,count:checked.count,
      sum:checked.sum,receiptId,digest:observed.digest,fence:observed.fence}));
   }else{
    const accepted=await coordinator.withFencedLease({route,run:async({lease,assertCurrent})=>{
     await assertCurrent();
     return actuator.create({route,lease,receiptId,content:artifactText});
    }});
    if(accepted.committed!==true||accepted.digest!==digest)
      fail('V2_HPC_WITNESS_COORDINATOR_REJECTED');
    console.log(JSON.stringify({status:'CENTRAL_QA_SEALED',host,count:checked.count,
      sum:checked.sum,receiptId,digest:accepted.digest,fence:accepted.fence}));
   }
  }else{
   const seen=await actuator.observe({route,receiptId});
   if(seen.committed!==true||seen.digest!==digest||seen.fence<1)
    fail('V2_HPC_WITNESS_CENTRAL_INTEGRITY_FAILED');
   console.log(JSON.stringify({status:'INDEPENDENT_CENTRAL_QA_VERIFIED',
    host,count:checked.count,sum:checked.sum,digest:seen.digest,
    fence:seen.fence,remoteReceiptFileSha256:sha(evidenceText),qa:true}));
  }
 }
}finally{coordinator.close()}
