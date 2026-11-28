import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBrowserController,createBrowserBackendRouter} from '../src/browser-tools.mjs';
import {readBrowserLeaseMarker} from '../src/browser-lease-store.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-end-confirmation-'));
 const calls=[];let clock=0,timer,profile,counter=0;
 const responses=[];
 const ctx={config:{instance:{profile:'default'},powerMode:{enabled:true,browserControl:{
  enabled:true,profileRoot:root,allowNavigate:true,allowInput:true,allowScreenshot:true,
  allowForegroundFallback:true,foregroundFallback:'explicit-current-request-only'
 }}}};
 const ctl=createBrowserController({now:()=>clock,wallNow:()=>1700000000000+clock,
  token:()=> (++counter).toString(16).padStart(12,'0')+'a'.repeat(36),
  scheduleTimeout:fn=>{timer=fn;return {unref(){}};},cancelTimeout:()=>{},
  closeInvoke:()=>{},invoke:async req=>{
   calls.push(req.action);
   if(req.action==='start'){profile=req.profileDir;return {ok:true};}
   if(req.action==='end'){const v=responses.shift();if(v instanceof Error)throw v;return typeof v==='function'?await v():v??{ok:true,closed:true};}
   if(req.action==='status')return {ok:true,available:true};
   throw Error('UNEXPECTED_NATIVE_'+req.action);
  }});
 t.after(()=>{ctl.close();fs.rmSync(root,{recursive:true,force:true});});
 return {ctl,ctx,calls,responses,get profile(){return profile;},
  begin:()=>ctl.execute(ctx,'browser_session_begin',{mode:'isolated',ttlSeconds:30}),
  end:lease=>ctl.execute(ctx,'browser_session_end',{lease}),
  expire:()=>{clock=30001;timer();}};
}

for(const response of [new Error('BROWSER_HELPER_TIMEOUT'),{ok:true,closed:false},{ok:false,closed:true},{closed:true}]){
 test('unconfirmed explicit end preserves ownership: '+(response instanceof Error?response.message:JSON.stringify(response)),async t=>{
  const f=fixture(t),{lease}=await f.begin();
  const marker=readBrowserLeaseMarker(f.profile);assert.ok(marker);
  f.responses.push(response);
  await assert.rejects(f.end(lease),/BROWSER_HELPER_TIMEOUT|BROWSER_SESSION_END_UNCONFIRMED/);
  assert.deepEqual(readBrowserLeaseMarker(f.profile),marker);
  assert.equal(f.ctl.readinessSnapshot(f.ctx).leased,true);
  assert.equal(f.ctl.readinessSnapshot(f.ctx).available,false);
  await assert.rejects(f.begin(),/BROWSER_LEASE_BUSY/);
  for(const [name,args] of [['browser_snapshot',{}],['browser_session_renew',{ttlSeconds:60}],['browser_foreground_end',{}],['browser_navigate',{url:'https://example.invalid/'}]]){
   await assert.rejects(f.ctl.execute(f.ctx,name,{lease,...args}),/BROWSER_SESSION_END_UNCONFIRMED/);
  }
  await assert.rejects(f.end('f'.repeat(48)),/BROWSER_LEASE_REQUIRED_OR_EXPIRED/);
  assert.deepEqual(f.calls,['start','end']);
  assert.deepEqual(await f.end(lease),{ok:true,closed:true});
  assert.equal(readBrowserLeaseMarker(f.profile),null);
  assert.equal(f.ctl.readinessSnapshot(f.ctx).leased,false);
  assert.deepEqual(f.calls,['start','end','end']);
 });
}
test('expiry while explicit end is pending does not authorize a new session or a stale lease',async t=>{
 const f=fixture(t),{lease}=await f.begin();const profile=f.profile;
 let finish;f.responses.push(()=>new Promise(resolve=>{finish=resolve;}),{ok:true,closed:false});
 const pending=f.end(lease);await new Promise(r=>setImmediate(r));f.expire();
 finish({ok:true,closed:false});
 await assert.rejects(pending,/BROWSER_SESSION_END_UNCONFIRMED/);
 assert.ok(readBrowserLeaseMarker(profile));
 assert.equal(f.ctl.readinessSnapshot(f.ctx).leased,false);
 await assert.rejects(f.end(lease),/BROWSER_LEASE_REQUIRED_OR_EXPIRED/);
 // The stale lease rejection may trigger owned cleanup only, never a new start.
 assert.equal(f.calls.filter(x=>x==='start').length,1);
 assert.equal(readBrowserLeaseMarker(profile),null);
 const next=await f.begin();assert.notEqual(next.lease,lease);
 await f.end(next.lease);
});
test('expiry cleanup is serialized and blocks new start until confirmed',async t=>{
 const f=fixture(t),{lease}=await f.begin();const profile=f.profile;
 let finish;f.responses.push(()=>new Promise(resolve=>{finish=resolve;}),{ok:true,closed:false});
 f.expire();await new Promise(r=>setImmediate(r));
 await assert.rejects(f.begin(),/BROWSER_BUSY/);
 finish({ok:true,closed:false});await new Promise(r=>setImmediate(r));
 assert.ok(readBrowserLeaseMarker(profile));
 await assert.rejects(f.begin(),/BROWSER_SESSION_END_UNCONFIRMED/);
 assert.ok(readBrowserLeaseMarker(profile));
 await assert.rejects(f.begin(),/BROWSER_SESSION_END_UNCONFIRMED/);
 assert.equal(readBrowserLeaseMarker(profile),null);
 assert.equal(f.calls.filter(x=>x==='start').length,1);
 const next=await f.begin();assert.notEqual(next.lease,lease);
 await f.end(next.lease);
});

