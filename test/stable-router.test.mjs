import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { startRouter, writeRouterStateAtomic } from '../src/stable-router.mjs';

function temp(){return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-router-')));}
function listen(server){return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});}
function close(server){return new Promise(resolve=>server.close(resolve));}
async function freePort(){
 const s=http.createServer();const p=await listen(s);await close(s);return p;
}
test('stable router switches atomically and drains in-flight request on old backend',async()=>{
 const root=temp();let router,a,b;try{
   let releaseA;const waitA=new Promise(r=>releaseA=r);
   a=http.createServer(async(req,res)=>{
     if(req.url==='/slow'){await waitA;res.writeHead(200,{'content-type':'text/plain'});res.end('A-slow');return;}
     res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({backend:'A',url:req.url}));
   });
   b=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({backend:'B',url:req.url}));});
   const aPort=await listen(a),bPort=await listen(b),listenPort=await freePort();
   const stateFile=path.join(root,'router.json');
   const baseState={schema:1,profile:'default',generation:1,active:{port:aPort,version:'1.0.0',commit:'a'.repeat(40),configSha256:'1'.repeat(64)},updatedAt:new Date().toISOString()};
   writeRouterStateAtomic(stateFile,baseState);
   router=await startRouter({listenPort,stateFile});
   let r=await fetch('http://127.0.0.1:'+listenPort+'/mcp');assert.equal((await r.json()).backend,'A');

   const slow=fetch('http://127.0.0.1:'+listenPort+'/slow').then(x=>x.text());
   for(let i=0;i<50;i++){const st=router.status();if(Number(st.inflightByPort[aPort]||0)>0)break;await new Promise(r=>setTimeout(r,10));}
   assert.equal(Number(router.status().inflightByPort[aPort]||0),1);

   writeRouterStateAtomic(stateFile,{...baseState,generation:2,active:{port:bPort,version:'2.0.0',commit:'b'.repeat(40),configSha256:'2'.repeat(64)},updatedAt:new Date().toISOString()},1);
   r=await fetch('http://127.0.0.1:'+listenPort+'/mcp');assert.equal((await r.json()).backend,'B');
   assert.equal(Number(router.status().inflightByPort[aPort]||0),1);

   releaseA();assert.equal(await slow,'A-slow');
   for(let i=0;i<50&&Number(router.status().inflightByPort[aPort]||0)>0;i++)await new Promise(r=>setTimeout(r,10));
   assert.equal(Number(router.status().inflightByPort[aPort]||0),0);
   assert.equal(router.status().state.generation,2);
 }finally{
   if(router)await router.close();
   if(a)await close(a);
   if(b)await close(b);
   fs.rmSync(root,{recursive:true,force:true});
 }
});
test('router exposes conservative per-request drain metadata',async()=>{
 const root=temp();let router,a;try{
   let release;const gate=new Promise(r=>release=r);
   a=http.createServer(async(req,res)=>{await gate;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true}));});
   const aPort=await listen(a),listenPort=await freePort(),stateFile=path.join(root,'router.json');
   writeRouterStateAtomic(stateFile,{schema:1,profile:'default',generation:1,active:{port:aPort,version:'1',commit:'a'.repeat(40),configSha256:'1'.repeat(64)},updatedAt:new Date().toISOString()});
   router=await startRouter({listenPort,stateFile});
   const sub=fetch('http://127.0.0.1:'+listenPort+'/mcp',{method:'POST',headers:{'content-type':'application/json','mcp-method':'subscriptions/listen'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'subscriptions/listen'})}).then(r=>r.json());
   const tool=fetch('http://127.0.0.1:'+listenPort+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'run_shell',arguments:{command:'redacted'}}})}).then(r=>r.json());
   for(let i=0;i<80;i++){if(Number(router.status().inflightByPort[aPort]||0)===2)break;await new Promise(r=>setTimeout(r,10));}
   const st=router.status(),details=st.inflightDetailsByPort[aPort];assert.equal(details.length,2);
   const s=details.find(x=>x.rpcMethod==='subscriptions/listen'),m=details.find(x=>x.rpcMethod==='tools/call');
   assert.equal(s.cancellable,true);assert.equal(s.path,'/mcp');
   assert.equal(m.cancellable,false);assert.equal(m.rpcName,'run_shell');
   assert.ok(!JSON.stringify(details).includes('redacted'),'router status must never retain tool arguments');
   release();await Promise.all([sub,tool]);
   for(let i=0;i<50&&Number(router.status().inflightByPort[aPort]||0)>0;i++)await new Promise(r=>setTimeout(r,10));
   assert.equal(Number(router.status().inflightByPort[aPort]||0),0);assert.deepEqual(router.status().inflightDetailsByPort,{});
 }finally{if(router)await router.close();if(a)await close(a);fs.rmSync(root,{recursive:true,force:true});}
});

test('router status and runtime bind the exact loaded source hash',async()=>{
 const root=temp();let router;try{
   const listenPort=await freePort(),deadPort=await freePort(),stateFile=path.join(root,'router.json'),runtimeFile=path.join(root,'router.runtime.json');
   writeRouterStateAtomic(stateFile,{schema:1,profile:'default',generation:1,active:{port:deadPort,version:'1',commit:'a'.repeat(40),configSha256:'1'.repeat(64)},updatedAt:new Date().toISOString()});
   router=await startRouter({listenPort,stateFile,runtimeFile});
   const expected=createHash('sha256').update(fs.readFileSync(new URL('../src/stable-router.mjs',import.meta.url))).digest('hex');
   assert.equal(router.status().sourceSha256,expected);
   const status=await (await fetch('http://127.0.0.1:'+listenPort+'/router/status')).json();
   assert.equal(status.sourceSha256,expected);
   const runtime=JSON.parse(fs.readFileSync(runtimeFile,'utf8'));
   assert.equal(runtime.sourceSha256,expected);
   assert.equal(runtime.pid,process.pid);
   assert.equal(runtime.port,listenPort);
 }finally{if(router)await router.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('router generation conflict prevents stale cutover',async()=>{
 const root=temp();try{
   const stateFile=path.join(root,'router.json');
   const s={schema:1,profile:'x',generation:3,active:{port:48000,version:'1',commit:'a'.repeat(40),configSha256:'1'.repeat(64)},updatedAt:new Date().toISOString()};
   writeRouterStateAtomic(stateFile,s);
   assert.throws(()=>writeRouterStateAtomic(stateFile,{...s,generation:4},2),/GENERATION_CONFLICT/);
   assert.equal(JSON.parse(fs.readFileSync(stateFile,'utf8')).generation,3);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('upstream failure cannot underflow inflight accounting',async()=>{
 const root=temp();let router;try{
   const dead=await freePort(),listenPort=await freePort();
   const stateFile=path.join(root,'router.json');
   writeRouterStateAtomic(stateFile,{schema:1,profile:'default',generation:1,active:{port:dead,version:'1',commit:'a'.repeat(40),configSha256:'1'.repeat(64)},updatedAt:new Date().toISOString()});
   router=await startRouter({listenPort,stateFile});
   const r=await fetch('http://127.0.0.1:'+listenPort+'/mcp');
   assert.equal(r.status,502);
   for(let i=0;i<20&&Number(router.status().inflightByPort[dead]||0)!==0;i++)await new Promise(r=>setTimeout(r,10));
   assert.equal(Number(router.status().inflightByPort[dead]||0),0);
 }finally{if(router)await router.close();fs.rmSync(root,{recursive:true,force:true});}
});
