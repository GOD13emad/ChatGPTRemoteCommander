import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { BROWSER_RULES, browserError, browserToolDefinitions, validateBrowserInput } from './browser-contract.mjs';
import { createBrowserProcessClient } from './browser-process.mjs';
import { writeBrowserLeaseMarker, removeBrowserLeaseMarker, reapOrphanedIsolatedBrowserProfiles } from './browser-lease-store.mjs';
export { browserToolDefinitions };

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const chromiumHelper=path.join(project,'tools','browser-control.mjs');
const firefoxHelper=path.join(project,'tools','browser-control-firefox.mjs');
const chromiumClient=createBrowserProcessClient({file:process.execPath,args:[chromiumHelper,'--server']});
const firefoxClient=createBrowserProcessClient({file:process.execPath,args:[firefoxHelper,'--server']});
let defaultBrowserBackend=null;
const isFirefoxExecutable=value=>typeof value==='string'&&/firefox/i.test(path.basename(value));
const defaultInvoke=async req=>{
 const kind=req.action==='status'
  ? (isFirefoxExecutable(req.executable)?'firefox':'chromium')
  : req.action==='start'
    ? (defaultBrowserBackend=isFirefoxExecutable(req.executable)?'firefox':'chromium')
    : (defaultBrowserBackend??'chromium');
 const client=kind==='firefox'?firefoxClient:chromiumClient;
 try{return await client.invoke(req);}
 finally{if(req.action==='end')defaultBrowserBackend=null;}
};
const defaultClose=async()=>{
 defaultBrowserBackend=null;
 const results=await Promise.allSettled([chromiumClient.close(),firefoxClient.close()]);
 if(results.some(x=>x.status==='rejected'))
  throw browserError('BROWSER_DEFAULT_HELPER_CLOSE_FAILED');
};
const sameToken=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const safeSegment=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,31}$/.test(value)?value:'default';
const instanceSegment=value=>{const raw=typeof value==='string'&&value?value:'default';return raw==='default'?'default':'instance-'+Buffer.from(raw,'utf8').toString('hex');};
// A confined Snap Firefox cannot use an arbitrary host-writable profile root.
// Auto-select its writable common directory only for new default-root sessions.
// An explicit configured profileRoot remains authoritative; no profile migration.
export function defaultBrowserProfileRoot({
 platform=process.platform,home=os.homedir(),executable=null,
 localAppData=process.env.LOCALAPPDATA,pathExists=fs.existsSync
}={}){
 if(platform==='win32')return path.join(localAppData||home,'ChatGPTRemoteCommander','browser-profiles');
 const snapCommon=path.join(home,'snap','firefox','common');
 if(platform==='linux'&&isFirefoxExecutable(executable)&&
    pathExists('/snap/bin/firefox')&&pathExists(snapCommon))
  return path.join(snapCommon,'chatgpt-remote-commander','browser-profiles');
 return path.join(home,'.local','state','chatgpt-remote-commander','browser-profiles');
}
function resolveProfileRoot(cfg){
 const raw=typeof cfg.profileRoot==='string'&&cfg.profileRoot.trim()?cfg.profileRoot.trim():defaultBrowserProfileRoot({executable:cfg.executable});
 return path.resolve(raw.replace(/%([^%]+)%/g,(_,k)=>process.env[k]??process.env[k.toUpperCase()]??''));
}
export function reapBrowserOrphans(ctx){
 const cfg=ctx.config?.powerMode?.browserControl??{};
 const root=resolveProfileRoot(cfg),instance=instanceSegment(ctx.config?.instance?.profile??'default');
 return reapOrphanedIsolatedBrowserProfiles({instanceRoot:path.join(root,instance)});
}
export function createBrowserController({invoke=defaultInvoke,closeInvoke=defaultClose,now=()=>performance.now(),wallNow=()=>Date.now(),token=()=>randomBytes(24).toString('hex'),scheduleTimeout=setTimeout,cancelTimeout=clearTimeout}={}){
 let session=null,uncertain=false,timer=null,busy=false,expiryRequested=false,expiredProfile=null;
 const clearTimer=()=>{if(timer)cancelTimeout(timer);timer=null;};
 const cleanupExpired=async()=>{
  if(!expiryRequested||busy)return;
  expiryRequested=false;
  const profile=expiredProfile;expiredProfile=null;
  try{await invoke({action:'end'});if(profile)removeBrowserLeaseMarker(profile);}
  catch{closeInvoke();}
 };
 const expireSession=()=>{
  if(!session)return;
  expiredProfile=session.profileDir;
  session=null;uncertain=false;timer=null;expiryRequested=true;
  if(!busy)queueMicrotask(()=>cleanupExpired().catch(()=>{}));
 };
 const current=()=>{
  if(session&&session.expires<=now())expireSession();
  return session;
 };
 const arm=ttl=>{
  clearTimer();
  timer=scheduleTimeout(expireSession,ttl*1000);
  timer.unref?.();
 };
 const owns=value=>{
  const active=current();
  if(!active||!sameToken(value,active.id))throw browserError('BROWSER_LEASE_REQUIRED_OR_EXPIRED');
 };
 const execute=async(ctx,name,raw={})=>{
  const input=validateBrowserInput(name,raw);
  const cfg=ctx.config?.powerMode?.browserControl??{};
  const enabled=ctx.config?.powerMode?.enabled===true&&cfg.enabled===true;
  if(name==='browser_status'){
   let native={ok:true,available:false,backend:null,active:false};
   try{native=await invoke({action:'status',executable:cfg.executable});}catch(error){native={ok:false,available:false,backend:null,active:false,reason:error.browserCode??'BROWSER_HELPER_UNAVAILABLE'};}
   current();
   return {...native,enabled,busy,leased:!!session,uncertain,policy:{
    backgroundFirst:true,headlessOwnedProfileOnly:true,userDesktopTouchedByDefault:false,
    savedPasswordExtraction:false,userBrowserProfileReuse:false,
    foregroundFallback:'explicit-current-request-only',workflowBrowserAllowed:false,
    allowForegroundFallback:cfg.allowForegroundFallback===true,
    allowNavigate:cfg.allowNavigate===true,allowInput:cfg.allowInput===true,allowScreenshot:cfg.allowScreenshot===true
   }};
  }
  if(!enabled)throw browserError('BROWSER_DISABLED');
  if(busy)throw browserError('BROWSER_BUSY');
  busy=true;
  try{
   if(name==='browser_session_begin'){
    if(current())throw browserError('BROWSER_LEASE_BUSY');
    const ttl=input.ttlSeconds??300,mode=input.mode??'persistent',profile=input.profile??'default';
    const root=resolveProfileRoot(cfg),instance=instanceSegment(ctx.config?.instance?.profile??'default');
    const dir=mode==='isolated'
      ? path.join(root,instance,'isolated-'+Date.now().toString(36)+'-'+token().slice(0,12))
      : path.join(root,instance,safeSegment(profile));
    const native=await invoke({action:'start',profileDir:dir,isolated:mode==='isolated',executable:cfg.executable});
    const createdAt=wallNow(),expiresAt=createdAt+ttl*1000;
    try{
      writeBrowserLeaseMarker({profileDir:dir,instance:ctx.config?.instance?.profile??'default',isolated:mode==='isolated',createdAt,expiresAt,ownerPid:process.pid});
    }catch{
      try{await invoke({action:'end'});}catch{closeInvoke();}
      throw browserError('BROWSER_LEASE_STATE_FAILED');
    }
    session={id:token(),expires:now()+ttl*1000,ttl,mode,profile,profileDir:dir,isolated:mode==='isolated',
      executable:cfg.executable,foreground:false,createdAtEpochMs:createdAt,expiresAtEpochMs:expiresAt};
    uncertain=false;expiryRequested=false;arm(ttl);
    return {ok:true,lease:session.id,ttlSeconds:ttl,profile,mode,background:true,headless:true,
      userDesktopTouched:false,savedPasswordStoreAccess:false,browserProduct:native.browserProduct??null,backend:native.backend??'browser-headless'};
   }
   owns(input.lease);
   if(name==='browser_session_renew'){
    const ttl=input.ttlSeconds??300,expiresAt=wallNow()+ttl*1000;
    writeBrowserLeaseMarker({profileDir:session.profileDir,instance:ctx.config?.instance?.profile??'default',isolated:session.isolated,createdAt:session.createdAtEpochMs,expiresAt,ownerPid:process.pid});
    session.expires=now()+ttl*1000;session.expiresAtEpochMs=expiresAt;session.ttl=ttl;arm(ttl);return {ok:true,ttlSeconds:ttl};
   }
   if(name==='browser_session_end'){
    const profileDir=session.profileDir;
    clearTimer();session=null;uncertain=false;expiryRequested=false;expiredProfile=null;
    const r=await invoke({action:'end'});removeBrowserLeaseMarker(profileDir);return {ok:true,closed:r.closed===true};
   }
   if(name==='browser_foreground_requirement'){
    return {ok:true,approvalRequired:true,reason:input.reason,targetHost:input.targetHost??null,detail:input.detail??null,
      backgroundSessionPreserved:true,desktopTakenOver:false,
      authorizationPolicy:'explicit-current-request-only',
      nextStep:'Ask only if the current user request did not already authorize foreground interaction. After approval call browser_foreground_begin with that current-task authorization, then gui_session_begin(mode="takeover", explicitUserAuthorization=<same approval>) for the minimum interaction. End the GUI lease and call browser_foreground_end to resume the same profile headlessly.'};
   }
   if(name==='browser_foreground_begin'){
    if(cfg.foregroundFallback!=='explicit-current-request-only'||cfg.allowForegroundFallback!==true)throw browserError('BROWSER_FOREGROUND_FALLBACK_DISABLED');
    if(session.foreground)throw browserError('BROWSER_FOREGROUND_ALREADY_ACTIVE');
    const native=await invoke({action:'relaunch',headless:false});
    session.foreground=true;
    return {ok:true,foreground:true,headless:false,userDesktopTouched:true,explicitlyAuthorized:true,
      sameOwnedProfile:true,browserProduct:native.browserProduct??null,
      nextStep:'Use a separately authorized GUI takeover only for the minimum required interaction, then end the GUI lease and call browser_foreground_end.'};
   }
   if(name==='browser_foreground_end'){
    if(!session.foreground)throw browserError('BROWSER_FOREGROUND_NOT_ACTIVE');
    let native;
    try{native=await invoke({action:'relaunch',headless:true});}
    catch(error){session.foreground=false;uncertain=true;throw error;}
    session.foreground=false;
    return {ok:true,foreground:false,headless:true,userDesktopTouched:false,sameOwnedProfile:true,
      browserProduct:native.browserProduct??null,backgroundResumed:true,resumeNavigationFailed:native.resumeNavigationFailed===true};
   }
   if(uncertain&&['browser_navigate','browser_fill','browser_click'].includes(name))throw browserError('BROWSER_OUTCOME_UNCERTAIN_SNAPSHOT_REQUIRED');
   const rule=BROWSER_RULES.get(name);
   if(name==='browser_navigate'&&cfg.allowNavigate!==true)throw browserError('BROWSER_NAVIGATION_DISABLED');
   if(['browser_fill','browser_click'].includes(name)&&cfg.allowInput!==true)throw browserError('BROWSER_INPUT_DISABLED');
   if(name==='browser_screenshot'&&cfg.allowScreenshot!==true)throw browserError('BROWSER_SCREENSHOT_DISABLED');
   const mutation=['browser_navigate','browser_fill','browser_click'].includes(name);
   const foregroundAtDispatch=session.foreground===true;
   const activity={background:!foregroundAtDispatch,userDesktopTouched:foregroundAtDispatch};
   try{
    let result;
    if(name==='browser_navigate')result=await invoke({action:'navigate',url:input.url,timeoutMs:input.timeoutMs??30000});
    else if(name==='browser_snapshot')result=await invoke({action:'snapshot',maxTextChars:input.maxTextChars??20000,maxElements:input.maxElements??120});
    else if(name==='browser_screenshot')result=await invoke({action:'screenshot',format:input.format??'jpeg',quality:input.quality??70,maxBytes:input.maxBytes??2097152});
    else if(name==='browser_fill')result=await invoke({action:'fill',selector:input.selector,text:input.text});
    else if(name==='browser_click')result=await invoke({action:'click',selector:input.selector});
    else if(name==='browser_wait')result=await invoke({action:'wait',selector:input.selector,textIncludes:input.textIncludes,urlIncludes:input.urlIncludes,timeoutMs:input.timeoutMs??5000});
    else throw browserError('BROWSER_UNKNOWN_TOOL');
    if(name==='browser_snapshot'){
      uncertain=false;
      result={...result,passwordValuesReturned:false,cookiesReturned:false,savedPasswordStoreAccess:false};
    }
    if(name==='browser_screenshot'){
      const {data,mimeType,...meta}=result;
      if(!['image/jpeg','image/png'].includes(mimeType)||typeof data!=='string'||!data.length)throw browserError('BROWSER_INVALID_IMAGE');
      const bytes=Buffer.from(data,'base64');
      const sig=mimeType==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
      if(!sig||bytes.length>(input.maxBytes??2097152))throw browserError('BROWSER_INVALID_IMAGE');
      const structured={...meta,bytes:bytes.length,mimeType,...activity};
      return {__mcpContent:[{type:'image',mimeType,data},{type:'text',text:JSON.stringify(structured)}],__structuredContent:structured};
    }
    return {...result,...activity,...(['browser_fill','browser_click'].includes(name)?{verificationRecommended:true}:{})};
   }catch(error){
    if(mutation)uncertain=true;
    throw error;
   }
  }finally{
   busy=false;
   if(expiryRequested)await cleanupExpired();
  }
 };
 const close=()=>{clearTimer();session=null;uncertain=false;expiryRequested=false;return closeInvoke();};
 return {execute,close};
}
// A separate headless Chromium/Firefox child per isolated browser lease.
// Sessions from independent chats/profiles never share a CDP target,
// browser cookies, foreground pointer, helper input queue or worker state.
// Existing persistent sessions continue to use the legacy controller.
function makePrivateBrowserWorker(ctx){
 const cfg=ctx.config?.powerMode?.browserControl??{};
 const helper=isFirefoxExecutable(cfg.executable)?firefoxHelper:chromiumHelper;
 const client=createBrowserProcessClient({
  file:process.execPath,args:[helper,'--server']
 });
 return {
  controller:createBrowserController({
   invoke:client.invoke,closeInvoke:()=>{void client.close().catch(()=>{});}
  }),
  close:()=>client.close()
 };
}

