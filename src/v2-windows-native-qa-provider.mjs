// Windows owner-worker native QA provider, NOT a public MCP tool.
// Trusted owner session supplies a process-bound window descriptor and separate
// independent postcondition. No global input, coordinates or browser access.
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const validId=x=>typeof x==='string'&&ID.test(x)&&x!=='.'&&x!=='..';
const NUM=/^[1-9][0-9]{0,18}$/;
const same=(a,b)=>a.targetId===b.targetId&&a.hostId===b.hostId&&a.principalId===b.principalId&&
 a.seatId===b.seatId&&a.pid===b.pid&&a.windowHandle===b.windowHandle&&
 a.processStartId===b.processStartId&&a.processStartTicks===b.processStartTicks&&a.windowTitle===b.windowTitle;
function validate(t,id){
 if(!t||t.targetId!==id||!['targetId','hostId','principalId','seatId','windowHandle','processStartId'].every(k=>validId(t[k]))||
 !Number.isSafeInteger(t.pid)||t.pid<1||!NUM.test(t.windowHandle)||
 !NUM.test(t.processStartTicks)||typeof t.windowTitle!=='string'||t.windowTitle.length<4||t.windowTitle.length>180||
 t.present!==true)fail('V2_WIN_OWNER_TARGET_INVALID');
 return Object.freeze({...t});
}
export function createV2WindowsNativeQaTransport({scriptPath,runner='pwsh.exe',timeoutMs=7500}={}){
 if(process.platform!=='win32'||typeof scriptPath!=='string'||!scriptPath.toLowerCase().endsWith('.ps1')||
  !Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>15000)
  fail('V2_WIN_OWNER_WORKER_CONFIG_INVALID');
 return async (mode,input)=>new Promise((resolve,reject)=>{
  if(!['Probe','Invoke'].includes(mode))return reject(Object.assign(new Error('V2_WIN_MODE_INVALID'),{code:'V2_WIN_MODE_INVALID'}));
  const proc=spawn(runner,['-NoLogo','-NoProfile','-NonInteractive','-File',scriptPath,'-Mode',mode],
   {stdio:['pipe','pipe','pipe'],windowsHide:true});
  let out='',err='',done=false,expired=false;
  const timer=setTimeout(()=>{expired=true;proc.kill()},timeoutMs);
  proc.stdout.on('data',b=>{out+=b.toString('utf8');if(out.length>30000)proc.kill()});
  proc.stderr.on('data',b=>{err=(err+b.toString('utf8')).slice(-350)});
  proc.on('error',e=>{if(done)return;done=true;clearTimeout(timer);reject(e)});
  proc.on('close',code=>{
   clearTimeout(timer);if(done)return;done=true;
   if(expired)return reject(Object.assign(new Error('V2_WIN_NATIVE_TIMEOUT'),{code:'V2_WIN_NATIVE_TIMEOUT'}));
   let parsed;try{parsed=JSON.parse(out.trim())}catch{
    return reject(Object.assign(new Error('V2_WIN_NATIVE_RESPONSE_INVALID'),{code:'V2_WIN_NATIVE_RESPONSE_INVALID'}));
   }
   if(code!==0||parsed?.ok!==true)
    return reject(Object.assign(new Error('V2_WIN_NATIVE_UNCONFIRMED'),{code:'V2_WIN_NATIVE_UNCONFIRMED'}));
   resolve(parsed);
  });
  proc.stdin.on('error',()=>{});
  proc.stdin.end(JSON.stringify(input));
 });
}
export function createV2WindowsNativeQaProviders({
 resolveTarget,transport,independentProof,now=()=>Date.now(),ttlMs=20000
}={}){
 if(typeof resolveTarget!=='function'||typeof transport!=='function'||
  independentProof!==undefined&&typeof independentProof!=='function'||
  typeof now!=='function'||!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>60000)
  fail('V2_WIN_PROVIDER_DEPENDENCY_INVALID');
 let current=null;
 const elements=new Map();
 async function target(id){
  if(!validId(id)||current&&current.targetId!==id)fail('V2_WIN_OWNER_CHANGED');
  const t=validate(await resolveTarget(id),id);
  if(current&&!same(t,current))fail('V2_WIN_OWNER_CHANGED');
  current??=t;return t;
 }
 function forDescriptor(d){
  if(!d||!current||d.targetId!==current.targetId||d.hostId!==current.hostId||
   d.principalId!==current.principalId||d.seatId!==current.seatId||
   d.pid!==current.pid||d.windowHandle!==current.windowHandle||
   d.processStartId!==current.processStartId||d.present!==true)
   fail('V2_WIN_DESCRIPTOR_NOT_BOUND');
  return current;
 }
 function request(t,extra={}){
  return {schema:1,pid:t.pid,hwnd:t.windowHandle,startTicks:t.processStartTicks,
   title:t.windowTitle,...extra};
 }
 async function inspect(t){
  const r=await transport('Probe',request(t));
  if(!r||r.ok!==true||r.targetBound!==true||r.win32Bound!==true||
   String(r.pid)!==String(t.pid)||r.hwnd!==t.windowHandle||
   !NUM.test(String(r.elementHandle))||r.role!=='button'||r.name!=='Apply'||
   typeof r.uiaInvokeAvailable!=='boolean')
    fail('V2_WIN_NATIVE_SNAPSHOT_INVALID');
  return r;
 }
 function element(id,{allowAttempted=false}={}){
  const e=elements.get(id);
  if(!e||now()>e.expiresAt||(!allowAttempted&&e.attempted)||!current||!same(e.target,current))
   fail('V2_WIN_ELEMENT_UNBOUND');
  return e;
 }
 const make=method=>({
  async probe({targetId,action,elementId}){
   const t=await target(targetId);
   if(!['observe','invoke','type'].includes(action))fail('V2_WIN_ACTION_INVALID');
   if(action==='type')return {supported:false,targetBound:true};
   const info=await inspect(t);
   if(action==='invoke'){
    const e=element(elementId,{allowAttempted:true});
    if(e.handle!==info.elementHandle)fail('V2_WIN_ELEMENT_CHANGED');
   }
   return {supported:method==='uia'?action==='observe'||info.uiaInvokeAvailable:true,targetBound:true};
  },
  async observe(targetId){
   const t=await target(targetId);
   return Object.freeze({targetId:t.targetId,hostId:t.hostId,principalId:t.principalId,
    seatId:t.seatId,pid:t.pid,windowHandle:t.windowHandle,
    processStartId:t.processStartId,present:true});
  },
  async readAccessibility({descriptor}){
   const t=forDescriptor(descriptor);
   const info=await inspect(t);
   elements.clear(); // revokes old selectors on every accessibility refresh
   const id=randomUUID();
   elements.set(id,{target:t,handle:info.elementHandle,expiresAt:now()+ttlMs,attempted:false});
   return {elements:[{id,role:'button',name:'Apply',enabled:true}],truncated:false};
  },
  async authorizeElement({descriptor,elementId,action}){
   if(action!=='invoke')return false;
   const t=forDescriptor(descriptor),e=element(elementId);
   const info=await inspect(t);
   return e.handle===info.elementHandle&&(method==='win32'||info.uiaInvokeAvailable);
  },
  async apply({descriptor,action,elementId}){
   if(action!=='invoke')fail('V2_WIN_ACTION_NOT_SUPPORTED');
   const t=forDescriptor(descriptor),e=element(elementId);
   const info=await inspect(t);
   if(info.elementHandle!==e.handle||(method==='uia'&&!info.uiaInvokeAvailable))
    fail('V2_WIN_NATIVE_METHOD_UNAVAILABLE');
   e.attempted=true; // no implicit retry if the native effect is ambiguous
   const result=await transport('Invoke',request(t,{elementHandle:e.handle,method}));
   if(result?.effect!=='DISPATCHED'||result.method!==method)
    fail('V2_WIN_NATIVE_EFFECT_UNKNOWN');
   return {dispatched:true};
  },
  async verify({descriptor,action,elementId}){
   const t=forDescriptor(descriptor),e=elements.get(elementId);
   if(!e||!e.attempted||action!=='invoke'||typeof independentProof!=='function')
    return false;
   return (await independentProof({target:t,method,elementId}))===true;
  }
 });
 return Object.freeze({uia:make('uia'),win32:make('win32')});
}
