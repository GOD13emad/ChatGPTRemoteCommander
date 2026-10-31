// Read-only XDG RemoteDesktop v2 capability probe. Does not create/start a session.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const unavailable=(code)=>Object.freeze({ok:true,available:false,code,interactionAvailable:false,consentGranted:false});
export async function probeLinuxRemoteDesktopPortal({platform=process.platform,env=process.env}={},{
 runner=execute,
 uid=typeof process.getuid==='function'?process.getuid():-1,
 gdbus='gdbus'
}={}){
 if(platform!=='linux')return unavailable('PORTAL_LINUX_ONLY');
 if(!Number.isSafeInteger(uid)||uid<=0||
   env?.XDG_RUNTIME_DIR!==('/run/user/'+uid)||
   !env?.DBUS_SESSION_BUS_ADDRESS)
  return unavailable('PORTAL_OWNER_SESSION_REQUIRED');
 let stdout;
 try{
  ({stdout}=await runner(gdbus,['call','--session',
    '--dest','org.freedesktop.portal.Desktop',
    '--object-path','/org/freedesktop/portal/desktop',
    '--method','org.freedesktop.DBus.Properties.Get',
    'org.freedesktop.portal.RemoteDesktop','version'],{
     shell:false,encoding:'utf8',timeout:4500,maxBuffer:4096,env}));
 }catch{return unavailable('PORTAL_DBUS_UNAVAILABLE');}
 const match=/^\(<uint32\s+(\d+)>,\)$/.exec(String(stdout).trim());
 if(!match)return unavailable('PORTAL_INVALID_RESPONSE');
 const version=Number(match[1]);
 if(!Number.isSafeInteger(version)||version<2)return unavailable('PORTAL_V2_REQUIRED');
 return Object.freeze({ok:true,available:true,provider:'linux-xdg-remotedesktop-v2',
   version,transport:'DBUS_REMOTE_DESKTOP_LIBEI',
   interactionAvailable:false,consentRequired:true,consentGranted:false,
   next:'User-approved CreateSession/SelectDevices/Start before ConnectToEIS'});
}
