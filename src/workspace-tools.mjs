// Target-scoped background workspace bridge. Never sends physical desktop input.
// CUA runs in the owning interactive account; an inaccessible owner daemon is a
// capability result, not a reason to bypass named-pipe ACL or alter GUI policy.
import os from 'node:os';
import fs from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chooseWorkspaceRoute,classifyWorkspaceOutcome} from './workspace-routing.mjs';
import {createWorkspaceTargetJournal} from './workspace-target-journal.mjs';
const execFileAsync=promisify(execFile);
const targetId=(pid,windowId)=>pid+':'+windowId;
const integer=(n)=>Number.isSafeInteger(n)&&n>0;
const TOKEN=/^s[0-9a-f]{8}:[0-9]+$/;
const REQUEST=/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

// The outer durable MCP idempotency guard owns requestId and excludes it from the
// effect payload. The two native Workspace journals still need that SAME receipt ID.
// Forward it only to those effects, never to unrelated/readonly operations.
// The historical workspace_target_reconcile name belongs to the background
// Workspace journal, not to the newer workspace_target_* GUI adapter.
export function isOwnerBackgroundWorkspaceTool(name){
 return name==='workspace_target_reconcile'||
  (typeof name==='string'&&name.startsWith('workspace_')&&!name.startsWith('workspace_target_'));
}

