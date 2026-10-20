import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {attachBrowserServerShutdown} from '../src/browser-tools.mjs';

function deferred(){
 let resolve;const promise=new Promise(done=>{resolve=done;});
 return {promise,resolve};
}
function state(){
 const proc=new EventEmitter();proc.exitCode=0;
 let alarm=null,canceled=0;const logs=[],exitCalls=[];
 return {
  proc,logs,exitCalls,
  schedule:fn=>{alarm=fn;return 'alarm';},
  cancel:key=>{assert.equal(key,'alarm');canceled++;alarm=null;},
  fireAlarm:()=>{if(alarm)alarm();},
  get canceled(){return canceled;}
 };
}
test('SIGTERM drains accepted browser work and closes MCP HTTP exactly once',async()=>{
 const s=state(),pending=deferred(),called=[];
 const server={close:cb=>{called.push('http-close');cb();}};
 const closeBrowserController=async()=>{
  called.push('worker-start');await pending.promise;called.push('worker-finished');
 };
 const shutdown=attachBrowserServerShutdown({server,closeBrowserController,
  stopMonitor:()=>called.push('monitor-stop'),processLike:s.proc,
  schedule:s.schedule,cancel:s.cancel,onError:c=>s.logs.push(c),
  exit:c=>s.exitCalls.push(c)});
 s.proc.emit('SIGTERM');
 s.proc.emit('SIGTERM');
 s.proc.emit('SIGINT');
 await Promise.resolve();
 assert.equal(called.filter(x=>x==='http-close').length,1);
 assert.equal(called.filter(x=>x==='monitor-stop').length,1);
 assert.equal(called.includes('worker-finished'),false);
 pending.resolve();
 await shutdown.shutdown();
 assert.equal(called.filter(x=>x==='worker-finished').length,1);
 assert.equal(s.canceled,1);
 assert.deepEqual(s.exitCalls,[]);
 assert.deepEqual(s.logs,[]);
 assert.equal(s.proc.exitCode,0);
});
test('repeated same SIGTERM stays handled while a worker is draining',async()=>{
 const s=state(),pending=deferred();let starts=0,closed=false;
 const shutdown=attachBrowserServerShutdown({
  server:{close:done=>done()},
  closeBrowserController:async()=>{starts++;await pending.promise;closed=true;},
  processLike:s.proc,schedule:s.schedule,cancel:s.cancel,
  onError:code=>s.logs.push(code),exit:code=>s.exitCalls.push(code)
 });
 s.proc.emit('SIGTERM');
 await Promise.resolve();
 assert.equal(s.proc.listenerCount('SIGTERM'),1,'Retain idempotent listener during drain');
 s.proc.emit('SIGTERM');
 s.proc.emit('SIGTERM');
 assert.equal(starts,1,'Do not launch duplicate closure');
 assert.equal(closed,false);
 pending.resolve();
 await shutdown.shutdown();
 assert.equal(closed,true);
 assert.equal(starts,1);
 assert.equal(s.proc.exitCode,0);
 assert.deepEqual(s.exitCalls,[]);
});
test('worker close failure never reports successful shutdown',async()=>{
 const s=state();
 const shutdown=attachBrowserServerShutdown({
  server:{close:cb=>cb()},
  closeBrowserController:async()=>{throw Error('PRIVATE_HELPER_CLEANUP_DENIED');},
  processLike:s.proc,schedule:s.schedule,cancel:s.cancel,
  onError:code=>s.logs.push(code),exit:code=>s.exitCalls.push(code)});
 s.proc.emit('SIGTERM');
 await shutdown.shutdown();
 assert.deepEqual(s.logs,['BROWSER_WORKER_SHUTDOWN_FAILED']);
 assert.equal(s.proc.exitCode,1);
 assert.deepEqual(s.exitCalls,[]);
});
test('unresponsive HTTP close reaches a bounded deadline instead of falsely exiting',async()=>{
 const s=state();
 let cb;
 const shutdown=attachBrowserServerShutdown({
  server:{close:callback=>{cb=callback;}},
  closeBrowserController:async()=>{},
  processLike:s.proc,schedule:s.schedule,cancel:s.cancel,
  onError:code=>s.logs.push(code),exit:code=>s.exitCalls.push(code)});
 s.proc.emit('SIGTERM');
 await Promise.resolve();
 s.fireAlarm();
 assert.deepEqual(s.exitCalls,[1]);
 assert.deepEqual(s.logs,['BROWSER_SHUTDOWN_DEADLINE_EXCEEDED']);
 cb();
 await shutdown.shutdown();
 assert.equal(s.canceled,1);
});
test('monitor stop failure is visible but browser workers still close',async()=>{
 const s=state();let workerClosed=false;
 const shutdown=attachBrowserServerShutdown({
  server:{close:cb=>cb()},
  closeBrowserController:async()=>{workerClosed=true;},
  stopMonitor:()=>{throw Error('MONITOR_FAILURE');},
  processLike:s.proc,schedule:s.schedule,cancel:s.cancel,
  onError:code=>s.logs.push(code),exit:code=>s.exitCalls.push(code)});
 await shutdown.shutdown();
 assert.equal(workerClosed,true);
 assert.deepEqual(s.logs,['BROWSER_MONITOR_STOP_FAILED']);
 assert.equal(s.proc.exitCode,1);
});
test('setup rejects invalid server and timeout contracts',()=>{
 const s=state();
 assert.throws(()=>attachBrowserServerShutdown({server:{},closeBrowserController:()=>{},
  processLike:s.proc}),/BROWSER_SHUTDOWN_SETUP_INVALID/);
 assert.throws(()=>attachBrowserServerShutdown({server:{close(){}},
  closeBrowserController:()=>{},deadlineMs:0,processLike:s.proc}),
 /BROWSER_SHUTDOWN_SETUP_INVALID/);
});

