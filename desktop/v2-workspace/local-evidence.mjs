// Commander V2 owner-private evidence adapter, adapted from MMZ's read-only
// RC_CONTROL_CENTER_PRODUCT_R1 and RC_UI_MONITOR_R1 monitor/registry contracts.
// NOT an authenticated chat identity, workflow engine, or privilege boundary.
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SAFE_ID=/^[a-z][a-z0-9_-]{1,39}$/;
const SAFE_CHAT=/^[0-9a-fA-F-]{8,64}$/;
const MAX_PROJECTS=64;
const MAX_EVENTS=128;
const OBSERVATION_TTL_MS=45000;
const FILES={
  monitor:['browser-companion','commander-monitor.json',16384],
  registry:['multi-chat','registry.json',32768],
  events:['multi-chat','events.json',32768]
};
function integerCount(x) { return Number.isSafeInteger(x)&&x>=0&&x<=1000000?x:null; }
function shortText(x,max) { return typeof x==='string'?x.slice(0,max):null; }
function isRecord(x) { return x!==null&&typeof x==='object'&&!Array.isArray(x); }
function timestamp(x) { return Number.isSafeInteger(x)&&x>0; }
function fallback(state,reason) {
  return {
    schema:1, source:'MMZ_OWNER_PRIVATE_MONITOR_CONTRACT',
    authority:'LOCAL_UNAUTHENTICATED', state, reason,
    device:null,version:null,profile:null,gui:'UNVERIFIED',browser:'UNVERIFIED',
    activeOperations:null,workflow:{state:'UNVERIFIED',runCount:null,engineEnabled:null},
    delivery:{state:'UNVERIFIED',pending:null},multiChat:{count:0,observedUnverified:0,checkpointOnly:0,projects:[]},
    chatIdentityAuthenticated:false
  };
}
async function readBounded(root,subdir,file,maxBytes,uid) {
  try {
    // Only the exact owner-private root and children; reject symlinks and
    // group/other access at every layer, as the MMZ native source requires.
    for (const path of [root,join(root,subdir)]) {
      const st=await lstat(path);
      if (!st.isDirectory() || st.isSymbolicLink() || st.uid!==uid || (st.mode&0o077)!==0) return null;
    }
    const name=join(root,subdir,file);
    const st=await lstat(name);
    if (!st.isFile() || st.isSymbolicLink() || st.uid!==uid ||
        (st.mode&0o077)!==0 || st.nlink!==1 || st.size<2 || st.size>maxBytes) return null;
    // O_NOFOLLOW mitigates file replacement with a symlink at open.
    const fs=await import('node:fs');
    const fh=await open(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    try {
      const after=await fh.stat();
      if (!after.isFile()||after.uid!==uid||(after.mode&0o077)!==0||
          after.nlink!==1||after.size<2||after.size>maxBytes||
          after.dev!==st.dev||after.ino!==st.ino) return null;
      const buffer=Buffer.allocUnsafe(maxBytes+1);
      const {bytesRead}=await fh.read(buffer,0,maxBytes+1,0);
      if (bytesRead!==after.size) return null;
      const data=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));
      return isRecord(data)?data:null;
    } finally { await fh.close(); }
  } catch { return null; }
}
function projects(registry,events,now) {
  const result={count:0,observedUnverified:0,checkpointOnly:0,projects:[]};
  if (!isRecord(registry)||registry.schema!==1||registry.kind!=='MULTI_CHAT_PROJECT_REGISTRY'||
      !Array.isArray(registry.projects)||registry.projects.length>MAX_PROJECTS) return result;
  const validEvents=isRecord(events)&&events.schema===1&&events.kind==='CHAT_COMPANION_OBSERVATIONS'&&
    Array.isArray(events.observations)&&events.observations.length<=MAX_EVENTS?events.observations:[];
  const seen=new Set();
  for(const p of registry.projects) {
    if(!isRecord(p)||!SAFE_ID.test(p.projectId)||seen.has(p.projectId)||
       typeof p.title!=='string'||p.title.length<1||p.title.length>120)continue;
    seen.add(p.projectId);
    const chatId=typeof p.chatId==='string'&&SAFE_CHAT.test(p.chatId)?p.chatId:null;
    const cp=p.checkpoint;
    const checkpoint=isRecord(cp)&&typeof cp.evidenceRef==='string'&&
      cp.evidenceRef.length>0&&cp.evidenceRef.length<=240&&
      timestamp(cp.verifiedAtEpochMs)&&cp.verifiedAtEpochMs<=now+30000;
    let state=checkpoint?'CHECKPOINT_ONLY':'UNKNOWN_STALE';
    if(checkpoint)result.checkpointOnly++;
    let latest=null;
    for(const evt of validEvents){
      if(!chatId||!isRecord(evt)||evt.projectId!==p.projectId||evt.chatId!==chatId||
         !['TAB_VISIBLE','TAB_HIDDEN','TAB_CLOSED','PAGE_PRESENT'].includes(evt.state)||
         !timestamp(evt.observedAtEpochMs)||evt.observedAtEpochMs>now+30000)continue;
      if(!latest||evt.observedAtEpochMs>latest.observedAtEpochMs)latest=evt;
    }
    if(latest&&latest.state!=='TAB_CLOSED'&&now-latest.observedAtEpochMs<=OBSERVATION_TTL_MS) {
      state='OBSERVED_UNVERIFIED';result.observedUnverified++;
      if(checkpoint)result.checkpointOnly--;
    }
    result.projects.push({id:p.projectId,title:p.title,state,chatLinked:chatId!==null});
  }
  result.count=result.projects.length;
  return result;
}
export async function readOwnerEvidence(options={}) {
  const os=options.platform??process.platform;
  const uid=options.uid??(typeof process.getuid==='function'?process.getuid():null);
  if(os!=='linux'||!Number.isSafeInteger(uid))return fallback('UNSUPPORTED','Owner-private Linux state adapter only');
  const root=options.root??join(homedir(),'.local','state','chatgpt-remote-commander');
  const now=options.now??Date.now();
  const [monitor,registry,events]=await Promise.all(Object.values(FILES).map(([dir,file,max])=>readBounded(root,dir,file,max,uid)));
  const multiChat=projects(registry,events,now);
  if(!monitor||monitor.schema!==1||monitor.kind!=='COMMANDER_LIVE_MONITOR')
    return {...fallback('UNVERIFIED','Private monitor unavailable or untrusted'),multiChat};
  if(!timestamp(monitor.observedAtEpochMs)||!timestamp(monitor.expiresAtEpochMs)||
     monitor.observedAtEpochMs>now+30000||monitor.expiresAtEpochMs<now||
     monitor.expiresAtEpochMs<=monitor.observedAtEpochMs||
     monitor.expiresAtEpochMs-monitor.observedAtEpochMs>120000)
    return {...fallback('STALE','Private monitor timestamp invalid or expired'),multiChat};
  const identity=isRecord(monitor.identity)?monitor.identity:{};
  const gui=isRecord(monitor.gui)?monitor.gui:{};
  const browser=isRecord(monitor.browser)?monitor.browser:{};
  const ops=isRecord(monitor.operations)?monitor.operations:{};
  const workflow=isRecord(monitor.workflows)?monitor.workflows:{};
  const delivery=isRecord(monitor.delivery)?monitor.delivery:{};
  return {
    schema:1, source:'MMZ_OWNER_PRIVATE_MONITOR_CONTRACT', authority:'LOCAL_UNAUTHENTICATED',
    state:'CONNECTED', reason:null,
    device:shortText(identity.deviceName,80),version:shortText(identity.version,40),
    profile:shortText(identity.profile,64),
    gui:gui.available===true?'AVAILABLE_REQUIRES_AUTH':gui.available===false?'BLOCKED':'UNVERIFIED',
    browser:browser.available===true?'AVAILABLE_REQUIRES_AUTH':browser.available===false?'BLOCKED':'UNVERIFIED',
    activeOperations:integerCount(ops.active),
    workflow:{state:Object.keys(workflow).length?'OBSERVED_UNVERIFIED':'UNVERIFIED',
      engineEnabled:typeof workflow.engineEnabled==='boolean'?workflow.engineEnabled:null,
      runCount:integerCount(workflow.runCount)},
    delivery:{state:Object.keys(delivery).length?'OBSERVED_UNVERIFIED':'UNVERIFIED',
      pending:integerCount(delivery.pending)},
    multiChat,chatIdentityAuthenticated:false
  };
}
