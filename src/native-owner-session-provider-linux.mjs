import {createHash,randomInt} from 'node:crypto';
import {isProxy} from 'node:util/types';
import {execFile as execFileDefault} from 'node:child_process';
import fs from 'node:fs';
import {normalizeV2Route} from './v2-routing-contract.mjs';

const LOGINCTL='/usr/bin/loginctl';
const ZENITY='/usr/bin/zenity';
const KDIALOG='/usr/bin/kdialog';
const SESSION_ID=/^[0-9]{1,12}$/;
const HASH=/^[a-f0-9]{64}$/;
const BINDING=/^[a-f0-9]{32,64}$/;
const SAFE_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROPERTIES=Object.freeze([
  'Id','User','Seat','Active','Remote','Type','Class','Display','Leader','State'
]);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const clean=(value,max=256)=>typeof value==='string'&&value.length>0
  &&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const cleanMultiline=(value,max=5000)=>typeof value==='string'&&value.length>0
  &&value.length<=max&&!/[\u0000-\u0009\u000b-\u001f\u007f]/.test(value);

function exactRecord(value,fields,code){
  if(!value||typeof value!=='object'||Array.isArray(value)||isProxy(value)
    ||![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    fail(code);
  const keys=Reflect.ownKeys(value);
  if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k)))
    fail(code);
  const out=Object.create(null);
  for(const key of fields){
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(!d||!Object.hasOwn(d,'value')||d.enumerable!==true)fail(code);
    out[key]=d.value;
  }
  return out;
}

function assertTrustedExecutable(file){
  let st;
  try{st=fs.lstatSync(file);}catch{fail('NATIVE_OWNER_EXECUTABLE_UNAVAILABLE');}
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==0
    ||(st.mode&0o022)!==0||(st.mode&0o111)===0)
    fail('NATIVE_OWNER_EXECUTABLE_UNTRUSTED');
}

function parseLogindProperties(stdout){
  if(typeof stdout!=='string'||stdout.length>8192)fail('NATIVE_OWNER_LOGIND_RESPONSE_INVALID');
  const values=Object.create(null);
  for(const line of stdout.trim().split(/\r?\n/)){
    const index=line.indexOf('=');
    if(index<1)fail('NATIVE_OWNER_LOGIND_RESPONSE_INVALID');
    const key=line.slice(0,index),value=line.slice(index+1);
    if(!PROPERTIES.includes(key)||Object.hasOwn(values,key))
      fail('NATIVE_OWNER_LOGIND_RESPONSE_INVALID');
    values[key]=value;
  }
  if(Object.keys(values).length!==PROPERTIES.length
    ||PROPERTIES.some(key=>!Object.hasOwn(values,key)))
    fail('NATIVE_OWNER_LOGIND_RESPONSE_INCOMPLETE');
  return values;
}

function execute(executeFile,file,args,options){
  return new Promise(resolve=>{
    try{
      executeFile(file,args,options,(error,stdout,stderr)=>{
        const code=!error?0:Number.isInteger(error?.code)?error.code:null;
        resolve({
          code,stdout:typeof stdout==='string'?stdout:'',
          stderr:typeof stderr==='string'?stderr:'',error
        });
      });
    }catch(error){
      resolve({code:null,stdout:'',stderr:'',error});
    }
  });
}

function dialogEnvironment(env){
  const out={PATH:'/usr/bin:/bin',LANG:clean(env.LANG,128)?env.LANG:'C.UTF-8'};
  for(const key of [
    'HOME','USER','LOGNAME','DISPLAY','XAUTHORITY','DBUS_SESSION_BUS_ADDRESS',
    'XDG_RUNTIME_DIR','XDG_SESSION_ID','XDG_SESSION_TYPE','XDG_CURRENT_DESKTOP',
    'WAYLAND_DISPLAY','LC_ALL'
  ])if(clean(env[key],2048))out[key]=env[key];
  return out;
}

function sameSnapshot(a,b){
  return a.ownerSidHash===b.ownerSidHash&&a.osSessionId===b.osSessionId
    &&a.seatId===b.seatId&&a.displayId===b.displayId
    &&a.sessionType===b.sessionType&&a.leaderPid===b.leaderPid;
}

/**
 * Linux owner/session provider for V1-01.
 *
 * OS identity is derived from the current process UID and user-namespace
 * identity, never from OAuth, a profile label, MCP arguments or Tailscale.
 * The interactive seat is independently checked through logind before a
 * visible, default-deny Zenity approval. No privilege elevation is attempted.
 */
