import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createGuiInputIncidentStore} from '../src/gui-incident-store.mjs';

async function fixture(run) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rc-j01-multiprocess-'));
 const file=path.join(dir,'pending-native.json');
 try{return await run(file,dir);}
 finally{await fs.rm(dir,{recursive:true,force:true});}
}
async function child(script,args=[],timeoutMs=10000) {
 const p=spawn(process.execPath,['--input-type=module','-e',script,...args],{
  windowsHide:true,stdio:['ignore','pipe','pipe']
 });
 let out='',err='',exited=false;
 const watchdog=setTimeout(()=>{if(!exited)p.kill('SIGKILL');},timeoutMs);
 p.stdout.setEncoding('utf8');p.stderr.setEncoding('utf8');
 p.stdout.on('data',d=>{out+=d;});
 p.stderr.on('data',d=>{err+=d;});
 const exit=await new Promise((resolve,reject)=>{
  p.once('error',reject);
  p.once('exit',(code,signal)=>{exited=true;resolve({code,signal});});
 });
 clearTimeout(watchdog);
 return {...exit,out,err};
}
const sourceUrl=pathToFileURL(path.resolve('src/gui-incident-store.mjs')).href;
const beginScript=[
 "import {createGuiInputIncidentStore} from "+JSON.stringify(sourceUrl)+";",
 "const s=createGuiInputIncidentStore({file:process.argv[1]});",
 "try { const handle=await s.begin('gui_focus_window');",
 "console.log(JSON.stringify({accepted:true,id:handle.id})); }",
 "catch(error){console.log(JSON.stringify({accepted:false,code:error.guiCode}));}"
].join('\n');
const tamperScript=[
 "import {createGuiInputIncidentStore} from "+JSON.stringify(sourceUrl)+";",
 "const s=createGuiInputIncidentStore({file:process.argv[1]});",
 "const prior=await s.pending();",
 "try { await s.resolve({id:prior.id,tool:prior.tool});",
 "console.log('WRONGLY_RELEASED'); }",
 "catch(error) { console.log(error.guiCode); }"
].join('\n');

test('independent OS processes compete for one durable native incident, only one wins',()=>fixture(async file=>{
 const [a,b]=await Promise.all([child(beginScript,[file]),child(beginScript,[file])]);
 assert.equal(a.code,0,a.err);assert.equal(b.code,0,b.err);
 const outcomes=[JSON.parse(a.out),JSON.parse(b.out)];
 assert.equal(outcomes.filter(x=>x.accepted).length,1);
 assert.equal(outcomes.filter(x=>!x.accepted).length,1);
 assert.ok(['GUI_INCIDENT_UNRESOLVED','GUI_INCIDENT_STORAGE_UNAVAILABLE']
  .includes(outcomes.find(x=>!x.accepted).code),
  'Either observed pending evidence or losing exclusive wx must reject admission');
 const store=createGuiInputIncidentStore({file});
 const pending=await store.pending();
 assert.equal(pending.id,outcomes.find(x=>x.accepted).id);
 assert.equal(pending.tool,'gui_focus_window');
}));
test('new process cannot clear an old journal with the visible id and tool',()=>fixture(async file=>{
 const create=await child(beginScript,[file]);
 assert.equal(create.code,0,create.err);
 const snapshot=await fs.readFile(file);
 const attack=await child(tamperScript,[file]);
 assert.equal(attack.code,0,attack.err);
 assert.match(attack.out,/GUI_INCIDENT_HANDLE_INVALID/);
 assert.deepEqual(await fs.readFile(file),snapshot);
 const store=createGuiInputIncidentStore({file});
 assert.equal((await store.pending()).id,JSON.parse(create.out).id);
}));
test('per-user durable pending remains fail-closed after writer process terminates',()=>fixture(async file=>{
 const create=await child(beginScript,[file]);
 assert.equal(create.code,0,create.err);
 const before=await fs.readFile(file);
 const retry=await child(beginScript,[file]);
 assert.equal(retry.code,0,retry.err);
 assert.equal(JSON.parse(retry.out).accepted,false);
 assert.deepEqual(await fs.readFile(file),before);
}));
test('real Windows global mutex requires another process to wait, while incidents remain immutable',{
 skip:process.platform!=='win32'
},async()=>{
 const p=path.resolve('test/fixtures/gui-reconciliation-mutex-qa.ps1');
 const program="$ErrorActionPreference='Stop'; & '"+p.replaceAll("'","''")+"'";
 const r=await new Promise((resolve,reject)=>{
  const proc=spawn('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-Command',program],{
   cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe']
  });
  let out='',err='';
  proc.stdout.setEncoding('utf8');proc.stderr.setEncoding('utf8');
  proc.stdout.on('data',v=>out+=v);proc.stderr.on('data',v=>err+=v);
  const killer=setTimeout(()=>{proc.kill('SIGKILL');},25000);
  proc.once('error',error=>{clearTimeout(killer);reject(error);});
  proc.once('close',(code,signal)=>{clearTimeout(killer);resolve({code,signal,out,err});});
 });
 assert.equal(r.code,0,r.err+'\n'+r.out);
 const lines=r.out.trim().split(/\r?\n/);
 const status=JSON.parse(lines.at(-1));
 assert.equal(status.fixtureOnly,true);
 assert.equal(status.deniedWhileHeld,true);
 assert.equal(status.mutexAcquiredAfterChildCrash,true);
 assert.equal(status.nativeAbandonmentObserved,true);
 assert.equal(status.crossSessionCoverageNotTested,true);
 assert.equal(status.noNativeOutcomeProved,true);
 assert.equal(status.pendingEvidencePreserved,true);
 assert.equal(status.noProductionMutexTouched,true);
});
