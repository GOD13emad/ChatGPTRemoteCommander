import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import http from 'node:http';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// A random OS-assigned port can be forbidden to fetch (e.g. H.323 port 1720).
// Prove compatibility with the same HTTP client before releasing the reservation.
async function port() {
 for(let attempt=0;attempt<24;attempt++) {
  const probe=http.createServer((_req,res)=>{res.writeHead(204);res.end();});
  probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const p=probe.address().port;
  let usable=false;
  try {
   const r=await fetch('http://127.0.0.1:'+p+'/',{signal:AbortSignal.timeout(1500)});
   usable=r.status===204;
  } catch { /* blocked ports or unavailable HTTP endpoints are rejected */ }
  finally { await new Promise(resolve=>probe.close(resolve)); }
  if(usable)return p;
 }
 throw new Error('TRANSFER_FIXTURE_NO_FETCH_COMPATIBLE_PORT');
}
async function req(p,name,args={},id=1){const res=await fetch('http://127.0.0.1:'+p+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method:name==='__list'?'tools/list':'tools/call',params:name==='__list'?{}:{name,arguments:args}})});const body=await res.json();assert.equal(res.status,200);return body.result;}

// Readiness is owned by this fixture, not by an arbitrary HTTP 200 on a recycled port.
// Hosted Windows startup may be delayed under load; wait is bounded, observes early
// child failure and reports diagnostic evidence rather than assuming any delay is PASS.
async function waitForOwnedHealth({port,child,expectedConfigSha256,getDiagnostics,timeoutMs=5000}) {
 const started=Date.now();
 let last='not_connected';
 while(Date.now()-started<timeoutMs) {
  const diagnostic=getDiagnostics();
  if(diagnostic.spawnError)throw new Error('TRANSFER_FIXTURE_SPAWN_FAILED:'+JSON.stringify(diagnostic));
  if(child.exitCode!==null || child.signalCode!==null)
   throw new Error('TRANSFER_FIXTURE_CHILD_EXITED:'+JSON.stringify({exitCode:child.exitCode,signalCode:child.signalCode,...diagnostic}));
  try {
   const response=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(1200)});
   if(response.ok) {
    const body=await response.json();
    if(body?.ok!==true || body?.name!=='chatgpt-remote-commander' || body?.configSha256!==expectedConfigSha256)
     throw new Error('TRANSFER_FIXTURE_FOREIGN_HEALTH');
    return Date.now()-started;
   }
   last='HTTP_'+response.status;
  } catch(error) {
   if(error?.message==='TRANSFER_FIXTURE_FOREIGN_HEALTH')throw error;
   last=String(error?.cause?.code??error?.code??error?.message??error).slice(0,200);
  }
  await wait(50);
 }
 throw new Error('TRANSFER_FIXTURE_STARTUP_TIMEOUT:'+JSON.stringify({elapsedMs:Date.now()-started,last,exitCode:child.exitCode,...getDiagnostics()}));
}