export function createLinuxNativeOwnerSessionProvider({
  platform=process.platform,execFileImpl=execFileDefault,env=process.env,
  getuid=process.getuid,readFileImpl=fs.readFileSync,
  readlinkImpl=fs.readlinkSync,verifyExecutable=assertTrustedExecutable,
  commandTimeoutMs=4000,dialogTimeoutMs=65000
}={}){
  if(platform!=='linux'||typeof execFileImpl!=='function'
    ||typeof getuid!=='function'||typeof readFileImpl!=='function'
    ||typeof readlinkImpl!=='function'||typeof verifyExecutable!=='function'
    ||!env||typeof env!=='object'
    ||!Number.isSafeInteger(commandTimeoutMs)||commandTimeoutMs<250
    ||commandTimeoutMs>10000||!Number.isSafeInteger(dialogTimeoutMs)
    ||dialogTimeoutMs<5000||dialogTimeoutMs>120000)
    fail('NATIVE_OWNER_LINUX_BOOTSTRAP_REQUIRED');

  function ownerSidHash(){
    const uid=getuid();
    if(!Number.isSafeInteger(uid)||uid<0)fail('NATIVE_OWNER_UID_UNAVAILABLE');
    let namespace;
    try{namespace=readlinkImpl('/proc/self/ns/user');}
    catch{fail('NATIVE_OWNER_USER_NAMESPACE_UNAVAILABLE');}
    if(typeof namespace!=='string'||!/^user:\[[0-9]+\]$/.test(namespace))
      fail('NATIVE_OWNER_USER_NAMESPACE_INVALID');
    return createHash('sha256').update(
      'commander.os-owner.sid.v1\0linux\0uid='+uid+'\0userns='+namespace
    ).digest('hex');
  }

  async function getOwnerSessionSnapshot(){
    const uid=getuid();
    if(!Number.isSafeInteger(uid)||uid<0)fail('NATIVE_OWNER_UID_UNAVAILABLE');
    const sessionId=env.XDG_SESSION_ID;
    if(typeof sessionId!=='string'||!SESSION_ID.test(sessionId))
      fail('NATIVE_OWNER_LOGIND_SESSION_REQUIRED');
    if(!clean(env.DBUS_SESSION_BUS_ADDRESS,2048))
      fail('NATIVE_OWNER_SESSION_BUS_REQUIRED');
    let cgroup;
    try{cgroup=readFileImpl('/proc/self/cgroup','utf8');}
    catch{fail('NATIVE_OWNER_PROCESS_CGROUP_UNAVAILABLE');}
    if(typeof cgroup!=='string'||!cgroup.includes('/user.slice/user-'+uid+'.slice/'))
      fail('NATIVE_OWNER_PROCESS_USER_SCOPE_MISMATCH');

    verifyExecutable(LOGINCTL);
    const args=['show-session',sessionId,'--no-pager'];
    for(const property of PROPERTIES)args.push('-p',property);
    const result=await execute(execFileImpl,LOGINCTL,args,{
      encoding:'utf8',timeout:commandTimeoutMs,maxBuffer:8192,
      env:{PATH:'/usr/bin:/bin',LANG:'C'}
    });
    if(result.code!==0||result.stderr.trim()!=='')
      fail('NATIVE_OWNER_LOGIND_UNAVAILABLE');
    const p=parseLogindProperties(result.stdout);
    if(p.Id!==sessionId||p.User!==String(uid)||!SAFE_ID.test(p.Seat)
      ||p.Active!=='yes'||p.Remote!=='no'||p.Class!=='user'||p.State!=='active'
      ||!['x11','wayland'].includes(p.Type)
      ||!/^\d{1,12}$/.test(p.Leader)||Number(p.Leader)<1)
      fail('NATIVE_OWNER_SESSION_NOT_ACTIVE');
    if(env.XDG_SESSION_TYPE!==undefined&&env.XDG_SESSION_TYPE!==p.Type)
      fail('NATIVE_OWNER_SESSION_TYPE_MISMATCH');

    let displayId;
    if(p.Type==='x11'){
      if(!clean(p.Display,128)||!clean(env.DISPLAY,128)||env.DISPLAY!==p.Display)
        fail('NATIVE_OWNER_DISPLAY_MISMATCH');
      displayId=p.Display;
    }else{
      if(!clean(env.WAYLAND_DISPLAY,128))fail('NATIVE_OWNER_WAYLAND_DISPLAY_REQUIRED');
      displayId=env.WAYLAND_DISPLAY;
    }
    const ownerHash=ownerSidHash();
    return Object.freeze({
      source:'native-linux-owner-session',ownerSidHash:ownerHash,
      osSessionId:'linux-logind-'+sessionId,seatId:p.Seat,displayId,
      sessionType:p.Type,leaderPid:Number(p.Leader)
    });
  }

  async function requestConsent(value){
    let request;
    try{
      request=exactRecord(value,[
        'title','message','expectedOwnerSidHash','expectedOsSessionId'
      ],'NATIVE_OWNER_CONSENT_REQUEST_INVALID');
      if(!clean(request.title,120)||!cleanMultiline(request.message,5000)
        ||!HASH.test(request.expectedOwnerSidHash)
        ||typeof request.expectedOsSessionId!=='string'
        ||!SAFE_ID.test(request.expectedOsSessionId))return false;
      const before=await getOwnerSessionSnapshot();
      if(before.ownerSidHash!==request.expectedOwnerSidHash
        ||before.osSessionId!==request.expectedOsSessionId)return false;
      let dialog=ZENITY;
      try{verifyExecutable(ZENITY);}
      catch(error){
        // Missing Zenity on KDE is not a reason to relax native owner checks.
        // An untrusted or replaced Zenity binary must fail closed, not fall back.
        if(error?.code!=='NATIVE_OWNER_EXECUTABLE_UNAVAILABLE')return false;
        verifyExecutable(KDIALOG);
        dialog=KDIALOG;
      }
      let challenge=null;
      const args=dialog===ZENITY?[
        '--question','--title',request.title,'--text',request.message,
        '--ok-label=Approve','--cancel-label=Deny','--default-cancel',
        '--no-markup','--no-wrap'
      ]:(()=>{
        // KDialog does not provide Zenity's default-cancel contract.
        // Require deliberate typing of a fresh code in an initially empty input.
        challenge=String(randomInt(10_000_000,100_000_000));
        return ['--title',request.title,'--inputbox',
          request.message+'\n\nType this one-time code to approve:\n'+challenge,
          ''];
      })();
      const result=await execute(execFileImpl,dialog,args,{
        encoding:'utf8',timeout:dialogTimeoutMs,maxBuffer:4096,
        windowsHide:true,env:dialogEnvironment(env)
      });
      // Deny, close, timeout, absent display and wrong or empty code all deny.
      if(result.code!==0||(challenge!==null&&result.stdout.trim()!==challenge))
        return false;
      const after=await getOwnerSessionSnapshot();
      return sameSnapshot(before,after);
    }catch{return false;}
  }

  async function observedNativeSession(route){
    normalizeV2Route(route);
    return (await getOwnerSessionSnapshot()).osSessionId;
  }

  async function authorizeBinding(value){
    try{
      const r=exactRecord(value,[
        'sessionHandle','tokenSha256','route','osSessionId','ownerSidHash','bindingId'
      ],'NATIVE_OWNER_BINDING_REQUEST_INVALID');
      if(typeof r.sessionHandle!=='string'||!SAFE_ID.test(r.sessionHandle)
        ||!HASH.test(r.tokenSha256)||!HASH.test(r.ownerSidHash)
        ||!BINDING.test(r.bindingId))return false;
      const route=normalizeV2Route(r.route);
      if(route.conversationId!==r.sessionHandle)return false;
      const snapshot=await getOwnerSessionSnapshot();
      if(snapshot.ownerSidHash!==r.ownerSidHash||snapshot.osSessionId!==r.osSessionId)
        return false;
      const message=[
        'Approve binding this exact ChatGPT conversation to the current Linux owner session?',
        'Host: '+route.hostId,
        'Profile: '+route.profileId,
        'Principal: '+route.principalId,
        'Conversation: '+route.conversationId,
        'Operation: '+route.operationId,
        'Target: '+route.target.kind+'/'+route.target.id,
        'OS session: '+snapshot.osSessionId+' / '+snapshot.seatId,
        'Owner identity: '+snapshot.ownerSidHash.slice(0,12),
        'Binding epoch: '+r.bindingId.slice(0,12),
        '',
        'This binding is short-lived and in-memory. It does not grant Administrator or Root privileges.'
      ].join('\n');
      return requestConsent({
        title:'Commander — Bind ChatGPT owner session',message,
        expectedOwnerSidHash:r.ownerSidHash,expectedOsSessionId:r.osSessionId
      });
    }catch{return false;}
  }

  async function authorizeRevocation(value){
    try{
      const r=exactRecord(value,[
        'sessionHandle','route','osSessionId','ownerSidHash','bindingId','adminProof'
      ],'NATIVE_OWNER_REVOCATION_REQUEST_INVALID');
      if(typeof r.sessionHandle!=='string'||!SAFE_ID.test(r.sessionHandle)
        ||!HASH.test(r.ownerSidHash)||!BINDING.test(r.bindingId))return false;
      const route=normalizeV2Route(r.route);
      if(route.conversationId!==r.sessionHandle)return false;
      const snapshot=await getOwnerSessionSnapshot();
      if(snapshot.ownerSidHash!==r.ownerSidHash||snapshot.osSessionId!==r.osSessionId)
        return false;
      const message=[
        'Revoke this exact Commander ChatGPT-to-OS owner binding?',
        'Host: '+route.hostId,
        'Profile: '+route.profileId,
        'Principal: '+route.principalId,
        'Conversation: '+route.conversationId,
        'OS session: '+snapshot.osSessionId+' / '+snapshot.seatId,
        'Binding epoch: '+r.bindingId.slice(0,12),
        '',
        'Revocation immediately invalidates this in-memory binding. A later bind requires fresh owner approval.'
      ].join('\n');
      return requestConsent({
        title:'Commander — Revoke owner binding',message,
        expectedOwnerSidHash:r.ownerSidHash,expectedOsSessionId:r.osSessionId
      });
    }catch{return false;}
  }

  return Object.freeze({
    resolveOwnerSidHash:async()=>ownerSidHash(),
    observedNativeSession,
    getOwnerSessionSnapshot,
    requestConsent,
    authorizeBinding,
    authorizeRevocation
  });
}
