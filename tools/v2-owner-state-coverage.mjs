#!/usr/bin/env node
// Read-only owner-session state *discovery* for V2 migration preflight.
// No file content, credentials, browser storage, directory listings or paths
// are returned; presence does NOT constitute a consistent backup or consent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const LINUX=Object.freeze([
 ['commander-share','.local/share/ChatGPTRemoteCommander'],
 ['commander-config','.config/ChatGPTRemoteCommander'],
 ['commander-state','.local/state/ChatGPTRemoteCommander'],
 ['brave-userdata','.config/BraveSoftware/Brave-Browser'],
 ['chrome-userdata','.config/google-chrome'],
 ['firefox-userdata','.mozilla/firefox'],
 ['v2-userdata','.config/Commander V2'],
 ['cos-userdata','.config/Chat On Steroids']
]);
const WINDOWS=Object.freeze([
 ['commander-roaming','roaming','ChatGPTRemoteCommander'],
 ['commander-local','local','ChatGPTRemoteCommander'],
 ['commander-state','local','chatgpt-remote-commander'],
 ['brave-userdata','local','BraveSoftware/Brave-Browser/User Data'],
 ['chrome-userdata','local','Google/Chrome/User Data'],
 ['firefox-userdata','roaming','Mozilla/Firefox'],
 ['v2-userdata','roaming','Commander V2'],
 ['cos-userdata','roaming','Chat On Steroids']
]);
function inspectDirectory(p){
 if(!p||!path.isAbsolute(p))return 'UNKNOWN';
 const root=path.parse(p).root;
 let current=root;
 for(const component of p.slice(root.length).split(path.sep).filter(Boolean)){
  current=path.join(current,component);
  try{
   const s=fs.lstatSync(current);
   if(s.isSymbolicLink())return 'ALIAS';
   if(!s.isDirectory())return 'NON_DIRECTORY';
  }catch(e){
   if(e?.code==='ENOENT')return 'ABSENT';
   return 'UNKNOWN';
  }
 }
 return 'PRESENT';
}
export function inspectV2OwnerState({
 platform=process.platform,home=os.homedir(),
 appData=process.env.APPDATA,localAppData=process.env.LOCALAPPDATA
}={}){
 if(!['linux','win32'].includes(platform))throw new Error('V2_OWNER_COVERAGE_OS_UNSUPPORTED');
 const list=platform==='linux'
  ? LINUX.map(([id,relative])=>[id,path.join(home,relative)])
  : WINDOWS.map(([id,base,relative])=>[id,
    base==='roaming'&&appData ? path.join(appData,relative) :
    base==='local'&&localAppData ? path.join(localAppData,relative) : null]);
 const entries=list.map(([kind,target])=>Object.freeze({
  kind,presence:inspectDirectory(target),
  backup:'NOT_EVALUATED',restore:'NOT_TESTED'
 }));
 const totals=Object.fromEntries(['PRESENT','ABSENT','ALIAS','NON_DIRECTORY','UNKNOWN'].map(
  state=>[state,entries.filter(x=>x.presence===state).length]));
 return Object.freeze({
  schema:1,platform,scope:'CURRENT_PROCESS_USER_READ_ONLY',
  filesRead:0,filesCopied:0,ownerAuthenticated:false,
  consistentBackupVerified:false,cutoverAccepted:false,
  totals:Object.freeze(totals),entries:Object.freeze(entries)
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3||process.argv[2]!=='--inspect'){
  process.stderr.write('V2_OWNER_COVERAGE_EXPLICIT_INSPECT_REQUIRED\n');
  process.exitCode=2;
 }else{
  try{process.stdout.write(JSON.stringify(inspectV2OwnerState())+'\n')}
  catch(e){process.stderr.write(String(e?.message||'V2_OWNER_COVERAGE_FAILED')+'\n');process.exitCode=2}
 }
}
