import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const fakeRoot=fs.mkdtempSync(path.join(os.tmpdir(),'rc-browser-pool-mocks-'));
after(()=>fs.rmSync(fakeRoot,{recursive:true,force:true}));
import {createBrowserController,createIsolatedBrowserPool} from '../src/browser-tools.mjs';

const config=profile=>({config:{
 instance:{profile},
 powerMode:{enabled:true,browserControl:{
  enabled:true,allowNavigate:true,allowInput:true,allowScreenshot:true,
  allowForegroundFallback:true,foregroundFallback:'explicit-current-request-only',
  profileRoot:fakeRoot
 }}
}});
function fixture({maxWorkers=2,clock=()=>1000}={}){
 const inputs=[],created=[],closed=[];
 const pool=createIsolatedBrowserPool({
  maxWorkers,clock,
  makeWorker:()=>{
   const index=created.length;
   let releaseStart=null;
   const invoke=async req=>{
    inputs.push({index,action:req.action,request:req});
    if(req.action==='start')return {ok:true,background:true};
    if(req.action==='status')return {ok:true,available:true};
    if(req.action==='snapshot')return {ok:true,url:'https://example.test/'+index,
     title:'Agent '+index,text:'WORKER_'+index,elements:[]};
    if(req.action==='end')return {ok:true,closed:true};
    if(req.action==='navigate')return {ok:true,url:req.url};
    if(req.action==='fill')return {ok:true,filled:true};
    if(req.action==='click')return {ok:true,clicked:true};
    if(req.action==='wait')return {ok:true,matched:true};
    throw Error('UNEXPECTED_ACTION '+req.action);
   };
   const ctl=createBrowserController({
    invoke,closeInvoke:()=>{closed.push(index);},
    token:()=>String(index).padStart(48,'a'),now:clock,wallNow:clock,
    // A fake timer that cannot fire while tests are running.
    scheduleTimeout:()=>({unref(){}}),cancelTimeout:()=>{}
   });
   created.push(index);
   return {controller:ctl,close:async()=>{closed.push(index);}};
  }
 });
 return {pool,inputs,created,closed};
}
test('concurrent isolated browser leases are independent and cannot see other profiles',async()=>{
 const f=fixture(),A=config('alpha'),B=config('beta');
 try{
  const [a,b]=await Promise.all([
   f.pool.execute(A,'browser_session_begin',{mode:'isolated'}),
   f.pool.execute(B,'browser_session_begin',{mode:'isolated'})
  ]);
  assert.notEqual(a.lease,b.lease);
  assert.equal(a.physicalDesktopInput,false);
  assert.equal(a.workerIsolation,'PRIVATE_BROWSER_PROCESS');
  assert.equal(b.workerIsolation,'PRIVATE_BROWSER_PROCESS');
  assert.equal(f.pool.count('alpha'),1);
  assert.equal(f.pool.count('beta'),1);
  assert.equal(f.pool.count('other'),0);
  assert.equal(f.created.length,2);
  const [x,y]=await Promise.all([
   f.pool.execute(A,'browser_snapshot',{lease:a.lease}),
   f.pool.execute(B,'browser_snapshot',{lease:b.lease})
  ]);
  assert.equal(x.text,'WORKER_0');
  assert.equal(y.text,'WORKER_1');
  await assert.rejects(f.pool.execute(B,'browser_snapshot',{lease:a.lease}),
   /BROWSER_LEASE_REQUIRED_OR_EXPIRED/);
  const status=await f.pool.execute(A,'browser_status');
  assert.equal(status.isolatedWorkersActive,1);
  assert.equal(status.userDesktopTouched,false);
  await f.pool.execute(A,'browser_session_end',{lease:a.lease});
  assert.equal(f.pool.count('alpha'),0);
  await f.pool.execute(B,'browser_session_end',{lease:b.lease});
  assert.equal(f.pool.count('beta'),0);
 }finally{await f.pool.close();}
});
test('a third browser is rejected rather than blocking existing unrelated workers',async()=>{
 const f=fixture(),ctx=config('same');
 try{
  const [a,b]=await Promise.all([
   f.pool.execute(ctx,'browser_session_begin',{mode:'isolated'}),
   f.pool.execute(ctx,'browser_session_begin',{mode:'isolated'})
  ]);
  await assert.rejects(f.pool.execute(ctx,'browser_session_begin',{mode:'isolated'}),
   /BROWSER_ISOLATED_CAPACITY/);
  const [x,y]=await Promise.all([
   f.pool.execute(ctx,'browser_snapshot',{lease:a.lease}),
   f.pool.execute(ctx,'browser_snapshot',{lease:b.lease})
  ]);
  assert.notEqual(x.text,y.text);
  await f.pool.execute(ctx,'browser_session_end',{lease:a.lease});
  await f.pool.execute(ctx,'browser_session_end',{lease:b.lease});
 }finally{await f.pool.close();}
});
test('isolation denies foreground fallback even when legacy config permits it',async()=>{
 const f=fixture(),ctx=config('alpha');
 try{
  const a=await f.pool.execute(ctx,'browser_session_begin',{mode:'isolated'});
  await assert.rejects(f.pool.execute(ctx,'browser_foreground_begin',{
   lease:a.lease,explicitUserAuthorization:'Direct operator permission'
  }),/BROWSER_ISOLATED_FOREGROUND_DENIED/);
  const view=await f.pool.execute(ctx,'browser_foreground_requirement',{
   lease:a.lease,reason:'mfa'
  });
  assert.equal(view.desktopTakenOver,false);
  assert.equal(view.viewerHandoffRequired,true);
  assert.equal(f.inputs.filter(x=>x.action==='relaunch').length,0);
 }finally{await f.pool.close();}
});
test('legacy persistent mode and disabled policies cannot create private workers',async()=>{
 const f=fixture();
 try{
  await assert.rejects(f.pool.execute(config('alpha'),'browser_session_begin',{mode:'persistent'}),
   /BROWSER_ISOLATED_MODE_REQUIRED/);
  const bad=config('alpha');bad.config.powerMode.enabled=false;
  await assert.rejects(f.pool.execute(bad,'browser_session_begin',{mode:'isolated'}),
   /BROWSER_DISABLED/);
  assert.equal(f.created.length,0);
 }finally{await f.pool.close();}
});
test('expired isolated lease cannot be reused and only its owned helper is reaped',async()=>{
 let now=1000;const f=fixture({clock:()=>now});
 const ctx=config('alpha');
 try{
  const a=await f.pool.execute(ctx,'browser_session_begin',{mode:'isolated',ttlSeconds:30});
  now+=35000;
  await assert.rejects(f.pool.execute(ctx,'browser_snapshot',{lease:a.lease}),
   /BROWSER_LEASE_REQUIRED_OR_EXPIRED/);
  assert.equal(f.pool.count('alpha'),0);
  assert.equal(f.closed.length>=1,true);
 }finally{await f.pool.close();}
});

