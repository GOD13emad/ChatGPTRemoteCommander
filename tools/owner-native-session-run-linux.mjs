// Launch an existing owner-native Commander task in the active local Linux seat.
// No Core/Plugin/Tunnel update, silent consent, privilege elevation or grants.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const SYSTEMCTL='/usr/bin/systemctl';
const LOGINCTL='/usr/bin/loginctl';
const SYSTEMD_RUN='/usr/bin/systemd-run';
const TASKS=Object.freeze({
  'worker-preflight':'--preflight',
  'worker-enroll':'--enroll',
  'worker-rebind':'--rebind'
});
const fail=code=>{throw Object.assign(new Error(code),{code});};
const keyValues=(raw,allowed)=>{
  if(typeof raw!=='string'||raw.length>65536||raw.includes('\0'))
    fail('RC012_NATIVE_SEAT_ENV_INVALID');
  const result=Object.create(null);
  for(const line of raw.split(/\r?\n/)){
    if(!line)continue;
    const at=line.indexOf('=');
    if(at<1)continue;
    const key=line.slice(0,at);
    if(!allowed.has(key))continue;
    if(Object.hasOwn(result,key))
      fail('RC012_NATIVE_SEAT_ENV_DUPLICATE');
    const value=line.slice(at+1);
    if(value.length>1024||/[\x00-\x1f\x7f]/.test(value))
      fail('RC012_NATIVE_SEAT_ENV_INVALID');
    result[key]=value;
  }
  return result;
};
const MANAGER_KEYS=new Set([
  'XDG_SESSION_TYPE','WAYLAND_DISPLAY','DISPLAY','XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS'
]);
const LOGIND_KEYS=new Set([
  'Id','User','Seat','Active','Remote','Type','Class','State','Display'
]);