test('MCP native transfer tools opt in, expose narrowly scoped schemas and execute authentic local send',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'ctmesh-native-http-'));
 const server=path.join(home,'server'),input=path.join(home,'inputs'),received=path.join(home,'received'),pilot=path.join(home,'pilot');
 const serverPort=await port();
 let child,stderr='',stdout='',spawnError=null;
 try{
  await fs.mkdir(server);await fs.mkdir(input);await fs.mkdir(received);await fs.mkdir(pilot);
  await fs.cp(new URL('../src/',import.meta.url),path.join(server,'src'),{recursive:true});
  await fs.copyFile(new URL('../tools/commander-transfer-mesh/pilot-cli.mjs',import.meta.url),path.join(pilot,'transfer.mjs'));
  await fs.copyFile(new URL('../tools/commander-transfer-mesh/durable-send.mjs',import.meta.url),path.join(pilot,'durable-send.mjs'));
  await fs.writeFile(path.join(pilot,'node.json'),JSON.stringify({alias:'PC',schema:'ctmesh-node-v1'}));
  const dataRoot=path.join(home,'data');await fs.mkdir(dataRoot);
  const cfg={host:'127.0.0.1',port:serverPort,allowedRoots:[dataRoot],allowedPrograms:['node'],maxReadBytes:1048576,maxWriteBytes:1048576,maxCommandMs:10000,
   auditLog:'var/audit.jsonl',durableDelivery:{directory:path.join(home,'delivery')},
   powerMode:{enabled:true,fullFilesystem:false,allowShell:false,allowProcessControl:false,allowPermanentDelete:false,backupRoot:path.join(home,'backups'),maxFileBytes:1048576,maxCommandMs:10000,maxOutputBytes:1048576,maxTerminalBufferBytes:1048576,blockedShellPatterns:[],guiControl:{enabled:false}},
   transferMesh:{enabled:true,durableEnabled:true,root:pilot,sourceRoots:[input],destinationRoots:[received]}};
  const configPath=path.join(server,'config.json');
  const configRaw=JSON.stringify(cfg);
  await fs.writeFile(configPath,configRaw);
  child=spawn(process.execPath,[path.join(server,'src/server-v0.3.mjs')],{cwd:server,env:{...process.env,REMOTE_COMMANDER_CONFIG:configPath},stdio:['ignore','pipe','pipe']});
  child.on('error',error=>{spawnError=String(error?.code??error?.message??error);});
  child.stderr.on('data',x=>{stderr=(stderr+x).slice(-2048);});
  child.stdout.on('data',x=>{stdout=(stdout+x).slice(-2048);});
  await waitForOwnedHealth({port:serverPort,child,
   expectedConfigSha256:createHash('sha256').update(configRaw).digest('hex'),
   getDiagnostics:()=>({stderr,stdout,spawnError})});
  const list=await req(serverPort,'__list');const defs=list.tools.filter(x=>x.name.startsWith('transfer_mesh_'));
  assert.equal(defs.length,8);
  assert.equal(defs.find(x=>x.name==='transfer_mesh_send').annotations.readOnlyHint,false);
  const info=await req(serverPort,'transfer_mesh_info');
  assert.equal(info.isError,false);
  const testFile=path.join(input,'fixture.txt');await fs.writeFile(testFile,'transfer suite hello');
  const denied=await req(serverPort,'transfer_mesh_send',{peer:'Linux',path:path.join(home,'config.json'),id:'http-no-001',requestId:'fixed-http-deny-001'});
  assert.equal(denied.isError,true);
  assert.match(JSON.stringify(denied),/TRANSFER_PATH_NOT_ALLOWED|ENOENT/);
  const sent=await req(serverPort,'transfer_mesh_send',{peer:'Linux',path:testFile,id:'http-good-001',requestId:'fixed-http-send-001'});
  assert.equal(sent.isError,false,JSON.stringify(sent));
  assert.equal((await fs.stat(path.join(pilot,'pairs','Linux','transfers','http-good-001','payload.bin'))).isFile(),true);
  const replay=await req(serverPort,'transfer_mesh_send',{peer:'Linux',path:testFile,id:'http-good-001',requestId:'fixed-http-send-001'});
  assert.equal(replay.isError,false,JSON.stringify(replay));
  const conflict=await req(serverPort,'transfer_mesh_send',{peer:'Linux',path:testFile,id:'http-good-001',requestId:'different-http-send-002'});
  assert.equal(conflict.isError,true);
  const large=path.join(input,'long-file.dat');await fs.writeFile(large,Buffer.alloc(12*1024*1024,0x63));
  const queued=await req(serverPort,'transfer_mesh_enqueue',{peer:'Linux',path:large,id:'http-durable-001',requestId:'fixed-http-durable-001'});
  assert.equal(queued.isError,false,JSON.stringify(queued));
  let progress=null;
  for(let i=0;i<100;i++){
    progress=await req(serverPort,'transfer_mesh_job_status',{peer:'Linux',id:'http-durable-001'});
    if(JSON.stringify(progress).includes('"PUBLISHED"'))break;
    await wait(70);
  }
  assert.equal(progress.isError,false,JSON.stringify(progress));
  assert.match(JSON.stringify(progress),/"PUBLISHED"/);
  assert.equal((await fs.stat(path.join(pilot,'pairs','Linux','transfers','http-durable-001','payload.bin'))).size,12*1024*1024);
  await wait(350);
 }finally{
  if(child){child.kill();await Promise.race([once(child,'exit').catch(()=>{}),wait(1500)]);}
  await fs.rm(home,{recursive:true,force:true});
 }
});

test('readiness helper refuses an unrelated healthy HTTP service',async()=>{
 const listener=http.createServer((_req,res)=>{
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({ok:true,name:'chatgpt-remote-commander',configSha256:'foreign-instance'}));
 });
 listener.listen(0,'127.0.0.1');await once(listener,'listening');
 try {
  await assert.rejects(waitForOwnedHealth({port:listener.address().port,
   child:{exitCode:null,signalCode:null},expectedConfigSha256:'expected-instance',
   getDiagnostics:()=>({}),timeoutMs:1000}),/TRANSFER_FIXTURE_FOREIGN_HEALTH/);
 } finally { await new Promise(resolve=>listener.close(resolve)); }
});
test('readiness helper fails immediately if the child has already exited',async()=>{
 await assert.rejects(waitForOwnedHealth({port:41001,
  child:{exitCode:2,signalCode:null},expectedConfigSha256:'expected-instance',
  getDiagnostics:()=>({stderr:'fixture exit'}),timeoutMs:5000}),/TRANSFER_FIXTURE_CHILD_EXITED/);
});
test('forbidden port 1720 is rejected by fetch before network contact',async()=>{
 const error=await fetch('http://127.0.0.1:1720/health').then(()=>null,e=>e);
 assert.equal(error?.cause?.message,'bad port');
});
