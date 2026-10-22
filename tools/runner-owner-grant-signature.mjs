// Synthetic preview grant signature format v1: fixed-domain, sorted-key tuple encoding.
// This is a project-specific fixed-schema format, NOT a generic RFC 8785 implementation.
const DOMAIN = 'RC-OWNER-RUNNER-PREVIEW-SIGNATURE-V1\x00';
export function grantSigningBytes(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw Error('INVALID_SIGNING_PAYLOAD');
  const keys = Object.keys(payload).sort();
  const entries = keys.map(k => [k,payload[k]]);
  return Buffer.from(DOMAIN + JSON.stringify(entries), 'utf8');
}