// The pool uses existing browser_session_begin/browser_* tool schemas.
// Only mode:"isolated" opts in; no new server, listening endpoint or
// remotely callable admin API is introduced.
export function createIsolatedBrowserPool({
 maxWorkers=3,makeWorker=makePrivateBrowserWorker,clock=Date.now,
 authorizeObserverGrant=()=>false,authorizeObserverRead=()=>false,observerToken=()=>randomBytes(32).toString('hex'),
 authorizeControlHandoff=()=>false,controlToken=()=>randomBytes(32).toString('hex')
}={}){
 if(!Number.isInteger(maxWorkers)||maxWorkers<1||maxWorkers>8)
  throw browserError('BROWSER_ISOLATED_CAPACITY_INVALID');
 const workers=new Map(),pendingStarts=new Set(),observers=new Map();
 let starting=0,closed=false,closing=null;
 const profileOf=ctx=>String(ctx.config?.instance?.profile??'default');
 const restrictToPrivate=ctx=>{
  const cfg=ctx.config?.powerMode?.browserControl??{};
  return {...ctx,config:{...ctx.config,powerMode:{...ctx.config.powerMode,
   browserControl:{...cfg,allowForegroundFallback:false}}}};
 };
 async function dispose(entry){
  if(entry.disposal)return entry.disposal;
  // Observing a retired workspace must never expose another worker's frame.
  for(const [id,g] of observers){
   if(g.lease===entry.lease)observers.delete(id);
  }
  entry.observation=null;
  entry.handoff=null;
  if(workers.get(entry.lease)===entry)workers.delete(entry.lease);
  entry.disposal=(async()=>{
   try{await entry.worker.controller.close();}
   finally{await entry.worker.close();}
  })();
  return entry.disposal;
 }
 async function waitForIdle(entry){
  if(!entry.active)return;
  await new Promise(resolve=>entry.idleWaiters.push(resolve));
 }
 async function invokeOwned(entry,ctx,name,input){
  entry.active++;
  try{return await entry.worker.controller.execute(restrictToPrivate(ctx),name,input);}
  finally{
   entry.active--;
   if(entry.active===0){
    if(entry.handoff&&entry.handoff.expiresAt<=clock()){
     entry.handoff=null;
     entry.reobserveRequired=true;
    }
    for(const resume of entry.idleWaiters.splice(0))resume();
    if(entry.expireAfterIdle&&workers.get(entry.lease)===entry)
     await dispose(entry);
   }
  }
 }
 async function prune(){
  for(const entry of [...workers.values()]){
   if(entry.expiresAt>clock())continue;
   if(entry.active){entry.expireAfterIdle=true;continue;}
   await dispose(entry);
  }
 }
 const hasLease=id=>typeof id==='string'&&workers.has(id);
 const count=profile=>[...workers.values()].filter(e=>
  e.ownerProfile===String(profile??'default')&&e.expiresAt>clock()).length;
 const execute=async(ctx,name,raw={})=>{
  if(closed)throw browserError('BROWSER_POOL_CLOSED');
  const input=validateBrowserInput(name,raw);
  const cfg=ctx.config?.powerMode?.browserControl??{};
  if(ctx.config?.powerMode?.enabled!==true||cfg.enabled!==true)
   throw browserError('BROWSER_DISABLED');
  if(name==='browser_status')return {
   ok:true,background:true,headless:true,userDesktopTouched:false,
   isolatedWorkersActive:count(profileOf(ctx)),
   isolatedWorkerCapacity:maxWorkers
  };
  if(name==='browser_session_begin'){
   if((input.mode??'persistent')!=='isolated')
    throw browserError('BROWSER_ISOLATED_MODE_REQUIRED');
   await prune();
   if(closed)throw browserError('BROWSER_POOL_CLOSED');
   if(workers.size+starting>=maxWorkers)
    throw browserError('BROWSER_ISOLATED_CAPACITY');
   // Reserve the slot synchronously BEFORE awaiting process startup.
   starting++;
   let resolveStart;
   const pendingStart=new Promise(resolve=>{resolveStart=resolve;});
   pendingStarts.add(pendingStart);
   let worker;
   try{
    worker=makeWorker(ctx);
    // No foreground fallback in a private worker. A human intervention
    // belongs to an explicitly scoped viewer/control handoff, not WinSta0.
    const privateCtx=restrictToPrivate(ctx);
    const answer=await worker.controller.execute(privateCtx,name,input);
    if(closed)throw browserError('BROWSER_POOL_CLOSED');
    if(!answer?.lease||workers.has(answer.lease))
     throw browserError('BROWSER_ISOLATED_LEASE_COLLISION');
    workers.set(answer.lease,{lease:answer.lease,worker,
     ownerProfile:profileOf(ctx),active:0,idleWaiters:[],
     revision:0,observation:null,
     handoff:null,reobserveRequired:false,
     disposal:null,expireAfterIdle:false,
     expiresAt:clock()+(input.ttlSeconds??300)*1000});
    return {...answer,workerIsolation:'PRIVATE_BROWSER_PROCESS',
      physicalDesktopInput:false};
   }catch(error){
    if(worker){
     try{worker.controller.close();}finally{await worker.close();}
    }
    throw error;
   }finally{
    starting--;
    pendingStarts.delete(pendingStart);
    resolveStart();
   }
  }
  const entry=workers.get(input.lease);
  if(!entry||entry.ownerProfile!==profileOf(ctx))
   throw browserError('BROWSER_LEASE_REQUIRED_OR_EXPIRED');
  if(entry.expiresAt<=clock()){
   if(entry.active)entry.expireAfterIdle=true;
   else await dispose(entry);
   throw browserError('BROWSER_LEASE_REQUIRED_OR_EXPIRED');
  }
  if(['browser_foreground_begin','browser_foreground_end'].includes(name))
   throw browserError('BROWSER_ISOLATED_FOREGROUND_DENIED');
  if(name==='browser_foreground_requirement')return {
   ok:true,approvalRequired:true,backgroundSessionPreserved:true,
   desktopTakenOver:false,viewerHandoffRequired:true,
   nextStep:'Observe the private workspace; a human control handoff requires a future authenticated workspace-specific control path.'
  };
  if(entry.handoff&&entry.handoff.expiresAt<=clock()&&!entry.active){
   entry.handoff=null;
   entry.reobserveRequired=true;
  }
  if(name==='browser_session_end'&&entry.handoff)
   throw browserError('BROWSER_WORKSPACE_CONTROL_HELD');
  if(['browser_navigate','browser_fill','browser_click'].includes(name)){
   if(entry.handoff)throw browserError('BROWSER_WORKSPACE_CONTROL_HELD');
   if(entry.reobserveRequired)
    throw browserError('BROWSER_WORKSPACE_REOBSERVATION_REQUIRED');
  }
  if(name==='browser_session_end'){
   // A second controller request must not cancel an active native/browser
   // action. A busy close is denied; explicit end after idle is still allowed.
   try{
    const result=await invokeOwned(entry,ctx,name,input);
    await dispose(entry);
    return result;
   }catch(error){
    if(error?.browserCode!=='BROWSER_BUSY')await dispose(entry);
    throw error;
   }
  }
  try{
   if(['browser_navigate','browser_fill','browser_click'].includes(name))
    entry.revision++;
   const answer=await invokeOwned(entry,ctx,name,input);
   if(name==='browser_screenshot'){
    const image=answer?.__mcpContent?.find(x=>x?.type==='image');
    const info=answer?.__structuredContent;
    // One already-taken frame, bounded in memory, no separate observer I/O.
    if(image&&typeof image.data==='string'&&
       image.data.length<=1398112&&
       ['image/jpeg','image/png'].includes(image.mimeType)&&
       Number.isSafeInteger(info?.bytes)&&info.bytes<=1048576&&
       [...observers.values()].some(g=>g.lease===entry.lease&&g.expiresAt>clock()))
      entry.observation={image:{type:'image',mimeType:image.mimeType,data:image.data},
       meta:{bytes:info.bytes,mimeType:image.mimeType},
       capturedAt:clock(),revision:entry.revision};
   }
   if(name==='browser_snapshot'&&!entry.handoff)
    entry.reobserveRequired=false;
   if(name==='browser_session_renew')
    entry.expiresAt=clock()+(input.ttlSeconds??300)*1000;
   return answer;
  }catch(error){
   if(error?.browserCode==='BROWSER_LEASE_REQUIRED_OR_EXPIRED')
    await dispose(entry);
   throw error;
  }
 };
 // Not published over MCP. A trusted management UI must supply an external
 // authenticated grant verifier; default is explicit DENY.
 const digest=id=>createHash('sha256').update(id).digest('hex');
 const ownerFor=(ctx,lease)=>{
  const entry=workers.get(lease);
  if(!entry||entry.disposal||entry.ownerProfile!==profileOf(ctx)||
     entry.expiresAt<=clock())throw browserError('BROWSER_LEASE_REQUIRED_OR_EXPIRED');
  return entry;
 };
 const grantObserver=async(ownerCtx,lease,{viewerProfile,ttlSeconds=60}={})=>{
  if(closed)throw browserError('BROWSER_POOL_CLOSED');
  const entry=ownerFor(ownerCtx,lease);
  const cfg=ownerCtx.config?.powerMode?.browserControl??{};
  if(ownerCtx.config?.powerMode?.enabled!==true||cfg.enabled!==true||
     cfg.allowScreenshot!==true)
    throw browserError('BROWSER_OBSERVER_FORBIDDEN');
  if(typeof viewerProfile!=='string'||!/^[A-Za-z0-9._-]{1,64}$/.test(viewerProfile)||
     !Number.isInteger(ttlSeconds)||ttlSeconds<10||ttlSeconds>180)
    throw browserError('BROWSER_OBSERVER_INVALID_SCOPE');
  for(const [id,g] of observers){
   if(g.expiresAt<=clock())observers.delete(id);
  }
  if(observers.size>=16||[...observers.values()].filter(x=>x.lease===lease).length>=4)
   throw browserError('BROWSER_OBSERVER_CAPACITY');
  let authorized=false;
  try{authorized=await authorizeObserverGrant({
   ownerProfile:entry.ownerProfile,viewerProfile,workspaceRef:digest(lease),ttlSeconds
  })===true;}catch{/* Explicitly fail closed when an authorizer fails. */}
  if(!authorized||closed||workers.get(lease)!==entry||
     entry.expiresAt<=clock()||
     ownerCtx.config?.powerMode?.enabled!==true||
     ownerCtx.config?.powerMode?.browserControl?.allowScreenshot!==true)
   throw browserError('BROWSER_OBSERVER_FORBIDDEN');
  const token=observerToken();
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||observers.has(digest(token)))
   throw browserError('BROWSER_OBSERVER_TOKEN_INVALID');
  observers.set(digest(token),{lease,viewerProfile,ownerCtx,
   expiresAt:Math.min(entry.expiresAt,clock()+ttlSeconds*1000)});
  return {observerToken:token,scope:'VIEW_ONLY',expiresInSeconds:ttlSeconds,
   nativeInputAuthorized:false,physicalDesktopAccess:false};
 };
 const readObserver=(viewerCtx,token)=>{
  if(closed||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))
   throw browserError('BROWSER_OBSERVER_DENIED');
  const key=digest(token),grant=observers.get(key);
  if(!grant||grant.expiresAt<=clock()||profileOf(viewerCtx)!==grant.viewerProfile){
   if(grant&&grant.expiresAt<=clock())observers.delete(key);
   throw browserError('BROWSER_OBSERVER_DENIED');
  }
  const cfg=viewerCtx.config?.powerMode?.browserControl??{};
  if(viewerCtx.config?.powerMode?.enabled!==true||cfg.enabled!==true||
     cfg.allowScreenshot!==true)throw browserError('BROWSER_OBSERVER_DENIED');
  const entry=workers.get(grant.lease);
  if(!entry||entry.disposal||entry.expiresAt<=clock())
   throw browserError('BROWSER_OBSERVER_DENIED');
  const ownerPolicy=grant.ownerCtx?.config?.powerMode;
  if(ownerPolicy?.enabled!==true||
     ownerPolicy?.browserControl?.enabled!==true||
     ownerPolicy?.browserControl?.allowScreenshot!==true){
   observers.delete(key);
   if(![...observers.values()].some(g=>g.lease===entry.lease))
    entry.observation=null;
   throw browserError('BROWSER_OBSERVER_DENIED');
  }
  // Fail closed when a trusted reviewer has not reauthorized this read.
  let readAuthorized=false;
  try{readAuthorized=authorizeObserverRead({
   ownerProfile:entry.ownerProfile,viewerProfile:grant.viewerProfile,
   workspaceRef:digest(entry.lease)
  })===true;}catch{/* No frame on verifier failure. */}
  if(!readAuthorized){
   observers.delete(key);
   if(![...observers.values()].some(g=>g.lease===entry.lease))
    entry.observation=null;
   throw browserError('BROWSER_OBSERVER_DENIED');
  }
  const frame=entry.observation;
  if(!frame)throw browserError('BROWSER_OBSERVER_FRAME_NOT_READY');
  const ageMs=Math.max(0,clock()-frame.capturedAt);
  const metadata={...frame.meta,observerReadOnly:true,
   workspaceRevision:entry.revision,frameRevision:frame.revision,
   stale:entry.active>0||!!entry.handoff||
    entry.revision!==frame.revision||ageMs>30000,
   ageMs,physicalDesktopAccess:false,controlAuthorized:false};
  return {
   __mcpContent:[{...frame.image},
    {type:'text',text:JSON.stringify(metadata)}],
   __structuredContent:metadata
  };
 };
 const revokeObserver=(ownerCtx,lease,token)=>{
  ownerFor(ownerCtx,lease);
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))
   throw browserError('BROWSER_OBSERVER_DENIED');
  const key=digest(token),entry=observers.get(key);
  if(!entry||entry.lease!==lease)throw browserError('BROWSER_OBSERVER_DENIED');
  observers.delete(key);
  if(![...observers.values()].some(g=>g.lease===lease))
   workers.get(lease).observation=null;
  return {revoked:true,nativeInputAuthorized:false};
 };
 // Internal, workspace-scoped operator handoff; default DENY until a
 // separately authenticated supervisor integration provides an authorizer.
 const requireHandoff=(operatorCtx,token)=>{
  if(closed||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))
   throw browserError('BROWSER_WORKSPACE_OPERATOR_DENIED');
  const hash=digest(token);
  for(const entry of workers.values()){
   const h=entry.handoff;
   if(!h||h.tokenDigest!==hash)continue;
   if(h.expiresAt<=clock()){
    if(!entry.active){entry.handoff=null;entry.reobserveRequired=true;}
    throw browserError('BROWSER_WORKSPACE_OPERATOR_DENIED');
   }
   if(h.operatorProfile!==profileOf(operatorCtx)||entry.disposal||
      entry.expiresAt<=clock())
    throw browserError('BROWSER_WORKSPACE_OPERATOR_DENIED');
   return entry;
  }
  throw browserError('BROWSER_WORKSPACE_OPERATOR_DENIED');
 };
 const beginControlHandoff=async(ownerCtx,lease,{operatorProfile,ttlSeconds=60}={})=>{
  if(closed)throw browserError('BROWSER_POOL_CLOSED');
  const entry=ownerFor(ownerCtx,lease);
  if(typeof operatorProfile!=='string'||!/^[A-Za-z0-9._-]{1,64}$/.test(operatorProfile)||
     !Number.isInteger(ttlSeconds)||ttlSeconds<10||ttlSeconds>120)
   throw browserError('BROWSER_WORKSPACE_OPERATOR_INVALID_SCOPE');
  const cfg=ownerCtx.config?.powerMode?.browserControl??{};
  if(ownerCtx.config?.powerMode?.enabled!==true||cfg.enabled!==true||
     cfg.allowInput!==true)
   throw browserError('BROWSER_WORKSPACE_OPERATOR_FORBIDDEN');
  if(entry.active)throw browserError('BROWSER_BUSY');
  if(entry.handoff&&entry.handoff.expiresAt<=clock()){
   entry.handoff=null;entry.reobserveRequired=true;
  }
  if(entry.handoff)throw browserError('BROWSER_WORKSPACE_CONTROL_HELD');
  let authorized=false;
  try{authorized=await authorizeControlHandoff({
   ownerProfile:entry.ownerProfile,operatorProfile,
   workspaceRef:digest(lease),ttlSeconds
  })===true;}catch{/* An exception cannot turn into consent. */}
  if(!authorized||closed||workers.get(lease)!==entry||
     entry.expiresAt<=clock()||entry.active||entry.handoff||
     ownerCtx.config?.powerMode?.enabled!==true||
     ownerCtx.config?.powerMode?.browserControl?.allowInput!==true)
   throw browserError('BROWSER_WORKSPACE_OPERATOR_FORBIDDEN');
  const credential=controlToken();
  if(typeof credential!=='string'||!/^[a-f0-9]{64}$/.test(credential))
   throw browserError('BROWSER_WORKSPACE_OPERATOR_TOKEN_INVALID');
  entry.handoff={tokenDigest:digest(credential),operatorProfile,ownerCtx,
   expiresAt:Math.min(entry.expiresAt,clock()+ttlSeconds*1000)};
  entry.reobserveRequired=true;
  return {controlToken:credential,scope:'PRIVATE_WORKSPACE_ONLY',
   ownerReobserveRequired:true,physicalDesktopAccess:false};
 };
 const controlAction=async(operatorCtx,credential,name,raw={})=>{
  const entry=requireHandoff(operatorCtx,credential);
  if(!['browser_screenshot','browser_snapshot','browser_click','browser_fill'].includes(name))
   throw browserError('BROWSER_WORKSPACE_OPERATOR_ACTION_DENIED');
  const input=validateBrowserInput(name,{...raw,lease:entry.lease});
  // Recheck the live owner policy before any delegated action.
  const policy=entry.handoff?.ownerCtx?.config?.powerMode;
  const ownCfg=policy?.browserControl;
  if(policy?.enabled!==true||ownCfg?.enabled!==true||
     (['browser_click','browser_fill'].includes(name)&&ownCfg.allowInput!==true)||
     (name==='browser_screenshot'&&ownCfg.allowScreenshot!==true)){
   entry.handoff=null;
   entry.reobserveRequired=true;
   throw browserError('BROWSER_WORKSPACE_OPERATOR_DENIED');
  }
  const cfg=operatorCtx.config?.powerMode?.browserControl??{};
  if(operatorCtx.config?.powerMode?.enabled!==true||cfg.enabled!==true||
    ((name==='browser_click'||name==='browser_fill')&&cfg.allowInput!==true)||
    (name==='browser_screenshot'&&cfg.allowScreenshot!==true))
   throw browserError('BROWSER_WORKSPACE_OPERATOR_DENIED');
  if(entry.active)throw browserError('BROWSER_BUSY');
  if(['browser_fill','browser_click'].includes(name))entry.revision++;
  // Uses the existing private Controller: never the host desktop.
  // An uncertain action is not auto-retried; the Controller requires a
  // fresh snapshot before another mutation.
  const result=await invokeOwned(entry,operatorCtx,name,input);
  return {...result,privateWorkspaceOnly:true,
   physicalDesktopAccess:false,ownerReobserveRequired:true};
 };
 const endControlHandoff=(operatorCtx,credential)=>{
  const entry=requireHandoff(operatorCtx,credential);
  if(entry.active)throw browserError('BROWSER_BUSY');
  entry.handoff=null;
  entry.reobserveRequired=true;
  return {released:true,ownerReobserveRequired:true,
   physicalDesktopAccess:false};
 };
 const revokeControlHandoff=(ownerCtx,lease)=>{
  const entry=ownerFor(ownerCtx,lease);
  if(entry.active)throw browserError('BROWSER_BUSY');
  const existed=!!entry.handoff;
  entry.handoff=null;
  if(existed)entry.reobserveRequired=true;
  return {revoked:existed,ownerReobserveRequired:existed,
   physicalDesktopAccess:false};
 };
 const close=()=>{
  if(closing)return closing;
  closed=true;
  observers.clear();
  closing=(async()=>{
   await Promise.allSettled([...pendingStarts]);
   const entries=[...workers.values()];
   // Finish each workspace's accepted action before its owned helper is
   // closed. Unrelated workspaces do not wait for one another.
   const results=await Promise.allSettled(entries.map(async entry=>{
    await waitForIdle(entry);
    await dispose(entry);
   }));
   if(results.some(x=>x.status==='rejected'))
    throw browserError('BROWSER_POOL_CLEANUP_FAILED');
  })();
  return closing;
 };
 return {execute,hasLease,count,grantObserver,readObserver,revokeObserver,
  beginControlHandoff,controlAction,endControlHandoff,revokeControlHandoff,close};
}

