'use strict';
// Isolated native Electron MV3 smoke. NO real ChatGPT login and NO user profile.
// Intended to run on ephemeral CI desktop, not a production Commander host.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {validateBundledCompanion}=require('./companion-integrity.cjs');
const {createCompanionBridge}=require('./browser-companion-bridge.cjs');
const roots=path.resolve(__dirname,'.stage/companion');
const compartment='persist:rc012-ci-companion';
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-electron-companion-'));
app.setPath('userData',scratch);
app.commandLine.appendSwitch('disable-gpu');
let timer=null,window=null,bridge=null;
const fail=(error)=>{
  process.stderr.write('RC012_ELECTRON_COMPANION_SMOKE_FAILED '+String(error?.code||error?.message||'UNKNOWN').slice(0,160)+'\n');
  process.exitCode=2;
};
function stage(){
  return validateBundledCompanion(roots,path.resolve(__dirname,'.stage/core'));
}
function cleanup(){
  if(timer){clearTimeout(timer);timer=null;}
  try{window?.destroy();}catch{}
  try{fs.rmSync(scratch,{recursive:true,force:true,maxRetries:8,retryDelay:40});}catch{}
}
async function check(){
  const dir=stage();
  const ses=session.fromPartition(compartment);
  const extension=await ses.extensions.loadExtension(dir);
  if(extension.name!=='Commander Chat Companion'||typeof extension.id!=='string'
      ||!/^[a-p]{32}$/.test(extension.id))
    throw Error('ELECTRON_MV3_EXTENSION_LOAD_UNVERIFIED');
  window=new BrowserWindow({
    show:false,width:420,height:500,
    webPreferences:{partition:compartment,nodeIntegration:false,
      contextIsolation:true,sandbox:true,webSecurity:true}
  });
  await window.loadURL('chrome-extension://'+extension.id+'/popup.html');
  let text='';
  const stop=Date.now()+10000;
  while(Date.now()<stop){
    text=await window.webContents.executeJavaScript(
      "document.querySelector('#status')?.textContent||''",true);
    if(text==='Not connected')break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(text!=='Not connected')throw Error('ELECTRON_MV3_WORKER_NOT_RESPONDING');
  const popupTitle=await window.webContents.executeJavaScript(
    "document.querySelector('strong')?.textContent||''",true);
  if(popupTitle!=='Commander Chat Companion')throw Error('ELECTRON_MV3_POPUP_MISSING');
  // A true browser-to-Core handshake on a disposable CI-only loopback.
  // No ChatGPT account or messages are involved.
  bridge=createCompanionBridge();
  await bridge.start();
  const code=bridge.newCode().code;
  await window.webContents.executeJavaScript(
    "document.querySelector('#code').value="+JSON.stringify(code)+
    ";document.querySelector('#pair').click()",true);
  const pairedUntil=Date.now()+10000;
  let pairingText='';
  while(Date.now()<pairedUntil){
    pairingText=await window.webContents.executeJavaScript(
      "document.querySelector('#status')?.textContent||''",true);
    if(pairingText==='Paired')break;
    if(/invalid|denied|unavailable|error|failed/i.test(pairingText))
      throw Error('ELECTRON_EXTENSION_PAIRING_'+pairingText.replace(/[^A-Za-z0-9_]/g,'_').slice(0,60));
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(pairingText!=='Paired'||bridge.status().pairedBrowsers!==1)
    throw Error('ELECTRON_EXTENSION_PAIRING_TIMEOUT_'+pairingText.replace(/[^A-Za-z0-9_]/g,'_').slice(0,48));
  const pairedCheck=await window.webContents.executeJavaScript(
    "chrome.runtime.sendMessage({kind:'STATUS'})",true);
  if(!pairedCheck?.paired)throw Error('ELECTRON_PAIRING_STATUS_UNVERIFIED');
  // Simulate a Commander GUI/Bridge restart without touching the real profile.
  await bridge.stop();
  bridge=createCompanionBridge();
  await bridge.start();
  const restartCheck=await window.webContents.executeJavaScript(
    "chrome.runtime.sendMessage({kind:'STATUS'})",true);
  if(restartCheck?.paired!==false||restartCheck?.bridgeUnverified!==true)
    throw Error('ELECTRON_STALE_TOKEN_WRONGLY_TRUSTED');
  const refreshCode=bridge.newCode().code;
  await window.webContents.executeJavaScript(
    "document.querySelector('#code').value="+JSON.stringify(refreshCode)+
    ";document.querySelector('#pair').click()",true);
  const resumedUntil=Date.now()+10000;
  let resumed='';
  while(Date.now()<resumedUntil){
    resumed=await window.webContents.executeJavaScript(
      "document.querySelector('#status')?.textContent||''",true);
    if(resumed==='Paired'&&bridge.status().pairedBrowsers===1)break;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(resumed!=='Paired'||bridge.status().pairedBrowsers!==1)
    throw Error('ELECTRON_OWNER_REPAIR_AFTER_RESTART_FAILED');
  await window.webContents.executeJavaScript(
    "document.querySelector('#disconnect').click()",true);
  const revokedUntil=Date.now()+10000;
  let disconnected='';
  while(Date.now()<revokedUntil){
    disconnected=await window.webContents.executeJavaScript(
      "document.querySelector('#status')?.textContent||''",true);
    if(disconnected==='Disconnected')break;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(disconnected!=='Disconnected'||bridge.status().pairedBrowsers!==0)
    throw Error('ELECTRON_EXTENSION_REVOKE_NOT_CONFIRMED');
  process.stdout.write(JSON.stringify({
    result:'RC012_ELECTRON_MV3_COMPANION_PASS',extensionLoaded:true,
    workerPopupMessage:true,actualPairing:true,actualRevocation:true,
    restartRevalidation:true,staleTokenDenied:true,ownerRepaired:true,
    isolatedSession:true,chatgptLoginTested:false,coreAuthorityGranted:false
  })+'\n');
}
timer=setTimeout(()=>{fail(Error('ELECTRON_MV3_SMOKE_TIMEOUT'));app.exit(2);},30000);
void app.whenReady().then(check).catch(fail).finally(async()=>{
  try{await bridge?.stop();}catch{process.exitCode=2;}
  cleanup();
  app.exit(process.exitCode||0);
});
