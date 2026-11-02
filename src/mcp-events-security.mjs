// CSDC-005 admission primitives. NOT an event publisher or an authentication
// provider. An MCP tunnel/profile identity is never a ChatGPT chat principal.
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {createWorkEventAuthorizer} from './work-events-policy.mjs';
import {lookup as dnsLookup} from 'node:dns/promises';
import {isIP} from 'node:net';

export const EVENT_NAME='operation.completed';
export const EVENT_CATALOG=Object.freeze({
 name:EVENT_NAME,
 description:'An operation finished for a project explicitly authorized by the connected account.',
 delivery:['webhook'],
 inputSchema:{
  type:'object',properties:{project_id:{type:'string',minLength:1,maxLength:128}},
  required:['project_id'],additionalProperties:false
 },
 payloadSchema:{
  type:'object',properties:{
   project_id:{type:'string'},correlation_id:{type:'string'},
   delivery_id:{type:'string'},state:{type:'string'}
  },required:['project_id','correlation_id','delivery_id','state'],
  additionalProperties:false
 }
});
const reject=(reason)=>{throw Object.assign(new Error('MCP_EVENTS_'+reason),{code:'MCP_EVENTS_'+reason});};
export function canonicalEventArguments(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||
    Object.keys(v).length!==1||typeof v.project_id!=='string'||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v.project_id))
  reject('FILTER_INVALID');
 return JSON.stringify({project_id:v.project_id});
}
export function callbackHost(raw){
 if(typeof raw!=='string'||raw.length>2048)reject('URL_INVALID');
 let url;
 try{url=new URL(raw);}catch{reject('URL_INVALID');}
 if(url.protocol!=='https:'||url.username||url.password||url.hash||
    url.port&&url.port!=='443'||!url.hostname||
    isIP(url.hostname.replace(/^\[|\]$/g,''))||
    !url.hostname.includes('.')||/\s/.test(url.hostname))
  reject('URL_UNTRUSTED');
 const name=url.hostname.toLowerCase();
 if(/(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(name)
   ||name.endsWith('.home.arpa')||name.includes('..'))reject('URL_UNTRUSTED');
 return {url:url.href,hostname:name};
}
export function isPublicIPv4(value){
 if(isIP(value)!==4)return false; // Fail closed for IPv6 until verified pinning exists.
 const [a,b,c]=value.split('.').map(Number);
 if(a===0||a===10||a===127||a>=224||a===169&&b===254||
    a===100&&b>=64&&b<=127||a===172&&b>=16&&b<=31||
    a===192&&(b===168||b===0||b===88&&c===99)||
    a===198&&(b===18||b===19||b===51&&c===100)||
    a===203&&b===0&&c===113)return false;
 return !(a===192&&b===0&&c===2);
}
export async function resolveVerifiedCallbackTarget(raw, resolver=dnsLookup){
 const dest=callbackHost(raw);
 const answers=await resolver(dest.hostname,{all:true,verbatim:true});
 if(!Array.isArray(answers)||!answers.length||answers.some(x=>!isPublicIPv4(x.address)))
  reject('DNS_NOT_PUBLIC');
 // The caller MUST pin this verified address in its actual TLS connection;
 // resolving without pinning does NOT authorize an outbound request.
 return {...dest,address:answers[0].address};
}
export function validateEventSubscription(params,context){
 const identity=context?.verifiedHostPrincipal;
 if(typeof identity!=='string'||!identity||context?.authenticatedByHost!==true)
  reject('AUTHENTICATED_CHAT_PRINCIPAL_REQUIRED');
 if(params?.name!==EVENT_NAME||params?.delivery?.mode!=='webhook')reject('EVENT_INVALID');
 const args=canonicalEventArguments(params.arguments);
 const project=JSON.parse(args).project_id;
 if(!Array.isArray(context.authorizedProjectIds)||
    !context.authorizedProjectIds.includes(project))reject('OWNER_NOT_AUTHORIZED');
 const url=callbackHost(params.delivery.url);
 const secret=params.delivery.secret;
 if(typeof secret!=='string'||!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret))
  reject('SECRET_INVALID');
 const decoded=Buffer.from(secret.slice(6),'base64');
 if(decoded.length<24||decoded.length>64||
    decoded.toString('base64')!==secret.slice(6))reject('SECRET_INVALID');
 if(params.cursor!==null&&params.cursor!==undefined)reject('REPLAY_NOT_SUPPORTED');
 const subscriptionId='sub_'+createHash('sha256')
  .update(JSON.stringify([identity,url.url,EVENT_NAME,args])).digest('hex').slice(0,40);
 return {subscriptionId,project_id:project,url:url.url,signingKey:decoded};
}
export function signStandardWebhook(key,id,unixSeconds,exactBody){
 if(!Buffer.isBuffer(key)||key.length<24||key.length>64||
    !/^[-A-Za-z0-9_]{5,120}$/.test(id)||!Number.isSafeInteger(unixSeconds)||
    typeof exactBody!=='string')reject('SIGN_INPUT_INVALID');
 return 'v1,'+createHmac('sha256',key)
  .update(id+'.'+unixSeconds+'.'+exactBody,'utf8').digest('base64');
}
export function verifyChallengeEcho(challenge,received){
 if(typeof challenge!=='string'||typeof received!=='string')return false;
 const a=Buffer.from(challenge),b=Buffer.from(received);
 return a.length>0&&a.length===b.length&&timingSafeEqual(a,b);
}

// Production-facing admission requires a REAL cryptographic OAuth verifier and
// an authoritative project ACL resolver. The profile/tunnel is not a verifier.
// Neither host credentials nor callback information is persisted by this helper.
export function createAuthenticatedEventAdmission(options){
 const authorize=createWorkEventAuthorizer(options);
 return async function admit(params,accessToken){
  const project=JSON.parse(canonicalEventArguments(params?.arguments)).project_id;
  const verified=await authorize({accessToken,projectId:project});
  if(verified.eventName!==EVENT_NAME||verified.projectId!==project)
   reject('EVENT_OWNER_MISMATCH');
  const identity=[options.issuer,verified.tenantId,verified.ownerSubject].join('|');
  return validateEventSubscription(params,{
   authenticatedByHost:true,verifiedHostPrincipal:identity,
   authorizedProjectIds:[verified.projectId]
  });
 };
}
