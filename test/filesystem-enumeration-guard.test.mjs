import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import {
  WINDOWS_SEARCH_VISIT_LIMIT,
  assertEnumerationScope,
  boundedSearchVisitLimit
} from '../src/filesystem-enumeration-guard.mjs';
import { searchFiles } from '../src/power-tools-v0.3.mjs';
import { listDirectory } from '../src/tools-v0.3.mjs';

test('Windows recursive enumeration refuses a bare volume root but permits narrower scopes', () => {
  assert.throws(
    () => assertEnumerationScope({ target: 'C:\\', depth: 1, operation: 'list_directory', platform: 'win32' }),
    error => error?.code === 'WINDOWS_VOLUME_ROOT_RECURSION_REFUSED'
  );
  assert.throws(
    () => assertEnumerationScope({ target: 'D:\\', depth: 6, operation: 'search_files', platform: 'win32' }),
    error => error?.code === 'WINDOWS_VOLUME_ROOT_RECURSION_REFUSED'
  );
  assert.doesNotThrow(() => assertEnumerationScope({
    target: 'C:\\Users\\Example\\source\\repos\\project',
    depth: 6,
    operation: 'search_files',
    platform: 'win32'
  }));
  assert.doesNotThrow(() => assertEnumerationScope({
    target: 'C:\\',
    depth: 0,
    operation: 'list_directory',
    platform: 'win32'
  }));
  assert.doesNotThrow(() => assertEnumerationScope({
    target: 'C:\\',
    depth: 6,
    operation: 'search_files',
    platform: 'linux'
  }));
});

test('search visit budget is hard-bounded', () => {
  assert.equal(boundedSearchVisitLimit(undefined), WINDOWS_SEARCH_VISIT_LIMIT);
  assert.equal(boundedSearchVisitLimit(1), 1);
  assert.equal(boundedSearchVisitLimit(WINDOWS_SEARCH_VISIT_LIMIT + 1), WINDOWS_SEARCH_VISIT_LIMIT);
  assert.equal(boundedSearchVisitLimit('invalid'), WINDOWS_SEARCH_VISIT_LIMIT);
});

test('search_files stops at the entry-visit budget without needing a large fixture', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rc-search-budget-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  for (let i = 0; i < 8; i += 1) {
    await writeFile(path.join(root, `item-${i}.txt`), 'bounded\n', 'utf8');
  }
  const ctx = {
    roots: [root],
    config: { powerMode: { enabled: true, fullFilesystem: true } }
  };
  const result = await searchFiles(ctx, {
    path: root,
    pattern: 'definitely-no-match',
    depth: 0,
    maxVisitedEntries: 3,
    maxResults: 20,
    maxDurationMs: 5000
  });
  assert.equal(result.visitedEntries, 3);
  assert.equal(result.visitLimitHit, true);
  assert.equal(result.truncated, true);
  assert.equal(result.count, 0);
});


test('Windows tool wiring refuses recursive enumeration at the active volume root before walking it', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows volume-root wiring');
    return;
  }
  const volumeRoot = path.parse(process.cwd()).root;
  const ctx = {
    roots: [process.cwd()],
    config: { powerMode: { enabled: true, fullFilesystem: true } },
    auditLog: path.join(os.tmpdir(), 'rc-enumeration-guard-audit.jsonl')
  };
  await assert.rejects(
    listDirectory(ctx, { path: volumeRoot, depth: 1, maxEntries: 10 }),
    error => error?.code === 'WINDOWS_VOLUME_ROOT_RECURSION_REFUSED'
  );
  await assert.rejects(
    searchFiles(ctx, { path: volumeRoot, pattern: 'never', depth: 1, maxResults: 1 }),
    error => error?.code === 'WINDOWS_VOLUME_ROOT_RECURSION_REFUSED'
  );
});
