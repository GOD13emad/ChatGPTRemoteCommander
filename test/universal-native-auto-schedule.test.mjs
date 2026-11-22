import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
 renderNativeStageSchedule,enableNativeStageScheduler
} from '../tools/universal-install/native-auto-schedule.mjs';
const approved=()=>({status:'APPROVED_STABLE_RELEASE_FOUND'});
test('one shared scheduler policy targets user-local Windows and Linux only',()=>{
 const node=process.execPath,entry=path.join(os.tmpdir(),'native-managed-updater.mjs');
 const linux=renderNativeStageSchedule({platform:'linux',node,entry});
 const win=renderNativeStageSchedule({platform:'win32',node,entry});
 assert.match(linux.timer,/OnCalendar=daily/);
 assert.match(linux.service,/ --stage/);
 assert.match(linux.service,/NoNewPrivileges=yes/);
 assert.equal(win.runLevel,'LIMITED');
 assert.equal(win.noPasswordSaved,true);
 assert.equal(win.frequency,'DAILY');
 assert.throws(()=>renderNativeStageSchedule({platform:'darwin',node,entry}),
  {code:'RC012_AUTO_SCHEDULE_UNSUPPORTED_PLATFORM'});
});
test('unapproved release cannot register any recurring OS task',()=>{
 let called=false;
 assert.throws(()=>enableNativeStageScheduler({
  platform:'win32',checkRelease:()=>({status:'NO_APPROVED_STABLE'}),
  run:()=>{called=true;}
 }),{code:'RC012_AUTO_SCHEDULE_NO_APPROVED_STABLE'});
 assert.equal(called,false);
});
test('Linux scheduler writes only two intended owner unit files and is idempotent',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-stage-timer-'));
 const prevConfig=process.env.XDG_CONFIG_HOME;
 try{
  const calls=[];
  process.env.XDG_CONFIG_HOME=path.join(home,'.config');
  const args={platform:'linux',home,checkRelease:approved,
   run:(p,a)=>{calls.push([p,a]);}};
  const r=enableNativeStageScheduler(args);
  assert.equal(r.status,'SIGNED_STABLE_AUTO_STAGE_SCHEDULED');
  assert.equal(r.ownerConsentRequiredForEffect,true);
  const dir=path.join(home,'.config','systemd','user');
  assert.ok(fs.readFileSync(path.join(dir,
    'chatgpt-commander-native-stage.timer'),'utf8').includes('Persistent=true'));
  assert.equal(calls[0][0],'systemctl');
  assert.equal(calls[1][1][3],'chatgpt-commander-native-stage.timer');
  enableNativeStageScheduler(args);
  assert.equal(calls.length,4);
 }finally{if(prevConfig===undefined)delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME=prevConfig;
  fs.rmSync(home,{recursive:true,force:true});}
});
test('Windows scheduler only stages signed release at limited user privilege',()=>{
 const calls=[];
 const r=enableNativeStageScheduler({platform:'win32',
  checkRelease:approved,run:(p,args)=>calls.push([p,args])});
 assert.equal(r.currentCoreChanged,false);
 assert.equal(calls.length,1);
 assert.equal(calls[0][0],'schtasks.exe');
 const args=calls[0][1];
 assert.ok(args.includes('/RL'));
 assert.ok(args.includes('LIMITED'));
 assert.ok(args.includes('/TR'));
 assert.match(args[args.indexOf('/TR')+1],/ --stage$/);
 assert.equal(args.includes('/F'),false);
});
