// V2 owner-session heartbeat worker. It is a companion, not a second MCP
// endpoint, browser profile, password broker, GUI takeover, or V1 component.
// Launched by the native Windows task under the actual interactive owner's
// token after a separate effective-SID / desktop-session gate. The state file
// is MONITORING ONLY and MUST NEVER authorize chats, tools or logins.
import {mkdir,readFile,lstat,writeFile,rename,unlink} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {homedir,userInfo} from 'node:os';
import {fileURLToPath} from 'node:url';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function fail(code){throw Object.assign(new Error(code),{code});}
export function makeOwnerSeatHeartbeat({
  user,seat,pid,now=new Date().toISOString()
}={}){
 if(typeof user!=='string'||!ID.test(user)||user==='.'||user==='..'||
  !Number.isSafeInteger(seat)||seat<1||seat>128||
  !Number.isSafeInteger(pid)||pid<1||pid>2**31-1||
  typeof now!=='string'||!Number.isFinite(Date.parse(now)))
  fail('V2_OWNER_SEAT_HEARTBEAT_INVALID');
 return Object.freeze({schema:1,
  role:'V2_OWNER_INTERACTIVE_SESSION_WORKER',
  state:'ALIVE_NOT_AUTHENTICATED',
  account:user,sessionId:seat,workerPid:pid,observedAt:now,
  authority:'MONITOR_ONLY_NATIVE_TOKEN_RECHECK_REQUIRED',
  browserAttached:false,savedLoginVerified:false,
  chatSessionAttested:false,canExecuteUserActions:false,
  credentialsRead:false,profileCopied:false});
}
export async function writeOwnerSeatHeartbeat({dir,heartbeat}={}){
 if(typeof dir!=='string'||!isAbsolute(dir)||!heartbeat||
   heartbeat.schema!==1||heartbeat.role!=='V2_OWNER_INTERACTIVE_SESSION_WORKER')
  fail('V2_OWNER_SEAT_STATE_INVALID');
 await mkdir(dir,{recursive:true,mode:0o700});
 const meta=await lstat(dir);
 if(!meta.isDirectory()||meta.isSymbolicLink())
  fail('V2_OWNER_SEAT_STATE_UNSAFE');
 const f=join(dir,'latest.json'),tmp=join(dir,'.latest-'+process.pid+'.tmp');
 const text=JSON.stringify(heartbeat)+'\n';
 try{
  await writeFile(tmp,text,{flag:'wx',mode:0o600});
  await rename(tmp,f);
 }catch(e){
  await unlink(tmp).catch(()=>{});
  fail('V2_OWNER_SEAT_STATE_WRITE_FAILED');
 }
 return {path:f,bytes:Buffer.byteLength(text)};
}
export async function startOwnerSeatWorker({
  dir,user,seat,pid=process.pid,periodMs=30000,signal
}={}){
 if(!Number.isSafeInteger(periodMs)||periodMs<1000||periodMs>60000)
  fail('V2_OWNER_SEAT_PERIOD_INVALID');
 if(signal?.aborted) return;
 do{
  await writeOwnerSeatHeartbeat({dir,heartbeat:makeOwnerSeatHeartbeat({user,seat,pid})});
  if(signal?.aborted)break;
  await new Promise(resolve=>{
   const timer=setTimeout(()=>{signal?.removeEventListener('abort',done);resolve();},periodMs);
   function done(){clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();}
   signal?.addEventListener('abort',done,{once:true});
  });
 }while(!signal?.aborted);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [flag,seatText]=process.argv.slice(2);
  if(flag!=='--owner-seat'||!/^[1-9][0-9]{0,2}$/.test(seatText||'')||
     process.argv.length!==4||process.platform!=='win32')
   fail('V2_OWNER_SEAT_ARGS_INVALID');
  if(!process.env.LOCALAPPDATA||!process.env.USERNAME||
     userInfo().username.toLowerCase()!==process.env.USERNAME.toLowerCase())
   fail('V2_OWNER_SEAT_WRONG_ACCOUNT');
  const dir=join(process.env.LOCALAPPDATA,'ChatGPTRemoteCommander','V2OwnerSeat');
  const abort=new AbortController();
  process.once('SIGINT',()=>abort.abort());
  process.once('SIGTERM',()=>abort.abort());
  await startOwnerSeatWorker({dir,user:process.env.USERNAME,seat:Number(seatText),signal:abort.signal});
 }catch(e){process.stderr.write(String(e.code||'V2_OWNER_SEAT_FAILED')+'\n');process.exitCode=2;}
}
