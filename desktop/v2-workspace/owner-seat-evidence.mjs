// V2 owner-session heartbeat view: monitoring only, never credentials or tool authority.
// Adapts the native V2 owner-seat-agent.mjs heartbeat contract, not arbitrary V1 data.
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { userInfo } from 'node:os';

const MAX_BYTES=8192, STALE_MS=90000, FUTURE_MS=10000;
const BROWSERS=['brave','firefox','chrome','msedge'];
const ID=/^[A-Za-z0-9._-]{1,128}$/;
const NO_DATA=reason=>Object.freeze({
  source:'V2_OWNER_SEAT_HEARTBEAT',status:reason,authority:'MONITOR_ONLY_UNAUTHENTICATED',
  browserCounts:null,observedWindows:null,observedAt:null,seat:null,
  authenticated:false,canExecute:false,loginVerified:false
});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
async function readPrivateCandidate(file,parent){
  try {
    const dir=await lstat(parent);
    if(!dir.isDirectory()||dir.isSymbolicLink())return null;
    const before=await lstat(file);
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
      before.size<2||before.size>MAX_BYTES)return null;
    const fd=await open(file,fsConstants.O_RDONLY|(fsConstants.O_NOFOLLOW??0));
    try {
      const after=await fd.stat();
      if(!after.isFile()||after.nlink!==1||after.size!==before.size||
        after.ino!==before.ino||after.dev!==before.dev)return null;
      const buffer=Buffer.alloc(MAX_BYTES+1);
      const {bytesRead}=await fd.read(buffer,0,MAX_BYTES+1,0);
      if(bytesRead!==before.size)return null;
      const raw=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));
      return plain(raw)?raw:null;
    }finally{await fd.close();}
  }catch{return null;}
}
export async function readOwnerSeatHeartbeat({
  os=process.platform,base=process.env.LOCALAPPDATA,account=process.env.USERNAME,
  observedAccount=userInfo().username,now=Date.now()
}={}){
  if(os!=='win32')return NO_DATA('UNSUPPORTED');
  if(typeof base!=='string'||!base||typeof account!=='string'||!ID.test(account)||
    typeof observedAccount!=='string'||observedAccount.toLowerCase()!==account.toLowerCase()||
    !Number.isSafeInteger(now))return NO_DATA('NOT_CONFIGURED');
  const dir=join(base,'ChatGPTRemoteCommander','V2OwnerSeat');
  const file=join(dir,'latest.json');
  const raw=await readPrivateCandidate(file,dir);
  if(!raw)return NO_DATA('UNAVAILABLE');
  if(raw.schema!==1||raw.role!=='V2_OWNER_INTERACTIVE_SESSION_WORKER'||
    raw.state!=='ALIVE_NOT_AUTHENTICATED'||raw.authority!=='MONITOR_ONLY_NATIVE_TOKEN_RECHECK_REQUIRED'||
    typeof raw.account!=='string'||raw.account.toLowerCase()!==account.toLowerCase()||
    !Number.isSafeInteger(raw.sessionId)||raw.sessionId<1||raw.sessionId>128||
    !Number.isSafeInteger(raw.workerPid)||raw.workerPid<1||
    raw.browserAttached!==false||raw.savedLoginVerified!==false||
    raw.chatSessionAttested!==false||raw.canExecuteUserActions!==false||
    raw.credentialsRead!==false||raw.profileCopied!==false||
    typeof raw.observedAt!=='string')
    return NO_DATA('INVALID');
  const at=Date.parse(raw.observedAt);
  if(!Number.isFinite(at)||at>now+FUTURE_MS||now-at>STALE_MS)
    return NO_DATA('STALE');
  const census=raw.browserCensus;
  let browserCounts=null;
  if(plain(census)&&census.status==='OBSERVED'&&
      BROWSERS.every(k=>Number.isSafeInteger(census[k])&&census[k]>=0&&census[k]<=1000)){
    browserCounts=Object.fromEntries(BROWSERS.map(k=>[k,census[k]]));
  }
  const windows=raw.windowInventory;
  let observedWindows=null;
  if(plain(windows)&&windows.status==='OBSERVED'&&Array.isArray(windows.windows)&&windows.windows.length<=32){
    if(windows.windows.every(w=>plain(w)&&BROWSERS.includes(w.app) &&
       Number.isSafeInteger(w.pid)&&w.pid>=1 &&
       typeof w.windowId==='string'&&/^[1-9][0-9]{0,19}$/.test(w.windowId)&&
       typeof w.processStartTicks==='string'&&/^[1-9][0-9]{0,19}$/.test(w.processStartTicks))){
      observedWindows=Object.fromEntries(BROWSERS.map(k=>[k,windows.windows.filter(w=>w.app===k).length]));
    }
  }
  return Object.freeze({
    source:'V2_OWNER_SEAT_HEARTBEAT',status:'OBSERVED_UNVERIFIED',
    authority:'MONITOR_ONLY_UNAUTHENTICATED',
    browserCounts,observedWindows,observedAt:new Date(at).toISOString(),
    seat:raw.sessionId,authenticated:false,canExecute:false,loginVerified:false
  });
}
