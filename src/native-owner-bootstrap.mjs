/**
 * Explicit, Core-owned Linux GUI bootstrap. Default: no process, socket or
 * control authority. Never expose this API in MCP/HTTP/Browser tool catalogs.
 *
 * The owner starts the *existing* Core from a local foreground console with
 * a deliberately opt-in preview flag and an owner-private active Router state.
 * This factory uses exactly that Core's WorkflowTools object. It launches
 * precisely one pinned native child, whose kernel PID is the only admitted
 * local-management client. No second Core/WorkflowStore or TCP interface.
 *
 * This is a source pilot, not installed owner-GUI acceptance.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createOwnerRouteIdentity } from './native-owner-route.mjs';
import { startLinuxLocalManagement } from './local-management-linux.mjs';

const PREVIEW=fileURLToPath(new URL('../desktop/linux-control-center/native_owner_gtk.py',import.meta.url));
const fail=code=>{throw Object.assign(new Error(code),{managementCode:code});};
const allowedEnv=['HOME','LANG','LC_ALL','PATH','XDG_RUNTIME_DIR','WAYLAND_DISPLAY','DISPLAY',
  'DBUS_SESSION_BUS_ADDRESS','XDG_SESSION_TYPE','XDG_CURRENT_DESKTOP','GDK_BACKEND'];
const isInt=(x,lo,hi)=>Number.isSafeInteger(x)&&x>=lo&&x<=hi;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function trustedDir(p) {
  if(typeof p!=='string'||!path.isAbsolute(p)||path.normalize(p)!==p||p.includes('\0'))
    fail('MANAGEMENT_OWNER_DIRECTORY_UNVERIFIED');
  try{
    if(fs.realpathSync.native(p)!==p)fail('MANAGEMENT_OWNER_DIRECTORY_UNTRUSTED');
    const st=fs.lstatSync(p);
    if(!st.isDirectory()||st.uid!==process.getuid()||(st.mode&0o777)!==0o700)
      fail('MANAGEMENT_OWNER_DIRECTORY_UNTRUSTED');
  }catch(e){if(e.managementCode)throw e;fail('MANAGEMENT_OWNER_DIRECTORY_UNTRUSTED');}
  return p;
}
function privateFile(p,filename,uid) {
  try{
    if(typeof p!=='string'||!path.isAbsolute(p)||path.normalize(p)!==p||
       path.basename(p)!==filename||fs.realpathSync.native(p)!==p)
       fail('MANAGEMENT_OWNER_FILE_UNTRUSTED');
    const s=fs.lstatSync(p);
    if(!s.isFile()||![uid,0].includes(s.uid)||(s.mode&0o022)||s.nlink!==1)
      fail('MANAGEMENT_OWNER_FILE_UNTRUSTED');
  }catch(e){if(e.managementCode)throw e;fail('MANAGEMENT_OWNER_FILE_UNTRUSTED');}
}
function whitelistEnv(base){
  const result={};
  for(const k of allowedEnv){
    if(typeof base[k]==='string'&&base[k].length<2048&&!base[k].includes('\0'))
      result[k]=base[k];
  }
  result.PATH='/usr/bin:/bin';
  result.LANG='C.UTF-8';
  return result;
}

export async function startResidentOwnerGtk({
 enabled=false,localOwnerConsole=false,deviceId,profileId,configSha256,port,
 routerStatePath,workflowDirectory,ownerStateDirectory,xdgRuntimeDirectory,
 workflowTools,
 // Injection exists for disposable QA only; server calls this without it.
 trustedTestRunner=null,
}={}) {
 if(enabled!==true)fail('MANAGEMENT_NOT_ENABLED');
 if(localOwnerConsole!==true)fail('MANAGEMENT_OWNER_CONSOLE_REQUIRED');
 if(process.platform!=='linux'||typeof process.getuid!=='function'||
    process.getuid()===0||process.getuid()!==process.geteuid()||
    process.getgid()!==process.getegid())
    fail('MANAGEMENT_UNPRIVILEGED_OWNER_REQUIRED');
 if(!workflowTools||typeof workflowTools.execute!=='function'||
    !Array.isArray(workflowTools.definitions)||
    !['workflow_control','workflow_get','workflow_export'].every(
      key=>workflowTools.definitions.some(item=>item.name===key)))
    fail('MANAGEMENT_RESIDENT_WORKFLOW_TOOLS_REQUIRED');
 // Fail closed before spawning or creating files on any invalid route, scope
 // or missing owner-local prerequisites.
 const identity=createOwnerRouteIdentity({
   routerStatePath,deviceId,profileId,configSha256,port,
 });
 const runtimeRoot=trustedDir(xdgRuntimeDirectory);
 const outbox=trustedDir(ownerStateDirectory);
 const stateDir=trustedDir(workflowDirectory);
 const workflowDb=path.join(stateDir,'workflows.sqlite');
 privateFile(workflowDb,'workflows.sqlite',process.getuid());

 const runner=trustedTestRunner??PREVIEW;
 privateFile(runner,path.basename(runner),process.getuid());
 if(trustedTestRunner!==null && typeof trustedTestRunner!=='string')
   fail('MANAGEMENT_GUI_LAUNCHER_UNTRUSTED');
 // No process is launched until all prior prerequisites pass.
 const privateRuntime=fs.mkdtempSync(path.join(runtimeRoot,'rcm-owner-'));
 fs.chmodSync(privateRuntime,0o700);
 let child,endpoint=null,finished=false,closing=null;
 let resolveChild;
 const childDone=new Promise(resolve=>{resolveChild=resolve;});
 const releaseDirectory=()=>{
   try{fs.rmdirSync(privateRuntime);}
   catch(error){if(error.code!=='ENOENT')fail('MANAGEMENT_OWNER_RUNTIME_CLEANUP_UNVERIFIED');}
 };
 async function close() {
   if(closing)return closing;
   closing=(async()=>{
     if(child&&!finished){try{child.kill('SIGTERM');}catch{}}
     if(endpoint){try{await endpoint.close();}catch{}}
     if(child&&!finished)await Promise.race([childDone,sleep(1000)]);
     if(child&&!finished){try{child.kill('SIGKILL');}catch{}}
     if(child&&!finished)await Promise.race([childDone,sleep(1000)]);
     if(child&&!finished)fail('MANAGEMENT_OWNER_CHILD_EXIT_UNVERIFIED');
     releaseDirectory();
     return {closed:true,childExited:!child||finished,helperExited:!endpoint||endpoint.status().helperExited};
   })();
   return closing;
 }
 try {
   child=spawn('/usr/bin/python3',['-I','-B','-u',runner],{
     shell:false,windowsHide:true,stdio:['pipe','ignore','ignore'],
     env:whitelistEnv(process.env),
   });
   // Capture any asynchronous spawn/exec failure *before* testing child.pid;
   // an unhandled EventEmitter 'error' must not crash the resident Core.
   child.once('error',()=>{finished=true;resolveChild();});
   child.once('close',()=>{finished=true;resolveChild();});
   if(!isInt(child.pid,1,2147483647))fail('MANAGEMENT_GUI_SPAWN_FAILED');
   endpoint=await startLinuxLocalManagement({
     enabled:true,runtimeDirectory:privateRuntime,target:identity.target,
     readIdentity:identity.readIdentity,workflowTools,expectedClientPid:child.pid,
     sessionMs:300000,idleMs:15000,maxRequests:64,operationTimeoutMs:5000,
   });
   const descriptor={
     schema:1,endpoint:endpoint.endpoint,serverPid:endpoint.helperPid,
     target:identity.target,workflowDb,outboxDir:outbox,
   };
   const data=JSON.stringify(descriptor)+'\n';
   if(Buffer.byteLength(data)>8192||child.stdin.destroyed||!child.stdin.writable)
     fail('MANAGEMENT_GUI_DESCRIPTOR_NOT_DELIVERABLE');
   child.stdin.end(data);
   // Child exit revokes only this owned session, never a user workflow step.
   void childDone.then(()=>close()).catch(()=>{});
   return Object.freeze({
     target:identity.target,
     status:()=>Object.freeze({started:true,childPid:child.pid,childExited:finished,
       helperExited:endpoint?.status().helperExited??true,routeGeneration:identity.target.routeGeneration,
       authentication:'LINUX_SO_PEERCRED_PINNED_OWNER_CHILD'}),
     close,
     closed:childDone.then(()=>close()),
   });
 }catch(error){
   try{await close();}catch{}
   if(error?.managementCode)throw error;
   fail('MANAGEMENT_OWNER_BOOTSTRAP_FAILED');
 }
}
