import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createBrowserProcessClient} from '../src/browser-process.mjs';
import {createBrowserController,createIsolatedBrowserPool,executeBrowserTool,closeBrowserController} from '../src/browser-tools.mjs';

// Real Chromium/CDP isolation acceptance; no native desktop input.
// Loopback fixture, disposable profiles, independent helper process per task.
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const chromiumHelper=path.join(project,'tools','browser-control.mjs');
const cfg=(root,instance,executable)=>({config:{
 instance:{profile:instance},
 powerMode:{enabled:true,browserControl:{
  enabled:true,allowNavigate:true,allowInput:true,allowScreenshot:true,
  allowForegroundFallback:false,foregroundFallback:'explicit-current-request-only',
  executable,profileRoot:root
 }}
}});
async function findTestChromium(){
 const programFiles=process.env.ProgramFiles??'C:\\Program Files';
 const programFilesX86=process.env['ProgramFiles(x86)']??'C:\\Program Files (x86)';
 const candidates=process.platform==='win32'?[
  path.join(programFiles,'Google','Chrome','Application','chrome.exe'),
  path.join(programFiles,'Microsoft','Edge','Application','msedge.exe'),
  path.join(programFilesX86,'Microsoft','Edge','Application','msedge.exe')
 ]:['/usr/bin/google-chrome','/usr/bin/chromium',
   '/usr/bin/chromium-browser','/usr/bin/microsoft-edge'];
 for(const candidate of candidates){
  try{await fs.access(candidate);return candidate;}catch{}
 }
 return null;
}
async function localPage(){
 const server=http.createServer((req,res)=>{
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
  res.end('<!doctype html><title>Private Worker Fixture</title>'+
   '<label for="worker">Worker</label><input id="worker" value="">'+
   '<button id="submit" onclick="document.querySelector(\'#result\').textContent='+
   'document.querySelector(\'#worker\').value">Run</button>'+
   '<p id="result"></p>');
 });
 await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
 const address=server.address();
 return {server,url:'http://127.0.0.1:'+address.port+'/',close:()=>new Promise(resolve=>server.close(resolve))};
}
function newWorker(){
 const client=createBrowserProcessClient({
  file:process.execPath,args:[chromiumHelper,'--server'],
  startupTimeoutMs:20000,timeoutMs:20000,maxBytes:8*1024*1024
 });
 const ctl=createBrowserController({invoke:client.invoke,closeInvoke:client.close});
 return {ctl,close:()=>{ctl.close();return client.close();}};
}
test('two concurrent workers use private headless Chromium without stealing local desktop',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-parallel-browser-pilot-'));
 const page=await localPage();
 const workers=[newWorker(),newWorker()];
 const exe=await findTestChromium();
 let begun=[];
 try{
  if(!exe){t.skip('No supported test Chromium installed on this machine');return;}
  const contexts=workers.map((w,i)=>cfg(root,['alpha','beta'][i],exe));
  const first=await Promise.all(workers.map(async(w,i)=>{
   const result=await w.ctl.execute(contexts[i],'browser_session_begin',{mode:'isolated',ttlSeconds:120});
   begun.push(i);
   return result;
  }));
  assert.equal(new Set(first.map(x=>x.lease)).size,2);
  assert.ok(first.every(x=>x.background===true&&x.headless===true&&x.userDesktopTouched===false));
  const labels=['WORKER_ALPHA','WORKER_BETA'];
  await Promise.all(workers.map((w,i)=>w.ctl.execute(contexts[i],'browser_navigate',{
   lease:first[i].lease,url:page.url
  })));
  await Promise.all(workers.map((w,i)=>w.ctl.execute(contexts[i],'browser_fill',{
   lease:first[i].lease,selector:'#worker',text:labels[i]
  })));
  await Promise.all(workers.map((w,i)=>w.ctl.execute(contexts[i],'browser_click',{
   lease:first[i].lease,selector:'#submit'
  })));
  const observed=await Promise.all(workers.map((w,i)=>w.ctl.execute(contexts[i],'browser_snapshot',{
   lease:first[i].lease,maxTextChars:1500
  })));
  for(let i=0;i<observed.length;i++){
   assert.equal(observed[i].background,true);
   assert.equal(observed[i].userDesktopTouched,false);
   assert.match(observed[i].text,new RegExp(labels[i]));
   assert.doesNotMatch(observed[i].text,new RegExp(labels[1-i]));
  }
  const snaps=await Promise.all(workers.map((w,i)=>w.ctl.execute(contexts[i],
   'browser_screenshot',{lease:first[i].lease,format:'jpeg',quality:35,maxBytes:1500000})));
  for(const snap of snaps){
   assert.equal(snap.__structuredContent.background,true);
   assert.equal(snap.__structuredContent.userDesktopTouched,false);
   assert.equal(snap.__structuredContent.mimeType,'image/jpeg');
  }
  await Promise.all(workers.map((w,i)=>w.ctl.execute(contexts[i],
   'browser_session_end',{lease:first[i].lease})));
  begun=[];
 }finally{
  await Promise.allSettled(workers.map(w=>w.close()));
  await page.close();
  await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});

