// End-to-end MCP checks against an isolated server copy. Never contacts live ports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=net.createServer();await new Promise((r,j)=>s.listen(0,'127.0.0.1',r).once('error',j));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function fixture(enabled){
 const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-wf-http-'))),app=path.join(root,'app'),project=path.join(root,'project');
 fs.mkdirSync(project);fs.mkdirSync(app);fs.cpSync(path.join(repo,'src'),path.join(app,'src'),{recursive:true});
 const p=await port();const config={host:'127.0.0.1',port:p,deviceName:'WorkflowFixture',allowedRoots:[root],allowedPrograms:['node','git'],maxCommandMs:10000,maxReadBytes:524288,maxWriteBytes:524288,auditLog:'var/audit.jsonl',powerMode:{enabled:true,fullFilesystem:true,allowShell:false,allowProcessControl:false,backupRoot:path.join(root,'backups'),guiControl:{enabled:false}}};
 if(enabled)config.durableWorkflows={enabled:true,directory:path.join(root,'memory'),executionTools:['system_status','list_directory','read_text','write_text','run_project_command']};
 const cfg=path.join(root,'config.json'),raw=JSON.stringify(config);fs.writeFileSync(cfg,raw);
 const expectedHash=createHash('sha256').update(raw).digest('hex');let child,output='';
 const start=async()=>{
  output='';child=spawn(process.execPath,[path.join(app,'src','server-v0.3.mjs')],{cwd:app,env:{...process.env,REMOTE_COMMANDER_CONFIG:cfg},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',d=>output=(output+d).slice(-20000));child.stderr.on('data',d=>output=(output+d).slice(-20000));
  for(let i=0;i<80;i++){if(child.exitCode!==null)throw Error(output);try{const r=await fetch(`http://127.0.0.1:${p}/health`,{signal:AbortSignal.timeout(300)});if(!r.ok){await pause(50);continue;}const b=await r.json();assert.equal(b.configSha256,expectedHash);return;}catch(e){if(e.code==='ERR_ASSERTION')throw e;}await pause(50);}throw Error('health timeout '+output);
 };
 const stop=async()=>{if(child&&child.exitCode===null){const closed=once(child,'close');child.kill();await closed;}};
 const rpc=async(name,args={})=>{const r=await fetch(`http://127.0.0.1:${p}/mcp`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(10000)});return r.json();};
 const invoke=async(name,args)=>{const r=await rpc(name,args);assert.ok(!r.error,JSON.stringify(r));assert.equal(r.result.isError,false,JSON.stringify(r));return r.result.structuredContent;};
 return {root,project,p,config,invoke,rpc,start,stop,async dispose(){await stop();fs.rmSync(root,{recursive:true,force:true});}};
}
test('live MCP create/write/read/checkpoint/restart/resume without repeating side effect',async()=>{
 const f=await fixture(true);try{
  await f.start();const status=await f.invoke('system_status');assert.equal(status.durableWorkflows.revision,'durable-workflows-r1');
  const meta=await f.invoke('workflow_status');assert.equal(meta.automaticReplay,false);
  await f.invoke('workflow_create',{id:'e2e',root:f.project,goal:'Test durable MCP',acceptance:['readback verified'],steps:[{id:'write',title:'Write once'},{id:'read',title:'Read'},{id:'command',title:'Version'}]});
  const request={id:'e2e',stepId:'write',expectedRevision:1,tool:'write_text',arguments:{path:'proof.txt',mode:'append',content:'one'}};
  let r=await f.invoke('workflow_call',request);assert.equal(r.outcome,'RECORDED_NOT_VALIDATED');assert.equal(r.revision,3);
  r=await f.invoke('workflow_call',{id:'e2e',stepId:'read',expectedRevision:3,tool:'read_text',arguments:{path:'proof.txt'}});assert.equal(r.result.text,'one');
  r=await f.invoke('workflow_call',{id:'e2e',stepId:'command',expectedRevision:5,tool:'run_project_command',arguments:{program:'node',args:['--version'],cwd:f.project}});assert.equal(r.result.exitCode,0);
  await f.invoke('workflow_checkpoint',{id:'e2e',expectedRevision:7,files:['proof.txt'],nextAction:'Review acceptance',summary:'Readback matches'});
  await f.stop();await f.start();r=await f.invoke('workflow_call',request);assert.equal(r.cachedReceipt,true);assert.equal(fs.readFileSync(path.join(f.project,'proof.txt'),'utf8'),'one');
  const resume=await f.invoke('workflow_resume',{id:'e2e'});assert.deepEqual(resume.blockers,[]);assert.equal(resume.acceptanceStatus,'UNVALIDATED');
  const exported=await f.invoke('workflow_export',{id:'e2e'});assert.equal(exported.bundle.state.revision,8);
 }finally{await f.dispose();}
});
test('host-approved wrapper does not inherit full-filesystem access outside workflow root',async()=>{
 const f=await fixture(true);try{await f.start();fs.writeFileSync(path.join(f.root,'outside.txt'),'must not read');
  await f.invoke('workflow_create',{id:'scope',root:f.project,goal:'Scope test',acceptance:['blocked'],steps:[{id:'read',title:'Read'}]});
  const r=await f.invoke('workflow_call',{id:'scope',stepId:'read',expectedRevision:1,tool:'read_text',arguments:{path:'../outside.txt'}});
  assert.equal(r.outcome,'UNCERTAIN');assert.equal(r.result,null);assert.equal(JSON.stringify(r).includes('must not read'),false);
 }finally{await f.dispose();}
});
test('disabled mode exposes no workflow tools and creates no memory database',async()=>{
 const f=await fixture(false);try{await f.start();const status=await f.invoke('system_status');assert.equal(status.durableWorkflows.enabled,false);
  const r=await f.rpc('workflow_list');assert.equal(r.error.code,-32602);assert.equal(fs.existsSync(path.join(f.root,'memory')),false);
 }finally{await f.dispose();}
});
