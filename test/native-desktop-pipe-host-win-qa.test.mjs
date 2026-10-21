// QA ONLY: one retained Windows Desktop host serves independent OS clients
// over a current-user-only named pipe, then closes both private desktops.
// No real native input, active desktop switch, pixels or ChatGPT auth.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=path.join(root,'tools','native-desktop-pipe-host-win-qa.ps1');
const client=path.join(root,'tools','native-desktop-pipe-client-win-qa.mjs');
const pwsh=path.join(process.env.ProgramFiles||'C:\\Program Files','PowerShell','7','pwsh.exe');
const timeout=(ms,what)=>new Promise((_,reject)=>{
  const t=setTimeout(()=>reject(Error(what)),ms);
  t.unref?.();
});
function execClient(pipe,command){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[client,pipe,command],{windowsHide:true,
      stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',x=>stdout+=x);
    child.stderr.on('data',x=>stderr+=x);
    child.on('error',reject);
    child.on('close',code=>{
      if(code!==0){reject(Error('QA_CLIENT_FAILED_'+code+':'+stderr));return;}
      try{resolve(JSON.parse(stdout.trim()));}
      catch(e){reject(Error('QA_CLIENT_BAD_JSON'));}
    });
  });
}
function unknownCommand(pipe,command='click'){
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection('\\\\.\\pipe\\'+pipe);
    let body='',complete=false;
    const stop=()=>{complete=true;socket.destroy();};
    socket.setTimeout(3000);
    socket.on('connect',()=>socket.write(command+'\n'));
    socket.on('data',data=>{
      body+=data;
      if(body.length>2000){stop();reject(Error('QA_UNBOUNDED_RESPONSE'));return;}
      if(!body.includes('\n'))return;
      try{const response=JSON.parse(body.trim());stop();resolve(response)}
      catch(e){stop();reject(e)}
    });
    socket.on('error',e=>{if(!complete){stop();reject(e)}});
    socket.on('timeout',()=>{stop();reject(Error('QA_PIPE_TIMEOUT'))});
  });
}
test('same retained Win32 Desktop objects survive independent pipe clients',
  {skip:process.platform!=='win32',timeout:75000},async()=>{
    const pipe='rc_qa_desk_'+randomBytes(16).toString('hex');
    const processHost=spawn(pwsh,['-NoLogo','-NoProfile','-NonInteractive',
      '-File',server,'-PipeName',pipe,'-LifetimeMs','60000'],{
      windowsHide:true,stdio:['ignore','pipe','pipe']
    });
    let stdout='',stderr='',hostExited=false,exitCode=null;
    const completion=new Promise(resolve=>{
      processHost.once('close',code=>{hostExited=true;exitCode=code;resolve(code)});
    });
    processHost.stdout.on('data',x=>stdout+=x);
    processHost.stderr.on('data',x=>stderr+=x);
    try{
      const started=Date.now();
      while(!stdout.includes('"ready":true')&&!hostExited&&Date.now()-started<29000)
        await new Promise(resolve=>setTimeout(resolve,80));
      assert.equal(hostExited,false,'host exited before ready: '+stderr);
      assert.match(stdout,/"ready":true/);
      const ready=JSON.parse(stdout.trim().split(/\r?\n/)[0]);
      assert.equal(ready.pipe,pipe);
      assert.equal(ready.sessionId>0,true);
      const peer=await execClient(pipe,'peer');
      assert.equal(peer.reply.ok,true);
      assert.equal(peer.reply.transport,'win32-named-pipe');
      assert.equal(peer.reply.clientPid,peer.clientPid);
      assert.equal(peer.reply.clientSession,ready.sessionId);
      assert.ok(peer.reply.clientPid>0);
      // Any caller-provided PID/session syntax is a denied command,
      // rather than overriding the OS-reported connected process.
      const forged=await unknownCommand(pipe,'peer:1:1');
      assert.deepEqual(forged,{ok:false,code:'QA_COMMAND_DENIED'});
      const first=await execClient(pipe,'status');
      const a=await execClient(pipe,'observeA');
      const b=await execClient(pipe,'observeB');
      const second=await execClient(pipe,'status');
      assert.equal(first.reply.ok,true);
      assert.equal(second.reply.ok,true);
      assert.notEqual(first.clientPid,a.clientPid);
      assert.notEqual(a.clientPid,b.clientPid);
      assert.notEqual(b.clientPid,second.clientPid);
      const [fa,fb]=first.reply.workers;
      const [sa,sb]=second.reply.workers;
      assert.notEqual(fa.pid,fb.pid);
      assert.notEqual(fa.desktop,fb.desktop);
      for(const [start,last] of [[fa,sa],[fb,sb]]){
        assert.equal(start.pid,last.pid);
        assert.equal(start.desktop,last.desktop);
        assert.equal(start.windowCount,1);
        assert.equal(last.windowCount,1);
        assert.equal(start.ownWindow,true);
        assert.equal(last.ownWindow,true);
        assert.equal(start.effectMode,'observation-only');
      }
      assert.equal(a.reply.result.pid,fa.pid);
      assert.equal(b.reply.result.pid,fb.pid);
      assert.equal(a.reply.result.desktop,fa.desktop);
      assert.equal(b.reply.result.desktop,fb.desktop);
      const denied=await unknownCommand(pipe);
      assert.deepEqual(denied,{ok:false,code:'QA_COMMAND_DENIED'});
      const stop=await execClient(pipe,'shutdown');
      assert.equal(stop.reply.stopping,true);
      const code=await Promise.race([completion,timeout(6000,'QA_HOST_NOT_STOPPED')]);
      assert.equal(code,0,stderr);
    }finally{
      if(!hostExited){
        processHost.kill();
        await Promise.race([completion,timeout(3000,'QA_HOST_KILL_TIMEOUT')]).catch(()=>{});
      }
    }
  });