test('a real Linux SIGTERM closes the local HTTP Core and awaits cleanup',{
 skip:process.platform!=='linux'
},async()=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'rc-browser-shutdown-'));
 const marker=path.join(folder,'cleanup.done');
 const moduleUri=new URL('../src/browser-tools.mjs',import.meta.url).href;
 const script=[
  "import http from 'node:http';import fs from 'node:fs/promises';",
  "import {attachBrowserServerShutdown} from "+JSON.stringify(moduleUri)+";",
  "const server=http.createServer((_q,res)=>res.end('ok'));",
  "attachBrowserServerShutdown({server,closeBrowserController:async()=>{"+
  "await fs.writeFile("+JSON.stringify(marker)+",'CLOSED');}});",
  "server.listen(0,'127.0.0.1',()=>console.log('READY'));"
 ].join('\n');
 const child=spawn(process.execPath,['--input-type=module','-e',script],{
  windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false
 });
 let stdout='',stderr='';
 child.stdout.on('data',chunk=>{stdout+=chunk.toString('utf8');});
 child.stderr.on('data',chunk=>{stderr+=chunk.toString('utf8');});
 let closed=false;
 const outcome=new Promise(resolve=>child.once('close',(code,signal)=>{closed=true;resolve({code,signal});}));
 try{
  const until=Date.now()+4500;
  while(!stdout.includes('READY')&&Date.now()<until&&!closed){
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.match(stdout,/READY/,stderr.slice(-500));
  child.kill('SIGTERM');
  const result=await Promise.race([
   outcome,new Promise((_,reject)=>setTimeout(()=>reject(Error('CHILD_CLOSE_TIMEOUT')),5500))
  ]);
  assert.equal(result.code,0,'SIGTERM should drain cleanly: '+stderr.slice(-500));
  assert.equal((await fs.readFile(marker,'utf8')),'CLOSED');
 }finally{
  if(!closed){child.kill('SIGKILL');await outcome;}
  await fs.rm(folder,{recursive:true,force:true});
 }
});
