#!/usr/bin/env node
// Integration acceptance: owned Chromium/CDP Browser Core with 12 synthetic ChatGPT tabs.
// No Brave add-on, Native Messaging, real account or ChatGPT network access.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mkdtemp,writeFile,chmod,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {createInterface} from 'node:readline';

const here=path.resolve(import.meta.dirname,'..');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=22000){
 const stop=Date.now()+timeout;
 while(Date.now()<stop){
  try{const v=await fn();if(v)return v;}catch{}
  await sleep(230);
 }
 throw Error('WAIT_TIMEOUT');
}
async function inspectContexts(profile){
 const port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0]);
 assert.ok(Number.isInteger(port)&&port>0);
 const version=await (await fetch('http://127.0.0.1:'+port+'/json/version')).json();
 const socket=new WebSocket(version.webSocketDebuggerUrl),pending=new Map(),events=new Map();
 let seq=0;
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('CDP_INSPECT_CONNECT_TIMEOUT')),9000);
  socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
  socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('CDP_INSPECT_CONNECT_FAILED'));},{once:true});
 });
 socket.addEventListener('message',event=>{
  let reply;try{reply=JSON.parse(String(event.data));}catch{return}
  if(!reply.id){try{events.get(reply.method)?.(reply.params??{},reply.sessionId);}catch{}return;}
  const item=pending.get(reply.id);if(!item)return;
  clearTimeout(item.timer);pending.delete(reply.id);
  if(reply.error)item.reject(Error('CDP_INSPECT_COMMAND_FAILED'));else item.resolve(reply.result??{});
 });
 return {
  on:(method,listener)=>events.set(method,listener),
  send:(method,params={},sessionId)=>new Promise((resolve,reject)=>{
   const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP_INSPECT_TIMEOUT'))},7000);
   pending.set(id,{resolve,reject,timer});
   socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  }),
  close:()=>socket.close()
 };
}

