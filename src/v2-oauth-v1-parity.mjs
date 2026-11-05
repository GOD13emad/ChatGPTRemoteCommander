// Isolated candidate for authenticated ChatGPT V2 -> existing V1 tools.
// Not imported by the live noauth pilot. Requires an independently verified
// OAuth JWT, native chat+OS session assertion, a scoped durable grant and an
// existing machine-global lease/receipt store before ANY local V1 dispatch.
import {createHash} from 'node:crypto';
import {createV2OAuthObservedCaller} from './v2-oauth-caller.mjs';
import {executeV2BoundOperation} from './v2-authorized-operation.mjs';
import {normalizeV2Route,v2OperationKey} from './v2-routing-contract.mjs';
import {v2ActionDigest} from './v2-caller-assertion.mjs';
import {classifyV2V1ShellResult} from './v2-v1-result-classifier.mjs';
import {createV2V1LocalOwnerGateway} from './v2-v1-local-owner-gateway.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code})};
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function validRecord(v){return v!==null&&typeof v==='object'&&!Array.isArray(v)
 &&[Object.prototype,null].includes(Object.getPrototypeOf(v));}
const TOOL=/^[a-z][a-z0-9_]{0,79}$/;
const HEADER=/^Bearer [A-Za-z0-9._~+\/=:-]+$/;
function deterministicV1RequestId(route){
 // Derive a stable V1 mutation key from the separately attested complete
 // native route, never from a caller-supplied requestId or OAuth bearer.
 const hex=createHash('sha256').update(v2OperationKey(route)).digest('hex');
 return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+
  '-8'+hex.slice(17,20)+'-'+hex.slice(20,32);
}
export function createV2OAuthV1Parity({
 issuer,audience,requiredScopes=['commander.full'],
 verifyAccessToken,resolvePrincipal,resolveTrustedInvocation,
 assertionTrust,observedNativeSession,grantRegistry,
 withLease,receiptStore,localGateway,now=Date.now
}={}){
 if(typeof issuer!=='string'||!issuer.startsWith('https://')||
    typeof audience!=='string'||!audience.startsWith('https://')||
    !Array.isArray(requiredScopes)||requiredScopes.length<1||
    requiredScopes.length>32||new Set(requiredScopes).size!==requiredScopes.length||
    requiredScopes.some(s=>typeof s!=='string'||!ID.test(s))||
    [verifyAccessToken,resolvePrincipal,resolveTrustedInvocation,
     observedNativeSession,withLease,now].some(fn=>typeof fn!=='function')||
    !assertionTrust||typeof assertionTrust!=='object'||
    !grantRegistry||typeof grantRegistry.isAllowed!=='function'||
    !receiptStore||typeof receiptStore.execute!=='function'||
    !localGateway||typeof localGateway.call!=='function')
   fail('V2_AUTH_PARITY_TRUSTED_BOOTSTRAP_REQUIRED');
 const scopes=Object.freeze([...requiredScopes]);
 async function validateBearer(authorization){
  if(typeof authorization!=='string'||authorization.length>8192||
      !HEADER.test(authorization))fail('V2_AUTH_PARITY_BEARER_REQUIRED');
  const claims=await verifyAccessToken(authorization.slice(7));
  const time=now();
  if(!validRecord(claims)||!Number.isSafeInteger(time)||
      !Number.isSafeInteger(claims.expiresAtMs)||
      !Number.isSafeInteger(claims.notBeforeMs)||
      claims.notBeforeMs>time||claims.expiresAtMs<=time||
      claims.issuer!==issuer||claims.audience!==audience||
      typeof claims.subject!=='string'||!ID.test(claims.subject)||
      !Array.isArray(claims.scopes)||!scopes.every(s=>claims.scopes.includes(s)))
   fail('V2_AUTH_PARITY_TOKEN_NOT_AUTHORIZED');
  const principal=await resolvePrincipal(claims.subject);
  if(typeof principal!=='string'||!ID.test(principal))
   fail('V2_AUTH_PARITY_PRINCIPAL_UNVERIFIED');
  return principal;
 }
 return Object.freeze({
  async call({authorization,tool,args}={}){
   if(typeof tool!=='string'||!TOOL.test(tool)||!validRecord(args))
    fail('V2_AUTH_PARITY_ACTION_INVALID');
   // Canonical digest validates payload and bounds it before consulting any
   // host native route or owner-session authority.
   v2ActionDigest(tool,args);
   const principal=await validateBearer(authorization);
   const intended=Object.freeze({tool,arguments:structuredClone(args)});
   // No bearer, caller-selected principal, or arbitrary route in this call.
   // The resolver MUST use trusted platform-attested conversation context.
   const attested=await resolveTrustedInvocation(intended);
   if(!validRecord(attested)||Object.keys(attested).length!==2||
     !Object.hasOwn(attested,'route')||!Object.hasOwn(attested,'assertion'))
    fail('V2_AUTH_PARITY_NATIVE_SESSION_REQUIRED');
   const route=normalizeV2Route(attested.route);
   if(route.principalId!==principal)
    fail('V2_AUTH_PARITY_PRINCIPAL_MISMATCH');
   const observed=createV2OAuthObservedCaller({
    route,tool,args,assertion:attested.assertion,assertionTrust,
    readAuthorization:async()=>authorization,
    verifyAccessToken,resolvePrincipal,observedNativeSession,
    issuer,audience,requiredScopes:scopes,now
   });
   let firstCallOutput;
   // The durable receipt contains ONLY a bounded completion summary.
   // Raw Shell output, document contents, browser state and user data are
   // returned transiently on the first authenticated call, NEVER persisted.
   const limitedReceiptStore=Object.freeze({
    execute:async(info,effect)=>{
     const receipt=await receiptStore.execute(info,async()=>{
      firstCallOutput=await effect();
      return Object.freeze({
       receiptVersion:1,privateOutputStored:false,
       toolReturned:true,isError:firstCallOutput?.isError===true,
       ...(tool==='run_shell'
        ?{shellCompletion:classifyV2V1ShellResult(firstCallOutput)}:{})
      });
     });
     if(firstCallOutput!==undefined)return firstCallOutput;
     // A duplicated operation must NOT cause a second read or mutation.
     return Object.freeze({
      isError:receipt.isError===true,cachedReceipt:true,
      content:Object.freeze([{type:'text',
       text:'Operation already recorded; private output was not retained.'}]),
      structuredContent:Object.freeze({
       receiptVersion:1,privateOutputStored:false,
       ...(receipt.shellCompletion!==undefined
        ?{shellCompletion:receipt.shellCompletion}:{})
      })
     });
    }
   });
   return executeV2BoundOperation(route,{
    observedCaller:observed,
    hasGrant:async(r,t)=>grantRegistry.isAllowed(r,t)===true,
    withLease,receiptStore:limitedReceiptStore,
    execute:async(r,approvedArgs)=>{
     const result=await localGateway.call({
      tool,args:approvedArgs,requestId:deterministicV1RequestId(r)
     });
     // Only the transient owner-authenticated response receives private
     // V1 output; the durable receipt holds bounded completion metadata.
     return result.result;
    }
   },tool,args);
  }
 });
}


// Trusted native V2 owner worker composition. Unlike arbitrary injection of
// localGateway, this factory always enforces a fresh positive asynchronous
// native-owner proof before V1 catalog lookup and physical tools/call.
//
// rpc and attestLocalOwner are supplied ONLY by the local owner process; never
// pass them through an MCP/HTTP request or model-provided action. Neither OAuth
// verification nor native user consent can be replaced by this gate alone.
export function createV2OAuthV1NativeParity({
 rpc,attestLocalOwner,...authenticatedOptions
}={}){
 if(typeof rpc!=='function'||typeof attestLocalOwner!=='function'||
    Object.hasOwn(authenticatedOptions,'localGateway')||
    Object.hasOwn(authenticatedOptions,'newId'))
   fail('V2_AUTH_PARITY_NATIVE_BOOTSTRAP_REQUIRED');
 return createV2OAuthV1Parity({
  ...authenticatedOptions,
  localGateway:createV2V1LocalOwnerGateway({rpc,attestLocalOwner})
 });
}