test('revoked input permission is enforced on a running private worker immediately',async()=>{
 const f=fixture(),ctx=config('alpha');
 try{
  const a=await f.pool.execute(ctx,'browser_session_begin',{mode:'isolated'});
  ctx.config.powerMode.browserControl.allowInput=false;
  await assert.rejects(f.pool.execute(ctx,'browser_fill',{
   lease:a.lease,selector:'#worker',text:'NEVER_SENT'
  }),/BROWSER_INPUT_DISABLED/);
  assert.equal(f.inputs.filter(x=>x.action==='fill').length,0);
  assert.equal((await f.pool.execute(ctx,'browser_snapshot',{lease:a.lease})).text,'WORKER_0');
  ctx.config.powerMode.browserControl.enabled=false;
  await assert.rejects(f.pool.execute(ctx,'browser_navigate',{
   lease:a.lease,url:'https://example.test/'
  }),/BROWSER_DISABLED/);
 }finally{await f.pool.close();}
});

function deferred(){
 let resolve,reject;
 const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
 return {promise,resolve,reject};
}
test('closing pool during a pending start cannot create an orphan helper',async()=>{
 const started=deferred(),releaseStart=deferred();
 let nativeCloses=0,helperCloses=0;
 const pool=createIsolatedBrowserPool({maxWorkers:1,makeWorker:()=>({
  controller:{
   execute:async(_ctx,name)=>{
    if(name!=='browser_session_begin')throw Error('UNEXPECTED_'+name);
    started.resolve();
    await releaseStart.promise;
    return {ok:true,lease:'a'.repeat(48),headless:true,background:true};
   },
   close:async()=>{nativeCloses++;}
  },
  close:async()=>{helperCloses++;}
 })});
 const ctx=config('race-close');
 const opening=pool.execute(ctx,'browser_session_begin',{mode:'isolated'});
 await started.promise;
 const shuttingDown=pool.close();
 releaseStart.resolve();
 await assert.rejects(opening,/BROWSER_POOL_CLOSED/);
 await shuttingDown;
 assert.equal(nativeCloses,1);
 assert.equal(helperCloses,1);
 assert.equal(pool.count('race-close'),0);
 await assert.rejects(pool.execute(ctx,'browser_session_begin',{mode:'isolated'}),
  /BROWSER_POOL_CLOSED/);
});
test('busy browser_session_end cannot destroy an in-flight private action',async()=>{
 const started=deferred(),releaseAction=deferred();
 let nativeCloses=0,helperCloses=0;
 const ctl=createBrowserController({
  invoke:async request=>{
   if(request.action==='start')return {ok:true,headless:true};
   if(request.action==='click'){
    started.resolve();
    await releaseAction.promise;
    return {ok:true,clicked:true};
   }
   if(request.action==='snapshot')return {ok:true,title:'still-owned',
     text:'Private worker remains open',url:'https://example.test',elements:[]};
   if(request.action==='end')return {ok:true,closed:true};
   throw Error('UNEXPECTED_'+request.action);
  },
  closeInvoke:()=>{nativeCloses++;},
  token:()=> 'b'.repeat(48),now:()=>1000,wallNow:()=>1000,
  scheduleTimeout:()=>({unref(){}}),cancelTimeout:()=>{}
 });
 const pool=createIsolatedBrowserPool({maxWorkers:1,makeWorker:()=>({
  controller:ctl,close:async()=>{helperCloses++;}
 })});
 const ctx=config('alpha');
 try{
  const lease=(await pool.execute(ctx,'browser_session_begin',{mode:'isolated'})).lease;
  const action=pool.execute(ctx,'browser_click',{lease,selector:'#button'});
  await started.promise;
  await assert.rejects(pool.execute(ctx,'browser_session_end',{lease}),/BROWSER_BUSY/);
  assert.equal(pool.hasLease(lease),true);
  assert.equal(nativeCloses,0);
  assert.equal(helperCloses,0);
  releaseAction.resolve();
  const applied=await action;
  assert.equal(applied.clicked,true);
  const observed=await pool.execute(ctx,'browser_snapshot',{lease});
  assert.match(observed.text,/remains open/);
  await pool.execute(ctx,'browser_session_end',{lease});
  assert.equal(pool.hasLease(lease),false);
  assert.equal(helperCloses,1);
 }finally{
  releaseAction.resolve();
  await pool.close();
 }
});
test('Core close awaits an active workspace and does not lose its accepted result',async()=>{
 const accepted=deferred(),finish=deferred();
 let helperClosed=false;
 const ctl=createBrowserController({
  invoke:async req=>{
   if(req.action==='start')return {ok:true};
   if(req.action==='click'){
    accepted.resolve();
    await finish.promise;
    return {ok:true,clicked:true};
   }
   if(req.action==='end')return {ok:true,closed:true};
   throw Error('UNEXPECTED_'+req.action);
  },
  closeInvoke:()=>{},token:()=> 'c'.repeat(48),now:()=>1000,wallNow:()=>1000,
  scheduleTimeout:()=>({unref(){}}),cancelTimeout:()=>{}
 });
 const pool=createIsolatedBrowserPool({maxWorkers:1,makeWorker:()=>({
  controller:ctl,close:async()=>{helperClosed=true;}
 })});
 const ctx=config('alpha');
 const lease=(await pool.execute(ctx,'browser_session_begin',{mode:'isolated'})).lease;
 const action=pool.execute(ctx,'browser_click',{lease,selector:'#button'});
 await accepted.promise;
 const shutdown=pool.close();
 await Promise.resolve();
 assert.equal(helperClosed,false,'Active worker cannot be killed by a global shutdown race');
 finish.resolve();
 assert.equal((await action).clicked,true);
 await shutdown;
 assert.equal(helperClosed,true);
 assert.equal(pool.hasLease(lease),false);
});

