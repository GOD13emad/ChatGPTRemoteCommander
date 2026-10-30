// V2-R3: approved-worker RPC adapter to the ONE central coordinator.
// The endpoint MUST be a preexisting owner-local authenticated tunnel's
// 127.0.0.1 forward. This adapter never creates or exposes a network tunnel.
// A client-supplied principal/header is NEVER proof of ChatGPT identity.
import {assertV2CallerBinding} from './v2-routing-contract.mjs';

const TRUSTED_LOOPBACK=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/;
const TOKEN=/^[A-Za-z0-9_-]{43,128}$/;
const ERROR=/^(?:V2_COORDINATOR_|V2_ROUTE_|V2_RPC_)[A-Z0-9_]+$/;
const RECEIPT_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RECEIPT_SHA=/^[a-f0-9]{64}$/;
function validReceipt(receiptId,digest){
 if(typeof receiptId!=='string'||!RECEIPT_ID.test(receiptId)||
    (digest!==undefined&&(typeof digest!=='string'||!RECEIPT_SHA.test(digest))))
   fail('V2_RPC_CLIENT_INVALID_RECEIPT');
}
function fail(code) {throw Object.assign(new Error(code),{code});}
function validateEndpoint(endpoint){
 if(typeof endpoint!=='string')fail('V2_RPC_CLIENT_LOOPBACK_ONLY');
 const port=TRUSTED_LOOPBACK.exec(endpoint)?.[1];
 if(!port||Number(port)>65535)fail('V2_RPC_CLIENT_LOOPBACK_ONLY');
 return endpoint;
}
function validateLease(lease){
 if(!lease||typeof lease!=='object'||Array.isArray(lease)||
    typeof lease.id!=='string'||!/^[a-f0-9-]{36}$/.test(lease.id)||
    !Number.isSafeInteger(lease.fence)||lease.fence<1||
    typeof lease.resource!=='string'||lease.resource.length>500||
    !Number.isSafeInteger(lease.expiresAtMs)||lease.expiresAtMs<0)
    fail('V2_RPC_CLIENT_INVALID_LEASE');
 return Object.freeze({id:lease.id,fence:lease.fence,
   resource:lease.resource,expiresAtMs:lease.expiresAtMs});
}
function validatedTtl(ttlMs){
 if(!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>60000)
  fail('V2_RPC_CLIENT_INVALID_TTL');
 return ttlMs;
}
export function createV2CoordinatorRpcClient({
  endpoint, tokenProvider, observedCaller, fetchImpl=globalThis.fetch,
  timeoutMs=5000
}={}){
 const target=validateEndpoint(endpoint);
 if(typeof tokenProvider!=='function'||typeof observedCaller!=='function'||
    typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||
    timeoutMs<300||timeoutMs>10000)
    fail('V2_RPC_CLIENT_TRUSTED_BOOTSTRAP_REQUIRED');
 async function request(action,input){
  const route=assertV2CallerBinding(input.route,await observedCaller());
  const token=await tokenProvider();
  if(typeof token!=='string'||!TOKEN.test(token))
   fail('V2_RPC_CLIENT_PRIVATE_CREDENTIAL_REQUIRED');
  const payload={route};
  if(input.receiptId!==undefined)payload.receiptId=input.receiptId;
  if(input.digest!==undefined)payload.digest=input.digest;
  if(input.lease!==undefined)payload.lease=validateLease(input.lease);
  if(input.ttlMs!==undefined)payload.ttlMs=validatedTtl(input.ttlMs);
  let res;
  try{
   res=await fetchImpl(target+'/v2/lease/'+action,{
    method:'POST',redirect:'error',cache:'no-store',
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(timeoutMs)
   });
  }catch{
   // If acquire/release had an unknown acknowledgement, do not mint
   // a different operation id or retry blindly.
   fail('V2_RPC_CLIENT_DELIVERY_UNCERTAIN');
  }
  let result;
  try{
   if(!res||typeof res.status!=='number'||res.status<200||res.status>=600)
    throw Error('invalid response');
   const raw=await res.text();
   if(raw.length>2048)throw Error('oversized response');
   result=JSON.parse(raw);
  }catch{fail('V2_RPC_CLIENT_INVALID_RESPONSE');}
  if(res.status!==200){
   const err=typeof result?.error==='string'&&ERROR.test(result.error)
      ?result.error:'V2_RPC_CLIENT_REMOTE_DENIED';
   fail(err);
  }
  if(result?.ok!==true||!Object.hasOwn(result,'value'))
   fail('V2_RPC_CLIENT_INVALID_RESPONSE');
  if(action==='assert'||action==='release'){
   if(typeof result.value!=='boolean')fail('V2_RPC_CLIENT_INVALID_RESPONSE');
   return result.value;
  }
  if(action==='commit-receipt'||action==='get-receipt'){
   const value=result.value;
   if(action==='get-receipt'&&value===null)return null;
   if(!value||typeof value!=='object'||value.committed!==true||
      typeof value.receiptId!=='string'||!RECEIPT_ID.test(value.receiptId)||
      typeof value.digest!=='string'||!RECEIPT_SHA.test(value.digest)||
      !Number.isSafeInteger(value.fence)||value.fence<1||
      (action==='commit-receipt'&&typeof value.replayed!=='boolean')||
      value.receiptId!==input.receiptId||
      (action==='commit-receipt'&&(value.digest!==input.digest||
        value.fence!==input.lease.fence)))
      fail('V2_RPC_CLIENT_INVALID_RESPONSE');
   return Object.freeze({...value});
  }
  const lease=validateLease(result.value);
  if(input.lease && action==='renew' &&
    (lease.resource!==input.lease.resource||lease.id!==input.lease.id||
     lease.fence!==input.lease.fence))
    fail('V2_RPC_CLIENT_INVALID_RESPONSE');
  return lease;
 }
 return Object.freeze({
  acquire:async({route,ttlMs=30000})=>request('acquire',{route,ttlMs}),
  renew:async({route,lease,ttlMs=30000})=>request('renew',{route,lease,ttlMs}),
  assertCurrent:async({route,lease})=>{
   const current=await request('assert',{route,lease});
   if(current!==true)fail('V2_COORDINATOR_STALE_LEASE');
   return true;
  },
  release:async({route,lease})=>request('release',{route,lease}),
  commitFencedReceipt:async({route,lease,receiptId,digest})=>{
   validReceipt(receiptId,digest);
   if(digest===undefined)fail('V2_RPC_CLIENT_INVALID_RECEIPT');
   return request('commit-receipt',{route,lease,receiptId,digest});
  },
  getFencedReceipt:async({route,receiptId})=>{
   validReceipt(receiptId);
   return request('get-receipt',{route,receiptId});
  },
  withFencedLease:async({route,ttlMs=30000,run})=>{
   if(typeof run!=='function')fail('V2_RPC_CLIENT_RUN_REQUIRED');
   const lease=await request('acquire',{route,ttlMs});
   try{
    const assertCurrent=async()=>{
     const result=await request('assert',{route,lease});
     if(result!==true)fail('V2_COORDINATOR_STALE_LEASE');
     return true;
    };
    await assertCurrent();
    const result=await run(Object.freeze({lease,resource:lease.resource,assertCurrent}));
    await assertCurrent();
    return result;
   }finally{
    // Do not hide execution or uncertain delivery failure; failed release is
    // safely bounded by TTL and requires explicit reconciliation.
    try{await request('release',{route,lease});}catch{}
   }
  }
 });
}
