import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {discover,openExtensionManager}=require('../packaging/unified/browser-companion-targets.cjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('Chromium browsers are discovered on Linux from constrained OS paths, no profile access',()=>{
  const items=new Set(['/usr/bin/google-chrome','/usr/bin/brave-browser','/usr/bin/firefox']);
  const found=discover({platform:'linux',stat:filename=>{
    if(!items.has(filename))throw Error('NOT_FOUND');
    return {isFile:()=>true};
  }});
  assert.equal(found.find(x=>x.id==='chrome').installed,true);
  assert.equal(found.find(x=>x.id==='brave').installed,true);
  assert.equal(found.find(x=>x.id==='edge').installed,false);
  assert.equal(found.find(x=>x.id==='firefox').installed,true);
  assert.equal(found.find(x=>x.id==='firefox').supported,false);
  assert.ok(found.every(x=>!Object.hasOwn(x,'profile')&&!Object.hasOwn(x,'cookies')));
});
test('Windows install detection supports Program Files, x86 and user-local paths',()=>{
  const env={PROGRAMFILES:'C:\\Program Files',
    'PROGRAMFILES(X86)':'C:\\Program Files (x86)',
    LOCALAPPDATA:'C:\\Users\\u\\AppData\\Local'};
  const items=new Set([
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ]);
  const found=discover({platform:'win32',env,stat:filename=>{
    if(!items.has(filename))throw Error('NOT_FOUND');
    return {isFile:()=>true};
  }});
  assert.equal(found.find(x=>x.id==='chrome').installed,true);
  assert.equal(found.find(x=>x.id==='edge').installed,true);
  assert.equal(found.find(x=>x.id==='brave').installed,false);
});
test('Only a user-triggered fixed browser + fixed extensions page can be opened',async()=>{
  const seen=[];
  const item='/usr/bin/brave-browser';
  const opts={platform:'linux',stat:p=>{
    if(p!==item)throw Error('NOT_FOUND');
    return {isFile:()=>true};
  },spawnProcess:(exe,args,config)=>{
    seen.push({exe,args,config});
    const proc=new EventEmitter();proc.unref=()=>{proc.unreferenced=true;};
    queueMicrotask(()=>proc.emit('spawn'));
    return proc;
  }};
  const result=await openExtensionManager('brave',opts);
  assert.equal(result.ok,true);
  assert.equal(result.extensionAutoInstalled,false);
  assert.equal(result.ownerActionRequired,true);
  assert.deepEqual(seen[0].args,['--new-window','brave://extensions/']);
  assert.equal(seen[0].exe,item);
  assert.equal(seen[0].config.shell,false);
  assert.equal(seen[0].config.detached,true);
  await assert.rejects(()=>openExtensionManager('../sh',opts),/BROWSER_SELECTION_DENIED/);
  await assert.rejects(()=>openExtensionManager('firefox',opts),/BROWSER_NOT_INSTALLED/);
});
test('Firefox is intentionally not represented as a tested Chrome MV3 install',async()=>{
  const opts={platform:'linux',stat:p=>{
    if(p!=='/usr/bin/firefox')throw Error('NOT_FOUND');
    return {isFile:()=>true};
  },spawnProcess:()=>{throw Error('SHOULD_NOT_SPAWN');}};
  await assert.rejects(()=>openExtensionManager('firefox',opts),/BROWSER_EXTENSION_FORMAT_UNSUPPORTED/);
});
test('One installer includes browser chooser, safeguards and owner-visible steps',()=>{
  const cfg=file('packaging/unified/electron-builder.yml');
  assert.match(cfg,/browser-companion-targets\.cjs/);
  const main=file('packaging/unified/main.cjs');
  assert.match(main,/COMPANION_OWNER_WINDOW_REQUIRED/);
  const ui=file('packaging/unified/index.html');
  assert.match(ui,/companion-browser-target/);
  assert.match(ui,/Load unpacked/);
  assert.match(ui,/Firefox needs/);
  assert.match(file('packaging/unified/renderer.js'),/companionBrowserOpen/);
  assert.doesNotMatch(file('packaging/unified/browser-companion-targets.cjs'),/disable-extensions|load-extension|cookies|getBrowserProfile/);
});