test('confirmed end racing expiry releases exactly once',async t=>{
 const f=fixture(t),{lease}=await f.begin();const profile=f.profile;
 let finish;f.responses.push(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=f.end(lease);await new Promise(r=>setImmediate(r));f.expire();
 finish({ok:true,closed:true});
 assert.deepEqual(await pending,{ok:true,closed:true});
 assert.equal(readBrowserLeaseMarker(profile),null);
 assert.equal(f.ctl.readinessSnapshot(f.ctx).leased,false);
 assert.deepEqual(f.calls,['start','end']);
});

test('composed controller keeps Firefox routing and owned lease until cleanup confirmation',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-composed-end-'));
 const calls=[];let profile,ends=0;
 const client=name=>({close(){},async invoke(req){
  calls.push(name+':'+req.action);
  if(req.action==='start'){profile=req.profileDir;return {ok:true};}
  if(req.action==='status')return {ok:true,available:true};
  if(req.action==='end'){assert.equal(name,'firefox');return {ok:true,closed:++ends===2};}
  throw Error('UNEXPECTED_NATIVE_'+req.action);
 }});
 const router=createBrowserBackendRouter({chromiumClient:client('chromium'),firefoxClient:client('firefox')});
 const ctl=createBrowserController({invoke:router.invoke,closeInvoke:router.close});
 const ctx={config:{instance:{profile:'default'},powerMode:{enabled:true,browserControl:{enabled:true,profileRoot:root,executable:'firefox'}}}};
 t.after(()=>{ctl.close();fs.rmSync(root,{recursive:true,force:true});});
 const {lease}=await ctl.execute(ctx,'browser_session_begin',{mode:'isolated'});
 assert.ok(readBrowserLeaseMarker(profile));
 await assert.rejects(ctl.execute(ctx,'browser_session_end',{lease}),/BROWSER_SESSION_END_UNCONFIRMED/);
 assert.ok(readBrowserLeaseMarker(profile));
 await assert.rejects(ctl.execute(ctx,'browser_session_begin',{mode:'isolated'}),/BROWSER_LEASE_BUSY/);
 ctx.config.powerMode.browserControl.executable='chrome';
 await ctl.execute(ctx,'browser_status',{});
 assert.deepEqual(await ctl.execute(ctx,'browser_session_end',{lease}),{ok:true,closed:true});
 assert.equal(readBrowserLeaseMarker(profile),null);
 assert.deepEqual(calls,['firefox:start','firefox:end','chromium:status','firefox:end']);
});