const controller=createBrowserController();
const isolatedBrowserPool=createIsolatedBrowserPool();
export async function executeBrowserTool(ctx,name,input){
 if(name==='browser_session_begin'&&input?.mode==='isolated')
  return isolatedBrowserPool.execute(ctx,name,input);
 if(isolatedBrowserPool.hasLease(input?.lease))
  return isolatedBrowserPool.execute(ctx,name,input);
 if(name==='browser_status'){
  const status=await controller.execute(ctx,name,input);
  return {...status,isolatedWorkersActive:
    isolatedBrowserPool.count(ctx.config?.instance?.profile??'default'),
   isolatedWorkerCapacity:3};
 }
 return controller.execute(ctx,name,input);
}
export async function closeBrowserController(){
 const results=await Promise.allSettled([
  Promise.resolve().then(()=>controller.close()),
  Promise.resolve().then(()=>isolatedBrowserPool.close())
 ]);
 if(results.some(x=>x.status==='rejected'))
  throw browserError('BROWSER_SHUTDOWN_CLEANUP_FAILED');
}

// Bounded graceful close of the browser workers when the actual MCP Core
// terminates. No new service, port, input capability or auto-replay path.
// Signal cleanup is process-lifecycle management, not owner GUI recovery.
export function attachBrowserServerShutdown({
  server,closeBrowserController,stopMonitor=()=>{},processLike=process,
  deadlineMs=45000,schedule=setTimeout,cancel=clearTimeout,
  exit=code=>process.exit(code),
  onError=code=>console.error(code)
}={}){
  if(typeof server?.close!=='function'||typeof closeBrowserController!=='function'||
     typeof processLike?.on!=='function'||
     !Number.isSafeInteger(deadlineMs)||deadlineMs<1000||deadlineMs>120000)
    throw new Error('BROWSER_SHUTDOWN_SETUP_INVALID');
  let closing=null;
  const report=code=>{try{onError(code);}catch{}};
  const shutdown=()=>{
    if(closing)return closing;
    closing=(async()=>{
      let fail=false;
      const deadline=schedule(()=>{
        report('BROWSER_SHUTDOWN_DEADLINE_EXCEEDED');
        exit(1);
      },deadlineMs);
      try{
        try{stopMonitor();}catch{fail=true;report('BROWSER_MONITOR_STOP_FAILED');}
        const closingServer=new Promise(resolve=>{
          try{
            server.close(error=>{
              if(error&&error.code!=='ERR_SERVER_NOT_RUNNING'){
                fail=true;report('BROWSER_HTTP_SERVER_CLOSE_FAILED');
              }
              resolve();
            });
          }catch{
            fail=true;report('BROWSER_HTTP_SERVER_CLOSE_FAILED');
            resolve();
          }
        });
        // Await both the HTTP drain and the already accepted private
        // worker actions; a new HTTP request cannot enter after close().
        const results=await Promise.allSettled([
          closingServer,Promise.resolve().then(closeBrowserController)
        ]);
        if(results.some(x=>x.status==='rejected')){
          fail=true;report('BROWSER_WORKER_SHUTDOWN_FAILED');
        }
      }finally{
        cancel(deadline);
        if(fail)processLike.exitCode=1;
      }
    })();
    return closing;
  };
  for(const sig of ['SIGTERM','SIGINT']){
    processLike.on(sig,()=>{void shutdown().catch(()=>{
      report('BROWSER_WORKER_SHUTDOWN_FAILED');
      processLike.exitCode=1;
    });});
  }
  return {shutdown};
}
