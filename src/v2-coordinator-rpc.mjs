// V2-R3 central coordinator RPC, owner-worker process only.
// Loopback HTTP *only*: remote hosts require a separately authenticated,
// protected tunnel. Do not expose this port to LAN / WAN or browser origins.
// Token hashes and their observed identity bindings must come from trusted
// enrollment inventory, never from a client's HTTP JSON.
import http from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {assertV2CallerBinding} from './v2-routing-contract.mjs';

const TOKEN=/^[A-Za-z0-9_-]{43,128}$/;
const SHA=/^[a-f0-9]{64}$/;
const BIND_FIELDS=['hostId','principalId','profileId','conversationId'];
function fail(code){throw Object.assign(new Error(code),{code});}
function identity(record){
 if(!record||typeof record!=='object'||Array.isArray(record)||
    Object.keys(record).length!==BIND_FIELDS.length ||
    BIND_FIELDS.some(k=>typeof record[k]!=='string'))
    fail('V2_RPC_TRUSTED_BINDING_INVALID');
 return Object.freeze(Object.fromEntries(BIND_FIELDS.map(k=>[k,record[k]])));
}
/** Static, secret-free inventory: token sha256 -> transport-attested caller. */
export function createV2RpcTokenLookup(entries){
 if(!Array.isArray(entries)||entries.length<1||entries.length>1000)
   fail('V2_RPC_TRUSTED_TOKENS_REQUIRED');
 const pins=[];
 for(const entry of entries){
  if(!entry||typeof entry!=='object'||Object.keys(entry).sort().join(',')!=='binding,tokenSha256'||
    typeof entry.tokenSha256!=='string'||!SHA.test(entry.tokenSha256))
    fail('V2_RPC_TRUSTED_TOKEN_INVALID');
  if(pins.some(x=>x.key===entry.tokenSha256))fail('V2_RPC_DUPLICATE_TOKEN');
  pins.push({key:entry.tokenSha256,bytes:Buffer.from(entry.tokenSha256,'hex'),
    binding:identity(entry.binding)});
 }
 return async raw=>{
  if(typeof raw!=='string'||!TOKEN.test(raw))return null;
  const hash=createHash('sha256').update(raw,'utf8').digest();
  let found=null;
  for(const pin of pins){
   // Scan the entire inventory without early return, even for a match.
   if(timingSafeEqual(hash,pin.bytes))found=pin.binding;
  }
  return found;
 };
}
function send(res,status,payload){
 res.writeHead(status,{'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'});
 res.end(JSON.stringify(payload));
}
function errorStatus(code){
 if(code==='V2_RPC_BODY_SHAPE')return 400;
 if(code==='V2_COORDINATOR_RECEIPT_CONFLICT'||
    code==='V2_ARTIFACT_RECEIPT_CONFLICT'||
    code==='V2_ARTIFACT_EXISTING_CONFLICT'||
    code==='V2_ARTIFACT_RECEIPT_WITHOUT_FILE')return 409;
 if(code==='V2_ARTIFACT_ARGUMENT_INVALID'||code==='V2_ARTIFACT_LEASE_INVALID')
   return 422;
 if(code==='V2_COORDINATOR_RESOURCE_BUSY')return 409;
 if(code==='V2_COORDINATOR_AUTH_REQUIRED')return 403;
 if(code==='V2_COORDINATOR_STALE_LEASE'||code==='V2_COORDINATOR_CLOCK_ROLLBACK')return 409;
 if(code.startsWith('V2_ROUTE_')||code==='V2_COORDINATOR_LEASE_INVALID'||
    code==='V2_COORDINATOR_TTL_INVALID'||code==='V2_COORDINATOR_GLOBAL_RESOURCE_UNMAPPED'||
    code==='V2_COORDINATOR_GLOBAL_RESOURCE_INVALID'||
    code==='V2_COORDINATOR_RECEIPT_INPUT_INVALID')return 422;
 return 503; // Unknown exceptions must not expose internals or succeed.
}
export function createV2CoordinatorRpcServer({coordinator,lookupToken,artifactActuator=null}={}){
 if(!coordinator||typeof lookupToken!=='function'||
  ['acquire','renew','assertCurrent','release','commitFencedReceipt','getFencedReceipt'].some(k=>typeof coordinator[k]!=='function'))
  fail('V2_RPC_TRUSTED_BOOTSTRAP_REQUIRED');
 if(artifactActuator!==null&&
   (typeof artifactActuator.create!=='function'||typeof artifactActuator.observe!=='function'))
  fail('V2_RPC_TRUSTED_ARTIFACT_REQUIRED');
 const server=http.createServer(async(req,res)=>{
  const url=req.url;
  if(req.method!=='POST'||typeof url!=='string'||!/^\/v2\/lease\/(acquire|renew|assert|release|commit-receipt|get-receipt|create-artifact|observe-artifact)$/.test(url)){
   send(res,404,{error:'V2_RPC_NOT_FOUND'});return;
  }
  if((url.endsWith('/create-artifact')||url.endsWith('/observe-artifact'))&&
      artifactActuator===null){
   send(res,404,{error:'V2_RPC_NOT_FOUND'});return;
  }
  if(req.headers.origin||req.headers.cookie||req.headers['transfer-encoding']||
     req.headers['content-type']!=='application/json'){
   send(res,400,{error:'V2_RPC_REQUEST_FORMAT'});return;
  }
  const token=/^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(req.headers.authorization??'')?.[1];
  if(!token){send(res,401,{error:'V2_RPC_UNAUTHORIZED'});return;}
  let binding;
  try{binding=await lookupToken(token);}
  catch{send(res,503,{error:'V2_RPC_AUTH_BACKEND_UNAVAILABLE'});return;}
  if(!binding){send(res,401,{error:'V2_RPC_UNAUTHORIZED'});return;}
  // Hard bound request size even for chunked content is important for RPC.
  const length=req.headers['content-length'];
  if(!/^[0-9]+$/.test(length??'')||Number(length)>8192||Number(length)<2){
   send(res,413,{error:'V2_RPC_BODY_SIZE'});return;
  }
  const chunks=[];let received=0;
  try{
   for await(const chunk of req){
    received+=chunk.length;
    if(received>8192)throw fail('V2_RPC_BODY_SIZE');
    chunks.push(chunk);
   }
   if(received!==Number(length))throw fail('V2_RPC_BODY_SIZE');
  }catch{
   send(res,413,{error:'V2_RPC_BODY_SIZE'});return;
  }
  let input;
  try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{send(res,400,{error:'V2_RPC_BODY_JSON'});return;}
  if(!input||typeof input!=='object'||Array.isArray(input)||
   !Object.hasOwn(input,'route')||
   Object.keys(input).some(k=>!['route','lease','ttlMs','receiptId','digest','content'].includes(k))){
   send(res,400,{error:'V2_RPC_BODY_SHAPE'});return;
  }
  const action=url.split('/').at(-1);
  try{
   const route=assertV2CallerBinding(input.route,binding);
   const receiptAction=action==='commit-receipt'||action==='get-receipt';
   const artifactAction=action==='create-artifact'||action==='observe-artifact';
   if(!receiptAction&&!artifactAction&&
      (input.receiptId!==undefined||input.digest!==undefined))
     throw fail('V2_RPC_BODY_SHAPE');
   if(input.content!==undefined&&action!=='create-artifact')
     throw fail('V2_RPC_BODY_SHAPE');
   if(artifactAction&&(input.ttlMs!==undefined||input.digest!==undefined))
     throw fail('V2_RPC_BODY_SHAPE');
   if(receiptAction&&input.ttlMs!==undefined)throw fail('V2_RPC_BODY_SHAPE');
   if(action==='get-receipt'&&(input.lease!==undefined||input.digest!==undefined))
     throw fail('V2_RPC_BODY_SHAPE');
   if(action==='commit-receipt'&&input.lease===undefined)
     throw fail('V2_RPC_BODY_SHAPE');
   let output;
   if(action==='create-artifact'){
    if(input.lease===undefined||input.receiptId===undefined||
       typeof input.content!=='string')throw fail('V2_RPC_BODY_SHAPE');
    output=await artifactActuator.create({
     route,lease:input.lease,receiptId:input.receiptId,content:input.content});
   }else if(action==='observe-artifact'){
    if(input.lease!==undefined||input.content!==undefined||
       input.receiptId===undefined)throw fail('V2_RPC_BODY_SHAPE');
    output=await artifactActuator.observe({route,receiptId:input.receiptId});
   }else if(action==='commit-receipt'){
    output=await coordinator.commitFencedReceipt({
     route,lease:input.lease,receiptId:input.receiptId,digest:input.digest});
   }else if(action==='get-receipt'){
    output=await coordinator.getFencedReceipt({route,receiptId:input.receiptId});
   }else if(action==='acquire'){
    if(input.lease!==undefined)throw fail('V2_RPC_BODY_SHAPE');
    output=await coordinator.acquire({route,ttlMs:input.ttlMs});
   }else {
    if(input.ttlMs!==undefined&&action!=='renew')throw fail('V2_RPC_BODY_SHAPE');
    if(action==='renew')output=await coordinator.renew({route,lease:input.lease,ttlMs:input.ttlMs});
    else if(action==='assert')output=await coordinator.assertCurrent({route,lease:input.lease});
    else output=await coordinator.release({route,lease:input.lease});
   }
   send(res,200,{ok:true,value:output});
  }catch(e){
   const code=typeof e?.code==='string'&&
       /^(V2_COORDINATOR_|V2_ROUTE_|V2_RPC_BODY_SHAPE|V2_ARTIFACT_)/.test(e.code)
       ?e.code:'V2_RPC_OPERATION_FAILED';
   send(res,errorStatus(code),{ok:false,error:code});
  }
 });
 server.maxHeadersCount=24;
 server.maxConnections=48;
 server.requestTimeout=6000;
 server.headersTimeout=5000;
 server.keepAliveTimeout=1500;
 return Object.freeze({
  async listen(port=0){
   if(!Number.isInteger(port)||port<0||port>65535)fail('V2_RPC_PORT_INVALID');
   if(server.listening)fail('V2_RPC_ALREADY_LISTENING');
   await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});
   });
   const a=server.address();
   if(a?.address!=='127.0.0.1')fail('V2_RPC_LOOPBACK_BIND_FAILED');
   return Object.freeze({host:a.address,port:a.port});
  },
  async close(){
   if(!server.listening)return;
   server.closeIdleConnections();
   await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  },
  get listening(){return server.listening;}
 });
}