async function run(){
 const base=await mkdtemp(path.join(os.tmpdir(),'rc-owned-browser-12chat-'));
 const wrapper=path.join(base,'chromium-isolated');
 const profile=path.join(base,'owned-profile');
 const lines=[],waiters=[],errors=[];
 let proc=null,inspector=null;
 try{
  const binary=fs.existsSync('/usr/bin/google-chrome')?'/usr/bin/google-chrome':'/usr/bin/brave-browser';
  if(!fs.existsSync(binary))throw Error('OWNED_CHROMIUM_BINARY_MISSING');
  await writeFile(wrapper,'#!/bin/sh\nexec '+binary+' --disable-background-networking --disable-gpu --disable-dev-shm-usage --host-resolver-rules="MAP chatgpt.com ~NOTFOUND, MAP chat.openai.com ~NOTFOUND" "$@"\n',{mode:0o700});
  await chmod(wrapper,0o700);
  proc=spawn(process.execPath,[path.join(here,'tools/browser-control.mjs'),'--server'],
       {cwd:here,stdio:['pipe','pipe','pipe'],env:{...process.env,HOME:process.env.HOME}});
  const stdout=createInterface({input:proc.stdout,crlfDelay:Infinity});
  stdout.on('line',line=>{let v;try{v=JSON.parse(line)}catch{return};if(waiters.length)waiters.shift()(v);else lines.push(v)});
  proc.stderr.on('data',data=>{if(errors.join('').length<1500)errors.push(String(data).slice(0,500))});
  function recv(timeout=18000){
   if(lines.length)return Promise.resolve(lines.shift());
   return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('HELPER_RESPONSE_TIMEOUT')),timeout);
    waiters.push(v=>{clearTimeout(timer);resolve(v)});
   });
  }
  async function call(msg,timeout=20000){
   if(!proc||proc.exitCode!==null)throw Error('HELPER_NOT_RUNNING');
   proc.stdin.write(JSON.stringify(msg)+'\n');
   const v=await recv(timeout);
   if(!v.ok)throw Error('HELPER_ACTION_FAILED_'+String(v.error||'UNKNOWN'));
   return v;
  }
  assert.equal((await recv()).ready,true,'helper must be ready');
  const begun=await call({action:'start',profileDir:profile,isolated:true,executable:wrapper},30000);
  assert.equal(begun.headless,true);
  const tabs=[];
  for(let i=0;i<12;i++){
   const id='00000000-0000-4000-8000-'+String(i).padStart(12,'0');
   const opened=await call({action:'chat_tab_open',url:'https://chatgpt.com/c/'+id,...(i<2?{isolatedContext:true}:{})});
   assert.equal(opened.isolatedContext,i<2);
   assert.match(opened.tabRef,/^[a-f0-9]{32}$/);
   tabs.push(opened.tabRef);
  }
  await assert.rejects(()=>call({action:'chat_tab_open',url:'https://evil.test/'}),
    /BROWSER_CHAT_URL_NOT_ALLOWED/);
  await assert.rejects(()=>call({action:'relaunch',headless:false}),
    /BROWSER_MULTITAB_RELAUNCH_UNSUPPORTED/);
  const snapshot=await until(async()=>{
   const s=await call({action:'chat_tabs'});
   return s.ready===true&&s.counts?.OPEN===12&&s.conversations?.length===12?s:null;
  },28000);
  assert.equal(snapshot.source,'COMMANDER_OWNED_BROWSER_CORE');
  assert.equal(snapshot.isolatedContextCount,2);
  assert.equal(snapshot.contextCleanupUncertain,false);
  assert.equal(snapshot.managedTabs.filter(t=>t.isolatedContext).length,2);
  inspector=await inspectContexts(profile);
  await assert.rejects(()=>call({action:'chat_tab_snapshot',tabRef:'0'.repeat(32)}),/BROWSER_CHAT_TAB_NOT_OWNED/);
  const qaTarget=(await inspector.send('Target.getTargets')).targetInfos
    .find(t=>t.type==='page'&&t.url.includes('00000000-0000-4000-8000-000000000000'));
  assert.ok(qaTarget,'owned private test target must exist');
  const {sessionId:qaSession}=await inspector.send('Target.attachToTarget',{targetId:qaTarget.targetId,flatten:true});
  try{
   await inspector.send('Runtime.enable',{},qaSession);
   await inspector.send('Page.enable',{},qaSession);
   const html='<html><head><title>Commander synthetic tab</title></head><body><p>Read only synthetic tab data</p><input type="password" value="qa-secret-not-for-output"></body></html>';
   const paused=[];
   inspector.on('Fetch.requestPaused',(params,sessionId)=>{
    if(sessionId!==qaSession)return;
    paused.push(inspector.send('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:200,
      responseHeaders:[{name:'Content-Type',value:'text/html; charset=utf-8'}],
      body:Buffer.from(html,'utf8').toString('base64')},sessionId));
   });
   await inspector.send('Fetch.enable',{patterns:[{urlPattern:'https://chatgpt.com/*',resourceType:'Document'}]},qaSession);
   await inspector.send('Page.navigate',{url:qaTarget.url},qaSession);
   await until(async()=>{
    const loc=(await inspector.send('Runtime.evaluate',{expression:'location.href',returnByValue:true},qaSession)).result?.value;
    const title=(await inspector.send('Runtime.evaluate',{expression:'document.title',returnByValue:true},qaSession)).result?.value;
    return loc?.startsWith('https://chatgpt.com/')&&title==='Commander synthetic tab'?true:false;
   },15000);
   await Promise.all(paused);
   await inspector.send('Fetch.disable',{},qaSession);
  }finally{await inspector.send('Target.detachFromTarget',{sessionId:qaSession});}
  const inspected=await call({action:'chat_tab_snapshot',tabRef:tabs[0],maxTextChars:1200,maxElements:10});
  assert.equal(inspected.tabRef,tabs[0]);
  assert.equal(inspected.isolatedContext,true);
  assert.equal(inspected.passwordValuesReturned,false);
  assert.equal(inspected.cookiesReturned,false);
  assert.equal(inspected.background,true);
  assert.match(inspected.text,/Read only synthetic tab data/);
  assert.ok(!JSON.stringify(inspected).includes('qa-secret-not-for-output'));
  assert.match(inspected.title,/Commander synthetic tab/);
  const ids=(await inspector.send('Target.getBrowserContexts')).browserContextIds;
  assert.equal(ids.length,2,'two Commander-created private contexts exist');
  for(const [index,contextId] of ids.entries()){
   await inspector.send('Storage.setCookies',{browserContextId:contextId,
     cookies:[{name:'rc_isolation_qa',value:index?'B':'A',domain:'chatgpt.com',path:'/',secure:true}]});
  }
  for(const [index,contextId] of ids.entries()){
   const cookies=(await inspector.send('Storage.getCookies',{browserContextId:contextId})).cookies;
   assert.deepEqual(cookies.filter(c=>c.name==='rc_isolation_qa').map(c=>c.value),[index?'B':'A']);
  }
  const defaultCookies=(await inspector.send('Storage.getCookies')).cookies;
  assert.equal(defaultCookies.some(c=>c.name==='rc_isolation_qa'),false);

  assert.equal(snapshot.cookiesRead,false);
  assert.equal(snapshot.chatAuthentication,'NOT_VERIFIED');
  assert.equal(snapshot.actionAuthorization,false);
  assert.equal(snapshot.urlContentsReturned,false);
  assert.equal(snapshot.observedTabs,12);
  assert.equal(snapshot.conversations.some(x=>x.localRef.includes('00000000')),false);
  const closed=await call({action:'chat_tab_close',tabRef:tabs[5]});
  assert.equal(closed.closed,true,'close exactly one owned tab');
  await assert.rejects(()=>call({action:'chat_tab_close',tabRef:tabs[5]}),
    /BROWSER_CHAT_TAB_NOT_OWNED/);
  const after=await until(async()=>{
    const s=await call({action:'chat_tabs'});
    return s.counts?.OPEN===11&&s.counts?.CLOSED===1?s:null;
  },18000);
  assert.equal(after.conversations.length,12);
  assert.equal(after.managedTabs.length,11);
  assert.equal(after.managedTabs.some(x=>x.tabRef===tabs[5]),false);
  for(let i=12;i<17;i++){
    const id='00000000-0000-4000-8000-'+String(i).padStart(12,'0');
    const opened=await call({action:'chat_tab_open',url:'https://chatgpt.com/c/'+id});
    assert.match(opened.tabRef,/^[a-f0-9]{32}$/);
  }
  const atLimit=await until(async()=>{
    const state=await call({action:'chat_tabs'});
    return state.counts?.OPEN===16&&state.managedTabs?.length===16?state:null;
  },16000);
  assert.equal(atLimit.counts.OPEN,16);
  await assert.rejects(()=>call({action:'chat_tab_open',url:'https://chatgpt.com/'}),
    /BROWSER_CHAT_TABS_LIMIT/);
  // A tab that has navigated away from the explicitly allowed ChatGPT
  // origin must no longer yield its document through a valid old tabRef.
  const {sessionId:redirectSession}=await inspector.send('Target.attachToTarget',
    {targetId:qaTarget.targetId,flatten:true});
  try{
   await inspector.send('Page.enable',{},redirectSession);
   await inspector.send('Page.navigate',{url:'https://chatgpt.com/api/auth/session'},redirectSession);
  }finally{await inspector.send('Target.detachFromTarget',{sessionId:redirectSession});}
  await assert.rejects(()=>call({action:'chat_tab_snapshot',tabRef:tabs[0]}),
    /BROWSER_CHAT_TARGET_ORIGIN_NOT_ALLOWED/);
  const {sessionId:offOriginSession}=await inspector.send('Target.attachToTarget',
    {targetId:qaTarget.targetId,flatten:true});
  try{
   await inspector.send('Page.enable',{},offOriginSession);
   await inspector.send('Page.navigate',{url:'https://example.invalid/redirect-test'},offOriginSession);
  }finally{await inspector.send('Target.detachFromTarget',{sessionId:offOriginSession});}
  await assert.rejects(()=>call({action:'chat_tab_snapshot',tabRef:tabs[0]}),
    /BROWSER_CHAT_TARGET_ORIGIN_NOT_ALLOWED/);
  const isolatedClose=await call({action:'chat_tab_close',tabRef:tabs[0]});
  assert.equal(isolatedClose.closed,true);
  const remaining=(await inspector.send('Target.getBrowserContexts')).browserContextIds;
  assert.equal(remaining.length,1,'closing an owned tab disposes its private context');
  assert.equal(await call({action:'chat_tabs'}).then(s=>s.isolatedContextCount),1);
  await inspector.send('Target.disposeBrowserContext',{browserContextId:remaining[0]});
  await until(async()=>{
   const state=await call({action:'chat_tabs'});
   return state.isolatedContextCount===0&&state.contextCleanupUncertain===false?state:null;
  },10000);
  assert.equal((await inspector.send('Target.getBrowserContexts')).browserContextIds.length,0,
    'externally disposed context is recognized as already removed');
  const replacement=await call({action:'chat_tab_open',url:'https://chatgpt.com/',isolatedContext:true});
  assert.equal(replacement.isolatedContext,true);
  const nextContext=(await inspector.send('Target.getBrowserContexts')).browserContextIds;
  assert.equal(nextContext.length,1);
  const externalTarget=(await inspector.send('Target.getTargets')).targetInfos
    .find(t=>t.type==='page'&&t.browserContextId===nextContext[0]);
  assert.ok(externalTarget,'replacement private-context page discoverable');
  assert.equal((await inspector.send('Target.closeTarget',{targetId:externalTarget.targetId})).success,true);
  await until(async()=>{
   const state=await call({action:'chat_tabs'});
   return state.isolatedContextCount===0&&state.contextCleanupUncertain===false?state:null;
  },10000);
  assert.equal((await inspector.send('Target.getBrowserContexts')).browserContextIds.length,0);
  await call({action:'end'});
  console.log(JSON.stringify({result:'COMMANDER_NATIVE_CDP_MANAGED_12_TAB_E2E_PASS',
    beforeOpen:snapshot.counts.OPEN,afterOpen:after.counts.OPEN,closed:after.counts.CLOSED,maxManagedTabsVerified:atLimit.managedTabs.length,
    isolatedContextsVerified:2,cookieStorageIsolated:true,isolatedContextDisposed:true,externalContextReaped:true,externalContextDisposeReconciled:true,
    authenticatedChats:0,addonsUsed:0,primaryProfileTouched:false}));
 }finally{
  try{inspector?.close()}catch{}
  if(proc){
   try{proc.stdin.end()}catch{}
   await Promise.race([new Promise(r=>proc.once('close',r)),sleep(2500)]);
   if(proc.exitCode===null)proc.kill('SIGTERM');
   await Promise.race([new Promise(r=>proc.once('close',r)),sleep(2200)]);
   if(proc.exitCode===null)proc.kill('SIGKILL');
  }
  await rm(base,{recursive:true,force:true,maxRetries:4,retryDelay:150});
 }
}
run().catch(error=>{console.error('NATIVE_CDP_12TAB_E2E_FAILED:'+String(error.message).slice(0,320));process.exitCode=3});
