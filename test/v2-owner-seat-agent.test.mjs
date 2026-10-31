import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {makeOwnerSeatHeartbeat,writeOwnerSeatHeartbeat,startOwnerSeatWorker}
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
