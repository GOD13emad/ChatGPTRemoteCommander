// OPT-IN Linux QA exercising *two different real native applications*.
// No browser, OS desktop takeover, real credentials or Core installation.
// Test-only app catalog and synthetic chat identity. Not a production grant.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createNativeX11ApplicationLauncher} from '../src/native-private-x11-app-worker.mjs';
import {createNativeWorkspaceCoordinator} from '../src/native-workspace-coordinator.mjs';
import {createNativeWorkspaceJournal} from '../src/native-workspace-journal.mjs';

const call=promisify(execFile);
const id=()=>randomBytes(32).toString('hex');
const digest=v=>createHash('sha256').update(v).digest('hex');
const noSocket=async n=>{
  for(const p of ['/tmp/.X11-unix/X'+n,'/tmp/.X'+n+'-lock']){
    try{await fs.lstat(p);return false;}
    catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return true;
};
const wait=async(fn,ms=6000)=>{
  const deadline=performance.now()+ms;
  while(performance.now()<deadline){
    if(await fn())return true;
    await new Promise(resolve=>setTimeout(resolve,125));
  }
  return false;
};
const identity=ctx=>ctx?.fixtureAuthorized===true?{
  authenticated:true,conversationBound:true,
  subject:ctx.subject,conversationId:ctx.conversationId
}:null;
const principal=(subject,conversationId)=>({fixtureAuthorized:true,subject,conversationId});
const ownerA=principal('test-owner','ui-only-dialog');
const ownerB=principal('test-owner','ui-only-clock');
const commands={
  xvfb:process.env.RC_QA_XVFB_BIN,
  xauth:'/usr/bin/xauth',xdpyinfo:'/usr/bin/xdpyinfo',
  xdotool:'/usr/bin/xdotool',ffmpeg:'/usr/bin/ffmpeg'
};
const opts={
  xvfbBin:commands.xvfb,xauthBin:commands.xauth,
  xdpyinfoBin:commands.xdpyinfo,xdotoolBin:commands.xdotool,
  ffmpegBin:commands.ffmpeg
};
const catalog={
  dialog:{
    executable:'/usr/bin/zenity',
    args:['--entry','--title=RC_GENERIC_NATIVE_DIALOG_A',
      '--text=Private native desktop test only','--width=380'],
    windowTitle:'RC_GENERIC_NATIVE_DIALOG_A'
  },
  clock:{
    executable:'/usr/bin/xclock',
    args:['-digital','-title','RC_GENERIC_NATIVE_CLOCK_B','-update','1'],
    windowTitle:'RC_GENERIC_NATIVE_CLOCK_B'
  }
};
const rawFrame=f=>{
  assert.equal(f.mimeType,'image/png');
  const bytes=Buffer.from(f.data,'base64');
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.ok(bytes.length>300);
  return bytes;
};

test('generic X11 launcher refuses unknown app names and untrusted application paths',
  ()=>{
    const conf={root:'/tmp/nonexistent-owned-qa',catalog, ...opts};
    assert.throws(()=>createNativeX11ApplicationLauncher({
      ...conf,catalog:{unsafe:{executable:'../shell',args:[],windowTitle:'unsafe'}}
    }),/CATALOG_INVALID/);
    const launcher=createNativeX11ApplicationLauncher(conf);
    assert.throws(()=>launcher.forApplication('../browser'),/APP_DENIED/);
    assert.deepEqual(launcher.status().configuredApps,['dialog','clock']);
    assert.equal(launcher.status().productionIntegrated,false);
  });

test('two native programs (Zenity/Clock) get isolated desktop, screenshot and mouse/keyboard',
  {skip:!process.env.RC_QA_XVFB_BIN},async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-generic-native-gui-'));
    const journalRoot=path.join(root,'journal');
    await fs.mkdir(journalRoot,{mode:0o700});
    const journal=createNativeWorkspaceJournal({root:journalRoot});
    const launcher=createNativeX11ApplicationLauncher({
      root,catalog,...opts,displayStart:1900,displayEnd:1920
    });
    await launcher.preflight();
    const sessions=[];
    let seq=0;
    const coordinator=createNativeWorkspaceCoordinator({
      identityResolver:identity,
      capacity:2,
      durableJournalFactory:async()=>journal,
      launchWorkspace:async req=>{
        // Host-pinned selection in this TEST fixture only; no caller can send
        // an executable/path/argv through owner, chat or MCP input.
        const appId=seq++===0?'dialog':'clock';
        const worker=await launcher.forApplication(appId).launchWorkspace(req);
        sessions.push(worker);
        return worker;
      }
    });
    let a=null,b=null;
    try{
      [a,b]=await Promise.all([
        // Promise concurrency is deterministic because launchWorkspace is
        // called in open order after synchronous reservation.
        coordinator.open(ownerA),coordinator.open(ownerB)
      ]);
      // Native applications start concurrently and may report readiness in
      // either order. Bind assertions by trusted app identity, never array
      // completion order.
      sessions.sort((x,y)=>x.appId==='dialog'?-1:y.appId==='dialog'?1:0);
      assert.notEqual(a.workspaceRef,b.workspaceRef);
      assert.notEqual(sessions[0].serverPid,sessions[1].serverPid);
      assert.notEqual(sessions[0].displayId,sessions[1].displayId);
      assert.equal(sessions[0].appId,'dialog');
      assert.equal(sessions[1].appId,'clock');
      assert.equal(sessions[0].physicalDesktopInput,false);
      assert.equal(sessions[1].physicalDesktopInput,false);
      assert.equal(launcher.status().running,2);
      assert.equal(sessions[0].applicationPid!==sessions[1].applicationPid,true);
      // Wrong Xauthority must not inspect another private X server.
      await assert.rejects(call(commands.xdpyinfo,
        ['-display',sessions[0].displayId],{
          env:{PATH:'/usr/bin:/bin',DISPLAY:sessions[0].displayId,
          XAUTHORITY:path.join(root,'worker-'+b.workspaceRef,'authority')},
          timeout:1800
        }),/./);
      const [fa,fb]=await Promise.all([
        coordinator.observeOwner(ownerA,a.lease),
        coordinator.observeOwner(ownerB,b.lease)
      ]);
      const snapA=rawFrame(fa.frame),snapB=rawFrame(fb.frame);
      assert.notEqual(digest(snapA),digest(snapB),
        'two different real apps should produce distinct private frames');
      await assert.rejects(coordinator.inputOwner(ownerB,a.lease,
        {kind:'click',x:80,y:110},{expectedRevision:fa.revision,operationId:'stolen'}),
        /LEASE_DENIED/);
      // Exercise native desktop pointer movement and drag, with a separate
      // screen and no changes to the actual owner's cursor.
      const viewB=fb;
      await coordinator.inputOwner(ownerB,b.lease,{kind:'move',x:95,y:90},
        {expectedRevision:viewB.revision,operationId:'clock-move'});
      const b2=await coordinator.observeOwner(ownerB,b.lease);
      await coordinator.inputOwner(ownerB,b.lease,{
        kind:'drag',from:{x:90,y:95},to:{x:170,y:115},
        durationMs:175
      },{expectedRevision:b2.revision,operationId:'clock-drag'});
      const b3=await coordinator.observeOwner(ownerB,b.lease);
      await coordinator.inputOwner(ownerB,b.lease,{
        kind:'click',x:190,y:125,count:2
      },{expectedRevision:b3.revision,operationId:'clock-doubleclick'});
      const rightClickView=await coordinator.observeOwner(ownerB,b.lease);
      await coordinator.inputOwner(ownerB,b.lease,{
        kind:'click',x:235,y:125,button:3
      },{expectedRevision:rightClickView.revision,operationId:'clock-rightclick'});
      const scrollView=await coordinator.observeOwner(ownerB,b.lease);
      await coordinator.inputOwner(ownerB,b.lease,{
        kind:'scroll',delta:1
      },{expectedRevision:scrollView.revision,operationId:'clock-scroll'});
      const afterB=await coordinator.observeOwner(ownerB,b.lease);
      assert.equal(afterB.mayInput,true);
      assert.equal(sessions[1].inspection().applicationAlive,true);
      // Use the keyboard in a completely different native GTK dialog.
      await coordinator.inputOwner(ownerA,a.lease,{
        kind:'type',text:'RC_NATIVE_DESKTOP_QA_SUCCESS'
      },{expectedRevision:fa.revision,operationId:'dialog-enter'});
      const a2=await coordinator.observeOwner(ownerA,a.lease);
      await coordinator.inputOwner(ownerA,a.lease,{kind:'key',key:'Return'},
        {expectedRevision:a2.revision,operationId:'dialog-accept'});
      assert.equal(await wait(()=>!sessions[0].inspection().applicationAlive),true);
      const value=sessions[0].inspection();
      assert.equal(value.exitCode,0);
      assert.equal(value.capturedOutputSha256,
        digest(Buffer.from('RC_NATIVE_DESKTOP_QA_SUCCESS\n')),
        'real GUI text must equal expected synthetic test value');
      // No raw app/typed output, DISPLAY cookie or user browser data is
      // exposed from the worker's status to the coordinator.
      assert.equal(typeof value.capturedOutputSha256,'string');
      const receiptA=await journal.inspect(a.workspaceRef);
      const receiptB=await journal.inspect(b.workspaceRef);
      assert.equal(receiptA.recordPresent,true);
      assert.equal(receiptB.recordPresent,true);
      assert.equal(receiptA.releaseAuthorized,false);
      assert.equal(receiptB.releaseAuthorized,false);
    }finally{
      await coordinator.close();
      assert.equal(launcher.status().running,0);
      for(const worker of sessions) {
        assert.equal(await noSocket(Number(worker.displayId.slice(1))),true);
      }
      await fs.rm(root,{recursive:true,force:true});
    }
  });


