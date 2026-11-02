import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readOwnerSeatHeartbeat} from './owner-seat-evidence.mjs';

const fixed=Date.parse('2026-10-31T09:40:00Z');
const base=()=>({
 schema:1,role:'V2_OWNER_INTERACTIVE_SESSION_WORKER',state:'ALIVE_NOT_AUTHENTICATED',
 authority:'MONITOR_ONLY_NATIVE_TOKEN_RECHECK_REQUIRED',
 account:'Aa.Emad',sessionId:2,workerPid:1234,
 observedAt:new Date(fixed-5000).toISOString(),browserAttached:false,
 savedLoginVerified:false,chatSessionAttested:false,canExecuteUserActions:false,
 credentialsRead:false,profileCopied:false,
 browserCensus:{status:'OBSERVED',brave:1,firefox:0,chrome:2,msedge:3},
 windowInventory:{status:'OBSERVED',windows:[
  {app:'msedge',pid:44,windowId:'12554',processStartTicks:'987654321'},
  {app:'chrome',pid:45,windowId:'12345',processStartTicks:'987654322'}]},
 secret:'PRIVATE_STRING_NOT_TO_LEAK',
});
async function fixture(t) {
 const home=await mkdtemp(join(tmpdir(),'rcv2-seat-'));
 const dir=join(home,'ChatGPTRemoteCommander','V2OwnerSeat');
 await mkdir(dir,{recursive:true});
 t.after(()=>rm(home,{recursive:true,force:true,maxRetries:4,retryDelay:50}));
 const file=join(dir,'latest.json');
 return {home,file,read:(now=fixed,account='Aa.Emad')=>
  readOwnerSeatHeartbeat({os:'win32',base:home,account,observedAccount:'Aa.Emad',now})};
}
test('Windows-only adapter never scans Linux or guesses a user',async()=>{
 const data=await readOwnerSeatHeartbeat({os:'linux'});
 assert.equal(data.status,'UNSUPPORTED');
 assert.equal(data.authenticated,false);
 const wrong=await readOwnerSeatHeartbeat({os:'win32',base:'',account:'',now:fixed});
 assert.equal(wrong.status,'NOT_CONFIGURED');
});
test('exact V2 owner heartbeat yields bounded counts, not secrets or login',async t=>{
 const f=await fixture(t);
 await writeFile(f.file,JSON.stringify(base()));
 const s=await f.read();
 assert.equal(s.status,'OBSERVED_UNVERIFIED');
 assert.equal(s.seat,2);
 assert.deepEqual(s.browserCounts,{brave:1,firefox:0,chrome:2,msedge:3});
 assert.deepEqual(s.observedWindows,{brave:0,firefox:0,chrome:1,msedge:1});
 assert.equal(s.canExecute,false);assert.equal(s.authenticated,false);
 assert.equal(s.loginVerified,false);
 assert.doesNotMatch(JSON.stringify(s),/PRIVATE_STRING|windowId|workerPid|Aa.Emad/);
});
test('stale, forged authority and wrong owner fail closed',async t=>{
 const f=await fixture(t);
 const good=base();
 await writeFile(f.file,JSON.stringify(good));
 assert.equal((await f.read(fixed+150000)).status,'STALE');
 assert.equal((await f.read(fixed,'OtherOwner')).status,'NOT_CONFIGURED');
 await writeFile(f.file,JSON.stringify({...good,canExecuteUserActions:true}));
 assert.equal((await f.read()).status,'INVALID');
 await writeFile(f.file,JSON.stringify({...good,authority:'USER_AUTHENTICATED'}));
 assert.equal((await f.read()).status,'INVALID');
 await writeFile(f.file,JSON.stringify({...good,observedAt:new Date(fixed+60000).toISOString()}));
 assert.equal((await f.read()).status,'STALE');
});
test('malformed process inventory never implies a GUI grant',async t=>{
 const f=await fixture(t);
 await writeFile(f.file,JSON.stringify({...base(),windowInventory:{status:'OBSERVED',windows:[{
  app:'chrome',pid:44,windowId:'not-a-number',processStartTicks:'123'}]}}));
 const r=await f.read();
 assert.equal(r.status,'OBSERVED_UNVERIFIED');
 assert.equal(r.observedWindows,null);
 assert.equal(r.canExecute,false);
});
