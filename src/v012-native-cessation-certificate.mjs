// Verification-only contract for a future independent native owner broker.
// The expected key pin and reservation must come from protected local state,
// never from a Worker, MCP request, or the certificate being verified.
// A valid signature alone does not establish OS isolation or grant authority.
import {createHash,createPublicKey,verify} from 'node:crypto';
import {isProxy} from 'node:util/types';
import {isSerializedProcessCessationProof} from './process-containment.mjs';

export const NATIVE_CESSATION_CERTIFICATE_DOMAIN='commander.native-owner-cessation.v1';
const HASH=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BINDING=['workflowId','stepId','operationId','rootFingerprint','revision','leaseId','fencingToken'];
const PROOF=['schema',...BINDING,'provider','runId','activeProcesses','verified',
  'outcome','cleanupRequired','completedAt','proofDigest'];
const CLAIMS=['schema','kind','hostId','brokerId','keySha256','inputHash',
  'receiptSha256','issuedAtMs','proof'];
const EXPECTED=['hostId','brokerId','keySha256','inputHash','receiptSha256',
  'admittedAtMs','provider','binding'];
const PROVIDERS=new Set(['windows-job-object','systemd-service-exit-type-cgroup']);
const literal=(x,re)=>typeof x==='string'&&re.test(x);
const safeId=x=>literal(x,ID)&&x!=='.'&&x!=='..';
const time=x=>Number.isSafeInteger(x)&&x>=0;
function exact(value,fields){
  if(!value||typeof value!=='object'||Array.isArray(value)||isProxy(value)
    ||![Object.prototype,null].includes(Object.getPrototypeOf(value))
    ||Reflect.ownKeys(value).length!==fields.length)throw Error('INVALID_RECORD');
  return Object.fromEntries(fields.map(k=>{
    const d=Object.getOwnPropertyDescriptor(value,k);
    if(!d||!d.enumerable||!Object.hasOwn(d,'value'))throw Error('INVALID_FIELD');
    return [k,d.value];
  }));
}
function bindingRecord(value){
  const b=exact(value,BINDING);
  if(![b.workflowId,b.stepId,b.operationId].every(safeId)
    ||!literal(b.rootFingerprint,HASH)||!literal(b.leaseId,HASH)
    ||!Number.isSafeInteger(b.revision)||b.revision<0
    ||!Number.isSafeInteger(b.fencingToken)||b.fencingToken<1)
    throw Error('INVALID_BINDING');
  return b;
}
function claimRecord(value){
  const c=exact(value,CLAIMS);
  c.proof=exact(c.proof,PROOF);
  if(c.schema!==1||c.kind!==NATIVE_CESSATION_CERTIFICATE_DOMAIN
    ||!safeId(c.hostId)||!safeId(c.brokerId)
    ||![c.keySha256,c.inputHash,c.receiptSha256].every(x=>literal(x,HASH))
    ||!time(c.issuedAtMs)||!PROVIDERS.has(c.proof.provider)
    ||typeof c.proof.outcome!=='string'||c.proof.outcome.length>256
    ||!literal(c.proof.proofDigest,HASH))throw Error('INVALID_CLAIMS');
  return c;
}
// Public encoding for independently provisioned broker implementations. No
// signing API, private-key storage or operational release is provided here.
export function encodeNativeCessationCertificateClaims(value){
  return Buffer.from(JSON.stringify(claimRecord(value)),'utf8');
}
export function normalizeNativeCessationExpected(expected){
  const e=exact(expected,EXPECTED);
  e.binding=Object.freeze(bindingRecord(e.binding));
  if(!safeId(e.hostId)||!safeId(e.brokerId)
    ||![e.keySha256,e.inputHash,e.receiptSha256].every(x=>literal(x,HASH))
    ||!time(e.admittedAtMs)||!PROVIDERS.has(e.provider))throw Error('INVALID_EXPECTED');
  return Object.freeze(e);
}
export function verifyNativeCessationCertificate({packet,expected,publicKeyPem,now=Date.now()}={}){
  try{
    const e=normalizeNativeCessationExpected(expected);
    if(!time(now))return null;
    const p=exact(packet,['claims','signature']);
    const c=claimRecord(p.claims);
    if(!literal(p.signature,/^[A-Za-z0-9+/]{86}==$/))return null;
    for(const k of ['hostId','brokerId','keySha256','inputHash','receiptSha256'])
      if(c[k]!==e[k])return null;
    if(c.proof.provider!==e.provider
      ||!isSerializedProcessCessationProof(c.proof,e.binding)
      ||c.proof.cleanupRequired!==false)return null;
    const finished=Date.parse(c.proof.completedAt);
    if(!time(finished)||finished<e.admittedAtMs||finished>c.issuedAtMs
      ||c.issuedAtMs>now)return null;
    if(typeof publicKeyPem!=='string'||publicKeyPem.length>4096
      ||!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(publicKeyPem))return null;
    const key=createPublicKey(publicKeyPem);
    if(key.asymmetricKeyType!=='ed25519'
      ||createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex')!==e.keySha256)
      return null;
    const sig=Buffer.from(p.signature,'base64');
    if(sig.length!==64||sig.toString('base64')!==p.signature
      ||!verify(null,encodeNativeCessationCertificateClaims(c),key,sig))return null;
    return Object.freeze({inputHash:c.inputHash,
      processCessationProof:Object.freeze({...c.proof})});
  }catch{return null;}
}
