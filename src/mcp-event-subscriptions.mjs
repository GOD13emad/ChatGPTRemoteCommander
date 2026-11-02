// Opt-in, authenticated MCP Events subscription engine. Inert until a real
// cryptographic host verifier, authoritative project ACL and transport are wired.
// A successful webhook is only receipt by a callback, never a chat-delivery ACK.
import https from 'node:https';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import {
 EVENT_NAME,EVENT_CATALOG,canonicalEventArguments,callbackHost,
 resolveVerifiedCallbackTarget,validateEventSubscription,
 signStandardWebhook,verifyChallengeEcho
} from './mcp-events-security.mjs';

const error=(code)=>{throw new Error('MCP_EVENTS_'+code);};
const bodyMax=256*1024;
const subscriptionLimit=128;
const MAX_TTL=24*60*60*1000;
// Some Windows filesystem providers do not expose Node fsync on regular
// files or directory handles. Keep private temp+atomic-rename writes, tolerating
// only narrowly identified unsupported fsync operations on Windows.
async function syncHandle(handle){
 try { await handle.sync(); return true; }
 catch(error){
  if(process.platform==='win32'&&['EPERM','EINVAL','ENOTSUP','EOPNOTSUPP'].includes(error?.code))return false;
  throw error;
 }
}

export function buildVerifiedHttpsSender({resolve=resolveVerifiedCallbackTarget,request=https.request}={}){
 if(typeof resolve!=='function'||typeof request!=='function')error('INVALID_SENDER');
 return async ({url,secret,id,subscriptionId,body,timeoutMs=5000})=>{
  if(!Buffer.isBuffer(secret)||secret.length<24||secret.length>64||
     typeof body!=='string'||Buffer.byteLength(body)>bodyMax)error('INVALID_OUTBOUND_PAYLOAD');
  const destination=callbackHost(url);
  // Resolve and reject ALL non-public records before every actual connection.
  const resolved=await resolve(destination.url);
  if(resolved.hostname!==destination.hostname||!resolved.address)error('DNS_MISMATCH');
  const tick=Math.floor(Date.now()/1000);
  const signature=signStandardWebhook(secret,id,tick,body);
  const bytes=Buffer.byteLength(body);
  const options={
   protocol:'https:',hostname:destination.hostname,port:443,
   path:new URL(destination.url).pathname+new URL(destination.url).search,
   method:'POST',agent:false,servername:destination.hostname,
   rejectUnauthorized:true,timeout:timeoutMs,
   // Pins the verified address while retaining original DNS name for TLS SNI
   // and certificate hostname validation. No automatic redirect handling.
   lookup(_host,_opts,cb){cb(null,resolved.address,4);},
   headers:{'content-type':'application/json','content-length':bytes,
    'webhook-id':id,'webhook-timestamp':String(tick),
    'webhook-signature':signature,'X-MCP-Subscription-Id':subscriptionId}
  };
  return await new Promise((done,fail)=>{
   let req;
   try{
    req=request(options,(resp)=>{
     const chunks=[];let total=0;
     resp.on('data',(part)=>{
      total+=part.length;
      if(total>4096){req.destroy(new Error('MCP_EVENTS_RESPONSE_TOO_LARGE'));return;}
      chunks.push(part);
     });
     resp.on('error',fail);
     resp.on('end',()=>done({status:resp.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('timeout',()=>req.destroy(new Error('MCP_EVENTS_TIMEOUT')));
    req.on('error',fail);
    req.end(body,'utf8');
   }catch(e){fail(e);}
  });
 };
}

function subscriptionId(principal,url,args){
 return 'sub_'+createHash('sha256').update(JSON.stringify([principal,url,EVENT_NAME,args])).digest('hex').slice(0,40);
}
function safePrincipal(who){
 if(!who||typeof who.ownerSubject!=='string'||!who.ownerSubject||
    typeof who.tenantId!=='string'||!who.tenantId||
    typeof who.projectId!=='string'||!who.projectId)
  error('HOST_PRINCIPAL_INVALID');
 return who.tenantId+'|'+who.ownerSubject;
}

export function createEventSubscriptionService({
 file, authorize, send, revalidateOwner, sleep=ms=>new Promise(r=>setTimeout(r,ms)),
 now=()=>Date.now(), ttlMs=MAX_TTL
}={}){
 if(typeof authorize!=='function'||typeof send!=='function'||typeof sleep!=='function'||
    typeof file!=='string'||!path.isAbsolute(file)||
    typeof now!=='function'||!Number.isSafeInteger(ttlMs)||
    ttlMs<=0||ttlMs>MAX_TTL)error('SERVICE_NOT_CONFIGURED');
 const storage=path.resolve(file);
 const lock=storage+'.lock';
 const load=async()=>{
  let state;
  try{state=JSON.parse(await readFile(storage,'utf8'));}
  catch(e){if(e.code==='ENOENT')return {version:1,subscriptions:[]};throw e;}
  if(state?.version!==1||!Array.isArray(state.subscriptions)||
    state.subscriptions.length>subscriptionLimit)error('STATE_INVALID');
  for(const item of state.subscriptions){
   if(typeof item.id!=='string'||typeof item.principal!=='string'||
      typeof item.url!=='string'||typeof item.project_id!=='string'||
      typeof item.secret!=='string'||!Number.isSafeInteger(item.expiresAt))
    error('STATE_INVALID');
  }
  return state;
 };
 const mutate=async(effect)=>{
  await mkdir(path.dirname(storage),{recursive:true,mode:0o700});
  // Explicit collision is safer than stealing a lock held by another writer.
  const lockfd=await open(lock,'wx',0o600);
  try{
   const state=await load();
   const result=await effect(state);
   const tmp=storage+'.'+process.pid+'.'+randomBytes(8).toString('hex')+'.tmp';
   const fd=await open(tmp,'wx',0o600);
   try{
    await fd.writeFile(JSON.stringify(state)+'\n','utf8');
    await syncHandle(fd);
   }finally{await fd.close();}
   try{await rename(tmp,storage);}finally{await unlink(tmp).catch(()=>{});}
   const dir=await open(path.dirname(storage),'r');
   try{await syncHandle(dir);}finally{await dir.close();}
   return result;
  }finally{
   await lockfd.close();
   await unlink(lock);
  }
 };
 const verify=async(row)=>{
  const challenge=randomBytes(32).toString('base64url');
  const body=JSON.stringify({type:'verification',challenge});
  const response=await send({url:row.url,secret:Buffer.from(row.secret,'base64'),
   id:'msg_verification_'+randomBytes(16).toString('hex'),
   subscriptionId:row.id,body});
  let value;
  try{value=JSON.parse(response.body);}catch{error('CHALLENGE_FAILED');}
  if(response.status<200||response.status>299||
     !verifyChallengeEcho(challenge,value?.challenge))error('CHALLENGE_FAILED');
 };
 return Object.freeze({
  list:async(accessToken)=>{
   // The injected verifier must validate actual OAuth issuer/audience/scope.
   await authorize({accessToken,projectId:'__catalog__',catalog:true});
   return {events:[EVENT_CATALOG]};
  },
  subscribe:async(params,accessToken)=>{
   const projectId=JSON.parse(canonicalEventArguments(params?.arguments)).project_id;
   const verified=await authorize({accessToken,projectId});
   if(verified.projectId!==projectId)error('ACL_MISMATCH');
   const principal=safePrincipal(verified);
   const validated=validateEventSubscription(params,{
    authenticatedByHost:true,verifiedHostPrincipal:principal,
    authorizedProjectIds:[projectId]
   });
   const id=subscriptionId(principal,validated.url,
    canonicalEventArguments(params.arguments));
   if(id!==validated.subscriptionId)error('SUBSCRIPTION_ID_MISMATCH');
   const requested=params.ttlMs;
   if(requested!==undefined&&requested!==null&&(!Number.isSafeInteger(requested)||requested<1000))
    error('TTL_INVALID');
   const grant=Math.min(ttlMs,requested??ttlMs);
   const expiresAt=now()+grant;
   if(!Number.isSafeInteger(expiresAt))error('TIME_INVALID');
   const row={id,principal,project_id:projectId,url:validated.url,
    secret:validated.signingKey.toString('base64'),expiresAt};
   // The verification happens before persistence or application delivery.
   await verify(row);
   return mutate(state=>{
    const index=state.subscriptions.findIndex(x=>x.id===id);
    if(index===-1&&state.subscriptions.length>=subscriptionLimit)error('STORE_FULL');
    if(index===-1)state.subscriptions.push(row);
    else state.subscriptions[index]=row;
    return {id,refreshBefore:new Date(expiresAt).toISOString(),cursor:null,truncated:false};
   });
  },
  unsubscribe:async(params,accessToken)=>{
   if(params?.name!==EVENT_NAME||params?.delivery?.mode!=='webhook')error('EVENT_INVALID');
   const projectId=JSON.parse(canonicalEventArguments(params.arguments)).project_id;
   const verified=await authorize({accessToken,projectId});
   if(verified.projectId!==projectId)error('ACL_MISMATCH');
   const principal=safePrincipal(verified);
   const {url}=callbackHost(params.delivery.url);
   const id=subscriptionId(principal,url,canonicalEventArguments(params.arguments));
   return mutate(state=>{
    state.subscriptions=state.subscriptions.filter(x=>x.id!==id);
    return {};
   });
  },
  publish:async(event)=>{
   if(event?.name!==EVENT_NAME||!event?.data||typeof event.data.project_id!=='string'||
      typeof event.eventId!=='string'||!event.eventId.startsWith('evt_')||
      typeof event.timestamp!=='string')error('EVENT_INVALID');
   const serialized=JSON.stringify({...event,cursor:null});
   if(Buffer.byteLength(serialized)>bodyMax)error('PAYLOAD_TOO_LARGE');
   const state=await load();
   let receipts=0;
   for(const row of state.subscriptions){
    if(row.expiresAt<=now()||row.project_id!==event.data.project_id)continue;
    // The service never stores a bearer token. A privileged caller must
    // revalidate the exact principal/project through a current IdP + ACL.
    if(typeof revalidateOwner!=='function')error('OWNER_REVALIDATION_REQUIRED');
    const allowed=await revalidateOwner(Object.freeze({
     principal:row.principal,projectId:row.project_id,subscriptionId:row.id
    }));
    if(allowed!==true)continue;
    let acknowledged=false;
    for(let attempt=0;attempt<3;attempt++){
     let response;
     try{
      response=await send({url:row.url,secret:Buffer.from(row.secret,'base64'),
       id:event.eventId,subscriptionId:row.id,body:serialized});
     }catch(e){
      if(attempt===2)throw e;
      await sleep(200*(2**attempt));
      continue;
     }
     if(response.status>=200&&response.status<300){
      acknowledged=true;break;
     }
     if(response.status===410||response.status===413||
        response.status>=400&&response.status<500&&response.status!==429)
      break;
     if(attempt<2)await sleep(200*(2**attempt));
    }
    if(acknowledged)receipts++;
   }
   // A 2xx proves webhook receipt ONLY, not ChatGPT chat presentation.
   return {webhookReceipts:receipts,chatDelivered:0};
  },
  inspect:async()=>{const state=await load();return {count:state.subscriptions.length};}
 });
}