test('lease expiration during an accepted action reaps only that worker after completion',async()=>{
 let time=1000,created=0;
 const clickEntered=deferred(),finishClick=deferred();
 const disposed=[];
 const pool=createIsolatedBrowserPool({maxWorkers:2,clock:()=>time,
  makeWorker:()=>{
   const i=created++;
   const controller=createBrowserController({
    invoke:async req=>{
     if(req.action==='start')return {ok:true};
     if(req.action==='click'&&i===0){
      clickEntered.resolve();await finishClick.promise;return {ok:true,clicked:true};
     }
     if(req.action==='snapshot')return {ok:true,text:'WORKER_'+i,
      url:'https://example.test',title:'private',elements:[]};
     if(req.action==='end')return {ok:true,closed:true};
     throw Error('UNEXPECTED_'+req.action);
    },
    closeInvoke:()=>{},
    token:()=>String(i).padStart(48,'a'),
    now:()=>time,wallNow:()=>time,
    scheduleTimeout:()=>({unref(){}}),cancelTimeout:()=>{}
   });
   return {controller,close:async()=>{disposed.push(i);}};
  }
 });
 const ctx=config('shared');
 try{
  const first=await pool.execute(ctx,'browser_session_begin',{mode:'isolated',ttlSeconds:30});
  const active=pool.execute(ctx,'browser_click',{lease:first.lease,selector:'#button'});
  await clickEntered.promise;
  time+=31000;
  const second=await pool.execute(ctx,'browser_session_begin',{mode:'isolated',ttlSeconds:30});
  assert.equal(disposed.includes(0),false,'Never reap an in-flight older worker');
  const observed=await pool.execute(ctx,'browser_snapshot',{lease:second.lease});
  assert.equal(observed.text,'WORKER_1');
  finishClick.resolve();
  assert.equal((await active).clicked,true);
  assert.ok(disposed.includes(0),'Expired original worker reaped after its last action');
  assert.equal(pool.hasLease(second.lease),true,'Unrelated newer worker remains active');
  await pool.execute(ctx,'browser_session_end',{lease:second.lease});
 }finally{finishClick.resolve();await pool.close();}
});
test('failed worker teardown surfaces a cleanup failure rather than a false success',async()=>{
 const ctx=config('alpha');
 const pool=createIsolatedBrowserPool({maxWorkers:1,makeWorker:()=>({
  controller:{
   execute:async(_ctx,name)=>name==='browser_session_begin'
    ? {lease:'x'.repeat(48),ok:true} : {ok:true},
   close:async()=>{}
  },
  close:async()=>{throw Error('DISPOSAL_FAILURE_FIXTURE');}
 })});
 await pool.execute(ctx,'browser_session_begin',{mode:'isolated'});
 await assert.rejects(pool.close(),/BROWSER_POOL_CLEANUP_FAILED/);
 assert.equal(pool.count('alpha'),0);
});

