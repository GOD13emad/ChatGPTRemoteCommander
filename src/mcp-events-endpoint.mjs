// CSDC-005: opt-in MCP Events dispatch. This adapter is never enabled by a
// tunnel/profile identity. Only a pinned cryptographic OAuth issuer + exact
// issuer/resource/project-owner ACL can enable advertised event capability.
import path from 'node:path';
import {createPublicKey,verify as verifySignature} from 'node:crypto';
import {createWorkEventAuthorizer} from './work-events-policy.mjs';
import {createEventSubscriptionService,buildVerifiedHttpsSender} from './mcp-event-subscriptions.mjs';
const disallow=(reason)=>{throw new Error('MCP_EVENTS_'+reason);};
const h64=/^[A-Za-z0-9_-]+$/;
function decodeSegment(input){
 if(typeof input!=='string'||input.length>10000||!h64.test(input))disallow('JWT_FORMAT');
 const bytes=Buffer.from(input,'base64url');
 if(bytes.toString('base64url')!==input)disallow('JWT_ENCODING');
 return bytes;
}
function parseClaims(token,key){
 if(typeof token!=='string'||token.length>16384)disallow('JWT_FORMAT');
 const parts=token.split('.');
 if(parts.length!==3)disallow('JWT_FORMAT');
 const header=JSON.parse(decodeSegment(parts[0]).toString('utf8'));
 if(header?.alg!=='RS256'||header?.typ!=='JWT'||header?.crit||
    header?.jku||header?.jwk||header?.x5u)disallow('JWT_HEADER');
 const verified=verifySignature('RSA-SHA256',
  Buffer.from(parts[0]+'.'+parts[1],'ascii'),key,decodeSegment(parts[2]));
 if(!verified)disallow('JWT_SIGNATURE');
 const payload=JSON.parse(decodeSegment(parts[1]).toString('utf8'));
 if(!payload||typeof payload!=='object'||Array.isArray(payload))disallow('JWT_CLAIMS');
 return payload;
}
export function createConfiguredEventsEndpoint(configuration,{send,now=()=>Date.now(),revalidateOwner}={}){
 const cfg=configuration?.mcpEvents;
 if(!cfg||cfg.enabled!==true)return null;
 if(cfg.authType!=='oauth-pinned-rs256'||typeof cfg.issuer!=='string'||
    typeof cfg.resource!=='string'||typeof cfg.publicKeyPem!=='string'||
    !Array.isArray(cfg.projects)||cfg.projects.length===0||cfg.projects.length>128||
    typeof cfg.storeFile!=='string'||!path.isAbsolute(cfg.storeFile))
  disallow('CONFIG_INVALID');
 const issuer=new URL(cfg.issuer),resource=new URL(cfg.resource);
 if(issuer.protocol!=='https:'||resource.protocol!=='https:'||
    issuer.username||issuer.password||resource.username||resource.password)
  disallow('CONFIG_INVALID');
 const key=createPublicKey(cfg.publicKeyPem);
 if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength??0)<2048)
  disallow('KEY_WEAK');
 const projects=new Map();
 for(const p of cfg.projects){
  if(!p||typeof p.id!=='string'||typeof p.ownerSubject!=='string'||
     typeof p.tenantId!=='string'||p.ownerIssuer!==cfg.issuer||
     projects.has(p.id))disallow('ACL_INVALID');
  projects.set(p.id,Object.freeze({...p}));
 }
 const verifyAccessToken=async accessToken=>{
  const token=parseClaims(accessToken,key);
  const iss=token.iss;
  const audience=token.aud;
  const scope=token.scope;
  if(!Number.isSafeInteger(token.exp)||token.exp<1||typeof token.sub!=='string'||
     typeof token.tenant_id!=='string'||typeof scope!=='string'||
     !Array.isArray(audience)&&typeof audience!=='string')disallow('JWT_CLAIMS');
  if(iss!==cfg.issuer||!(Array.isArray(audience)?audience.length===1&&audience[0]===cfg.resource:audience===cfg.resource))
   disallow('JWT_AUDIENCE');
  const nowSeconds=Math.floor(now()/1000);
  if(token.nbf!==undefined&&(!Number.isSafeInteger(token.nbf)||token.nbf>nowSeconds)||
     token.iat!==undefined&&(!Number.isSafeInteger(token.iat)||token.iat>nowSeconds+60))
   disallow('JWT_CLOCK');
  return {issuer:iss,resource:cfg.resource,subject:token.sub,
   tenantId:token.tenant_id,expiresAt:token.exp,scopes:scope.split(/\s+/)};
 };
 const projectLookup=async projectId=>{
  // Catalog visibility still requires an existing valid ACL; never return a
  // catalog based only on a verified but project-unrelated bearer.
  if(projectId==='__catalog__')return null;
  return projects.get(projectId)??null;
 };
 const authorizeProject=createWorkEventAuthorizer({
  issuer:cfg.issuer,resource:cfg.resource,
  verifyAccessToken,resolveProjectAccess:projectLookup,
  nowEpochSeconds:()=>Math.floor(now()/1000)
 });
 const auth=async ({accessToken,projectId,catalog})=>{
  if(catalog){
   const claims=await verifyAccessToken(accessToken);
   const nowSec=Math.floor(now()/1000);
   if(claims.expiresAt<=nowSec||!claims.scopes.includes('commander.events.subscribe')||
     !Array.from(projects.values()).some(p=>p.ownerIssuer===claims.issuer&&
      p.ownerSubject===claims.subject&&p.tenantId===claims.tenantId))
    disallow('CATALOG_FORBIDDEN');
   return {catalog:true};
  }
  return authorizeProject({accessToken,projectId});
 };
 const subscriptions=createEventSubscriptionService({
  file:cfg.storeFile,authorize:auth,send:send??buildVerifiedHttpsSender(),
  revalidateOwner,now
 });
 return Object.freeze({
  capabilities:Object.freeze({events:{}}),
  async dispatch(method,params,bearer){
   if(typeof bearer!=='string'||!/^Bearer [^\s]{10,16384}$/.test(bearer))
    disallow('TOKEN_MISSING');
   const accessToken=bearer.slice(7);
   if(method==='events/list')return subscriptions.list(accessToken);
   if(method==='events/subscribe')return subscriptions.subscribe(params,accessToken);
   if(method==='events/unsubscribe')return subscriptions.unsubscribe(params,accessToken);
   disallow('METHOD_UNKNOWN');
  },
  // Publisher must revalidate current ownership; absent verifier fails closed.
  // Webhook 2xx is not a ChatGPT conversation delivery acknowledgement.
  publish:subscriptions.publish,
  inspect:subscriptions.inspect
 });
}
