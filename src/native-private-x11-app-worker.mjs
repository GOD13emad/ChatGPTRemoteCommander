// SOURCE-ONLY QA adapter: one private Xvfb server + arbitrary, HOST-ALLOWLISTED
// native X11 application per workspace. No browser dependency or user DISPLAY.
// NOT imported into installed Core and NOT a cross-user security boundary.
// Real production requires authenticated conversation/OS broker, signed owner
// approval, durable native intent and crash-safe child supervision.
import {randomBytes, createHash} from 'node:crypto';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {constants} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const guardScript=path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  '../tools/native-qa-parent-death-exec.py');

const exec=promisify(execFile);
const HEX=/^[a-f0-9]{64}$/;
const APP=/^[a-z][a-z0-9-]{0,31}$/;
const fail=code=>Object.assign(new Error(code),{code});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const alive=p=>!!p&&p.exitCode===null&&p.signalCode===null;
const sha=b=>createHash('sha256').update(b).digest('hex');
const validCoord=(x,limit)=>Number.isInteger(x)&&x>=0&&x<limit;
const anySocket=async n=>{
  for(const pathname of ['/tmp/.X11-unix/X'+n,'/tmp/.X'+n+'-lock']){
    try{await fs.lstat(pathname);return true;}
    catch(e){if(e.code!=='ENOENT')return true;}
  }
  return false;
};
async function privateFolder(root){
  if(typeof root!=='string'||!path.isAbsolute(root))
    throw fail('NATIVE_APP_QA_ROOT_INVALID');
  let st;
  try{st=await fs.lstat(root);}catch{throw fail('NATIVE_APP_QA_ROOT_MISSING');}
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0||
     (process.getuid&&st.uid!==process.getuid())||
     await fs.realpath(root)!==path.resolve(root))
    throw fail('NATIVE_APP_QA_ROOT_UNTRUSTED');
}
async function executable(bin){
  if(typeof bin!=='string'||!path.isAbsolute(bin))throw fail('NATIVE_APP_QA_BINARY_INVALID');
  try{await fs.access(bin,constants.X_OK);}
  catch{throw fail('NATIVE_APP_QA_BINARY_MISSING');}
  return bin;
}
function manifest(catalog){
  if(!catalog||typeof catalog!=='object'||Array.isArray(catalog)||
     Object.keys(catalog).length<1||Object.keys(catalog).length>12)
    throw fail('NATIVE_APP_QA_CATALOG_INVALID');
  const safe=new Map();
  for(const [appId,m] of Object.entries(catalog)){
    if(!APP.test(appId)||!m||typeof m!=='object'||
       typeof m.executable!=='string'||!path.isAbsolute(m.executable)||
       !Array.isArray(m.args)||m.args.length>32||
       m.args.some(v=>typeof v!=='string'||v.length>1024||v.includes('\0'))||
       typeof m.windowTitle!=='string'||m.windowTitle.length<3||
       m.windowTitle.length>100)
      throw fail('NATIVE_APP_QA_CATALOG_INVALID');
    // Application arguments, path and title are only supplied by trusted host
    // setup. No shell, interpolated GUI instruction or dynamic command args.
    safe.set(appId,Object.freeze({
      executable:m.executable,
      args:Object.freeze([...m.args]),
      windowTitle:m.windowTitle
    }));
  }
  return safe;
}
async function call(bin,args,env,timeoutMs=5000,maxBuffer=2*1024*1024){
  try{
    const r=await exec(bin,args,{env,timeout:timeoutMs,windowsHide:true,
      encoding:'buffer',maxBuffer});
    return r.stdout;
  }catch{throw fail('NATIVE_APP_QA_HELPER_FAILED');}
}
async function childStopped(p){
  if(!p||!alive(p))return;
  const finished=new Promise(resolve=>p.once('exit',resolve));
  p.kill('SIGTERM');
  const done=await Promise.race([
    finished.then(()=>true),sleep(2000).then(()=>false)
  ]);
  if(!done&&alive(p)){
    p.kill('SIGKILL'); // child PID held by this exact QA worker only.
    const stopped=await Promise.race([
      finished.then(()=>true),sleep(2500).then(()=>false)
    ]);
    if(!stopped)throw fail('NATIVE_APP_QA_CHILD_UNREAPED');
  }
}
async function ready(probe,label,limit=8000){
  const until=performance.now()+limit;
  while(performance.now()<until){
    const result=await probe();
    if(result)return result;
    await sleep(120);
  }
  throw fail('NATIVE_APP_QA_START_TIMEOUT_'+label);
}
const escapeTitle=value=>'^'+value.replace(/[\\^$.*+?()[\]{}|]/g,'\\$&')+'$';

