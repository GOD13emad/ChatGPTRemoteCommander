// E2E: the new Operator is part of the existing MCP service, not a second daemon.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){
 const s=net.createServer();
 await new Promise((ok,fail)=>s.listen(0,'127.0.0.1',ok).once('error',fail));
 const p=s.address().port;await new Promise(ok=>s.close(ok));return p;
}
async function make({workflow=false}={}){
 const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-operator-http-')));
 const app=path.join(root,'app');
 fs.mkdirSync(app);
 fs.cpSync(path.join(repo,'src'),path.join(app,'src'),{recursive:true});
 const port=await freePort();
 const config={
  host:'127.0.0.1',port,deviceName:'OperatorTest',allowedRoots:[root],
  allowedPrograms:['node','git'],maxCommandMs:10000,maxReadBytes:262144,
  maxWriteBytes:262144,auditLog:'var/audit.jsonl',
  powerMode:{enabled:true,fullFilesystem:false,allowShell:false,allowProcessControl:false,
    backupRoot:path.join(root,'backups'),browserControl:{enabled:false},guiControl:{enabled:false}}
 };
 if(workflow)config.durableWorkflows={enabled:true,directory:path.join(root,'memory'),
  executionTools:['system_status','list_directory','read_text','write_text']};
 const cf=path.join(root,'config.json');
 const raw=JSON.stringify(config);fs.writeFileSync(cf,raw);
 const expected=createHash('sha256').update(raw).digest('hex');
 let child,output='';
 const start=async()=>{
  child=spawn(process.execPath,[path.join(app,'src','server-v0.3.mjs')],{
   cwd:app,env:{...process.env,REMOTE_COMMANDER_CONFIG:cf},stdio:['ignore','pipe','pipe']
  });
  child.stdout.on('data',b=>output=(output+b).slice(-14000));
  child.stderr.on('data',b=>output=(output+b).slice(-14000));
  const deadline=Date.now()+20000;
  while(Date.now()<deadline){
   if(child.exitCode!==null)throw Error('Server exited: '+output);
   try{
    const r=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(400)});
    const s=await r.json();assert.equal(s.configSha256,expected);return;
   }catch(e){if(e.code==='ERR_ASSERTION')throw e;}
   await pause(50);
  }
  throw Error('Operator health did not start: '+output);
 };
 const rpc=async(method,params)=>{
  const r=await fetch('http://127.0.0.1:'+port+'/mcp',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(5000)
  });
  return r.json();
 };
 const call=async(name,args={})=>{
  const r=await rpc('tools/call',{name,arguments:args});
  assert.ok(!r.error,JSON.stringify(r));assert.equal(r.result?.isError,false,JSON.stringify(r));
  return r.result.structuredContent;
 };
 return {root,port,start,rpc,call,async dispose(){
  if(child&&child.exitCode===null){const close=once(child,'close');child.kill();await close;}
  fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});
 }};
}
test('MCP operator schema, route checks and default-deny on a fresh isolated daemon',async()=>{
 const f=await make();
 try{
  await f.start();
  const list=await f.rpc('tools/list',{}),names=(list.result?.tools||[]).map(x=>x.name);
  assert.deepEqual(['operator_status','operator_route','operator_advance'].map(n=>names.includes(n)),[true,true,true]);
  const status=await f.call('operator_status');
  assert.equal(status.operator,'CHAT_OWNED');
  assert.equal(status.architecture,'SINGLE_EXISTING_COMMANDER_EXECUTOR');
  assert.equal(status.workflow.runnerConfigured,false);
  assert.equal(status.routes.workflow,false);
  assert.equal((await f.call('operator_route',{kind:'file'})).state,'READY');
  assert.equal((await f.call('operator_route',{kind:'owned_browser'})).state,'BLOCKED');
  assert.equal((await f.call('operator_route',{kind:'desktop'})).state,'BLOCKED');
  assert.equal((await f.call('operator_route',{kind:'project'})).state,'BLOCKED');
  const blocked=await f.rpc('tools/call',{name:'operator_advance',
    arguments:{runId:'project',requestId:'isolated-no-run-001'}});
  assert.ok(blocked.error||blocked.result?.isError===true,JSON.stringify(blocked));
  assert.equal(fs.existsSync(path.join(f.root,'memory')),false);
 }finally{await f.dispose();}
});
test('enabled workflow store still cannot masquerade as enrolled project runner',async()=>{
 const f=await make({workflow:true});
 try{
  await f.start();const s=await f.call('operator_status');
  assert.equal(s.workflow.available,true);
  assert.equal(s.workflow.runnerConfigured,false);
  const route=await f.call('operator_route',{kind:'project'});
  assert.equal(route.reason,'PROJECT_RUNNER_NOT_CONFIGURED');
  const bad=await f.rpc('tools/call',{name:'operator_advance',
   arguments:{runId:'project',requestId:'isolated-disabled-run-002'}});
  assert.ok(bad.error||bad.result?.isError===true,JSON.stringify(bad));
 }finally{await f.dispose();}
});