export function planNativeOwnerSession({
  uid,profile,task,managerText,logindText,verifySocket,
  nodeExecutable='/usr/bin/node',toolPath='/usr/lib/chatgpt-remote-commander/app/tools/provision-owner-worker-key-linux.mjs',
  unit='rc012-owner-native-qa'
}={}){
  if(!Number.isSafeInteger(uid)||uid<1||
    typeof profile!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile)
    ||profile==='.'||profile==='..'||!Object.hasOwn(TASKS,task)
    ||typeof verifySocket!=='function'
    ||typeof nodeExecutable!=='string'||!path.isAbsolute(nodeExecutable)
    ||typeof toolPath!=='string'||!path.isAbsolute(toolPath)
    ||typeof unit!=='string'||!/^[a-z][a-z0-9-]{1,76}$/.test(unit))
    fail('RC012_NATIVE_SEAT_LAUNCH_INVALID');
  const manager=keyValues(managerText,MANAGER_KEYS);
  const seat=keyValues(logindText,LOGIND_KEYS);
  if(!/^[0-9]{1,12}$/.test(seat.Id??'')
    ||seat.User!==String(uid)||!/^seat[0-9]+$/.test(seat.Seat??'')
    ||seat.Active!=='yes'||seat.Remote!=='no'||seat.Class!=='user'
    ||seat.State!=='active'||!['x11','wayland'].includes(seat.Type))
    fail('RC012_NATIVE_SEAT_NOT_ACTIVE');
  const runtime='/run/user/'+uid;
  if(manager.XDG_RUNTIME_DIR!==runtime
    ||manager.DBUS_SESSION_BUS_ADDRESS!=='unix:path='+runtime+'/bus')
    fail('RC012_NATIVE_SEAT_MANAGER_SCOPE_MISMATCH');
  const env=[
    'XDG_RUNTIME_DIR='+runtime,
    'DBUS_SESSION_BUS_ADDRESS=unix:path='+runtime+'/bus',
    'XDG_SESSION_TYPE='+seat.Type
  ];
  if(seat.Type==='wayland'){
    const name=manager.WAYLAND_DISPLAY;
    if(manager.XDG_SESSION_TYPE!=='wayland'
      ||typeof name!=='string'||!/^wayland-[0-9]{1,3}$/.test(name)
      ||verifySocket(path.join(runtime,name),uid)!==true)
      fail('RC012_NATIVE_SEAT_WAYLAND_SOCKET_UNVERIFIED');
    env.push('WAYLAND_DISPLAY='+name);
  }else{
    const display=seat.Display;
    if(!/^:[0-9]{1,3}(?:\.[0-9]{1,2})?$/.test(display??'')
      ||manager.XDG_SESSION_TYPE!==undefined&&manager.XDG_SESSION_TYPE!=='x11'
      ||manager.DISPLAY!==undefined&&manager.DISPLAY!==display)
      fail('RC012_NATIVE_SEAT_X11_DISPLAY_MISMATCH');
    env.push('DISPLAY='+display);
  }
  return Object.freeze({
    executable:SYSTEMD_RUN,
    args:Object.freeze([
      '--user','--wait','--collect','--pipe',
      '--unit='+unit,
      '-p','NoNewPrivileges=yes',
      '-p','RuntimeMaxSec='+(task==='worker-preflight'?'35s':'150s'),
      ...env.flatMap(value=>['-E',value]),
      '--',nodeExecutable,toolPath,TASKS[task],profile
    ]),
    profile,task,sessionId:seat.Id,sessionType:seat.Type,
    noPrivilegeElevation:true,grantIssued:false
  });
}
function ownedSocket(file,uid){
  try{
    const runtime=fs.lstatSync('/run/user/'+uid);
    const s=fs.lstatSync(file);
    return runtime.isDirectory()&&!runtime.isSymbolicLink()
      &&runtime.uid===uid&&(runtime.mode&0o077)===0
      &&s.isSocket()&&!s.isSymbolicLink()&&s.uid===uid;
  }catch{return false;}
}
function trustedSystemFile(file){
  const s=fs.lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)!==0
    ||(s.mode&0o111)===0)
    fail('RC012_NATIVE_SEAT_EXECUTABLE_UNTRUSTED');
}
function readLocal(file,args,uid){
  trustedSystemFile(file);
  return execFileSync(file,args,{
    encoding:'utf8',timeout:7000,maxBuffer:65536,
    env:{PATH:'/usr/bin:/bin',LANG:'C',
      XDG_RUNTIME_DIR:'/run/user/'+uid,
      DBUS_SESSION_BUS_ADDRESS:'unix:path=/run/user/'+uid+'/bus'}
  });
}
export function main(argv=process.argv.slice(2)){
  try{
    if(process.platform!=='linux'||process.getuid?.()===0
      ||argv.length!==2)
      fail('RC012_NATIVE_SEAT_LAUNCH_INVALID');
    const uid=process.getuid();
    const managerText=readLocal(SYSTEMCTL,['--user','show-environment'],uid);
    const logindText=readLocal(LOGINCTL,['show-session','auto','--no-pager',
      ...[...LOGIND_KEYS].flatMap(key=>['-p',key])],uid);
    const toolPath=fs.realpathSync.native(fileURLToPath(new URL('./provision-owner-worker-key-linux.mjs',import.meta.url)));
    const plan=planNativeOwnerSession({
      uid,task:argv[0],profile:argv[1],managerText,logindText,
      verifySocket:ownedSocket,nodeExecutable:process.execPath,toolPath,
      unit:'rc012-owner-native-'+uid+'-'+randomBytes(5).toString('hex')
    });
    trustedSystemFile(SYSTEMD_RUN);
    const child=spawnSync(plan.executable,plan.args,{
      encoding:'utf8',timeout:plan.task==='worker-preflight'?45000:160000,
      maxBuffer:16384,env:{
        PATH:'/usr/bin:/bin',LANG:'C',
        XDG_RUNTIME_DIR:'/run/user/'+uid,
        DBUS_SESSION_BUS_ADDRESS:'unix:path=/run/user/'+uid+'/bus'
      }
    });
    if(child.error||child.signal||child.status!==0)
      fail('RC012_NATIVE_SEAT_COMMAND_DENIED');
    const proof=(child.stdout??'').split(/\r?\n/).map(v=>v.trim())
      .filter(v=>v.startsWith('{')).map(v=>{try{return JSON.parse(v);}catch{return null;}})
      .find(v=>typeof v?.result==='string'&&v.profile===plan.profile);
    if(!proof||proof.workerGrantIssued!==false||proof.fullAccessActive!==false)
      fail('RC012_NATIVE_SEAT_UNEXPECTED_PROOF');
    process.stdout.write(JSON.stringify({
      result:'RC012_NATIVE_OWNER_SESSION_LAUNCH_PASS',
      task:plan.task,profile:plan.profile,sessionType:plan.sessionType,
      nativeResult:proof.result,workerGrantIssued:false,
      fullAccessActive:false,systemdUserScoped:true
    })+'\n');
  }catch(e){
    console.error(e?.code??'RC012_NATIVE_SEAT_LAUNCH_FAILED');
    process.exitCode=2;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main();
