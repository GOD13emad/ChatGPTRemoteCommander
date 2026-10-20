// QA-only Windows live Desktop pipe observation -> non-actionable Broker proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
 createLiveDesktopObserverQA,validateLiveDesktopObservationQA
} from '../src/native-desktop-live-evidence-bridge-win-qa.mjs';
import {createWindowsSessionBrokerQA} from '../src/native-workspace-session-broker-win-qa.mjs';

const a='a'.repeat(64),b='b'.repeat(64),nonce='e'.repeat(64);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=path.join(root,'tools','native-desktop-pipe-host-win-qa.ps1');
const client=path.join(root,'tools','native-desktop-pipe-client-win-qa.mjs');
const pwsh=path.join(process.env.ProgramFiles||'C:\\Program Files','PowerShell','7','pwsh.exe');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const doClient=(pipe,command)=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[client,pipe,command],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let out='',err='';
 child.stdout.on('data',x=>out+=x);
 child.stderr.on('data',x=>err+=x);
 child.on('error',reject);
 child.on('close',code=>{
   if(code!==0)return reject(Error('QA_CLIENT_EXIT_'+code+':'+err));
   try{resolve(JSON.parse(out.trim()))}
   catch{reject(Error('QA_CLIENT_INVALID_OUTPUT'))}
 });
});
test('malformed live Windows desktop evidence never becomes a broker action proof',()=>{
 const valid={ok:true,hostSession:2,result:{workspace:'A',
   desktop:'RcQaPersist_'+'1'.repeat(32),pid:123,windowCount:1,
   ownWindow:true,effectMode:'observation-only'}};
 const read=validateLiveDesktopObservationQA(valid,a,'A',nonce);
 assert.equal(read.effectMode,'observation-only');
 assert.match(read.sha256,/^[a-f0-9]{64}$/);
 for(const change of [
   x=>{x.result.workspace='B'},x=>{x.result.pid=0},
   x=>{x.result.ownWindow=false},x=>{x.result.effectMode='qa-simulated'},
   x=>{x.result.desktop='WinSta0\\Default'},x=>{x.result.windowCount=2},
   x=>{x.hostSession=0},x=>{x.ok=false}
 ]){
   const forged=structuredClone(valid);change(forged);
   assert.throws(()=>validateLiveDesktopObservationQA(forged,a,'A',nonce),
     e=>e.code==='LIVE_EVIDENCE_UNTRUSTED');
 }
});
test('two live private Windows desktops feed scoped read-only Broker observations',
 {skip:process.platform!=='win32',timeout:45000},async()=>{
 const pipe='rc_qa_desk_'+randomBytes(16).toString('hex');
 const host=spawn(pwsh,['-NoLogo','-NoProfile','-NonInteractive','-File',
   server,'-PipeName',pipe,'-LifetimeMs','35000'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let output='',err='',finished=false;
 const ended=new Promise(resolve=>host.once('close',code=>{finished=true;resolve(code)}));
 host.stdout.on('data',x=>output+=x);
 host.stderr.on('data',x=>err+=x);
 try{
   const started=Date.now();
   while(!output.includes('"ready":true')&&!finished&&Date.now()-started<15000)
     await sleep(80);
   assert.equal(finished,false,'QA_HOST_FAILED_'+err);
   assert.match(output,/"ready":true/);
   const observe=createLiveDesktopObserverQA({pipeName:pipe,workspaceRefs:[a,b]});
   const ida=Object.freeze({}),idb=Object.freeze({});
   const principals=new WeakMap([
     [ida,{principalId:'qa-reader-a',sessionId:'qa-session-a',role:'agent',allowedWorkspaces:[a]}],
     [idb,{principalId:'qa-reader-b',sessionId:'qa-session-b',role:'agent',allowedWorkspaces:[b]}]
   ]);
   let effects=0,commits=0;
   const broker=createWindowsSessionBrokerQA({
     attest:ctx=>principals.get(ctx),observeNative:observe,
     journal:{execute:async()=>{commits++}},
     dispatchNative:async()=>{effects++}
   });
   try{
     const pa=await broker.observe({context:ida,workspaceRef:a});
     const pb=await broker.observe({context:idb,workspaceRef:b});
     assert.equal(pa.effectMode,'observation-only');
     assert.equal(pb.effectMode,'observation-only');
     assert.notEqual(pa.frameSha256,pb.frameSha256);
     const status=await doClient(pipe,'status');
     assert.equal(status.reply.ok,true);
     assert.equal(status.reply.workers.length,2);
     assert.equal(status.reply.workers.every(x=>x.ownWindow),true);
     assert.throws(()=>broker.acquire({context:ida,observation:pa}),
       e=>e.code==='BROKER_OBSERVATION_NON_ACTIONABLE');
     assert.throws(()=>broker.acquire({context:idb,observation:pb}),
       e=>e.code==='BROKER_OBSERVATION_NON_ACTIONABLE');
     assert.equal(effects,0);
     assert.equal(commits,0);
   }finally{broker.close()}
   const stop=await doClient(pipe,'shutdown');
   assert.equal(stop.reply.stopping,true);
   const exit=await Promise.race([ended,sleep(7000).then(()=>-999)]);
   assert.equal(exit,0,err);
 }finally{
   if(!finished){
     host.kill();
     await Promise.race([ended,sleep(3000)]).catch(()=>{});
   }
 }
});
