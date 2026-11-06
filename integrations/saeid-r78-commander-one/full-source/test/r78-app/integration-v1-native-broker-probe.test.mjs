// V1-00 R60: explicitly opted-in native READ-ONLY canary, disposable HTTP/JWT.
// This is NOT production ChatGPT OAuth, user session attestation, or a grant
// for arbitrary privileged actions. Never changes an installed Router/service.
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
import { requestPrivilegeBroker } from '../../src/privilege-client.mjs';

const enabled = process.env.RC_V100_NATIVE_READONLY_PROBE === '1';
const hostId = 'r60-disposable-host';
const profileId = 'r60-disposable-profile';
const issuer = 'https://r60.fixture.invalid';
const audience = 'https://r60-resource.fixture.invalid/mcp';
const secret = 'S'.repeat(43);
const digest = x => createHash('sha256').update(x).digest('hex');
const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
const route = conversationId => ({
  hostId, profileId, principalId: 'owner-fixture', conversationId,
  operationId: 'r60-readonly-os-probe',
  target: { kind: 'workflow-root', id: 'r60-disposable-root' }
});
const rpc = (name = 'native_probe', args = {}) => ({
  jsonrpc: '2.0', id: 60, method: 'tools/call',
  params: { name, arguments: args }
});
const listen = async server => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};
async function freePort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise(resolve => server.close(resolve));
  return port;
}
function nativeValid(x) {
  return x.ok === true && (process.platform === 'win32'
    ? x.sid === 'S-1-5-18' && x.isSystem === true
    : process.platform === 'linux' && x.effectiveUid === 0 && x.root === true);
}
async function post(port, token, { tunnel = true, data = rpc(), session } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (tunnel) headers['x-commander-tunnel-auth'] = secret;
  if (token) headers.authorization = 'Bearer ' + token;
  if (session) headers['mcp-session-id'] = session;
  const response = await fetch('http://127.0.0.1:' + port + '/mcp', {
    method: 'POST', headers, body: JSON.stringify(data), redirect: 'error',
    signal: AbortSignal.timeout(5000)
  });
  return { status: response.status, data: await response.json() };
}

