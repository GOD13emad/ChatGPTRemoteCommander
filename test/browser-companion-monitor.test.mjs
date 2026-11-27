import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, stat, rm, symlink, writeFile } from 'node:fs/promises';
import {ensureWindowsMonitorDirectories} from '../src/browser-companion-windows-private.mjs';
import { defaultBrowserCompanionRoot, sanitizeMonitorSnapshot, writeBrowserCompanionMonitor, browserCompanionInstanceRoot, writeBrowserCompanionInstanceMonitor, startBrowserCompanionMonitor, listBrowserCompanionInstances, selectBrowserCompanionInstance } from '../src/browser-companion-monitor.mjs';

test('default roots are platform-separated from Chromium profile data',()=>{
  assert.equal(defaultBrowserCompanionRoot({platform:'win32',env:{LOCALAPPDATA:'C:\\Users\\u\\AppData\\Local'},home:'C:\\Users\\u'}),'C:\\Users\\u\\AppData\\Local\\ChatGPTRemoteCommander\\browser-companion');
  assert.equal(defaultBrowserCompanionRoot({platform:'linux',env:{XDG_STATE_HOME:'/tmp/state'},home:'/home/u'}),'/tmp/state/chatgpt-remote-commander/browser-companion');
});

test('monitor snapshot is bounded and strips untrusted extra fields',()=>{
  const s=sanitizeMonitorSnapshot({
    identity:{deviceName:'host',profile:'default',version:'0.10.19',configSha256:'a'.repeat(64),port:48832,platform:'linux',secret:'no'},
    gui:{enabled:true,available:true,uncertain:true,backend:'gnome-mutter-remote-desktop',sessionType:'wayland',capabilities:{screenshot:true,mouse:true,keyboard:true,focus:true,other:true}},
    browser:{enabled:true,available:true,uncertain:true,backend:'chromium-cdp'},
    workflows:{enabled:true,engineEnabled:true,runCount:3},
    extensions:{items:[{id:'project-execution-brain',version:'1.3.1',path:'/secret'}]},
    operations:{active:1,lockedKeys:2}
  },1000);
  assert.equal(s.kind,'COMMANDER_LIVE_MONITOR');
  assert.equal(s.expiresAtEpochMs,11000);
  assert.deepEqual(s.extensions.items,[{id:'project-execution-brain',version:'1.3.1'}]);
  assert.equal('secret' in s.identity,false);
  assert.equal('other' in s.gui.capabilities,false);
  assert.equal(s.gui.uncertain,true);
  assert.equal(s.browser.uncertain,true);
  const unavailable=sanitizeMonitorSnapshot({
    identity:{deviceName:'host',profile:'default',version:'0.10.19',configSha256:'c'.repeat(64),port:48831,platform:'win32'},
    gui:{enabled:true,available:false,backend:'',sessionType:'',reason:''},
    browser:{enabled:true,available:false,backend:'',reason:''},
    workflows:{enabled:true,engineEnabled:true,runCount:0},
    extensions:{items:[]},
    operations:{active:0,lockedKeys:0}
  },1500);
  assert.equal(unavailable.gui.backend,null);
  assert.equal(unavailable.gui.sessionType,null);
  assert.equal(unavailable.gui.reason,null);
  assert.equal(unavailable.browser.backend,null);
  assert.equal(unavailable.browser.reason,null);
});

test('Windows-style GUI status falls back to policy capabilities without overriding explicit capability fields',()=>{
  const base={
    identity:{deviceName:'win-host',profile:'default',version:'0.10.20',configSha256:'e'.repeat(64),port:48831,platform:'win32'},
    gui:{enabled:true,available:true,uncertain:false,backend:'windows-user32-gdi',sessionType:null,reason:null,
      policy:{allowScreenshot:true,allowMouse:true,allowKeyboard:true,allowWindowFocus:true}},
    browser:{enabled:true,available:true,uncertain:false,backend:'chromium-cdp',reason:null},
    workflows:{enabled:true,engineEnabled:true,runCount:0},
    extensions:{items:[]},
    operations:{active:0,lockedKeys:0}
  };
  const fallback=sanitizeMonitorSnapshot(base,4000);
  assert.deepEqual(fallback.gui.capabilities,{screenshot:true,mouse:true,keyboard:true,focus:true});
  const explicit=sanitizeMonitorSnapshot({...base,gui:{...base.gui,capabilities:{screenshot:false,mouse:false,keyboard:false,focus:false}}},4000);
  assert.deepEqual(explicit.gui.capabilities,{screenshot:false,mouse:false,keyboard:false,focus:false});
});

