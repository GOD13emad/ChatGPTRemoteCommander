import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ensureRouterSource } from '../tools/router-source-bootstrap.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function freePort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function waitStatus(url,expected){
  for(let i=0;i<100;i+=1){try{const r=await fetch(url);if(r.ok){const x=await r.json();if(!expected||x.sourceSha256===expected)return x;}}catch{}await sleep(50);}
  throw new Error('TEST_ROUTER_READY_TIMEOUT');
}
const alive = pid => { try { process.kill(Number(pid),0); return true; } catch { return false; } };
async function killRuntime(runtime){
  let pid=null;
  try{const x=JSON.parse(await fsp.readFile(runtime,'utf8'));pid=Number(x.pid||0);}catch{}
  if(pid && alive(pid)){try{process.kill(pid,'SIGKILL');}catch{}}
  for(let i=0;i<50&&pid&&alive(pid);i+=1)await sleep(100);
}
async function fixture(candidateBody){
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'rc-router-bootstrap-'));
  const oldProject=path.join(root,'old'), candidateProject=path.join(root,'candidate');
  await fsp.mkdir(path.join(oldProject,'src'),{recursive:true});await fsp.mkdir(path.join(candidateProject,'src'),{recursive:true});
  const source=await fsp.readFile(new URL('../src/stable-router.mjs',import.meta.url),'utf8');
  const oldSource=path.join(oldProject,'src','stable-router.mjs'), candidateSource=path.join(candidateProject,'src','stable-router.mjs');
  await fsp.writeFile(oldSource,source);await fsp.writeFile(candidateSource,candidateBody(source));
  const port=await freePort(), backendPort=await freePort();
  const stateFile=path.join(root,'route.json'),runtimeFile=path.join(root,'router.runtime.json'),logFile=path.join(root,'router.log');
  const route={schema:1,profile:'default',generation:7,active:{port:backendPort,version:'1',commit:'a'.repeat(40),configSha256:'1'.repeat(64),projectDir:oldProject,configPath:path.join(root,'config.json')},updatedAt:new Date().toISOString()};
  await fsp.writeFile(stateFile,JSON.stringify(route,null,2)+'\n');
  const child=spawn(process.execPath,[oldSource,'--listen-port',String(port),'--state-file',stateFile,'--runtime-file',runtimeFile],{cwd:oldProject,stdio:'ignore',windowsHide:true});
  await waitStatus(`http://127.0.0.1:${port}/router/status`,sha(oldSource));
  return {root,oldProject,candidateProject,oldSource,candidateSource,port,stateFile,runtimeFile,logFile,child,routeBytes:await fsp.readFile(stateFile)};
}
test('router source bootstrap replaces owned router and preserves route bytes',async()=>{
  const f=await fixture(source=>source+'\n// candidate-source\n');
  try{
    const result=await ensureRouterSource({url:`http://127.0.0.1:${f.port}/router/status`,stateFile:f.stateFile,runtimeFile:f.runtimeFile,candidateSource:f.candidateSource,logFile:f.logFile});
    assert.equal(result.ok,true);assert.equal(result.changed,true);assert.equal(result.sourceSha256,sha(f.candidateSource));
    const st=await waitStatus(`http://127.0.0.1:${f.port}/router/status`,sha(f.candidateSource));assert.equal(st.state.generation,7);
    assert.deepEqual(await fsp.readFile(f.stateFile),f.routeBytes);
    const second=await ensureRouterSource({url:`http://127.0.0.1:${f.port}/router/status`,stateFile:f.stateFile,runtimeFile:f.runtimeFile,candidateSource:f.candidateSource,logFile:f.logFile});
    assert.equal(second.changed,false);
  }finally{await killRuntime(f.runtimeFile);await fsp.rm(f.root,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
});
test('failed candidate router rolls back to exact old source and route',async()=>{
  const f=await fixture(()=> 'this is not valid javascript !!!\n');
  try{
    await assert.rejects(()=>ensureRouterSource({url:`http://127.0.0.1:${f.port}/router/status`,stateFile:f.stateFile,runtimeFile:f.runtimeFile,candidateSource:f.candidateSource,logFile:f.logFile}),/ROUTER_BOOTSTRAP_FAIL/);
    await waitStatus(`http://127.0.0.1:${f.port}/router/status`,sha(f.oldSource));
    assert.deepEqual(await fsp.readFile(f.stateFile),f.routeBytes);
  }finally{await killRuntime(f.runtimeFile);await fsp.rm(f.root,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
});
