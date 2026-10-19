// OPT-IN real X11 QA. No installed Commander Core or physical GUI is touched.
// Requires an explicitly selected, user-local Xvfb binary. NEVER target :0,
// an inherited DISPLAY, or an OS session not created by this fixture.
// Hosted CI without RC_QA_XVFB_BIN reports SKIP, never a fabricated PASS.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {access,mkdir,mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomBytes} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createNativeWorkspaceCoordinator} from '../src/native-workspace-coordinator.mjs';

const exec=promisify(execFile);
const script=path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  'gui-private-x11-isolation-qa.py');
const ensurePrivate=async root=>{
  const s=await stat(root);
  assert.equal(s.mode & 0o077,0,'private QA root must be owner-only');
};
const context=(subject,conversationId)=>({
  fixtureAuthenticated:true,subject,conversationId
});
const identity=ctx=>ctx?.fixtureAuthenticated===true
  ? {authenticated:true,conversationBound:true,
     subject:ctx.subject,conversationId:ctx.conversationId}
  : null; // ONLY a synthetic test resolver, not ChatGPT identity authentication.
const ownerA=context('same-os-profile','private-chat-a');
const ownerB=context('same-os-profile','private-chat-b');
const reviewer=context('supervisor','reviewer-session');
const observer=context('auditor','read-only-session');
const readOwned=async filename=>JSON.parse(await readFile(filename,'utf8'));
const statIfExists=async filename=>{try{await stat(filename);return true;}catch{return false;}};
const commands={
  xauth:'/usr/bin/xauth',xdpyinfo:'/usr/bin/xdpyinfo',
  xdotool:'/usr/bin/xdotool',ffmpeg:'/usr/bin/ffmpeg'
};
async function call(bin,args,env,{timeout=6000,maxBuffer=4*1024*1024}={}){
  const {stdout}=await exec(bin,args,{env,timeout,encoding:'buffer',
    windowsHide:true,maxBuffer});
  return Buffer.isBuffer(stdout)?stdout:Buffer.from(stdout);
}
async function ready(predicate,{maxMs=6000,label}){
  const deadline=performance.now()+maxMs;
  while(performance.now()<deadline){
    if(await predicate())return true;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('NATIVE_QA_NOT_READY_'+label);
}
const alive=p=>p&&p.exitCode===null&&p.signalCode===null;
async function stopChild(child){
  if(!alive(child))return;
  const closed=new Promise(resolve=>child.once('exit',resolve));
  child.kill('SIGTERM');
  const graceful=await Promise.race([
    closed.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),1800))
  ]);
  if(!graceful&&alive(child)){
    child.kill('SIGKILL'); // Exact test-owned child only.
    await Promise.race([
      closed,new Promise((_,reject)=>setTimeout(()=>reject(
        new Error('OWNED_QA_CHILD_STILL_RUNNING')),2200))
    ]);
  }
}
async function createPrivateWorker(label,root,xvfb,reserved){
  const ws=path.join(root,'worker-'+label.toLowerCase());
  await mkdir(ws,{mode:0o700});
  await ensurePrivate(ws);
  const auth=path.join(ws,'authority');
  const receipt=path.join(ws,'synthetic-input.json');
  const env={
    PATH:'/usr/bin:/bin',HOME:ws,LANG:'C.UTF-8',
    GDK_BACKEND:'x11',WAYLAND_DISPLAY:'',
    XDG_CONFIG_HOME:path.join(ws,'config'),
    XDG_CACHE_HOME:path.join(ws,'cache'),
    XDG_DATA_HOME:path.join(ws,'data')
  };
  for(const key of ['config','cache','data'])
    await mkdir(env['XDG_'+key.toUpperCase()+'_HOME'],{mode:0o700});
  let display=null;
  for(let i=1700;i<1770;i++){
    const sock='/tmp/.X11-unix/X'+i,lock='/tmp/.X'+i+'-lock';
    if(reserved.has(i)||await statIfExists(sock)||await statIfExists(lock))continue;
    display=':'+i;
    reserved.add(i);
    break;
  }
  if(!display)throw new Error('NO_FREE_SYNTHETIC_X11_DISPLAY');
  if(display===process.env.DISPLAY)throw new Error('PHYSICAL_DISPLAY_COLLISION');
  const allEnv={...env,DISPLAY:display,XAUTHORITY:auth};
  let server=null,app=null,windowId=null,closed=false,snapshots=0;
  try{
    await call(commands.xauth,['-f',auth,'add',display,'.',
      randomBytes(16).toString('hex')],allEnv);
    assert.equal((await stat(auth)).mode&0o077,0);
    server=spawn(xvfb,[display,'-screen','0','640x480x24',
      '-nolisten','tcp','-auth',auth,'-noreset'],
      {env:allEnv,cwd:ws,stdio:'ignore'});
    server.on('error',()=>{}); // startup failure is caught by readiness probe.
    await ready(async()=>{
      if(!alive(server))throw new Error('PRIVATE_XVFB_EXITED_DURING_START');
      try{await call(commands.xdpyinfo,['-display',display],allEnv,
        {timeout:1300});return true;}catch{return false;}
    },{label:'xvfb'});
    app=spawn(process.env.RC_QA_PYTHON||'/usr/bin/python3',
      ['-B',script,'--app',label,receipt],
      {env:allEnv,cwd:ws,stdio:'ignore'});
    app.on('error',()=>{});
    await ready(async()=>{
      if(!alive(app))throw new Error('PRIVATE_TK_EXITED_DURING_START');
      try{
        const out=(await call(commands.xdotool,
          ['search','--onlyvisible','--name','^RC_PRIVATE_X11_QA_'+label+'$'],
          allEnv,{timeout:1300})).toString().trim();
        if(out){windowId=out.split('\n')[0];return true;}
      }catch{/* retry bounded */}
      return false;
    },{label:'tk'});
    return {
      kind:'native-private-x11',physicalDesktopInput:false,
      displayId:display,serverPid:server.pid,
      get snapshotCount(){return snapshots;},
      receipt,auth,env:allEnv,
      async observe(){
        snapshots++;
        // Explicit -i binds capture to our disposable X server only.
        const png=await call(commands.ffmpeg,
          ['-nostdin','-hide_banner','-loglevel','error','-f','x11grab',
           '-video_size','640x480','-i',display+'.0+0,0',
           '-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'],
          allEnv,{timeout:6500,maxBuffer:3*1024*1024});
        assert.ok(png.length>1000);
        assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
        return {frame:{mimeType:'image/png',data:png.toString('base64')}};
      },
      async input(action){
        if(action.kind!=='type'||action.text!=='SYNTHETIC_ONLY_'+label)
          throw new Error('QA_BOUNDED_SYNTHETIC_INPUT_ONLY');
        await call(commands.xdotool,['windowfocus','--sync',windowId],
          allEnv,{timeout:4000});
        await new Promise(resolve=>setTimeout(resolve,160));
        await call(commands.xdotool,['type','--clearmodifiers','--delay','15',
          action.text],allEnv,{timeout:5000});
        await call(commands.xdotool,['key','Return'],allEnv,{timeout:2800});
        await ready(()=>statIfExists(receipt),{label:'synthetic-receipt'});
        return {submitted:true};
      },
      async close(){
        if(closed)return;
        closed=true;
        try{await stopChild(app);}finally{await stopChild(server);}
        if(alive(app)||alive(server))
          throw new Error('PRIVATE_QA_CHILD_CLEANUP_UNCONFIRMED');
      }
    };
  }catch(err){
    await stopChild(app);
    await stopChild(server);
    reserved.delete(Number(display?.slice(1)));
    throw err;
  }
}