test('linux monitor writer creates owner-private bounded snapshot',{skip:process.platform!=='linux'},async()=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'rc-monitor-'));
  const root=path.join(base,'state','browser-companion');
  try{
    const receipt=await writeBrowserCompanionMonitor(root,{
      identity:{deviceName:'host',profile:'default',version:'0.10.19',configSha256:'b'.repeat(64),port:48832,platform:'linux'},
      gui:{enabled:true,available:false,reason:'TEST'},
      browser:{enabled:true,available:false,reason:'TEST'},
      workflows:{enabled:false,engineEnabled:false,runCount:0},
      extensions:{items:[]},
      operations:{active:0,lockedKeys:0}
    },{platform:'linux',now:()=>2000});
    const raw=await readFile(receipt.target,'utf8');
    const parsed=JSON.parse(raw);
    assert.equal(parsed.observedAtEpochMs,2000);
    assert.equal((await stat(root)).mode & 0o777,0o700);
    assert.equal((await stat(receipt.target)).mode & 0o777,0o600);
  }finally{await rm(base,{recursive:true,force:true});}
});

test('windows fresh user install creates missing monitor root',{skip:process.platform!=='win32'},async()=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'rc-monitor-new-win-'));
  const root=path.join(base,'fresh','browser-companion');
  try{
    const receipt=await writeBrowserCompanionMonitor(root,{
      identity:{deviceName:'host',profile:'default',version:'0.11.0-dev.105',platform:'win32'},
      gui:{enabled:false,available:false},
      browser:{enabled:false,available:false},
      workflows:{enabled:false,engineEnabled:false,runCount:0},
      extensions:{items:[]},
      operations:{active:0,lockedKeys:0}
    },{platform:'win32',now:()=>5000});
    assert.equal((await stat(root)).isDirectory(),true);
    assert.equal(JSON.parse(await readFile(receipt.target,'utf8')).observedAtEpochMs,5000);
  }finally{await rm(base,{recursive:true,force:true});}
});
test('windows monitor writer uses a pre-created local root without POSIX mode assumptions',{skip:process.platform!=='win32'},async()=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'rc-monitor-win-'));
  const root=path.join(base,'browser-companion');
  try{
    await ensureWindowsMonitorDirectories([root]);
    const receipt=await writeBrowserCompanionMonitor(root,{
      identity:{deviceName:'host',profile:'default',version:'0.10.19',configSha256:'d'.repeat(64),port:48831,platform:'win32'},
      gui:{enabled:true,available:false,uncertain:false,reason:'TEST'},
      browser:{enabled:true,available:false,uncertain:false,reason:'TEST'},
      workflows:{enabled:false,engineEnabled:false,runCount:0},
      extensions:{items:[]},
      operations:{active:0,lockedKeys:0}
    },{platform:'win32',now:()=>3000});
    const parsed=JSON.parse(await readFile(receipt.target,'utf8'));
    assert.equal(parsed.identity.platform,'win32');
    assert.equal(parsed.observedAtEpochMs,3000);
  }finally{await rm(base,{recursive:true,force:true});}
});


const instanceFixture=(profile,port)=>({identity:{deviceName:'qa-host',profile,port,
  version:'0.12.0-dev.13',configSha256:'a'.repeat(64),platform:process.platform}});
