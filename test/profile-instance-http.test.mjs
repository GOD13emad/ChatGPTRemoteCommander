import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildProfileInstance } from '../src/profile-instances.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const s=net.createServer();await new Promise((r,j)=>s.listen(0,'127.0.0.1',r).once('error',j));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
function shaIf(file){try{return createHash('sha256').update(fs.readFileSync(file)).digest('hex');}catch(e){if(e.code==='ENOENT')return null;throw e;}}

test('isolated profile server owns separate marker, private memory and conservative catalog',async()=>{
 const temp=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rc-profile-http-')));
 const project=path.join(temp,'project'),state=path.join(temp,'private-state');fs.mkdirSync(project);fs.mkdirSync(state);
 const p=await freePort();
 const base={host:'127.0.0.1',port:47831,allowedRoots:[project],allowedPrograms:['node','git'],maxReadBytes:524288,maxWriteBytes:524288,maxCommandMs:10000,auditLog:'var/audit.jsonl',powerMode:{enabled:true,fullFilesystem:true,allowShell:true,allowProcessControl:true,allowPermanentDelete:false,guiControl:{enabled:true}}};
 const built=buildProfileInstance({baseConfig:base,profile:'fixture-account',port:p,stateDirectory:state});
 const cfg=path.join(state,'config.json');fs.writeFileSync(cfg,built.json);
 const liveMarker=path.join(repo,'var','mcp-runtime.json'),before=shaIf(liveMarker);
 let child,output='';
 try{
  child=spawn(process.execPath,[path.join(repo,'src','server-v0.3.mjs')],{cwd:repo,env:{...process.env,REMOTE_COMMANDER_CONFIG:cfg},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',d=>output=(output+d).slice(-12000));child.stderr.on('data',d=>output=(output+d).slice(-12000));
  let health;
  const startupDeadline=Date.now()+30000;
  while(Date.now()<startupDeadline){
   if(child.exitCode!==null)throw new Error(`isolated server exited before healthy: exitCode=${child.exitCode}; output=${output}`);
   try{const r=await fetch('http://127.0.0.1:'+p+'/health',{signal:AbortSignal.timeout(300)});if(r.ok){health=await r.json();break;}}catch{}
   await pause(50);
  }
  assert.ok(health,`isolated server did not become healthy within 30000ms; output=${output}`);assert.equal(health.instance.profile,'fixture-account');assert.equal(health.instance.isolated,true);
  assert.equal(health.configSha256,built.configSha256,'candidate must bind exactly this private config');
  assert.equal(health.version,JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8')).version,'candidate must identify exact source package train');
  const rpc=async(name,args={})=>{const r=await fetch('http://127.0.0.1:'+p+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});return r.json();};
  const status=await rpc('system_status');assert.equal(status.result.isError,false);const s=status.result.structuredContent;
  assert.equal(s.instance.profile,'fixture-account');assert.equal(s.powerMode.enabled,false);assert.equal(s.durableWorkflows.enabled,true);assert.deepEqual(s.allowedPrograms,[]);
  const list=await fetch('http://127.0.0.1:'+p+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})}).then(r=>r.json());
  const names=list.result.tools.map(x=>x.name);assert.ok(names.includes('workflow_create'));assert.ok(names.includes('run_shell'));
  const blocked=await rpc('run_shell',{command:'echo should-not-run'});assert.equal(blocked.result.isError,true);assert.match(blocked.result.content[0].text,/Power Mode is disabled/);
  const noCommand=await rpc('run_project_command',{program:'node',args:['--version'],cwd:project});assert.equal(noCommand.result.isError,true);assert.match(noCommand.result.content[0].text,/program not allowed/);
  const wfStatus=await rpc('workflow_status');assert.equal(wfStatus.result.isError,false);assert.equal(wfStatus.result.structuredContent.executionTools.includes('run_project_command'),false);
  const created=await rpc('workflow_create',{id:'isolated',root:project,goal:'remember safely',acceptance:['resume'],steps:[{id:'one',title:'inspect'}]});assert.equal(created.result.isError,false);
  assert.equal(fs.existsSync(path.join(state,'workflows','workflows.sqlite')),true);
  const marker=JSON.parse(fs.readFileSync(path.join(state,'mcp-runtime.json'),'utf8'));assert.equal(marker.port,p);assert.equal(marker.instance.profile,'fixture-account');
  assert.equal(shaIf(liveMarker),before,'isolated server must not overwrite primary runtime marker');
  // Non-destructive canary rollback/recovery: stop only our child, reopen the exact
  // private instance, and verify that its workflow persisted with no new privileges.
  const firstPid=child.pid;
  const firstClose=once(child,'close');assert.equal(child.kill('SIGTERM'),true);await firstClose;
  child=null;
  let refused=false;
  try { await fetch('http://127.0.0.1:'+p+'/health',{signal:AbortSignal.timeout(800)}); }
  catch { refused=true; }
  assert.equal(refused,true,'stopped candidate must release its loopback endpoint');
  child=spawn(process.execPath,[path.join(repo,'src','server-v0.3.mjs')],{
    cwd:repo,env:{...process.env,REMOTE_COMMANDER_CONFIG:cfg},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',d=>output=(output+d).slice(-12000));
  child.stderr.on('data',d=>output=(output+d).slice(-12000));
  let recovered=null;
  const restartDeadline=Date.now()+15000;
  while(Date.now()<restartDeadline){
    if(child.exitCode!==null)throw new Error('isolated recovery exited: '+output);
    try {
      const r=await fetch('http://127.0.0.1:'+p+'/health',{signal:AbortSignal.timeout(300)});
      if(r.ok){recovered=await r.json();break;}
    }catch{}
    await pause(50);
  }
  assert.ok(recovered,'isolated recovery must rebind and become healthy: '+output);
  assert.equal(recovered.configSha256,built.configSha256);
  assert.equal(recovered.instance.profile,'fixture-account');
  const saved=await rpc('workflow_get',{id:'isolated'});
  assert.equal(saved.result.isError,false,'private workflow survives exact candidate restart');
  assert.equal(saved.result.structuredContent.state.revision,1);
  const afterRestart=JSON.parse(fs.readFileSync(path.join(state,'mcp-runtime.json'),'utf8'));
  assert.equal(afterRestart.pid,child.pid);
  assert.notEqual(afterRestart.pid,firstPid);
  const recoveredStatus=await rpc('system_status');
  assert.equal(recoveredStatus.result.isError,false);
  assert.equal(recoveredStatus.result.structuredContent.powerMode.enabled,false,'no privilege upgrade on recovery');
  assert.equal(shaIf(liveMarker),before,'primary runtime marker remains byte-identical after recovery');
 } finally {
  if(child&&child.exitCode===null){const closed=once(child,'close');child.kill();await closed;}
  fs.rmSync(temp,{recursive:true,force:true});
 }
});