test('host expires automatically and releases both Win32 worker processes',
  {skip:process.platform!=='win32',timeout:30000},async()=>{
    const pipe='rc_qa_desk_'+randomBytes(16).toString('hex');
    const host=spawn(pwsh,['-NoLogo','-NoProfile','-NonInteractive',
      '-File',server,'-PipeName',pipe,'-LifetimeMs','1900'],{
      windowsHide:true,stdio:['ignore','pipe','pipe']
    });
    let stdout='',stderr='',exited=false;
    const done=new Promise(resolve=>{
      host.once('close',code=>{exited=true;resolve(code)});
    });
    host.stdout.on('data',x=>stdout+=x);
    host.stderr.on('data',x=>stderr+=x);
    try{
      const begun=Date.now();
      while(!stdout.includes('"ready":true')&&!exited&&Date.now()-begun<12000)
        await new Promise(resolve=>setTimeout(resolve,60));
      assert.equal(exited,false,'host never became ready: '+stderr);
      const report=await execClient(pipe,'status');
      const workers=report.reply.workers;
      assert.equal(workers.length,2);
      assert.equal(workers.every(x=>x.ownWindow&&x.windowCount===1),true);
      const exit=await Promise.race([done,timeout(10000,'QA_EXPIRY_FAILED')]);
      assert.equal(exit,0,stderr);
      // Normal shutdown sends each hidden-window worker a stop event, waits
      // for its process exit, then frees private Win32 Desktop handles.
      for(const worker of workers){
        let alive=true;
        try{process.kill(worker.pid,0)}catch(e){
          if(e?.code==='ESRCH')alive=false;
          else throw e;
        }
        assert.equal(alive,false,'QA_CHILD_LINGERED_'+worker.pid);
      }
    }finally{
      if(!exited){
        host.kill();
        await Promise.race([done,timeout(3000,'QA_EXPIRY_CLEANUP')]).catch(()=>{});
      }
    }
  });
