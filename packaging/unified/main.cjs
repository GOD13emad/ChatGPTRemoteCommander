'use strict';
const {app,BrowserWindow,ipcMain,session,shell}=require('electron');
const {createCompanionBridge}=require('./browser-companion-bridge.cjs');
const {validateBundledCompanion}=require('./companion-integrity.cjs');
const {discover,openExtensionManager}=require('./browser-companion-targets.cjs');
const {spawn}=require('node:child_process');
const {createServer}=require('node:net');
const http=require('node:http');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const {validateCore,preparePreviewCore,previewConfig}=require('./pilot-runtime.cjs');

let window=null, child=null, previewPort=null, starting=false, lastError=null;
let chatWindow=null, chatStarting=null, chatExtensionId=null, chatExtensionError=null, companionPopup=null;
let companionBridge=null;
const packagedCore=()=>path.join(app.isPackaged?process.resourcesPath:__dirname,
  app.isPackaged?'core':'.stage/core');

function embeddedCompanionDir(){
  const root=path.join(app.isPackaged?process.resourcesPath:path.join(__dirname,'.stage'),'companion');
  return validateBundledCompanion(root,packagedCore());
}
function companionStatus(){
  return companionBridge?.status()??{
    app:'REMOTE_COMMANDER_CHAT_COMPANION',schema:1,port:41267,
    listening:false,pairedBrowsers:0,observationsReceived:0
  };
}
async function companionStart(){
  if(companionBridge)return companionStatus();
  const candidate=createCompanionBridge();
  await candidate.start();
  companionBridge=candidate;
  if(chatWindow&&!chatWindow.isDestroyed())candidate.observeOwned(chatWindow.webContents.getURL());
  return companionStatus();
}
async function companionStop(){
  const current=companionBridge;
  companionBridge=null;
  if(current)await current.stop();
  return companionStatus();
}
async function companionPairCode(){
  if(!companionBridge)throw Error('COMPANION_NOT_STARTED');
  return companionBridge.newCode();
}
function showCompanionFolder(){
  const manifest=path.join(embeddedCompanionDir(),'manifest.json');
  if(!fs.existsSync(manifest))throw Error('COMPANION_EXTENSION_NOT_PACKAGED');
  shell.showItemInFolder(manifest);
  return {ok:true,ownerActionRequired:true,extensionFolder:path.dirname(manifest)};
}
// A separate, user-launched, owned Chromium session: no copying or unlocking an
// existing browser profile. This never grants Commander Core or J01 privileges.
async function openChatBrowser(){
  if(chatWindow&&!chatWindow.isDestroyed()){chatWindow.show();chatWindow.focus();return {
    ok:true,alreadyOpen:true,extensionLoaded:Boolean(chatExtensionId),
    extensionError:chatExtensionError
  };}
  if(chatStarting)return chatStarting;
  chatStarting=(async()=>{
    const partition='persist:commander-owned-chat';
    const ses=session.fromPartition(partition);
    let extensionDir=null;
    chatExtensionId=null;chatExtensionError=null;
    try{extensionDir=embeddedCompanionDir();}catch{chatExtensionError='COMPANION_SOURCE_NOT_VERIFIED';}
    if(extensionDir)try{
      // Reuse an already-loaded owned extension; no injection into user profiles.
      const prior=ses.extensions.getAllExtensions().find(x=>x.name==='Commander Chat Companion');
      const loaded=prior??await ses.extensions.loadExtension(extensionDir);
      chatExtensionId=loaded.id;
    }catch(error){chatExtensionError='COMPANION_EXTENSION_LOAD_FAILED';}
    ses.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
    const created=new BrowserWindow({
      width:1160,height:810,minWidth:700,minHeight:520,show:true,
      title:'Commander Browser Core — ChatGPT',backgroundColor:'#ffffff',
      webPreferences:{
        partition,nodeIntegration:false,contextIsolation:true,sandbox:true,
        webSecurity:true,webviewTag:false
      }
    });
    chatWindow=created;
    // OAuth providers often use a popup. Keep it in the same isolated
    // Commander-owned session, never the owner's existing browser profile.
    const allowedPopupHosts=new Set([
      'chatgpt.com','chat.openai.com','auth.openai.com',
      'accounts.google.com','login.microsoftonline.com','appleid.apple.com'
    ]);
    created.webContents.setWindowOpenHandler(({url})=>{
      let approved=false;
      try{const u=new URL(url);approved=u.protocol==='https:'&&
        !u.username&&!u.password&&allowedPopupHosts.has(u.hostname);}catch{}
      return approved?{action:'allow',overrideBrowserWindowOptions:{
        webPreferences:{partition,nodeIntegration:false,contextIsolation:true,
          sandbox:true,webSecurity:true,webviewTag:false}
      }}:{action:'deny'};
    });
    const observeCurrent=()=>companionBridge?.observeOwned(created.webContents.getURL());
    created.webContents.on('did-navigate',observeCurrent);
    created.webContents.on('did-navigate-in-page',observeCurrent);
    created.webContents.on('will-navigate',(event,url)=>{
      let ok=false;
      try{const parsed=new URL(url);ok=parsed.protocol==='https:'&&!parsed.username&&!parsed.password;}catch{}
      if(!ok)event.preventDefault();
    });
    created.on('closed',()=>{if(chatWindow===created){chatWindow=null;companionBridge?.observeOwned('about:blank');}});
    try{
      await created.loadURL('https://chatgpt.com/');
    }catch(error){
      // A failed first navigation must not leave a blank window that the
      // next owner click incorrectly reports as an already-open ChatGPT UI.
      if(!created.isDestroyed())created.destroy();
      throw Error('CHAT_BROWSER_NAVIGATION_FAILED');
    }
    return {ok:true,ownedProfile:true,signInByOwner:true,chatUiOpened:true,
      extensionLoaded:Boolean(chatExtensionId),extensionError:chatExtensionError,
      corePrivilegesGranted:false};
  })().finally(()=>{chatStarting=null;});
  return chatStarting;
}
async function openInternalCompanionPopup(){
  if(!chatExtensionId||!chatWindow||chatWindow.isDestroyed())
    throw Error('CHAT_COMPANION_EXTENSION_NOT_LOADED');
  if(companionPopup&&!companionPopup.isDestroyed()){
    companionPopup.show();companionPopup.focus();return {ok:true,alreadyOpen:true};
  }
  const popup=new BrowserWindow({
    width:350,height:360,resizable:false,show:true,
    title:'Commander Chat Companion — Pairing',
    webPreferences:{partition:'persist:commander-owned-chat',sandbox:true,
      contextIsolation:true,nodeIntegration:false,webSecurity:true}
  });
  companionPopup=popup;
  const id=chatExtensionId;
  popup.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  popup.webContents.on('will-navigate',(event,url)=>{
    if(url!=='chrome-extension://'+id+'/popup.html')event.preventDefault();
  });
  popup.on('closed',()=>{if(companionPopup===popup)companionPopup=null;});
  await popup.loadURL('chrome-extension://'+id+'/popup.html');
  return {ok:true,extensionPopup:true,ownerPairingRequired:true};
}
async function monitorSelector(){
  const core=packagedCore();
  validateCore(core);
  return import(pathToFileURL(path.join(core,'src','browser-companion-monitor.mjs')).href);
}
async function migrationPreflight(){
  // Fixed local module only, no user-supplied command, path, or privilege.
  const target=pathToFileURL(path.join(__dirname,'migration-preflight.mjs')).href;
  const {localReport}=await import(target);
  return localReport(process.platform);
}

