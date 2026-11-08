// V1-01 candidate adapter: authenticated OAuth + independent owner session +
// revocable, argument-scoped grant → V1 protected Router callbacks.
// Does not create an HTTP listener, alter installed routes or authorize a model
// to bind a conversation. The host must configure the real IdP and native owner
// attestation separately; passing an MCP body/header as binding is NOT valid.
import {createHash,randomBytes} from 'node:crypto';
import {isProxy} from 'node:util/types';
import {normalizeV2Route} from './v2-routing-contract.mjs';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TOOL=/^[a-z][a-z0-9_]{0,79}$/;
// Opaque random owner-issued consent epoch; rotate on EVERY revoke/regrant.
const BINDING_ID=/^[0-9a-f]{32,64}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const validId=s=>typeof s==='string'&&ID.test(s)&&s!=='.'&&s!=='..';
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(x));
// JSON.stringify conflates +0 and -0. The raw Router invocation is still
// forwarded to its destination, so compare exact primitive values and own
// data descriptors rather than an ambiguous serialized representation.
// Inputs here are normalized routes or bounded frozen JSON snapshots only.
function same(a,b){
  if(Object.is(a,b))return true;
  if(typeof a!==typeof b||a===null||b===null||
     typeof a!=='object'||Array.isArray(a)!==Array.isArray(b))
    return false;
  const aKeys=Reflect.ownKeys(a),bKeys=Reflect.ownKeys(b);
  if(aKeys.length!==bKeys.length)return false;
  for(let i=0;i<aKeys.length;i++){
    if(aKeys[i]!==bKeys[i])return false;
    const ad=Object.getOwnPropertyDescriptor(a,aKeys[i]);
    const bd=Object.getOwnPropertyDescriptor(b,bKeys[i]);
    if(!ad||!bd||!Object.hasOwn(ad,'value')||!Object.hasOwn(bd,'value')||
       !same(ad.value,bd.value))return false;
  }
  return true;
}
// Authorize an immutable, independently copied JSON tree. The Router forwards
// its original raw body: a shallow freeze would allow owner-policy callbacks
// to mutate nested arguments and approve a DIFFERENT payload than forwarded.
// Bounded depth, nodes AND serialized UTF-8 bytes: the Router can also be
// called by non-HTTP adapters, so it must not rely only on V2 ingress body caps.
// Snapshotting avoids cycles, accessors and mutation of owner-policy inputs.
const MAX_ARGUMENT_BYTES=65536;
function countJsonBytes(budget,value){
  // Prevent constructing a very large escaped JSON string to measure it.
  if(typeof value==='string'&&value.length>MAX_ARGUMENT_BYTES)
    fail('V101_ROUTER_ARGUMENTS_BOUNDS');
  budget.bytes-=Buffer.byteLength(JSON.stringify(value),'utf8');
  if(budget.bytes<0)fail('V101_ROUTER_ARGUMENTS_BOUNDS');
}
function frozenJsonSnapshot(value,depth=0,budget={left:8192,bytes:MAX_ARGUMENT_BYTES}){
  if(--budget.left<0||depth>32)fail('V101_ROUTER_ARGUMENTS_BOUNDS');
  // Proxies can report safe own descriptors while exposing different values
  // to the downstream tool. Only literal data-only JSON containers qualify.
  if(isProxy(value))fail('V101_ROUTER_ARGUMENTS_NOT_JSON');
  if(value===null||typeof value==='string'||typeof value==='boolean'){
    countJsonBytes(budget,value);
    return value;
  }
  if(typeof value==='number'&&Number.isFinite(value)){
    countJsonBytes(budget,value);
    return value;
  }
  if(Array.isArray(value)){
    if(Object.getPrototypeOf(value)!==Array.prototype
      ||value.length>budget.left
      ||Object.keys(value).length!==value.length
      ||Reflect.ownKeys(value).length!==value.length+1)
      fail('V101_ROUTER_ARGUMENTS_NOT_JSON');
    // [value,value,...] brackets and separators are serialized bytes too.
    budget.bytes-=2+Math.max(0,value.length-1);
    if(budget.bytes<0)fail('V101_ROUTER_ARGUMENTS_BOUNDS');
    const out=[];
    for(let i=0;i<value.length;i++){
      const item=Object.getOwnPropertyDescriptor(value,String(i));
      if(!item||!Object.hasOwn(item,'value'))
        fail('V101_ROUTER_ARGUMENTS_NOT_JSON');
      out.push(frozenJsonSnapshot(item.value,depth+1,budget));
    }
    return Object.freeze(out);
  }
  if(!record(value))fail('V101_ROUTER_ARGUMENTS_NOT_JSON');
  const fields=Object.keys(value);
  // Object.keys omits non-enumerable and Symbol own properties, but the
  // original tool receives them: any such discrepancy must fail closed.
  if(fields.length>budget.left)fail('V101_ROUTER_ARGUMENTS_BOUNDS');
  if(Reflect.ownKeys(value).length!==fields.length)
    fail('V101_ROUTER_ARGUMENTS_NOT_JSON');
  // { "key":value, ... }: braces + one colon per field + commas.
  budget.bytes-=2+fields.length+Math.max(0,fields.length-1);
  if(budget.bytes<0)fail('V101_ROUTER_ARGUMENTS_BOUNDS');
  const out=Object.create(null);
  for(const key of fields){
    if(key==='__proto__'||key==='constructor'||key==='prototype')
      fail('V101_ROUTER_ARGUMENTS_UNSAFE_KEY');
    countJsonBytes(budget,key);
    const item=Object.getOwnPropertyDescriptor(value,key);
    if(!item||!Object.hasOwn(item,'value'))
      fail('V101_ROUTER_ARGUMENTS_NOT_JSON');
    out[key]=frozenJsonSnapshot(item.value,depth+1,budget);
  }
  return Object.freeze(out);
}

