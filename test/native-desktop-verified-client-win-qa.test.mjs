// QA ONLY. Parent-spawn-pinned Windows pipe server identity verification.
// No global server secret, Native GUI dispatch, user input or production authentication.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const host=path.join(root,'tools','native-desktop-pipe-host-win-qa.ps1');
const verifiedClient=path.join(root,'tools','native-desktop-verified-client-win-qa.ps1');
const ordinaryClient=path.join(root,'tools','native-desktop-pipe-client-win-qa.mjs');
const pwsh=path.join(process.env.ProgramFiles||'C:\\Program Files','PowerShell','7','pwsh.exe');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('OS peer server PID and session pinned to spawned private QA host; wrong PID sends no command',
 {skip:process.platform!=='win32',timeout:45000},async()=>{
   const pipe='rc_qa_desk_'+randomBytes(16).toString('hex');
   const child=spawn(pwsh,['-NoLogo','-NoProfile','-NonInteractive','-File',
      host,'-PipeName',pipe,'-LifetimeMs','37000'],{
        windowsHide:true,stdio:['ignore','pipe','pipe']
      });
   let stdout='',stderr='',exited=false;
   const completed=new Promise(resolve=>child.once('close',code=>{exited=true;resolve(code)}));
   child.stdout.on('data',x=>stdout+=x);
   child.stderr.on('data',x=>stderr+=x);
   const call=async pid=>{
     const {stdout:out}=await exec(pwsh,['-NoLogo','-NoProfile','-NonInteractive',
        '-File',verifiedClient,'-PipeName',pipe,'-ExpectedServerPid',String(pid)],{
          windowsHide:true,timeout:9000,maxBuffer:8192
        });
     return JSON.parse(out.trim());
   };
   try{
     const start=Date.now();
     while(!stdout.includes('"ready":true')&&!exited&&Date.now()-start<17000)
       await pause(70);
     assert.equal(exited,false,'QA_HOST_START_FAILED '+stderr.slice(-1100));
     const ready=JSON.parse(stdout.trim().split(/\r?\n/)[0]);
     assert.equal(ready.hostPid,child.pid);
     const correct=await call(child.pid);
     assert.deepEqual({
       osPeerVerified:correct.osPeerVerified,
       serverPid:correct.serverPid,
       serverSession:correct.serverSession,
       noImpersonation:correct.clientImpersonationDisabled,
       effect:correct.effectMode,
       command:correct.command
     },{
       osPeerVerified:true,serverPid:child.pid,serverSession:ready.sessionId,
       noImpersonation:true,effect:'observation-only',command:'peer'
     });
     await assert.rejects(call(child.pid+1),error=>
       /QA_PIPE_SERVER_IDENTITY_MISMATCH/.test(String(error.stderr??'')+error.message));
     // No request was written by the rejected client and host remains functional.
     const again=await call(child.pid);
     assert.equal(again.serverPid,child.pid);
     const stop=await exec(process.execPath,[ordinaryClient,pipe,'shutdown'],{
       windowsHide:true,timeout:7000,maxBuffer:4096
     });
     assert.equal(JSON.parse(stop.stdout.trim()).reply.stopping,true);
     assert.equal(await Promise.race([completed,pause(6000).then(()=>{throw Error('HOST_NOT_STOPPED')})]),0,stderr);
   }finally{
     if(!exited){child.kill();await Promise.race([completed,pause(3000)]).catch(()=>{});}
   }
 });
