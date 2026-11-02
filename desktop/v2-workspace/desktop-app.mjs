// Owner-local Chromium app window for Commander V2 Workspace Preview.
// No desktop takeover, no automation of existing browser sessions, no V1 mutation.
import { createWorkspace } from './server.mjs';
import { createV2OwnerDiagnosticReaders } from './owner-diagnostic-reader.mjs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { access, mkdir, open, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const knownWindows = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];
const knownLinux = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
export async function discoverAppBrowser(os=platform(), isFile=async file=>{
  try { await access(file); return true; } catch { return false; }
}) {
  const list=os==='win32'?knownWindows:os==='linux'?knownLinux:[];
  for (const file of list) if(await isFile(file)) return file;
  return null;
}
export function buildAppArguments(url,profile) {
  const u=new URL(url);
  if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||
     !/^[0-9a-f]{48}$/.test(u.hash.slice(1))||!u.port||
     !profile)throw new Error('V2_APP_PRIVATE_LAUNCH_REQUIRED');
  return [
    '--no-first-run','--no-default-browser-check','--disable-extensions',
    '--disable-sync','--user-data-dir='+profile,'--window-size=1600,1000',
    '--app='+url
  ];
}
export async function launchDesktopApp({os=platform(),browserPath=null,home=homedir(),
  openServer=createWorkspace,spawnBrowser=spawn}={}) {
  const executable=browserPath??await discoverAppBrowser(os);
  if(!executable)throw new Error('V2_APP_CHROMIUM_REQUIRED');
  const state=os==='win32'
    ?join(home,'AppData','Local','CommanderV2','WorkspacePreview')
    :join(home,'.local','state','CommanderV2','WorkspacePreview');
  await mkdir(state,{recursive:true,mode:0o700});
  const lock=join(state,'app-instance.lock');
  // Known owner process can have at most one local GUI instance using this profile.
  let handle;
  try {handle=await open(lock,'wx',0o600);}
  catch(error){
    if(error.code==='EEXIST')throw new Error('V2_APP_ALREADY_RUNNING_OR_STALE_LOCK');
    throw error;
  }
  const profile=join(state,'browser-profile');
  let app=null;
  try {
    await mkdir(profile,{recursive:true,mode:0o700});
    const readers=await createV2OwnerDiagnosticReaders();
    app=await openServer({port:0,...(readers?{
      trustedReceiptReader:readers.trustedReceiptReader,
      trustedPrivateArtifactReader:readers.trustedPrivateArtifactReader
    }:{})});
    const args=buildAppArguments(app.url,profile);
    const exit=await new Promise((resolve,reject)=>{
      const child=spawnBrowser(executable,args,{stdio:'ignore',windowsHide:true});
      child.once('error',reject);
      child.once('exit',(code,signal)=>resolve({code,signal}));
    });
    return {state:'APP_CLOSED',...exit};
  }finally{
    try { if (app?.server) await new Promise(resolve=>app.server.close(resolve)); } catch {}
    try { await handle.close(); } catch {}
    // Only this process created lock with exclusive-create; never delete arbitrary paths.
    try { await unlink(lock); } catch {}
  }
}
if(process.argv[1]&&fileURLToPath(import.meta.url).toLowerCase()===resolve(process.argv[1]).toLowerCase()){
  try{
    await launchDesktopApp();
  }catch(e){
    process.stderr.write((/^V2_APP_[A-Z_]+$/.test(e.message)?e.message:'V2_APP_LAUNCH_FAILED')+'\n');
    process.exitCode=2;
  }
}
