// V1-06 source-only adapter: verify a native Host presentation receipt before
// letting createAuthenticatedDeliveryTools() ACK a result. This is NOT an MCP
// Events receipt, ChatGPT identity provider, signed issuer or browser attestor.
// Only the embedding owner Host can supply trusted issuer keys and obtain a
// signed proof from its independently authorized native presentation service.
import {KeyObject,verify} from 'node:crypto';

const DOMAIN='commander.delivery.presentation.v1';
const CLAIMS=Object.freeze([
  'issuer','audience','hostId','principalId','profileId','conversationId',
  'bindingId','deliveryId','correlationId','attemptId','resultHash',
  'presentationId','issuedAtMs','expiresAtMs','nonce'
]);
const REQUEST=Object.freeze([
  'hostId','principalId','profileId','conversationId','bindingId',
  'deliveryId','correlationId','attemptId','resultHash'
]);
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EPOCH=/^[a-f0-9]{32,64}$/;
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9-]{36}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const safe=value=>typeof value==='string'&&ID.test(value)&&value!=='.'&&value!=='..';
function exact(input,fields,code){
  if(!input||typeof input!=='object'||Array.isArray(input)
    ||Object.getPrototypeOf(input)!==Object.prototype
    ||Reflect.ownKeys(input).length!==fields.length)fail(code);
  const output={};
  for(const field of fields){
    const d=Object.getOwnPropertyDescriptor(input,field);
    if(!d||!d.enumerable||!Object.hasOwn(d,'value'))fail(code);
    output[field]=d.value;
  }
  return Object.freeze(output);
}
function receiptRequest(value){
  const request=exact(value,REQUEST,'DELIVERY_PRESENTATION_REQUEST_INVALID');
  if(REQUEST.slice(0,4).some(k=>!safe(request[k]))
    ||!EPOCH.test(request.bindingId)||!UUID.test(request.deliveryId)
    ||!safe(request.correlationId)||!safe(request.attemptId)
    ||typeof request.resultHash!=='string'||!SHA.test(request.resultHash))
    fail('DELIVERY_PRESENTATION_REQUEST_INVALID');
  return request;
}
function decodeSignature(value){
  if(typeof value!=='string'||value.length!==86
    ||!/^[A-Za-z0-9_-]{86}$/.test(value))
    fail('DELIVERY_PRESENTATION_SIGNATURE_INVALID');
  const bytes=Buffer.from(value,'base64url');
  if(bytes.length!==64||bytes.toString('base64url')!==value)
    fail('DELIVERY_PRESENTATION_SIGNATURE_INVALID');
  return bytes;
}
function signedBytes(keyId,claims){
  // Protocol owned by the native Host issuer; keyId is signed so a malicious
  // recipient cannot reinterpret a receipt under a different trust key.
  return Buffer.from(JSON.stringify([DOMAIN,keyId,...CLAIMS.map(k=>claims[k])]),'utf8');
}
/**
 * Bind this callback only to the host-only attestPresentation slot.
 * No MCP input may provide the signing keys or fetchSignedReceipt implementation.
 * Signed receipts are scoped to one exact delivery/attempt/result/consent epoch.
 * A repeated valid proof for the same attempt remains idempotent in DeliveryStore.
 * Key revocation requires a new verifier with the revoked key removed.
 */
export function createSignedDeliveryPresentationAttestor({
  issuer,audience,publicKeys,fetchSignedReceipt,now=Date.now,maxAgeMs=30000
}={}){
  if(!safe(issuer)||!safe(audience)||!(publicKeys instanceof Map)
    ||publicKeys.size<1||publicKeys.size>32||typeof fetchSignedReceipt!=='function'
    ||typeof now!=='function'||!Number.isSafeInteger(maxAgeMs)
    ||maxAgeMs<1000||maxAgeMs>120000)
    fail('DELIVERY_PRESENTATION_TRUST_REQUIRED');
  const keys=new Map();
  for(const [id,key] of publicKeys){
    if(!safe(id)||!(key instanceof KeyObject)||key.type!=='public'
      ||key.asymmetricKeyType!=='ed25519')
      fail('DELIVERY_PRESENTATION_TRUST_REQUIRED');
    keys.set(id,key);
  }
  return async input=>{
    const request=receiptRequest(input);
    const signed=await fetchSignedReceipt(request);
    const envelope=exact(signed,['schema','keyId','claims','signature'],
      'DELIVERY_PRESENTATION_ENVELOPE_INVALID');
    if(envelope.schema!==1||!safe(envelope.keyId))
      fail('DELIVERY_PRESENTATION_ENVELOPE_INVALID');
    const key=keys.get(envelope.keyId);
    if(!key)fail('DELIVERY_PRESENTATION_KEY_UNTRUSTED');
    const claims=exact(envelope.claims,CLAIMS,'DELIVERY_PRESENTATION_CLAIMS_INVALID');
    if(claims.issuer!==issuer||claims.audience!==audience)
      fail('DELIVERY_PRESENTATION_ISSUER_MISMATCH');
    if(REQUEST.some(k=>claims[k]!==request[k])||!safe(claims.presentationId)
      ||!safe(claims.nonce))
      fail('DELIVERY_PRESENTATION_SCOPE_MISMATCH');
    const t=now();
    if(!Number.isSafeInteger(t)||!Number.isSafeInteger(claims.issuedAtMs)
      ||!Number.isSafeInteger(claims.expiresAtMs)
      ||claims.expiresAtMs<=claims.issuedAtMs
      ||claims.expiresAtMs-claims.issuedAtMs>120000
      ||claims.issuedAtMs>t||claims.issuedAtMs<t-maxAgeMs
      ||claims.expiresAtMs<=t)
      fail('DELIVERY_PRESENTATION_EXPIRED');
    if(!verify(null,signedBytes(envelope.keyId,claims),key,
      decodeSignature(envelope.signature)))
      fail('DELIVERY_PRESENTATION_SIGNATURE_INVALID');
    return Object.freeze({...request,verified:true,presentationId:claims.presentationId});
  };
}
