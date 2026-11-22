#!/usr/bin/env node
// Per-user scheduled signed-release staging. Never grants admin privileges,
// approves a package, or promotes a QA artifact automatically.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const me=path.dirname(fileURLToPath(import.meta.url));
const sourceNames=['managed-updates.mjs','signed-native-provenance.mjs'];
const fail=c=>{throw Object.assign(new Error(c),{code:c});};
function sha(data){return createHash('sha256').update(data).digest('hex');}
function cp(binary,argv){
  const r=spawnSync(binary,argv,{encoding:'utf8',timeout:20000,
    maxBuffer:128*1024,windowsHide:true});
  if(r.error||r.signal||r.status!==0)
    fail('RC012_UPDATE_TIMER_OS_REGISTRATION_FAILED');
  return r.stdout||'';
}
function located(command){
  const program=process.platform==='win32'?'where.exe':'/usr/bin/which';
  const result=cp(program,[command]).trim().split(/\r?\n/)[0];
  if(!path.isAbsolute(result)||!fs.existsSync(result))
    fail('RC012_UPDATE_TIMER_BINARY_NOT_FOUND');
  return result;
}
function targetRoot(){
  return process.platform==='win32'
    ?path.join(process.env.LOCALAPPDATA||os.homedir(),
      'ChatGPTRemoteCommander','native-auto-updater')
    :path.join(os.homedir(),'.local','lib',
      'ChatGPTRemoteCommander','native-auto-updater');
}
export function linuxUnitFiles({nodeBinary,ghBinary,runner}){
  if([nodeBinary,ghBinary,runner].some(s=>typeof s!=='string'
    ||!path.isAbsolute(s)||/[\r\n"\\]/.test(s)))
    fail('RC012_AUTO_UPDATE_TIMER_UNSAFE_PATH');
  const root=path.dirname(runner);
  const service=[
    '[Unit]','Description=ChatGPT Commander approved signed-release staging (no installation)',
    '[Service]','Type=oneshot',
    'Environment=PATH='+path.dirname(ghBinary)+':'+path.dirname(nodeBinary)+':/usr/bin:/bin',
    'WorkingDirectory='+root,
    'ExecStart='+nodeBinary+' '+runner+' --stage',
    'NoNewPrivileges=true','PrivateTmp=true','ProtectSystem=full',
    '',
  ].join('\n');
  const timer=[
    '[Unit]','Description=Periodic ChatGPT Commander signed-release check',
    '[Timer]','OnBootSec=10min','OnUnitActiveSec=6h',
    'Persistent=true','RandomizedDelaySec=20min',
    'Unit=chatgpt-commander-native-autoupdate.service',
    '[Install]','WantedBy=timers.target',''
  ].join('\n');
  return {service,timer};
}
function deploy(){
  const dst=targetRoot();
  if(fs.existsSync(dst)&&fs.lstatSync(dst).isSymbolicLink())
    fail('RC012_AUTO_UPDATE_TIMER_ALIAS_DENIED');
  fs.mkdirSync(dst,{recursive:true,mode:0o700});
  for(const name of sourceNames){
    const src=path.join(me,name),target=path.join(dst,name);
    const raw=fs.readFileSync(src);
    if(fs.existsSync(target)){
      if(sha(fs.readFileSync(target))!==sha(raw))
        fail('RC012_AUTO_UPDATE_TIMER_DIFFERENT_INSTALLED_SOURCE');
      continue;
    }
    fs.writeFileSync(target,raw,{flag:'wx',mode:0o600});
    if(sha(fs.readFileSync(target))!==sha(raw))
      fail('RC012_AUTO_UPDATE_TIMER_INSTALL_DRIFT');
  }
  return path.join(dst,'managed-updates.mjs');
}
function linuxEnable(runner){
  const node=located('node'),gh=located('gh');
  const units=linuxUnitFiles({nodeBinary:node,ghBinary:gh,runner});
  const root=path.join(os.homedir(),'.config','systemd','user');
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  for(const [name,content] of [
    ['chatgpt-commander-native-autoupdate.service',units.service],
    ['chatgpt-commander-native-autoupdate.timer',units.timer]]){
    const file=path.join(root,name);
    if(fs.existsSync(file)){
      if(fs.readFileSync(file,'utf8')!==content)
        fail('RC012_AUTO_UPDATE_TIMER_EXISTING_UNIT_DIFFERENT');
    }else fs.writeFileSync(file,content,{flag:'wx',mode:0o600});
  }
  cp('systemctl',['--user','daemon-reload']);
  cp('systemctl',['--user','enable','--now','chatgpt-commander-native-autoupdate.timer']);
}
function windowsEnable(runner){
  const node=located('node');
  if(!/^[A-Za-z]:\\/.test(node)||!/^[A-Za-z]:\\/.test(runner))
    fail('RC012_AUTO_UPDATE_TIMER_WINDOWS_PATH_INVALID');
  const name='ChatGPTCommander-SignedNativeAutoStage';
  const command='"'+node+'" "'+runner+'" --stage';
  // User-owned, least privilege. Task checks and stages only.
  const present=spawnSync('schtasks.exe',['/Query','/TN',name],{
    encoding:'utf8',timeout:15000,windowsHide:true});
  if(present.status===0)
    fail('RC012_AUTO_UPDATE_TIMER_TASK_EXISTS_RECONCILE');
  cp('schtasks.exe',['/Create','/TN',name,'/SC','HOURLY','/MO','6',
    '/TR',command,'/RL','LIMITED']);
}
export function enableScheduledUpdates(){
  if(typeof process.getuid==='function'&&process.getuid()===0)
    fail('RC012_AUTO_UPDATE_TIMER_NO_ROOT');
  if(!['linux','win32'].includes(process.platform))
    fail('RC012_AUTO_UPDATE_TIMER_OS_UNSUPPORTED');
  const runner=deploy();
  if(process.platform==='linux')linuxEnable(runner);
  else windowsEnable(runner);
  return {status:'OWNER_LOCAL_SIGNED_UPDATE_TIMER_ENABLED',platform:process.platform,
    installed:false,ownerApprovalBypassed:false,runner};
}
function main(){
  if(process.argv.length!==3||process.argv[2]!=='--enable')
    fail('RC012_AUTO_UPDATE_TIMER_USAGE');
  console.log(JSON.stringify(enableScheduledUpdates()));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  try{main();}
  catch(e){console.error(JSON.stringify({status:'RC012_AUTO_UPDATE_TIMER_DENIED',
    code:e.code||'RC012_AUTO_UPDATE_TIMER_FAILED'}));process.exitCode=2;}