/**
 * Config is trusted host-only, not a dynamic MCP payload.
 *
 * launcher.forApplication("dialog").launchWorkspace({workspaceRef}) is usable
 * as the coordinator's existing launchWorkspace callback once the latter's
 * identity/journal/observer-approval requirements have been satisfied.
 */
export function createNativeX11ApplicationLauncher({
  root,
  catalog,
  xvfbBin,
  xauthBin='/usr/bin/xauth',
  xdpyinfoBin='/usr/bin/xdpyinfo',
  xdotoolBin='/usr/bin/xdotool',
  ffmpegBin='/usr/bin/ffmpeg',
  pythonBin='/usr/bin/python3',
  displayStart=1850,
  displayEnd=1900,
  width=640,
  height=480
}={}){
  const apps=manifest(catalog);
  if(process.platform!=='linux'||
     !Number.isInteger(displayStart)||!Number.isInteger(displayEnd)||
     displayStart<100||displayEnd>4000||displayEnd<=displayStart||
     !Number.isInteger(width)||!Number.isInteger(height)||
     width<320||width>1920||height<240||height>1080)
    throw fail('NATIVE_APP_QA_CONFIG_INVALID');
  const commands={xvfb:xvfbBin,xauth:xauthBin,
    xdpyinfo:xdpyinfoBin,xdotool:xdotoolBin,
    ffmpeg:ffmpegBin,python:pythonBin};
  const reserved=new Set();
  const running=new Set();
  const physicalDisplay=process.env.DISPLAY;
  async function preflight(){
    await privateFolder(root);
    await Promise.all(Object.values(commands).map(executable));
    const guard=await fs.lstat(guardScript);
    if(!guard.isFile()||guard.isSymbolicLink()||
       (process.getuid&&guard.uid!==process.getuid()))
      throw fail('NATIVE_APP_QA_GUARD_UNTRUSTED');
    await Promise.all([...apps.values()].map(a=>executable(a.executable)));
  }
  function forApplication(appId){
    if(!apps.has(appId))throw fail('NATIVE_APP_QA_APP_DENIED');
    const app=apps.get(appId);
    async function launchWorkspace({workspaceRef}={}){
      if(typeof workspaceRef!=='string'||!HEX.test(workspaceRef))
        throw fail('NATIVE_APP_QA_WORKSPACE_REF_INVALID');
      await preflight();
      const work=path.join(root,'worker-'+workspaceRef);
      let display=null,screenNo=null;
      for(let n=displayStart;n<displayEnd;n++){
        if(reserved.has(n)||':'+n===physicalDisplay)continue;
        // Recheck after the asynchronous filesystem probe: another open()
        // may have reserved the same display while this await was pending.
        if(await anySocket(n))continue;
        if(reserved.has(n))continue;
        reserved.add(n); // Atomic in one JS event-loop tick, no await above.
        display=':'+n;screenNo=n;break;
      }
      if(!display)throw fail('NATIVE_APP_QA_NO_PRIVATE_DISPLAY');
      let server=null,processApp=null,windowId=null,closed=false;
      let bytesWritten=0,stdout=Buffer.alloc(0);
      let ownDir=null;
      const auth=path.join(work,'authority');
      const env={
        PATH:'/usr/bin:/bin',HOME:work,LANG:'C.UTF-8',
        DISPLAY:display,XAUTHORITY:auth,WAYLAND_DISPLAY:'',
        GDK_BACKEND:'x11',QT_QPA_PLATFORM:'xcb',
        XDG_CONFIG_HOME:path.join(work,'config'),
        XDG_CACHE_HOME:path.join(work,'cache'),
        XDG_DATA_HOME:path.join(work,'data')
      };
      async function cleanup(){
        if(closed)return;
        closed=true;
        let problem=null;
        try{await childStopped(processApp);}catch(e){problem=e;}
        try{await childStopped(server);}catch(e){problem??=e;}
        if(server&&await anySocket(screenNo))problem??=fail('NATIVE_APP_QA_SOCKET_STILL_PRESENT');
        if(!problem){
          try{
            const st=await fs.lstat(work);
            if(ownDir&&st.dev===ownDir.dev&&st.ino===ownDir.ino&&
               st.isDirectory()&&!st.isSymbolicLink())
              await fs.rm(work,{recursive:true,force:false});
            else problem=fail('NATIVE_APP_QA_WORKSPACE_CHANGED');
          }catch(e){problem??=e;}
          reserved.delete(screenNo);
        }
        running.delete(handle);
        if(problem)throw fail('NATIVE_APP_QA_CLEANUP_UNCONFIRMED');
      }
      let handle=null;
      try{
        await fs.mkdir(work,{mode:0o700});
        ownDir=await fs.lstat(work);
        for(const p of ['config','cache','data'])
          await fs.mkdir(path.join(work,p),{mode:0o700});
        await call(commands.xauth,
          ['-f',auth,'add',display,'.',randomBytes(16).toString('hex')],env,3000);
        const ast=await fs.lstat(auth);
        if(!ast.isFile()||ast.isSymbolicLink()||(ast.mode&0o077)!==0)
          throw fail('NATIVE_APP_QA_XAUTH_UNTRUSTED');
        server=spawn(commands.python,
          ['-B',guardScript,commands.xvfb,String(process.pid),
           display,'-screen','0',width+'x'+height+'x24',
           '-auth',auth,'-nolisten','tcp','-noreset'],
          {env,cwd:work,stdio:'ignore',shell:false});
        server.on('error',()=>{});
        await ready(async()=>{
          if(!alive(server))throw fail('NATIVE_APP_QA_XVFB_EXITED');
          try{
            await call(commands.xdpyinfo,['-display',display],env,1000);
            return true;
          }catch{return false;}
        },'XVFB');
        processApp=spawn(commands.python,
          ['-B',guardScript,app.executable,String(process.pid),...app.args],{
          cwd:work,env,stdio:['ignore','pipe','ignore'],shell:false
        });
        processApp.on('error',()=>{});
        processApp.stdout.on('data',chunk=>{
          bytesWritten+=chunk.length;
          if(stdout.length<4096)stdout=Buffer.concat([
            stdout,chunk.subarray(0,4096-stdout.length)
          ]);
        });
        await ready(async()=>{
          if(!alive(processApp))throw fail('NATIVE_APP_QA_APP_EXITED');
          try{
            const result=(await call(commands.xdotool,
              ['search','--onlyvisible','--name',escapeTitle(app.windowTitle)],
              env,1100)).toString('utf8').trim().split(/\r?\n/);
            if(result[0]&&/^[0-9]+$/.test(result[0]))return result[0];
          }catch{/* startup retry only, never retry GUI input */}
          return null;
        },'APPLICATION',12000).then(v=>{windowId=v;});
        const observe=async()=>{
          if(closed||!alive(server))throw fail('NATIVE_APP_QA_SERVER_NOT_ALIVE');
          const bytes=await call(commands.ffmpeg,
            ['-nostdin','-hide_banner','-loglevel','error',
             '-f','x11grab','-video_size',width+'x'+height,
             '-i',display+'.0+0,0','-frames:v','1',
             '-f','image2pipe','-vcodec','png','pipe:1'],
            env,9000,2*1024*1024);
          if(!Buffer.from('89504e470d0a1a0a','hex').equals(bytes.subarray(0,8))||
             bytes.length<200||bytes.length>1024*1024)
            throw fail('NATIVE_APP_QA_BAD_FRAME');
          return {frame:{mimeType:'image/png',data:bytes.toString('base64')}};
        };
        const input=async(action)=>{
          if(closed||!alive(server))throw fail('NATIVE_APP_QA_SERVER_NOT_ALIVE');
          if(!action||typeof action!=='object')
            throw fail('NATIVE_APP_QA_ACTION_INVALID');
          // Foreground window focus is local to *this* Xvfb only.
          if(!alive(processApp))throw fail('NATIVE_APP_QA_APPLICATION_EXITED');
          await call(commands.xdotool,['windowfocus','--sync',windowId],env,4000);
          const pointer=async(x,y)=>{
            if(!validCoord(x,width)||!validCoord(y,height))
              throw fail('NATIVE_APP_QA_COORD_OUTSIDE_PRIVATE_SCREEN');
            await call(commands.xdotool,
              ['mousemove','--sync',String(x),String(y)],env,4000);
          };
          switch(action.kind){
            case 'move':
              await pointer(action.x,action.y);break;
            case 'click':
              await pointer(action.x,action.y);
              await call(commands.xdotool,['click',
                ...(action.count===2?['--repeat','2','--delay','120']:[]),
                String(action.button||1)],env,4000);break;
            case 'drag': {
              await pointer(action.from.x,action.from.y);
              const button=String(action.button||1);
              await call(commands.xdotool,['mousedown',button],env,4000);
              try{
                await pointer(action.to.x,action.to.y);
                await sleep(action.durationMs||250);
              }finally{
                await call(commands.xdotool,['mouseup',button],env,4000);
              }
              break;
            }
            case 'type':
              await call(commands.xdotool,
                ['type','--clearmodifiers','--delay','12',action.text],env,8000);
              break;
            case 'key':
              await call(commands.xdotool,['key','--clearmodifiers',action.key],env,4000);
              break;
            case 'scroll':
              for(let i=0;i<Math.abs(action.delta);i++)
                await call(commands.xdotool,['click',action.delta>0?'4':'5'],env,4000);
              break;
            default:throw fail('NATIVE_APP_QA_ACTION_NOT_SUPPORTED');
          }
          return {submitted:true,nativeEffectConfirmed:false};
        };
        handle={
          kind:'native-private-x11',physicalDesktopInput:false,
          displayId:display,serverPid:server.pid,
          appId,applicationPid:processApp.pid,windowId,
          observe,input,close:cleanup,
          inspection:()=>({
            appId,display,applicationAlive:alive(processApp),
            exitCode:processApp?.exitCode,
            capturedOutputSha256:sha(stdout),
            capturedOutputBytes:bytesWritten
          })
        };
        running.add(handle);
        return handle;
      }catch(e){
        try{await cleanup();}
        catch(cleanupError){
          // Preserve only typed error codes, not application stdout/stderr,
          // secret Xauthority, environment or display contents.
          const unresolved=fail('NATIVE_APP_QA_STARTUP_CLEANUP_UNCERTAIN');
          unresolved.cause={
            startupCode:e?.code||e?.name||'UNKNOWN',
            cleanupCode:cleanupError?.code||cleanupError?.name||'UNKNOWN'
          };
          throw unresolved;
        }
        throw e;
      }
    }
    return Object.freeze({launchWorkspace});
  }
  return Object.freeze({
    preflight,forApplication,
    status:()=>({configuredApps:[...apps.keys()],running:running.size,
      privateX11Only:true,productionIntegrated:false,
      ownerIdentityProtected:false,childParentDeathGuard:true,
      processCrashRecoveryVerified:false})
  });
}
