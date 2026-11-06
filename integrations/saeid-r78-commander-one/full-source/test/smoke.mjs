import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, rm } from 'node:fs/promises';
import {
  canonicalizeRoots,
  isWithin,
  safeWritablePath,
  validateCommandArgs,
  validateProgram
} from '../src/security.mjs';
import { listDirectory, readText, writeText } from '../src/tools.mjs';

const root = path.resolve('test', '.tmp-root');
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
const roots = await canonicalizeRoots([root]);
const ctx = {
  roots,
  config: { maxReadBytes: 1024 * 1024, maxWriteBytes: 1024 * 1024 },
  auditLog: path.resolve('test', '.tmp-audit.jsonl')
};

assert.equal(isWithin(path.join(root, 'a.txt'), roots), true);
assert.equal(isWithin(path.resolve(root, '..', 'escape.txt'), roots), false);
assert.throws(() => validateProgram('cmd.exe', ['git']), /not allowed/);
assert.throws(() => validateProgram('C:\\temp\\git.exe', ['git']), /bare executable name/);
assert.equal(validateProgram('git.exe', ['git']), 'git.exe');
assert.throws(() => validateCommandArgs('node', ['--eval=1+1'], root, roots), /eval\/print/);
const writable = await safeWritablePath(path.join(root, 'a.txt'), roots, root);
assert.equal(writable, path.join(root, 'a.txt'));

let result = await writeText(ctx, { path: 'a.txt', content: 'alpha', mode: 'overwrite' });
assert.equal(result.beforeSha256, null);
assert.equal(await readFile(path.join(root, 'a.txt'), 'utf8'), 'alpha');

const firstHash = result.sha256;
result = await writeText(ctx, {
  path: 'a.txt', content: 'beta', mode: 'overwrite', expectedSha256: firstHash
});
assert.ok(result.backupPath);
assert.equal(await readFile(path.join(root, 'a.txt'), 'utf8'), 'beta');
assert.equal(await readFile(result.backupPath, 'utf8'), 'alpha');

const read = await readText(ctx, { path: 'a.txt' });
assert.equal(read.text, 'beta');
const listing = await listDirectory(ctx, { path: '.', depth: 1, maxEntries: 20 });
assert.ok(listing.entries.some((entry) => entry.path === 'a.txt'));
console.log('SMOKE_PASS');
await rm(root, { recursive: true, force: true });
