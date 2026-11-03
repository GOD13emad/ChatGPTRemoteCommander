// Owner-worker-only composition for exact-window native controls.
// This module does not discover user sessions, request consent, grant actions,
// spawn drivers or use global keyboard/mouse input. Create ONE instance per
// authorized V2 operation; all providers are trusted, injected OS adapters.
const ORDER=Object.freeze({
 windows:Object.freeze(['uia','win32','cua']),
 linux:Object.freeze(['atspi','cua'])
});
const ACTIONS=new Set(['observe','invoke','type']);
const FUNCTIONS=['probe','observe','readAccessibility','authorizeElement','apply','verify'];
const fail=code=>{throw Object.assign(new Error(code),{code});};
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x)&&x!=='.'&&x!=='..';
const isRecord=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)
 &&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);

/**
 * Native capability is checked for the exact target/element/action BEFORE any
 * effect. Only an explicit read-only {supported:false} permits trying the next
 * provider. Failure, ambiguous probe, changed selection or unknown effect
 * NEVER triggers another input method. Driver callbacks must independently
 * enforce owner/session identity, target membership, and element semantics.
 *
 * UIA->Win32 covers controls with no InvokePattern (e.g. guarded BM_CLICK).
 * AT-SPI->targeted CUA is available only when native semantics are unsupported.
 * Portal input is deliberately NOT an implicit semantic fallback: native OS
 * session consent and shared-desktop input are different capabilities.
 */
export function createV2HybridNativeDriver({platform,action,elementId,providers}={}){
 if(!Object.hasOwn(ORDER,platform)||!ACTIONS.has(action)
    ||(action==='observe'&&elementId!==undefined)
    ||(action!=='observe'&&!validId(elementId))
    ||!isRecord(providers)
    ||Object.keys(providers).some(name=>!ORDER[platform].includes(name)))
   fail('V2_HYBRID_DRIVER_CONFIG_INVALID');
 for(const p of Object.values(providers)){
  if(!isRecord(p)||FUNCTIONS.some(key=>typeof p[key]!=='function'))
   fail('V2_HYBRID_PROVIDER_CONTRACT_INVALID');
 }
 let selected=null,target=null,effectStarted=false;
 const owned=new WeakMap();
 async function check(method,targetId){
  const result=await providers[method].probe({targetId,action,elementId});
  if(!isRecord(result)||typeof result.supported!=='boolean')
   fail('V2_HYBRID_PROBE_UNVERIFIED');
  if(!result.supported)return false;
  if(result.targetBound!==true)
   fail('V2_HYBRID_TARGET_NOT_BOUND');
  if(method==='cua'&&result.backgroundTargeted!==true)
   fail('V2_HYBRID_CUA_NOT_TARGETED');
  return true;
 }
 async function observe(targetId){
  if(!validId(targetId))fail('V2_HYBRID_TARGET_INVALID');
  if(target!==null&&target!==targetId)fail('V2_HYBRID_TARGET_CHANGED');
  target=targetId;
  if(selected===null){
   for(const method of ORDER[platform]){
    if(providers[method]&&await check(method,targetId)){
     selected=method;break;
    }
   }
   if(selected===null)fail('V2_HYBRID_NO_SUPPORTED_METHOD');
  }else if(!await check(selected,targetId)){
   fail('V2_HYBRID_SELECTED_METHOD_LOST');
  }
  const original=await providers[selected].observe(targetId);
  if(!isRecord(original)||original.targetId!==targetId)
   fail('V2_HYBRID_OBSERVATION_UNVERIFIED');
  const descriptor=Object.freeze({...original});
  owned.set(descriptor,selected);
  return descriptor;
 }
 function providerFor(descriptor){
  if(!descriptor||typeof descriptor!=='object'||!owned.has(descriptor)
    ||owned.get(descriptor)!==selected)
   fail('V2_HYBRID_DESCRIPTOR_UNBOUND');
  return providers[selected];
 }
 return Object.freeze({
  observe,
  async readAccessibility(args){
   const p=providerFor(args?.descriptor);
   return p.readAccessibility(args);
  },
  async authorizeElement(args){
   const p=providerFor(args?.descriptor);
   return p.authorizeElement(args);
  },
  async apply(args){
   const p=providerFor(args?.descriptor);
   if(action==='observe'||args.action!==action||args.elementId!==elementId)
    fail('V2_HYBRID_ACTION_MISMATCH');
   if(effectStarted)fail('V2_HYBRID_EFFECT_ALREADY_ATTEMPTED');
   effectStarted=true; // A rejected/ambiguous attempt is never replayed.
   return p.apply(args);
  },
  async verify(args){
   const p=providerFor(args?.descriptor);
   return (await p.verify(args))===true;
  },
  selectedMethod:()=>selected
 });
}
