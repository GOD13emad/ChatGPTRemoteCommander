import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { startWindowsLocalManagement } from '../src/local-management-windows.mjs';

const supported = process.platform === 'win32';
const native = (name,fn) => test(name,{skip:!supported,timeout:25000},fn);
const helper = fileURLToPath(new URL('../tools/local-management-windows.ps1',import.meta.url));
const target = {deviceId:'fixture',profileId:'default',configSha256:'1'.repeat(64),routeGeneration:1};
function tools() {
  let revision=1, control=null, calls=0;
  const api={
    definitions:[{name:'workflow_control'},{name:'workflow_get'}],
    async execute(name,args){
      if(name==='workflow_control'){
        assert.equal(args.id,'sample');
        assert.equal(args.expectedRevision,revision);
        assert.equal(args.action,'pause');
        calls++;
        revision++;control={intent:'PAUSED'};
        return {applied:true};
      }
      assert.equal(name,'workflow_get');
      return {state:{id:'sample',revision,control}};
    }
  };
  return {api,count:()=>calls,revision:()=>revision};
}
function spawnClient(t) {
  const p=spawn('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',helper,'-Mode','client'],{
    windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';
  p.stdout.on('data',x=>{stdout+=x;assert.ok(stdout.length<4000);});
  p.stderr.on('data',x=>{stderr+=x;assert.ok(stderr.length<4000);});
  const done=new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',code=>resolve({code,stdout,stderr}));});
  t.after(async()=>{if(p.exitCode===null&&p.signalCode===null)p.kill();await done.catch(()=>{});});
  return {pid:p.pid,send:body=>p.stdin.end(JSON.stringify(body)+'\n'),done};
}
native('Windows owner-only native Pipe transports one verified pause to EXISTING resident Workflow dispatcher',async t=>{
  const f=tools(),client=spawnClient(t),identity={...target};
  let endpoint;
  t.after(async()=>{await endpoint?.close();});
  endpoint=await startWindowsLocalManagement({enabled:true,expectedClientPid:client.pid,target,
    readIdentity:()=>identity,workflowTools:f.api,sessionMs:15000,idleMs:7000});
  assert.match(endpoint.pipeName,/^rcm-native-[a-f0-9]{32}$/);
  client.send({pipeName:endpoint.pipeName,serverPid:endpoint.helperPid,target,
    commands:[{action:'workflow.pause',workflowId:'sample',revision:1,requestId:'win-native-1'}]});
  const result=await client.done;
  assert.equal(result.code,0,'client='+result.stdout+' stderr='+result.stderr+' relay='+JSON.stringify(endpoint.status()));
  const receipt=JSON.parse(result.stdout.trim());
  assert.equal(receipt.peerVerified,true);
  assert.equal(receipt.state,'APPLIED');
  assert.equal(receipt.newRevision,2);
  assert.equal(f.revision(),2);
  assert.equal(f.count(),1);
  await endpoint.closed;
  assert.equal(endpoint.status().helperExited,true);
});
native('Windows helper is opt-in and wrong runtime identity opens no native channel',async()=>{
  const f=tools();
  await assert.rejects(startWindowsLocalManagement({enabled:false}),/MANAGEMENT_NOT_ENABLED/);
  await assert.rejects(startWindowsLocalManagement({enabled:true,expectedClientPid:1234,
    target,readIdentity:()=>({...target,routeGeneration:77}),workflowTools:f.api}),/MANAGEMENT_TARGET_CHANGED/);
  assert.equal(f.count(),0);
});

native('Windows wrong client process PID is denied by the kernel-credential relay with zero Core effects',async t=>{
  const f=tools(),client=spawnClient(t);
  const endpoint=await startWindowsLocalManagement({enabled:true,target,readIdentity:()=>target,
    workflowTools:f.api,expectedClientPid:client.pid+1,idleMs:3500,sessionMs:9000});
  t.after(async()=>{await endpoint.close();});
  client.send({pipeName:endpoint.pipeName,serverPid:endpoint.helperPid,target,
    commands:[{action:'workflow.pause',workflowId:'sample',revision:1,requestId:'wrong-client'}]});
  const result=await client.done;
  assert.notEqual(result.code,0);
  assert.equal(f.count(),0);
  await endpoint.closed;
  assert.equal(endpoint.status().helperExited,true);
  assert.equal(endpoint.status().peer,null);
});
native('Windows native client rejects the wrong kernel server PID and never dispatches',async t=>{
  const f=tools(),client=spawnClient(t);
  const endpoint=await startWindowsLocalManagement({enabled:true,target,readIdentity:()=>target,
    workflowTools:f.api,expectedClientPid:client.pid,idleMs:3500,sessionMs:9000});
  t.after(async()=>{await endpoint.close();});
  client.send({pipeName:endpoint.pipeName,serverPid:endpoint.helperPid+1,target,
    commands:[{action:'workflow.pause',workflowId:'sample',revision:1,requestId:'wrong-server'}]});
  const result=await client.done;
  assert.notEqual(result.code,0);
  assert.equal(f.count(),0);
  await endpoint.closed;
  assert.equal(endpoint.status().helperExited,true);
});
native('Windows uncertain Core operation never reports APPLIED and never auto-retries',async t=>{
  const f=tools(),client=spawnClient(t);
  let calls=0;
  const slow={definitions:f.api.definitions,execute:(name,args)=>{
    if(name==='workflow_control'){calls++;return new Promise(()=>{});}
    return f.api.execute(name,args);
  }};
  const endpoint=await startWindowsLocalManagement({enabled:true,target,readIdentity:()=>target,
    workflowTools:slow,expectedClientPid:client.pid,idleMs:6000,sessionMs:12000,operationTimeoutMs:30});
  t.after(async()=>{await endpoint.close();});
  client.send({pipeName:endpoint.pipeName,serverPid:endpoint.helperPid,target,
    commands:[{action:'workflow.pause',workflowId:'sample',revision:1,requestId:'uncertain-1'}]});
  const result=await client.done;
  assert.equal(result.code,0,'client='+result.stdout+' stderr='+result.stderr);
  assert.equal(JSON.parse(result.stdout.trim()).state,'UNCERTAIN');
  assert.equal(calls,1);
  assert.equal(f.revision(),1);
  await endpoint.closed;
  assert.equal(endpoint.status().helperExited,true);
  assert.equal(calls,1);
});

native('Windows target generation rotation before native control denies all effects',async t=>{
  const f=tools(),client=spawnClient(t);
  let identity={...target};
  const endpoint=await startWindowsLocalManagement({enabled:true,target,readIdentity:()=>identity,
    workflowTools:f.api,expectedClientPid:client.pid,idleMs:3500,sessionMs:9000});
  t.after(async()=>{await endpoint.close();});
  identity={...target,routeGeneration:2};
  client.send({pipeName:endpoint.pipeName,serverPid:endpoint.helperPid,target,
    commands:[{action:'workflow.pause',workflowId:'sample',revision:1,requestId:'rotated-target'}]});
  const result=await client.done;
  assert.notEqual(result.code,0);
  assert.equal(f.count(),0);
  await endpoint.closed;
  assert.equal(endpoint.status().helperExited,true);
});
native('Windows invalid MAC from same-account PID cannot invoke resident Core',async t=>{
  const f=tools();
  const endpoint=await startWindowsLocalManagement({enabled:true,target,readIdentity:()=>target,
    workflowTools:f.api,expectedClientPid:process.pid,idleMs:5000,sessionMs:10000});
  t.after(async()=>{await endpoint.close();});
  const socket=net.createConnection('\\\\.\\pipe\\'+endpoint.pipeName);
  t.after(()=>socket.destroy());
  const boot=await new Promise((resolve,reject)=>{
    let buf='';
    const timeout=setTimeout(()=>{socket.destroy();reject(new Error('BOOTSTRAP_TIMEOUT'));},4000);
    socket.on('error',reject);
    socket.on('data',chunk=>{
      buf+=chunk.toString('utf8');
      assert.ok(buf.length<5000);
      if(buf.includes('\n')){
        clearTimeout(timeout);
        socket.removeAllListeners('data');
        resolve(JSON.parse(buf.split('\n')[0]));
      }
    });
  });
  assert.equal(boot.session.authentication,'WINDOWS_NAMED_PIPE_CURRENT_USER_ONLY_PID');
  const now=Date.now();
  const payload={schema:1,sessionId:boot.session.sessionId,target,requestId:'bad-mac',
    action:'workflow.pause',workflowId:'sample',expectedRevision:1,issuedAtEpochMs:now,expiresAtEpochMs:now+10000};
  socket.write(JSON.stringify({payload,mac:'0'.repeat(64)})+'\n');
  await endpoint.closed;
  assert.equal(endpoint.status().helperExited,true);
  assert.equal(f.count(),0);
  assert.equal(f.revision(),1);
});
