// Fixed issuer/audience native signing primitive. Signature is identity only:
// the Core must independently require current J01, durable owner grant,
// exact worker.register action permission and machine-global registry CAS.
// This code NEVER grants any tool or OS privilege.
import {KeyObject,createHash,createPublicKey,randomBytes,sign} from 'node:crypto';
import {isProxy} from 'node:util/types';
import {deriveWorkerId,verifyWorkerRegistration}
  from './worker-identity-authority.mjs';

const DOMAIN='commander.worker.identity.v1';
const KEYS=['hostId','profileId','principalId','conversationId',
  'bindingId','ownerSidHash','deviceIdHash','tunnelIdHash',
  'capabilityPolicyDigest','grantRevision','expiresAtMs'];
const CLAIMS=['issuer','audience','hostId','profileId','principalId',
  'conversationId','bindingId','workerId','ownerSidHash','deviceProvider',
  'deviceIdHash','tunnelProvider','tunnelIdHash','capabilityPolicyDigest',
  'grantRevision','issuedAtMs','expiresAtMs','nonce'];
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEX=/^[a-f0-9]{64}$/;
const BIND=/^[a-f0-9]{32,64}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const ident=x=>typeof x==='string'&&ID.test(x)&&x!=='.'&&x!=='..';
const hash=x=>createHash('sha256').update(x).digest('hex');
function exact(x){
 if(!x||typeof x!=='object'||Array.isArray(x)||isProxy(x)
   ||![Object.prototype,null].includes(Object.getPrototypeOf(x))
   ||Reflect.ownKeys(x).length!==KEYS.length)
   fail('RC012_WORKER_SIGNING_INTENT_INVALID');
 return Object.freeze(Object.fromEntries(KEYS.map(k=>{
   const d=Object.getOwnPropertyDescriptor(x,k);
   if(!d?.enumerable||!Object.hasOwn(d,'value'))
     fail('RC012_WORKER_SIGNING_INTENT_INVALID');
   return [k,d.value];
 })));
}
export function signV012NativeWorkerEnrollment({
  intent,privateKey,now=Date.now()
}={}){
 const x=exact(intent);
 if(!(privateKey instanceof KeyObject)||privateKey.type!=='private'
   ||privateKey.asymmetricKeyType!=='ed25519'
   ||!Number.isSafeInteger(now)||now<1
   ||![x.hostId,x.profileId,x.principalId,x.conversationId].every(ident)
   ||typeof x.bindingId!=='string'||!BIND.test(x.bindingId)
   ||![x.ownerSidHash,x.deviceIdHash,x.tunnelIdHash,
     x.capabilityPolicyDigest].every(y=>typeof y==='string'&&HEX.test(y))
   ||!Number.isSafeInteger(x.grantRevision)||x.grantRevision<1
   ||!Number.isSafeInteger(x.expiresAtMs)||x.expiresAtMs<=now
   ||x.expiresAtMs-now>120000)
   fail('RC012_WORKER_SIGNING_INTENT_INVALID');
 const pub=createPublicKey(privateKey).export({format:'der',type:'spki'});
 const keyId=hash(pub);
 const claims=Object.freeze({
   issuer:'commander.local',audience:'remote-commander',
   hostId:x.hostId,profileId:x.profileId,
   principalId:x.principalId,conversationId:x.conversationId,
   bindingId:x.bindingId,
   workerId:deriveWorkerId({hostId:x.hostId,profileId:x.profileId,
     ownerSidHash:x.ownerSidHash,deviceProvider:'native-key-store',
     deviceIdHash:x.deviceIdHash,keyId}),
   ownerSidHash:x.ownerSidHash,deviceProvider:'native-key-store',
   deviceIdHash:x.deviceIdHash,tunnelProvider:'openai-secure-mcp-tunnel',
   tunnelIdHash:x.tunnelIdHash,capabilityPolicyDigest:x.capabilityPolicyDigest,
   grantRevision:x.grantRevision,issuedAtMs:now,expiresAtMs:x.expiresAtMs,
   nonce:randomBytes(16).toString('hex')
 });
 const envelope=Object.freeze({schema:1,keyId,
   publicKey:pub.toString('base64url'),claims,
   signature:sign(null,Buffer.from(JSON.stringify(
     [DOMAIN,keyId,...CLAIMS.map(k=>claims[k])])),privateKey).toString('base64url')
 });
 verifyWorkerRegistration(envelope,{
   issuer:'commander.local',audience:'remote-commander',
   now:()=>now,maxTtlMs:120000
 });
 return envelope;
}
