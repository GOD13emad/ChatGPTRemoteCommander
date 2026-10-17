import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn, fork } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { startLinuxLocalManagement } from '../src/local-management-linux.mjs';
import { encodeManagementRequest } from '../src/local-management-contract.mjs';
import { createWorkflowTools } from '../src/workflow-tools.mjs';

const supported=process.platform==='linux'&&process.getuid?.()!==0;
const native=(name,fn)=>test(name,{skip:!supported,timeout:15000},fn);
const target={deviceId:'fixture',profileId:'default',configSha256:'1'.repeat(64),routeGeneration:1};
const clientPath=fileURLToPath(new URL('./fixtures/local-management-native-client.py',import.meta.url));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=3000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(20);}assert.fail('BOUNDED_OBSERVATION_TIMEOUT');}
async function fixture(t, extra={}) {
  const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rcm-test-')));
  let identity={...target},controls=0;
  const tools=createWorkflowTools({config:{durableWorkflows:{enabled:true,directory:path.join(root,'state'),scheduler:{enabled:false}}},roots:[root],device:'fixture',configSha256:'1'.repeat(64),lookup:()=>null,validateSchema:()=>[],dispatch:async()=>{assert.fail('Project steps must not execute in management tests');}});
  await tools.execute('workflow_create',{id:'sample',root,goal:'Native management fixture',acceptance:['Control intent'],steps:[{id:'one',title:'Never dispatch this step'}]});
  const wrapped={definitions:tools.definitions,execute:(name,args)=>{if(name==='workflow_control')controls++;return tools.execute(name,args);}};
  const endpoints=[];
  t.after(async()=>{for(const endpoint of endpoints)await endpoint.close();await tools.close();fs.rmSync(root,{recursive:true,force:true});});
  async function open(options={}){
    const endpoint=await startLinuxLocalManagement({enabled:true,runtimeDirectory:root,target,readIdentity:()=>identity,workflowTools:wrapped,sessionMs:10000,idleMs:2000,...extra,...options});
    endpoints.push(endpoint);return endpoint;
  }
  return {root,tools,wrapped,open,rotate:()=>{identity={...identity,routeGeneration:2};},controls:()=>controls};
}
function rawClient(t, endpoint) {
  const socket=net.createConnection(endpoint.endpoint);const values=[],waiters=[];let buffer=Buffer.alloc(0),ended=false;
  const rejectAll=()=>{ended=true;for(const item of waiters.splice(0)){clearTimeout(item.timer);item.reject(new Error('CLOSED'));}};
  socket.on('error',rejectAll);socket.on('close',rejectAll);
  socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);assert.ok(buffer.length<=65536);while(buffer.includes(10)){const i=buffer.indexOf(10),value=JSON.parse(buffer.subarray(0,i).toString());buffer=buffer.subarray(i+1);const item=waiters.shift();if(item){clearTimeout(item.timer);item.resolve(value);}else values.push(value);}});
  const next=()=>{if(values.length)return Promise.resolve(values.shift());if(ended)return Promise.reject(new Error('CLOSED'));return new Promise((resolve,reject)=>{const item={resolve,reject,timer:null};item.timer=setTimeout(()=>{const i=waiters.indexOf(item);if(i>=0)waiters.splice(i,1);reject(new Error('TIMEOUT'));},3000);waiters.push(item);});};
  t.after(()=>socket.destroy());
  return {socket,next};
}
function wire(boot,delta={}){
  const now=Date.now();return encodeManagementRequest({schema:1,sessionId:boot.session.sessionId,target:boot.session.target,requestId:'native-click',action:'workflow.pause',workflowId:'sample',expectedRevision:1,issuedAtEpochMs:now,expiresAtEpochMs:now+10000,...delta},Buffer.from(boot.keyHex,'hex'));
}
function launchClient(t){
  const p=spawn('/usr/bin/python3',['-I','-u',clientPath],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});let stdout='',stderr='';
  p.stdout.on('data',x=>{stdout+=x;assert.ok(stdout.length<65536);});p.stderr.on('data',x=>{stderr+=x;assert.ok(stderr.length<65536);});
  const done=new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',code=>resolve({code,stdout,stderr}));});
  t.after(async()=>{if(p.exitCode===null&&p.signalCode===null)p.kill('SIGKILL');await done.catch(()=>{});});
  return {pid:p.pid,send:value=>p.stdin.end(JSON.stringify(value)+'\n'),done};
}

