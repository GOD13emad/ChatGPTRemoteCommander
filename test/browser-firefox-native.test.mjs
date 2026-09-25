import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createBrowserController } from '../src/browser-tools.mjs';

function which(name){
 const r=spawnSync(process.platform==='win32'?'where.exe':'sh',process.platform==='win32'?[name]:['-lc','command -v '+name+' 2>/dev/null || true'],{encoding:'utf8'});
 return String(r.stdout??'').trim().split(/\r?\n/)[0]||null;
}
const firefox=which('firefox'),gecko=which('geckodriver');
const runnable=process.platform==='linux'&&!!firefox&&!!gecko;

test('Linux Firefox WebDriver backend provides the background browser contract', {skip:!runnable&&'Firefox/geckodriver unavailable'}, async()=>{
 const snapRoot=path.join(os.homedir(),'snap','firefox','common');
 const root=fs.existsSync(path.join(os.homedir(),'snap','firefox'))
  ? path.join(snapRoot,'chatgpt-remote-commander','test-browser-profiles')
  : path.join(os.tmpdir(),'rc-firefox-browser-profiles');
 fs.mkdirSync(root,{recursive:true});
 const html='<!doctype html><title>RC Firefox</title><body><input id="msg"><button id="go" onclick="document.querySelector(\'#out\').textContent=document.querySelector(\'#msg\').value">Go</button><p id="out"></p></body>';
 const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html);});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const url='http://127.0.0.1:'+server.address().port;
 const ctl=createBrowserController();
 const config={instance:{profile:'firefox-e2e'},powerMode:{enabled:true,browserControl:{
  enabled:true,executable:firefox,profileRoot:root,allowNavigate:true,allowInput:true,allowScreenshot:true,
  backgroundFirst:true,foregroundFallback:'explicit-current-request-only',workflowBrowserAllowed:false,
  userBrowserProfileReuse:false,savedPasswordExtraction:false,allowForegroundFallback:true
 }}};
 let lease;
 try{
  const status=await ctl.execute({config},'browser_status',{});
  assert.equal(status.available,true);assert.equal(status.backend,'firefox-webdriver');
  const begun=await ctl.execute({config},'browser_session_begin',{mode:'isolated',profile:'acceptance',ttlSeconds:120});
  lease=begun.lease;assert.equal(begun.background,true);assert.equal(begun.userDesktopTouched,false);
  await ctl.execute({config},'browser_navigate',{lease,url,timeoutMs:10000});
  const before=await ctl.execute({config},'browser_snapshot',{lease,maxTextChars:5000,maxElements:20});
  assert.equal(before.title,'RC Firefox');
  await ctl.execute({config},'browser_fill',{lease,selector:'#msg',text:'سلام_firefox_123'});
  await ctl.execute({config},'browser_click',{lease,selector:'#go'});
  await ctl.execute({config},'browser_wait',{lease,textIncludes:'سلام_firefox_123',timeoutMs:5000});
  const after=await ctl.execute({config},'browser_snapshot',{lease,maxTextChars:5000,maxElements:20});
  assert.ok(after.text.includes('سلام_firefox_123'));
  const image=await ctl.execute({config},'browser_screenshot',{lease,format:'png',maxBytes:2097152});
  assert.equal(image.__structuredContent.mimeType,'image/png');assert.ok(image.__structuredContent.bytes>100);
  await ctl.execute({config},'browser_session_end',{lease});lease=null;
 }finally{
  if(lease)try{await ctl.execute({config},'browser_session_end',{lease});}catch{}
  ctl.close();await new Promise(r=>server.close(r));
 }
});
