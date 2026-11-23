'use strict';
// Isolated native Electron MV3 smoke. NO real ChatGPT login and NO user profile.
// Intended to run on ephemeral CI desktop, not a production Commander host.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const roots=path.resolve(__dirname,'.stage/companion');
const compartment='persist:rc012-ci-companion';
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-electron-companion-'));
app.setPath('userData',scratch);
app.commandLine.appendSwitch('disable-gpu');
let timer=null,window=null;
const fail=(error)=>{
  process.stderr.write('RC012_ELECTRON_COMPANION_SMOKE_FAILED '+String(error?.code||error?.message||'UNKNOWN').slice(0,160)+'\n');
  process.exitCode=2;
};
function stage(){
  const receipt=JSON.parse(fs.readFileSync(path.join(roots,'source-manifest.json'),'utf8'));
  if(receipt.schema!==1||receipt.kind!=='COMMANDER_OPTIONAL_BROWSER_COMPANION'
      ||receipt.count!==8||Object.keys(receipt.files??{}).length!==8)
    throw Error('STAGE_RECEIPT_INVALID');
  const dir=path.join(roots,'extensions/chatgpt-companion');
  for(const [rel,hash] of Object.entries(receipt.files)){
    if(!/^extensions\/chatgpt-companion\/[A-Za-z0-9._-]+$/.test(rel)
      ||!/^[a-f0-9]{64}$/.test(hash))throw Error('STAGE_ENTRY_INVALID');
    const file=path.join(roots,...rel.split('/')),stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()
      ||createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==hash)
      throw Error('STAGE_SHA_MISMATCH');
  }
  return dir;
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
  process.stdout.write(JSON.stringify({
    result:'RC012_ELECTRON_MV3_COMPANION_PASS',extensionLoaded:true,
    workerPopupMessage:true,isolatedSession:true,
    chatgptLoginTested:false,coreAuthorityGranted:false
  })+'\n');
}
timer=setTimeout(()=>{fail(Error('ELECTRON_MV3_SMOKE_TIMEOUT'));app.exit(2);},30000);
void app.whenReady().then(check).catch(fail).finally(()=>{
  cleanup();
  app.exit(process.exitCode||0);
});
