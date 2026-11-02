// Linux native AT-SPI provider for the existing V2 window Bridge and hybrid
// driver. Construct only inside an attested owner worker. No public RPC/tool
// registration, browser session reuse, foreground input or privilege elevation.
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HELPER=fileURLToPath(new URL('../tools/owner-atspi-semantic.py',import.meta.url));
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const deny=/password|passcode|secret|credential|token|api[\s_-]*key|credit.card/i;
const validId=v=>typeof v==='string'&&ID.test(v)&&v!=='.'&&v!=='..';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const roleName=r=>r==='push button'?'button':r==='entry'||r==='text'?'textbox':r==='search box'?'searchbox':r==='combo box'?'combobox':r==='check box'?'checkbox':r;
function targetRecord(x,id){
 if(!x||typeof x!=='object'||Array.isArray(x)||x.targetId!==id||
    !validId(x.targetId)||!validId(x.hostId)||!validId(x.principalId)||
    !validId(x.seatId)||!validId(x.windowHandle)||!validId(x.processStartId)||
    !Number.isSafeInteger(x.pid)||x.pid<=0||x.present!==true||
    typeof x.applicationName!=='string'||x.applicationName.length<1||x.applicationName.length>128||
    typeof x.windowTitle!=='string'||x.windowTitle.length<1||x.windowTitle.length>300||
    typeof x.processStartTicks!=='string'||!/^[0-9]{1,24}$/.test(x.processStartTicks))
  fail('V2_ATSPI_TARGET_UNVERIFIED');
 return Object.freeze({...x});
}
function sameTarget(a,b){
 return a.targetId===b.targetId&&a.hostId===b.hostId&&
  a.principalId===b.principalId&&a.seatId===b.seatId&&
  a.pid===b.pid&&a.windowHandle===b.windowHandle&&
  a.processStartId===b.processStartId&&a.applicationName===b.applicationName&&
  a.windowTitle===b.windowTitle&&a.processStartTicks===b.processStartTicks;
}
/** Direct bounded helper call; environment is supplied by trusted owner-worker.
 * Only DISPLAY and DBUS_SESSION_BUS_ADDRESS for the selected seat, not from RPC.
 */
export function createV2AtspiTransport({ownerEnvironment,python='/usr/bin/python3',timeoutMs=6000}={}){
 if(process.platform!=='linux'||!ownerEnvironment||
    typeof ownerEnvironment.DISPLAY!=='string'||!ownerEnvironment.DISPLAY||
    typeof ownerEnvironment.DBUS_SESSION_BUS_ADDRESS!=='string'||!ownerEnvironment.DBUS_SESSION_BUS_ADDRESS||
    !Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>15000)
   fail('V2_ATSPI_TRANSPORT_OWNER_SESSION_REQUIRED');
 const env={
  PATH:'/usr/bin:/bin',HOME:process.env.HOME??'',USER:process.env.USER??'',
  DISPLAY:ownerEnvironment.DISPLAY,
  DBUS_SESSION_BUS_ADDRESS:ownerEnvironment.DBUS_SESSION_BUS_ADDRESS,
  NO_AT_BRIDGE:'0',
  ...(ownerEnvironment.XDG_RUNTIME_DIR?{XDG_RUNTIME_DIR:ownerEnvironment.XDG_RUNTIME_DIR}:{}),
  ...(ownerEnvironment.GTK_MODULES?{GTK_MODULES:ownerEnvironment.GTK_MODULES}:{})
 };
 return async request=>new Promise((resolve,reject)=>{
  const child=spawn(python,[HELPER],{env,stdio:['pipe','pipe','pipe'],windowsHide:true});
  let out='',err='',done=false,expired=false;
  const timer=setTimeout(()=>{expired=true;child.kill('SIGKILL')},timeoutMs);
  child.stdout.on('data',b=>{out+=b.toString('utf8');if(out.length>45000)child.kill('SIGKILL')});
  child.stderr.on('data',b=>{err=(err+b.toString('utf8')).slice(-240)});
  child.on('error',e=>{if(!done){done=true;clearTimeout(timer);reject(e)}});
  child.on('close',code=>{
   clearTimeout(timer);if(done)return;done=true;
   if(expired)return reject(Object.assign(new Error('V2_ATSPI_HELPER_TIMEOUT'),{code:'V2_ATSPI_HELPER_TIMEOUT'}));
   let output;
   try{output=JSON.parse(out.trim())}catch{return reject(Object.assign(new Error('V2_ATSPI_HELPER_JSON_INVALID'),{code:'V2_ATSPI_HELPER_JSON_INVALID'}))}
   if(code!==0||output?.ok!==true)
    return reject(Object.assign(new Error(String(output?.error??'V2_ATSPI_HELPER_FAILED')),{
     code:'V2_ATSPI_HELPER_FAILED'
    }));
   resolve(output);
  });
  child.stdin.on('error',()=>{});
  child.stdin.end(JSON.stringify(request));
 });
}
/** Reuse this provider across observe and subsequent actions inside ONE
 * authorized owner seat; never persist element selectors in a chat response.
 * resolveTarget and independentProof are injected by the trusted owner worker.
 */
