import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assembleCandidate} from '../tools/v012-unified-release-assemble.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function unusedPort(){
 const server=net.createServer();
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
 });
 const port=server.address().port;
 await new Promise(resolve=>server.close(resolve));
 return port;
}
async function awaitHealth(port,child){
 const url='http://127.0.0.1:'+port+'/health';
 for(let i=0;i<60;i++){
  if(child.exitCode!==null)throw Error('PACKAGED_CORE_EXITED_EARLY');
  try{
   const r=await fetch(url,{signal:AbortSignal.timeout(600)});
   if(r.ok)return await r.json();
  }catch{}
  await delay(150);
 }
 throw Error('PACKAGED_CORE_HEALTH_TIMEOUT');
}
test('exact-source packaged headless Core serves local /health without live owner grants',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'v012-headless-real-runtime-'));
 let child=null;
 try{
  fs.mkdirSync(path.join(home,'projects'),{mode:0o700});
  const built=assembleCandidate({sourceRoot:repo,outputParent:home,mode:'headless'});
  assert.equal(built.version,'0.12.0-rc.1');
  assert.equal(built.sourceCoreVersion,'0.11.0-dev.19');
  const port=await unusedPort();
  const conf=JSON.parse(fs.readFileSync(path.join(repo,'config.json'),'utf8'));
  conf.host='127.0.0.1';conf.port=port;
  conf.allowedRoots=[path.join(home,'projects')];
  conf.allowedPrograms=[];
  conf.powerMode={enabled:false};conf.autoUpdate={enabled:false};
  conf.asyncOperations={enabled:false};
  conf.auditLog=path.join(home,'audit.jsonl');
  const config=path.join(home,'config-fixture.json');
  fs.writeFileSync(config,JSON.stringify(conf),{mode:0o600});
  const core=path.join(built.bundle,'src','server-v0.3.mjs');
  let stderr='';
  child=spawn(process.execPath,[core],{
   cwd:built.bundle,env:{...process.env,REMOTE_COMMANDER_CONFIG:config},
   stdio:['ignore','ignore','pipe'],windowsHide:true
  });
  child.stderr.on('data',b=>{stderr+=b.toString().slice(0,1500);});
  const health=await awaitHealth(port,child);
  assert.equal(health.ok,true);
  assert.equal(health.version,'0.11.0-dev.19');
  const origin=await fetch('http://127.0.0.1:'+port+'/health',{
   headers:{Origin:'https://example.invalid'},signal:AbortSignal.timeout(2000)
  });
  assert.equal(origin.status,403);
  const wrongType=await fetch('http://127.0.0.1:'+port+'/mcp',{
   method:'POST',headers:{'Content-Type':'text/plain'},body:'{}',
   signal:AbortSignal.timeout(2000)
  });
  assert.equal(wrongType.status,415);
  assert.equal(conf.powerMode.enabled,false);
  console.log('V012_PACKAGED_CORE_LOOPBACK_SMOKE_PASS runtime='+health.version);
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){
   const finished=new Promise(resolve=>child.once('exit',()=>resolve(true)));
   child.kill();
   const exited=await Promise.race([finished,delay(2200).then(()=>false)]);
   if(!exited)throw Error('V012_PACKAGED_CORE_PROCESS_NOT_RETIRED');
  }
  fs.rmSync(home,{recursive:true,force:true});
 }
},{timeout:22000});
