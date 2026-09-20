import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BODY = 16 * 1024 * 1024;
const LOOPBACK = '127.0.0.1';

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
export function writeRouterStateAtomic(file,state,expectedGeneration=null) {
  file=localFile(file);
  const next=validateRouterState(state);
  if(fs.existsSync(file) && expectedGeneration!==null){
    const current=readRouterState(file);
    if(current.generation!==expectedGeneration) fail('ROUTER_GENERATION_CONFLICT');
  }
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.tmp-'+process.pid+'-'+Date.now().toString(36);
  fs.writeFileSync(tmp,JSON.stringify(next,null,2)+'\n',{encoding:'utf8',mode:0o600});
  fs.renameSync(tmp,file);
  return next;
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
    if(['host','connection','transfer-encoding','content-length'].includes(low)) continue;
    if(v!==undefined)out[k]=v;
  }
  return out;
}
export async function startRouter({listenPort,stateFile,runtimeFile=null,host=LOOPBACK}) {
  listenPort=validPort(listenPort);stateFile=localFile(stateFile);
  if(host!==LOOPBACK) fail('ROUTER_LOOPBACK_ONLY');
  const inflight=new Map();
  const bump=(port,delta)=>{const n=Math.max(0,(inflight.get(port)||0)+delta);if(n)inflight.set(port,n);else inflight.delete(port);};
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/router/status' && req.method==='GET'){
      try{
        const state=readRouterState(stateFile);
        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
        res.end(JSON.stringify({ok:true,router:true,listenPort,state,inflightByPort:Object.fromEntries(inflight)}));
      }catch(error){
        res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});
        res.end(JSON.stringify({ok:false,router:true,error:error.message}));
      }
      return;
    }
    let state,body;
    try{state=readRouterState(stateFile);body=await collect(req);}
    catch(error){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:error.message}));return;}
    const port=state.active.port;bump(port,1);
    let accounted=false;
    const done=()=>{if(accounted)return;accounted=true;bump(port,-1);};
    const headers=proxyHeaders(req.headers);headers['content-length']=String(body.length);
    const upstream=http.request({host:LOOPBACK,port,path:req.url||'/',method:req.method,headers},up=>{
      const h=proxyHeaders(up.headers);
      res.writeHead(up.statusCode||502,h);
      up.pipe(res);
      up.once('end',done);up.once('close',done);up.once('error',done);
    });
    upstream.once('error',error=>{done();if(!res.headersSent)res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:'ROUTER_UPSTREAM_UNAVAILABLE',detail:error.code||'ERROR'}));});
    upstream.end(body);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(listenPort,host,resolve);});
  if(runtimeFile){
    runtimeFile=localFile(runtimeFile);fs.mkdirSync(path.dirname(runtimeFile),{recursive:true});
    const state={schema:1,pid:process.pid,host,port:listenPort,stateFile,startedAt:new Date().toISOString()};
    const tmp=runtimeFile+'.tmp-'+process.pid;fs.writeFileSync(tmp,JSON.stringify(state,null,2)+'\n',{encoding:'utf8',mode:0o600});fs.renameSync(tmp,runtimeFile);
  }
  return {
    server,
    close:()=>new Promise(resolve=>server.close(resolve)),
    status:()=>({listenPort,state:readRouterState(stateFile),inflightByPort:Object.fromEntries(inflight)})
  };
}
function parse(argv){
  const o={};
  for(let i=0;i<argv.length;i++){
    const a=argv[i],v=argv[++i];if(v===undefined)fail('ROUTER_ARGUMENT');
    if(a==='--listen-port')o.listenPort=Number(v);
    else if(a==='--state-file')o.stateFile=v;
    else if(a==='--runtime-file')o.runtimeFile=v;
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
