// User-local, reversible scheduler for the one common signed native auto-stage.
// Never schedules an unreviewed/dev/unsigned release or an unattended OS install.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {discoverTrustedStableRelease} from './trusted-native-release.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const check=(condition,code)=>{if(!condition)fail(code);};
const NAME='ChatGPTCommanderNativeStableStage';
function ownedPath(p){
  check(typeof p==='string'&&path.isAbsolute(p)
    &&!/[%"'\r\n\t\0]/.test(p),'RC012_AUTO_SCHEDULE_PATH_UNTRUSTED');
  return path.resolve(p);
}
export function renderNativeStageSchedule({
  platform=process.platform,node=process.execPath,
  entry=fileURLToPath(import.meta.url).replace(/native-auto-schedule\.mjs$/,
    'native-managed-updater.mjs')
}={}){
  check(['linux','win32'].includes(platform),
    'RC012_AUTO_SCHEDULE_UNSUPPORTED_PLATFORM');
  node=ownedPath(node);entry=ownedPath(entry);
  if(platform==='linux'){
    const service='[Unit]\nDescription=Stage signed stable Commander native update (no automatic install)\n'
      +'[Service]\nType=oneshot\nExecStart="'+node+'" "'+entry+'" --stage\n'
      +'NoNewPrivileges=yes\nPrivateTmp=yes\n';
    const timer='[Unit]\nDescription=Check for approved signed stable Commander native releases\n'
      +'[Timer]\nOnCalendar=daily\nPersistent=true\nRandomizedDelaySec=30m\n'
      +'Unit=chatgpt-commander-native-stage.service\n'
      +'[Install]\nWantedBy=timers.target\n';
    return Object.freeze({platform,service,timer,
      serviceName:'chatgpt-commander-native-stage.service',
      timerName:'chatgpt-commander-native-stage.timer'});
  }
  return Object.freeze({platform,taskName:NAME,
    node,entry,frequency:'DAILY',startTime:'03:00',
    runLevel:'LIMITED',noPasswordSaved:true});
}
function execute(program,args){
  const r=spawnSync(program,args,{
    encoding:'utf8',windowsHide:true,timeout:25000,maxBuffer:4096});
  check(!r.error&&r.status===0,'RC012_AUTO_SCHEDULE_NATIVE_REGISTRATION_FAILED');
}
export function enableNativeStageScheduler({
  platform=process.platform,node=process.execPath,
  entry=path.join(path.dirname(fileURLToPath(import.meta.url)),
    'native-managed-updater.mjs'),
  checkRelease=discoverTrustedStableRelease,
  run=execute,
  home=os.homedir()
}={}){
  // Require *published* stable, immutable, reviewed and signed release
  // before committing a persistent background user task.
  const approved=checkRelease();
  check(approved?.status==='APPROVED_STABLE_RELEASE_FOUND',
    'RC012_AUTO_SCHEDULE_NO_APPROVED_STABLE');
  const spec=renderNativeStageSchedule({platform,node,entry});
  if(platform==='linux'){
    const config=path.join(process.env.XDG_CONFIG_HOME||path.join(home,'.config'),
      'systemd','user');
    fs.mkdirSync(config,{recursive:true,mode:0o700});
    const stat=fs.lstatSync(config);
    check(stat.isDirectory()&&!stat.isSymbolicLink(),
      'RC012_AUTO_SCHEDULE_CONFIG_UNTRUSTED');
    for(const [name,content] of [[spec.serviceName,spec.service],
      [spec.timerName,spec.timer]]){
      const dest=path.join(config,name);
      if(fs.existsSync(dest)){
        const st=fs.lstatSync(dest);
        check(st.isFile()&&!st.isSymbolicLink()
          &&fs.readFileSync(dest,'utf8')===content,
          'RC012_AUTO_SCHEDULE_EXISTING_POLICY_DRIFT');
      }else fs.writeFileSync(dest,content,{mode:0o600,flag:'wx'});
    }
    run('systemctl',['--user','daemon-reload']);
    run('systemctl',['--user','enable','--now',spec.timerName]);
  }else{
    // Per-user Scheduled Task, least privilege. No UAC bypass / saved password.
    const command='"'+spec.node+'" "'+spec.entry+'" --stage';
    run('schtasks.exe',['/Create','/SC','DAILY','/ST',spec.startTime,
      '/TN',spec.taskName,'/TR',command,'/RL','LIMITED']);
  }
  return Object.freeze({status:'SIGNED_STABLE_AUTO_STAGE_SCHEDULED',
    platform,ownerConsentRequiredForEffect:true,
    currentCoreChanged:false});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    check(process.argv.length===3&&process.argv[2]==='--enable',
      'RC012_AUTO_SCHEDULE_ARGUMENT_INVALID');
    console.log(JSON.stringify(enableNativeStageScheduler()));
  }catch(e){
    console.error(JSON.stringify({status:'NO_AUTOMATIC_PROMOTION',
      code:e?.code??'RC012_AUTO_SCHEDULE_UNEXPECTED_FAILURE'}));
    process.exitCode=2;
  }
}
