// SOURCE CANDIDATE: no listener, issuer, keys, installation or native execution.
// The pinned public key MUST originate in protected owner enrollment. An
// owner-writable configuration is not an independent security boundary.
import {createPublicKey,verify,createHash} from 'node:crypto';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const id=v=>typeof v==='string'&&/^[a-z][a-z0-9_.:-]{0,95}$/.test(v);
const own=(v,fields)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...fields].sort().join('|');
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const list=v=>Array.isArray(v)&&v.length>0&&v.length<=32&&v.every(id)&&new Set(v).size===v.length;
function uri(v){try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.href===v;}catch{return false;}}
function b64(v,max=8192){if(typeof v!=='string'||v.length>max||!/^[A-Za-z0-9_-]+$/.test(v))fail('LOCAL_AUTH_MALFORMED');const b=Buffer.from(v,'base64url');if(b.toString('base64url')!==v)fail('LOCAL_AUTH_MALFORMED');return b;}
function objectPart(v){try{const out=JSON.parse(b64(v).toString('utf8'));if(!out||typeof out!=='object'||Array.isArray(out))fail('LOCAL_AUTH_MALFORMED');return out;}catch{fail('LOCAL_AUTH_MALFORMED');}}
const tokenFields=['iss','aud','sub','client_id','grant_id','enrollment_epoch','profile_id','root_policy_id','actions','scope','iat','nbf','exp','jti'];
const stateFields=['kind','issuer','resource','ownerId','enrollmentEpoch','grantId','status','profileId','rootPolicyId','actions','scopes','sequence','issuedAtMs','expiresAtMs'];
export function createLocalResourceGrantVerifier({issuer,resource,ownerId,enrollmentEpoch,keyId,publicKeyPem,now=Date.now}={}){
 if(!uri(issuer)||!uri(resource)||![ownerId,enrollmentEpoch,keyId].every(id)||typeof now!=='function')fail('LOCAL_AUTH_CONFIG_REQUIRED');
 let key;try{key=createPublicKey(publicKeyPem);}catch{fail('LOCAL_AUTH_PROTECTED_ENROLLMENT_REQUIRED');}
 if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')fail('LOCAL_AUTH_KEY_REJECTED');
 // Bounded per-process rollback detection. No claim of a cold durable anchor.
 const observed=new Map();
 return Object.freeze({
  verify({accessToken,stateEnvelope,expected}={}){
   const t=now();if(!Number.isSafeInteger(t))fail('LOCAL_AUTH_CLOCK_INVALID');
   if(!own(expected,['clientId','profileId','rootPolicyId','action','requiredScopes'])||typeof expected.clientId!=='string'||expected.clientId.length>512||![expected.profileId,expected.rootPolicyId,expected.action].every(id)||!list(expected.requiredScopes))fail('LOCAL_AUTH_EXPECTED_POLICY_REQUIRED');
   expected=structuredClone(expected);
   if(typeof accessToken!=='string'||accessToken.length>16384)fail('LOCAL_AUTH_MALFORMED');
   const parts=accessToken.split('.');if(parts.length!==3)fail('LOCAL_AUTH_MALFORMED');
   const h=objectPart(parts[0]),c=objectPart(parts[1]);
   if(!own(h,['alg','kid','typ'])||h.alg!=='ES256'||h.kid!==keyId||h.typ!=='at+jwt'||!own(c,tokenFields))fail('LOCAL_AUTH_TOKEN_SHAPE_REJECTED');
   if(!verify('sha256',Buffer.from(parts[0]+'.'+parts[1]),{key,dsaEncoding:'ieee-p1363'},b64(parts[2],86)))fail('LOCAL_AUTH_TOKEN_SIGNATURE_INVALID');
   if(c.iss!==issuer||c.aud!==resource||c.sub!==ownerId||c.enrollment_epoch!==enrollmentEpoch)fail('LOCAL_AUTH_TOKEN_BINDING_INVALID');
   if(c.client_id!==expected.clientId||c.profile_id!==expected.profileId||c.root_policy_id!==expected.rootPolicyId||!id(c.grant_id)||!id(c.jti)||!list(c.actions)||!c.actions.includes(expected.action)||typeof c.scope!=='string')fail('LOCAL_AUTH_GRANT_BINDING_INVALID');
   const scopes=c.scope.split(' ');if(!list(scopes)||scopes.join(' ')!==c.scope||!expected.requiredScopes.every(s=>scopes.includes(s)))fail('LOCAL_AUTH_SCOPE_DENIED');
   if(!['iat','nbf','exp'].every(k=>Number.isSafeInteger(c[k])&&Number.isSafeInteger(c[k]*1000))||c.iat>c.nbf||c.nbf>Math.floor(t/1000)||c.exp*1000<=t||c.exp<=c.nbf||c.exp-c.iat>300)fail('LOCAL_AUTH_TOKEN_NOT_CURRENT');
   if(!own(stateEnvelope,['statement','signature']))fail('LOCAL_AUTH_FRESH_SIGNED_STATE_REQUIRED');
   // Snapshot before any verification. No caller-supplied policy callback.
   const e=structuredClone(stateEnvelope),s=e.statement;
   if(!own(s,stateFields)||s.kind!=='rc-grant-state-v1')fail('LOCAL_AUTH_STATE_SHAPE_REJECTED');
   if(!verify('sha256',Buffer.from('RC_OWNER_OAUTH_GRANT_STATE_V1\n'+JSON.stringify(s)),key,b64(e.signature,128)))fail('LOCAL_AUTH_STATE_SIGNATURE_INVALID');
   if(s.issuer!==issuer||s.resource!==resource||s.ownerId!==ownerId||s.enrollmentEpoch!==enrollmentEpoch||s.grantId!==c.grant_id||s.profileId!==c.profile_id||s.rootPolicyId!==c.root_policy_id||!list(s.actions)||!list(s.scopes)||!s.actions.includes(expected.action)||!expected.requiredScopes.every(x=>s.scopes.includes(x))||c.actions.some(x=>!s.actions.includes(x))||scopes.some(x=>!s.scopes.includes(x)))fail('LOCAL_AUTH_STATE_BINDING_INVALID');
   if(!['active','revoked'].includes(s.status))fail('LOCAL_AUTH_STATE_SHAPE_REJECTED');
   if(!['sequence','issuedAtMs','expiresAtMs'].every(k=>Number.isSafeInteger(s[k]))||s.sequence<1||s.issuedAtMs>t||s.expiresAtMs<=t||s.expiresAtMs<=s.issuedAtMs||s.expiresAtMs-s.issuedAtMs>15000)fail('LOCAL_AUTH_STATE_NOT_CURRENT');
   const previous=observed.get(s.grantId),stateDigest=digest(s);
   if(previous&&(s.sequence<previous.sequence||s.sequence===previous.sequence&&stateDigest!==previous.digest))fail('LOCAL_AUTH_STATE_ROLLBACK_OR_EQUIVOCATION');
   if(!previous&&observed.size>=256)fail('LOCAL_AUTH_GRANT_CAPACITY');
   // Check the current clock again after cryptographic work, including expiry
   // while verifying. The actual dispatcher must verify afresh before effect.
   const end=now();if(!Number.isSafeInteger(end)||end<t||c.exp*1000<=end||s.expiresAtMs<=end)fail('LOCAL_AUTH_EXPIRED_DURING_VERIFY');
   // A valid signed revocation is terminal for this grant in this process.
   // Persist its sequence before denying; never let an older active envelope
   // resurrect authority. Invalid/stale envelopes above cannot poison state.
   const revoked=previous?.revoked===true||s.status==='revoked';
   observed.set(s.grantId,{sequence:s.sequence,digest:stateDigest,revoked});
   if(revoked)fail('LOCAL_AUTH_GRANT_REVOKED');
   return Object.freeze({subject:ownerId,clientId:c.client_id,grantId:c.grant_id,enrollmentEpoch,profileId:c.profile_id,rootPolicyId:c.root_policy_id,action:expected.action,scopes:Object.freeze([...expected.requiredScopes]),expiresAtMs:Math.min(c.exp*1000,s.expiresAtMs),conversationIdentityAuthenticated:false,nativeActionAuthorized:false});
  },
  status:()=>Object.freeze({sourceOnly:true,httpListening:false,tokenIssuance:false,requiresProtectedEnrollment:true,maxSignedStateLifetimeMs:15000,coldRollbackAnchor:false,nativeActionAuthority:false})
 });
}