/**
 * The owner-only resolveAttestedTokenBinding MUST read an independently
 * authenticated, short-lived digest→chat mapping, created AFTER trusted mTLS
 * (or a separately authenticated tunnel edge) and native owner authorization.
 * It may NEVER infer a chat from OAuth sub, request headers or MCP arguments.
 * Each independent owner approval MUST issue a new random bindingId; reusing
 * the same id on regrant is forbidden, even for the same token/chat/expiry.
 * The production auth provider and owner approval are deliberately NOT
 * bootstrapped here. No external callers may invoke binding mutation.
 */
export function createV101ProtectedRouterBridge({
  hostId,profileId,issuer,audience,
  verifyAccessToken,resolvePrincipal,resolveAttestedTokenBinding,
  nativeSessionBindings,grantRegistry,authorizeExactInvocation,
  now=Date.now,maxTickets=256,ticketTtlMs=30000
}={}){
  if(!validId(hostId)||!validId(profileId)
    ||typeof issuer!=='string'||!issuer.startsWith('https://')
    ||typeof audience!=='string'||!audience.startsWith('https://')
    ||[verifyAccessToken,resolvePrincipal,resolveAttestedTokenBinding,
       authorizeExactInvocation,now].some(x=>typeof x!=='function')
    ||typeof nativeSessionBindings?.resolveNativeRoute!=='function'
    ||typeof grantRegistry?.isAllowed!=='function'
    ||!Number.isSafeInteger(maxTickets)||maxTickets<1||maxTickets>4096
    ||!Number.isSafeInteger(ticketTtlMs)||ticketTtlMs<1000||ticketTtlMs>120000)
    fail('V101_ROUTER_BRIDGE_TRUSTED_BOOTSTRAP_REQUIRED');
  const tickets=new Map();
  let closed=false;
  const clock=()=>{
    const t=now();
    if(!Number.isSafeInteger(t)||t<0)fail('V101_ROUTER_BRIDGE_CLOCK_INVALID');
    return t;
  };
  const dropExpired=t=>{
    for(const [key,entry] of tickets)
      if(entry.expiresAtMs<=t)tickets.delete(key);
  };
  async function verifyCaller(token){
    // A token is not a chat identity. It is first signed/validated by the IdP,
    // and only then matched to an independently owner-attested session.
    if(closed||typeof token!=='string'||token.length<16||token.length>16384)
      return null;
    try{
      const t=clock();
      const claims=await verifyAccessToken(token);
      if(!record(claims))return null;
      // Capture verified claims BEFORE awaiting any other provider callback.
      // A shared mutable verifier object must not extend its signed expiry
      // or replace the authenticated subject while the Router is suspended.
      const signedIssuer=claims.issuer;
      const signedAudience=claims.audience;
      const signedSubject=claims.subject;
      const signedNotBeforeMs=claims.notBeforeMs;
      const signedExpiresAtMs=claims.expiresAtMs;
      const signedScopeAllowed=Array.isArray(claims.scopes)
        &&claims.scopes.includes('commander.workflow');
      if(signedIssuer!==issuer||signedAudience!==audience
        ||!validId(signedSubject)
        ||!Number.isSafeInteger(signedNotBeforeMs)
        ||!Number.isSafeInteger(signedExpiresAtMs)
        ||signedNotBeforeMs>t||signedExpiresAtMs<=t
        ||!signedScopeAllowed)return null;
      const principalId=await resolvePrincipal(signedSubject);
      if(!validId(principalId))return null;
      const digest=createHash('sha256').update(token).digest('hex');
      // Only a pre-existing owner-controlled binding can resolve this digest.
      const binding=await resolveAttestedTokenBinding(digest);
      if(!record(binding)||binding.source!=='native-owner-attested'
        ||binding.tokenSha256!==digest||!validId(binding.sessionHandle)
        ||!BINDING_ID.test(binding.bindingId)
        ||!Number.isSafeInteger(binding.expiresAtMs)
        ||binding.expiresAtMs<=t)return null;
      // Capture the exact owner-attestation epoch BEFORE awaiting native OS
      // route lookup. An owner can revoke or replace the binding during this
      // await, even while the OAuth signature remains valid.
      const boundSession=binding.sessionHandle;
      const boundExpiry=binding.expiresAtMs;
      const boundId=binding.bindingId;
      const route=normalizeV2Route(
        await nativeSessionBindings.resolveNativeRoute(boundSession));
      if(route.hostId!==hostId||route.profileId!==profileId
        ||route.principalId!==principalId
        ||route.conversationId!==boundSession)return null;
      // Re-read independently trusted consent immediately before issuing any
      // ticket (including for read-only MCP methods). An exact change to its
      // expiry requires fresh admission, not revival of the stale snapshot.
      const fresh=await resolveAttestedTokenBinding(digest);
      if(!record(fresh)||fresh.source!=='native-owner-attested'
        ||fresh.tokenSha256!==digest||fresh.sessionHandle!==boundSession
        ||fresh.expiresAtMs!==boundExpiry||fresh.bindingId!==boundId)
        return null;
      const admittedAt=clock();
      if(closed||signedExpiresAtMs<=admittedAt||boundExpiry<=admittedAt)return null;
      const expiry=Math.min(signedExpiresAtMs,boundExpiry,
        admittedAt+ticketTtlMs);
      if(expiry<=admittedAt)return null;
      dropExpired(admittedAt);
      // A repeated signed bearer with the SAME freshly attested native
      // route must not consume a new in-flight ticket on every MCP call.
      // Never extend a ticket: the existing expiry must still be within the
      // newly observed OAuth/session limits, or it is discarded.
      for(const [key,old] of tickets){
        if(old.tokenSha256!==digest)continue;
        if(old.sessionHandle===boundSession
          &&old.bindingId===boundId
          &&old.ownerExpiresAtMs===boundExpiry
          &&old.principalId===principalId
          &&old.expiresAtMs<=expiry
          &&old.expiresAtMs>admittedAt
          &&same(old.route,route)){
          return Object.freeze({verified:true,source:'v1-01-trusted-ingress',
            hostId,profileId,principalId,conversationId:route.conversationId,
            expiresAtMs:old.expiresAtMs,ticket:key});
        }
        tickets.delete(key);
      }
      if(tickets.size>=maxTickets)return null;
      const ticket=randomBytes(32).toString('hex');
      const entry=Object.freeze({ticket,tokenSha256:digest,route,
        bindingId:boundId,ownerExpiresAtMs:boundExpiry,
        sessionHandle:boundSession,principalId,expiresAtMs:expiry});
      tickets.set(ticket,entry);
      return Object.freeze({verified:true,source:'v1-01-trusted-ingress',
        hostId,profileId,principalId,conversationId:route.conversationId,
        expiresAtMs:expiry,ticket});
    }catch{return null;}
  }
  async function attestedTokenStillBound(entry){
    // Ticket creation does NOT grant an irrevocable right to use this chat.
    // The independent transport/owner token-to-session link must remain
    // active at every admission boundary, including after async policy calls.
    const current=await resolveAttestedTokenBinding(entry.tokenSha256);
    return record(current)
      &&current.source==='native-owner-attested'
      &&current.tokenSha256===entry.tokenSha256
      &&current.sessionHandle===entry.sessionHandle
      &&current.bindingId===entry.bindingId
      &&Number.isSafeInteger(current.expiresAtMs)
      &&current.expiresAtMs===entry.ownerExpiresAtMs
      &&current.expiresAtMs>clock();
  }
  async function authorizeTool(identity,invocation){
    // This is called by the Router on each operation, not a persistent grant
    // cached during initial bearer validation.
    try{
      if(closed)return false;
      const t=clock();
      if(!record(identity)||identity.verified!==true
        ||identity.source!=='v1-01-trusted-ingress'
        ||typeof identity.ticket!=='string')return false;
      const entry=tickets.get(identity.ticket);
      if(!entry||entry.expiresAtMs<=t){
        if(entry)tickets.delete(identity.ticket);
        return false;
      }
      if(identity.hostId!==hostId||identity.profileId!==profileId
        ||identity.principalId!==entry.principalId
        ||identity.conversationId!==entry.route.conversationId
        ||identity.expiresAtMs!==entry.expiresAtMs)return false;
      if(!record(invocation)||invocation.rpcMethod!=='tools/call'
        ||!TOOL.test(invocation.tool)||!record(invocation.arguments))return false;
      const authorizedTool=invocation.tool;
      const authorizedMethod=invocation.rpcMethod;
      if(!await attestedTokenStillBound(entry))return false;
      const current=normalizeV2Route(
        await nativeSessionBindings.resolveNativeRoute(entry.sessionHandle));
      if(!same(current,entry.route))return false;
      // A broad "tool allowed" grant is insufficient: the owner must verify
      // this exact arguments/resource combination against trusted state.
      if(!grantRegistry.isAllowed(current,authorizedTool))return false;
      const immutableArgs=frozenJsonSnapshot(invocation.arguments);
      if(await authorizeExactInvocation(Object.freeze({...current}),
        Object.freeze({tool:authorizedTool,arguments:immutableArgs}))!==true)
        return false;
      // The caller's original JSON payload may be retained by another async
      // component while owner policy awaits. A copied, frozen policy input
      // alone is insufficient: recheck the exact raw argument value before
      // returning authorization so a TOCTOU mutation cannot change the
      // operation that the Router subsequently dispatches.
      if(!same(frozenJsonSnapshot(invocation.arguments),immutableArgs)
        ||invocation.tool!==authorizedTool
        ||invocation.rpcMethod!==authorizedMethod)return false;
      if(entry.expiresAtMs<=clock())return false;
      // Even a valid native seat cannot authorize a revoked transport-token
      // link. Check this independently after the awaited exact policy.
      if(!await attestedTokenStillBound(entry))return false;
      // Owner may withdraw the native session while argument-level policy
      // awaits. A pre-authorization binding alone is not enough.
      const latest=normalizeV2Route(
        await nativeSessionBindings.resolveNativeRoute(entry.sessionHandle));
      if(!same(latest,entry.route))return false;
      // Native route resolution is itself asynchronous. An owner may revoke
      // consent during that final lookup, after the earlier binding check.
      // Revalidate the independent epoch once more after the lookup; the
      // installed dispatch boundary must separately enforce this epoch.
      if(!await attestedTokenStillBound(entry))return false;
      // No awaited step may change the exact tool/method/payload or actor
      // behind the owner's approval. This final check is immediately before
      // the grant decision; the Router must still dispatch the same payload.
      if(invocation.tool!==authorizedTool
        ||invocation.rpcMethod!==authorizedMethod
        ||!same(frozenJsonSnapshot(invocation.arguments),immutableArgs)
        ||identity.ticket!==entry.ticket
        ||identity.hostId!==hostId||identity.profileId!==profileId
        ||identity.principalId!==entry.principalId
        ||identity.conversationId!==entry.route.conversationId
        ||identity.expiresAtMs!==entry.expiresAtMs)return false;
      // Last awaited owner/native reads may advance time or close the
      // bridge. A once-verified ticket is no longer authority if expired,
      // evicted or explicitly cleared while those reads were in flight.
      if(closed||entry.expiresAtMs<=clock()||tickets.get(entry.ticket)!==entry)
        return false;
      // Check grant revocation AGAIN after async owner policy resolution.
      return grantRegistry.isAllowed(latest,authorizedTool)===true;
    }catch{return false;}
  }
  return Object.freeze({
    verifyCaller,authorizeTool,
    close(){closed=true;tickets.clear();},
    get activeTickets(){
      if(closed)return 0;
      dropExpired(clock());return tickets.size;
    }
  });
}
