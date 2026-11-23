'use strict';
// Unprivileged, same-owner browser extension transport. NEVER imports or calls Core tools.
const http = require('node:http');
const {randomBytes, createHash, timingSafeEqual} = require('node:crypto');

const APP = 'REMOTE_COMMANDER_CHAT_COMPANION';
const ORIGIN = /^(?:chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[0-9a-f-]{36})$/;
const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 2048;
function equal(a,b) {
  const aa=Buffer.from(String(a)), bb=Buffer.from(String(b));
  return aa.length===bb.length && timingSafeEqual(aa,bb);
}
function json(res,status,data,origin='') {
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    ...(origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})
  });
  res.end(JSON.stringify(data));
}
async function readBody(req) {
  if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))throw Error('CONTENT_TYPE');
  const lengthHeader=req.headers['content-length'];
  const size=lengthHeader===undefined?null:Number(lengthHeader);
  if(size!==null&&(!Number.isSafeInteger(size)||size<1||size>MAX_BYTES))
    throw Error('BODY_LENGTH');
  let bytes=0,chunks=[];
  for await(const chunk of req){ bytes+=chunk.length;if(bytes>MAX_BYTES)throw Error('BODY_TOO_LARGE');chunks.push(chunk); }
  if(bytes<1||(size!==null&&bytes!==size))throw Error('BODY_LENGTH_MISMATCH');
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('BAD_JSON');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('BAD_JSON');
  return body;
}
function createCompanionBridge({port=41267, now=()=>Date.now(), maxClients=8}={}) {
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('BRIDGE_PORT_INVALID');
  const clients=new Map();
  const salt=randomBytes(32);
  const owned={phase:'NO_CHAT',localRef:null,lastSeenAtEpochMs:0};
  function observeOwned(url){
    try{
      const u=new URL(url);
      if(u.protocol!=='https:'||!['chatgpt.com','chat.openai.com'].includes(u.hostname)
        ||u.username||u.password||u.port)throw Error('EXTERNAL_URL');
      const m=/^\/(?:g\/[^/]{1,120}\/)?c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(u.pathname);
      owned.phase=m?'CHAT_OPEN':'CHAT_OTHER';
      owned.localRef=m?createHash('sha256').update(salt).update(m[1].toLowerCase()).digest('hex').slice(0,32):null;
    }catch{owned.phase='NO_CHAT';owned.localRef=null;}
    owned.lastSeenAtEpochMs=now();
    return {...owned};
  }
  const state={port, listening:false, lastError:null, received:0};
  let server=null,pairCode='',pairExpiry=0,attemptWindow=0,attempts=0;
  function newCode(){
    pairCode=randomBytes(8).toString('hex').toUpperCase();
    pairExpiry=now()+300000;
    return {code:pairCode,expiresAtEpochMs:pairExpiry};
  }
  newCode();
  const observe=()=>[...clients.values()].map(x=>({
    origin:x.origin,lastSeenAtEpochMs:x.lastSeenAtEpochMs,
    phase:x.phase,localRef:x.localRef
  }));
  function status(){return {
    app:APP,schema:1,port:state.port,listening:state.listening,
    pairedBrowsers:clients.size,observationsReceived:state.received,
    ownedBrowser:{...owned,chatAuthentication:'NOT_VERIFIED',actionAuthorization:false},
    lastError:state.lastError
  };}
  async function handle(req,res){
    const origin=String(req.headers.origin||'');
    if(!ORIGIN.test(origin))return json(res,403,{ok:false,code:'EXTENSION_ORIGIN_REQUIRED'});
    if(req.headers.host!==('127.0.0.1:'+state.port))
      return json(res,403,{ok:false,code:'BRIDGE_HOST_DENIED'},origin);
    if(req.method==='OPTIONS'){
      res.writeHead(204,{
        'Access-Control-Allow-Origin':origin,
        'Access-Control-Allow-Methods':'POST, OPTIONS',
        'Access-Control-Allow-Headers':'Authorization, Content-Type',
        'Access-Control-Max-Age':'300','Vary':'Origin'
      });res.end();return;
    }
    if(req.method!=='POST'||!['/pair','/observation','/revoke'].includes(req.url))
      return json(res,404,{ok:false,code:'ROUTE_DENIED'},origin);
    let body;try{body=await readBody(req);}
    catch{return json(res,400,{ok:false,code:'BODY_INVALID'},origin);}
    if(req.url==='/pair'){
      if(now()-attemptWindow>60000){attemptWindow=now();attempts=0;}
      if(++attempts>10)return json(res,429,{ok:false,code:'PAIR_RATE_LIMIT'},origin);
      if(clients.size>=maxClients)return json(res,409,{ok:false,code:'CLIENT_LIMIT'},origin);
      if(typeof body.code!=='string'||!/^[A-F0-9]{16}$/.test(body.code)||
        now()>pairExpiry||!equal(body.code,pairCode))
        return json(res,403,{ok:false,code:'PAIR_CODE_INVALID'},origin);
      const token=randomBytes(32).toString('hex'),digest=createHash('sha256').update(token).digest('hex');
      clients.set(digest,{origin,lastSeenAtEpochMs:now(),phase:'PAIRED',localRef:null});
      newCode();
      return json(res,200,{ok:true,app:APP,schema:1,token},origin);
    }
    const header=req.headers.authorization??'';
    if(typeof header!=='string'||!/^Bearer [a-f0-9]{64}$/.test(header))
      return json(res,401,{ok:false,code:'BEARER_REQUIRED'},origin);
    const digest=createHash('sha256').update(header.slice(7)).digest('hex');
    const record=clients.get(digest);
    if(!record||record.origin!==origin)
      return json(res,403,{ok:false,code:'PAIR_SCOPE_DENIED'},origin);
    if(req.url==='/revoke'){
      clients.delete(digest);
      return json(res,200,{ok:true,revoked:true},origin);
    }
    if(body.schema!==1||!['CHAT_OPEN','CHAT_OTHER','NO_CHAT'].includes(body.phase)
      ||(body.phase==='CHAT_OPEN'&&!CHAT_ID.test(body.conversationId))
      ||(body.phase!=='CHAT_OPEN'&&body.conversationId!=null))
      return json(res,400,{ok:false,code:'OBSERVATION_INVALID'},origin);
    record.phase=body.phase;record.lastSeenAtEpochMs=now();
    record.localRef=body.phase==='CHAT_OPEN'
      ? createHash('sha256').update(salt).update(body.conversationId.toLowerCase()).digest('hex').slice(0,32)
      : null;
    state.received++;
    return json(res,200,{ok:true,receipt:state.received},origin);
  }
  async function start(){
    if(server)return status();
    const candidate=http.createServer((req,res)=>{void handle(req,res).catch(()=>{
      if(!res.writableEnded)json(res,500,{ok:false,code:'BRIDGE_FAILURE'});
    });});
    candidate.requestTimeout=5000;candidate.headersTimeout=4000;
    candidate.maxHeadersCount=24;
    try{
      await new Promise((resolve,reject)=>{
        candidate.once('error',reject);
        candidate.listen(port,'127.0.0.1',()=>{candidate.removeListener('error',reject);resolve();});
      });
      server=candidate;state.port=candidate.address().port;state.listening=true;state.lastError=null;
      server.on('error',error=>{state.lastError=String(error.code||'BRIDGE_ERROR');});
      return status();
    }catch(error){
      candidate.close();state.lastError=String(error.code||'BRIDGE_BIND_FAILED');throw error;
    }
  }
  async function stop(){
    if(!server)return;
    const old=server;server=null;
    await new Promise(resolve=>old.close(()=>resolve()));
    state.listening=false;clients.clear();newCode();
  }
  return {start,stop,status,newCode,observe,observeOwned,pairing:()=>({
    ...status(),...(!state.listening?{}:{code:pairCode,expiresAtEpochMs:pairExpiry})
  })};
}
module.exports={createCompanionBridge,APP};