test('R60 one opted-in protected grant invokes installed fixed os.probe and stops on revoke', {
  skip: enabled ? false : 'requires RC_V100_NATIVE_READONLY_PROBE=1 on an enrolled owner host'
}, async () => {
  assert.ok(['win32', 'linux'].includes(process.platform));
  // This is the only native operation. The installed broker enforces its
  // own fixed allowlist; no command strings or user-supplied native actions.
  const baseline = await requestPrivilegeBroker('os.probe');
  assert.equal(nativeValid(baseline), true, 'REAL_INSTALLED_NATIVE_BROKER_REQUIRED');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-v100-r60-native-'));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = { ...publicKey.export({ format: 'jwk' }),
    kid: 'r60-ephemeral', alg: 'EdDSA', use: 'sig', key_ops: ['verify'] };
  const verify = createV2JwksTokenVerifier({
    issuer, audience, jwksUri: issuer + '/jwks',
    request: async () => new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    })
  });
  const issue = (jti, extra = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const message = b64({ typ: 'at+jwt', alg: 'EdDSA', kid: 'r60-ephemeral' })
      + '.' + b64({
        iss: issuer, aud: audience, sub: 'fixture-owner', scope: 'commander.workflow',
        exp: now + 120, nbf: now - 5, jti, ...extra
      });
    return message + '.' + sign(null, Buffer.from(message), privateKey).toString('base64url');
  };
  const tokenA = issue('chat-a'), tokenB = issue('chat-b');
  // This token-to-chat map is an IN-MEMORY TEST FIXTURE; it is not proof of a
  // platform-issued conversation id or authenticated owner-session binding.
  const attested = new Map([[digest(tokenA), 'chat-a'], [digest(tokenB), 'chat-b']]);
  let router;
  let backend;
  let grants;
  const calls = [];
  try {
    grants = new V2GrantRegistry({
      directory: path.join(tmp, 'grants'),
      authorizeAdministration: ({ actor }) => actor === 'r60-explicit-test-owner'
    });
    backend = http.createServer(async (req, res) => {
      let raw = '';
      for await (const part of req) raw += part.toString('utf8');
      let message;
      try { message = JSON.parse(raw); } catch { message = null; }
      if (req.method !== 'POST' || req.url !== '/mcp' ||
          message?.method !== 'tools/call' ||
          message.params?.name !== 'native_probe' ||
          Object.keys(message.params.arguments ?? {}).length !== 0) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 60,
          error: { code: -32003, message: 'FIXED_READONLY_TOOL_REQUIRED' } }));
        return;
      }
      calls.push({
        authorization: req.headers.authorization,
        tunnel: req.headers['x-commander-tunnel-auth'],
        session: req.headers['mcp-session-id']
      });
      const probe = await requestPrivilegeBroker('os.probe');
      const ok = nativeValid(probe);
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 60,
        result: { action: 'os.probe', ok,
          nativeKind: process.platform === 'win32' ? 'SYSTEM' : 'root' } }));
    });
    const targetPort = await listen(backend);
    const routerPort = await freePort();
    const authFile = path.join(tmp, 'secret.key');
    const stateFile = path.join(tmp, 'router.json');
    fs.writeFileSync(authFile, secret, { mode: 0o600 });
    writeRouterStateAtomic(stateFile, {
      schema: 1, profile: profileId, generation: 1,
      active: { port: targetPort, version: 'r60-test', commit: 'a'.repeat(40),
        configSha256: 'b'.repeat(64) }
    });
    router = await startRouter({
      listenPort: routerPort, stateFile, authFile,
      protectedMode: true, hostId,
      verifyCaller: async token => {
        const claims = await verify(token);
        if (claims.subject !== 'fixture-owner' ||
            !claims.scopes.includes('commander.workflow')) return null;
        const conversationId = attested.get(digest(token));
        if (!conversationId) return null;
        return Object.freeze({
          verified: true, source: 'v1-01-trusted-ingress', hostId, profileId,
          principalId: 'owner-fixture', conversationId,
          expiresAtMs: claims.expiresAtMs
        });
      },
      authorizeTool: async (identity, invocation) => {
        if (invocation.rpcMethod !== 'tools/call' ||
            invocation.tool !== 'native_probe' ||
            Object.keys(invocation.arguments ?? {}).length !== 0) return false;
        return grants.isAllowed(route(identity.conversationId), 'native_probe');
      }
    });
    assert.equal((await post(routerPort, null)).status, 403);
    assert.equal((await post(routerPort, tokenA, { tunnel: false })).status, 403);
    assert.equal((await post(routerPort, tokenA)).status, 403);
    assert.equal(calls.length, 0);
    const binding = route('chat-a');
    assert.equal(grants.change({
      route: binding, tool: 'native_probe', status: 'ENABLED',
      actor: 'r60-explicit-test-owner', expectedRevision: 0,
      reason: 'isolated read-only test approval, not live owner consent'
    }).revision, 1);
    const allowed = await post(routerPort, tokenA);
    assert.equal(allowed.status, 200);
    assert.deepEqual(allowed.data.result, {
      action: 'os.probe', ok: true,
      nativeKind: process.platform === 'win32' ? 'SYSTEM' : 'root'
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].authorization, undefined);
    assert.equal(calls[0].tunnel, undefined);
    assert.equal(calls[0].session, undefined);
    assert.equal((await post(routerPort, tokenB)).status, 403);
    assert.equal((await post(routerPort, tokenA, { session: 'forged-chat-b' })).status, 403);
    assert.equal((await post(routerPort, tokenA, {
      data: rpc('native_probe', { command: 'whoami' })
    })).status, 403);
    assert.equal((await post(routerPort, tokenA, { data: rpc('run_shell') })).status, 403);
    assert.equal((await post(routerPort, issue('wrong-aud', {
      aud: 'https://wrong.fixture.invalid'
    }))).status, 403);
    assert.equal(calls.length, 1);
    assert.throws(() => grants.change({
      route: binding, tool: 'native_probe', status: 'REVOKED',
      actor: 'unauthorized-actor', expectedRevision: 1,
      reason: 'test denies unauthorized revocation'
    }), { code: 'V2_GRANT_ADMIN_AUTH_REQUIRED' });
    assert.equal(grants.change({
      route: binding, tool: 'native_probe', status: 'REVOKED',
      actor: 'r60-explicit-test-owner', expectedRevision: 1,
      reason: 'explicit test revoke'
    }).revision, 2);
    assert.equal((await post(routerPort, tokenA)).status, 403);
    assert.equal(calls.length, 1);
    assert.equal(grants.events(binding, 'native_probe').length, 2);
  } finally {
    if (router) await router.close();
    if (backend) await new Promise(resolve => backend.close(resolve));
    if (grants) grants.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
