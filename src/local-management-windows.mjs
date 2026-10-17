/**
 * Explicit, one-command native Windows management IPC prototype.
 * It DOES NOT attach to the installed Commander, browser or desktop by import.
 * The trusted resident Core must deliberately supply already-running workflowTools,
 * an exact current device/profile/config identity, and one expected native client PID.
 * The PowerShell child only holds a CurrentUserOnly/FirstPipeInstance named pipe;
 * it never starts a second engine, shell executor, app, model or project step.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createLocalManagementGateway} from './local-management-contract.mjs';
import {inspectLocalManagementEvent} from './local-management-reconcile.mjs';

const HELPER=fileURLToPath(new URL('../tools/local-management-windows.ps1',import.meta.url));
const TARGET_KEYS=['deviceId','profileId','configSha256','routeGeneration'];
const AUTH='WINDOWS_NAMED_PIPE_CURRENT_USER_ONLY_PID';
const fail=code=>{const e=new Error(code);e.managementCode=code;throw e;};
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const int=(v,lo,hi)=>Number.isSafeInteger(v)&&v>=lo&&v<=hi;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clone=v=>JSON.parse(JSON.stringify(v));

export async function startWindowsLocalManagement({enabled=false,target,readIdentity,workflowTools,
  expectedClientPid,sessionMs=15000,idleMs=6000,operationTimeoutMs=5000,
  pwshPath=null}={}) {
  if(enabled!==true)fail('MANAGEMENT_NOT_ENABLED');
  if(process.platform!=='win32')fail('MANAGEMENT_PLATFORM_UNSUPPORTED');
  if(!int(expectedClientPid,1,2147483647)||!int(sessionMs,100,300000)||
      !int(idleMs,100,30000)||!int(operationTimeoutMs,1,10000))
    fail('MANAGEMENT_OPTIONS');
  if(typeof readIdentity!=='function'||typeof workflowTools?.execute!=='function'||
      !Array.isArray(workflowTools.definitions)||
      !['workflow_control','workflow_get'].every(name=>workflowTools.definitions.some(d=>d.name===name)))
    fail('MANAGEMENT_RESIDENT_ADAPTER_REQUIRED');
  const original=clone(target);
  const current=()=>{
    try {const v=readIdentity();return exact(v,TARGET_KEYS)&&TARGET_KEYS.every(k=>v[k]===original[k]);}
    catch{return false;}
  };
  if(!current())fail('MANAGEMENT_TARGET_CHANGED');
  // In the isolated QA environment a fixed already-inspected pwsh location is
  // supplied. This is trusted native launcher input, never received from a pipe
  // client/browser/LLM web page. No PATH shell lookup or user profile startup.
  const exe=pwshPath??path.join(process.env.ProgramFiles??'C:\\Program Files','PowerShell','7','pwsh.exe');
  for(const filename of [exe,HELPER]){
    let st;
    try {st=fs.statSync(fs.realpathSync.native(filename));}
    catch {fail('MANAGEMENT_HELPER_MISSING');}
    if(!st.isFile())fail('MANAGEMENT_HELPER_UNTRUSTED');
  }
  const pipeName='rcm-native-'+randomBytes(16).toString('hex');
  const key=randomBytes(32);
  const gateway=createLocalManagementGateway({target:original,key,maxRequests:1,operationTimeoutMs,
    isCurrent:current,dispatch:(name,args)=>workflowTools.execute(name,args),
    readBack:id=>workflowTools.execute('workflow_get',{id})});
  const child=spawn(exe,['-NoLogo','-NoProfile','-NonInteractive','-File',HELPER,'-Mode','relay'],{
    windowsHide:true,shell:false,stdio:['pipe','pipe','ignore'],
    env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',TEMP:process.env.TEMP??'C:\\Windows\\Temp',
      TMP:process.env.TMP??'C:\\Windows\\Temp',PATH:path.dirname(exe)}
  });
  let phase='STARTING',readySettled=false,helperClosed=false,sequence=0,pending=false,
      lastCode=null,peer=null,buffer=Buffer.alloc(0),stopping=null;
  let startupTimer,sessionTimer,resolveReady,rejectReady,resolveExit;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const exited=new Promise(resolve=>{resolveExit=resolve;});
  function rejectStartup(code) {
    if(!readySettled){readySettled=true;rejectReady(Object.assign(new Error(code),{managementCode:code}));}
  }
  function send(value) {
    if(helperClosed||child.stdin.destroyed||!child.stdin.writable)return false;
    const data=JSON.stringify(value)+'\n';
    if(Buffer.byteLength(data)>32768)return false;
    child.stdin.write(data);
    return true;
  }
  function revoke(code) {
    lastCode=code;
    if(phase!=='UNCERTAIN')phase='REVOKED';
    gateway.close();key.fill(0);send({type:'close'});rejectStartup(code);
  }
  async function close() {
    if(!stopping){
      revoke(lastCode??'MANAGEMENT_SESSION_REVOKED');
      stopping=(async()=>{
        if(!helperClosed)await Promise.race([exited,sleep(1000)]);
        if(!helperClosed)child.kill();
        if(!helperClosed)await Promise.race([exited,sleep(2000)]);
        if(!helperClosed)fail('MANAGEMENT_HELPER_EXIT_UNVERIFIED');
        return {closed:true,helperExited:true};
      })();
    }
    return stopping;
  }
  function status(){return {phase,helperPid:child.pid,helperExited:helperClosed,pipeName,
    target:clone(original),peer,requestFrames:sequence,lastCode,pending,authentication:AUTH};}
  function protocolFailure(code='MANAGEMENT_RELAY_PROTOCOL'){
    revoke(code);void close().catch(()=>{});
  }
  async function request(value) {
    if(phase!=='CONNECTED'||pending||!exact(value,['type','sequence','wire'])||
        value.sequence!==1||sequence!==0||typeof value.wire!=='string'||
        Buffer.byteLength(value.wire)>8192){protocolFailure();return;}
    sequence=1;pending=true;
    try {
      if(!current()){protocolFailure('MANAGEMENT_TARGET_CHANGED');return;}
      const receipt=await gateway.handle(value.wire);
      if(receipt.state==='UNCERTAIN'){phase='UNCERTAIN';lastCode=receipt.code;gateway.close();key.fill(0);}
      send({type:'result',sequence:1,receipt});
    }catch{protocolFailure('MANAGEMENT_REQUEST_REFUSED');}
    finally{pending=false;}
  }
  function frame(v) {
    if(v?.type==='ready') {
      if(phase!=='STARTING'||!exact(v,['type','pipeName','pid'])||
         v.pipeName!==pipeName||v.pid!==child.pid||!current())return protocolFailure();
      phase='READY';clearTimeout(startupTimer);
      readySettled=true;
      resolveReady(Object.freeze({pipeName,helperPid:child.pid,target:clone(original),
        status,close,closed:exited,inspectControl: args => inspectLocalManagementEvent({
          ...args,target:original,readIdentity,workflowTools
        }),
        revoke:()=>revoke('MANAGEMENT_SESSION_REVOKED')}));
      return;
    }
    if(v?.type==='peer') {
      if(phase!=='READY'||!exact(v,['type','pid'])||v.pid!==expectedClientPid||!current())
        return protocolFailure('MANAGEMENT_PEER_DENIED');
      peer={pid:v.pid};phase='CONNECTED';
      send({type:'bootstrap',bootstrap:{schema:1,session:{...gateway.session(),authentication:AUTH},
        keyHex:key.toString('hex')}});
      return;
    }
    if(v?.type==='request'){void request(v);return;}
    protocolFailure();
  }
  child.stdout.on('data',chunk=>{
    if(buffer.length+chunk.length>65536){protocolFailure('MANAGEMENT_RELAY_LIMIT');return;}
    buffer=Buffer.concat([buffer,chunk]);
    while(buffer.includes(10)){
      const i=buffer.indexOf(10),raw=buffer.subarray(0,i);buffer=buffer.subarray(i+1);
      let value;
      try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
      catch{protocolFailure();return;}
      frame(value);
    }
  });
  child.stdin.on('error',()=>protocolFailure('MANAGEMENT_PARENT_PIPE_CLOSED'));
  child.stdout.on('error',()=>protocolFailure('MANAGEMENT_HELPER_PIPE_CLOSED'));
  child.once('error',()=>rejectStartup('MANAGEMENT_HELPER_START_FAILED'));
  child.once('close',(code,signal)=>{
    helperClosed=true;gateway.close();key.fill(0);
    clearTimeout(startupTimer);clearTimeout(sessionTimer);
    if(!['UNCERTAIN','REVOKED'].includes(phase))phase='CLOSED';
    rejectStartup(lastCode??'MANAGEMENT_HELPER_EXITED');
    resolveExit({exitCode:code,signal,helperExited:true});
  });
  startupTimer=setTimeout(()=>protocolFailure('MANAGEMENT_STARTUP_TIMEOUT'),10000);
  sessionTimer=setTimeout(()=>{revoke('MANAGEMENT_SESSION_EXPIRED');void close().catch(()=>{});},sessionMs);
  send({schema:1,pipeName,expectedClientPid,sessionMs,idleMs,maxRequests:1});
  try{return await ready;}catch(error){await close();throw error;}
}
