import test from 'node:test';
import assert from 'node:assert/strict';
import { probeV2Idp, v2IssuerDiscoveryUrls } from '../tools/v2-idp-discovery-preflight.mjs';

const issuer = 'https://identity.example.test/realms/commander';
const resource = 'https://commander.example.test/mcp';
const metadata = {
  issuer,
  authorization_endpoint: issuer + '/protocol/openid-connect/auth',
  token_endpoint: issuer + '/protocol/openid-connect/token',
  jwks_uri: issuer + '/protocol/openid-connect/certs',
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
  scopes_supported: ['commander.workflow'],
  authorization_response_iss_parameter_supported: true,
  client_id_metadata_document_supported: true
};
const json = (body, init = {}) => new Response(JSON.stringify(body), {
  status: init.status ?? 200,
  headers: { 'content-type': 'application/json', ...init.headers }
});
test('RFC8414 path discovery falls back to same-issuer OIDC on 404', async () => {
  const seen = [];
  const answer = await probeV2Idp({
    issuer, resource, clientRegistration: 'client-id-metadata',
    fetchImpl: async (url, opts) => {
      seen.push(url);
      assert.equal(opts.redirect, 'manual');
      return seen.length <= 2 ? new Response(null, { status: 404 }) : json(metadata);
    }
  });
  assert.deepEqual(seen, [
    'https://identity.example.test/.well-known/oauth-authorization-server/realms/commander',
    'https://identity.example.test/.well-known/openid-configuration/realms/commander',
    issuer + '/.well-known/openid-configuration'
  ]);
  assert.equal(answer.status, 'IDP_METADATA_PASS_LIVE_GATES_OPEN');
  assert.equal(answer.discoveryUrl, seen[2]);
  assert.equal(answer.issuerResponseIdentificationAdvertised, true);
  assert.equal(answer.resourceAudienceInIssuedTokenVerified, false);
  assert.equal(answer.liveChatGptLoginAndConsentVerified, false);
  assert.equal(answer.realMultiChatGrantRevokeVerified, false);
  assert.equal(answer.readyForProduction, false);
});
test('reject malformed issuer, credentials and HTTP before network I/O', async () => {
  for (const value of ['http://idp.example.test', 'https://a:b@idp.example.test',
    'https://idp.example.test/tenant?q=x', 'https://idp.example.test/#frag',
    'https://idp.example.test:8443', 'https://idp.example.test/tenant\nx']) {
    assert.throws(() => v2IssuerDiscoveryUrls(value), { code: 'IDP_ISSUER_INVALID' });
  }
  let called = false;
  await assert.rejects(probeV2Idp({
    issuer: 'http://idp.example.test', resource,
    fetchImpl: async () => { called = true; return json(metadata); }
  }), { code: 'IDP_ISSUER_INVALID' });
  assert.equal(called, false);
});
test('non-404 status and redirects never trigger fallback or readiness', async () => {
  for (const status of [301, 401, 403, 500]) {
    let calls = 0;
    await assert.rejects(probeV2Idp({
      issuer, resource, fetchImpl: async () => {
        calls += 1; return new Response(null, { status });
      }
    }), { code: 'IDP_DISCOVERY_HTTP_ERROR' });
    assert.equal(calls, 1);
  }
});
test('metadata issuer/PKCE/scope cannot be substituted by discovery response', async () => {
  for (const altered of [
    { issuer: 'https://evil.example.test' },
    { code_challenge_methods_supported: ['plain'] },
    { scopes_supported: ['openid'] }
  ]) {
    await assert.rejects(probeV2Idp({
      issuer, resource, fetchImpl: async () => json({ ...metadata, ...altered })
    }));
  }
});
test('invalid JSON, content-type, oversized body and 404-only fail closed', async () => {
  for (const response of [
    new Response('not-json', { headers: { 'content-type': 'application/json' } }),
    new Response('{}', { headers: { 'content-type': 'text/html' } }),
    new Response('x'.repeat(65537), { headers: { 'content-type': 'application/json' } })
  ]) {
    await assert.rejects(probeV2Idp({
      issuer, resource, fetchImpl: async () => response
    }));
  }
  await assert.rejects(probeV2Idp({
    issuer, resource, fetchImpl: async () => new Response(null, { status: 404 })
  }), { code: 'IDP_DISCOVERY_NOT_FOUND' });
});
test('CIMD without advertised support and missing scope reject discovery', async () => {
  await assert.rejects(probeV2Idp({
    issuer, resource, clientRegistration: 'client-id-metadata',
    fetchImpl: async () => json({ ...metadata, client_id_metadata_document_supported: false })
  }), { code: 'V2_PROVIDER_CIMD_UNSUPPORTED' });
  await assert.rejects(probeV2Idp({
    issuer, resource, requiredScopes: ['commander.workflow', 'commander.seat'],
    fetchImpl: async () => json(metadata)
  }), { code: 'V2_PROVIDER_SCOPE_NOT_ADVERTISED' });
});

test('OIDC path insertion succeeds before appending, root issuer has no duplicate endpoint', async () => {
  const seen = [];
  const answer = await probeV2Idp({
    issuer, resource,
    fetchImpl: async url => {
      seen.push(url);
      return seen.length === 1 ? new Response(null, { status: 404 }) : json(metadata);
    }
  });
  assert.equal(seen.length, 2);
  assert.equal(answer.discoveryUrl, 'https://identity.example.test/.well-known/openid-configuration/realms/commander');
  assert.deepEqual(v2IssuerDiscoveryUrls('https://identity.example.test'), [
    'https://identity.example.test/.well-known/oauth-authorization-server',
    'https://identity.example.test/.well-known/openid-configuration'
  ]);
});
test('three 404s produce blocked result, without redirects or untrusted fallback', async () => {
  let count = 0;
  await assert.rejects(probeV2Idp({
    issuer, resource, fetchImpl: async () => {
      count++;
      return new Response(null, { status: 404 });
    }
  }), { code: 'IDP_DISCOVERY_NOT_FOUND' });
  assert.equal(count, 3);
});
