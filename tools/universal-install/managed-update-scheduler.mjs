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
const sourceNames=['release-admission-0.12.mjs','signed-native-provenance.mjs','managed-updates.mjs'];
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
// Linux units have their own parser, not shell syntax or host-OS paths.
// Keep a single literal argument per path and escape systemd specifiers.
// Reject ambiguous PATH separators, variable expansion and control syntax.
function validLinuxUnitPath(s){
  return typeof s==='string'&&path.posix.isAbsolute(s)
    &&!/[\u0000-\u001f\u007f"\\$:]/.test(s)
    &&s.split('/').slice(1).every(p=>p&&p!=='.'&&p!=='..'&&p.trim()===p);
}
const unitLiteral=s=>s.replaceAll('%','%%');
const execWord=s=>/[\s']/.test(s)?'"'+unitLiteral(s)+'"':unitLiteral(s);
export function linuxUnitFiles({nodeBinary,ghBinary,runner}){
  if(![nodeBinary,ghBinary,runner].every(validLinuxUnitPath))
    fail('RC012_AUTO_UPDATE_TIMER_UNSAFE_PATH');
  const root=path.posix.dirname(runner);
  const service=[
    '[Unit]','Description=ChatGPT Commander approved signed-release staging (no installation)',
    '[Service]','Type=oneshot',
    'Environment="PATH='+unitLiteral(path.posix.dirname(ghBinary))+':'+unitLiteral(path.posix.dirname(nodeBinary))+':/usr/bin:/bin"',
    'WorkingDirectory='+unitLiteral(root),
    'ExecStart='+execWord(nodeBinary)+' '+execWord(runner)+' --stage',
    'NoNewPrivileges=true','PrivateTmp=true','ProtectSystem=full',
    '',
  ].join('\n');
  const timer=[
    '[Unit]','Description=Periodic ChatGPT Commander signed-release check',
    '[Timer]','OnBootSec=10min','OnUnitActiveSec=6h',
    'OnCalendar=*-*-* 00/6:00:00',
    'Persistent=true','RandomizedDelaySec=20min',
    'Unit=chatgpt-commander-native-autoupdate.service',
    '[Install]','WantedBy=timers.target',''
  ].join('\n');
  return {service,timer};
}
function ownerRegularFile(file,{privateMode=true}={}){
  const st=fs.lstatSync(file,{throwIfNoEntry:false});
  if(!st||!st.isFile()||st.isSymbolicLink()||st.nlink!==1
    ||st.size>256*1024
    ||(typeof process.getuid==='function'
      &&(st.uid!==process.getuid()
        ||(privateMode&&(st.mode&0o077)!==0))))
    fail('RC012_AUTO_UPDATE_TIMER_INSTALLED_SOURCE_UNTRUSTED');
}
function atomicOwnerReplace(target,raw){
  const staged=target+'.next-'+process.pid;
  if(fs.existsSync(staged))
    fail('RC012_AUTO_UPDATE_TIMER_PARTIAL_SOURCE_PRESENT');
  let done=false;
  try{
    fs.writeFileSync(staged,raw,{flag:'wx',mode:0o600});
    ownerRegularFile(staged);
    if(sha(fs.readFileSync(staged))!==sha(raw))
      fail('RC012_AUTO_UPDATE_TIMER_INSTALL_DRIFT');
    fs.renameSync(staged,target);
    done=true;
  }finally{
    if(!done&&fs.existsSync(staged))fs.rmSync(staged);
  }
}
export function deployManagedUpdaterSources({
  sourceDir=me,destinationDir=targetRoot()
}={}){
  if(!path.isAbsolute(sourceDir)||!path.isAbsolute(destinationDir))
    fail('RC012_AUTO_UPDATE_TIMER_ROOT_INVALID');
  const root=fs.lstatSync(destinationDir,{throwIfNoEntry:false});
  if(root&&(root.isSymbolicLink()||!root.isDirectory()
    ||(typeof process.getuid==='function'&&root.uid!==process.getuid())))
    fail('RC012_AUTO_UPDATE_TIMER_ALIAS_DENIED');
  fs.mkdirSync(destinationDir,{recursive:true,mode:0o700});
  // Preflight all source files before changing either dependency.
  const files=sourceNames.map(name=>{
    const src=path.join(sourceDir,name),target=path.join(destinationDir,name);
    ownerRegularFile(src,{privateMode:false});
    const raw=fs.readFileSync(src);
    if(raw.length<100)fail('RC012_AUTO_UPDATE_TIMER_SOURCE_TOO_SHORT');
    const st=fs.lstatSync(target,{throwIfNoEntry:false});
    if(st)ownerRegularFile(target);
    return {name,target,raw};
  });
  for(const {target,raw} of files){
    if(fs.existsSync(target)){
      const original=fs.readFileSync(target);
      if(sha(original)===sha(raw))continue;
      // A SINGLE owner-local previous source is retained for recovery,
      // rather than creating a new competing updater on every revision.
      const previous=target+'.previous';
      if(fs.existsSync(previous))ownerRegularFile(previous);
      atomicOwnerReplace(previous,original);
    }
    atomicOwnerReplace(target,raw);
    ownerRegularFile(target);
    if(sha(fs.readFileSync(target))!==sha(raw))
      fail('RC012_AUTO_UPDATE_TIMER_INSTALL_DRIFT');
  }
  return path.join(destinationDir,'managed-updates.mjs');
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
  const runner=deployManagedUpdaterSources();
  if(process.platform==='linux')linuxEnable(runner);
  else windowsEnable(runner);
  return {status:'OWNER_LOCAL_SIGNED_UPDATE_TIMER_ENABLED',platform:process.platform,
    installed:false,ownerApprovalBypassed:false,runner};
}
function main(){
  if(process.argv.length!==3||!['--enable','--refresh-source'].includes(process.argv[2]))
    fail('RC012_AUTO_UPDATE_TIMER_USAGE');
  if(process.argv[2]==='--refresh-source'){
    if(typeof process.getuid==='function'&&process.getuid()===0)
      fail('RC012_AUTO_UPDATE_TIMER_NO_ROOT');
    if(!['linux','win32'].includes(process.platform))
      fail('RC012_AUTO_UPDATE_TIMER_OS_UNSUPPORTED');
    const runner=deployManagedUpdaterSources();
    console.log(JSON.stringify({status:'OWNER_LOCAL_UPDATE_SOURCE_REFRESHED',
      installed:false,ownerApprovalBypassed:false,runner}));
  }else console.log(JSON.stringify(enableScheduledUpdates()));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  try{main();}
  catch(e){console.error(JSON.stringify({status:'RC012_AUTO_UPDATE_TIMER_DENIED',
    code:e.code||'RC012_AUTO_UPDATE_TIMER_FAILED'}));process.exitCode=2;}
