import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const s = net.createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening');
  const port = s.address().port; await new Promise(resolve => s.close(resolve)); return port;
}
async function startServer(serverRoot, configPath) {
  const child = spawn(process.execPath, [path.join(serverRoot, 'src', 'server-v0.3.mjs')], {
    cwd: serverRoot, env: { ...process.env, REMOTE_COMMANDER_CONFIG: configPath }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = ''; child.stderr.on('data', c => { stderr += c.toString('utf8'); });
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  for (let i = 0; i < 120; i += 1) {
    try { const r = await fetch(`http://127.0.0.1:${config.port}/health`); if (r.ok) return child; } catch {}
    await wait(25);
  }
  child.kill(); throw new Error('server did not become healthy: ' + stderr);
}
async function stop(child) {
  if (child && child.exitCode === null) { child.kill(); await Promise.race([once(child, 'exit'), wait(2000)]); }
}
async function post(port, { id, name = 'write_text', args, transportRequestId }) {
  const headers = { 'content-type': 'application/json' };
  if (transportRequestId) headers['x-request-id'] = transportRequestId;
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
  });
  const body = await response.json(); assert.equal(response.status, 200); return body;
}

test('legacy cached host may omit requestId and receives transport-derived durable idempotency', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-legacy-id-'));
  const serverRoot = path.join(root, 'server'), dataRoot = path.join(root, 'data'), deliveryRoot = path.join(root, 'delivery');
  let child;
  try {
    await fs.mkdir(serverRoot, { recursive: true }); await fs.mkdir(dataRoot, { recursive: true });
    await fs.cp(new URL('../src/', import.meta.url), path.join(serverRoot, 'src'), { recursive: true });
    const canonical = await fs.realpath(dataRoot); const target = path.join(canonical, 'append.txt'); await fs.writeFile(target, '');
    const port = await freePort();
    const config = {
      host: '127.0.0.1', port, allowedRoots: [canonical], allowedPrograms: ['node'],
      maxReadBytes: 1048576, maxWriteBytes: 1048576, maxCommandMs: 300000,
      auditLog: 'var/audit.jsonl', durableDelivery: { directory: deliveryRoot }, asyncOperations: { enabled: true },
      powerMode: { enabled: false, fullFilesystem: false, allowShell: false, allowProcessControl: false, allowPermanentDelete: false,
        guiControl: { enabled: false }, browserControl: { enabled: false } }
    };
    const configPath = path.join(serverRoot, 'config.json'); await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    child = await startServer(serverRoot, configPath);

    const args = { path: target, content: 'x', mode: 'append' };
    const first = await post(port, { id: 'rpc-a', args, transportRequestId: 'transport-stable-1' });
    assert.equal(first.result.isError, false); assert.equal(await fs.readFile(target, 'utf8'), 'x');
    const retry = await post(port, { id: 'rpc-b', args, transportRequestId: 'transport-stable-1' });
    assert.equal(retry.result.isError, false); assert.deepEqual(retry.result.structuredContent, first.result.structuredContent);
    assert.equal(await fs.readFile(target, 'utf8'), 'x');

    const explicit = { requestId: 'explicit-stable-1', path: target, content: 'y', mode: 'append' };
    const explicitFirst = await post(port, { id: 'rpc-c', args: explicit, transportRequestId: 'transport-changing-1' });
    assert.equal(explicitFirst.result.isError, false); assert.equal(await fs.readFile(target, 'utf8'), 'xy');
    const explicitRetry = await post(port, { id: 'rpc-d', args: explicit, transportRequestId: 'transport-changing-2' });
    assert.equal(explicitRetry.result.isError, false); assert.deepEqual(explicitRetry.result.structuredContent, explicitFirst.result.structuredContent);
    assert.equal(await fs.readFile(target, 'utf8'), 'xy');

    const rpcFallback = await post(port, { id: 'rpc-stable-fallback', args: { path: target, content: 'z', mode: 'append' } });
    assert.equal(rpcFallback.result.isError, false); assert.equal(await fs.readFile(target, 'utf8'), 'xyz');
    const rpcRetry = await post(port, { id: 'rpc-stable-fallback', args: { path: target, content: 'z', mode: 'append' } });
    assert.equal(rpcRetry.result.isError, false); assert.equal(await fs.readFile(target, 'utf8'), 'xyz');

    const noIdentity = await post(port, { id: null, args: { path: target, content: 'q', mode: 'append' } });
    assert.equal(noIdentity.result.isError, true); assert.match(noIdentity.result.content[0].text, /MUTATION_REQUEST_ID_REQUIRED|requestId/i);
    assert.equal(await fs.readFile(target, 'utf8'), 'xyz');
  } finally {
    if (child) await stop(child); await fs.rm(root, { recursive: true, force: true });
  }
});
