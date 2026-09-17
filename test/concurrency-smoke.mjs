import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const root = path.resolve('test', '.tmp-concurrency-root');
const configPath = path.resolve('test', '.tmp-concurrency-config.json');
const port = 47931;
const endpoint = `http://127.0.0.1:${port}/mcp`;

await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
const config = {
  host: '127.0.0.1', port, allowedRoots: [root],
  allowedPrograms: ['git', 'node'], maxReadBytes: 524288,
  maxWriteBytes: 524288, maxCommandMs: 30000,
  auditLog: 'test/.tmp-concurrency-audit.jsonl',
  powerMode: { enabled: false, fullFilesystem: false, allowShell: false, allowProcessControl: false, allowPermanentDelete: false }
};
await writeFile(configPath, JSON.stringify(config, null, 2));

const server = spawn(process.execPath, ['src/server-v0.3.mjs'], {
  env: { ...process.env, REMOTE_COMMANDER_CONFIG: configPath },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString('utf8'); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString('utf8'); });
process.once('exit', () => { try { server.kill('SIGTERM'); } catch {} });
async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy: ${serverOutput}`);
}

let nextId = 1;
async function callTool(name, args = {}) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: nextId++, method: 'tools/call',
      params: { name, arguments: args }
    })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  assert.equal(body.result.isError, false);
  return body.result.structuredContent;
}

await waitForHealth();
const readOnlyCalls = Array.from({ length: 40 }, (_, index) =>
  index % 2 === 0 ? callTool('system_status') : callTool('list_directory', { path: root, depth: 0 })
);
const readOnlyResults = await Promise.all(readOnlyCalls);
assert.equal(readOnlyResults.length, 40);
const distinctWrites = Array.from({ length: 20 }, (_, index) =>
  callTool('write_text', {
    path: path.join(root, `parallel-${index}.txt`),
    content: `value-${index}`
  })
);
const distinctResults = await Promise.all(distinctWrites);
assert.equal(distinctResults.length, 20);

const shared = path.join(root, 'shared-append.txt');
const tokens = Array.from({ length: 30 }, (_, index) => `token-${index.toString().padStart(2, '0')}\n`);
await Promise.all(tokens.map((token) => callTool('write_text', {
  path: shared, content: token, mode: 'append'
})));
const sharedText = await readFile(shared, 'utf8');
for (const token of tokens) {
  const count = sharedText.split(token).length - 1;
  assert.equal(count, 1, `missing/duplicate token: ${token.trim()}`);
}
assert.equal(sharedText.split(/\r?\n/).filter(Boolean).length, tokens.length);

const status = await callTool('system_status');
assert.equal(status.concurrency.httpConcurrent, true);
assert.equal(status.concurrency.pathMutationLocks, true);
console.log('CONCURRENCY_SMOKE_PASS');
server.kill('SIGTERM');
await Promise.race([
  new Promise((resolve) => server.once('close', resolve)),
  new Promise((resolve) => setTimeout(resolve, 1500))
]);
await rm(root, { recursive: true, force: true });
await rm(configPath, { force: true });
await rm(path.resolve('test', '.tmp-concurrency-audit.jsonl'), { force: true });
