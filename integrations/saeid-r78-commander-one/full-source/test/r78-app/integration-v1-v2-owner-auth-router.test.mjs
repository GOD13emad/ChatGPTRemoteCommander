// V1-00 integration-only evidence. Both OAuth issuer and owner-native session
// binding are ephemeral TEST FIXTURES, not production ChatGPT authentication.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { startRouter, writeRouterStateAtomic } from '../../src/stable-router.mjs';
import { createV2JwksTokenVerifier } from '../../src/v2-oauth-jwks.mjs';
import { V2GrantRegistry } from '../../src/v2-grant-registry.mjs';

const hostId = 'qa-host';
const profileId = 'qa-profile';
const issuer = 'https://issuer.fixture.invalid';
const audience = 'https://resource.fixture.invalid/mcp';
const secret = 'T'.repeat(43);
const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
const digest = v => createHash('sha256').update(v).digest('hex');
const body = (input = 'approved-fixture') => ({
  jsonrpc: '2.0', id: 71, method: 'tools/call',
  params: { name: 'send_terminal', arguments: { input } }
});
const route = conversationId => ({
  hostId, principalId: 'owner-1', profileId, conversationId,
  operationId: 'safe-read-fixture',
  target: { kind: 'workflow-root', id: 'fixture-root' }
});
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
async function freePort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function request(port, token, { tunnel = true, action = body(), headers = {} } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (tunnel) h['x-commander-tunnel-auth'] = secret;
  if (token) h.authorization = 'Bearer ' + token;
  const response = await fetch('http://127.0.0.1:' + port + '/mcp', {
    method: 'POST', headers: h, body: JSON.stringify(action),
    signal: AbortSignal.timeout(4000), redirect: 'error'
  });
  return { status: response.status, data: await response.json() };
}

