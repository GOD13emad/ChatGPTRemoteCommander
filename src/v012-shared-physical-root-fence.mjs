// Opt-in trusted owner/bootstrap adapter. One existing native SQLite lease
// coordinator for both workflow-root routes and durable WorkflowStore calls.
// NOT an owner grant, route-to-root enrollment, or a replacement for the
// installed native OS access checks. No fallback to a per-process mutex.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {normalizeV2Route,v2ResourceLeaseKey} from './v2-routing-contract.mjs';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UNKNOWN=Symbol('UNCERTAIN_OUTCOME_QUARANTINE');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const windows=process.platform==='win32';
function absoluteRoot(root){
  if(typeof root!=='string'||root.length===0||root.length>4096
    ||root.includes('\0')||!path.isAbsolute(root))
    fail('V012_SHARED_ROOT_REQUIRED');
  const normalized=path.resolve(root);
  let actual;
  try{
    actual=fs.realpathSync.native(normalized);
    if(!fs.statSync(actual).isDirectory())fail('V012_SHARED_ROOT_REQUIRED');
  }catch(error){
    if(error?.code?.startsWith('V012_SHARED_'))throw error;
    fail('V012_SHARED_ROOT_NOT_AVAILABLE');
  }
  if((windows?normalized.toLowerCase():normalized)
    !==(windows?actual.toLowerCase():actual))
    fail('V012_SHARED_ROOT_ALIAS_DENIED');
  return actual;
}
function within(root,allowed){
  const rel=path.relative(allowed,root);
  return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));
}
function uncertain(result){
  return result?.outcome==='UNCERTAIN'||result?.operation?.status==='UNCERTAIN';
}
/**
 * Owner bootstrap must provide exactly the SAME host-pinned native lease
 * instance/directory and hostId to all participating Core paths.
 * resolveTrustedRouteRoot must come from native owner project enrollment;
 * never derive a root from caller-supplied target IDs or arguments.
 */
export function createV012SharedPhysicalRootFence({
  nativeHostLease,hostId,allowedRoots,resolveTrustedRouteRoot
}={}){
  if(typeof hostId!=='string'||!ID.test(hostId)
    ||hostId==='.'||hostId==='..'
    ||nativeHostLease?.hostId!==hostId
    ||typeof nativeHostLease.withLease!=='function'
    ||!Array.isArray(allowedRoots)||allowedRoots.length===0
    ||typeof resolveTrustedRouteRoot!=='function')
    fail('V012_SHARED_ROOT_BOOTSTRAP_REQUIRED');
  const roots=Object.freeze(allowedRoots.map(absoluteRoot));
  const scope=new AsyncLocalStorage();
  function rootKey(root){
    const canonical=absoluteRoot(root);
    if(!roots.some(base=>within(canonical,base)))
      fail('V012_SHARED_ROOT_OUTSIDE_ENROLLMENT');
    const hash=createHash('sha256').update(windows?canonical.toLowerCase():canonical).digest('hex');
    return JSON.stringify([1,hostId,'workflow-root',hash]);
  }
  async function withResource(key,work){
    if(typeof work!=='function')fail('V012_SHARED_ROOT_CALLBACK_REQUIRED');
    const active=scope.getStore();
    if(active){
      // AsyncLocalStorage outlives its callback: a deferred child must NOT
      // resurrect a released host-global native lock by inheriting context.
      if(!active.active)fail('V012_SHARED_ROOT_STALE_CONTEXT_DENIED');
      if(active.key!==key)fail('V012_SHARED_ROOT_CROSS_RESOURCE_NESTING_DENIED');
      active.inFlight++;
      try{
        const result=await work(active.leaseContext);
        if(uncertain(result))active.uncertain=true;
        return result;
      }catch(error){
        // A nested failure may already have entered an external effect.
        active.uncertain=true;
        throw error;
      }finally{active.inFlight--;}
    }
    let completedValue;
    const state={key,leaseContext:null,uncertain:false,active:false,inFlight:0};
    try{
      await nativeHostLease.withLease(key, async leaseContext=>{
        if(typeof leaseContext?.markEffectStarted!=='function'
          ||typeof leaseContext?.markSafePreEffectDenial!=='function')
          fail('V012_SHARED_ROOT_NATIVE_CONTEXT_REQUIRED');
        state.leaseContext=leaseContext;
        state.active=true;
        try{
          completedValue=await scope.run(state,()=>work(leaseContext));
          if(state.inFlight!==0){
            // A fire-and-forget descendant may still be mutating the sink:
            // quarantine the native lease even if the outer caller returned.
            leaseContext.markEffectStarted();
            fail('V012_SHARED_ROOT_DETACHED_EFFECT_QUARANTINED');
          }
          if(uncertain(completedValue)||state.uncertain){
            // A successful JavaScript return must NOT release an uncertain
            // native effect. Throw only after retaining its trusted receipt.
            leaseContext.markEffectStarted();
            throw UNKNOWN;
          }
          return completedValue;
        }finally{
          // BEFORE the native callback returns and the database row releases.
          state.active=false;
        }
      });
    }catch(error){
      if(error!==UNKNOWN)throw error;
    }
    return completedValue;
  }
  return Object.freeze({
    async withWorkflowRootLease(root,work){
      return withResource(rootKey(root),work);
    },
    async withDirectRouteLease(route,work){
      const r=normalizeV2Route(route);
      if(r.hostId!==hostId)fail('V012_SHARED_ROOT_HOST_MISMATCH');
      if(r.target.kind!=='workflow-root')
        return withResource(v2ResourceLeaseKey(r),work);
      const root=await resolveTrustedRouteRoot(r);
      return withResource(rootKey(root),work);
    }
  });
}
