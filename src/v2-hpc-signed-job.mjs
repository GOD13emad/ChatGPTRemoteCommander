// V2 HPC source-authenticated QA intake, Ed25519. Not a ChatGPT OAuth
// assertion, a permission to enroll workers, or a production dispatch path.
import {createPublicKey,createPrivateKey,sign,verify,createHash,KeyObject} from 'node:crypto';

const JOB_ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const KEY_ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SIGNATURE=/^[A-Za-z0-9_-]{86}$/;
const HOST_IDS=new Set(['HPC-159-17','HPC-154-66']);
const fail=(name)=>{throw Object.assign(new Error(name),{code:name});};
function keysEqual(x,fields){
 return x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.getPrototypeOf(x)===Object.prototype&&
 Object.keys(x).length===fields.length&&
 fields.every(k=>Object.hasOwn(x,k));
}
function validateJob(job){
 if(!keysEqual(job,['schema','operationId','kind','limit'])||job.schema!==1||
 typeof job.operationId!=='string'||!JOB_ID.test(job.operationId)||
 job.kind!=='prime-statistics'||!Number.isSafeInteger(job.limit)||
 job.limit<2||job.limit>50000)fail('V2_SIGNED_JOB_NOT_BOUNDED');
 return job;
}
function validatePayload(payload){
 if(!keysEqual(payload,['schema','keyId','hostId','issuedAtMs','expiresAtMs','job'])||
 payload.schema!==1||typeof payload.keyId!=='string'||!KEY_ID.test(payload.keyId)||
 !HOST_IDS.has(payload.hostId)||
 !Number.isSafeInteger(payload.issuedAtMs)||
 !Number.isSafeInteger(payload.expiresAtMs)||
 payload.expiresAtMs<=payload.issuedAtMs||
 payload.expiresAtMs-payload.issuedAtMs>300000)
 fail('V2_SIGNED_JOB_BOUNDARY_INVALID');
 validateJob(payload.job);
 return payload;
}
function bytes(payload){
 // Exact deterministic serialization: reject reordered/extra keys at verifier
 // by binding signature to one immutable canonical encoding.
 return Buffer.from(JSON.stringify({
  schema:payload.schema,keyId:payload.keyId,hostId:payload.hostId,
  issuedAtMs:payload.issuedAtMs,expiresAtMs:payload.expiresAtMs,
  job:{schema:payload.job.schema,operationId:payload.job.operationId,
   kind:payload.job.kind,limit:payload.job.limit}
 }), 'utf8');
}
export function signV2HpcBoundedJob({job,hostId,keyId,issuedAtMs,
 expiresAtMs,privateKey}={}){
 const payload=validatePayload({schema:1,keyId,hostId,issuedAtMs,
  expiresAtMs,job});
 let key;
 try{key=privateKey instanceof KeyObject?privateKey:createPrivateKey(privateKey);}
 catch{fail('V2_SIGNED_JOB_PRIVATE_KEY_REQUIRED');}
 if(key.asymmetricKeyType!=='ed25519')fail('V2_SIGNED_JOB_ED25519_REQUIRED');
 const signature=sign(null,bytes(payload),key).toString('base64url');
 return Object.freeze({schema:1,payload:JSON.parse(bytes(payload).toString('utf8')),
  signature});
}
export function verifyV2HpcBoundedJob({envelope,expectedHostId,
 expectedKeyId,publicKey,now=Date.now()}={}){
 if(!HOST_IDS.has(expectedHostId)||typeof expectedKeyId!=='string'||
  !KEY_ID.test(expectedKeyId))fail('V2_SIGNED_JOB_TRUST_ANCHOR_REQUIRED');
 if(!keysEqual(envelope,['schema','payload','signature'])||
  envelope.schema!==1||typeof envelope.signature!=='string'||
  !SIGNATURE.test(envelope.signature))fail('V2_SIGNED_JOB_ENVELOPE_INVALID');
 const p=validatePayload(envelope.payload);
 if(p.hostId!==expectedHostId||p.keyId!==expectedKeyId)
  fail('V2_SIGNED_JOB_WRONG_RECIPIENT');
 if(!Number.isSafeInteger(now)||now<p.issuedAtMs-30000||now>=p.expiresAtMs)
  fail('V2_SIGNED_JOB_OUTSIDE_TIME_WINDOW');
 let trusted;
 try{trusted=publicKey instanceof KeyObject?publicKey:createPublicKey(publicKey);}
 catch{fail('V2_SIGNED_JOB_PUBLIC_KEY_REQUIRED');}
 if(trusted.asymmetricKeyType!=='ed25519')
  fail('V2_SIGNED_JOB_ED25519_REQUIRED');
 const signed=bytes(p);
 if(!verify(null,signed,trusted,Buffer.from(envelope.signature,'base64url')))
  fail('V2_SIGNED_JOB_BAD_SIGNATURE');
 return Object.freeze({hostId:p.hostId,operationId:p.job.operationId,
  boundedJob:Object.freeze({...p.job}),keyId:p.keyId,
  signedPayloadSha256:createHash('sha256').update(signed).digest('hex'),
  chatGPTOAuthAttested:false,productionWorkerEnrolled:false});
}