native('transport is opt-in and wrong runtime identity creates no endpoint',async t=>{
  const f=await fixture(t);await assert.rejects(startLinuxLocalManagement({enabled:false}),/MANAGEMENT_NOT_ENABLED/);
  await assert.rejects(f.open({readIdentity:()=>({...target,routeGeneration:99})}),/MANAGEMENT_TARGET_CHANGED/);
  assert.deepEqual(fs.readdirSync(f.root),['state']);
});
native('real kernel peer UID/PID precedes bootstrap and socket permissions are private',async t=>{
  const f=await fixture(t),ep=await f.open(),client=rawClient(t,ep),boot=await client.next();
  assert.equal(fs.statSync(ep.endpoint).mode&0o777,0o600);assert.equal(fs.statSync(path.dirname(ep.endpoint)).mode&0o777,0o700);
  assert.equal(ep.status().peer.uid,process.getuid());assert.equal(ep.status().peer.pid,process.pid);
  assert.equal(boot.session.authentication,'LINUX_SO_PEERCRED_SAME_UID_SESSION');assert.equal(boot.keyHex.length,64);
  assert.equal(JSON.stringify(ep.status()).includes(boot.keyHex),false);assert.equal(JSON.stringify(ep.status()).includes('keyHex'),false);
  await ep.close();assert.equal(ep.status().helperExited,true);assert.equal(fs.existsSync(ep.endpoint),false);
});
native('real Python client pause, duplicate and cancel use one resident Core and never dispatch a project step',async t=>{
  const f=await fixture(t),client=launchClient(t),ep=await f.open({expectedClientPid:client.pid});
  client.send({endpoint:ep.endpoint,serverPid:ep.helperPid,target,commands:[['workflow.pause','sample',1,'pause-1'],['workflow.pause','sample',1,'pause-1'],['workflow.cancel','sample',2,'cancel-2']]});
  const result=await client.done;assert.equal(result.code,0,result.stdout+result.stderr);const parsed=JSON.parse(result.stdout);
  assert.deepEqual(parsed.receipts.map(x=>x.newRevision),[2,2,3]);assert.equal(f.controls(),2);
  const state=(await f.tools.execute('workflow_get',{id:'sample'})).state;
  assert.equal(state.control.intent,'CANCELLED');assert.equal(state.steps[0].status,'pending');
  assert.equal((await f.tools.execute('workflow_status',{})).runnerConfigured,false);
  await ep.closed;assert.equal(fs.existsSync(ep.endpoint),false);
});
native('a different actual client PID cannot obtain bootstrap',async t=>{
  const f=await fixture(t),ep=await f.open({expectedClientPid:1,idleMs:100}),client=rawClient(t,ep);
  await assert.rejects(client.next(),/CLOSED|TIMEOUT/);await ep.closed;assert.equal(f.controls(),0);assert.equal(ep.status().peer,null);
});
native('native client verifies the real server PID before trusting bootstrap',async t=>{
  const f=await fixture(t),client=launchClient(t),ep=await f.open({expectedClientPid:client.pid});
  client.send({endpoint:ep.endpoint,serverPid:ep.helperPid+1,target,commands:[]});
  const result=await client.done;assert.equal(result.code,2);assert.match(result.stdout,/MANAGEMENT_PEER_DENIED/);assert.equal(f.controls(),0);
});
native('eight duplicate IPC frames have only one underlying control mutation',async t=>{
  const f=await fixture(t),ep=await f.open(),client=rawClient(t,ep),boot=await client.next(),w=wire(boot);
  client.socket.write((w+'\n').repeat(8));const receipts=[];for(let i=0;i<8;i++)receipts.push(await client.next());
  assert.equal(f.controls(),1);assert.ok(receipts.every(x=>x.state==='APPLIED'&&x.newRevision===2));
});
for(const mutation of ['mac','unknown-action','extra-key','duplicate-key'])native(`untrusted ${mutation} frame is refused without effect or echo`,async t=>{
  const f=await fixture(t),ep=await f.open(),client=rawClient(t,ep),boot=await client.next();let w=wire(boot);
  if(mutation==='duplicate-key')w=w.replace('"schema":1','"schema":1,"schema":1');
  else {const v=JSON.parse(w);if(mutation==='mac')v.mac='0'.repeat(64);if(mutation==='unknown-action')v.payload.action='shell.execute';if(mutation==='extra-key')v.payload.secret='DO_NOT_ECHO';
    if(mutation!=='mac')v.mac=createHmac('sha256',Buffer.from(boot.keyHex,'hex')).update(JSON.stringify(v.payload)).digest('hex');w=JSON.stringify(v);}
  const reply=client.next();client.socket.write(w+'\n');await assert.rejects(reply,/CLOSED/);assert.equal(f.controls(),0);
});
native('oversized frame closes the channel before dispatch',async t=>{
  const f=await fixture(t),ep=await f.open(),client=rawClient(t,ep);await client.next();const reply=client.next();
  client.socket.write('x'.repeat(9000)+'\n');await assert.rejects(reply,/CLOSED/);assert.equal(f.controls(),0);
});
native('idle partial frame is bounded and the owned helper exits',async t=>{
  const f=await fixture(t),ep=await f.open({idleMs:100}),client=rawClient(t,ep);await client.next();const reply=client.next();client.socket.write('{');
  await assert.rejects(reply,/CLOSED/);await ep.closed;assert.equal(f.controls(),0);assert.equal(fs.existsSync(ep.endpoint),false);
});
native('runtime rotation revokes old authority before a control request',async t=>{
  const f=await fixture(t),ep=await f.open(),client=rawClient(t,ep),boot=await client.next();f.rotate();
  const reply=client.next();client.socket.write(wire(boot)+'\n');await assert.rejects(reply,/CLOSED/);assert.equal(f.controls(),0);
});
native('new endpoint has a new session and rejects the prior session wire',async t=>{
  const f=await fixture(t),first=await f.open(),old=rawClient(t,first),oldBoot=await old.next(),oldWire=wire(oldBoot);await first.close();
  const second=await f.open(),fresh=rawClient(t,second),newBoot=await fresh.next();
  assert.notEqual(newBoot.session.sessionId,oldBoot.session.sessionId);assert.notEqual(newBoot.keyHex,oldBoot.keyHex);
  const reply=fresh.next();fresh.socket.write(oldWire+'\n');await assert.rejects(reply,/CLOSED/);assert.equal(f.controls(),0);
});
native('public revocation closes the socket without dispatching',async t=>{
  const f=await fixture(t),ep=await f.open(),client=rawClient(t,ep);await client.next();const reply=client.next();ep.revoke();
  await assert.rejects(reply,/CLOSED/);await ep.closed;assert.equal(f.controls(),0);
});
native('uncertain effect deadline yields no APPLIED and terminates the session without retry',async t=>{
  const f=await fixture(t);let calls=0,finish;
  const ep=await f.open({operationTimeoutMs:20,workflowTools:{definitions:f.tools.definitions,execute:(name,args)=>{
    if(name==='workflow_control'){calls++;return new Promise(r=>{finish=r;});}return f.tools.execute(name,args);
  }}}),client=rawClient(t,ep),boot=await client.next();client.socket.write(wire(boot)+'\n');
  const result=await client.next();assert.equal(result.state,'UNCERTAIN');assert.equal(calls,1);finish();await ep.closed;
  assert.equal(ep.status().phase,'UNCERTAIN');assert.equal(calls,1);
});
native('unsafe root is rejected without changing its permissions or touching a symlink target',async t=>{
  const f=await fixture(t);const unsafe=path.join(f.root,'unsafe');fs.mkdirSync(unsafe,{mode:0o755});fs.chmodSync(unsafe,0o755);
  assert.equal(fs.statSync(unsafe).mode&0o777,0o755); // Explicit fixture precondition independent of host umask.
  await assert.rejects(f.open({runtimeDirectory:unsafe}),/MANAGEMENT_RUNTIME_NOT_PRIVATE/);
  assert.equal(fs.statSync(unsafe).mode&0o777,0o755);
  const alias=path.join(f.root,'alias');fs.symlinkSync(unsafe,alias);
  await assert.rejects(f.open({runtimeDirectory:alias}),/MANAGEMENT_TRANSPORT_FAILED/);assert.deepEqual(fs.readdirSync(unsafe),[]);
});
native('protocol budget closes only its own session; no silent ID eviction',async t=>{
  const f=await fixture(t),ep=await f.open({maxRequests:1}),client=rawClient(t,ep),boot=await client.next();
  client.socket.write(wire(boot)+'\n');assert.equal((await client.next()).state,'APPLIED');await ep.closed;assert.equal(f.controls(),1);
});
native('abrupt parent death closes inherited pipes and the owned relay removes only its private socket',async t=>{
  const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'rcm-death-')));
  const child=fork(fileURLToPath(new URL('./fixtures/local-management-parent.mjs',import.meta.url)),[],{stdio:['ignore','ignore','ignore','ipc']});
  const end=new Promise(r=>child.once('exit',r));t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await end;fs.rmSync(root,{recursive:true,force:true});});
  const info=new Promise((resolve,reject)=>{child.once('message',x=>x.error?reject(new Error(x.error)):resolve(x));child.once('error',reject);});
  child.send({root,target});const ep=await info;assert.equal(fs.existsSync(ep.endpoint),true);
  child.kill('SIGKILL');await end;await until(()=>!fs.existsSync(ep.endpoint),5000);
  const st='/proc/'+ep.helperPid+'/stat';await until(()=>!fs.existsSync(st)||fs.readFileSync(st,'utf8').split(') ')[1].startsWith('Z '),5000);
  assert.deepEqual(fs.readdirSync(root),[]);
});
native('Python credential and descriptor guards pass independently',async()=>{
  const p=spawn('/usr/bin/python3',['-I','-B',fileURLToPath(new URL('./test_local_management_linux.py',import.meta.url))],{stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});
  let text='';for(const s of [p.stdout,p.stderr])s.on('data',x=>{text+=x;});const code=await new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',resolve);});
  assert.equal(code,0,text);assert.match(text,/Ran 13 tests/);assert.match(text,/OK/);
});