function observerFixture({authorizeObserverRead=()=>true,authorizeObserverGrant=()=>true,
 authorizeControlHandoff=()=>false,clock=()=>1000}={}){
 let sequence=0,workerSerial=0;
 const nativeActions=[],closures=[];
 const pool=createIsolatedBrowserPool({
  maxWorkers:2,clock,authorizeObserverGrant,authorizeObserverRead,authorizeControlHandoff,
  observerToken:()=> (++sequence).toString(16).padStart(64,'0'),
  makeWorker:()=>{
   const workerId=++workerSerial;
   const invoke=async req=>{
    nativeActions.push(req.action);
    if(req.action==='start')return {ok:true,background:true};
    if(req.action==='screenshot')return {
     ok:true,data:Buffer.from('89504e470d0a1a0a','hex').toString('base64'),
     mimeType:'image/png',bytes:8
    };
    if(req.action==='click')return {ok:true,clicked:true};
    if(req.action==='snapshot')return {ok:true,title:'Internal only',
     text:'Agent data',elements:[],url:'https://example.test'};
    if(req.action==='end')return {ok:true,closed:true};
    throw Error('UNEXPECTED_'+req.action);
   };
   const ctl=createBrowserController({
    invoke,closeInvoke:()=>{closures.push('controller');},
    token:()=>workerId.toString(16).padStart(48,'c'),now:clock,wallNow:clock,
    scheduleTimeout:()=>({unref(){}}),cancelTimeout:()=>{}
   });
   return {controller:ctl,close:async()=>{closures.push('native');}};
  }
 });
 return {pool,nativeActions,closures};
}
test('observer grants cannot be issued without trusted management authorization',async()=>{
 const f=observerFixture({authorizeObserverGrant:()=>false});
 const owner=config('owner');
 try{
  const a=await f.pool.execute(owner,'browser_session_begin',{mode:'isolated'});
  await assert.rejects(f.pool.grantObserver(owner,a.lease,{viewerProfile:'auditor'}),
   /BROWSER_OBSERVER_FORBIDDEN/);
  assert.equal(f.nativeActions.filter(a=>a==='screenshot').length,0);
 }finally{await f.pool.close();}
});
test('authorized observers see the last private frame without calling the GUI helper',async()=>{
 const f=observerFixture(),owner=config('owner'),auditor=config('auditor');
 try{
  const lease=(await f.pool.execute(owner,'browser_session_begin',{mode:'isolated'})).lease;
  const a=await f.pool.grantObserver(owner,lease,{viewerProfile:'auditor'});
  const b=await f.pool.grantObserver(owner,lease,{viewerProfile:'auditor'});
  assert.notEqual(a.observerToken,b.observerToken);
  assert.equal(a.nativeInputAuthorized,false);
  await assert.rejects(Promise.resolve().then(()=>f.pool.readObserver(auditor,a.observerToken)),
   /BROWSER_OBSERVER_FRAME_NOT_READY/);
  await f.pool.execute(owner,'browser_screenshot',{lease,format:'png',maxBytes:262144});
  const before=f.nativeActions.length;
  const frameA=f.pool.readObserver(auditor,a.observerToken);
  const frameB=f.pool.readObserver(auditor,b.observerToken);
  assert.equal(frameA.__mcpContent[0].type,'image');
  assert.equal(frameA.__mcpContent[0].mimeType,'image/png');
  assert.equal(frameA.__structuredContent.controlAuthorized,false);
  assert.equal(frameA.__structuredContent.observerReadOnly,true);
  assert.equal(frameA.__structuredContent.physicalDesktopAccess,false);
  assert.deepEqual(frameA.__mcpContent[0],frameB.__mcpContent[0]);
  assert.equal(f.nativeActions.length,before,'Observer reads do not dispatch helper operations');
  assert.equal(frameB.__structuredContent.stale,false);
  await f.pool.execute(owner,'browser_click',{lease,selector:'#change'});
  assert.equal(f.pool.readObserver(auditor,a.observerToken).__structuredContent.stale,true);
  assert.equal(f.nativeActions.length,before+1,'The only new native action was the owner click');
  assert.deepEqual(f.pool.revokeObserver(owner,lease,a.observerToken),
   {revoked:true,nativeInputAuthorized:false});
  assert.throws(()=>f.pool.readObserver(auditor,a.observerToken),/BROWSER_OBSERVER_DENIED/);
  assert.equal(f.pool.readObserver(auditor,b.observerToken).__structuredContent.observerReadOnly,true);
  await f.pool.execute(owner,'browser_session_end',{lease});
  assert.throws(()=>f.pool.readObserver(auditor,b.observerToken),/BROWSER_OBSERVER_DENIED/);
 }finally{await f.pool.close();}
});
test('viewer principal scope, viewer permission revocation and grant TTL all deny access',async()=>{
 let now=1000;const f=observerFixture({clock:()=>now});
 const owner=config('owner'),viewer=config('viewer'),other=config('other');
 try{
  const lease=(await f.pool.execute(owner,'browser_session_begin',{mode:'isolated'})).lease;
  const grant=await f.pool.grantObserver(owner,lease,{viewerProfile:'viewer',ttlSeconds:10});
  await f.pool.execute(owner,'browser_screenshot',{lease,format:'png',maxBytes:262144});
  assert.throws(()=>f.pool.readObserver(other,grant.observerToken),/BROWSER_OBSERVER_DENIED/);
  viewer.config.powerMode.browserControl.allowScreenshot=false;
  assert.throws(()=>f.pool.readObserver(viewer,grant.observerToken),/BROWSER_OBSERVER_DENIED/);
  viewer.config.powerMode.browserControl.allowScreenshot=true;
  assert.equal(f.pool.readObserver(viewer,grant.observerToken).__structuredContent.observerReadOnly,true);
  now+=11000;
  assert.throws(()=>f.pool.readObserver(viewer,grant.observerToken),/BROWSER_OBSERVER_DENIED/);
  assert.equal(f.pool.hasLease(lease),true,'Observer expiry cannot stop agent');
 }finally{await f.pool.close();}
});
test('observer authorizer fails closed on an exception and grant limits stay bounded',async()=>{
 const owner=config('owner');
 const errorFixture=observerFixture({authorizeObserverGrant:()=>{throw Error('DO_NOT_EXPOSE');}});
 try{
  const id=(await errorFixture.pool.execute(owner,'browser_session_begin',{mode:'isolated'})).lease;
  await assert.rejects(errorFixture.pool.grantObserver(owner,id,{viewerProfile:'auditor'}),
   /BROWSER_OBSERVER_FORBIDDEN/);
 }finally{await errorFixture.pool.close();}
 const f=observerFixture({authorizeObserverGrant:()=>true});
 try{
  const id=(await f.pool.execute(owner,'browser_session_begin',{mode:'isolated'})).lease;
  for(let i=0;i<4;i++)await f.pool.grantObserver(owner,id,{viewerProfile:'auditor'});
  await assert.rejects(f.pool.grantObserver(owner,id,{viewerProfile:'auditor'}),
   /BROWSER_OBSERVER_CAPACITY/);
 }finally{await f.pool.close();}
});

