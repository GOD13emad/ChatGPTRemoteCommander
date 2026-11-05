// V2-G2: owner-process-only, short-lived ChatGPT conversation to OS seat binding.
// This table is deliberately non-durable. Restart loses all bindings and requires
// new platform attestation and explicit native owner consent; it does NOT replace
// OAuth validation, V2GrantRegistry or WorkflowStore's machine-global leases.
// Never call bindTrusted from the model, arbitrary HTTP body, or MCP tool args.
import { normalizeV2Route } from './v2-routing-contract.mjs';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const valid=v=>typeof v==='string'&&ID.test(v)&&v!=='.'&&v!=='..';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function createV2NativeOwnerSessionBindings({
  attestPlatformSession,resolveOwnerRoute,observedNativeSession,
  authorizeBinding,authorizeRevocation,now=Date.now,
  ttlMs=300000,maxBindings=256
}={}){
  if([attestPlatformSession,resolveOwnerRoute,observedNativeSession,
      authorizeBinding,authorizeRevocation,now].some(v=>typeof v!=='function')
    ||!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>3600000
    ||!Number.isSafeInteger(maxBindings)||maxBindings<1||maxBindings>10000)
    fail('V2_SESSION_OWNER_BOOTSTRAP_REQUIRED');
  const active=new Map();
  function timestamp(){
    const t=now();
    if(!Number.isSafeInteger(t))fail('V2_SESSION_CLOCK_INVALID');
    return t;
  }
  async function trustedState(handle){
    const route=normalizeV2Route(await resolveOwnerRoute(handle));
    const seat=await observedNativeSession(route);
    if(!valid(seat))fail('V2_SESSION_NATIVE_SEAT_REQUIRED');
    return Object.freeze({route,seat});
  }
  function expire(handle,record,t){
    if(record.expiresAtMs<=t){if(active.get(handle)===record)active.delete(handle);
      fail('V2_SESSION_BINDING_EXPIRED');}
  }
  return Object.freeze({
    async bindTrusted(platformProof){
      // Callback verifies an independent ChatGPT transport/session proof,
      // then supplies the canonical session handle. No caller assertion here.
      const handle=await attestPlatformSession(platformProof);
      if(!valid(handle))fail('V2_SESSION_PLATFORM_ATTESTATION_REQUIRED');
      const first=await trustedState(handle),start=timestamp();
      if(active.has(handle)){
        const existing=active.get(handle);
        if(existing.expiresAtMs>start)fail('V2_SESSION_BINDING_EXISTS');
        active.delete(handle);
      }
      const approved=await authorizeBinding(Object.freeze({
        sessionHandle:handle,route:first.route,osSessionId:first.seat
      }));
      if(approved!==true)fail('V2_SESSION_OWNER_CONSENT_REQUIRED');
      // The trusted source and OS seat might change while consent awaits.
      const second=await trustedState(handle),end=timestamp();
      if(!same(first.route,second.route)||first.seat!==second.seat)
        fail('V2_SESSION_BINDING_CHANGED_DURING_CONSENT');
      if(active.has(handle))fail('V2_SESSION_BINDING_EXISTS');
      // Expired entries must not exhaust finite owner-side session capacity.
      for(const [oldHandle,oldRecord] of active)
        if(oldRecord.expiresAtMs<=end)active.delete(oldHandle);
      if(active.size>=maxBindings)fail('V2_SESSION_CAPACITY_REACHED');
      if(!Number.isSafeInteger(end+ttlMs))
        fail('V2_SESSION_CLOCK_INVALID');
      const record=Object.freeze({
        route:second.route,seat:second.seat,expiresAtMs:end+ttlMs
      });
      active.set(handle,record);
      return Object.freeze({sessionHandle:handle,expiresAtMs:record.expiresAtMs});
    },
    async resolveNativeRoute(sessionHandle){
      if(!valid(sessionHandle))fail('V2_SESSION_HANDLE_REQUIRED');
      const record=active.get(sessionHandle);
      if(!record)fail('V2_SESSION_NOT_BOUND');
      expire(sessionHandle,record,timestamp());
      let observed;
      try{observed=await trustedState(sessionHandle);}
      catch{if(active.get(sessionHandle)===record)active.delete(sessionHandle);
        fail('V2_SESSION_TRUST_LOST');}
      if(active.get(sessionHandle)!==record)
        fail('V2_SESSION_BINDING_REVOKED');
      expire(sessionHandle,record,timestamp());
      if(!same(observed.route,record.route)||observed.seat!==record.seat){
        active.delete(sessionHandle);fail('V2_SESSION_TRUST_LOST');
      }
      return record.route;
    },
    async revokeTrusted({sessionHandle,adminProof}={}){
      if(!valid(sessionHandle))fail('V2_SESSION_HANDLE_REQUIRED');
      const record=active.get(sessionHandle);
      if(!record)return false;
      if(await authorizeRevocation(Object.freeze({
        sessionHandle,route:record.route,adminProof
      }))!==true)fail('V2_SESSION_REVOKE_AUTH_REQUIRED');
      if(active.get(sessionHandle)!==record)fail('V2_SESSION_BINDING_CHANGED');
      active.delete(sessionHandle);
      return true;
    },
    get size(){return active.size;},
    close(){active.clear();}
  });
}
