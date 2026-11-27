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
    browser:{enabled:true,available:true,uncertain:true},workflows:{enabled:true,engineEnabled:true,runCount:7,runStates:{completed:1,stopped:2,waiting:3,other:1}},
    extensionCount:1,eventRelay:{enabled:true,ready:true,deliveryConfirmed:false},operations:{active:2,lockedKeys:3}},...extra});
  let catalogResponse={actionAuthorization:false,items:[{name:'Fixture add-on',state:'PLANNED',installable:false,platformSupported:true}]};
  const api={status:async()=>({preview:'stopped'}),preflight:async()=>({decision:'NO_PROMOTE'}),
    catalogAddons:async()=>catalogResponse,
    companionStatus:async()=>({}),companionBrowserList:async()=>[],
    monitorInstances:async()=>[{scopeId:a,profile:'qa-a',port:1,version:'dev'},{scopeId:b,profile:'qa-b',port:2,version:'dev'}],
    monitorSelect:()=>new Promise(resolve=>{resolveSelection=resolve})};
  runInNewContext(file('packaging/unified/renderer.js'),{
    document:{getElementById:get,createElement:element},window:{commander:api},
    Date:{now:()=>clock},setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer},
    clearTimeout:id=>timers.delete(id)
  });
  await new Promise(setImmediate);
  assert.equal(get('addons-list').options.length,1);
  assert.equal(get('profile-list').options.length,2);
  assert.match(get('profile-status').textContent,/2.*observed/);
  assert.match(get('addons-status').textContent,/1 planned add-ons/);
  catalogResponse={actionAuthorization:true,items:[]};
  await get('addons-refresh').fire('click');await new Promise(setImmediate);
  assert.equal(get('addons-list').options.length,0);
  assert.match(get('addons-status').textContent,/unavailable or invalid/);
  const select=get('monitor-instance'),button=get('monitor-select');
  const choose=id=>{select.value=id;select.fire('change')};
  choose(a);let pending=button.fire('click');const oldResolve=resolveSelection;
  choose(b);let fresh=button.fire('click');resolveSelection(result(b));await fresh;
  oldResolve(result(a));await pending;
  assert.equal(get('dashboard-gui').textContent,'Available (reported)');
  assert.equal(get('dashboard-browser').textContent,'Uncertain');
  assert.equal(get('dashboard-runs').textContent,'7');
  assert.equal(get('dashboard-run-completed').textContent,'1');
  assert.equal(get('dashboard-run-stopped').textContent,'2');
  assert.equal(get('dashboard-run-waiting').textContent,'3');
  assert.equal(get('dashboard-run-other').textContent,'1');
  assert.equal(get('dashboard-active').textContent,'2');
  assert.equal(get('dashboard-relay').textContent,'Ready (reported; delivery unverified)');
  assert.equal(JSON.parse(get('monitor-result').textContent).scopeId,b);
  assert.equal(timers.size,1);
  clock+=10000;[...timers.values()][0]();
  assert.equal(get('dashboard-gui').textContent,'Stale');
  assert.equal(get('dashboard-relay').textContent,'Stale');
  assert.equal(get('dashboard-run-waiting').textContent,'Stale');
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
  assert.equal(get('dashboard-run-completed').textContent,'Not selected');
  assert.equal(timers.size,0);
});

test('Unified add-ons reuse the native Control Center catalog and fail closed',()=>{
  const {projectAddons}=require('../packaging/unified/workspace-catalog.cjs');
  const doc=JSON.parse(file('installer/products.json'));
  const lin=projectAddons(doc,'linux'),win=projectAddons(doc,'win32');
  assert.equal(lin.items.length,doc.controlCenterAddons.items.length);
  assert.equal(lin.items.find(x=>x.id==='ufo2').platformSupported,false);
  assert.equal(win.items.find(x=>x.id==='vllm').platformSupported,false);
  assert.ok(lin.items.every(x=>x.installable===false&&x.state==='PLANNED'));
  assert.equal(lin.actionAuthorization,false);
  assert.doesNotMatch(JSON.stringify(lin),/https:|adapterPath|sha256/);
  for(const alter of [
    a=>a.defaultAutoInstall=true,
    a=>a.items[0].downloadDefault=true,
    a=>a.items[0].admission='approved',
    a=>a.items.push({...a.items[0]}),
    a=>a.items[0].platforms=['darwin'],
    a=>a.items[0].name='bad\\nname'.replace('\\n','\n')
  ]){
    const bad=structuredClone(doc);alter(bad.controlCenterAddons);
    assert.throws(()=>projectAddons(bad,'linux'),/WORKSPACE_CATALOG_INVALID/);
  }
  assert.throws(()=>projectAddons(doc,'darwin'),/WORKSPACE_CATALOG_INVALID/);
});

test('catalog receipt binds the exact source and rejects tampering',async t=>{
  const {readCatalog}=require('../packaging/unified/workspace-catalog.cjs');
  const {tmpdir}=await import('node:os');
  const {createHash}=await import('node:crypto');
  const root=fs.mkdtempSync(path.join(tmpdir(),'rc-catalog-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const raw=file('installer/products.json'),source={head:'a'.repeat(40),tree:'b'.repeat(40)};
  const receipt={...source,sha256:createHash('sha256').update(raw).digest('hex')};
  const catalog=path.join(root,'products.json'),manifest=path.join(root,'source.json');
  fs.writeFileSync(catalog,raw);fs.writeFileSync(manifest,JSON.stringify(receipt));
  assert.equal(readCatalog(root,source,'linux').actionAuthorization,false);
  assert.throws(()=>readCatalog(root,{...source,tree:'c'.repeat(40)},'linux'),/WORKSPACE_CATALOG_INVALID/);
  fs.appendFileSync(catalog,' ');
  assert.throws(()=>readCatalog(root,source,'linux'),/WORKSPACE_CATALOG_INVALID/);
});
