import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAX_BODY = 16 * 1024 * 1024;
const LOOPBACK = '127.0.0.1';
const INTERNAL_AUTH_HEADER = 'x-commander-tunnel-auth';
const INTERNAL_AUTH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MODERN_VERSION = '2026-07-28';
const SUBSCRIPTION_ID_META_KEY = 'io.modelcontextprotocol/subscriptionId';
function parseMcpBody(body) {
  try { return JSON.parse(body.toString('utf8')); } catch { return null; }
}
function isModernMcp(req,message) {
  const headerVersion=String(req.headers['mcp-protocol-version']||'');
  const metaVersion=message?.params?._meta?.['io.modelcontextprotocol/protocolVersion'];
  return headerVersion===MODERN_VERSION || metaVersion===MODERN_VERSION;
}
function sseFrame(message) { return 'event: message\ndata: '+JSON.stringify(message)+'\n\n'; }
function subscriptionMeta(id) { return { [SUBSCRIPTION_ID_META_KEY]: id }; }
function advertiseToolListChanged(payload) {
  if (!payload || typeof payload!=='object' || !payload.result || typeof payload.result!=='object') return payload;
  const caps=(payload.result.capabilities && typeof payload.result.capabilities==='object') ? payload.result.capabilities : (payload.result.capabilities={});
  const tools=(caps.tools && typeof caps.tools==='object') ? caps.tools : (caps.tools={});
  tools.listChanged=true;
  return payload;
}
const ROUTER_SOURCE_FILE = fileURLToPath(import.meta.url);
const ROUTER_SOURCE_SHA256 = createHash('sha256').update(fs.readFileSync(ROUTER_SOURCE_FILE)).digest('hex');

function fail(code) { throw new Error(code); }
function validPort(value) {
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<1024||n>65535) fail('ROUTER_INVALID_PORT');
  return n;
}
function localFile(file) {
  if(typeof file!=='string'||!path.isAbsolute(file)||/^(?:\\\\|\/\/)/.test(file)) fail('ROUTER_LOCAL_FILE_REQUIRED');
  const resolved=path.resolve(file);
  let cursor=path.parse(resolved).root;
  for(const bit of resolved.slice(cursor.length).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,bit);
    if(fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) fail('ROUTER_LINK_NOT_ALLOWED');
  }
  return resolved;
}
export function validateRouterState(value) {
  if(!value||value.schema!==1||typeof value.profile!=='string'||!value.profile) fail('ROUTER_STATE_INVALID');
  if(!Number.isSafeInteger(value.generation)||value.generation<1) fail('ROUTER_STATE_INVALID');
  const active=value.active;
  if(!active||typeof active!=='object') fail('ROUTER_STATE_INVALID');
  validPort(active.port);
  for(const key of ['version','commit','configSha256']){
    if(typeof active[key]!=='string'||!active[key]) fail('ROUTER_STATE_INVALID');
  }
  if(!/^[0-9a-f]{40}$/.test(active.commit)) fail('ROUTER_STATE_INVALID');
  if(!/^[0-9a-f]{64}$/.test(active.configSha256)) fail('ROUTER_STATE_INVALID');
  return value;
}
export function readRouterState(file) {
  file=localFile(file);
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.nlink>1) fail('ROUTER_STATE_ALIAS');
  return validateRouterState(JSON.parse(fs.readFileSync(file,'utf8')));
}

