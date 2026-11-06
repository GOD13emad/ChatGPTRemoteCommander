// SOURCE CANDIDATE ONLY. Run inside a future protected issuer, never as an
// authority boundary in owner-writable Node code/config. This module issues
// no access/refresh tokens and opens no listener or native owner prompt.
import {createHash,createPublicKey,randomBytes,verify} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('base64url');
const json=x=>JSON.stringify(x);
const err=code=>{throw Object.assign(new Error(code),{code});};
const keys=(v,expected)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...expected].sort().join('|');
const id=x=>typeof x==='string'&&/^[a-z][a-z0-9_.:-]{0,95}$/.test(x);
const opaque=()=>randomBytes(32).toString('base64url');
function https(x){try{const u=new URL(x);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&u.href===x;}catch{return false;}}
function stableGrant(g){
 if(!keys(g,['profileId','rootPolicyId','actions','scopes'])||!id(g.profileId)||!id(g.rootPolicyId)
  ||!['actions','scopes'].every(k=>Array.isArray(g[k])&&g[k].length>0&&g[k].length<=32&&g[k].every(id)&&new Set(g[k]).size===g[k].length))err('INVALID_BOUND_GRANT');
 return {profileId:g.profileId,rootPolicyId:g.rootPolicyId,actions:[...g.actions].sort(),scopes:[...g.scopes].sort()};
}
export function createLocalOwnerOAuthKernel({issuer,tokenEndpoint,resource,ownerId,enrollmentEpoch,consentPublicKeyPem=null,clients=[],grantCatalog=[],now=()=>Date.now()}={}){
 if(!https(issuer)||new URL(issuer).search||!https(tokenEndpoint)||!https(resource)||!id(ownerId)||!id(enrollmentEpoch)||typeof now!=='function')err('INVALID_ISSUER_CONFIG');
 // These inputs must ultimately come from protected enrollment, not public
 // requests. No boolean "protected" assertion or verifier callback exists.
 const registered=new Map(),clientKeys=new Map(),catalog=new Map();
 for(const c of structuredClone(clients)){
  if(!keys(c,['clientId','redirectUris','jwks'])||typeof c.clientId!=='string'||c.clientId.length>512||registered.has(c.clientId)
   ||!Array.isArray(c.redirectUris)||!c.redirectUris.length||c.redirectUris.length>8||!c.redirectUris.every(https))err('INVALID_REGISTERED_CLIENT');
  registered.set(c.clientId,new Set(c.redirectUris));
  if(!Array.isArray(c.jwks)||c.jwks.length<1||c.jwks.length>8)err('CLIENT_PUBLIC_KEYS_REQUIRED');
  const pins=new Map();
  for(const jwk of c.jwks){
   if(typeof jwk.kid!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(jwk.kid)||pins.has(jwk.kid)||jwk.use!=='sig'||!['RS256','ES256'].includes(jwk.alg)
    ||!keys(jwk,jwk.alg==='RS256'?['kid','use','alg','kty','n','e']:['kid','use','alg','kty','crv','x','y']))err('INVALID_CLIENT_KEY');
   const key=createPublicKey({key:jwk,format:'jwk'});
   if((jwk.alg==='RS256'&&(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<2048))
    ||(jwk.alg==='ES256'&&(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails.namedCurve!=='prime256v1')))err('INVALID_CLIENT_KEY');
   pins.set(jwk.kid,{key,alg:jwk.alg});
  }clientKeys.set(c.clientId,pins);
 }
 for(const entry of structuredClone(grantCatalog)){
  if(!keys(entry,['grantPolicyId','grant'])||!id(entry.grantPolicyId)||catalog.has(entry.grantPolicyId))err('INVALID_GRANT_POLICY');
  catalog.set(entry.grantPolicyId,stableGrant(entry.grant));
 }
 let publicKey=null;
 if(consentPublicKeyPem!==null){publicKey=createPublicKey(consentPublicKeyPem);if(publicKey.asymmetricKeyType!=='ec'||publicKey.asymmetricKeyDetails.namedCurve!=='prime256v1')err('CONSENT_KEY_ALGORITHM_REQUIRED');}
 const pending=new Map(),codes=new Map(),revoked=new Set(),usedReceipts=new Set(),clientJtis=new Map();
 function authenticateClient(request){
  if(request.client_assertion_type!=='urn:ietf:params:oauth:client-assertion-type:jwt-bearer'||typeof request.client_assertion!=='string'||request.client_assertion.length>8192)err('INVALID_CLIENT_ASSERTION');
  const parts=request.client_assertion.split('.');if(parts.length!==3||parts.some(p=>!(/^[A-Za-z0-9_-]+$/.test(p))))err('INVALID_CLIENT_ASSERTION');
  let h,c;try{h=JSON.parse(Buffer.from(parts[0],'base64url'));c=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{err('INVALID_CLIENT_ASSERTION');}
  const pin=clientKeys.get(request.client_id)?.get(h?.kid),seconds=Math.floor(now()/1000);
  if(!keys(h,['alg','kid','typ'])||h.typ!=='JWT'||!pin||h.alg!==pin.alg||!keys(c,['iss','sub','aud','iat','exp','jti'])
   ||c.iss!==request.client_id||c.sub!==request.client_id||c.aud!==tokenEndpoint||!Number.isSafeInteger(c.iat)||!Number.isSafeInteger(c.exp)
   ||c.iat>seconds||c.exp<=seconds||c.exp-c.iat>60||typeof c.jti!=='string'||!(/^[A-Za-z0-9_-]{16,128}$/.test(c.jti)))err('INVALID_CLIENT_ASSERTION');
  for(const [k,expiry] of clientJtis)if(expiry<=seconds)clientJtis.delete(k);
  const replayKey=hash(request.client_id+'\n'+c.jti);if(clientJtis.has(replayKey)||clientJtis.size>=1024)err('CLIENT_ASSERTION_REPLAY_OR_CAPACITY');
  if(!verify('sha256',Buffer.from(parts[0]+'.'+parts[1]),h.alg==='ES256'?{key:pin.key,dsaEncoding:'ieee-p1363'}:pin.key,Buffer.from(parts[2],'base64url')))err('CLIENT_ASSERTION_SIGNATURE_INVALID');
  clientJtis.set(replayKey,c.exp);
 }
 function signature(e,kind){
  if(!publicKey)err('PROTECTED_OWNER_ENROLLMENT_REQUIRED');
  if(usedReceipts.size>=4096)err('OWNER_RECEIPT_CAPACITY');
  if(!keys(e,['statement','signature'])||typeof e.signature!=='string'||!/^[A-Za-z0-9_-]{80,128}$/.test(e.signature))err('OWNER_RECEIPT_INVALID');
  const s=e.statement;
  if(!keys(s,['kind','issuer','ownerId','enrollmentEpoch','receiptId','requestDigest','grantId','issuedAt','expiresAt'])||s.kind!==kind||s.issuer!==issuer||s.ownerId!==ownerId
   ||s.enrollmentEpoch!==enrollmentEpoch||typeof s.receiptId!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(s.receiptId)||!id(s.grantId)
   ||typeof s.requestDigest!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(s.requestDigest)||!Number.isSafeInteger(s.issuedAt)||!Number.isSafeInteger(s.expiresAt)
   ||s.issuedAt>now()||s.expiresAt<=now()||s.expiresAt-s.issuedAt>120000||usedReceipts.has(s.receiptId))err('OWNER_RECEIPT_INVALID');
  if(!verify('sha256',Buffer.from('RC_OWNER_OAUTH_CONSENT_V1\n'+json(s)),publicKey,Buffer.from(e.signature,'base64url')))err('OWNER_RECEIPT_SIGNATURE_INVALID');
  return structuredClone(s);
 }
 function begin(request){
  request=structuredClone(request);
  if(pending.size+codes.size>=256)err('ISSUER_CAPACITY_EXCEEDED');
  if(!keys(request,['response_type','client_id','redirect_uri','resource','code_challenge_method','code_challenge','state','grant_policy_id'])
   ||request.response_type!=='code'||request.resource!==resource||request.code_challenge_method!=='S256'
   ||typeof request.code_challenge!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(request.code_challenge)
   ||typeof request.state!=='string'||request.state.length<16||request.state.length>1024
   ||!registered.get(request.client_id)?.has(request.redirect_uri)||!catalog.has(request.grant_policy_id))err('INVALID_AUTHORIZATION_REQUEST');
  const requestId=opaque(),nonce=opaque(),expiresAt=now()+120000;
  const bound={issuer,resource,ownerId,enrollmentEpoch,requestId,nonce,expiresAt,clientId:request.client_id,redirectUri:request.redirect_uri,
   challenge:request.code_challenge,state:request.state,grantPolicyId:request.grant_policy_id,grant:catalog.get(request.grant_policy_id)};
  const requestDigest=hash(json(bound));pending.set(requestId,{bound,requestDigest});
  return {requestId,requestDigest,expiresAt,ownerPresenceRequired:true,nativeConsentRequired:true,grant:structuredClone(bound.grant),issuer,clientId:bound.clientId,redirectUri:bound.redirectUri};
 }
 function acceptConsent(requestId,envelope){
  const s=signature(structuredClone(envelope),'approve');
  const p=pending.get(requestId);
  if(!p||p.bound.expiresAt<=now()||s.requestDigest!==p.requestDigest||revoked.has(s.grantId))err('CONSENT_BINDING_INVALID');
  // Synchronous consume-before-publish; this is in-memory source QA only.
  // Production must make this transaction durable in the protected issuer.
  pending.delete(requestId);usedReceipts.add(s.receiptId);
  const code=opaque();codes.set(hash(code),{...p,grantId:s.grantId,expiresAt:Math.min(s.expiresAt,now()+60000)});
  return {code,state:p.bound.state,redirectUri:p.bound.redirectUri,iss:issuer};
 }
 function exchange(request){
  request=structuredClone(request);
  if(!keys(request,['grant_type','code','client_id','redirect_uri','resource','code_verifier','client_assertion_type','client_assertion'])||typeof request.code!=='string'||request.code.length!==43)err('INVALID_TOKEN_REQUEST');
  authenticateClient(request);
  const k=hash(request.code),record=codes.get(k);codes.delete(k);
  if(!record||record.expiresAt<=now()||revoked.has(record.grantId)||request.grant_type!=='authorization_code'
   ||request.client_id!==record.bound.clientId||request.redirect_uri!==record.bound.redirectUri||request.resource!==resource
   ||typeof request.code_verifier!=='string'||!(/^[A-Za-z0-9._~-]{43,128}$/.test(request.code_verifier))||hash(request.code_verifier)!==record.bound.challenge)err('INVALID_GRANT');
  return {tokenIssued:false,codeConsumed:true,code:'PROTECTED_TOKEN_SIGNER_AND_DURABLE_STORE_REQUIRED',
   signingRequest:{iss:issuer,aud:resource,sub:ownerId,client_id:record.bound.clientId,grant_id:record.grantId,enrollment_epoch:enrollmentEpoch,
    profile_id:record.bound.grant.profileId,root_policy_id:record.bound.grant.rootPolicyId,actions:[...record.bound.grant.actions],scope:record.bound.grant.scopes.join(' ')}};
 }
 function revoke(envelope){const s=signature(structuredClone(envelope),'revoke');usedReceipts.add(s.receiptId);revoked.add(s.grantId);return {revoked:true,grantId:s.grantId};}
 return Object.freeze({begin,acceptConsent,exchange,revoke,status:()=>({sourceOnly:true,httpListening:false,tokenIssuance:false,protectedStorage:false,ownerEnrollmentAvailable:publicKey!==null})});
}