test('instance scope is stable, platform-safe, and distinguishes same profile on different ports',()=>{
  const root=process.platform==='win32'?'C:\\Users\\qa\\browser-companion':'/tmp/qa-monitor';
  const a={profile:'default',port:51913};
  assert.equal(browserCompanionInstanceRoot(root,a),browserCompanionInstanceRoot(root,{...a}));
  assert.notEqual(browserCompanionInstanceRoot(root,a),browserCompanionInstanceRoot(root,{...a,port:51923}));
  assert.notEqual(browserCompanionInstanceRoot(root,a),browserCompanionInstanceRoot(root,{...a,profile:'DEFAULT'}));
  for(const profile of ['../escape','a/b','a\\b','..','',null])
    assert.throws(()=>browserCompanionInstanceRoot(root,{profile,port:51913}),/INSTANCE_INVALID/);
  assert.throws(()=>browserCompanionInstanceRoot(root,{profile:'qa',port:0}),/INSTANCE_INVALID/);
});
test('two independent instances never overwrite each other or the legacy monitor',async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'rc-monitor-scope-'));
  const base=path.join(temp,'private');
  if(process.platform==='win32')await ensureWindowsMonitorDirectories([base]);else await mkdir(base,{mode:0o700});
  t.after(()=>rm(temp,{recursive:true,force:true}));
  const legacy=path.join(base,'commander-monitor.json');
  await writeFile(legacy,'legacy-owner-state',{mode:0o600});
  const a={profile:'default',port:51913},b={profile:'default',port:51923};
  const [ra,rb]=await Promise.all([
    writeBrowserCompanionInstanceMonitor(base,a,instanceFixture(a.profile,a.port),{now:()=>1000}),
    writeBrowserCompanionInstanceMonitor(base,b,instanceFixture(b.profile,b.port),{now:()=>2000})]);
  assert.notEqual(ra.target,rb.target);
  assert.equal(JSON.parse(await readFile(ra.target,'utf8')).identity.port,a.port);
  assert.equal(JSON.parse(await readFile(rb.target,'utf8')).identity.port,b.port);
  assert.equal(await readFile(legacy,'utf8'),'legacy-owner-state');
  await assert.rejects(()=>writeBrowserCompanionInstanceMonitor(base,a,instanceFixture(b.profile,b.port)),/INSTANCE_MISMATCH/);
  const current=JSON.parse(await readFile(ra.target,'utf8'));
  assert.equal(current.identity.port,a.port);
});
test('periodic server monitor remains bound to its exact instance and exposes only a scope identifier',async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'rc-monitor-loop-'));
  const base=path.join(temp,'private');

  const a={profile:'qa-a',port:51913},b={profile:'qa-b',port:51923};
  const x=startBrowserCompanionMonitor({root:base,instance:a,snapshot:()=>instanceFixture(a.profile,a.port),intervalMs:60000});
  const y=startBrowserCompanionMonitor({root:base,instance:b,snapshot:()=>instanceFixture(b.profile,b.port),intervalMs:60000});
  t.after(async()=>{x.stop();y.stop();await rm(temp,{recursive:true,force:true})});
  const until=Date.now()+10000;
  while((!x.status().lastWriteAtEpochMs||!y.status().lastWriteAtEpochMs)&&Date.now()<until)
    await new Promise(r=>setTimeout(r,20));
  assert.ok(x.status().lastWriteAtEpochMs);assert.ok(y.status().lastWriteAtEpochMs);
  assert.equal(x.status().scope,'INSTANCE');
  assert.notEqual(x.status().scopeId,y.status().scopeId);
  assert.match(x.status().scopeId,/^[a-f0-9]{64}$/);
  assert.equal(JSON.parse(await readFile(path.join(browserCompanionInstanceRoot(base,a),'commander-monitor.json'),'utf8')).identity.profile,a.profile);
  assert.equal(JSON.parse(await readFile(path.join(browserCompanionInstanceRoot(base,b),'commander-monitor.json'),'utf8')).identity.profile,b.profile);
});
test('unsafe instance directory symlink is rejected without chmod or writing its destination',{skip:process.platform!=='linux'},async t=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'rc-monitor-link-'));
  t.after(()=>rm(base,{recursive:true,force:true}));
  const root=path.join(base,'companion'),outside=path.join(base,'outside');
  await mkdir(root,{mode:0o700});await mkdir(outside,{mode:0o755});
  const outsideMode=(await stat(outside)).mode&0o777;
  await symlink(outside,path.join(root,'instances'),'dir');
  await assert.rejects(()=>writeBrowserCompanionInstanceMonitor(root,{profile:'qa',port:51913},instanceFixture('qa',51913)),/ROOT_UNSAFE/);
  assert.equal((await stat(outside)).mode&0o777,outsideMode);
  assert.deepEqual(await (await import('node:fs/promises')).readdir(outside),[]);
});

test('invalid instance disables only optional monitor; no shared-root fallback',async t=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'rc-monitor-invalid-'));
  t.after(()=>rm(base,{recursive:true,force:true}));
  let calls=0;
  const ctl=startBrowserCompanionMonitor({root:base,instance:{profile:'../bad',port:51913},
    snapshot:()=>{calls++;return instanceFixture('qa',51913)}});
  t.after(()=>ctl.stop());
  assert.equal(ctl.status().enabled,false);
  assert.equal(ctl.status().scopeId,null);
  assert.equal(ctl.status().lastError,'BROWSER_COMPANION_INSTANCE_INVALID');
  assert.equal(calls,0);
  assert.deepEqual(await (await import('node:fs/promises')).readdir(base),[]);
});


