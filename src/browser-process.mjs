import { spawn } from 'node:child_process';
import { browserError } from './browser-contract.mjs';

function parseResult(bytes){
 let value;
 try{
  value=JSON.parse(Buffer.isBuffer(bytes)?bytes.toString('utf8'):String(bytes));
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.ok!=='boolean')throw new Error();
 }catch{throw browserError('BROWSER_HELPER_BAD_JSON');}
 if(value.ok!==true){
  const code=/^[A-Z][A-Z0-9_]{1,79}$/.test(value.error??'')?value.error:'BROWSER_NATIVE_FAILED';
  throw browserError(code);
 }
 return value;
}
export function createBrowserProcessClient({file,args,timeoutMs=60000,startupTimeoutMs=15000,maxBytes=8*1024*1024,env=process.env}){
 let child=null,buffer=Buffer.alloc(0),startup=null,pending=null,stderrBytes=0,intentionalClose=false;
 const clear=t=>{if(t)clearTimeout(t);};
 const kill=()=>{const c=child;child=null;if(c&&c.exitCode===null&&!c.killed)c.kill();};
 const fail=code=>{
  const error=browserError(code);
  if(startup){const s=startup;clear(s.timer);startup=null;s.reject(error);}
  if(pending){const p=pending;clear(p.timer);pending=null;p.reject(error);}
  buffer=Buffer.alloc(0);kill();
 };
 const complete=line=>{
  let value;try{value=parseResult(line);}catch(e){fail(e.browserCode??'BROWSER_HELPER_BAD_JSON');return;}
  if(startup){
   if(value.ready!==true||value.protocol!==1){fail('BROWSER_HELPER_BAD_JSON');return;}
   const s=startup;clear(s.timer);startup=null;s.resolve();return;
  }
  if(!pending){fail('BROWSER_HELPER_BAD_JSON');return;}
  const p=pending;clear(p.timer);pending=null;p.resolve(value);
 };
 const consume=chunk=>{
  if(!child)return;
  buffer=buffer.length?Buffer.concat([buffer,chunk]):Buffer.from(chunk);
  const limit=startup?65536:pending?maxBytes:65536;
  if(buffer.length>limit&&buffer.indexOf(0x0a)===-1){fail('BROWSER_HELPER_OUTPUT_LIMIT');return;}
  while(child){
   const nl=buffer.indexOf(0x0a);if(nl<0)break;
   if(nl>(startup?65536:maxBytes)){fail('BROWSER_HELPER_OUTPUT_LIMIT');return;}
   let line=buffer.subarray(0,nl);buffer=buffer.subarray(nl+1);
   if(line.length&&line[line.length-1]===0x0d)line=line.subarray(0,-1);
   if(!line.length){fail('BROWSER_HELPER_BAD_JSON');return;}
   complete(line);
  }
 };
 const start=()=>{
  if(child&&child.exitCode===null&&!child.killed&&!startup)return Promise.resolve();
  if(startup)return startup.promise;
  intentionalClose=false;buffer=Buffer.alloc(0);stderrBytes=0;
  let spawned;try{spawned=spawn(file,args,{windowsHide:true,env,stdio:['pipe','pipe','pipe'],shell:false});}
  catch{return Promise.reject(browserError('BROWSER_HELPER_START_FAILED'));}
  child=spawned;
  let resolveStart,rejectStart;const promise=new Promise((resolve,reject)=>{resolveStart=resolve;rejectStart=reject;});
  startup={promise,resolve:resolveStart,reject:rejectStart,timer:null};
  startup.timer=setTimeout(()=>fail('BROWSER_HELPER_TIMEOUT'),startupTimeoutMs);
  spawned.once('error',()=>fail('BROWSER_HELPER_START_FAILED'));
  spawned.stdin.on('error',()=>fail('BROWSER_HELPER_STDIN_FAILED'));
  spawned.stdout.on('data',consume);
  spawned.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>32768)fail('BROWSER_HELPER_OUTPUT_LIMIT');});
  spawned.once('close',code=>{
   if(child!==spawned)return;
   child=null;buffer=Buffer.alloc(0);
   if(intentionalClose)return;
   if(startup||pending)fail(code===0?'BROWSER_HELPER_EXIT_FAILED':'BROWSER_HELPER_EXIT_FAILED');
  });
  return promise;
 };
 const invoke=async request=>{
  if(pending)throw browserError('BROWSER_HELPER_BUSY');
  await start();
  if(!child||child.exitCode!==null||child.killed)throw browserError('BROWSER_HELPER_EXIT_FAILED');
  return new Promise((resolve,reject)=>{
   pending={resolve,reject,timer:setTimeout(()=>fail('BROWSER_HELPER_TIMEOUT'),timeoutMs)};
   child.stdin.write(JSON.stringify(request)+'\n','utf8',error=>{if(error)fail('BROWSER_HELPER_STDIN_FAILED');});
  });
 };
 const close=()=>{
  intentionalClose=true;
  if(startup){const s=startup;clear(s.timer);startup=null;s.reject(browserError('BROWSER_HELPER_EXIT_FAILED'));}
  if(pending){const p=pending;clear(p.timer);pending=null;p.reject(browserError('BROWSER_HELPER_EXIT_FAILED'));}
  buffer=Buffer.alloc(0);kill();
 };
 return {invoke,close};
}