export function createV2LinuxAtspiProvider({
 resolveTarget,transport,independentProof,now=()=>Date.now(),elementTtlMs=20000
}={}){
 if(typeof resolveTarget!=='function'||typeof transport!=='function'||
    (independentProof!==undefined&&typeof independentProof!=='function')||
    typeof now!=='function'||!Number.isSafeInteger(elementTtlMs)||elementTtlMs<1000||elementTtlMs>60000)
   fail('V2_ATSPI_PROVIDER_CONTRACT_INVALID');
 let target=null;
 const elements=new Map();
 const expire=()=>{for(const [id,e] of elements){if(now()>e.expiresAt)elements.delete(id)}};
 async function resolve(targetId){
  if(!validId(targetId)||target&&target.targetId!==targetId)
   fail('V2_ATSPI_TARGET_CHANGED');
  const result=targetRecord(await resolveTarget(targetId),targetId);
  if(target&&!sameTarget(target,result))fail('V2_ATSPI_TARGET_CHANGED');
  target??=result;
  return result;
 }
 function request(t,command,additional={}){
  return {command,pid:t.pid,windowTitle:t.windowTitle,
   expectedApp:t.applicationName,expectedStartTicks:t.processStartTicks,...additional};
 }
 async function nativeSnapshot(t){
  const result=await transport(request(t,'snapshot'));
  if(!result||result.ok!==true||!Array.isArray(result.controls)||
    result.controls.length>80||result.valuesRead!==false)
   fail('V2_ATSPI_SNAPSHOT_INVALID');
  return result;
 }
 function eligible(c,kind){
  if(!c||!Array.isArray(c.path)||!c.path.length||c.path.length>18||
     !c.path.every(n=>Number.isInteger(n)&&n>=0&&n<60)||
     typeof c.role!=='string'||typeof c.name!=='string'||
     c.name.length<2||c.name.length>160||deny.test(c.name)||
     [...c.name].some(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)===127))
   return false;
  if(kind==='type')return c.editable===true&&
   ['entry','text','search box','combo box'].includes(c.role);
  if(kind==='invoke')return c.role==='check box'?c.action==='check':
   ['button','push button'].includes(c.role)&&['click','press'].includes(c.action);
  return eligible(c,'type')||eligible(c,'invoke');
 }
 function getElement(id){
  expire();
  const e=elements.get(id);
  if(!e||!target||!sameTarget(target,e.target)||e.attempted===true)
   fail('V2_ATSPI_ELEMENT_UNBOUND');
  return e;
 }
 async function assertFresh(t,e){
  const snap=await nativeSnapshot(t);
  const matches=snap.controls.filter(c=>eligible(c,e.kind)&&
   c.role===e.role&&c.name===e.name&&c.action===e.action&&
   JSON.stringify(c.path)===JSON.stringify(e.path));
  if(matches.length!==1)fail('V2_ATSPI_ELEMENT_CHANGED');
 }
 function forDescriptor(d){
  // Hybrid NativeDriver deliberately copies native observations; validate
  // its exact identity rather than relying on the source object's WeakMap.
  if(!d||!target||d.targetId!==target.targetId||d.hostId!==target.hostId||
     d.principalId!==target.principalId||d.seatId!==target.seatId||
     d.pid!==target.pid||d.windowHandle!==target.windowHandle||
     d.processStartId!==target.processStartId||d.present!==true)
   fail('V2_ATSPI_DESCRIPTOR_UNBOUND');
  return target;
 }
 return Object.freeze({
  async probe({targetId,action,elementId}){
   if(!['observe','invoke','type'].includes(action))fail('V2_ATSPI_ACTION_UNSUPPORTED');
   const t=await resolve(targetId);
   if(action==='observe'){await nativeSnapshot(t);}
   else{
    expire();
    const e=elements.get(elementId);
    if(!e||!sameTarget(t,e.target))fail('V2_ATSPI_ELEMENT_UNBOUND');
    if(e.kind!==action)fail('V2_ATSPI_ELEMENT_ACTION_MISMATCH');
    // After an effect has been attempted, a vanished button is normal.
    // Never re-probe or attempt a different native method post-dispatch.
    if(!e.attempted)await assertFresh(t,e);
   }
   return {supported:true,targetBound:true};
  },
  async observe(targetId){
   const t=await resolve(targetId);
   // Observed identity is supplied by the owner resolver and independently
   // checked again by native AT-SPI on every actual helper call.
   const result=Object.freeze({
    targetId:t.targetId,hostId:t.hostId,principalId:t.principalId,
    seatId:t.seatId,pid:t.pid,windowHandle:t.windowHandle,
    processStartId:t.processStartId,present:true
   });
   return result;
  },
  async readAccessibility({descriptor,maxElements=64}={}){
   const t=forDescriptor(descriptor);
   const snap=await nativeSnapshot(t);
   elements.clear(); // prior selectors revoked after AX refresh
   const accepted=[];
   for(const c of snap.controls){
    if(accepted.length>=Math.min(maxElements,64))break;
    if(!eligible(c,'observe'))continue;
    const kind=eligible(c,'invoke')?'invoke':'type',id=randomUUID();
    elements.set(id,{target:t,kind,role:c.role,name:c.name,
     path:Object.freeze([...c.path]),action:c.action,expiresAt:now()+elementTtlMs,
     attempted:false});
    accepted.push({id,role:roleName(c.role),name:c.name,enabled:true});
   }
   return {elements:accepted,truncated:snap.truncated===true||
    snap.controls.length>accepted.length};
  },
  async authorizeElement({descriptor,elementId,action}){
   const t=forDescriptor(descriptor);
   const e=getElement(elementId);
   if(e.kind!==action)return false;
   await assertFresh(t,e);
   return true;
  },
  async apply({descriptor,elementId,action,text}){
   const t=forDescriptor(descriptor);
   const e=getElement(elementId);
   if(e.kind!==action)fail('V2_ATSPI_ELEMENT_ACTION_MISMATCH');
   if(action==='type'&&(typeof text!=='string'||!text.length||text.length>1024||
    text.includes('\0')))fail('V2_ATSPI_TEXT_INVALID');
   await assertFresh(t,e);
   e.attempted=true; // ambiguous native result may already have applied input
   const payload={path:e.path,expectedRole:e.role,expectedName:e.name,
    ...(action==='type'?{text}:{})};
   const result=await transport(request(t,action==='type'?'type':'invoke',payload));
   if(result?.effect!=='DISPATCHED')fail('V2_ATSPI_EFFECT_UNCONFIRMED');
   return {dispatched:true}; // NOT independent verification
  },
  async verify({descriptor,elementId,action}){
   const t=forDescriptor(descriptor);
   const e=elements.get(elementId);
   if(!e||e.kind!==action||!e.attempted||typeof independentProof!=='function')
    return false;
   // The independently observed postcondition is supplied by the owner
   // process, never by caller-provided JSON or AT-SPI "DISPATCHED".
   return (await independentProof({target:t,action,elementId}))===true;
  }
 });
}