test('fresh instance discovery and explicit revalidation refuse stale, mismatched or unsafe records',async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'rc-monitor-picker-'));
  const base=path.join(temp,'private');

  t.after(()=>rm(temp,{recursive:true,force:true}));
  const a={profile:'qa-a',port:51913},b={profile:'qa-b',port:51923},c={profile:'qa-c',port:51933};
  await writeBrowserCompanionInstanceMonitor(base,a,instanceFixture(a.profile,a.port),{now:()=>1000});
  await writeBrowserCompanionInstanceMonitor(base,b,instanceFixture(b.profile,b.port),{now:()=>2000});
  const old=await writeBrowserCompanionInstanceMonitor(base,c,instanceFixture(c.profile,c.port),{now:()=>1});
  const aId=path.basename(browserCompanionInstanceRoot(base,a));
  const bId=path.basename(browserCompanionInstanceRoot(base,b));
  const entries=await listBrowserCompanionInstances({base,now:10001});
  assert.deepEqual(entries.map(x=>x.scopeId),[aId,bId]);assert.ok(entries.every(x=>!Object.hasOwn(x,'root')));
  const selected=await selectBrowserCompanionInstance(aId,{base,now:10001});
  assert.equal(selected.root,browserCompanionInstanceRoot(base,a));
  assert.equal(selected.environmentVariable,'CGWA_COMPANION_ROOT');
  assert.equal(selected.actionAuthorization,false);assert.equal(selected.nativeValidationRequired,true);
  // Dashboard data uses the same validated instance, never the shared root.
  const rich={...instanceFixture(a.profile,a.port),
    gui:{enabled:true,available:true,uncertain:false,capabilities:{screenshot:true,mouse:false}},
    browser:{enabled:true,available:true,uncertain:true},
    workflows:{enabled:true,engineEnabled:true,runCount:7},
    extensions:{items:[{id:'fixture',version:'1',secret:'PRIVATE'}]},
    operations:{active:2,lockedKeys:3}};
  const updated=await writeBrowserCompanionInstanceMonitor(base,a,rich,{now:()=>1000});
  const raw=JSON.parse(await readFile(updated.target,'utf8'));
  raw.gui.reason='PRIVATE';raw.operations.active=Number.MAX_VALUE;
  raw.extensions.items[0].id='PRIVATE';
  await writeFile(updated.target,JSON.stringify(raw));
  const dashboard=await selectBrowserCompanionInstance(aId,{base,now:10001});
  assert.deepEqual(dashboard.summary,{
    observedAtEpochMs:1000,
    gui:{enabled:true,available:true,uncertain:false},
    browser:{enabled:true,available:true,uncertain:true},
    workflows:{enabled:true,engineEnabled:true,runCount:7},
    extensionCount:1,
    operations:{active:null,lockedKeys:3}
  });
  assert.doesNotMatch(JSON.stringify(dashboard.summary),/PRIVATE|configSha256|capabilities/);
  assert.equal(dashboard.actionAuthorization,false);
  assert.ok((await listBrowserCompanionInstances({base,now:10001})).every(x=>!Object.hasOwn(x,'summary')));
  await assert.rejects(()=>selectBrowserCompanionInstance(aId,{base,now:11000}),/STALE_OR_MISMATCH/);
  await assert.rejects(()=>selectBrowserCompanionInstance('../escape',{base,now:10001}),/SELECTION_INVALID/);
  const forged=JSON.parse(await readFile(old.target,'utf8'));forged.identity.profile=a.profile;forged.observedAtEpochMs=1000;forged.expiresAtEpochMs=11000;
  await writeFile(old.target,JSON.stringify(forged));
  assert.equal((await listBrowserCompanionInstances({base,now:10001})).length,2);
});
test('absent monitor root is not created by discovery',async t=>{
  const base=await mkdtemp(path.join(os.tmpdir(),'rc-monitor-no-create-'));
  t.after(()=>rm(base,{recursive:true,force:true}));
  assert.deepEqual(await listBrowserCompanionInstances({base:path.join(base,'missing')}),[]);
  assert.deepEqual(await (await import('node:fs/promises')).readdir(base),[]);
});


test('Windows refuses pre-existing unsafe monitor ACL without modifying existing contents',{skip:process.platform!=='win32'},async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'rc-monitor-unsafe-acl-'));
  t.after(()=>rm(temp,{recursive:true,force:true}));
  const base=path.join(temp,'root');await mkdir(base);
  const marker=path.join(base,'owner-marker');await writeFile(marker,'preserve');
  // Establish whether the host's inherited ACL is already private. If so,
  // use a read-only proof rather than weakening the fixture's permissions.
  let unsafe=false;
  try{await ensureWindowsMonitorDirectories([base],{create:false});}catch{unsafe=true;}
  if(unsafe){
    await assert.rejects(()=>writeBrowserCompanionInstanceMonitor(base,{profile:'qa',port:51913},instanceFixture('qa',51913)),/WINDOWS_PRIVATE_ROOT_UNPROVEN/);
    assert.deepEqual(await (await import('node:fs/promises')).readdir(base),['owner-marker']);
  }
  assert.equal(await readFile(marker,'utf8'),'preserve');
});