test('same Core routes two browser_session_begin(isolated) chats to independent helpers',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-browser-pool-real-'));
 const page=await localPage();
 const exe=await findTestChromium();
 const contexts=[cfg(root,'same-core',exe),cfg(root,'same-core',exe)];
 let active=[];
 try{
  if(!exe){t.skip('No supported real Chromium executable');return;}
  // Same Commander profile, different ChatGPT conversations/leases.
  active=await Promise.all(contexts.map(ctx=>executeBrowserTool(ctx,
   'browser_session_begin',{mode:'isolated',ttlSeconds:120})));
  assert.notEqual(active[0].lease,active[1].lease);
  assert.ok(active.every(x=>x.physicalDesktopInput===false&&
   x.workerIsolation==='PRIVATE_BROWSER_PROCESS'));
  const status=await executeBrowserTool(contexts[0],'browser_status',{});
  assert.equal(status.isolatedWorkersActive,2);
  await Promise.all(contexts.map((ctx,i)=>executeBrowserTool(ctx,
   'browser_navigate',{lease:active[i].lease,url:page.url})));
  await Promise.all(contexts.map((ctx,i)=>executeBrowserTool(ctx,
   'browser_fill',{lease:active[i].lease,selector:'#worker',text:'PERSONA_'+i})));
  await Promise.all(contexts.map((ctx,i)=>executeBrowserTool(ctx,
   'browser_click',{lease:active[i].lease,selector:'#submit'})));
  const snapshots=await Promise.all(contexts.map((ctx,i)=>executeBrowserTool(ctx,
   'browser_snapshot',{lease:active[i].lease})));
  for(let i=0;i<2;i++){
   assert.match(snapshots[i].text,new RegExp('PERSONA_'+i));
   assert.doesNotMatch(snapshots[i].text,new RegExp('PERSONA_'+(1-i)));
   assert.equal(snapshots[i].userDesktopTouched,false);
  }
  await Promise.all(contexts.map((ctx,i)=>executeBrowserTool(ctx,
   'browser_session_end',{lease:active[i].lease})));
  active=[];
  const final=await executeBrowserTool(contexts[0],'browser_status',{});
  assert.equal(final.isolatedWorkersActive,0);
 }finally{
  await Promise.allSettled(active.map((x,i)=>executeBrowserTool(contexts[i],
   'browser_session_end',{lease:x.lease})));
  await closeBrowserController();
  await page.close();
  await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});

test('a credentialed view-only observer sees a real private browser frame without touching input',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-viewer-cdp-fixture-'));
 const page=await localPage();
 const exe=await findTestChromium();
 const pool=createIsolatedBrowserPool({
  maxWorkers:1,
  authorizeObserverGrant:async({ownerProfile,viewerProfile})=>
   ownerProfile==='owner'&&viewerProfile==='supervisor',
   // Synthetic trusted policy decision; private frame reads default to DENY.
   authorizeObserverRead:({ownerProfile,viewerProfile})=>
    ownerProfile==='owner'&&viewerProfile==='supervisor'
 });
 const owner=cfg(root,'owner',exe),supervisor=cfg(root,'supervisor',exe);
 let lease=null;
 try{
  if(!exe){t.skip('Real Chromium unavailable');return;}
  lease=(await pool.execute(owner,'browser_session_begin',{mode:'isolated',ttlSeconds:60})).lease;
  await pool.execute(owner,'browser_navigate',{lease,url:page.url});
  const grant=await pool.grantObserver(owner,lease,{viewerProfile:'supervisor',ttlSeconds:45});
  await pool.execute(owner,'browser_fill',{lease,selector:'#worker',text:'PRIVATE_SCREEN'});
  await pool.execute(owner,'browser_click',{lease,selector:'#submit'});
  await pool.execute(owner,'browser_screenshot',{lease,format:'jpeg',quality:35,maxBytes:262144});
  const observed=pool.readObserver(supervisor,grant.observerToken);
  assert.equal(observed.__mcpContent[0].type,'image');
  assert.equal(observed.__mcpContent[0].mimeType,'image/jpeg');
  assert.equal(observed.__structuredContent.observerReadOnly,true);
  assert.equal(observed.__structuredContent.physicalDesktopAccess,false);
  assert.equal(observed.__structuredContent.controlAuthorized,false);
  assert.equal(observed.__structuredContent.stale,false);
  const received=Buffer.from(observed.__mcpContent[0].data,'base64');
  assert.equal(received[0],0xff);assert.equal(received[1],0xd8);
  assert.ok(received.length>256);
  await pool.execute(owner,'browser_fill',{lease,selector:'#worker',text:'PRIVATE_EDIT'});
  const stale=pool.readObserver(supervisor,grant.observerToken);
  assert.equal(stale.__structuredContent.stale,true);
  assert.equal(stale.__structuredContent.frameRevision<stale.__structuredContent.workspaceRevision,true);
  const invalid=cfg(root,'intruder',exe);
  assert.throws(()=>pool.readObserver(invalid,grant.observerToken),/BROWSER_OBSERVER_DENIED/);
  await pool.execute(owner,'browser_session_end',{lease});
  lease=null;
  assert.throws(()=>pool.readObserver(supervisor,grant.observerToken),/BROWSER_OBSERVER_DENIED/);
 }finally{
  if(lease)await pool.execute(owner,'browser_session_end',{lease}).catch(()=>{});
  await pool.close();
  await page.close();
  await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});

