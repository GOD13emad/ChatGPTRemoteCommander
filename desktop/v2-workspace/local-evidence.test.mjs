import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOwnerEvidence } from './local-evidence.mjs';

test('Unsupported platforms do not scan local state', async()=>{
  const e=await readOwnerEvidence({platform:'win32',root:'C:\\private\\state',uid:0});
  assert.equal(e.state,'UNSUPPORTED');
  assert.equal(e.chatIdentityAuthenticated,false);
});
const linux=process.platform==='linux' && typeof process.getuid==='function';
async function fixture(t) {
  const home=await mkdtemp(join(tmpdir(),'v2-mmz-evidence-'));
  const root=join(home,'state');
  await chmod(home,0o700);
  await mkdir(root,{mode:0o700});
  await mkdir(join(root,'browser-companion'),{mode:0o700});
  await mkdir(join(root,'multi-chat'),{mode:0o700});
  t.after(()=>rm(home,{recursive:true,force:true,maxRetries:3,retryDelay:40}));
  const uid=process.getuid();
  return {
    root,uid,
    async put(sub,name,data,mode=0o600){
      const file=join(root,sub,name);
      await writeFile(file,JSON.stringify(data),{mode:0o600,flag:'w'});
      await chmod(file,mode);
      return file;
    },
    async read(now){return readOwnerEvidence({platform:'linux',uid,root,now});}
  };
}
function monitor(now) {
  return {schema:1,kind:'COMMANDER_LIVE_MONITOR',
    observedAtEpochMs:now-1000,expiresAtEpochMs:now+9000,
    identity:{deviceName:'mmz-LOQ-15IRX9',version:'0.11.0-dev.18',profile:'default',secret:'DO_NOT_SEND'},
    gui:{available:true,secret:'hidden'}, browser:{available:false},
    operations:{active:3,secret:'hidden'},workflows:{engineEnabled:true,runCount:7},
    delivery:{available:true,pending:12,secret:'hidden'},secret:'DO_NOT_SEND'};
}
test('fresh strictly scoped monitor yields read-only observed telemetry', {skip:!linux},async t=>{
  const f=await fixture(t),now=Date.now();
  await f.put('browser-companion','commander-monitor.json',monitor(now));
  const e=await f.read(now);
  assert.equal(e.state,'CONNECTED');
  assert.equal(e.activeOperations,3);
  assert.equal(e.workflow.runCount,7);
  assert.equal(e.gui,'AVAILABLE_REQUIRES_AUTH');
  assert.equal(e.browser,'BLOCKED');
  assert.equal(e.chatIdentityAuthenticated,false);
  assert.doesNotMatch(JSON.stringify(e),/DO_NOT_SEND|hidden/);
});
test('expired monitor must be stale; no zero or connected defaults', {skip:!linux},async t=>{
  const f=await fixture(t),now=Date.now();
  await f.put('browser-companion','commander-monitor.json',{...monitor(now),expiresAtEpochMs:now-1});
  const e=await f.read(now);
  assert.equal(e.state,'STALE');assert.equal(e.activeOperations,null);
});
test('owner mode, symlink, owner UID and unsafe JSON fail closed', {skip:!linux},async t=>{
  const f=await fixture(t),now=Date.now();
  const p=await f.put('browser-companion','commander-monitor.json',monitor(now),0o644);
  assert.equal((await f.read(now)).state,'UNVERIFIED');
  await chmod(p,0o600);
  assert.equal((await readOwnerEvidence({platform:'linux',uid:f.uid+1000,root:f.root,now})).state,'UNVERIFIED');
  await rm(p);
  await symlink(join(f.root,'no-such-file'),p);
  assert.equal((await f.read(now)).state,'UNVERIFIED');
});
test('registered projects and scoped recent observation remain unauthenticated', {skip:!linux},async t=>{
  const f=await fixture(t),now=Date.now();
  const chat='12345678-1234-1234-1234-1234567890ab';
  await f.put('browser-companion','commander-monitor.json',monitor(now));
  await f.put('multi-chat','registry.json',{schema:1,kind:'MULTI_CHAT_PROJECT_REGISTRY',projects:[
    {projectId:'alpha_1',title:'Research project',chatId:chat,checkpoint:null,status:'DONE_VERIFIED',secret:'DO_NOT_SEND'},
    {projectId:'beta_1',title:'Second project',chatId:null}
  ]});
  await f.put('multi-chat','events.json',{schema:1,kind:'CHAT_COMPANION_OBSERVATIONS',observations:[
    {projectId:'alpha_1',chatId:chat,state:'TAB_VISIBLE',observedAtEpochMs:now-3000,secret:'DO_NOT_SEND'},
    {projectId:'beta_1',chatId:chat,state:'TAB_VISIBLE',observedAtEpochMs:now-1000}
  ]});
  const e=await f.read(now);
  assert.equal(e.multiChat.count,2);
  assert.deepEqual(e.multiChat.projects.map(x=>x.state),['OBSERVED_UNVERIFIED','UNKNOWN_STALE']);
  assert.equal(e.multiChat.observedUnverified,1);
  assert.equal(e.chatIdentityAuthenticated,false);
  assert.doesNotMatch(JSON.stringify(e),/DO_NOT_SEND|DONE_VERIFIED/);
});
test('future, closed, and stale chat events never imply authenticated activity', {skip:!linux},async t=>{
  const f=await fixture(t),now=Date.now(),chat='12345678-1234-1234-1234-1234567890ab';
  await f.put('multi-chat','registry.json',{schema:1,kind:'MULTI_CHAT_PROJECT_REGISTRY',projects:[{projectId:'alpha_1',title:'A',chatId:chat}]});
  for(const [state,at] of [['TAB_VISIBLE',now-47000],['TAB_CLOSED',now-1000],['TAB_VISIBLE',now+40000]]){
    await f.put('multi-chat','events.json',{schema:1,kind:'CHAT_COMPANION_OBSERVATIONS',observations:[{projectId:'alpha_1',chatId:chat,state,observedAtEpochMs:at}]});
    const e=await f.read(now);
    assert.equal(e.multiChat.projects[0].state,'UNKNOWN_STALE',state);
  }
});
