// Chromium-first V2 compatibility tests. All interactive native browser QA
// is explicit opt-in, isolated under temp, never in a user profile or Firefox.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createBrowserController} from '../src/browser-tools.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const helperSource=fs.readFileSync(path.join(root,'tools/browser-control.mjs'),'utf8');

test('Linux Chromium discovery covers Chrome, Chromium and Brave without a Firefox fallback',()=>{
 assert.match(helperSource,/brave-browser/);
 assert.match(helperSource,/google-chrome/);
 assert.match(helperSource,/chromium-browser/);
 assert.doesNotMatch(helperSource.slice(helperSource.indexOf('function detectBrowser'),helperSource.indexOf('class Cdp')),/firefox/);
});
test('Chromium CDP browser core uses isolated Commander-owned profiles, never existing Firefox login',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-chromium-contract-'));
 const calls=[];
 const ctl=createBrowserController({invoke:async input=>{
  calls.push(input);
  if(input.action==='status')return {ok:true,available:true,backend:'chromium-cdp',active:false};
  if(input.action==='start')return {ok:true,browserProduct:'Brave/154',backend:'chromium-cdp'};
  if(input.action==='end')return {ok:true,closed:true};
  throw Error('UNEXPECTED_BROWSER_CALL');
 },closeInvoke:()=>{}});
 const ctx={config:{instance:{profile:'chromium-qa'},powerMode:{
  enabled:true,browserControl:{enabled:true,profileRoot:dir,allowNavigate:true,
   allowInput:false,allowScreenshot:false,userBrowserProfileReuse:false}
 }}};
 let lease;
 try{
  const st=await ctl.execute(ctx,'browser_status',{});
  assert.equal(st.backend,'chromium-cdp');
  const begun=await ctl.execute(ctx,'browser_session_begin',{mode:'isolated'});
  lease=begun.lease;
  assert.equal(begun.backend,'chromium-cdp');
  const launch=calls.find(x=>x.action==='start');
  assert.ok(launch.isolated);
  assert.ok(launch.profileDir.startsWith(dir+path.sep));
  assert.equal(launch.profileDir.includes('.mozilla'),false);
  assert.equal(launch.profileDir.includes('.config/google-chrome'),false);
  assert.equal(calls.some(x=>x.action==='fill'||x.action==='navigate'),false);
 }finally{
  if(lease)await ctl.execute(ctx,'browser_session_end',{lease});
  ctl.close();
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
const native=process.platform==='linux' &&
  process.env.RC_CHROMIUM_LIVE_QA==='1' &&
  ['/usr/bin/brave-browser','/usr/bin/google-chrome','/usr/bin/chromium'].some(x=>fs.existsSync(x));
test('Linux real Chromium CDP: clean isolated start, snapshot, close without Firefox/user profile', {skip:!native&&'Requires explicit native QA flag and an installed Chromium-based browser',timeout:60000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-chromium-native-'));
 const ctl=createBrowserController();
 const ctx={config:{instance:{profile:'chromium-native-qa'},powerMode:{
   enabled:true,browserControl:{enabled:true,profileRoot:dir,allowNavigate:false,
     allowInput:false,allowScreenshot:true,backgroundFirst:true,
     userBrowserProfileReuse:false,savedPasswordExtraction:false}
 }}};
 let lease;
 try{
  const status=await ctl.execute(ctx,'browser_status',{});
  assert.equal(status.available,true);
  assert.equal(status.backend,'chromium-cdp');
  const started=await ctl.execute(ctx,'browser_session_begin',{mode:'isolated',ttlSeconds:120});
  lease=started.lease;
  assert.equal(started.background,true);
  assert.equal(started.userDesktopTouched,false);
  assert.equal(started.savedPasswordStoreAccess,false);
  assert.ok(/Brave|Chrome|Chromium/i.test(started.browserProduct||''));
  const image=await ctl.execute(ctx,'browser_snapshot',{lease,maxTextChars:1000,maxElements:1});
  assert.equal(image.ok,true);
  assert.ok(typeof image.title==='string'||typeof image.url==='string'||image.snapshot);
 }finally{
  if(lease)await ctl.execute(ctx,'browser_session_end',{lease});
  ctl.close();
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
