// Native-only V2 compute admission boundary, not an MCP/HTTP/CLI endpoint.
// An independently installed/attested owner worker must inject both callbacks.
// This source does not confer any authority, OAuth identity or network access.
import {normalizeV2Route} from './v2-routing-contract.mjs';
import {createHash} from 'node:crypto';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEX=/^[a-f0-9]{64}$/;
function fail(code){throw Object.assign(new Error(code),{code});}
function plain(o){
 return o!==null&&typeof o==='object'&&!Array.isArray(o)&&
  (Object.getPrototypeOf(o)===Object.prototype||Object.getPrototypeOf(o)===null);
}
function exact(o,keys){
 return plain(o)&&Object.keys(o).length===keys.length&&
  Object.keys(o).every(k=>keys.includes(k));
}
function jobSpec(job){
 if(!exact(job,['schema','kind','limit'])||
    job.schema!==1||job.kind!=='prime-statistics'||
    !Number.isSafeInteger(job.limit)||job.limit<2||job.limit>50000)
   fail('V2_COMPUTE_ADMISSION_JOB_NOT_ALLOWED');
 return Object.freeze({schema:1,kind:'prime-statistics',limit:job.limit});
}
const hash=x=>createHash('sha256').update(x,'utf8').digest('hex');
function routeIdentity(r){return JSON.stringify([
 r.hostId,r.principalId,r.profileId,r.conversationId,r.operationId,
 r.target.kind,r.target.id
]);}
export function createV2ComputeOnlyOwnerGateway({
 worker,resolveAttestedRoute,authorizeNativeCompute
}={}){
 if(typeof worker?.execute!=='function'||
    typeof resolveAttestedRoute!=='function'||
    typeof authorizeNativeCompute!=='function')
  fail('V2_COMPUTE_ADMISSION_TRUSTED_BOOTSTRAP_REQUIRED');
 return Object.freeze({
  // Caller may submit only an operation ID and a bounded task, never a route,
  // principal, host, workflow target, bearer, path, shell, GUI or browser action.
  async execute(request){
   if(!exact(request,['operationId','job'])||
      typeof request.operationId!=='string'||!ID.test(request.operationId))
    fail('V2_COMPUTE_ADMISSION_REQUEST_INVALID');
   const job=jobSpec(request.job);
   // Resolve solely from owner-observed/attested state. A model-supplied
   // route or a self-asserted "approved" flag is never consulted.
   const first=normalizeV2Route(await resolveAttestedRoute());
   if(first.operationId!==request.operationId||
      first.target.kind!=='workflow-root')
    fail('V2_COMPUTE_ADMISSION_ROUTE_NOT_ATTESTED');
   const decision=await authorizeNativeCompute(Object.freeze({route:first,job}));
   if(decision!==true)fail('V2_COMPUTE_ADMISSION_OWNER_DENIED');
   // Native owner consent may have waited while the platform binding changed.
   const second=normalizeV2Route(await resolveAttestedRoute());
   if(routeIdentity(first)!==routeIdentity(second))
    fail('V2_COMPUTE_ADMISSION_BINDING_CHANGED');
   const output=await worker.execute({route:second,job});
   // A successful callback alone is not an independently observed effect.
   const expectedId='compute-'+hash(JSON.stringify([
    second.hostId,second.principalId,second.profileId,
    second.conversationId,second.operationId])).slice(0,48);
   const result=output?.result;
   if(!plain(output)||!['COMMITTED','REPLAYED','RECONCILED'].includes(output.status)||
      output.receiptId!==expectedId||
      typeof output.digest!=='string'||!HEX.test(output.digest)||
      !exact(result,['schema','operationId','kind','limit','count','sum'])||
      result.schema!==1||result.operationId!==second.operationId||
      result.kind!==job.kind||result.limit!==job.limit||
      !Number.isSafeInteger(result.count)||result.count<0||
      !Number.isSafeInteger(result.sum)||result.sum<0||
      hash(JSON.stringify(result))!==output.digest)
    fail('V2_COMPUTE_ADMISSION_RESULT_INVALID');
   return Object.freeze({status:output.status,receiptId:output.receiptId,
    digest:output.digest,result:Object.freeze({
     schema:1,kind:job.kind,limit:job.limit,
     operationId:second.operationId,
     count:output.result.count,sum:output.result.sum
    })});
  }
 });
}
