import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {buildAppArguments,discoverAppBrowser,launchDesktopApp} from './desktop-app.mjs';

test('browser discovery only uses approved installed paths',async()=>{
 const expected='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
 const x=await discoverAppBrowser('win32',async p=>p===expected);
 assert.equal(x,expected);
 assert.equal(await discoverAppBrowser('freebsd',async()=>true),null);
 assert.equal(await discoverAppBrowser('linux',async()=>false),null);
});
test('Chromium app arguments use a separate explicit profile and tokened local URL',()=>{
 const args=buildAppArguments('http://127.0.0.1:49155/#'+'a'.repeat(48),'/tmp/rc-profile');
 assert.equal(args.at(-1),'--app=http://127.0.0.1:49155/#'+'a'.repeat(48));
 assert.ok(args.includes('--disable-extensions'));
 assert.ok(args.includes('--disable-sync'));
 assert.ok(args.includes('--user-data-dir=/tmp/rc-profile'));
 for (const candidate of ['http://example.com/#'+'a'.repeat(48),'https://127.0.0.1:49155/#'+'a'.repeat(48),
 'http://127.0.0.1:49155/#abc','file:///tmp/test'])
  assert.throws(()=>buildAppArguments(candidate,'/tmp/profile'),/V2_APP_PRIVATE_LAUNCH_REQUIRED/);
});
async function tempHome(t){
 const home=await mkdtemp(join(tmpdir(),'rcv2-app-'));
 t.after(()=>rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:80}));
 return home;
}
test('desktop app opens real loopback server, closes on app exit, and removes its own lock',async t=>{
 const home=await tempHome(t);
 let launch, gatewayObserved=false;
 const result=await launchDesktopApp({
   os:'win32',browserPath:'fake-edge.exe',home,
   spawnBrowser:(file,args)=>{
     const c=new EventEmitter();
     launch={file,args};
     (async()=>{
       const url=new URL(args.at(-1).slice('--app='.length));
       const token=url.hash.slice(1);
       const status=await fetch(url.origin+'/api/status',{headers:{'X-Commander-Workspace-Token':token}}).then(r=>r.json());
       gatewayObserved=status.mode==='READ_ONLY_GUI_PREVIEW' && status.auth==='NOT_ENROLLED';
       c.emit('exit',0,null);
     })().catch(e=>c.emit('error',e));
     return c;
   }
 });
 assert.equal(result.state,'APP_CLOSED');
 assert.equal(result.code,0);
 assert.equal(launch.file,'fake-edge.exe');
 assert.ok(gatewayObserved);
 const path=join(home,'AppData','Local','CommanderV2','WorkspacePreview','app-instance.lock');
 await assert.rejects(stat(path),{code:'ENOENT'});
});
test('second app instance fails closed, and the first retains its lock',async t=>{
 const home=await tempHome(t);
 let process;
 const first=launchDesktopApp({os:'linux',browserPath:'/usr/bin/mock-browser',home,
   spawnBrowser:()=>{
     process=new EventEmitter(); return process;
   }});
 let locked=false;
 for(let i=0;i<100;i++){
   try{
     const lock=await readFile(join(home,'.local','state','CommanderV2','WorkspacePreview','app-instance.lock'));
     if(lock.length===0){locked=true;break;}
   }catch{}
   await new Promise(r=>setTimeout(r,10));
 }
 assert.ok(locked);
 await assert.rejects(launchDesktopApp({os:'linux',browserPath:'/usr/bin/mock-browser',home,
     spawnBrowser:()=>new EventEmitter()}),/V2_APP_ALREADY_RUNNING_OR_STALE_LOCK/);
 process.emit('exit',0,null);
 await first;
 await assert.rejects(stat(join(home,'.local','state','CommanderV2','WorkspacePreview','app-instance.lock')),{code:'ENOENT'});
});
test('browser error closes local server and releases lock',async t=>{
 const home=await tempHome(t);
 await assert.rejects(launchDesktopApp({os:'linux',browserPath:'/usr/bin/broken',home,
  spawnBrowser:()=>{const c=new EventEmitter();queueMicrotask(()=>c.emit('error',new Error('fake error')));return c;}
 }),/fake error/);
 await assert.rejects(stat(join(home,'.local','state','CommanderV2','WorkspacePreview','app-instance.lock')),{code:'ENOENT'});
});
