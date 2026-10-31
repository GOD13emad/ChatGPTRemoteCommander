import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {makeOwnerSeatHeartbeat,writeOwnerSeatHeartbeat,startOwnerSeatWorker,
 normalizeOwnerBrowserCensus,readOwnerBrowserCensus}
 from '../tools/v2-owner-seat-agent.mjs';

test('owner heartbeat has no login, token, or tool authority',()=>{
 const h=makeOwnerSeatHeartbeat({user:'Aa.Emad',seat:1,pid:123,now:'2026-10-31T00:00:00Z'});
 assert.equal(h.role,'V2_OWNER_INTERACTIVE_SESSION_WORKER');
 assert.equal(h.authority,'MONITOR_ONLY_NATIVE_TOKEN_RECHECK_REQUIRED');
 for(const x of ['savedLoginVerified','chatSessionAttested','canExecuteUserActions','credentialsRead','profileCopied'])
  assert.equal(h[x],false);
 assert.equal(JSON.stringify(h).includes('password'),false);
 assert.equal(Object.isFrozen(h),true);
});
test('heartbeat rejects untrusted account or process metadata',()=>{
 for(const input of [
  {user:'../other',seat:1,pid:1},{user:'owner',seat:0,pid:1},
  {user:'owner',seat:1,pid:-1},{user:'owner',seat:1,pid:1,now:'bad'},
  {user:'owner',seat:1,pid:1.3}
 ])assert.throws(()=>makeOwnerSeatHeartbeat(input),{code:'V2_OWNER_SEAT_HEARTBEAT_INVALID'});
});
test('worker persists a minimal monitor record and atomically overwrites it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'v2-owner-seat-'));
 try{
  const dir=join(root,'owner'),a=makeOwnerSeatHeartbeat({user:'owner',seat:1,pid:99});
  await writeOwnerSeatHeartbeat({dir,heartbeat:a});
  assert.equal(JSON.parse(await readFile(join(dir,'latest.json'),'utf8')).canExecuteUserActions,false);
  await writeOwnerSeatHeartbeat({dir,heartbeat:makeOwnerSeatHeartbeat({user:'owner',seat:1,pid:100})});
  assert.equal(JSON.parse(await readFile(join(dir,'latest.json'),'utf8')).workerPid,100);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('symlink state location is refused',async t=>{
 const root=await mkdtemp(join(tmpdir(),'v2-owner-seat-'));
 try{
  try {await symlink(root,join(root,'link'),'dir');}
  catch(e){if(['EPERM','EACCES'].includes(e?.code)) {t.skip('host forbids symlink creation');return;}throw e;}
  await assert.rejects(writeOwnerSeatHeartbeat({
   dir:join(root,'link'),heartbeat:makeOwnerSeatHeartbeat({user:'owner',seat:1,pid:2})
  }),{code:'V2_OWNER_SEAT_STATE_UNSAFE'});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('background worker ends on abort without network or GUI actions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'v2-owner-seat-'));
 const ac=new AbortController();
 try{
  const work=startOwnerSeatWorker({dir:root,user:'owner',seat:1,pid:20,periodMs:1000,signal:ac.signal});
  for(let i=0;i<40;i++){
   try{const h=JSON.parse(await readFile(join(root,'latest.json'),'utf8'));
    if(h.state==='ALIVE_NOT_AUTHENTICATED')break;}
   catch{}
   await new Promise(r=>setTimeout(r,20));
  }
  ac.abort();await work;
  assert.equal(JSON.parse(await readFile(join(root,'latest.json'),'utf8')).browserAttached,false);
 }finally{ac.abort();await rm(root,{recursive:true,force:true});}
});

test('read-only same-seat browser process census contains no window titles or secrets',async()=>{
 const data=await readOwnerBrowserCensus({seat:1,probe:async seat=>{
  assert.equal(seat,1);
  return {status:'OBSERVED',brave:36,firefox:0,chrome:9,msedge:12,
   password:'not-returned',windowTitle:'not-returned',userDataDir:'not-returned'};
 }});
 assert.deepEqual(Object.keys(data).sort(),['status','brave','firefox','chrome','msedge'].sort());
 assert.equal(JSON.stringify(data).includes('not-returned'),false);
 assert.equal(Object.isFrozen(data),true);
 const heartbeat=makeOwnerSeatHeartbeat({user:'owner',seat:1,pid:3,browserCensus:data});
 assert.equal(heartbeat.browserCensus.brave,36);
 assert.equal(heartbeat.savedLoginVerified,false);
 assert.equal(heartbeat.canExecuteUserActions,false);
});
test('malformed/failed census cannot grant owner authority or invent a browser login',async()=>{
 for(const bad of [{status:'OBSERVED',brave:-1,firefox:0,chrome:0,msedge:0},
  {status:'OBSERVED',brave:1,firefox:0,chrome:0,msedge:'2'}]){
  await assert.deepEqual(
   await readOwnerBrowserCensus({seat:1,probe:async()=>bad}),{status:'UNAVAILABLE'});
 }
 await assert.deepEqual(
  await readOwnerBrowserCensus({seat:1,probe:async()=>{throw Error('unavailable');}}),
  {status:'UNAVAILABLE'});
 await assert.rejects(readOwnerBrowserCensus({seat:0,probe:async()=>({status:'OBSERVED'})}),
  {code:'V2_OWNER_NATIVE_SEAT_REQUIRED'});
});
test('background worker records census and preserves no-tool, no-login boundary',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2-owner-census-'));
 const ac=new AbortController();
 try{
  const run=startOwnerSeatWorker({dir,user:'owner',seat:1,pid:4,periodMs:1000,
   signal:ac.signal,observeBrowsers:async({seat})=>{
    assert.equal(seat,1);
    return {status:'OBSERVED',brave:2,firefox:0,chrome:0,msedge:0};
   }});
  for(let i=0;i<50;i++){
   try{const h=JSON.parse(await readFile(join(dir,'latest.json'),'utf8'));
    if(h.browserCensus?.status==='OBSERVED')break;}
   catch{}await new Promise(r=>setTimeout(r,20));
  }
  ac.abort();await run;
  const h=JSON.parse(await readFile(join(dir,'latest.json'),'utf8'));
  assert.equal(h.browserCensus.brave,2);
  assert.equal(h.canExecuteUserActions,false);
  assert.equal(h.savedLoginVerified,false);
 }finally{ac.abort();await rm(dir,{recursive:true,force:true});}
});
