// V2-G1 read-only IdP discovery probe. No login, registration, credential
// exchange, listener, owner grant, or V1 routing side effect.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { validateV2OAuthProvider } from '../src/v2-oauth-provider-preflight.mjs';

const MAX_BYTES = 65536;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function pinnedIssuer(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\\]/.test(value))
    fail('IDP_ISSUER_INVALID');
  let url;
  try { url = new URL(value); } catch { fail('IDP_ISSUER_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (url.port && url.port !== '443') || !url.hostname
    || (url.href !== value && !(url.pathname === '/' && url.origin === value))
    || url.pathname.includes('/../'))
    fail('IDP_ISSUER_INVALID');
  return url;
}
export function v2IssuerDiscoveryUrls(issuer) {
  const url = pinnedIssuer(issuer);
  const path = url.pathname.replace(/\/$/, '');
  return Object.freeze([
    url.origin + '/.well-known/oauth-authorization-server' + path,
    ...(path ? [url.origin + '/.well-known/openid-configuration' + path] : []),
    url.origin + path + '/.well-known/openid-configuration'
  ]);
}
async function readMetadata(response) {
  if (!response || typeof response.status !== 'number') fail('IDP_BAD_RESPONSE');
  if (response.status !== 200) fail('IDP_DISCOVERY_HTTP_ERROR');
  const type = response.headers?.get('content-type') || '';
  if (!/^application\/(?:json|[\w.+-]+\+json)(?:\s*;|$)/i.test(type))
    fail('IDP_METADATA_CONTENT_TYPE');
  const len = response.headers?.get('content-length');
  if (len !== null && len !== undefined
      && (!/^\d+$/.test(len) || Number(len) > MAX_BYTES))
    fail('IDP_METADATA_TOO_LARGE');
  if (!response.body || typeof response.body.getReader !== 'function')
    fail('IDP_METADATA_BODY_MISSING');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        fail('IDP_METADATA_TOO_LARGE');
      }
      chunks.push(Buffer.from(part.value));
    }
  } finally { reader.releaseLock(); }
  let metadata;
  try { metadata = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
  catch { fail('IDP_METADATA_JSON_INVALID'); }
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object')
    fail('IDP_METADATA_JSON_INVALID');
  return metadata;
}
export async function probeV2Idp({
  issuer, resource, clientRegistration = 'pre-registered',
  requiredScopes = ['commander.workflow'],
  fetchImpl = globalThis.fetch, timeoutMs = 5000
}) {
  const urls = v2IssuerDiscoveryUrls(issuer);
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs)
      || timeoutMs < 100 || timeoutMs > 15000)
    fail('IDP_PROBE_CONFIG_INVALID');
  let response; let discoveryUrl;
  for (const url of urls) {
    let result;
    try {
      result = await fetchImpl(url, {
        method: 'GET', headers: { Accept: 'application/json' },
        redirect: 'manual', signal: AbortSignal.timeout(timeoutMs)
      });
    } catch { fail('IDP_DISCOVERY_TRANSPORT_ERROR'); }
    if (result.status === 404) continue;
    response = result; discoveryUrl = url; break;
  }
  if (!response) fail('IDP_DISCOVERY_NOT_FOUND');
  // Do not follow HTTP redirects to unknown hosts. Do not try the alternate
  // discovery path after a malformed/non-404 document: fail closed.
  const metadata = await readMetadata(response);
  const contract = validateV2OAuthProvider({
    issuer, resource, metadata, clientRegistration, requiredScopes
  });
  return Object.freeze({
    status: 'IDP_METADATA_PASS_LIVE_GATES_OPEN',
    issuer: contract.issuer,
    audience: contract.audience,
    discoveryUrl,
    clientRegistration: contract.clientRegistration,
    scopes: contract.scopes,
    pkceS256Advertised: true,
    issuerResponseIdentificationAdvertised: contract.issuerResponseIdentificationAdvertised,
    tokenEndpointAuthMethods: contract.tokenEndpointAuthMethods,
    // No metadata document proves that OAuth resource is actually echoed into
    // an issued token, or that a human signed in from ChatGPT.
    resourceAudienceInIssuedTokenVerified: false,
    liveChatGptLoginAndConsentVerified: false,
    realMultiChatGrantRevokeVerified: false,
    readyForProduction: false
  });
}
function cliOptions(args) {
  const options = Object.create(null);
  const keys = new Set(['issuer', 'resource', 'registration', 'scopes']);
  if (args.length % 2) fail('IDP_PROBE_ARGUMENTS_INVALID');
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.startsWith('--') ? args[i].slice(2) : '';
    if (!keys.has(key) || options[key] !== undefined || !args[i + 1])
      fail('IDP_PROBE_ARGUMENTS_INVALID');
    options[key] = args[i + 1];
  }
  if (!options.issuer || !options.resource) fail('IDP_PROBE_ARGUMENTS_INVALID');
  return {
    issuer: options.issuer, resource: options.resource,
    clientRegistration: options.registration || 'pre-registered',
    requiredScopes: options.scopes ? options.scopes.split(',') : ['commander.workflow']
  };
}
async function main() {
  try {
    const result = await probeV2Idp(cliOptions(process.argv.slice(2)));
    process.stdout.write(JSON.stringify(result) + '\n');
    // A passing metadata-only probe is never activation acceptance.
    process.exitCode = 2;
  } catch (error) {
    process.stdout.write(JSON.stringify({
      status: 'IDP_PROBE_BLOCKED',
      error: typeof error?.code === 'string' ? error.code : 'IDP_PROBE_FAILED',
      readyForProduction: false
    }) + '\n');
    process.exitCode = 3;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
