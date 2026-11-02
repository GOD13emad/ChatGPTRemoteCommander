// HPC Ed25519 result provenance for owner-local, V1-brokered QA.
// Not ChatGPT account OAuth or production Worker enrollment.
import {createHash,createPrivateKey,createPublicKey,KeyObject,sign,verify} from 'node:crypto';
const HOSTS=new Set(['HPC-159-17','HPC-154-66']);
const HEX=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
function fail(code){throw Object.assign(new Error(code),{code});}
const sha=x=>createHash('sha256').update(x).digest('hex');
function exact(value,names){
 return value&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).length===names.length&&names.every(k=>Object.hasOwn(value,k));
}
function validateSource(host,receiptBytes,witnessBytes){
 if(!HOSTS.has(host)||!Buffer.isBuffer(receiptBytes)||!Buffer.isBuffer(witnessBytes)||
 receiptBytes.length>3000||witnessBytes.length>2000||receiptBytes.length<100||witnessBytes.length<100)
 fail('V2_HPC_RESULT_SOURCE_INVALID');
 let r,w;
 try{r=JSON.parse(receiptBytes.toString('utf8'));w=JSON.parse(witnessBytes.toString('utf8'));}
 catch{fail('V2_HPC_RESULT_SOURCE_INVALID');}
 if(!exact(r,['schema','host','scope','result','inputSha256','digest'])||
 r.schema!==1||r.host!==host||r.scope!=='V1_LOCAL_OWNER_QUEUE_NOT_CENTRAL_V2'||
 !exact(r.result,['schema','operationId','kind','limit','count','sum'])||
 r.result.schema!==1||r.result.kind!=='prime-statistics'||
 !ID.test(r.result.operationId)||!Number.isSafeInteger(r.result.limit)||
 r.result.limit<2||r.result.limit>50000||!Number.isSafeInteger(r.result.count)||
 !Number.isSafeInteger(r.result.sum)||r.result.count<0||r.result.sum<0||
 !HEX.test(r.digest)||r.digest!==sha(JSON.stringify(r.result))||
 !HEX.test(r.inputSha256)||
 !exact(w,['schema','scope','host','operationId','signedEnvelopeSha256',
 'signedPayloadSha256','jobSha256','keyId'])||
 w.schema!==1||w.scope!=='V1_OWNER_SIGNED_QA_NOT_PRODUCTION'||
 w.host!==host||w.operationId!==r.result.operationId||
 !HEX.test(w.signedEnvelopeSha256)||!HEX.test(w.signedPayloadSha256)||
 !HEX.test(w.jobSha256)||w.jobSha256!==r.inputSha256||
 typeof w.keyId!=='string'||!ID.test(w.keyId))
 fail('V2_HPC_RESULT_SOURCE_CONFLICT');
 return {receipt:r,witness:w};
}
function validPayload(p){
 if(!exact(p,['schema','signerHost','keyId','operationId','issuedAtMs',
 'receiptSha256','signedAdmissionWitnessSha256','requestSha256','resultDigest',
 'limit','count','sum'])||
 p.schema!==1||!HOSTS.has(p.signerHost)||p.keyId!==p.signerHost+'-qa-receipt-20261102'||
 typeof p.operationId!=='string'||!ID.test(p.operationId)||
 !Number.isSafeInteger(p.issuedAtMs)||p.issuedAtMs<0||
 !HEX.test(p.receiptSha256)||!HEX.test(p.signedAdmissionWitnessSha256)||
 !HEX.test(p.requestSha256)||!HEX.test(p.resultDigest)||
 !Number.isSafeInteger(p.limit)||p.limit<2||p.limit>50000||
 !Number.isSafeInteger(p.count)||p.count<0||
 !Number.isSafeInteger(p.sum)||p.sum<0)
 fail('V2_HPC_RESULT_PAYLOAD_INVALID');
 return p;
}
function canonical(p){
 return Buffer.from(JSON.stringify({
  schema:p.schema,signerHost:p.signerHost,keyId:p.keyId,operationId:p.operationId,
  issuedAtMs:p.issuedAtMs,receiptSha256:p.receiptSha256,
  signedAdmissionWitnessSha256:p.signedAdmissionWitnessSha256,
  requestSha256:p.requestSha256,resultDigest:p.resultDigest,
  limit:p.limit,count:p.count,sum:p.sum
 }),'utf8');
}
function nativeKey(key,kind){
 try{return key instanceof KeyObject?key:
 (kind==='private'?createPrivateKey(key):createPublicKey(key));}
 catch{fail('V2_HPC_RESULT_ED25519_KEY_REQUIRED');}
}
export function signV2HpcReceipt({host,receiptBytes,witnessBytes,privateKey,
 issuedAtMs=Date.now()}={}){
 const {receipt:r}=validateSource(host,receiptBytes,witnessBytes);
 const p=validPayload({
  schema:1,signerHost:host,keyId:host+'-qa-receipt-20261102',
  operationId:r.result.operationId,issuedAtMs,
  receiptSha256:sha(receiptBytes),
  signedAdmissionWitnessSha256:sha(witnessBytes),
  requestSha256:r.inputSha256,resultDigest:r.digest,
  limit:r.result.limit,count:r.result.count,sum:r.result.sum
 });
 const k=nativeKey(privateKey,'private');
 if(k.asymmetricKeyType!=='ed25519')fail('V2_HPC_RESULT_ED25519_KEY_REQUIRED');
 return Object.freeze({schema:1,payload:p,
  signature:sign(null,canonical(p),k).toString('base64url')});
}
export function verifyV2HpcReceipt({envelope,expectedHost,receiptBytes,witnessBytes,
 publicKey,now=Date.now(),maxFutureSkewMs=30000}={}){
 if(!HOSTS.has(expectedHost)||!exact(envelope,['schema','payload','signature'])||
 envelope.schema!==1||typeof envelope.signature!=='string'||
 !SIG.test(envelope.signature))
 fail('V2_HPC_RESULT_ENVELOPE_INVALID');
 const p=validPayload(envelope.payload);
 if(p.signerHost!==expectedHost)fail('V2_HPC_RESULT_WRONG_HOST');
 if(!Number.isSafeInteger(now)||p.issuedAtMs>now+maxFutureSkewMs)
 fail('V2_HPC_RESULT_CLOCK_INVALID');
 const {receipt:r}=validateSource(expectedHost,receiptBytes,witnessBytes);
 if(p.operationId!==r.result.operationId||
 p.receiptSha256!==sha(receiptBytes)||
 p.signedAdmissionWitnessSha256!==sha(witnessBytes)||
 p.requestSha256!==r.inputSha256||p.resultDigest!==r.digest||
 p.limit!==r.result.limit||p.count!==r.result.count||p.sum!==r.result.sum)
 fail('V2_HPC_RESULT_CONTENT_MISMATCH');
 const k=nativeKey(publicKey,'public');
 if(k.asymmetricKeyType!=='ed25519')fail('V2_HPC_RESULT_ED25519_KEY_REQUIRED');
 if(!verify(null,canonical(p),k,Buffer.from(envelope.signature,'base64url')))
 fail('V2_HPC_RESULT_BAD_SIGNATURE');
 return Object.freeze({schema:1,host:expectedHost,operationId:p.operationId,
  signatureVerified:true,receiptSha256:p.receiptSha256,
  witnessSha256:p.signedAdmissionWitnessSha256,
  resultDigest:p.resultDigest,count:p.count,sum:p.sum,limit:p.limit,
  productionV2:false,chatGPTOAuthAttested:false});
}