test('V1 Router composes real V2 JWKS verification and durable grant/revoke without installed authority', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v100-auth-g1-compose-'));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const kid = 'qa-key';
  const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'EdDSA', use: 'sig', key_ops: ['verify'] };
  let jwksLoads = 0;
  const verifyJwt = createV2JwksTokenVerifier({
    issuer, audience, jwksUri: issuer + '/jwks',
    request: async () => {
      jwksLoads++;
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
  });
  const signJwt = (jti, overrides = {}) => {
    const t = Math.floor(Date.now() / 1000);
    const header = b64({ alg: 'EdDSA', kid, typ: 'at+jwt' });
    const claims = b64({
      iss: issuer, aud: audience, sub: 'oauth-owner-1', scope: 'commander.workflow',
      exp: t + 120, nbf: t - 10, jti, ...overrides
    });
    const signingInput = header + '.' + claims;
    return signingInput + '.' + sign(null, Buffer.from(signingInput), privateKey).toString('base64url');
  };
  const tokenA = signJwt('fixture-a'), tokenB = signJwt('fixture-b');
  // This map stands in for a separately verified native session. An OAuth
  // token by itself NEVER supplies an independently attested ChatGPT chat.
  const independentlyAttested = new Map([
    [digest(tokenA), { principalId: 'owner-1', conversationId: 'chat-a' }],
    [digest(tokenB), { principalId: 'owner-1', conversationId: 'chat-b' }]
  ]);
  let backend;
  let router;
  let grants;
  let forwarded = 0;
  const incoming = [];
  try {
    grants = new V2GrantRegistry({
      directory: path.join(root, 'grants'),
      authorizeAdministration: ({ actor }) => actor === 'fixture-native-owner'
    });
    backend = http.createServer(async (req, res) => {
      let payload = '';
      for await (const chunk of req) payload += chunk.toString('utf8');
      forwarded++;
      incoming.push({ headers: req.headers, payload });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 71, result: { fixture: true } }));
    });
    const backendPort = await listen(backend);
    const routerPort = await freePort();
    const authFile = path.join(root, 'tunnel.key');
    const stateFile = path.join(root, 'router.json');
    fs.writeFileSync(authFile, secret, { mode: 0o600 });
    writeRouterStateAtomic(stateFile, {
      schema: 1, profile: profileId, generation: 1,
      active: { port: backendPort, version: 'fixture', commit: 'a'.repeat(40),
        configSha256: 'b'.repeat(64) }
    });
    router = await startRouter({
      listenPort: routerPort, stateFile, authFile, protectedMode: true, hostId,
      verifyCaller: async token => {
        const claim = await verifyJwt(token);
        if (!claim.scopes.includes('commander.workflow') || claim.subject !== 'oauth-owner-1') return null;
        const native = independentlyAttested.get(digest(token));
        if (!native) return null;
        return Object.freeze({
          verified: true, source: 'v1-01-trusted-ingress', hostId, profileId,
          principalId: native.principalId, conversationId: native.conversationId,
          expiresAtMs: claim.expiresAtMs
        });
      },
      authorizeTool: async (identity, invocation) => {
        if (invocation.tool !== 'send_terminal' || invocation.rpcMethod !== 'tools/call') return false;
        // The fixture target and operation are server-selected, never read
        // from untrusted JSON or HTTP headers.
        if (Object.keys(invocation.arguments).length !== 1 ||
            invocation.arguments.input !== 'approved-fixture') return false;
        return grants.isAllowed(route(identity.conversationId), 'send_terminal');
      }
    });

    assert.equal((await request(routerPort, null)).status, 403);
    assert.equal((await request(routerPort, tokenA, { tunnel: false })).status, 403);
    assert.equal((await request(routerPort, tokenA)).status, 403);
    assert.equal(forwarded, 0);
    const a = route('chat-a');
    const first = grants.change({ route: a, tool: 'send_terminal', status: 'ENABLED',
      expectedRevision: 0, actor: 'fixture-native-owner', reason: 'test-only explicit owner fixture' });
    assert.equal(first.revision, 1);
    assert.equal((await request(routerPort, tokenA)).status, 200);
    assert.equal(forwarded, 1);
    assert.equal((await request(routerPort, tokenB)).status, 403);
    assert.equal((await request(routerPort, tokenA, { action: body('wrong-fixture') })).status, 403);
    assert.equal((await request(routerPort, tokenA, {
      headers: { 'mcp-session-id': 'forged-chat-b' }
    })).status, 403);
    const tampered = tokenA.split('.');
    const changed = { iss: issuer, aud: audience, sub: 'oauth-owner-1',
      scope: 'commander.workflow', exp: Math.floor(Date.now() / 1000) + 120,
      nbf: Math.floor(Date.now() / 1000) - 10, jti: 'tampered-chat-b' };
    tampered[1] = b64(changed);
    assert.equal((await request(routerPort, tampered.join('.'))).status, 403);
    assert.equal((await request(routerPort, signJwt('wrong-aud', {
      aud: 'https://wrong.fixture.invalid'
    }))).status, 403);
    assert.equal(forwarded, 1);
    assert.equal(incoming[0].headers.authorization, undefined);
    assert.equal(incoming[0].headers['x-commander-tunnel-auth'], undefined);
    assert.equal(incoming[0].headers['mcp-session-id'], undefined);

    assert.throws(() => grants.change({ route: a, tool: 'send_terminal',
      status: 'REVOKED', expectedRevision: 1,
      actor: 'not-owner', reason: 'test-only unauthorized revocation' }), {
      code: 'V2_GRANT_ADMIN_AUTH_REQUIRED'
    });
    const revoked = grants.change({ route: a, tool: 'send_terminal',
      status: 'REVOKED', expectedRevision: 1,
      actor: 'fixture-native-owner', reason: 'test-only immediate revocation' });
    assert.equal(revoked.revision, 2);
    assert.equal((await request(routerPort, tokenA)).status, 403);
    assert.equal(forwarded, 1);
    assert.equal(grants.events(a, 'send_terminal').length, 2);
    assert.equal(jwksLoads, 1);
  } finally {
    if (router) await router.close();
    if (backend) await new Promise(resolve => backend.close(resolve));
    if (grants) grants.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