function status(){
  let source='unavailable', error=null;
  try{source=validateCore(packagedCore()).head;}
  catch(e){error=String(e.message||e);}
  return {version:app.getVersion(),source,platform:process.platform,
    packaged:app.isPackaged,preview:child?'running':starting?'starting':'stopped',
    error,lastError};
}
function freePort(){
  return new Promise((resolve,reject)=>{
    const s=createServer();
    s.once('error',reject);
    s.listen(0,'127.0.0.1',()=>{
      const port=s.address().port;
      s.close(e=>e?reject(e):resolve(port));
    });
  });
}
async function healthCheck(port,timeout=10000){
  const started=Date.now();
  while(Date.now()-started<timeout){
    if(!child)throw Error('UNIFIED_PREVIEW_PROCESS_EXITED');
    const healthy=await new Promise(resolve=>{
      const req=http.get({hostname:'127.0.0.1',port,path:'/health',timeout:800},res=>{
        res.resume();resolve(res.statusCode===200);
      });
      req.on('error',()=>resolve(false));
      req.on('timeout',()=>{req.destroy();resolve(false);});
    });
    if(healthy)return true;
    await new Promise(r=>setTimeout(r,200));
  }
  throw Error('UNIFIED_PREVIEW_HEALTH_TIMEOUT');
}
function stopPreview(){
  const old=child;
  child=null;previewPort=null;
  if(old&&!old.killed){
    old.kill();
    const killer=setTimeout(()=>{try{if(old.exitCode===null)old.kill('SIGKILL');}catch{}},2000);
    killer.unref();
  }
  return {state:'stopped',liveCommanderUntouched:true};
}
async function startPreview(){
  if(starting)throw Error('UNIFIED_PREVIEW_STARTING');
  if(child)return {state:'already-running',port:previewPort};
  starting=true;lastError=null;
  try{
    const home=app.getPath('userData');
    const {target,head}=preparePreviewCore(packagedCore(),home);
    const port=await freePort();
    const {file}=previewConfig(target,home,port);
    const entry=path.join(target,'src','server-v0.3.mjs');
    child=spawn(process.execPath,[entry],{
      cwd:target,windowsHide:true,stdio:['ignore','pipe','pipe'],
      env:{...process.env,ELECTRON_RUN_AS_NODE:'1',
        REMOTE_COMMANDER_CONFIG:file,COMMANDER_ONE_REQUIRE_TRUSTED_INGRESS:'0'}
    });
    let captured='';
    for(const stream of [child.stdout,child.stderr]){
      stream.on('data',buf=>{
        captured=(captured+buf.toString('utf8')).slice(-4096);
      });
    }
    child.once('error',e=>{lastError=String(e.message||e);child=null;});
    child.once('exit',code=>{
      if(child){lastError='Preview exited: '+String(code)+'; '+captured.slice(-300);child=null;previewPort=null;}
    });
    await healthCheck(port);
    previewPort=port;
    return {state:'running',port,source:head,scope:'isolated STANDARD loopback',
      privilegedAccess:false,existingRuntimeUntouched:true};
  }catch(e){
    lastError=String(e.message||e);
    stopPreview();throw e;
  }finally{starting=false;}
}
function createWindow(){
  window=new BrowserWindow({
    width:850,height:680,minWidth:610,minHeight:540,
    show:false,backgroundColor:'#141923',
    webPreferences:{
      nodeIntegration:false,contextIsolation:true,sandbox:true,
      webSecurity:true,webviewTag:false,
      preload:path.join(__dirname,'preload.cjs')
    }
  });
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',e=>e.preventDefault());
  window.once('ready-to-show',()=>window?.show());
  window.on('closed',()=>{window=null;});
  void window.loadFile(path.join(__dirname,'index.html'));
}
const gotLock=app.requestSingleInstanceLock();
if(!gotLock){app.quit();}
else{
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
  app.whenReady().then(()=>{
    ipcMain.handle('commander:status',()=>status());
    ipcMain.handle('commander:migration:preflight',()=>migrationPreflight());
    ipcMain.handle('commander:preview:start',()=>startPreview());
    ipcMain.handle('commander:preview:stop',()=>stopPreview());
    ipcMain.handle('commander:companion:status',()=>companionStatus());
    ipcMain.handle('commander:companion:start',()=>companionStart());
    ipcMain.handle('commander:companion:stop',()=>companionStop());
    ipcMain.handle('commander:companion:pair-code',()=>companionPairCode());
    ipcMain.handle('commander:companion:extension-folder',()=>showCompanionFolder());
    ipcMain.handle('commander:companion:browser-list',(event)=>{
      if(event.sender!==window?.webContents)throw Error('COMPANION_OWNER_WINDOW_REQUIRED');
      return discover().map(({id,label,installed,supported})=>({id,label,installed,supported}));
    });
    ipcMain.handle('commander:companion:browser-open',(event,id)=>{
      if(event.sender!==window?.webContents)throw Error('COMPANION_OWNER_WINDOW_REQUIRED');
      return openExtensionManager(id);
    });
    ipcMain.handle('commander:monitor:list',async event=>{
      if(event.sender!==window?.webContents)throw Error('COMPANION_OWNER_WINDOW_REQUIRED');
      return (await monitorSelector()).listBrowserCompanionInstances();
    });
    ipcMain.handle('commander:monitor:select',async(event,id)=>{
      if(event.sender!==window?.webContents)throw Error('COMPANION_OWNER_WINDOW_REQUIRED');
      return (await monitorSelector()).selectBrowserCompanionInstance(id);
    });
    ipcMain.handle('commander:chat:open',()=>openChatBrowser());
    ipcMain.handle('commander:chat:extension-popup',()=>openInternalCompanionPopup());
    createWindow();
  }).catch(e=>{console.error(e);app.quit();});
  app.on('before-quit',()=>{stopPreview();void companionStop();});
  app.on('window-all-closed',()=>app.quit());
}
