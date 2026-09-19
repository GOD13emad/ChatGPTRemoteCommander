import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import {
  loadPointer, loadRouterConfig, validateRouterConfig
} from '../src/router-state.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routerFile = path.join(repo, 'src', 'router.mjs');
const controlFile = path.join(repo, 'tools', 'router-control.mjs');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function identity(root, port, slotId, character) {
  return {
    profile: 'default', version: '0.8.0', configSha256: character.repeat(64),
    commit: character.repeat(40), slotId, projectDir: path.join(root, slotId), port
  };
}

function identityArgs(value) {
  return [
    '--profile', value.profile, '--version', value.version,
    '--config-sha256', value.configSha256, '--commit', value.commit,
    '--slot-id', value.slotId, '--project-dir', value.projectDir, '--port', String(value.port)
  ];
}

function sendJson(response, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': data.length });
  response.end(data);
}

async function startBackend(value, options = {}) {
  let releaseSlow;
  let announceSlow;
  const slow = new Promise(resolve => { releaseSlow = resolve; });
  const slowStarted = new Promise(resolve => { announceSlow = resolve; });
  const requests = [];
  const server = http.createServer(async (request, response) => {
    requests.push({ url: request.url, method: request.method, headers: { ...request.headers } });
    if (request.method === 'GET' && request.url === '/health') {
      if (options.redirectHealth) {
        response.writeHead(302, { location: 'http://127.0.0.1/elsewhere' });
        response.end();
        return;
      }
      const observed = options.healthIdentity ?? value;
      return sendJson(response, options.unhealthy ? 503 : 200, {
        ok: !options.unhealthy,
        name: 'chatgpt-remote-commander',
        version: observed.version,
        configSha256: observed.configSha256,
        instance: { profile: observed.profile, isolated: false },
        backend: observed
      });
    }
    if (request.method !== 'POST' || request.url !== '/mcp') return sendJson(response, 404, { error: 'not_found' });
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let message = {};
    try { message = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
    if (message?.method === 'notifications/initialized' && !Object.hasOwn(message, 'id')) {
      response.writeHead(202);
      response.end();
      return;
    }
    const outcome = message?.params?.arguments?.outcome;
    if (['hang', 'disconnect', 'delayed', 'redirect', 'invalid-type', 'invalid-json', 'invalid-envelope',
      'invalid-array', 'invalid-error', 'mismatched-id', 'rpc-error', 'drip'].includes(outcome)) {
      if (options.effectCounter) options.effectCounter.count += 1;
      if (outcome === 'hang') return;
      if (outcome === 'disconnect') {
        response.socket.destroy();
        return;
      }
      if (outcome === 'delayed') await wait(250);
      if (outcome === 'redirect') {
        response.writeHead(302, { location: 'http://127.0.0.1/elsewhere', 'content-type': 'application/json' });
        response.end('{}');
        return;
      }
      if (outcome === 'invalid-type') {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('effect-applied');
        return;
      }
      if (outcome === 'invalid-json') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{invalid');
        return;
      }
      if (outcome === 'invalid-envelope') return sendJson(response, 200, {});
      if (outcome === 'invalid-array') return sendJson(response, 200, []);
      if (outcome === 'invalid-error') {
        return sendJson(response, 200, {
          jsonrpc: '2.0', id: message.id ?? null,
          error: { code: 'not-an-integer', message: 7 }
        });
      }
      if (outcome === 'mismatched-id') {
        return sendJson(response, 200, {
          jsonrpc: '2.0', id: `wrong-${String(message.id)}`,
          result: { effectApplied: true }
        });
      }
      if (outcome === 'rpc-error') {
        return sendJson(response, 200, {
          jsonrpc: '2.0', id: message.id ?? null,
          error: { code: -32000, message: 'valid backend JSON-RPC error' }
        });
      }
      if (outcome === 'drip') {
        response.writeHead(200, { 'content-type': 'application/json' });
        for (let index = 0; index < 8 && !response.destroyed; index++) {
          response.write(index === 0 ? '{' : ' ');
          await wait(200);
        }
        if (!response.destroyed) response.end('}');
        return;
      }
    }
    if (message?.params?.arguments?.slow === true) {
      announceSlow();
      await slow;
    }
    if (options.responseBytes) {
      const data = Buffer.alloc(options.responseBytes, 0x78);
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': data.length });
      response.end(data);
      return;
    }
    const data = Buffer.from(JSON.stringify({
      jsonrpc: '2.0', id: message.id ?? null,
      result: { backend: value.slotId, host: request.headers.host }
    }));
    response.writeHead(200, {
      'content-type': 'application/json', 'content-length': data.length,
      'set-cookie': 'must-not-return=1', location: 'https://untrusted.invalid/',
      'access-control-allow-origin': '*'
    });
    response.end(data);
  });
  server.listen(value.port, '127.0.0.1');
  await once(server, 'listening');
  return {
    server, requests, slowStarted, releaseSlow,
    async close() { releaseSlow(); await new Promise(resolve => server.close(resolve)); }
  };
}

function runNode(file, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd: repo, env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr, pid: child.pid }));
  });
}

