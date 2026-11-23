'use strict';
// Same-installer guided browser extension activation. No profile mutation,
// sideload flags, elevated actions, or browser credential access.
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');

const CHOICES=Object.freeze([
  {id:'chrome',label:'Google Chrome',exe:['google-chrome','google-chrome-stable','chrome.exe'],
    manager:'chrome://extensions/',win:['Google/Chrome/Application/chrome.exe']},
  {id:'edge',label:'Microsoft Edge',exe:['microsoft-edge','microsoft-edge-stable','msedge.exe'],
    manager:'edge://extensions/',win:['Microsoft/Edge/Application/msedge.exe']},
  {id:'brave',label:'Brave Browser',exe:['brave-browser','brave-browser-stable','brave.exe'],
    manager:'brave://extensions/',win:['BraveSoftware/Brave-Browser/Application/brave.exe']},
  {id:'chromium',label:'Chromium',exe:['chromium','chromium-browser','chromium.exe'],
    manager:'chrome://extensions/',win:['Chromium/Application/chrome.exe']},
  {id:'firefox',label:'Firefox (not yet qualified)',exe:['firefox','firefox.exe'],
    manager:null,win:['Mozilla Firefox/firefox.exe']}
]);
const WINDOWS=['PROGRAMFILES','PROGRAMFILES(X86)','LOCALAPPDATA'];
const LINUX=['/usr/bin','/usr/local/bin','/opt/bin'];
function choices(platform=process.platform,env=process.env){
  const folders=platform==='win32'
    ? WINDOWS.map(k=>env[k]).filter(x=>typeof x==='string'&&path.win32.isAbsolute(x))
    : platform==='linux'?LINUX:[];
  return CHOICES.map(spec=>{
    const paths=platform==='win32'
      ? folders.flatMap(dir=>spec.win.map(rel=>path.win32.join(dir,...rel.split('/'))))
      : folders.flatMap(dir=>spec.exe.filter(n=>!n.endsWith('.exe')).map(n=>path.posix.join(dir,n)));
    // Do not search arbitrary PATH or resolve user-supplied executables.
    return {...spec,paths};
  });
}
function discover({platform=process.platform,env=process.env,stat=fs.statSync}={}){
  return choices(platform,env).map(({id,label,manager,paths})=>{
    let executable=null;
    for(const candidate of paths){
      try{if(stat(candidate).isFile()){executable=candidate;break;}}catch{}
    }
    return {id,label,installed:Boolean(executable),supported:Boolean(manager),executable};
  });
}
function getSelection(id,entries){
  if(typeof id!=='string'||!CHOICES.some(v=>v.id===id))throw Error('BROWSER_SELECTION_DENIED');
  const entry=entries.find(v=>v.id===id);
  if(!entry?.installed)throw Error('BROWSER_NOT_INSTALLED');
  if(!entry?.supported)throw Error('BROWSER_EXTENSION_FORMAT_UNSUPPORTED');
  return {entry,manager:CHOICES.find(v=>v.id===id).manager};
}
async function openExtensionManager(id,{platform=process.platform,env=process.env,
    stat=fs.statSync,spawnProcess=spawn}={}){
  const entries=discover({platform,env,stat});
  const {entry,manager}=getSelection(id,entries);
  // Action is only called from an explicit button in the Commander-owned UI.
  await new Promise((resolve,reject)=>{
    let child;
    try{
      child=spawnProcess(entry.executable,['--new-window',manager],{
        stdio:'ignore',detached:true,windowsHide:false,shell:false
      });
    }catch(err){reject(err);return;}
    child.once('error',reject);
    child.once('spawn',()=>{child.unref?.();resolve();});
  });
  return {ok:true,browser:entry.label,openedExtensionsPage:true,
    extensionAutoInstalled:false,ownerActionRequired:true};
}
module.exports={CHOICES,discover,openExtensionManager,getSelection};
