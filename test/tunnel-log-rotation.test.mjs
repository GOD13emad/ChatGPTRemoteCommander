import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const runner = path.join(root, 'tools', 'tunnel-log-runner.mjs');
const fixture = path.join(root, 'test', 'tunnel-log-child-fixture.mjs');

function run(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { ...options, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout?.on('data', c => { stdout += c.toString(); });
    child.stderr?.on('data', c => { stderr += c.toString(); });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test('tunnel log runner rotates without restarting child and preserves the complete stream', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rc-tunnel-log-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'tunnel-default.log');
  const status = path.join(dir, 'tunnel-default.log.rotation.json');
  const pidFile = path.join(dir, 'child.pid');
  const chunks = 14, chunkBytes = 65536, maxBytes = 262144, maxFiles = 5;

  const result = await run([
    runner,
    '--log-file', log,
    '--status-file', status,
    '--max-bytes', String(maxBytes),
    '--max-files', String(maxFiles),
    '--',
    process.execPath, fixture, pidFile, String(chunks), String(chunkBytes)
  ]);

  assert.equal(result.code, 0, result.stderr);
  const childPid = Number((await readFile(pidFile, 'utf8')).trim());
  assert.ok(Number.isSafeInteger(childPid) && childPid > 0);

  const state = JSON.parse(await readFile(status, 'utf8'));
  assert.equal(state.active, false);
  assert.equal(state.childPid, childPid);
  assert.equal(state.maxBytes, maxBytes);
  assert.equal(state.maxFiles, maxFiles);
  assert.ok(state.rotations >= 3, 'fixture must force multiple live rotations');
  assert.ok(state.archivedFiles <= maxFiles);
  assert.ok(state.currentBytes <= maxBytes);
  assert.equal(state.terminalReason, 'CHILD_EXIT');
  assert.equal(state.errorCode, null);
  assert.ok(!JSON.stringify(state).includes('CONTROL_PLANE_API_KEY'));

  const archiveNames = (await readdir(dir))
    .filter(name => /^tunnel-default[.]log[.]\d+[.]gz$/.test(name))
    .sort((a, b) => Number(b.match(/[.](\d+)[.]gz$/)[1]) - Number(a.match(/[.](\d+)[.]gz$/)[1]));
  assert.ok(archiveNames.length >= 3);
  const parts = [];
  for (const name of archiveNames) parts.push(gunzipSync(await readFile(path.join(dir, name))));
  parts.push(await readFile(log));
  const actual = Buffer.concat(parts);

  const expectedParts = [];
  for (let i = 0; i < chunks; i += 1) expectedParts.push(Buffer.alloc(chunkBytes, 65 + (i % 26)));
  expectedParts.push(Buffer.from('TUNNEL_CHILD_DONE\n'));
  const expected = Buffer.concat(expectedParts);
  assert.deepEqual(actual, expected, 'rolling logger must preserve stdout+stderr bytes exactly');
});

test('tunnel log runner bounds and archives an oversized legacy current log before child startup', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rc-tunnel-log-legacy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'tunnel-default.log');
  const status = path.join(dir, 'tunnel-default.log.rotation.json');
  const pidFile = path.join(dir, 'child.pid');
  const maxBytes = 262144;
  const legacy = Buffer.alloc(maxBytes * 2, 0x4c);
  fs.writeFileSync(log, legacy);

  const result = await run([
    runner, '--log-file', log, '--status-file', status,
    '--max-bytes', String(maxBytes), '--max-files', '2', '--',
    process.execPath, fixture, pidFile, '1', '1024'
  ]);
  assert.equal(result.code, 0, result.stderr);
  const archived = gunzipSync(await readFile(log + '.1.gz'));
  assert.equal(archived.length, maxBytes);
  assert.deepEqual(archived, legacy.subarray(legacy.length - maxBytes), 'only the bounded recent diagnostic tail is retained from legacy oversize logs');
  const state = JSON.parse(await readFile(status, 'utf8'));
  assert.ok(state.rotations >= 1);
  assert.ok(state.archivedFiles <= 2);
});
