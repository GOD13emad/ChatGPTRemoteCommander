import fs from 'node:fs';
import path from 'node:path';
import { findProcessesUsingBrowserProfile, terminateProcessesUsingBrowserProfile } from './browser-owned-processes.mjs';

const MARKER='.remote-commander-lease.json';
const SCHEMA=1;
const isolatedName=/^isolated-[a-z0-9]+-[a-f0-9]{12}$/;

const canonical=value=>path.resolve(String(value));
const markerPath=profileDir=>path.join(canonical(profileDir),MARKER);
const alive=pid=>{
 if(!Number.isSafeInteger(pid)||pid<=0)return false;
 try{process.kill(pid,0);return true;}catch(error){return error?.code==='EPERM';}
};
function atomicJson(file,value){
 const dir=path.dirname(file);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const temp=file+'.tmp-'+process.pid+'-'+Date.now().toString(36);
 fs.writeFileSync(temp,JSON.stringify(value)+'\n',{encoding:'utf8',mode:0o600});
 fs.renameSync(temp,file);
 try{fs.chmodSync(file,0o600);}catch{}
}
export function writeBrowserLeaseMarker({profileDir,instance='default',isolated=false,expiresAt,createdAt=Date.now(),ownerPid=process.pid}){
 const dir=canonical(profileDir);
 if(!isolated)return null;
 if(!isolatedName.test(path.basename(dir)))throw new Error('BROWSER_LEASE_MARKER_PROFILE_INVALID');
 if(!Number.isFinite(expiresAt)||expiresAt<=0)throw new Error('BROWSER_LEASE_MARKER_EXPIRY_INVALID');
 const value={schema:SCHEMA,kind:'remote-commander-browser-lease',profileDir:dir,instance:String(instance||'default'),
  isolated:true,createdAt:Number(createdAt),expiresAt:Number(expiresAt),ownerPid:Number(ownerPid)};
 atomicJson(markerPath(dir),value);
 return value;
}
export function removeBrowserLeaseMarker(profileDir){
 try{fs.rmSync(markerPath(profileDir),{force:true});return true;}catch{return false;}
}
export function readBrowserLeaseMarker(profileDir){
 const dir=canonical(profileDir),file=markerPath(dir);
 let value;
 try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}
 if(value?.schema!==SCHEMA||value?.kind!=='remote-commander-browser-lease'||value?.isolated!==true)return null;
 if(canonical(value.profileDir)!==dir||!isolatedName.test(path.basename(dir)))return null;
 if(!Number.isFinite(Number(value.expiresAt))||!Number.isSafeInteger(Number(value.ownerPid)))return null;
 return {...value,profileDir:dir,expiresAt:Number(value.expiresAt),ownerPid:Number(value.ownerPid)};
}
export function reapOrphanedIsolatedBrowserProfiles({instanceRoot,now=Date.now(),processAlive=alive,selfPid=process.pid}){
 const root=canonical(instanceRoot);
 const result={scanned:0,reaped:0,skippedActive:0,invalid:0,profiles:[]};
 let entries=[];try{entries=fs.readdirSync(root,{withFileTypes:true});}catch{return result;}
 for(const entry of entries){
  if(!entry.isDirectory()||!isolatedName.test(entry.name))continue;
  result.scanned++;
  const dir=path.join(root,entry.name),marker=readBrowserLeaseMarker(dir);
  if(!marker){result.invalid++;continue;}
  const ownerAlive=processAlive(marker.ownerPid);
  const expired=marker.expiresAt<=now;
  if(ownerAlive&&!expired){result.skippedActive++;continue;}
  const before=findProcessesUsingBrowserProfile(dir,{selfPid});
  const killed=terminateProcessesUsingBrowserProfile(dir,{selfPid});
  const remaining=findProcessesUsingBrowserProfile(dir,{selfPid});
  if(remaining.length){result.profiles.push({profileDir:dir,expired,ownerAlive,before,killed,remaining,status:'DEFER_PROCESS_REMAINS'});continue;}
  try{
   fs.rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:80});
   result.reaped++;
   result.profiles.push({profileDir:dir,expired,ownerAlive,before,killed,remaining:[],status:'REAPED'});
  }catch(error){
   result.profiles.push({profileDir:dir,expired,ownerAlive,before,killed,remaining:[],status:'DEFER_REMOVE_FAILED',error:String(error?.code??error?.message??error)});
  }
 }
 return result;
}