function control(configPath, command, args = []) {
  return runNode(controlFile, [command, ...args], { REMOTE_COMMANDER_ROUTER_CONFIG: configPath });
}

async function startRouter(configPath, port) {
  const child = spawn(process.execPath, [routerFile], {
    cwd: repo,
    env: { ...process.env, REMOTE_COMMANDER_ROUTER_CONFIG: configPath },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { output += chunk.toString('utf8'); });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`router exited early: ${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/router/health`, { signal: AbortSignal.timeout(300) });
      if (response.ok) return { child, output: () => output };
    } catch {}
    await wait(25);
  }
  child.kill();
  throw new Error(`router startup timeout: ${output}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const closed = once(child, 'close');
  child.kill('SIGTERM');
  await Promise.race([closed, wait(2000)]);
}

async function rpc(port, id, argumentsValue = {}, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'system_status', arguments: argumentsValue } })
  });
  return { response, body: await response.json() };
}

function beginChunkedRpc(port, id) {
  const body = JSON.stringify({
    jsonrpc: '2.0', id, method: 'tools/call',
    params: { name: 'system_status', arguments: {} }
  });
  const split = Math.floor(body.length / 2);
  let request;
  const result = new Promise((resolve, reject) => {
    request = http.request({
      host: '127.0.0.1', port, path: '/mcp', method: 'POST',
      headers: { 'content-type': 'application/json' }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const data = Buffer.concat(chunks);
        try { resolve({ response, body: JSON.parse(data.toString('utf8')) }); }
        catch (error) { reject(error); }
      });
    });
    request.once('error', reject);
    request.write(body.slice(0, split));
  });
  return { result, finish: () => request.end(body.slice(split)) };
}

function beginOversizeChunkedRpc(port, bytes) {
  let request;
  let settled = false;
  const result = new Promise((resolve, reject) => {
    request = http.request({
      host: '127.0.0.1', port, path: '/mcp', method: 'POST',
      headers: { 'content-type': 'application/json' }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        settled = true;
        resolve({ response, body: Buffer.concat(chunks) });
      });
    });
    request.once('error', error => { if (!settled) reject(error); });
    request.write(Buffer.alloc(bytes, 0x78));
  });
  return { request, result };
}

function rawRequest(port, { requestPath = '/mcp', host = `127.0.0.1:${port}`, headers = {}, body = '{}' } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: requestPath, method: 'POST',
      headers: { host, 'content-type': 'application/json', ...headers } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks) }));
    });
    request.once('error', reject);
    request.end(body);
  });
}

async function waitFor(predicate, message, attempts = 150) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await predicate()) return;
    await wait(10);
  }
  assert.fail(message);
}

async function writeConfig(root, port, overrides = {}) {
  const configPath = path.join(root, 'router.json');
  const config = {
    schema: 1, routerId: 'primary', host: '127.0.0.1', port, profile: 'default',
    pointerPath: path.join(root, 'active.json'),
    runtimeStatePath: path.join(root, 'router-runtime.json'),
    healthTimeoutMs: 1000, upstreamTimeoutMs: 5000,
    ...overrides
  };
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2));
  return { configPath, config };
}

test('router control is fail-closed for candidate health, identity, CAS, stale locks and corrupt state', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'rc-router-state-'));
  const servers = [];
  try {
    const routerPort = await freePort();
    const old = identity(root, await freePort(), 'old', 'a');
    await fsp.mkdir(old.projectDir, { recursive: true });
    let oldServer = await startBackend(old);
    servers.push(oldServer);
    const { configPath, config } = await writeConfig(root, routerPort);
    assert.throws(() => validateRouterConfig({ ...config, host: '0.0.0.0' }), /ROUTER_LISTENER_NOT_LOOPBACK/);
    assert.throws(
      () => validateRouterConfig({ ...config, runtimeStatePath: config.pointerPath }),
      /ROUTER_STATE_PATH_COLLISION/
    );
    const linkedSource = path.join(root, 'linked-pointer-source.json');
    const linkedPointer = path.join(root, 'linked-pointer.json');
    await fsp.writeFile(linkedSource, JSON.stringify({
      schema: 1, generation: 1, backend: old, updatedAt: new Date().toISOString()
    }));
    await fsp.link(linkedSource, linkedPointer);
    await assert.rejects(loadPointer(linkedPointer), /ROUTER_POINTER_INVALID/);
    await fsp.unlink(linkedPointer);
    await fsp.unlink(linkedSource);

    const initialized = await control(configPath, 'init', ['--expected-generation', '0', ...identityArgs(old)]);
    assert.equal(initialized.code, 0, initialized.stderr);
    assert.equal(JSON.parse(initialized.stdout).generation, 1);
    const status = await control(configPath, 'status', ['--expected-generation', '1']);
    assert.equal(status.code, 0, status.stderr);

    await oldServer.close();
    servers.splice(servers.indexOf(oldServer), 1);
    const deadReconcile = await control(configPath, 'switch', ['--expected-generation', '1', ...identityArgs(old)]);
    assert.equal(deadReconcile.code, 1);
    assert.match(deadReconcile.stderr, /ROUTER_BACKEND_(?:UNAVAILABLE|TIMEOUT|UNHEALTHY)/);
    assert.equal((await loadPointer(config.pointerPath)).generation, 1);
    oldServer = await startBackend(old);
    servers.push(oldServer);

    const unhealthy = identity(root, await freePort(), 'unhealthy', 'b');
    await fsp.mkdir(unhealthy.projectDir, { recursive: true });
    servers.push(await startBackend(unhealthy, { unhealthy: true }));
    const rejectedHealth = await control(configPath, 'switch', ['--expected-generation', '1', ...identityArgs(unhealthy)]);
    assert.equal(rejectedHealth.code, 1);
    assert.match(rejectedHealth.stderr, /ROUTER_BACKEND_UNHEALTHY/);
    assert.equal((await loadPointer(config.pointerPath)).generation, 1);

    const proposed = identity(root, await freePort(), 'mismatch', 'c');
    await fsp.mkdir(proposed.projectDir, { recursive: true });
    servers.push(await startBackend(proposed, { healthIdentity: { ...proposed, commit: 'd'.repeat(40) } }));
    const rejectedIdentity = await control(configPath, 'switch', ['--expected-generation', '1', ...identityArgs(proposed)]);
    assert.equal(rejectedIdentity.code, 1);
    assert.match(rejectedIdentity.stderr, /ROUTER_BACKEND_IDENTITY_MISMATCH/);
    assert.equal((await loadPointer(config.pointerPath)).generation, 1);

    const next = identity(root, await freePort(), 'next', 'e');
    await fsp.mkdir(next.projectDir, { recursive: true });
    servers.push(await startBackend(next));
    const switched = await control(configPath, 'switch', ['--expected-generation', '1', ...identityArgs(next)]);
    assert.equal(switched.code, 0, switched.stderr);
    assert.equal(JSON.parse(switched.stdout).generation, 2);
    const reconciled = await control(configPath, 'switch', ['--expected-generation', '1', ...identityArgs(next)]);
    assert.equal(reconciled.code, 0, reconciled.stderr);
    assert.equal(JSON.parse(reconciled.stdout).alreadyActive, true);
    assert.equal(JSON.parse(reconciled.stdout).generation, 2);
    assert.equal((await loadPointer(config.pointerPath)).generation, 2);
    const stale = await control(configPath, 'switch', ['--expected-generation', '1', ...identityArgs(old)]);
    assert.equal(stale.code, 1);
    assert.match(stale.stderr, /ROUTER_GENERATION_CONFLICT/);

    const exited = spawn(process.execPath, ['-e', 'process.exit(0)']);
    const deadPid = exited.pid;
    await once(exited, 'close');
    await fsp.writeFile(`${config.pointerPath}.lock`, JSON.stringify({ pid: deadPid, at: new Date(Date.now() - 60000).toISOString() }));
    const recovered = await control(configPath, 'switch', ['--expected-generation', '2', ...identityArgs(old)]);
    assert.equal(recovered.code, 0, recovered.stderr);
    assert.equal((await loadPointer(config.pointerPath)).generation, 3);
    assert.equal(fs.existsSync(`${config.pointerPath}.lock`), false);

    const raced = await Promise.all([
      control(configPath, 'switch', ['--expected-generation', '3', ...identityArgs(next)]),
      control(configPath, 'switch', ['--expected-generation', '3', ...identityArgs(old)])
    ]);
    assert.deepEqual(raced.map(result => result.code).sort(), [0, 1]);
    assert.match(raced.find(result => result.code === 1).stderr, /ROUTER_GENERATION_CONFLICT/);
    assert.equal((await loadPointer(config.pointerPath)).generation, 4);
    const activeAfterRace = await loadPointer(config.pointerPath);
    const activeIdentity = activeAfterRace.backend.slotId === old.slotId ? old : next;
    const staleAba = await control(configPath, 'switch', ['--expected-generation', '1', ...identityArgs(activeIdentity)]);
    assert.equal(staleAba.code, 1);
    assert.match(staleAba.stderr, /ROUTER_GENERATION_CONFLICT/);
    const currentAssertion = await control(configPath, 'switch', [
      '--expected-generation', String(activeAfterRace.generation), ...identityArgs(activeIdentity)
    ]);
    assert.equal(currentAssertion.code, 0, currentAssertion.stderr);
    assert.equal(JSON.parse(currentAssertion.stdout).alreadyActive, true);

    await fsp.writeFile(`${config.pointerPath}.lock`, JSON.stringify({ pid: process.pid, at: new Date(Date.now() - 60000).toISOString() }));
    const liveLock = await control(configPath, 'switch', ['--expected-generation', '4', ...identityArgs(next)]);
    assert.equal(liveLock.code, 1);
    assert.match(liveLock.stderr, /ROUTER_POINTER_BUSY/);
    assert.equal(fs.existsSync(`${config.pointerPath}.lock`), true);
    await fsp.unlink(`${config.pointerPath}.lock`);

    await fsp.writeFile(config.pointerPath, '{"schema":');
    await assert.rejects(loadPointer(config.pointerPath), /ROUTER_POINTER_INVALID/);
  } finally {
    for (const server of servers.reverse()) await server.close();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('spawned router atomically routes new requests while an admitted old request completes', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'rc-router-proxy-'));
  let router;
  const backends = [];
  try {
    const routerPort = await freePort();
    const old = identity(root, await freePort(), 'blue', 'a');
    const next = identity(root, await freePort(), 'green', 'b');
    await fsp.mkdir(old.projectDir, { recursive: true });
    await fsp.mkdir(next.projectDir, { recursive: true });
    const oldServer = await startBackend(old);
    const nextServer = await startBackend(next);
    backends.push(oldServer, nextServer);
    const { configPath, config } = await writeConfig(root, routerPort);
    const initialized = await control(configPath, 'init', ['--expected-generation', '0', ...identityArgs(old)]);
    assert.equal(initialized.code, 0, initialized.stderr);
    router = await startRouter(configPath, routerPort);

    const marker = JSON.parse(await fsp.readFile(config.runtimeStatePath, 'utf8'));
    const markerInfo = await fsp.lstat(config.runtimeStatePath);
    assert.equal(markerInfo.isFile(), true);
    assert.equal(markerInfo.isSymbolicLink(), false);
    if (process.platform !== 'win32') assert.equal(markerInfo.mode & 0o777, 0o600);
    assert.equal(marker.pid, router.child.pid);
    assert.equal(marker.role, 'router');
    assert.equal(marker.routerId, 'primary');
    assert.equal(marker.profile, 'default');
    assert.equal(marker.port, routerPort);
    assert.equal(path.resolve(marker.projectDir), repo);
    assert.match(marker.configSha256, /^[a-f0-9]{64}$/);

    const before = await rpc(routerPort, 1, {}, {
      'mcp-protocol-version': '2026-07-28', authorization: 'secret-must-not-forward',
      cookie: 'private=1', forwarded: 'for=untrusted', 'mcp-secret': 'must-not-forward'
    });
    assert.equal(before.response.status, 200);
    assert.equal(before.body.result.backend, 'blue');
    const proxied = oldServer.requests.find(item => item.url === '/mcp');
    assert.equal(proxied.headers.host, `127.0.0.1:${old.port}`);
    assert.equal(proxied.headers['mcp-protocol-version'], '2026-07-28');
    assert.equal(proxied.headers.authorization, undefined);
    assert.equal(proxied.headers.cookie, undefined);
    assert.equal(proxied.headers.forwarded, undefined);
    assert.equal(proxied.headers['mcp-secret'], undefined);
    assert.equal(before.response.headers.get('set-cookie'), null);
    assert.equal(before.response.headers.get('location'), null);
    assert.equal(before.response.headers.get('access-control-allow-origin'), null);
    assert.equal(before.response.headers.get('x-content-type-options'), 'nosniff');

    // The request is admitted while blue is active but its body is incomplete.
    // This makes the pointer snapshot boundary observable without depending on
    // the backend having already received the full request.
    const slowUpload = beginChunkedRpc(routerPort, 2);
    for (let attempt = 0; attempt < 100; attempt++) {
      const health = await fetch(`http://127.0.0.1:${routerPort}/router/health`).then(response => response.json());
      if (health.inFlight.byBackend['1:blue'] === 1) break;
      if (attempt === 99) assert.fail('admitted request did not appear in router health');
      await wait(10);
    }
    const switched = await control(configPath, 'switch', ['--expected-generation', '1', ...identityArgs(next)]);
    assert.equal(switched.code, 0, switched.stderr);
    const after = await rpc(routerPort, 3);
    assert.equal(after.body.result.backend, 'green');

    const routerHealth = await fetch(`http://127.0.0.1:${routerPort}/router/health`).then(response => response.json());
    assert.equal(routerHealth.ok, true);
    assert.equal(routerHealth.generation, 2);
    assert.equal(routerHealth.backend.slotId, 'green');
    assert.equal(routerHealth.inFlight.byBackend['1:blue'], 1);
    slowUpload.finish();
    const completedOld = await slowUpload.result;
    assert.equal(completedOld.body.result.backend, 'blue');

    const compatible = await fetch(`http://127.0.0.1:${routerPort}/health`).then(response => response.json());
    assert.equal(compatible.name, 'chatgpt-remote-commander');
    assert.equal(compatible.backend.slotId, 'green');
    assert.equal(compatible.router.name, 'chatgpt-remote-commander-router');
    assert.equal(compatible.router.generation, 2);

    const notification = await rawRequest(routerPort, {
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    });
    assert.equal(notification.status, 202);
    assert.equal(notification.body.length, 0);

    assert.equal((await rawRequest(routerPort, { headers: { origin: 'https://untrusted.invalid' } })).status, 403);
    assert.equal((await rawRequest(routerPort, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    assert.equal((await rawRequest(routerPort, { host: `rebound.invalid:${routerPort}` })).status, 403);
    assert.equal((await rawRequest(routerPort, { requestPath: 'http://127.0.0.1:' + routerPort + '/mcp' })).status, 404);
    assert.equal((await rawRequest(routerPort, { requestPath: '//untrusted.invalid/mcp' })).status, 404);
    assert.equal((await rawRequest(routerPort, { requestPath: '/mcp?unexpected=true' })).status, 404);
    assert.equal((await rawRequest(routerPort, { headers: { 'content-encoding': 'gzip' } })).status, 415);

    await fsp.writeFile(config.pointerPath, '{broken');
    const failedClosed = await rawRequest(routerPort);
    assert.equal(failedClosed.status, 503);
    assert.match(failedClosed.body.toString('utf8'), /ROUTER_POINTER_INVALID/);
    await stopChild(router.child);
    router = null;
    const restart = await runNode(routerFile, [], { REMOTE_COMMANDER_ROUTER_CONFIG: configPath });
    assert.equal(restart.code, 1);
    assert.match(restart.stderr, /ROUTER_POINTER_INVALID/);
  } finally {
    await stopChild(router?.child);
    for (const backend of backends.reverse()) await backend.close();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('router enforces request and backend-response bounds', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'rc-router-bounds-'));
  let router;
  const backends = [];
  try {
    const routerPort = await freePort();
    const backend = identity(root, await freePort(), 'bounded', 'f');
    await fsp.mkdir(backend.projectDir, { recursive: true });
    const server = await startBackend(backend, { responseBytes: 2048 });
    backends.push(server);
    const { configPath } = await writeConfig(root, routerPort, { requestMaxBytes: 256, responseMaxBytes: 1024 });
    const initialized = await control(configPath, 'init', ['--expected-generation', '0', ...identityArgs(backend)]);
    assert.equal(initialized.code, 0, initialized.stderr);
    router = await startRouter(configPath, routerPort);

    const tooLargeRequest = await rawRequest(routerPort, { body: 'x'.repeat(257) });
    assert.equal(tooLargeRequest.status, 413);
    assert.equal(server.requests.filter(item => item.url === '/mcp').length, 0);

    // Do not finish the chunked upload. Crossing the byte bound itself must
    // produce a response, close the connection and release the admission count.
    const openEnded = beginOversizeChunkedRpc(routerPort, 257);
    const bounded = await Promise.race([
      openEnded.result,
      wait(1000).then(() => { throw new Error('oversize chunked request was not terminated promptly'); })
    ]);
    assert.equal(bounded.response.statusCode, 413);
    assert.equal(bounded.response.headers.connection, 'close');
    assert.match(bounded.body.toString('utf8'), /ROUTER_REQUEST_TOO_LARGE/);
    await waitFor(async () => {
      const health = await fetch(`http://127.0.0.1:${routerPort}/router/health`).then(response => response.json());
      return health.inFlight.total === 0;
    }, 'oversize chunked request leaked router in-flight state');
    assert.equal(server.requests.filter(item => item.url === '/mcp').length, 0);
    openEnded.request.destroy();

    const tooLargeResponse = await rawRequest(routerPort, { body: '{}' });
    assert.equal(tooLargeResponse.status, 502);
    const tooLargeBody = JSON.parse(tooLargeResponse.body.toString('utf8'));
    assert.equal(tooLargeBody.error, 'ROUTER_BACKEND_RESPONSE_TOO_LARGE_AFTER_DISPATCH');
    assert.equal(tooLargeBody.uncertainEffect, true);
    assert.equal(tooLargeBody.retryPermitted, false);
    assert.equal(server.requests.filter(item => item.url === '/mcp').length, 1);
  } finally {
    await stopChild(router?.child);
    for (const backend of backends.reverse()) await backend.close();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('router marks dispatched POST timeout/disconnect uncertain and never retries on green', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'rc-router-uncertain-'));
  let router;
  const backends = [];
  try {
    const routerPort = await freePort();
    const old = identity(root, await freePort(), 'blue', 'a');
    const next = identity(root, await freePort(), 'green', 'b');
    await fsp.mkdir(old.projectDir, { recursive: true });
    await fsp.mkdir(next.projectDir, { recursive: true });
    const effects = { count: 0 };
    const oldServer = await startBackend(old, { effectCounter: effects });
    const nextServer = await startBackend(next);
    backends.push(oldServer, nextServer);
    const { configPath } = await writeConfig(root, routerPort, { upstreamTimeoutMs: 1000 });
    const initialized = await control(configPath, 'init', ['--expected-generation', '0', ...identityArgs(old)]);
    assert.equal(initialized.code, 0, initialized.stderr);
    router = await startRouter(configPath, routerPort);

    const timedOut = rpc(routerPort, 10, { outcome: 'hang' });
    await waitFor(() => effects.count === 1, 'blue did not record the timed-out effect');
    const switched = await control(configPath, 'switch', ['--expected-generation', '1', ...identityArgs(next)]);
    assert.equal(switched.code, 0, switched.stderr);
    const timeoutResult = await timedOut;
    assert.equal(timeoutResult.response.status, 504);
    assert.equal(timeoutResult.body.error, 'ROUTER_BACKEND_TIMEOUT_AFTER_DISPATCH');
    assert.equal(timeoutResult.body.uncertainEffect, true);
    assert.equal(timeoutResult.body.retryPermitted, false);
    assert.equal(effects.count, 1);
    assert.equal(nextServer.requests.filter(item => item.url === '/mcp').length, 0);

    const returned = await control(configPath, 'switch', ['--expected-generation', '2', ...identityArgs(old)]);
    assert.equal(returned.code, 0, returned.stderr);
    const disconnected = await rpc(routerPort, 11, { outcome: 'disconnect' });
    assert.equal(disconnected.response.status, 502);
    assert.equal(disconnected.body.error, 'ROUTER_BACKEND_DISCONNECTED_AFTER_DISPATCH');
    assert.equal(disconnected.body.uncertainEffect, true);
    assert.equal(disconnected.body.retryPermitted, false);
    assert.equal(effects.count, 2);
    assert.equal(nextServer.requests.filter(item => item.url === '/mcp').length, 0);

    for (const [outcome, code] of [
      ['redirect', 'ROUTER_BACKEND_STATUS_INVALID_AFTER_DISPATCH'],
      ['invalid-type', 'ROUTER_BACKEND_CONTENT_TYPE_INVALID_AFTER_DISPATCH'],
      ['invalid-json', 'ROUTER_BACKEND_JSON_INVALID_AFTER_DISPATCH'],
      ['invalid-envelope', 'ROUTER_BACKEND_JSONRPC_INVALID_AFTER_DISPATCH'],
      ['invalid-array', 'ROUTER_BACKEND_JSONRPC_INVALID_AFTER_DISPATCH'],
      ['invalid-error', 'ROUTER_BACKEND_JSONRPC_INVALID_AFTER_DISPATCH'],
      ['mismatched-id', 'ROUTER_BACKEND_JSONRPC_INVALID_AFTER_DISPATCH']
    ]) {
      const invalid = await rpc(routerPort, 20 + effects.count, { outcome });
      assert.equal(invalid.response.status, 502);
      assert.equal(invalid.body.error, code);
      assert.equal(invalid.body.uncertainEffect, true);
      assert.equal(invalid.body.retryPermitted, false);
      assert.equal(nextServer.requests.filter(item => item.url === '/mcp').length, 0);
    }
    assert.equal(effects.count, 9);

    const validRpcError = await rpc(routerPort, 30, { outcome: 'rpc-error' });
    assert.equal(validRpcError.response.status, 200);
    assert.equal(validRpcError.body.error.code, -32000);
    assert.equal(validRpcError.body.error.message, 'valid backend JSON-RPC error');
    assert.equal(validRpcError.body.uncertainEffect, undefined);
    assert.equal(effects.count, 10);

    const dripTimedOut = await rpc(routerPort, 31, { outcome: 'drip' });
    assert.equal(dripTimedOut.response.status, 504);
    assert.equal(dripTimedOut.body.error, 'ROUTER_BACKEND_TIMEOUT_AFTER_DISPATCH');
    assert.equal(dripTimedOut.body.uncertainEffect, true);
    assert.equal(dripTimedOut.body.retryPermitted, false);
    assert.equal(effects.count, 11);

    const controller = new AbortController();
    const aborted = fetch(`http://127.0.0.1:${routerPort}/mcp`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'tools/call',
        params: { name: 'system_status', arguments: { outcome: 'hang' } } })
    }).catch(error => error);
    await waitFor(() => effects.count === 12, 'blue did not record the client-aborted effect');
    controller.abort();
    assert.equal((await aborted).name, 'AbortError');
    const switchedAfterAbort = await control(configPath, 'switch', ['--expected-generation', '3', ...identityArgs(next)]);
    assert.equal(switchedAfterAbort.code, 0, switchedAfterAbort.stderr);
    await waitFor(async () => {
      const health = await fetch(`http://127.0.0.1:${routerPort}/router/health`).then(response => response.json());
      return health.inFlight.byBackend['3:blue'] === undefined;
    }, 'client-aborted blue request did not leave in-flight state');
    assert.equal(effects.count, 12);
    assert.equal(nextServer.requests.filter(item => item.url === '/mcp').length, 0);
  } finally {
    await stopChild(router?.child);
    for (const backend of backends.reverse()) await backend.close();
    await fsp.rm(root, { recursive: true, force: true });
  }
});
