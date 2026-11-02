// V2 compute-only candidate. Pure, bounded deterministic computation only.
// No shell, filesystem, browser, desktop, user-selected executable or network
// entrypoint. An independently authenticated trusted RPC client must be
// injected by the native owner worker; this module does NOT establish identity.
// The coordinator owns immutable fenced artifact publication.
import {createHash} from 'node:crypto';
import {normalizeV2Route} from './v2-routing-contract.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
function validateJob(job){
 if(!job||typeof job!=='object'||Array.isArray(job)||
    Object.getPrototypeOf(job)!==Object.prototype||
    Object.keys(job).sort().join(',')!=='kind,limit,schema'||
    job.schema!==1||job.kind!=='prime-statistics'||
    !Number.isSafeInteger(job.limit)||job.limit<2||job.limit>50000)
   fail('V2_COMPUTE_JOB_NOT_ALLOWLISTED');
 return Object.freeze({schema:1,kind:'prime-statistics',limit:job.limit});
}
function calculate(route,job){
 const composite=new Uint8Array(job.limit+1);
 let count=0,sum=0;
 for(let n=2;n<=job.limit;n++){
  if(composite[n])continue;
  count++;sum+=n;
  if(n*n<=job.limit)for(let j=n*n;j<=job.limit;j+=n)composite[j]=1;
 }
 return Object.freeze({schema:1,operationId:route.operationId,
  kind:job.kind,limit:job.limit,count,sum});
}
const hash=data=>createHash('sha256').update(data,'utf8').digest('hex');
export function createV2ComputeOnlyWorker({coordinator}={}){
 if(!coordinator||['withFencedLease','createPrivateArtifact','observePrivateArtifact']
   .some(k=>typeof coordinator[k]!=='function'))
   fail('V2_COMPUTE_TRUSTED_COORDINATOR_REQUIRED');
 return Object.freeze({
  async execute({route,job}={}){
   const r=normalizeV2Route(route);
   if(r.target.kind!=='workflow-root')fail('V2_COMPUTE_WORKFLOW_ROOT_REQUIRED');
   const task=validateJob(job);
   const result=calculate(r,task);
   const content=JSON.stringify(result);
   const digest=hash(content);
   // Route-specific immutable artifact ID. Same operation with changed inputs
   // must fail on digest mismatch instead of overwriting a prior receipt.
   const receiptId='compute-'+hash(JSON.stringify([
    r.hostId,r.principalId,r.profileId,r.conversationId,r.operationId])).slice(0,48);
   const answer=await coordinator.withFencedLease({route:r,run:async({lease,assertCurrent})=>{
    await assertCurrent();
    const existing=await coordinator.observePrivateArtifact({route:r,receiptId});
    if(existing.committed){
     if(existing.digest!==digest)fail('V2_COMPUTE_RECEIPT_CONFLICT');
     return {status:'RECONCILED',receiptId,digest,result};
    }
    await assertCurrent();
    try{
     const effect=await coordinator.createPrivateArtifact({
      route:r,lease,receiptId,content
     });
     if(effect.committed!==true||effect.digest!==digest||
        effect.receiptId!==receiptId)fail('V2_COMPUTE_RECEIPT_INVALID');
     return {status:effect.replayed?'REPLAYED':'COMMITTED',receiptId,digest,result};
    }catch(error){
     // A lost acknowledgment can follow an actual immutable commit. Observe
     // once under the same authenticated route, never replay the mutation.
     if(error?.code!=='V2_RPC_CLIENT_DELIVERY_UNCERTAIN')throw error;
     const observed=await coordinator.observePrivateArtifact({route:r,receiptId});
     if(observed.committed&&observed.digest===digest)
      return {status:'RECONCILED',receiptId,digest,result};
     throw error;
    }
   }});
   return Object.freeze({...answer,result});
  }
 });
}