test('two real private X servers: supervisor read-only, scoped input and handoff',
  {skip:!process.env.RC_QA_XVFB_BIN},async()=>{
    const raw=process.env.RC_QA_XVFB_BIN;
    assert.ok(path.isAbsolute(raw),'explicit Xvfb binary required');
    await access(raw,constants.X_OK);
    for(const binary of Object.values(commands))await access(binary,constants.X_OK);
    const root=await mkdtemp(path.join(os.tmpdir(),'rc-native-broker-live-'));
    await ensurePrivate(root);
    const reserved=new Set(),backends=[];
    const pool=createNativeWorkspaceCoordinator({
      identityResolver:identity,capacity:2,
      launchWorkspace:async()=>{
        const label=backends.length===0?'A':'B';
        const w=await createPrivateWorker(label,root,raw,reserved);
        backends.push(w);
        return w;
      },
      authorizeObserver:()=>true,authorizeHandoff:()=>true
    });
    try{
      const a=await pool.open(ownerA),b=await pool.open(ownerB);
      assert.notEqual(a.workspaceRef,b.workspaceRef);
      assert.notEqual(backends[0].displayId,backends[1].displayId);
      assert.notEqual(backends[0].serverPid,backends[1].serverPid);
      assert.equal(a.physicalDesktopInput,false);
      // Xauthority for B must not be allowed to inspect A's private display.
      await assert.rejects(call(commands.xdpyinfo,
        ['-display',backends[0].displayId],
        {...backends[1].env,DISPLAY:backends[0].displayId},
        {timeout:2500}));
      const viewGrant=await pool.grantObserver(ownerA,a.lease,observer);
      const [seenA,seenB]=await Promise.all([
        pool.observeOwner(ownerA,a.lease),pool.observeOwner(ownerB,b.lease)
      ]);
      assert.notEqual(seenA.frame.data,seenB.frame.data);
      const before=backends[0].snapshotCount;
      const cached=pool.readObserver(observer,viewGrant.viewerToken);
      assert.equal(cached.canInput,false);
      assert.equal(backends[0].snapshotCount,before,
        'view-only client must not call native capture');
      await assert.rejects(pool.observeOwner(ownerB,a.lease),
        /NATIVE_WORKSPACE_LEASE_DENIED/);
      const handoff=await pool.beginHandoff(ownerA,a.lease,reviewer);
      await assert.rejects(pool.inputOwner(ownerA,a.lease,
        {kind:'type',text:'SYNTHETIC_ONLY_A'},
        {expectedRevision:seenA.revision}),/NATIVE_WORKSPACE_CONTROL_HELD/);
      const humanView=await pool.observeOperator(reviewer,handoff.controlToken);
      const [A,B]=await Promise.all([
        pool.inputOperator(reviewer,handoff.controlToken,
          {kind:'type',text:'SYNTHETIC_ONLY_A'},
          {expectedRevision:humanView.revision}),
        pool.inputOwner(ownerB,b.lease,
          {kind:'type',text:'SYNTHETIC_ONLY_B'},
          {expectedRevision:seenB.revision})
      ]);
      assert.equal(A.submitted,true);
      assert.equal(B.submitted,true);
      assert.equal(pool.readObserver(observer,viewGrant.viewerToken).stale,true);
      assert.deepEqual(await readOwned(backends[0].receipt),
        {worker:'A',synthetic:'SYNTHETIC_ONLY_A'});
      assert.deepEqual(await readOwned(backends[1].receipt),
        {worker:'B',synthetic:'SYNTHETIC_ONLY_B'});
      assert.equal(pool.endHandoff(reviewer,handoff.controlToken).ownerReobserveRequired,true);
      await assert.rejects(pool.inputOwner(ownerA,a.lease,
        {kind:'type',text:'SYNTHETIC_ONLY_A'},
        {expectedRevision:A.revision}),/NATIVE_WORKSPACE_REOBSERVATION_REQUIRED/);
      const fresh=await pool.observeOwner(ownerA,a.lease);
      assert.equal(fresh.mayInput,true);
      pool.revokeObserver(ownerA,a.lease,viewGrant.viewerToken);
    }finally{
      let cleanupError=null;
      try{await pool.close();}catch(err){cleanupError=err;}
      const slots=[...reserved];
      for(const index of slots){
        const serverSock='/tmp/.X11-unix/X'+index;
        const serverLock='/tmp/.X'+index+'-lock';
        // Socket paths are checked, never deleted manually.
        assert.equal(await statIfExists(serverSock),false);
        assert.equal(await statIfExists(serverLock),false);
      }
      await rm(root,{recursive:true,force:true});
      if(cleanupError)throw cleanupError;
    }
  });