const WRITE_LOCK_SUFFIX = '.write-lock';
const RECOVERY_LOCK_SUFFIX = '.recovery-lock';
const sha256 = data => createHash('sha256').update(data).digest('hex');
function ownerAlive(pid) {
  try { process.kill(pid, 0); return 'ALIVE_OR_INACCESSIBLE'; }
  catch (error) { return error?.code === 'ESRCH' ? 'ABSENT' : 'UNKNOWN'; }
}
export function inspectRouterWriteLock(stateFile, { minAgeMs=30000 }={}) {
  const file=localFile(stateFile);
  if(!Number.isSafeInteger(minAgeMs)||minAgeMs<0) fail('ROUTER_LOCK_AGE_INVALID');
  const lock=file+WRITE_LOCK_SUFFIX;
  if(!fs.existsSync(lock)) return {present:false,code:'ROUTER_LOCK_NOT_FOUND'};
  let fd;
  try {
    const entry=fs.lstatSync(lock);
    if(!entry.isFile()||entry.isSymbolicLink()||entry.nlink!==1) fail('ROUTER_LOCK_UNTRUSTED');
    fd=fs.openSync(lock,'r');
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.nlink!==1||
       (stat.dev!==entry.dev || stat.ino!==entry.ino)||
       (process.platform!=='win32' && (stat.uid!==process.getuid()||(stat.mode & 0o077)!==0)))
      fail('ROUTER_LOCK_UNTRUSTED');
    const bytes=fs.readFileSync(fd);
    const lockSha256=sha256(bytes);
    const ageMs=Math.max(0,Date.now()-stat.mtimeMs);
    let meta=null;
    try { meta=JSON.parse(bytes.toString('utf8')); } catch {}
    const valid=meta?.schema===1 &&
      meta?.kind==='commander-router-write-lock' &&
      Number.isSafeInteger(meta?.pid) && meta.pid>0 &&
      typeof meta?.hostname==='string' && meta.hostname.length>0 &&
      typeof meta?.nonce==='string' && /^[0-9a-f-]{36}$/.test(meta.nonce) &&
      typeof meta?.createdAt==='string' && Number.isFinite(Date.parse(meta.createdAt));
    const sameHost=valid && meta.hostname===os.hostname();
    const pidState=sameHost?ownerAlive(meta.pid):'UNKNOWN';
    const staleCandidate=Boolean(sameHost && pidState==='ABSENT' && ageMs>=minAgeMs);
    return {present:true,code:staleCandidate?'ROUTER_LOCK_STALE_CANDIDATE':
      valid?'ROUTER_LOCK_NOT_PROVEN_STALE':'ROUTER_LOCK_UNRECOGNIZED',
      lockSha256,ageMs,ownerPid:valid?meta.pid:null,
      sameHost:Boolean(sameHost),ownerProcess:pidState,staleCandidate};
  } finally { if(fd!==undefined) fs.closeSync(fd); }
}
function exactStateDigest(file) {
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.nlink!==1) fail('ROUTER_STATE_ALIAS');
  return sha256(fs.readFileSync(file));
}
// This is a deliberately explicit, no-auto-replay repair API. The operator must
// supply hashes observed independently. An absent process is necessary, but not
// sufficient; the candidate must also be old enough and match the current host.
export function recoverRouterWriteLock({
  stateFile,expectedLockSha256,expectedStateSha256=null,expectedStateAbsent=false,minAgeMs=30000
}) {
  const file=localFile(stateFile);
  if(!/^[0-9a-f]{64}$/.test(expectedLockSha256) ||
     (expectedStateAbsent ? expectedStateSha256!==null : !/^[0-9a-f]{64}$/.test(expectedStateSha256)))
    fail('ROUTER_LOCK_RECOVERY_HASH_REQUIRED');
  const stateMatches=()=>expectedStateAbsent ? !fs.existsSync(file) :
    exactStateDigest(file)===expectedStateSha256;
  // Guard serializes recovery attempts and tells cooperating writers to refuse
  // new writes until the exact lock and state snapshot have been reconciled.
  const guard=file+RECOVERY_LOCK_SUFFIX;
  let guardFd;
  try {guardFd=fs.openSync(guard,'wx',0o600);}
  catch(error) {
    if(error?.code==='EEXIST') fail('ROUTER_LOCK_RECOVERY_IN_PROGRESS');
    throw error;
  }
  try {
    if(!stateMatches()) fail('ROUTER_LOCK_RECOVERY_STATE_CHANGED');
    const snapshot=inspectRouterWriteLock(file,{minAgeMs});
    if(!snapshot.staleCandidate) fail('ROUTER_LOCK_RECOVERY_NOT_SAFE');
    if(snapshot.lockSha256!==expectedLockSha256) fail('ROUTER_LOCK_RECOVERY_LOCK_CHANGED');
    // Quarantine rather than destroy evidence. The target is exclusive and the
    // resulting directory entry can be inspected before the guard is released.
    const quarantine=file+WRITE_LOCK_SUFFIX+'.recovered-'+randomUUID();
    fs.renameSync(file+WRITE_LOCK_SUFFIX,quarantine);
    const recoveredSha256=sha256(fs.readFileSync(quarantine));
    if(recoveredSha256!==expectedLockSha256 ||
       !stateMatches()) {
      if(!fs.existsSync(file+WRITE_LOCK_SUFFIX)) fs.renameSync(quarantine,file+WRITE_LOCK_SUFFIX);
      fail('ROUTER_LOCK_RECOVERY_RECHECK_FAILED');
    }
    return {ok:true,code:'ROUTER_LOCK_RECOVERED',stateSha256:expectedStateSha256,
      lockSha256:recoveredSha256,quarantine,expectedStateAbsent,operationReplayed:false,serviceRestarted:false};
  } finally {
    fs.closeSync(guardFd);
    fs.rmSync(guard);
  }
}
export function writeRouterStateAtomic(file,state,expectedGeneration=null) {
  file=localFile(file);
  const next=validateRouterState(state);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(fs.existsSync(file+RECOVERY_LOCK_SUFFIX)) fail('ROUTER_LOCK_RECOVERY_IN_PROGRESS');
  // Exclusive creation serializes cooperative writers on both Windows and Linux.
  // A crash-stale lock deliberately fails closed; it must be reconciled by an
  // owner-controlled recovery procedure, never silently ignored.
  const lock=file+'.write-lock';
  let lockFd;
  try { lockFd=fs.openSync(lock,'wx',0o600); }
  catch(error) {
    if(error?.code==='EEXIST') fail('ROUTER_STATE_WRITE_LOCKED');
    throw error;
  }
  let tmp=null;
  try {
    // Metadata allows safe, conservative diagnosis after an interrupted writer.
    const lockRecord={schema:1,kind:'commander-router-write-lock',
      pid:process.pid,hostname:os.hostname(),nonce:randomUUID(),createdAt:new Date().toISOString()};
    fs.writeFileSync(lockFd,JSON.stringify(lockRecord)+'\n',{encoding:'utf8'});
    fs.fsyncSync(lockFd);
    if(fs.existsSync(file+RECOVERY_LOCK_SUFFIX)) fail('ROUTER_LOCK_RECOVERY_IN_PROGRESS');
    if(expectedGeneration===null) {
      if(fs.existsSync(file)) fail('ROUTER_STATE_ALREADY_EXISTS');
    } else {
      if(!Number.isSafeInteger(expectedGeneration)||expectedGeneration<1||
         next.generation!==expectedGeneration+1) fail('ROUTER_GENERATION_CONFLICT');
      let current;
      try { current=readRouterState(file); }
      catch(error) {
        if(error?.code==='ENOENT') fail('ROUTER_GENERATION_CONFLICT');
        throw error;
      }
      if(current.generation!==expectedGeneration) fail('ROUTER_GENERATION_CONFLICT');
      if(current.profile!==next.profile) fail('ROUTER_PROFILE_MISMATCH');
    }
    tmp=file+'.tmp-'+process.pid+'-'+Date.now().toString(36);
    const fd=fs.openSync(tmp,'wx',0o600);
    try {
      fs.writeFileSync(fd,JSON.stringify(next,null,2)+'\n',{encoding:'utf8'});
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp,file);
    tmp=null;
    return next;
  } finally {
    if(tmp){try{fs.rmSync(tmp);}catch{}}
    fs.closeSync(lockFd);
    fs.rmSync(lock);
  }
}
function readPrivateTunnelAdmission(authFile) {
  if (authFile === undefined || authFile === null) return null;
  const file = localFile(authFile);
  let stat;
  try { stat = fs.lstatSync(file); } catch { fail('ROUTER_AUTH_FILE_UNAVAILABLE'); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== 43 ||
      (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)))
    fail('ROUTER_AUTH_FILE_UNTRUSTED');
  const secret = fs.readFileSync(file, 'utf8');
  if (!INTERNAL_AUTH_PATTERN.test(secret)) fail('ROUTER_AUTH_SECRET_INVALID');
  const expected = createHash('sha256').update(secret).digest();
  return req => {
    const supplied = req.headers[INTERNAL_AUTH_HEADER];
    return typeof supplied === 'string' && INTERNAL_AUTH_PATTERN.test(supplied) &&
      timingSafeEqual(expected, createHash('sha256').update(supplied).digest());
  };
}
function collect(req) {
  return new Promise((resolve,reject)=>{
    const chunks=[];let bytes=0;
    req.on('data',chunk=>{bytes+=chunk.length;if(bytes>MAX_BODY){reject(new Error('ROUTER_BODY_TOO_LARGE'));req.destroy();return;}chunks.push(chunk);});
    req.on('end',()=>resolve(Buffer.concat(chunks)));
    req.on('error',reject);
  });
}
function proxyHeaders(headers) {
  const out={};
  for(const [k,v] of Object.entries(headers)){
    const low=k.toLowerCase();
    if(['host','connection','transfer-encoding','content-length',INTERNAL_AUTH_HEADER].includes(low)) continue;
    if(v!==undefined)out[k]=v;
  }
  return out;
}
function boundedText(value,max=160) {
  return typeof value==='string' && value.length>0 && value.length<=max ? value : '';
}
function requestMetadata(req,body) {
  let rpcMethod=boundedText(req.headers['mcp-method'],96),rpcName=boundedText(req.headers['mcp-name'],128);
  if(!rpcMethod || !rpcName){
    try{
      const value=JSON.parse(body.toString('utf8'));
      if(!rpcMethod)rpcMethod=boundedText(value?.method,96);
      if(!rpcName)rpcName=boundedText(value?.params?.name,128);
    }catch{}
  }
  let pathname='/';
  try{pathname=new URL(req.url||'/','http://127.0.0.1').pathname.slice(0,256)||'/';}catch{}
  const method=boundedText((req.method||'').toUpperCase(),16);
  const cancellable=rpcMethod==='subscriptions/listen' || (method==='GET' && (pathname==='/mcp' || pathname==='/sse'));
  return {method,path:pathname,rpcMethod,rpcName,cancellable,startedAt:new Date().toISOString()};
}
export async function startRouter({listenPort,stateFile,runtimeFile=null,host=LOOPBACK,authFile=null,protectedMode=false,hostId=null,verifyCaller=null,authorizeTool=null}) {
  listenPort=validPort(listenPort);stateFile=localFile(stateFile);
  if(host!==LOOPBACK) fail('ROUTER_LOOPBACK_ONLY');
  const admit = readPrivateTunnelAdmission(authFile);
  // Candidate-only. The two callbacks MUST be supplied by V1-01 trusted ingress;
  // no RPC header, client assertion or profile flag may stand in for verification.
  if(protectedMode && (!admit || typeof verifyCaller!=='function' ||
     typeof authorizeTool!=='function' || typeof hostId!=='string' ||
     !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(hostId)))
    fail('ROUTER_TRUSTED_INGRESS_REQUIRED');
  const inflight=new Map();
  const inflightDetails=new Map();
  const subscriptions=new Map();
  let subscriptionSequence=0;
  let requestSequence=0;
  let observedState=readRouterState(stateFile);
  let observedGeneration=observedState.generation;
  let legacyMcpSeen=false,modernMcpSeen=false,lastGenerationChangeAt=null;
  const publishToolsChanged=()=>{
    for(const sub of subscriptions.values()){
      if(!sub.toolsListChanged || sub.res.destroyed) continue;
      try{sub.res.write(sseFrame({jsonrpc:'2.0',method:'notifications/tools/list_changed',params:{_meta:subscriptionMeta(sub.id)}}));}
      catch{}
    }
  };
  const routeTimer=setInterval(()=>{
    try{
      const next=readRouterState(stateFile);
      if(next.generation!==observedGeneration){
        observedGeneration=next.generation;observedState=next;lastGenerationChangeAt=new Date().toISOString();
        publishToolsChanged();
      }
    }catch{}
  },100);
  routeTimer.unref?.();
  const bump=(port,delta)=>{const n=Math.max(0,(inflight.get(port)||0)+delta);if(n)inflight.set(port,n);else inflight.delete(port);};
  const begin=(port,meta)=>{
    const id=++requestSequence;
    if(!inflightDetails.has(port))inflightDetails.set(port,new Map());
    inflightDetails.get(port).set(id,{id,...meta});
    bump(port,1);
    return id;
  };
  const finish=(port,id)=>{
    const group=inflightDetails.get(port);
    if(!group || !group.delete(id))return;
    if(group.size===0)inflightDetails.delete(port);
    bump(port,-1);
  };
  const detailObject=()=>Object.fromEntries([...inflightDetails].map(([port,group])=>[port,[...group.values()]]));
  const server=http.createServer(async(req,res)=>{
    if(admit && !admit(req)){
      res.writeHead(403,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({ok:false,error:'ROUTER_TUNNEL_AUTH_REQUIRED'}));
      return;
    }
    // Protected admission precedes status exposure, subscriptions and forwarding.
    // A tunnel secret authenticates the local hop only; it is NOT a chat identity.
    let verifiedCaller=null, admissionState=null;
    // Pin the route before any async trust decision. A grant for an in-flight
    // operation is not transferable across a cutover or rollback.
    const sameAdmissionRoute = next => admissionState && next.profile===admissionState.profile &&
      next.generation===admissionState.generation && ['port','version','commit','configSha256'].every(
        key => next.active[key]===admissionState.active[key]);
    const refuseChangedRoute = () => {
      res.writeHead(409,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({ok:false,error:'ROUTER_ADMISSION_ROUTE_CHANGED'}));
    };
    if(protectedMode){
      const header=req.headers.authorization;
      const token=typeof header==='string' && header.length<=8200 &&
        /^Bearer [A-Za-z0-9._~+\\/=-]+$/.test(header) ? header.slice(7) : null;
      const deny=(code='trusted_transport_required')=>{
        res.writeHead(403,{'content-type':'application/json','cache-control':'no-store'});
        res.end(JSON.stringify({ok:false,error:code}));
      };
      if(!token){deny();return;}
      if(req.headers['mcp-session-id']!==undefined ||
         req.headers.cookie!==undefined ||
         req.headers['last-event-id']!==undefined ||
         req.headers['proxy-authorization']!==undefined){
        deny('ROUTER_UNTRUSTED_SESSION_HEADER');return;
      }
      try{
        admissionState=readRouterState(stateFile);
        const verifiedCandidate=await verifyCaller(token);
        // The issuer may reuse a mutable cache object. Bind this request to an
        // immutable point-in-time copy, including its original expiry, before
        // asynchronous grant checks can run.
        verifiedCaller=verifiedCandidate && typeof verifiedCandidate==='object' &&
          !Array.isArray(verifiedCandidate) ? Object.freeze({...verifiedCandidate}) : null;
        const identity=['hostId','profileId','principalId','conversationId'];
        if(!verifiedCaller || verifiedCaller.verified!==true ||
           verifiedCaller.source!=='v1-01-trusted-ingress' ||
           !Number.isSafeInteger(verifiedCaller.expiresAtMs) ||
           verifiedCaller.expiresAtMs<=Date.now() ||
           identity.some(k=>typeof verifiedCaller[k]!=='string' ||
             !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(verifiedCaller[k])) ||
           verifiedCaller.hostId!==hostId ||
           verifiedCaller.profileId!==admissionState.profile){
          deny();return;
        }
      }catch{deny();return;}
      if(req.method!=='POST' && !(req.method==='GET' && req.url==='/router/status')){
        deny('ROUTER_PROTECTED_METHOD_UNSUPPORTED');return;
      }
      if(req.method==='POST' && req.url!=='/mcp'){
        deny('ROUTER_PROTECTED_PATH_UNSUPPORTED');return;
      }
    }
    if(req.url==='/router/status' && req.method==='GET'){
      if(protectedMode){
        let statusAllowed=false;
        try{
          statusAllowed=(await authorizeTool(Object.freeze({...verifiedCaller}),
            Object.freeze({tool:'router/status',arguments:Object.freeze({}),
              rpcMethod:'router/status'})))===true;
        }catch{statusAllowed=false;}
        if(!statusAllowed || verifiedCaller.expiresAtMs<=Date.now()){
          res.writeHead(403,{'content-type':'application/json','cache-control':'no-store'});
          res.end(JSON.stringify({ok:false,error:'ROUTER_STATUS_GRANT_REQUIRED'}));
          return;
        }
      }
      try{
        const state=readRouterState(stateFile);
        if(protectedMode && !sameAdmissionRoute(state)){refuseChangedRoute();return;}
        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
        res.end(JSON.stringify({ok:true,router:true,listenPort,sourceSha256:ROUTER_SOURCE_SHA256,state,inflightByPort:Object.fromEntries(inflight),inflightDetailsByPort:detailObject(),schemaContinuity:{toolsListSubscribers:[...subscriptions.values()].filter(x=>x.toolsListChanged).length,totalSubscriptions:subscriptions.size,legacyMcpSeen,modernMcpSeen,observedGeneration,lastGenerationChangeAt}}));
      }catch(error){
        res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});
        res.end(JSON.stringify({ok:false,router:true,error:error.message}));
      }
      return;
    }
    let state,body;
    try{state=protectedMode ? admissionState : readRouterState(stateFile);body=await collect(req);}
    catch(error){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:error.message}));return;}
    const message=parseMcpBody(body);
    if(protectedMode){
      const deny=(reason)=>{
        res.writeHead(403,{'content-type':'application/json','cache-control':'no-store'});
        res.end(JSON.stringify({ok:false,error:reason}));
      };
      const approvedMethods=new Set(['initialize','ping','notifications/initialized',
        'server/discover','tools/list','tools/call','subscriptions/listen']);
      if(!message || Array.isArray(message) ||
         message.jsonrpc!=='2.0' || typeof message.method!=='string' ||
         !approvedMethods.has(message.method) ||
         (req.headers['mcp-method']!==undefined &&
           req.headers['mcp-method']!==message.method)){
        deny('ROUTER_MCP_METHOD_UNTRUSTED');return;
      }
      if(message.method==='tools/call'){
        const name=message?.params?.name;
        const argumentsValue=message?.params?.arguments;
        if(typeof name!=='string'||!/^[a-zA-Z_][a-zA-Z0-9_.-]{0,127}$/.test(name) ||
           !argumentsValue || typeof argumentsValue!=='object' ||
           Array.isArray(argumentsValue) ||
           (req.headers['mcp-name']!==undefined && req.headers['mcp-name']!==name)){
          deny('ROUTER_TOOL_NAME_INVALID');return;
        }
        let granted=false;
        try {
          // V1-01 must authorize this exact operation, resource and arguments.
          // A mere tool-name grant cannot authorize an unrestricted payload.
          const invocation=Object.freeze({tool:name,arguments:argumentsValue,
            rpcMethod:message.method});
          granted=(await authorizeTool(Object.freeze({...verifiedCaller}),invocation))===true;
        }catch{granted=false;}
        if(!granted){deny('ROUTER_TOOL_GRANT_REQUIRED');return;}
      }
      // No async work between this recheck and opening the upstream request.
      try{if(!sameAdmissionRoute(readRouterState(stateFile))){refuseChangedRoute();return;}}
      catch{refuseChangedRoute();return;}
      // An upload may outlive token validity while collect() reads the body.
      if(verifiedCaller.expiresAtMs<=Date.now()){
        deny('ROUTER_CALLER_EXPIRED');return;
      }
    }
    const meta=requestMetadata(req,body);
    const modern=meta.path==='/mcp' && meta.method==='POST' && isModernMcp(req,message);
    if(meta.path==='/mcp' && meta.method==='POST' && meta.rpcMethod){
      if(modern)modernMcpSeen=true;else legacyMcpSeen=true;
    }
    if(modern && meta.rpcMethod==='subscriptions/listen'){
      if(req.headers['mcp-method']!=='subscriptions/listen'){
        res.writeHead(400,{'content-type':'application/json','cache-control':'no-store'});
        res.end(JSON.stringify({jsonrpc:'2.0',id:message?.id??null,error:{code:-32020,message:'Mcp-Method header does not match request body'}}));
        return;
      }
      if(message?.id===undefined || message?.id===null){
        res.writeHead(400,{'content-type':'application/json','cache-control':'no-store'});
        res.end(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32600,message:'subscriptions/listen requires a request id'}}));
        return;
      }
      const requested=message?.params?.notifications;
      const toolsListChanged=requested?.toolsListChanged===true;
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache, no-store','connection':'keep-alive'});
      res.flushHeaders?.();
      const key=++subscriptionSequence;
      const sub={key,id:message.id,res,toolsListChanged};
      subscriptions.set(key,sub);
      const cleanup=()=>subscriptions.delete(key);
      req.once('aborted',cleanup);req.once('close',cleanup);res.once('close',cleanup);res.once('error',cleanup);
      res.write(sseFrame({jsonrpc:'2.0',method:'notifications/subscriptions/acknowledged',params:{notifications:toolsListChanged?{toolsListChanged:true}:{},_meta:subscriptionMeta(message.id)}}));
      return;
    }
    const port=state.active.port;
    const requestId=begin(port,meta);
    let accounted=false;
    const done=()=>{if(accounted)return;accounted=true;finish(port,requestId);};
    const headers=proxyHeaders(req.headers);
    if(protectedMode){
      // Never leak caller OAuth bearer or user-provided 'verified' metadata to
      // a legacy backend. V1-01 must independently enforce any privileged effect.
      for(const k of Object.keys(headers)){
        if(k.toLowerCase()==='authorization' || k.toLowerCase().startsWith('x-commander-'))
          delete headers[k];
      }
    }
    headers['content-length']=String(body.length);
    let downstreamClosed=false,upstreamResponse=null;
    const drainAfterDownstreamClose=()=>{
      downstreamClosed=true;
      // Never cancel a potentially mutating upstream request merely because the
      // MCP client disconnected. Continue consuming the backend response so its
      // real completion/close event can retire inflight accounting safely.
      if(upstreamResponse && !upstreamResponse.complete && !upstreamResponse.destroyed){upstreamResponse.unpipe(res);upstreamResponse.resume();}
    };
    res.once('close',drainAfterDownstreamClose);
    const upstream=http.request({host:LOOPBACK,port,path:req.url||'/',method:req.method,headers},up=>{
      upstreamResponse=up;
      up.once('end',done);up.once('close',done);up.once('error',done);
      if(downstreamClosed || res.destroyed){up.resume();return;}
      if(modern && meta.rpcMethod==='server/discover'){
        const chunks=[];let bytes=0,overflow=false;
        up.on('data',chunk=>{bytes+=chunk.length;if(bytes>MAX_BODY){overflow=true;}else chunks.push(Buffer.from(chunk));});
        up.once('end',()=>{
          if(downstreamClosed || res.destroyed)return;
          const h=proxyHeaders(up.headers);
          if(protectedMode)delete h['mcp-session-id'];
          if(overflow){
            const data=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:message?.id??null,error:{code:-32603,message:'ROUTER_DISCOVER_RESPONSE_TOO_LARGE'}}));
            h['content-type']='application/json';h['content-length']=String(data.length);res.writeHead(502,h);res.end(data);return;
          }
          let data=Buffer.concat(chunks);
          try{
            const payload=advertiseToolListChanged(JSON.parse(data.toString('utf8')));
            data=Buffer.from(JSON.stringify(payload));
          }catch{}
          h['content-length']=String(data.length);
          res.writeHead(up.statusCode||502,h);res.end(data);
        });
        return;
      }
      const h=proxyHeaders(up.headers);
      if(protectedMode)delete h['mcp-session-id'];
      res.writeHead(up.statusCode||502,h);
      up.pipe(res);
    });
    upstream.once('error',error=>{done();if(!res.destroyed){if(!res.headersSent)res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:'ROUTER_UPSTREAM_UNAVAILABLE',detail:error.code||'ERROR'}));}});
    upstream.end(body);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(listenPort,host,resolve);});
  if(runtimeFile){
    runtimeFile=localFile(runtimeFile);fs.mkdirSync(path.dirname(runtimeFile),{recursive:true});
    const state={schema:1,pid:process.pid,host,port:listenPort,stateFile,sourceSha256:ROUTER_SOURCE_SHA256,startedAt:new Date().toISOString()};
    const tmp=runtimeFile+'.tmp-'+process.pid;fs.writeFileSync(tmp,JSON.stringify(state,null,2)+'\n',{encoding:'utf8',mode:0o600});fs.renameSync(tmp,runtimeFile);
  }
  return {
    server,
    close:()=>{
      clearInterval(routeTimer);
      for(const sub of subscriptions.values()){
        try{sub.res.write(sseFrame({jsonrpc:'2.0',id:sub.id,result:{_meta:subscriptionMeta(sub.id)}}));sub.res.end();}catch{}
      }
      subscriptions.clear();
      return new Promise(resolve=>server.close(resolve));
    },
    status:()=>({listenPort,sourceSha256:ROUTER_SOURCE_SHA256,state:readRouterState(stateFile),inflightByPort:Object.fromEntries(inflight),inflightDetailsByPort:detailObject(),schemaContinuity:{toolsListSubscribers:[...subscriptions.values()].filter(x=>x.toolsListChanged).length,totalSubscriptions:subscriptions.size,legacyMcpSeen,modernMcpSeen,observedGeneration,lastGenerationChangeAt}})
  };
}
function parse(argv){
  const o={};
  for(let i=0;i<argv.length;i++){
    const a=argv[i],v=argv[++i];if(v===undefined)fail('ROUTER_ARGUMENT');
    if(a==='--listen-port')o.listenPort=Number(v);
    else if(a==='--state-file')o.stateFile=v;
    else if(a==='--runtime-file')o.runtimeFile=v;
    else if(a==='--auth-file')o.authFile=v;
    else fail('ROUTER_ARGUMENT');
  }
  if(!o.listenPort||!o.stateFile)fail('ROUTER_ARGUMENT');
  return o;
}
const invoked=process.argv[1]?pathToFileURL(path.resolve(process.argv[1])).href:'';
if(invoked===import.meta.url){
  try{const args=parse(process.argv.slice(2));await startRouter(args);console.log('ROUTER_READY');}
  catch(error){console.error(error.message);process.exit(1);}
}
