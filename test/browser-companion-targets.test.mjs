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

test('Unified workspace navigation preserves existing controls and applies packaged styles under strict CSP',()=>{
  const html=file('packaging/unified/index.html');
  const cfg=file('packaging/unified/electron-builder.yml');
  assert.match(html,/style-src 'self';/);
  assert.doesNotMatch(html,/<style\b|\sstyle\s*=/i);
  assert.match(html,/<link rel="stylesheet" href="\.\/workspace\.css">/);
  assert.match(cfg,/^\s*- workspace\.css\s*$/m);
  const css=file('packaging/unified/workspace.css');
  assert.match(css,/@media/);
  assert.doesNotMatch(css,/@import|url\s*\(/i);
  const nav=html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav);
  for(const id of ['overview','migration-panel','preview-panel','browser-panel','monitor-panel','companion-panel']){
    assert.ok(nav.includes('href="#'+id+'"'),id);
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  for(const id of ['status','migration','start','stop','result','chat-open','chat-popup','chat-result','monitor-instance','monitor-refresh','monitor-select','monitor-result','companion-start','companion-stop','companion-code','companion-folder','companion-browser-target','companion-browser-open','companion-result']){
    assert.equal(html.split('id="'+id+'"').length,2,id);
  }
  assert.match(html,/source-pinned engineering pilot/);
  assert.match(html,/No automatic launch, account binding, or permission grant/);
});

test('dashboard clears stale and cross-selection responses without granting control',async()=>{
  const {runInNewContext}=await import('node:vm');
  const elements=new Map();
  function element(){
    return {value:'',textContent:'',disabled:false,options:[],handlers:{},
      get selectedOptions(){return this.options.filter(x=>x.value===this.value)},
      replaceChildren(){this.options=[];this.value=''},append(x){this.options.push(x)},
      addEventListener(name,fn){this.handlers[name]=fn},
      fire(name){return this.handlers[name]?.()}};
  }
  const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)};
  const a='qa-a',b='qa-b';
  let clock=1000,nextTimer=0,resolveSelection;
  const timers=new Map();
  const result=(id,extra={})=>({scopeId:id,readOnly:true,actionAuthorization:false,
    expiresAtEpochMs:clock+10000,summary:{gui:{enabled:true,available:true,uncertain:false},
    browser:{enabled:true,available:true,uncertain:true},workflows:{enabled:true,engineEnabled:true,runCount:7},
    extensionCount:1,operations:{active:2,lockedKeys:3}},...extra});
  const api={status:async()=>({preview:'stopped'}),preflight:async()=>({decision:'NO_PROMOTE'}),
    companionStatus:async()=>({}),companionBrowserList:async()=>[],
    monitorInstances:async()=>[{scopeId:a,profile:'qa-a',port:1,version:'dev'},{scopeId:b,profile:'qa-b',port:2,version:'dev'}],
    monitorSelect:()=>new Promise(resolve=>{resolveSelection=resolve})};
  runInNewContext(file('packaging/unified/renderer.js'),{
    document:{getElementById:get,createElement:element},window:{commander:api},
    Date:{now:()=>clock},setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer},
    clearTimeout:id=>timers.delete(id)
  });
  await new Promise(setImmediate);
  const select=get('monitor-instance'),button=get('monitor-select');
  const choose=id=>{select.value=id;select.fire('change')};
  choose(a);let pending=button.fire('click');const oldResolve=resolveSelection;
  choose(b);let fresh=button.fire('click');resolveSelection(result(b));await fresh;
  oldResolve(result(a));await pending;
  assert.equal(get('dashboard-gui').textContent,'Available (reported)');
  assert.equal(get('dashboard-browser').textContent,'Uncertain');
  assert.equal(get('dashboard-runs').textContent,'7');
  assert.equal(get('dashboard-active').textContent,'2');
  assert.equal(JSON.parse(get('monitor-result').textContent).scopeId,b);
  assert.equal(timers.size,1);
  clock+=10000;[...timers.values()][0]();
  assert.equal(get('dashboard-gui').textContent,'Stale');
  assert.match(get('monitor-result').textContent,/stale/);
  choose(a);pending=button.fire('click');resolveSelection(result(b));await pending;
  assert.equal(get('dashboard-active').textContent,'Unknown');
  pending=button.fire('click');resolveSelection(result(a,{actionAuthorization:true}));await pending;
  assert.equal(get('dashboard-gui').textContent,'Unknown');
  pending=button.fire('click');resolveSelection(result(a,{expiresAtEpochMs:clock}));await pending;
  assert.equal(get('dashboard-active').textContent,'Unknown');
  await get('monitor-refresh').fire('click');await new Promise(setImmediate);
  assert.equal(get('dashboard-gui').textContent,'Not selected');
  assert.equal(button.disabled,true);
  assert.equal(timers.size,0);
});