test('abrupt launcher exit stops exact child Xvfb and native app, without owner GUI',
  {skip:!process.env.RC_QA_XVFB_BIN},async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-generic-parentcrash-'));
    const fixture=fileURLToPath(new URL('./fixture-native-generic-app-abrupt-exit.mjs',
      import.meta.url));
    const child=spawn(process.execPath,[fixture,root,process.env.RC_QA_XVFB_BIN],{
      cwd:root,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},
      stdio:['ignore','pipe','pipe'],shell:false
    });
    let stdout='',stderr='';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',data=>{
      if(stdout.length<4096)stdout+=String(data).slice(0,4096-stdout.length);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data',data=>{
      if(stderr.length<2000)stderr+=String(data).slice(0,2000-stderr.length);
    });
    let deadline=null;
    const outcome=await Promise.race([
      new Promise((resolve,reject)=>{
        child.once('error',reject);
        child.once('exit',(code,signal)=>resolve({code,signal}));
      }),
      new Promise((_,reject)=>{
        deadline=setTimeout(()=>reject(Error('QA_CRASH_CHILD_TIMEOUT')),15000);
      })
    ]).finally(()=>clearTimeout(deadline));
    assert.equal(outcome.code,79,'Fixture must bypass all ordinary teardown');
    assert.equal(outcome.signal,null);
    const receipt=JSON.parse(stdout);
    assert.match(receipt.display,/^:19[2-3][0-9]$/);
    assert.ok(Number.isInteger(receipt.appPid)&&receipt.appPid>2);
    assert.ok(Number.isInteger(receipt.serverPid)&&receipt.serverPid>2);
    const processLive=async pid=>{
      try{
        const text=await fs.readFile('/proc/'+pid+'/stat','utf8');
        const state=text.slice(text.lastIndexOf(') ')+2).charAt(0);
        return state!=='Z'&&state!=='X';
      }catch(e){if(e.code==='ENOENT')return false;throw e;}
    };
    const stopped=await wait(async()=>{
      const n=Number(receipt.display.slice(1));
      return await noSocket(n)&&
        !(await processLive(receipt.serverPid))&&
        !(await processLive(receipt.appPid));
    },8500);
    assert.equal(stopped,true,
      'PR_SET_PDEATHSIG must stop both test-owned processes and the X socket');
    await fs.rm(root,{recursive:true,force:true});
  });
