// J01 protected owner grant verifier — QA source candidate, NEVER an owner signer.
// The private signing key must remain in an independently enrolled, owner-interactive
// OS authenticator. This module has no enrollment, key generation or bypass path.
import {createPublicKey, createHash, verify as cryptoVerify} from 'node:crypto';
import {isProxy} from 'node:util/types';

const PREFIX = 'COMMANDER-J01-OS-OWNER-GRANT-V1\n';
const PROTOCOL = 'Commander-J01-OS-OWNER-GRANT-V1';
const ORIGIN = 'OS_PROTECTED_OWNER_SIGNER';
const FIELDS = Object.freeze([
  'protocol','origin','signerPrincipal','keyId','incidentId','operationId',
  'callerPrincipal','ownerPrincipal','sessionId','seatId','displayId',
  'consentNonce','requestedInput','ttlSeconds','issuedAtMs','expiresAtMs',
  'ownerInteracted'
]);
const RECORD = x => x !== null && typeof x === 'object' && !Array.isArray(x);
// Freeze a single own-enumerable data snapshot before parsing or using
// any signature/context field. Proxy/accessor and hidden fields are invalid:
// validating signed bytes while subsequently reading the mutable source can
// authorize a different operation with a valid signature for an old operation.
export function snapshotJ01PlainData(value, fields, code) {
  if (!RECORD(value) || isProxy(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new Error(code);
  const keys=Reflect.ownKeys(value);
  if (fields && (keys.length!==fields.length ||
      keys.some(k=>typeof k!=='string'||!fields.includes(k))))
    throw new Error(code);
  const snapshot=Object.create(null);
  for (const key of keys) {
    if (typeof key!=='string') throw new Error(code);
    const d=Object.getOwnPropertyDescriptor(value,key);
    if (!d || d.enumerable!==true || !Object.hasOwn(d,'value'))
      throw new Error(code);
    snapshot[key]=d.value;
  }
  return Object.freeze(snapshot);
}
export function snapshotJ01GrantPayload(payload) {
  const p=snapshotJ01PlainData(payload,FIELDS,'J01_GRANT_FIELDSET_INVALID');
  const input=snapshotJ01PlainData(p.requestedInput,['pointer','keyboard'],
    'J01_GRANT_INPUT_SCOPE_INVALID');
  return Object.freeze({...p,requestedInput:input});
}
export function snapshotJ01ExpectedContext(value) {
  const e=snapshotJ01PlainData(value,null,'J01_EXPECTED_CONTEXT_INVALID');
  const session=snapshotJ01PlainData(e.session,null,'J01_EXPECTED_CONTEXT_INVALID');
  const input=snapshotJ01PlainData(e.requestedInput,['pointer','keyboard'],
    'J01_EXPECTED_CONTEXT_INVALID');
  return Object.freeze({...e,session,requestedInput:input});
}
const WORD = x => typeof x === 'string' && x.length > 0 && x.length <= 256 &&
  !/[\x00-\x1f\x7f]/.test(x);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail = code => Object.freeze({verified:false,code,grantConsumed:false});
const REQUESTED_KEYS = ['pointer','keyboard'];

function canonicalGrantSnapshot(payload) {
  if (payload.protocol !== PROTOCOL || payload.origin !== ORIGIN ||
      payload.ownerInteracted !== true)
    throw new Error('J01_GRANT_NOT_OWNER_INTERACTIVE');
  for (const name of [
    'signerPrincipal','keyId','incidentId','operationId','callerPrincipal',
    'ownerPrincipal','sessionId','seatId','displayId'
  ]) if (!WORD(payload[name])) throw new Error('J01_GRANT_PRINCIPAL_INVALID');
  if (typeof payload.consentNonce !== 'string' ||
      !UUID.test(payload.consentNonce)) throw new Error('J01_GRANT_NONCE_INVALID');
  const input=payload.requestedInput;
  if (typeof input.pointer !== 'boolean' || typeof input.keyboard !== 'boolean' ||
      (!input.pointer && !input.keyboard))
    throw new Error('J01_GRANT_INPUT_SCOPE_INVALID');
  if (!Number.isInteger(payload.ttlSeconds) || payload.ttlSeconds < 10 ||
      payload.ttlSeconds > 120 ||
      !Number.isSafeInteger(payload.issuedAtMs) ||
      !Number.isSafeInteger(payload.expiresAtMs))
    throw new Error('J01_GRANT_TIME_INVALID');
  // Build a fixed-order wire format. Unrecognized fields cannot be signed or ignored.
  const ordered={};
  for (const k of FIELDS) ordered[k]=k==='requestedInput'
    ? {pointer:input.pointer,keyboard:input.keyboard}:payload[k];
  return Buffer.from(PREFIX+JSON.stringify(ordered),'utf8');
}

export function canonicalJ01Grant(payload) {
  return canonicalGrantSnapshot(snapshotJ01GrantPayload(payload));
}

export function createJ01OwnerGrantVerifier({
  pinnedPublicKey, signerPrincipal, keyId, consumeNonce, archiveExactGrant,
  clock=Date.now
}={}) {
  if (!WORD(signerPrincipal) || !WORD(keyId) ||
      typeof consumeNonce !== 'function' ||
      typeof archiveExactGrant !== 'function' || typeof clock !== 'function')
    throw new TypeError('J01_INDEPENDENT_TRUST_BOOTSTRAP_REQUIRED');
  // createPublicKey(privateKey) derives a public key. That behavior must
  // NOT turn an exposed signer private key into an accepted trust root.
  let key;
  if (pinnedPublicKey?.type === 'public') {
    key=pinnedPublicKey;
  } else if (typeof pinnedPublicKey === 'string' &&
             pinnedPublicKey.startsWith('-----BEGIN PUBLIC KEY-----')) {
    try { key=createPublicKey(pinnedPublicKey); }
    catch { throw new TypeError('J01_INDEPENDENT_TRUST_BOOTSTRAP_REQUIRED'); }
  } else {
    throw new TypeError('J01_INDEPENDENT_TRUST_BOOTSTRAP_REQUIRED');
  }
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519')
    throw new TypeError('J01_SIGNER_KEY_MUST_BE_ED25519_PUBLIC');
  const fingerprint=createHash('sha256').update(key.export({
    type:'spki',format:'der'
  })).digest('hex');

  return async function verifyJ01OwnerGrant({signedOwnerGrant,expected}={}) {
    let envelope,context;
    try {
      envelope=snapshotJ01PlainData(signedOwnerGrant,['payload','signature'],
        'J01_SIGNED_GRANT_REQUIRED');
      context=snapshotJ01ExpectedContext(expected);
    } catch { return fail('J01_SIGNED_GRANT_REQUIRED'); }
    let payload,bytes;
    try {
      payload=snapshotJ01GrantPayload(envelope.payload);
      bytes=canonicalGrantSnapshot(payload);
    } catch { return fail('J01_GRANT_SCHEMA_INVALID'); }
    if (bytes.length > 4096) return fail('J01_GRANT_TOO_LARGE');

    // All operation and caller fields come from the independent host-attested
    // context, never from the remote user's requested grant.
    if (payload.signerPrincipal !== signerPrincipal || payload.keyId !== keyId ||
        !WORD(context.incidentId) || !WORD(context.operationId) ||
        !WORD(context.callerPrincipal) ||
        payload.incidentId !== context.incidentId ||
        payload.operationId !== context.operationId ||
        payload.callerPrincipal !== context.callerPrincipal ||
        payload.ownerPrincipal !== context.session.ownerPrincipal ||
        payload.sessionId !== context.session.sessionId ||
        payload.seatId !== context.session.seatId ||
        payload.displayId !== context.session.displayId ||
        payload.consentNonce !== context.consentNonce ||
        !UUID.test(context.consentNonce ?? '') ||
        payload.ttlSeconds !== context.ttlSeconds ||
        payload.requestedInput.pointer !== context.requestedInput.pointer ||
        payload.requestedInput.keyboard !== context.requestedInput.keyboard)
      return fail('J01_SIGNED_GRANT_CONTEXT_MISMATCH');

    const now=clock();
    if (!Number.isSafeInteger(now) ||
        payload.issuedAtMs > now+3000 ||
        now-payload.issuedAtMs > 30000 ||
        payload.expiresAtMs <= now ||
        payload.expiresAtMs > payload.issuedAtMs+payload.ttlSeconds*1000)
      return fail('J01_GRANT_EXPIRED_OR_TIME_INVALID');
    const text=envelope.signature;
    if (typeof text !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(text))
      return fail('J01_GRANT_SIGNATURE_INVALID');
    const signature=Buffer.from(text,'base64url');
    if (signature.length!==64 || signature.toString('base64url')!==text)
      return fail('J01_GRANT_SIGNATURE_INVALID');
    if (!cryptoVerify(null,bytes,key,signature))
      return fail('J01_GRANT_SIGNATURE_INVALID');

    const digest=createHash('sha256').update(bytes).update(signature).digest('hex');
    // The external nonce registry must perform a durable atomic reserve.
    // A failed archival burns the nonce and DOES NOT authorize input.
    let claimed;
    try {
      claimed=await consumeNonce({
        consentNonce:payload.consentNonce,
        operationId:payload.operationId,
        incidentId:payload.incidentId,grantSha256:digest,
        expiresAtMs:payload.expiresAtMs
      });
    } catch { return fail('J01_REPLAY_REGISTRY_UNAVAILABLE'); }
    if (claimed?.consumed!==true) return fail('J01_REPLAY_OR_NONCE_NOT_RESERVED');
    try {
      const archived=await archiveExactGrant({
        grant:Object.freeze({payload,signature:text}),grantSha256:digest,
        trustedKeyFingerprint:fingerprint,attestedCaller:context.callerPrincipal
      });
      if (archived?.archived!==true)
        return fail('J01_SIGNED_GRANT_ARCHIVE_UNCONFIRMED');
    } catch { return fail('J01_SIGNED_GRANT_ARCHIVE_UNCONFIRMED'); }

    return Object.freeze({
      verified:true,code:'J01_SIGNED_OWNER_GRANT_VERIFIED',
      consentNonce:payload.consentNonce,
      signerPrincipal,grantSha256:digest,
      trustedKeyFingerprint:fingerprint,
      bindingId:digest,grantConsumed:true,archiveConfirmed:true
    });
  };
}
