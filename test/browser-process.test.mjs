import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { createBrowserProcessClient } from '../src/browser-process.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function exists(p){try{await stat(p);return true;}catch{return false;}}
async function fixture({readyDelay=0,timeoutMs=1000,gracefulCloseMs=150,forceCloseMs=150}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'rc-browser-process-'));
 const helper=path.join(root,'helper.mjs');
 await writeFile(helper,`
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
await sleep(Number(process.env.RC_TEST_READY_DELAY||0));
process.stdout.write(JSON.stringify({ok:true,ready:true,protocol:1})+'\\n');
const rl=createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of rl){
 const req=JSON.parse(line);
 if(req.action==='error'){process.stdout.write(JSON.stringify({ok:false,error:'BROWSER_SELECTOR_NOT_FOUND'})+'\\n');continue;}
 if(req.action==='start'){
  if(req.profileDir){await mkdir(req.profileDir,{recursive:true});await writeFile(req.profileDir+'/owned.txt','owned');}
  process.stdout.write(JSON.stringify({ok:true,started:true})+'\\n');continue;
 }
 if(req.action==='hang'){await new Promise(()=>{});}
 process.stdout.write(JSON.stringify({ok:true,action:req.action,alive:true})+'\\n');
}
`,'utf8');
 const client=createBrowserProcessClient({
  file:process.execPath,args:[helper],timeoutMs,startupTimeoutMs:2000,
  gracefulCloseMs,forceCloseMs,env:{...process.env,RC_TEST_READY_DELAY:String(readyDelay)}
 });
 return {root,client,cleanup:async()=>{try{await client.close();}catch{}await rm(root,{recursive:true,force:true});}};
}

test('valid helper application errors reject only that operation and preserve the stateful helper',async()=>{
 const f=await fixture();
 try{
  await assert.rejects(f.client.invoke({action:'error'}),/BROWSER_SELECTOR_NOT_FOUND/);
  const alive=await f.client.invoke({action:'alive'});
  assert.equal(alive.ok,true);assert.equal(alive.alive,true);assert.equal(alive.action,'alive');
 }finally{await f.cleanup();}
});

test('request ownership is reserved before helper startup so concurrent invokes cannot overwrite pending state',async()=>{
 const f=await fixture({readyDelay:120});
 try{
  const first=f.client.invoke({action:'one'});
  await assert.rejects(f.client.invoke({action:'two'}),/BROWSER_HELPER_BUSY/);
  const result=await first;
  assert.equal(result.action,'one');
 }finally{await f.cleanup();}
});

test('timed-out isolated session shuts down helper and removes tracked owned profile even after forced termination',async()=>{
 const f=await fixture({timeoutMs:80,gracefulCloseMs:80,forceCloseMs:150});
 const profile=path.join(f.root,'isolated-profile');
 try{
  const started=await f.client.invoke({action:'start',isolated:true,profileDir:profile});
  assert.equal(started.started,true);
  assert.equal(await readFile(path.join(profile,'owned.txt'),'utf8'),'owned');
  await assert.rejects(f.client.invoke({action:'hang'}),/BROWSER_HELPER_TIMEOUT/);
  for(let i=0;i<60&&await exists(profile);i++)await sleep(50);
  assert.equal(await exists(profile),false);
 }finally{await f.cleanup();}
});