export function workspaceMutationEffectArgs(name,args,requestId){
 if(!['workspace_window_click','workspace_window_type','workspace_word_render','workspace_browser_click','workspace_app_open','workspace_app_reconcile'].includes(name))return args;
 if(typeof requestId!=='string'||!REQUEST.test(requestId))
  throw fail('WORKSPACE_BINDING_INVALID');
 return {...args,requestId};
}

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
     existingProfileGrant:{type:'boolean'},backgroundCapability:{type:'boolean'},
     requireExistingAuthentication:{type:'boolean'},
     browserEngine:{type:'string',enum:['chrome','edge','brave','firefox','unknown']}},
   required:['target'],additionalProperties:false},annotations:readOnly},
 {name:'workspace_login_readiness',description:'Read-only same-owner app/browser window readiness for saved-login reuse. NEVER reads password stores, autofill values, cookies, tokens or login status; non-observation is not proof credentials are missing.',inputSchema:{
   type:'object',properties:{target:{type:'string',enum:['existing-browser','new-browser','existing-app','new-app']},
     pid:{type:'integer',minimum:1},windowId:{type:'integer',minimum:1},
     browserEngine:{type:'string',enum:['chrome','edge','brave','firefox','unknown']}},
   required:['target'],additionalProperties:false},annotations:readOnly},
 {name:'workspace_app_catalog',description:'Read-only list of owner-installed applications and running status, without launcher command lines or authentication contents.',inputSchema:{
    type:'object',properties:{query:{type:'string',minLength:1,maxLength:100}},
    additionalProperties:false},annotations:readOnly},
 {name:'workspace_app_open',description:'Open an exact installed app from the native owner app catalog, minimized and without bringing it forward. Reuse running app; never copy a browser profile. Uncertain launch needs explicit reconciliation.',inputSchema:{
    type:'object',properties:{name:{type:'string',minLength:1,maxLength:128},
      requestId:{type:'string',minLength:8,maxLength:128},
      explicitUserAuthorization:{type:'string',minLength:12,maxLength:512}},
    required:['name','requestId','explicitUserAuthorization'],additionalProperties:false},annotations:mutating},
 {name:'workspace_app_reconcile',description:'Reconcile one uncertain owner-app launch from the native app catalog without replaying its launch.',inputSchema:{
    type:'object',properties:{name:{type:'string',minLength:1,maxLength:128},
      determination:{type:'string',enum:['RUNNING_VERIFIED','NOT_RUNNING_VERIFIED']},
      requestId:{type:'string',minLength:8,maxLength:128},
      explicitUserAuthorization:{type:'string',minLength:12,maxLength:512}},
    required:['name','determination','requestId','explicitUserAuthorization'],additionalProperties:false},annotations:mutating},
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
 {name:'workspace_window_type',description:'Type supplied non-sensitive text into one verified editable element of an exact owner window, background only. Unknown effect is journaled; never replay automatically.',inputSchema:{
   type:'object',properties:{pid:{type:'integer',minimum:1},windowId:{type:'integer',minimum:1},
     workspaceSeat:{type:'string',enum:['a','b']},elementToken:{type:'string',pattern:'^s[0-9a-f]{8}:[0-9]+$'},
     text:{type:'string',minLength:1,maxLength:2048},requestId:{type:'string',minLength:8,maxLength:128},
     explicitUserAuthorization:{type:'string',minLength:12,maxLength:512}},
   required:['pid','windowId','elementToken','text','requestId','explicitUserAuthorization'],additionalProperties:false},annotations:mutating},
 {name:'workspace_word_render',description:'Render a local DOCX to a new PDF using Microsoft Word in the authenticated interactive owner session. No SYSTEM/Session 0 fallback, macros or overwrite.',inputSchema:{
    type:'object',properties:{sourcePath:{type:'string',minLength:6,maxLength:2048},outputPdfPath:{type:'string',minLength:6,maxLength:2048},
      requestId:{type:'string',minLength:8,maxLength:128},explicitUserAuthorization:{type:'string',minLength:12,maxLength:512}},
    required:['sourcePath','outputPdfPath','requestId','explicitUserAuthorization'],additionalProperties:false},annotations:mutating},
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
export function createWorkspaceController({callDriver=defaultCuaCall,previewDriver=defaultCuaPreview,ownerSession=defaultOwnerSession,
  platform=process.platform,env=process.env,now=Date.now,journal=createWorkspaceTargetJournal()}={}){
 const pending=new Map(),seen=new Set(),busy=new Set(),snapshots=new Map(),browserSnapshots=new Map();
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
  await needsOwner();
  if(name==='workspace_app_catalog'||name==='workspace_app_open'||name==='workspace_app_reconcile'){
   if(!['win32','linux'].includes(platform)||seat!==null)throw fail('WORKSPACE_APP_LAUNCH_PLATFORM_UNAVAILABLE');
   const listed=await call('list_apps',{});
   const catalog=Array.isArray(listed)?listed:Array.isArray(listed?.apps)?listed.apps:
     Array.isArray(listed?.applications)?listed.applications:null;
   if(!catalog)throw fail('WORKSPACE_APP_CATALOG_UNAVAILABLE');
   const entries=catalog.filter(a=>a&&typeof a.name==='string'&&
     a.name.length>0&&a.name.length<=128&&['desktop','uwp'].includes(a.kind));
   if(name==='workspace_app_catalog'){
     const query=typeof input.query==='string'?input.query.toLocaleLowerCase().trim():'';
     return {ok:true,mode:'READ_ONLY_SAME_OWNER',
       apps:entries.filter(a=>!query||a.name.toLocaleLowerCase().includes(query))
         .slice(0,100).map(a=>({name:a.name,kind:a.kind,running:a.running===true,
           pid:integer(a.pid)?a.pid:0})),hasMore:entries.length>100,
       credentials:'NOT_READ',focusChanged:false};
   }
   if(typeof input.explicitUserAuthorization!=='string'||
      input.explicitUserAuthorization.trim().length<12)
      throw fail('WORKSPACE_EXPLICIT_AUTHORIZATION_REQUIRED');
   if(!REQUEST.test(input.requestId)||typeof input.name!=='string'||input.name.trim()!==input.name||
      input.name.length>128||!(/^[\p{L}\p{N}][\p{L}\p{N} ._()+\-!]{0,127}$/u).test(input.name))
      throw fail('WORKSPACE_APP_IDENTITY_INVALID');
   const matches=entries.filter(a=>a.name.toLocaleLowerCase()===input.name.toLocaleLowerCase());
   if(matches.length!==1)throw fail(matches.length===0?'WORKSPACE_APP_NOT_IN_OWNER_CATALOG':'WORKSPACE_APP_NAME_AMBIGUOUS');
   const app=matches[0],key='app:'+createHash('sha256').update(app.name.toLocaleLowerCase(),'utf8').digest('hex');
   if(name==='workspace_app_reconcile'){
     if(!['RUNNING_VERIFIED','NOT_RUNNING_VERIFIED'].includes(input.determination))
       throw fail('WORKSPACE_APP_DETERMINATION_INVALID');
     const pendingApp=await journal.pending(key);
     if(!pendingApp||pendingApp.action!=='workspace_app_open')
       throw fail('WORKSPACE_NO_TARGET_INCIDENT');
     const observed=app.running===true&&integer(app.pid);
     if(input.determination==='RUNNING_VERIFIED'&&!observed||
        input.determination==='NOT_RUNNING_VERIFIED'&&app.running!==false)
       throw fail('WORKSPACE_APP_DETERMINATION_NOT_PROVEN');
     await journal.resolve(key,pendingApp);
     return {ok:true,mode:'OWNER_NATIVE_APP_RECONCILE',name:app.name,
       determination:input.determination,replayed:false,
       focusChanged:'NOT_ASSESSED',passwordRequested:false};
   }
   if(seen.has(input.requestId))throw fail('WORKSPACE_DUPLICATE_REQUEST_NO_REPLAY');
   if(await journal.pending(key))throw fail('WORKSPACE_TARGET_RECONCILIATION_REQUIRED');
   if(busy.has(key))throw fail('WORKSPACE_TARGET_BUSY');
   if(app.running===true&&!integer(app.pid))throw fail('WORKSPACE_APP_RUNNING_UNVERIFIED');
   if(app.running===true&&integer(app.pid))
     return {ok:true,status:'ALREADY_RUNNING',name:app.name,pid:app.pid,
       launchAttempted:false,credentials:'OWNER_PROFILE_UNCHANGED',focusChanged:false};
   // Only trusted installed-app catalog entries are launchable; caller may
   // never supply path, arguments, URL, browser flags or credentials.
   const launchArgs=platform==='linux'&&app.kind==='desktop'?
     {name:app.name}:
     platform==='win32'&&app.kind==='uwp'&&typeof app.aumid==='string'&&app.aumid.includes('!')?
     {aumid:app.aumid,start_minimized:true}:
     platform==='win32'&&typeof app.launch_path==='string'&&app.launch_path.length<2048?
     {launch_path:app.launch_path,start_minimized:true}:null;
   if(!launchArgs)throw fail('WORKSPACE_APP_LAUNCH_PATH_UNVERIFIED');
   seen.add(input.requestId);busy.add(key);
   let handle=null;
   try{
     handle=await journal.begin(key,'workspace_app_open',input.requestId);
     const started=await call('launch_app',launchArgs);
     if(started?.status==='refused'&&typeof started?.refusal?.code==='string'){
       await journal.resolve(key,handle);
       return {ok:false,status:'REFUSED_NO_EFFECT',code:started.refusal.code,replayed:false};
     }
     // A process returning from ShellExecute is not evidence of signed-in state.
     const check=await call('list_apps',{});
     const list=Array.isArray(check)?check:Array.isArray(check?.apps)?check.apps:
       Array.isArray(check?.applications)?check.applications:null;
     const matches2=Array.isArray(list)?list.filter(a=>a&&typeof a.name==='string'&&
       a.name.toLocaleLowerCase()===app.name.toLocaleLowerCase()):[];
     const after=matches2.length===1?matches2[0]:null;
     if(after?.running!==true||!integer(after?.pid)||
       integer(started?.pid)&&started.pid!==after.pid)
       return {ok:false,status:'RECONCILE_TARGET',name:app.name,replayed:false,
         reason:'OWNER_APP_LAUNCH_NOT_INDEPENDENTLY_VERIFIED'};
     await journal.resolve(key,handle);
     return {ok:true,status:'LAUNCHED_OWNER_PROFILE',name:app.name,pid:after.pid,
       launchAttempted:true,credentials:'OWNER_PROFILE_UNCHANGED',
       authentication:'UNVERIFIED',passwordRequested:false,
       foreground:'PRESERVE_REQUESTED_NOT_VERIFIED',replayed:false};
   }catch(error){
     if(!handle)throw error;
     return {ok:false,status:'RECONCILE_TARGET',name:app.name,replayed:false,
       errorCode:error?.code??'WORKSPACE_APP_LAUNCH_UNKNOWN'};
   }finally{busy.delete(key);}
  }
  if(name==='workspace_login_readiness'){
   const target=input.target;
   if(!['existing-browser','new-browser','existing-app','new-app'].includes(target))
     throw fail('WORKSPACE_TARGET_INVALID');
   if((input.pid===undefined)!==(input.windowId===undefined))
     throw fail('WORKSPACE_EXACT_WINDOW_ID_REQUIRED');
   if(input.pid!==undefined&&!exactWindow(input))
     throw fail('WORKSPACE_TARGET_INVALID');
   // A native owner process and window can be detected without reading any
   // credential store. No mere window listing proves website sign-in.
   const raw=await call('list_windows',input.pid?{pid:input.pid}:{});
   const windows=Array.isArray(raw?.windows)?raw.windows:null;
   const exact=windows&&input.pid!==undefined?
     windows.some(w=>w?.pid===input.pid&&
       (w?.window_id===input.windowId||w?.windowId===input.windowId)):false;
   const observation=windows===null?'UNVERIFIED':
     input.pid===undefined?'NO_EXACT_WINDOW_SELECTED':
     exact?'EXACT_WINDOW_PRESENT':'EXACT_WINDOW_NOT_OBSERVED';
   return {ok:true,mode:'READ_ONLY_SAME_OWNER',target,observation,
     authentication:'UNVERIFIED',savedCredentials:'NOT_INSPECTED',
     loginAbsenceVerified:false,passwordRequested:false,
     nativeApprovalRequired:true,credentialContentsRead:false,
     browserProfileCloned:false,focusChanged:false,physicalInputTouched:false,
     plan:chooseWorkspaceRoute({target,
       desktop:desktopType(platform,env),sameUserSession:true,
       requireExistingAuthentication:true,browserEngine:input.browserEngine}),
     next:observation==='EXACT_WINDOW_PRESENT'?
       'Verify app-specific login state through the authorized owner UI; do not access credentials':
       'Select an exact same-user window or use a supported native owner launcher; never infer missing passwords'};
  }
  if(name==='workspace_list_windows'){
   const request={};if(input.pid!==undefined){if(!integer(input.pid))throw fail('WORKSPACE_PID_INVALID');request.pid=input.pid;}
   const value=await call('list_windows',request);
   return {ok:true,mode:'READ_ONLY',focusChanged:false,value};
  }
  if(!exactWindow(input))throw fail('WORKSPACE_TARGET_INVALID');
  const id=(seat?seat+':':'')+targetId(input.pid,input.windowId);
  const session='rcws-'+(seat?seat+'-':'')+input.pid+'-'+input.windowId;
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
   if(typeof sid==='string'&&/^s[0-9a-f]{8}$/.test(sid)){
    // Cache only the short-lived IDs of safely identified editable elements.
    // Never retain their values or raw text in the journal or snapshot cache.
    const editable=new Set();
    for(const el of Array.isArray(v?.elements)?v.elements:[]){
     const token=el?.element_token??el?.elementToken,role=String(el?.role??'');
     const label=String(el?.label??el?.name??'');
     if(typeof token==='string'&&TOKEN.test(token)&&token.startsWith(sid+':')&&
        /edit|text ?box|text field|text area|search|combo ?box/i.test(role)&&
        !/password|passcode|pin|secret|token|credential|otp|2fa/i.test(label)&&
        el?.is_password!==true&&el?.isPassword!==true&&el?.sensitive!==true)
      editable.add(token);
    }
    snapshots.set(id,{id:sid,at:now(),editable});
   }
   return {ok:true,mode:'READ_ONLY',focusChanged:false,targetUncertain:pending.has(id)||!!await journal.pending(id),
     snapshotId:sid??null,value:v};
  }
  if(name==='workspace_browser_inspect'){
   const v=await call('get_browser_state',{pid:input.pid,window_id:input.windowId,
     session:'rcws-'+input.pid+'-'+input.windowId});
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
     const v=await call('browser_prepare',{pid:input.pid,window_id:input.windowId,
       strategy:{kind:'existing_profile'},delivery_mode:'background',
       session:'rcws-'+input.pid+'-'+input.windowId});
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
   if(!REQUEST.test(input.requestId)||typeof input.ref!=='string'||!/^p[A-Za-z0-9:_-]{2,127}$/.test(input.ref))
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
    // A vanished PID can no longer be resolved to an app by bounded CUA policy.
    // Inspect only the separately authorized private seat's own window inventory;
    // never widen physical-desktop or Windows enumeration on this recovery path.
    const native=await call('list_windows',seat?{}:{pid:input.pid});
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
  if(name!=='workspace_window_click'&&name!=='workspace_window_type')throw fail('WORKSPACE_TOOL_UNKNOWN');
  if(typeof input.explicitUserAuthorization!=='string'||input.explicitUserAuthorization.trim().length<12)
    throw fail('WORKSPACE_EXPLICIT_AUTHORIZATION_REQUIRED');
  if(!TOKEN.test(input.elementToken)||!REQUEST.test(input.requestId))throw fail('WORKSPACE_BINDING_INVALID');
  if(name==='workspace_window_type'&&
   (typeof input.text!=='string'||input.text.length<1||input.text.length>2048||
    input.text.includes('\0')))throw fail('WORKSPACE_TEXT_INVALID');
  if(seen.has(input.requestId))throw fail('WORKSPACE_DUPLICATE_REQUEST_NO_REPLAY');
  if(pending.has(id)||await journal.pending(id))throw fail('WORKSPACE_TARGET_RECONCILIATION_REQUIRED');
  if(busy.has(id))throw fail('WORKSPACE_TARGET_BUSY');
  const shot=snapshots.get(id);
  if(!shot||now()-shot.at>60000||!input.elementToken.startsWith(shot.id+':'))
    throw fail('WORKSPACE_FRESH_SNAPSHOT_REQUIRED');
  if(name==='workspace_window_type'&&!shot.editable?.has(input.elementToken))
    throw fail('WORKSPACE_TEXT_TARGET_UNVERIFIED');
  seen.add(input.requestId);busy.add(id);snapshots.delete(id);
  let handle=null;
  try{
   handle=await journal.begin(id,name,input.requestId);
   const target={kind:'window',pid:input.pid,window_id:input.windowId};
   const effect=name==='workspace_window_type'?
    await call('type_text',{target,element_token:input.elementToken,text:input.text,
     delivery_mode:'background',session}):
    await call('click',{target,element_token:input.elementToken,
     delivery_mode:'background',session});
   const refused=effect?.status==='refused'&&typeof effect?.refusal?.code==='string';
   if(refused){await journal.resolve(id,handle);return {ok:false,mode:name==='workspace_window_type'?'BACKGROUND_TEXT_TARGETED':'BACKGROUND_TARGETED',status:'REFUSED_NO_EFFECT',
     code:effect.refusal.code,scope:'TARGET_ONLY',replayed:false,
     next:effect.refusal.code==='stale_element_token'?'REFRESH_SNAPSHOT':'SELECT_NONFOREGROUND_ALTERNATIVE'};}
   const decision=classifyWorkspaceOutcome({effect:effect?.effect,
      refusedCode:effect?.code??effect?.error,hasFreshObservation:effect?.verified===true});
   if(name==='workspace_window_click'&&decision.status==='RECONCILE_TARGET'&&effect?.effect==='unverifiable'){
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
   return {ok:true,mode:name==='workspace_window_type'?'BACKGROUND_TEXT_TARGETED':'BACKGROUND_TARGETED',physicalInputTouched:false,focusChanged:false,
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
 if(name==='workspace_plan')return;
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
  if(name==='workspace_window_click'&&power.guiControl?.allowMouse!==true)
    throw fail('WORKSPACE_GUI_INPUT_POLICY_DENIED');
  if(name==='workspace_window_type'&&power.guiControl?.allowKeyboard!==true)
    throw fail('WORKSPACE_GUI_KEYBOARD_POLICY_DENIED');
  if(name==='workspace_target_reconcile'&&
      power.guiControl?.allowMouse!==true&&power.guiControl?.allowKeyboard!==true)
    throw fail('WORKSPACE_GUI_INPUT_POLICY_DENIED');
 }
}
export async function executeWorkspaceTool(ctx,name,args){
 assertWorkspaceToolPolicy(ctx?.config,name,args);
 if(name==='workspace_word_render')throw fail('WORKSPACE_OWNER_SESSION_REQUIRED');
 return singleton.execute(name,args);
}
