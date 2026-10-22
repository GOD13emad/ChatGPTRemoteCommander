import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {findProcessesUsingBrowserProfile,terminateProcessesUsingBrowserProfile} from '../src/browser-owned-processes.mjs';

const executable='/usr/bin/google-chrome';
const supported=process.platform==='linux'&&process.getuid?.()!==0&&fs.existsSync(executable);

test('native failed owned-profile cleanup remains retryable and cannot report false closed', {skip:!supported,timeout:110000}, async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'rc-owned-end-fail-'));
 const profile=path.join(base,'owned');
 const helper=spawn(process.execPath,[path.resolve('tools/browser-control.mjs'),'--server'],{stdio:['pipe','pipe','pipe']});
 let stderr='',buffer=[],pending=[];
 const read=createInterface({input:helper.stdout,crlfDelay:Infinity});
 read.on('line',line=>{let v;try{v=JSON.parse(line)}catch{return};const f=pending.shift();if(f)f(v);else buffer.push(v)});
 helper.stderr.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-900)});
 function response(timeout=65000){
  if(buffer.length)return Promise.resolve(buffer.shift());
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('HELPER_TIMEOUT '+stderr)),timeout);
   pending.push(v=>{clearTimeout(timer);resolve(v)});
  });
 }
 async function send(args,timeout){
  helper.stdin.write(JSON.stringify(args)+'\n');
  return response(timeout);
 }
 try{
  assert.equal((await response(15000)).ready,true);
  const b=await send({action:'start',isolated:true,profileDir:profile,executable},25000);
  assert.equal(b.ok,true,JSON.stringify(b));
  assert.ok(findProcessesUsingBrowserProfile(profile).length>=1,'owned Chrome must exist before denial');
  fs.chmodSync(base,0o500); // only this test-owned path, prevent profile directory removal
  const first=await send({action:'end'},65000);
  assert.equal(first.ok,false,'native helper must report failed cleanup');
  assert.equal(first.error,'BROWSER_PROFILE_CLEANUP_FAILED');
  assert.equal(fs.existsSync(profile),true,'the failure was real, not a synthetic response');
  fs.chmodSync(base,0o700);
  const second=await send({action:'end'},20000);
  assert.equal(second.ok,true,JSON.stringify(second));
  assert.equal(second.closed,true);
  assert.equal(fs.existsSync(profile),false,'confirmed second end must remove profile');
  assert.deepEqual(findProcessesUsingBrowserProfile(profile),[]);
 }finally{
  try{fs.chmodSync(base,0o700)}catch{}
  try{await send({action:'end'},10000)}catch{}
  try{helper.stdin.end()}catch{}
  await Promise.race([new Promise(r=>helper.once('close',r)),new Promise(r=>setTimeout(r,1300))]);
  if(helper.exitCode===null)helper.kill('SIGTERM');
  terminateProcessesUsingBrowserProfile(profile);
  fs.rmSync(base,{recursive:true,force:true});
 }
});