test('real Chromium workspace-scoped human handoff never interrupts another agent',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-private-control-fixture-'));
 const page=await localPage();
 const exe=await findTestChromium();
 const pool=createIsolatedBrowserPool({
  maxWorkers:2,
  authorizeControlHandoff:({ownerProfile,operatorProfile})=>
   ownerProfile==='same-core'&&operatorProfile==='human',
  // Synthetic trusted permission for this isolated real-browser test only.
  authorizeControlAction:({ownerProfile,operatorProfile})=>
   ownerProfile==='same-core'&&operatorProfile==='human'
 });
 const owner=cfg(root,'same-core',exe),human=cfg(root,'human',exe);
 const open=[];
 try{
  if(!exe){t.skip('Real Chromium unavailable');return;}
  const leases=await Promise.all([0,1].map(async()=>{
   const r=await pool.execute(owner,'browser_session_begin',{mode:'isolated',ttlSeconds:120});
   open.push(r.lease);
   return r.lease;
  }));
  await Promise.all(leases.map(lease=>pool.execute(owner,'browser_navigate',{
   lease,url:page.url
  })));
  const handoff=await pool.beginControlHandoff(owner,leases[0],{
   operatorProfile:'human',ttlSeconds:90
  });
  await assert.rejects(pool.execute(owner,'browser_fill',{
   lease:leases[0],selector:'#worker',text:'OWNER_NOT_APPLIED'
  }),/BROWSER_WORKSPACE_CONTROL_HELD/);
  assert.equal((await pool.controlAction(human,handoff.controlToken,
   'browser_fill',{selector:'#worker',text:'HUMAN_PRIVATE'})).physicalDesktopAccess,false);
  await pool.controlAction(human,handoff.controlToken,
   'browser_click',{selector:'#submit'});
  await pool.execute(owner,'browser_fill',{
   lease:leases[1],selector:'#worker',text:'UNRELATED_AGENT_CONTINUES'
  });
  await pool.execute(owner,'browser_click',{lease:leases[1],selector:'#submit'});
  const other=await pool.execute(owner,'browser_snapshot',{lease:leases[1]});
  assert.match(other.text,/UNRELATED_AGENT_CONTINUES/);
  assert.doesNotMatch(other.text,/HUMAN_PRIVATE/);
  assert.equal(pool.endControlHandoff(human,handoff.controlToken).ownerReobserveRequired,true);
  await assert.rejects(pool.execute(owner,'browser_fill',{
   lease:leases[0],selector:'#worker',text:'TOO_EARLY'
  }),/BROWSER_WORKSPACE_REOBSERVATION_REQUIRED/);
  const reconciled=await pool.execute(owner,'browser_snapshot',{lease:leases[0]});
  assert.match(reconciled.text,/HUMAN_PRIVATE/);
  assert.doesNotMatch(reconciled.text,/UNRELATED_AGENT_CONTINUES/);
  assert.equal((await pool.execute(owner,'browser_fill',{
   lease:leases[0],selector:'#worker',text:'OWNER_RESUMES'
  })).background,true);
  await Promise.all(leases.map(lease=>pool.execute(owner,'browser_session_end',{lease})));
  open.length=0;
 }finally{
  await Promise.allSettled(open.map(lease=>pool.execute(owner,'browser_session_end',{lease})));
  await pool.close();
  await page.close();
  await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
