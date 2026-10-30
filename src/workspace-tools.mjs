// Target-scoped background workspace bridge. Never sends physical desktop input.
// CUA runs in the owning interactive account; an inaccessible owner daemon is a
// capability result, not a reason to bypass named-pipe ACL or alter GUI policy.
import os from 'node:os';
import fs from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chooseWorkspaceRoute,classifyWorkspaceOutcome} from './workspace-routing.mjs';
const defaultNativeUIACall=async (...args)=>{
 const {nativeWindowsUIACall}=await import('./agentos-native-win.mjs');
 return nativeWindowsUIACall(...args);
};
import {createWorkspaceTargetJournal} from './workspace-target-journal.mjs';
const execFileAsync=promisify(execFile);
const targetId=(pid,windowId)=>pid+':'+windowId;
const integer=(n)=>Number.isSafeInteger(n)&&n>0;
const TOKEN=/^s[0-9a-f]{8}:[0-9]+$/;
const REQUEST=/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const fail=(x)=>Object.assign(new Error(x),{code:x});
function desktopType(platform=process.platform,env=process.env){
 if(platform==='win32')return 'windows';
 if(platform==='linux')return env.XDG_SESSION_TYPE==='wayland'||!!env.WAYLAND_DISPLAY?'wayland':env.DISPLAY?'x11':'headless';
 return 'headless';
}
function driverBinary(platform=process.platform,env=process.env){
 if(platform==='win32')return path.join(env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'ChatGPTRemoteCommander','adapters','cua-driver','v0.38.0','cua-driver.exe');
 return path.join(os.homedir(),'.local','share','chatgpt-remote-commander','adapters','cua-driver','v0.38.0','cua-driver');
}
export async function defaultOwnerSession({platform=process.platform,env=process.env}={}){
 if(platform==='win32'){
  let user;
  try{({stdout:user}=await execFileAsync('whoami.exe',[],{timeout:3000,windowsHide:true}));}
  catch{return false;}
  return !/\\system\s*$/i.test(user.trim())&&user.trim().includes('\\')&&
    env.SESSIONNAME!=='Services';
 }
 if(platform==='linux')return typeof process.getuid==='function'&&process.getuid()!==0&&
   typeof env.XDG_RUNTIME_DIR==='string'&&env.XDG_RUNTIME_DIR.startsWith('/run/user/');
 return false;
}
export async function defaultCuaCall(tool,args,{platform=process.platform,env=process.env,workspaceSeat=null,screenshotFile=null}={}){
 const executable=driverBinary(platform,env);
 // This exact pinned adapter is provided by the verified local Commander install.
 // Never accept a caller-supplied executable, socket or CDP endpoint.
 let output;
 try{
  const argv=['call'];
  if(platform==='win32'&&env.RC_WORKSPACE_CUA_OWNER_PIPE==='1')
   argv.push('--socket',String.raw`\\.\pipe\rc-workspace-cua-v038`);
  if(workspaceSeat){
   if(platform!=='linux'||!['a','b'].includes(workspaceSeat))throw fail('WORKSPACE_SEAT_INVALID');
   argv.push('--socket',path.join(env.XDG_RUNTIME_DIR,'rc-cua-workspace-'+workspaceSeat+'.sock'));
  }
  argv.push(tool,JSON.stringify(args));
  if(screenshotFile)argv.push('--screenshot-out-file',screenshotFile);
  ({stdout:output}=await execFileAsync(executable,argv,{
    encoding:'utf8',timeout:tool==='browser_prepare'?28000:tool==='get_browser_state'?18000:12000,maxBuffer:384*1024,windowsHide:true,env
  }));
 }catch(e){
  // Driver refusals are structured non-effects, not lost native acknowledgments.
  if(typeof e?.stdout==='string'&&e.stdout.length<32768){
   try{const refusal=JSON.parse(e.stdout);
    if(refusal?.status==='refused'&&typeof refusal?.refusal?.code==='string')return refusal;
   }catch{}
  }
  if(e?.code==='ENOENT')throw fail('WORKSPACE_DRIVER_NOT_INSTALLED');
  if(/Access is denied|Permission denied|os error 5/.test(e?.stderr??''))
    throw fail('WORKSPACE_OWNER_SESSION_REQUIRED');
  if(/not running|not reachable|Connection refused/.test(e?.stderr??''))
    throw fail('WORKSPACE_DRIVER_NOT_RUNNING');
  throw fail('WORKSPACE_DRIVER_UNAVAILABLE');
 }
 try{const body=JSON.parse(output);return body?.structuredContent??body;}
 catch{throw fail('WORKSPACE_DRIVER_INVALID_RESPONSE');}
}
export async function defaultCuaPreview(args,scope={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rc-workspace-view-'));
 const file=path.join(dir,'frame.png');
 try{
  const meta=await defaultCuaCall('get_window_state',{
   ...args,display_only:true,include_accessibility_tree:false,
   max_image_dimension:1200
  },{...scope,screenshotFile:file});
  const st=await fs.lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size<24||st.size>2*1024*1024)
   throw fail('WORKSPACE_PREVIEW_INVALID_FRAME');
  const png=await fs.readFile(file);
  if(!png.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))
   throw fail('WORKSPACE_PREVIEW_INVALID_PNG');
  return {meta,imageBytes:png};
 }finally{await fs.rm(dir,{recursive:true,force:true});}
}
const exactWindow=(a)=>integer(a?.pid)&&integer(a?.windowId);
const readOnly={readOnlyHint:true,openWorldHint:false};
const mutating={readOnlyHint:false,destructiveHint:true,openWorldHint:false,idempotentHint:false};
export const workspaceToolDefinitions=[
 {name:'workspace_plan',description:'Select independent background/isolated control for an existing logged-in application or browser. This read-only plan never steals focus or copies credentials.',inputSchema:{
   type:'object',properties:{target:{type:'string',enum:['existing-browser','new-browser','existing-app','new-app']},
     existingProfileGrant:{type:'boolean'},backgroundCapability:{type:'boolean'}},
   required:['target'],additionalProperties:false},annotations:readOnly},
 {name:'workspace_agentos_plan',description:'Select the strongest locally available authorized AgentOS provider. Native API/semantic UI/DOM first; CUA only when no stronger route is available. Planning does not grant privileges.',inputSchema:{
   type:'object',properties:{target:{type:'string',enum:['existing-browser','new-browser','existing-app','new-app','project']},
     existingProfileGrant:{type:'boolean'},visualFallbackAuthorized:{type:'boolean'}},
   required:['target'],additionalProperties:false},annotations:readOnly},
 {name:'workspace_native_ui_observe',description:'Observe native Windows UIAutomation actionable control patterns on exactly one same-owner window. No CUA, screenshot, browser profiles or mouse.',inputSchema:{
   type:'object',properties:{pid:{type:'integer',minimum:1},windowId:{type:'integer',minimum:1},maxElements:{type:'integer',minimum:1,maximum:100}},
   required:['pid','windowId'],additionalProperties:false},annotations:readOnly},
 {name:'workspace_native_ui_invoke',description:'Invoke one previously observed exact Windows UIAutomation control using native InvokePattern. Owner session, fresh fingerprint, requestId and explicit authorization required. No CUA or global input. Result is not user-goal verification.',inputSchema:{
   type:'object',properties:{pid:{type:'integer',minimum:1},windowId:{type:'integer',minimum:1},
     fingerprint:{type:'string',pattern:'^[a-f0-9]{24}$'},controlName:{type:'string',minLength:1,maxLength:150},
     requestId:{type:'string',minLength:8,maxLength:128},explicitUserAuthorization:{type:'string',minLength:12,maxLength:512}},
   required:['pid','windowId','fingerprint','controlName','requestId','explicitUserAuthorization'],additionalProperties:false},annotations:mutating},
 {name:'workspace_list_windows',description:'List existing same-user application windows through Cua Driver v0.38; no desktop takeover or global input.',inputSchema:{
   type:'object',properties:{pid:{type:'integer',minimum:1},workspaceSeat:{type:'string',enum:['a','b']}},additionalProperties:false},annotations:readOnly},
 {name:'workspace_window_observe',description:'Read accessibility snapshot of one exact existing window in the owning desktop; no click, focus or mouse movement.',inputSchema:{
   type:'object',properties:{pid:{type:'integer',minimum:1},windowId:{type:'integer',minimum:1},workspaceSeat:{type:'string',enum:['a','b']},maxElements:{type:'integer',minimum:1,maximum:150}},
   required:['pid','windowId'],additionalProperties:false},annotations:readOnly},
 {name:'workspace_window_preview',description:'Return one read-only captured frame of exactly one window for a spectator. The image is noninteractive and cannot steer mouse/keyboard or replace action snapshot.',inputSchema:{
   type:'object',properties:{pid:{type:'integer',minimum:1},windowId:{type:'integer',minimum:1},
     workspaceSeat:{type:'string',enum:['a','b']}},
   required:['pid','windowId'],additionalProperties:false},annotations:readOnly},
 {name:'workspace_window_click',description:'One element-bound background click on exact window via same-user Cua Driver. Never uses SendInput or foreground fallback. Unknown effect reconciles only that target; no blind retry.',inputSchema:{
   type:'object',properties:{pid:{type:'integer',minimum:1},windowId:{type:'integer',minimum:1},
     workspaceSeat:{type:'string',enum:['a','b']},elementToken:{type:'string',pattern:'^s[0-9a-f]{8}:[0-9]+$'},
     requestId:{type:'string',minLength:8,maxLength:128},explicitUserAuthorization:{type:'string',minLength:12,maxLength:512}},
   required:['pid','windowId','elementToken','requestId','explicitUserAuthorization'],additionalProperties:false},annotations:mutating},
 {name:'workspace_browser_inspect',description:'Inspect one exactly-identified, already logged-in Chromium browser window using the owning user Cua Driver. Does not export cookies or passwords.',inputSchema:{
   type:'object',properties:{pid:{type:'integer',minimum:1},windowId:{type:'integer',minimum:1}},
   required:['pid','windowId'],additionalProperties:false},annotations:readOnly},
 {name:'workspace_browser_attach',description:'Request browser-native consent to attach the exact existing same-user browser window, in background only. Existing-profile Cua Driver launch authorization is still enforced; no profile copies.',inputSchema:{
   type:'object',properties:{pid:{type:'integer',minimum:1},windowId:{type:'integer',minimum:1},
    explicitUserAuthorization:{type:'string',minLength:12,maxLength:512}},
   required:['pid','windowId','explicitUserAuthorization'],additionalProperties:false},annotations:mutating},
 {name:'workspace_browser_click',description:'Background-only CDP click in one exact existing browser tab bound to a prior browser inspection. No focus change, user profile copy or forced foreground fallback.',inputSchema:{
   type:'object',properties:{pid:{type:'integer',minimum:1},windowId:{type:'integer',minimum:1},
    targetId:{type:'string',minLength:1,maxLength:128},tabId:{type:'string',minLength:1,maxLength:128},
    ref:{type:'string',minLength:2,maxLength:128},requestId:{type:'string',minLength:8,maxLength:128},
    explicitUserAuthorization:{type:'string',minLength:12,maxLength:512}},
   required:['pid','windowId','targetId','tabId','ref','requestId','explicitUserAuthorization'],
   additionalProperties:false},annotations:mutating},
 {name:'workspace_target_reconcile',description:'Acknowledge only one uncertain target after a fresh observation. No action is replayed and no other app is affected.',inputSchema:{
   type:'object',properties:{pid:{type:'integer',minimum:1},windowId:{type:'integer',minimum:1},
     snapshotId:{type:'string',pattern:'^[sb][0-9a-f]{8}$'},
     surface:{type:'string',enum:['window','browser']},workspaceSeat:{type:'string',enum:['a','b']},
     targetGoneVerified:{type:'boolean'},
     determination:{type:'string',enum:['EFFECT_OBSERVED','NO_EFFECT_OBSERVED']}},
   required:['pid','windowId','determination'],additionalProperties:false},annotations:mutating}
];
export function createWorkspaceController({callDriver=defaultCuaCall,nativeCall=defaultNativeUIACall,previewDriver=defaultCuaPreview,ownerSession=defaultOwnerSession,
  platform=process.platform,env=process.env,now=Date.now,journal=createWorkspaceTargetJournal()}={}){
 const pending=new Map(),seen=new Set(),busy=new Set(),snapshots=new Map(),browserSnapshots=new Map(),nativeSnapshots=new Map();
 const needsOwner=async()=>{if(!await ownerSession({platform,env}))throw fail('WORKSPACE_OWNER_SESSION_REQUIRED');};
 async function execute(name,input={}){
  const seat=input.workspaceSeat??null;
  if(seat!==null&&(platform!=='linux'||!['a','b'].includes(seat)))throw fail('WORKSPACE_SEAT_INVALID');
  const call=(tool,args)=>callDriver(tool,args,{platform,env,workspaceSeat:seat});
  if(seat!==null&&name.startsWith('workspace_browser_'))throw fail('WORKSPACE_BROWSER_PRIVATE_SEAT_UNSUPPORTED');
  if(name==='workspace_plan'){
   const owner=await ownerSession({platform,env});
   return chooseWorkspaceRoute({...input,sameUserSession:owner,desktop:desktopType(platform,env)});
  }
  if(name==='workspace_agentos_plan'){
   const owner=await ownerSession({platform,env});
   let nativeAvailable=false;
   if(platform==='win32'){
    try{await fs.access(new URL('../tools/native-windows-uia.ps1',import.meta.url));nativeAvailable=true;}catch{}
   }
   const {chooseAgentOSProvider}=await import('./agentos-provider-router.mjs');
   return chooseAgentOSProvider({target:input.target,platform,ownerSession:owner,
    capabilities:{windowsUIA:nativeAvailable,linuxATSPI:platform==='linux'&&!!env.XDG_RUNTIME_DIR,
      commanderOwnedBrowser:true,commanderWorkflow:true},
    grants:{browserProfileAttach:input.existingProfileGrant===true,
      visualFallback:input.visualFallbackAuthorized===true}});
  }
  await needsOwner();
  if(name==='workspace_list_windows'){
   const request={};if(input.pid!==undefined){if(!integer(input.pid))throw fail('WORKSPACE_PID_INVALID');request.pid=input.pid;}
   const value=await call('list_windows',request);
   return {ok:true,mode:'READ_ONLY',focusChanged:false,value};
  }
  if(!exactWindow(input))throw fail('WORKSPACE_TARGET_INVALID');
  const id=(seat?seat+':':'')+targetId(input.pid,input.windowId);
  const session='rcws-'+(seat?seat+'-':'')+input.pid+'-'+input.windowId;
  if(name==='workspace_native_ui_observe'||name==='workspace_native_ui_invoke'){
   if(seat!==null||platform!=='win32')throw fail('AGENTOS_NATIVE_OWNER_WINDOWS_REQUIRED');
   if(name==='workspace_native_ui_observe'){
    const value=await nativeCall('Observe',input,{platform,env});
    const indexed=new Map();
    for(const e of value.elements??[]){
     if(e.invokeAvailable===true&&e.enabled===true&&typeof e.fingerprint==='string')
      indexed.set(e.fingerprint,e.name);
    }
    nativeSnapshots.set(id,{at:now(),elements:indexed});
    return {ok:true,mode:'NATIVE_UIA_READ_ONLY',target:id,provider:'windows-uia-native',
      physicalInputTouched:false,focusChanged:false,value};
   }
   if(typeof input.requestId!=='string'||!REQUEST.test(input.requestId)||
      typeof input.fingerprint!=='string'||!/^[a-f0-9]{24}$/.test(input.fingerprint)||
      typeof input.controlName!=='string'||input.controlName.length<1||
      typeof input.explicitUserAuthorization!=='string'||input.explicitUserAuthorization.trim().length<12)
     throw fail('AGENTOS_NATIVE_INVOKE_CONTRACT_INVALID');
   if(seen.has(input.requestId))throw fail('WORKSPACE_DUPLICATE_REQUEST_NO_REPLAY');
   if(busy.has(id)||pending.has(id)||await journal.pending('native:'+id))
     throw fail('WORKSPACE_TARGET_RECONCILIATION_REQUIRED');
   const snap=nativeSnapshots.get(id);
   if(!snap||now()-snap.at>60000||snap.elements.get(input.fingerprint)!==input.controlName)
     throw fail('AGENTOS_FRESH_EXACT_UIA_ELEMENT_REQUIRED');
   seen.add(input.requestId);busy.add(id);nativeSnapshots.delete(id);
   let handle=null;
   try{
    handle=await journal.begin('native:'+id,name,input.requestId);
    const result=await nativeCall('Invoke',input,{platform,env});
    // InvokePattern acknowledged exactly one native action, NOT the application goal.
    // Consume the durable journal; any transport-uncertain path remains pending below.
    await journal.resolve('native:'+id,handle);
    return {ok:true,mode:'NATIVE_UIA_INVOKE_ISSUED',target:id,
      provider:'windows-uia-native',replayed:false,physicalInputTouched:false,
      focusChanged:false,invocationIssued:result.invocationIssued===true,
      decision:{status:'INVOKE_ACKNOWLEDGED',userGoalVerified:false,
        next:'Verify the application-specific result before any new effect'}};
   }catch(error){
    if(!handle)throw error;
    pending.set('native:'+id,{requestId:input.requestId,at:now()});
    return {ok:false,mode:'NATIVE_UIA_OUTCOME_UNCERTAIN',target:id,replayed:false,
      code:error?.code??'AGENTOS_NATIVE_OUTCOME_UNCERTAIN'};
   }finally{busy.delete(id);}
  }
  if(name==='workspace_window_preview'){
   const image=await previewDriver({pid:input.pid,window_id:input.windowId,
     session:'rcws-view-'+(seat?seat+'-':'')+input.pid+'-'+input.windowId},{platform,env,workspaceSeat:seat});
   const encoded=image.imageBytes.toString('base64');
   const details={ok:true,mode:'READ_ONLY_SPECTATOR',target:id,focusChanged:false,
     physicalInputTouched:false,interactiveInput:false,bytes:image.imageBytes.length};
   return {__mcpContent:[{type:'image',mimeType:'image/png',data:encoded},
     {type:'text',text:JSON.stringify(details)}],__structuredContent:details};
  }
  if(name==='workspace_window_observe'){
   const v=await call('get_window_state',{pid:input.pid,window_id:input.windowId,
     include_screenshot:false,tree_format:'elements',max_elements:Math.min(input.maxElements??50,150),timeout_ms:4000,
     session});
   const sid=v?.snapshot_id??v?.snapshotId;
   if(typeof sid==='string'&&/^s[0-9a-f]{8}$/.test(sid))snapshots.set(id,{id:sid,at:now()});
   return {ok:true,mode:'READ_ONLY',focusChanged:false,targetUncertain:pending.has(id)||!!await journal.pending(id),
     snapshotId:sid??null,value:v};
  }
  if(name==='workspace_browser_inspect'){
   const session='rcws-'+input.pid+'-'+input.windowId;
   // A previously ended CUA lifecycle name cannot be silently reused.
   await call('start_session',{session});
   const v=await call('get_browser_state',{pid:input.pid,window_id:input.windowId,
     session});
   if(v?.status==='refused'||v?.refusal?.code)
    return {ok:false,mode:'BACKGROUND_READ_ONLY',scope:'TARGET_ONLY',
      code:v?.refusal?.code??'BROWSER_SETUP_REQUIRED',focusChanged:false,
      next:'AUTHORIZED_BROWSER_PREPARE_REQUIRED'};
   const stamp='b'+randomBytes(4).toString('hex');
   browserSnapshots.set(id,{at:now(),target:v?.target_id??v?.targetId??null,snapshotId:stamp});
   return {ok:true,mode:'BACKGROUND_READ_ONLY',focusChanged:false,snapshotId:stamp,
     targetUncertain:pending.has('browser:'+id)||!!await journal.pending('browser:'+id),value:v};
  }
  if(name==='workspace_browser_attach'){
   if(typeof input.explicitUserAuthorization!=='string'||input.explicitUserAuthorization.trim().length<12)
     throw fail('WORKSPACE_EXPLICIT_AUTHORIZATION_REQUIRED');
   try{
     const session='rcws-'+input.pid+'-'+input.windowId;
     await call('start_session',{session});
     const v=await call('browser_prepare',{pid:input.pid,window_id:input.windowId,
       strategy:{kind:'existing_profile'},delivery_mode:'background',
       session});
     if(v?.status==='refused'||v?.refusal?.code)
      return {ok:false,status:'PROFILE_ATTACH_NOT_READY',scope:'TARGET_ONLY',
       errorCode:v?.refusal?.code??'WORKSPACE_BROWSER_ATTACH_REFUSED',focusChanged:false};
     return {ok:true,mode:'OWNER_AUTHORIZED_EXISTING_PROFILE',focusChanged:false,
       physicalInputTouched:false,value:v};
   }catch(e){
     return {ok:false,status:'PROFILE_ATTACH_NOT_READY',scope:'TARGET_ONLY',
       errorCode:e?.code??'WORKSPACE_BROWSER_ATTACH_REFUSED',
       instruction:'Same-owner Cua Driver must have existing-profile grant and browser-native consent; no fallback to focus, copies or credentials'};
   }
  }
  if(name==='workspace_browser_click'){
   if(typeof input.explicitUserAuthorization!=='string'||input.explicitUserAuthorization.trim().length<12)
     throw fail('WORKSPACE_EXPLICIT_AUTHORIZATION_REQUIRED');
   if(typeof input.requestId!=='string'||!REQUEST.test(input.requestId)||typeof input.ref!=='string'||!/^p[A-Za-z0-9:_-]{2,127}$/.test(input.ref))
     throw fail('WORKSPACE_BINDING_INVALID');
   const key='browser:'+id;
   if(seen.has(input.requestId))throw fail('WORKSPACE_DUPLICATE_REQUEST_NO_REPLAY');
   if(pending.has(key)||await journal.pending(key))throw fail('WORKSPACE_TARGET_RECONCILIATION_REQUIRED');
   const b=browserSnapshots.get(id);
   if(!b||now()-b.at>60000||(b.target!==null&&b.target!==input.targetId))
     throw fail('WORKSPACE_FRESH_SNAPSHOT_REQUIRED');
   if(busy.has(key))throw fail('WORKSPACE_TARGET_BUSY');
   seen.add(input.requestId);busy.add(key);browserSnapshots.delete(id);
   let handle=null;
   try{
     handle=await journal.begin(key,'workspace_browser_click',input.requestId);
     const v=await call('browser_click',{target_id:input.targetId,tab_id:input.tabId,
       ref:input.ref,delivery_mode:'background',session:'rcws-'+input.pid+'-'+input.windowId});
     const refused=v?.status==='refused'&&typeof v?.refusal?.code==='string';
   if(refused){await journal.resolve(key,handle);return {ok:false,mode:'BACKGROUND_BROWSER_TARGETED',
     status:'REFUSED_NO_EFFECT',code:v.refusal.code,scope:'TARGET_ONLY',replayed:false,
     next:v.refusal.code==='stale_element_token'?'REFRESH_SNAPSHOT':'SELECT_NONFOREGROUND_ALTERNATIVE'};}
   const decision=classifyWorkspaceOutcome({effect:v?.effect,
       refusedCode:v?.code??v?.error,hasFreshObservation:v?.verified===true});
     if(decision.status==='RECONCILE_TARGET')pending.set(key,{requestId:input.requestId,at:now()});
     else await journal.resolve(key,handle);
     return {ok:v?.ok!==false,mode:'BACKGROUND_BROWSER_TARGETED',focusChanged:false,
       physicalInputTouched:false,decision,verified:v?.verified===true};
   }catch(e){
     if(!handle)throw e;
     pending.set(key,{requestId:input.requestId,at:now()});
     return {ok:false,target:key,errorCode:e?.code??'WORKSPACE_BROWSER_ACTION_UNKNOWN',
       status:'RECONCILE_TARGET',scope:'TARGET_ONLY',replayed:false,otherTargetsUnaffected:true};
   }finally{busy.delete(key);}
  }
  if(name==='workspace_target_reconcile'){
   const isBrowser=input.surface==='browser',key=isBrowser?'browser:'+id:id;
   const p=await journal.pending(key),shot=isBrowser?browserSnapshots.get(id):snapshots.get(id);
   if(!p)throw fail('WORKSPACE_NO_TARGET_INCIDENT');
   if(!['EFFECT_OBSERVED','NO_EFFECT_OBSERVED'].includes(input.determination))throw fail('WORKSPACE_DETERMINATION_INVALID');
   if(input.targetGoneVerified===true){
    // Only owner-private X11 seat: prove the former exact window is no longer
    // enumerated by the SAME live independent native driver; no input replay.
    if(isBrowser||(!seat&&platform!=='win32')||input.determination!=='EFFECT_OBSERVED')
     throw fail('WORKSPACE_TARGET_GONE_PROOF_DENIED');
    const native=await call('list_windows',{pid:input.pid});
    if(!Array.isArray(native?.windows)||
       native.windows.some(w=>w?.pid===input.pid&&w?.window_id===input.windowId))
     throw fail('WORKSPACE_TARGET_GONE_NOT_PROVEN');
   }else if(!shot||(isBrowser?shot.snapshotId:shot.id)!==input.snapshotId||
             now()-shot.at>60000)
    throw fail('WORKSPACE_FRESH_SNAPSHOT_REQUIRED');
   await journal.resolve(key,p);
   pending.delete(key);return {ok:true,target:key,determination:input.determination,replayed:false,
     noGlobalInputLock:true,otherTargetsUnaffected:true};
  }
  if(name!=='workspace_window_click')throw fail('WORKSPACE_TOOL_UNKNOWN');
  if(typeof input.explicitUserAuthorization!=='string'||input.explicitUserAuthorization.trim().length<12)
    throw fail('WORKSPACE_EXPLICIT_AUTHORIZATION_REQUIRED');
  if(!TOKEN.test(input.elementToken)||typeof input.requestId!=='string'||!REQUEST.test(input.requestId))throw fail('WORKSPACE_BINDING_INVALID');
  if(seen.has(input.requestId))throw fail('WORKSPACE_DUPLICATE_REQUEST_NO_REPLAY');
  if(pending.has(id)||await journal.pending(id))throw fail('WORKSPACE_TARGET_RECONCILIATION_REQUIRED');
  if(busy.has(id))throw fail('WORKSPACE_TARGET_BUSY');
  const shot=snapshots.get(id);
  if(!shot||now()-shot.at>60000||!input.elementToken.startsWith(shot.id+':'))
    throw fail('WORKSPACE_FRESH_SNAPSHOT_REQUIRED');
  seen.add(input.requestId);busy.add(id);snapshots.delete(id);
  let handle=null;
  try{
   handle=await journal.begin(id,'workspace_window_click',input.requestId);
   const effect=await call('click',{target:{kind:'window',pid:input.pid,window_id:input.windowId},
     element_token:input.elementToken,delivery_mode:'background',
     session:'rcws-'+input.pid+'-'+input.windowId});
   const refused=effect?.status==='refused'&&typeof effect?.refusal?.code==='string';
   if(refused){await journal.resolve(id,handle);return {ok:false,mode:'BACKGROUND_TARGETED',status:'REFUSED_NO_EFFECT',
     code:effect.refusal.code,scope:'TARGET_ONLY',replayed:false,
     next:effect.refusal.code==='stale_element_token'?'REFRESH_SNAPSHOT':'SELECT_NONFOREGROUND_ALTERNATIVE'};}
   const decision=classifyWorkspaceOutcome({effect:effect?.effect,
      refusedCode:effect?.code??effect?.error,hasFreshObservation:effect?.verified===true});
   if(decision.status==='RECONCILE_TARGET'&&effect?.effect==='unverifiable'){
    // Independent exact-window read. Confirms target disappearance only,
    // not the higher-level user goal; never repeats the uncertain action.
    try{
     const native=await call('list_windows',{pid:input.pid});
     if(Array.isArray(native?.windows)&&
        !native.windows.some(w=>w?.pid===input.pid&&w?.window_id===input.windowId)){
      await journal.resolve(id,handle);
      return {ok:true,mode:'BACKGROUND_TARGETED',physicalInputTouched:false,
       focusChanged:false,target:id,replayed:false,verifiedTargetGone:true,
       decision:{status:'TARGET_GONE_VERIFIED',scope:'TARGET_ONLY',
        userGoalVerified:false,retry:'NOT_APPLICABLE_TARGET_GONE'},
       driverEffect:effect.effect};
     }
    }catch{ /* Fail closed for this target; other targets continue. */ }
   }
   if(decision.status==='RECONCILE_TARGET')pending.set(id,{requestId:input.requestId,at:now()});
   else await journal.resolve(id,handle);
   return {ok:true,mode:'BACKGROUND_TARGETED',physicalInputTouched:false,focusChanged:false,
     target:id,decision,driverEffect:effect?.effect??'unknown',verified:effect?.verified===true};
  }catch(error){
   if(!handle)throw error;
   pending.set(id,{requestId:input.requestId,at:now()});
   return {ok:false,target:id,decision:classifyWorkspaceOutcome(),errorCode:error?.code??'WORKSPACE_ACTION_UNKNOWN',
     noGlobalInputLock:true,otherTargetsUnaffected:true,replayed:false};
  }finally{busy.delete(id);}
 }
 return {execute};
}
const singleton=createWorkspaceController();
export function assertWorkspaceToolPolicy(config,name,args={}){
 const power=config?.powerMode;
 if(power?.enabled!==true)throw fail('WORKSPACE_POWER_MODE_DISABLED');
 if(name==='workspace_plan'||name==='workspace_agentos_plan')return;
 const browser=name.startsWith('workspace_browser_')||
  (name==='workspace_target_reconcile'&&args?.surface==='browser');
 if(browser){
  if(power.browserControl?.enabled!==true)throw fail('WORKSPACE_BROWSER_CONTROL_DISABLED');
  if(['workspace_browser_attach','workspace_browser_click','workspace_target_reconcile'].includes(name)&&
    power.browserControl?.allowInput!==true)throw fail('WORKSPACE_BROWSER_INPUT_POLICY_DENIED');
 }else{
  if(power.guiControl?.enabled!==true)throw fail('WORKSPACE_GUI_CONTROL_DISABLED');
  if(name==='workspace_window_preview'&&power.guiControl?.allowScreenshot!==true)
    throw fail('WORKSPACE_GUI_PREVIEW_POLICY_DENIED');
  if(['workspace_window_click','workspace_native_ui_invoke','workspace_target_reconcile'].includes(name)&&
    power.guiControl?.allowMouse!==true)throw fail('WORKSPACE_GUI_INPUT_POLICY_DENIED');
 }
}
export async function executeWorkspaceTool(ctx,name,args){
 assertWorkspaceToolPolicy(ctx?.config,name,args);
 return singleton.execute(name,args);
}