test('workspace handoff coordinates the human only on the selected private page',async()=>{
 const f=observerFixture({authorizeControlHandoff:({ownerProfile,operatorProfile})=>
  ownerProfile==='alpha'&&operatorProfile==='supervisor'});
 const alpha=config('alpha'),beta=config('beta'),human=config('supervisor');
 try{
  const a=await f.pool.execute(alpha,'browser_session_begin',{mode:'isolated'});
  const b=await f.pool.execute(beta,'browser_session_begin',{mode:'isolated'});
  const handoff=await f.pool.beginControlHandoff(alpha,a.lease,{
   operatorProfile:'supervisor',ttlSeconds:45
  });
  assert.equal(handoff.physicalDesktopAccess,false);
  await assert.rejects(f.pool.execute(alpha,'browser_click',{lease:a.lease,selector:'#a'}),
   /BROWSER_WORKSPACE_CONTROL_HELD/);
  assert.equal((await f.pool.execute(beta,'browser_click',{lease:b.lease,selector:'#b'})).clicked,true,
   'Other agents keep working');
  const operated=await f.pool.controlAction(human,handoff.controlToken,
   'browser_click',{selector:'#a',lease:b.lease});
  assert.equal(operated.clicked,true);
  assert.equal(operated.privateWorkspaceOnly,true);
  assert.equal(operated.physicalDesktopAccess,false);
  await assert.rejects(f.pool.controlAction(config('attacker'),handoff.controlToken,
   'browser_click',{selector:'#a'}),/BROWSER_WORKSPACE_OPERATOR_DENIED/);
  await assert.rejects(f.pool.controlAction(human,handoff.controlToken,
   'browser_navigate',{url:'https://example.test'}),/BROWSER_WORKSPACE_OPERATOR_ACTION_DENIED/);
  assert.equal(f.pool.endControlHandoff(human,handoff.controlToken).ownerReobserveRequired,true);
  await assert.rejects(f.pool.execute(alpha,'browser_click',{lease:a.lease,selector:'#a'}),
   /BROWSER_WORKSPACE_REOBSERVATION_REQUIRED/);
  const inspected=await f.pool.execute(alpha,'browser_snapshot',{lease:a.lease});
  assert.equal(inspected.text,'Agent data');
  assert.equal((await f.pool.execute(alpha,'browser_click',{lease:a.lease,selector:'#a'})).clicked,true);
  await f.pool.execute(alpha,'browser_session_end',{lease:a.lease});
  await f.pool.execute(beta,'browser_session_end',{lease:b.lease});
 }finally{await f.pool.close();}
});
test('an untrusted handoff and action-level permission revocation fail closed',async()=>{
 const denied=observerFixture(),ctx=config('alpha');
 try{
  const a=await denied.pool.execute(ctx,'browser_session_begin',{mode:'isolated'});
  await assert.rejects(denied.pool.beginControlHandoff(ctx,a.lease,{
   operatorProfile:'supervisor'
  }),/BROWSER_WORKSPACE_OPERATOR_FORBIDDEN/);
 }finally{await denied.pool.close();}
 const f=observerFixture({authorizeControlHandoff:()=>true});
 const owner=config('alpha'),operator=config('supervisor');
 try{
  const a=await f.pool.execute(owner,'browser_session_begin',{mode:'isolated'});
  const handoff=await f.pool.beginControlHandoff(owner,a.lease,{operatorProfile:'supervisor'});
  operator.config.powerMode.browserControl.allowInput=false;
  await assert.rejects(f.pool.controlAction(operator,handoff.controlToken,
   'browser_fill',{selector:'#a',text:'NEVER'}),/BROWSER_WORKSPACE_OPERATOR_DENIED/);
  assert.equal(f.nativeActions.filter(x=>x==='fill').length,0);
  assert.equal(f.pool.revokeControlHandoff(owner,a.lease).revoked,true);
  assert.equal(f.pool.revokeControlHandoff(owner,a.lease).revoked,false);
  await assert.rejects(f.pool.controlAction(operator,handoff.controlToken,
   'browser_click',{selector:'#a'}),/BROWSER_WORKSPACE_OPERATOR_DENIED/);
  await assert.rejects(f.pool.execute(owner,'browser_click',{lease:a.lease,selector:'#a'}),
   /BROWSER_WORKSPACE_REOBSERVATION_REQUIRED/);
 }finally{await f.pool.close();}
});
test('expired handoff resumes the owner only after a fresh snapshot',async()=>{
 let now=1000;
 const f=observerFixture({authorizeControlHandoff:()=>true,clock:()=>now});
 const owner=config('owner'),operator=config('operator');
 try{
  const a=await f.pool.execute(owner,'browser_session_begin',{mode:'isolated',ttlSeconds:60});
  const token=(await f.pool.beginControlHandoff(owner,a.lease,
   {operatorProfile:'operator',ttlSeconds:10})).controlToken;
  now+=11000;
  await assert.rejects(f.pool.controlAction(operator,token,'browser_click',{selector:'#x'}),
   /BROWSER_WORKSPACE_OPERATOR_DENIED/);
  await assert.rejects(f.pool.execute(owner,'browser_click',{lease:a.lease,selector:'#x'}),
   /BROWSER_WORKSPACE_REOBSERVATION_REQUIRED/);
  await f.pool.execute(owner,'browser_snapshot',{lease:a.lease});
  assert.equal((await f.pool.execute(owner,'browser_click',{lease:a.lease,selector:'#x'})).clicked,true);
 }finally{await f.pool.close();}
});
test('owner screenshot authorization revocation invalidates a preexisting observer image grant',async()=>{
 const f=observerFixture();
 const owner=config('owner'),viewer=config('viewer');
 try{
  const lease=(await f.pool.execute(owner,'browser_session_begin',{mode:'isolated'})).lease;
  const granted=await f.pool.grantObserver(owner,lease,{viewerProfile:'viewer'});
  await f.pool.execute(owner,'browser_screenshot',{lease,format:'png',maxBytes:262144});
  assert.equal(f.pool.readObserver(viewer,granted.observerToken).__structuredContent.observerReadOnly,true);
  owner.config.powerMode.browserControl.allowScreenshot=false;
  assert.throws(()=>f.pool.readObserver(viewer,granted.observerToken),/BROWSER_OBSERVER_DENIED/,
   'Previously granted observers must no longer read cached private frames after owner revokes screenshot permission');
 }finally{await f.pool.close();}
});
test('read authorization revocation invalidates cached observer token immediately',async()=>{
 let allow=true;const f=observerFixture({authorizeObserverRead:()=>allow});
 const owner=config('owner'),viewer=config('viewer');
 try{
  const lease=(await f.pool.execute(owner,'browser_session_begin',{mode:'isolated'})).lease;
  const g=await f.pool.grantObserver(owner,lease,{viewerProfile:'viewer'});
  await f.pool.execute(owner,'browser_screenshot',{lease,format:'png',maxBytes:262144});
  assert.equal(f.pool.readObserver(viewer,g.observerToken).__structuredContent.observerReadOnly,true);
  allow=false;
  assert.throws(()=>f.pool.readObserver(viewer,g.observerToken),/BROWSER_OBSERVER_DENIED/);
  allow=true;
  assert.throws(()=>f.pool.readObserver(viewer,g.observerToken),/BROWSER_OBSERVER_DENIED/);
 }finally{await f.pool.close();}
});
test('read verifier exceptions deny access without disclosing frame',async()=>{
 const f=observerFixture({authorizeObserverRead:()=>{throw Error('PRIVATE_AUTH_ERROR');}});
 const owner=config('owner'),viewer=config('viewer');
 try{
  const lease=(await f.pool.execute(owner,'browser_session_begin',{mode:'isolated'})).lease;
  const g=await f.pool.grantObserver(owner,lease,{viewerProfile:'viewer'});
  await f.pool.execute(owner,'browser_screenshot',{lease,format:'png',maxBytes:262144});
  assert.throws(()=>f.pool.readObserver(viewer,g.observerToken),/BROWSER_OBSERVER_DENIED/);
 }finally{await f.pool.close();}
});
test('a prior grant without a read-time authorizer does not allow private frame reads',async()=>{
 const ctx=config('owner'),viewer=config('viewer');
 const pool=createIsolatedBrowserPool({authorizeObserverGrant:()=>true,makeWorker:()=>({
  controller:{execute:async(_ctx,name)=>name==='browser_session_begin'?{lease:'f'.repeat(48),ok:true}:{ok:true},close:async()=>{}},
  close:async()=>{}
 })});
 try{
  const lease=(await pool.execute(ctx,'browser_session_begin',{mode:'isolated'})).lease;
  const g=await pool.grantObserver(ctx,lease,{viewerProfile:'viewer'});
  assert.throws(()=>pool.readObserver(viewer,g.observerToken),/BROWSER_OBSERVER_DENIED/);
 }finally{await pool.close();}
});