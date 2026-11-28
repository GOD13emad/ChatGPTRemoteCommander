import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const firefox=fs.existsSync('/usr/bin/firefox')?'/usr/bin/firefox':null;
test('Firefox helper retries owned isolated profile cleanup after permission denial', {skip:process.platform!=='linux'||!firefox||process.getuid?.()===0,timeout:45000},async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rc-firefox-end-retry-'));
 // The hardened Core never discovers a privileged helper from ambient PATH.
 // Keep the fake driver in the explicitly permitted owner-local adapter root
 // within a disposable HOME used only by this spawned QA helper.
 const home=path.join(tmp,'home'),bin=path.join(home,'.local','share','chatgpt-remote-commander','adapters','geckodriver');
 const parent=path.join(tmp,'private-parent'),profile=path.join(parent,'owned');
 fs.mkdirSync(bin,{recursive:true});fs.mkdirSync(parent);
 const driver=path.join(bin,'geckodriver');
 fs.writeFileSync(driver,[
 '#!/usr/bin/env node',
 "const http=require('node:http');",
 "const argv=process.argv;const port=Number(argv[argv.indexOf('--port')+1]);",
 "const marionette=Number(argv[argv.indexOf('--marionette-port')+1]);if(!argv.includes('--marionette-port')||!Number.isInteger(marionette)||marionette<=0||marionette>65535||marionette===port)process.exit(65);",
 "http.createServer((req,res)=>{",
 "res.setHeader('content-type','application/json');",
 "if(req.url==='/status')res.end(JSON.stringify({value:{ready:true}}));",
 "else if(req.url==='/session'&&req.method==='POST'){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{",
 "let config;try{config=JSON.parse(body).capabilities.alwaysMatch['moz:firefoxOptions']}catch{}",
 "if(config?.binary!=='/usr/bin/firefox'||!config?.args?.includes('-profile')){res.statusCode=400;res.end(JSON.stringify({value:{error:'invalid argument'}}));return;}",
 "res.end(JSON.stringify({value:{sessionId:'fake-owned-session',capabilities:{browserVersion:'test-only'}}}));});}",
 "else if(req.url==='/session/fake-owned-session'&&req.method==='DELETE')res.end(JSON.stringify({value:null}));",
 "else {res.statusCode=404;res.end(JSON.stringify({value:{error:'unknown command'}}));}",
 "}).listen(port,'127.0.0.1');"
 ].join('\n'));fs.chmodSync(driver,0o700);
 const helper=spawn(process.execPath,[path.join(root,'../tools/browser-control-firefox.mjs'),'--server'],{
  env:{...process.env,HOME:home,PATH:process.env.PATH},stdio:['pipe','pipe','pipe']
 });
 const rl=createInterface({input:helper.stdout});const pending=[];let stderr='';
 rl.on('line',line=>{const r=pending.shift();if(r)r(JSON.parse(line));});
 helper.stderr.on('data',b=>stderr+=String(b).slice(-200));
 const receive=()=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('TIMEOUT '+stderr)),15000);pending.push(v=>{clearTimeout(t);resolve(v)})});
 const send=async msg=>{const p=receive();helper.stdin.write(JSON.stringify(msg)+'\n');return p};
 try{
  assert.equal((await receive()).ready,true);
  const begin=await send({action:'start',isolated:true,profileDir:profile,executable:firefox});
  assert.equal(begin.ok,true,JSON.stringify(begin));
  assert.ok(fs.existsSync(profile));
  fs.chmodSync(parent,0o500);
  const first=await send({action:'end'});
  assert.equal(first.ok,false);
  assert.equal(first.error,'BROWSER_PROFILE_CLEANUP_FAILED');
  assert.ok(fs.existsSync(profile));
  for(const request of [{action:'start',isolated:true,profileDir:profile,executable:firefox},{action:'relaunch',headless:true},{action:'navigate',url:'https://example.invalid/'}]){
   const denied=await send(request);assert.equal(denied.ok,false);assert.equal(denied.error,'BROWSER_PROFILE_CLEANUP_FAILED');
  }
  assert.equal((await send({action:'status'})).active,true);
  fs.chmodSync(parent,0o700);
  const second=await send({action:'end'});
  assert.equal(second.ok,true,JSON.stringify(second));
  assert.equal(second.closed,true);
  assert.equal(fs.existsSync(profile),false);
  assert.equal((await send({action:'status'})).active,false);
 }finally{
  try{fs.chmodSync(parent,0o700)}catch{}
  try{helper.stdin.end()}catch{}
  await Promise.race([new Promise(r=>helper.once('exit',r)),new Promise(r=>setTimeout(r,1500))]);
  if(helper.exitCode===null)helper.kill('SIGKILL');
  fs.rmSync(tmp,{recursive:true,force:true});
 }
});
