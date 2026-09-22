import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateChecks, verifyProject } from '../src/project-verifier.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const textCheck = (criterion = 0, file = 'result.txt', text = 'done') => ({ criterion, type: 'text_includes', path: file, text });
const run = (root, checks) => verifyProject({ root, acceptance: checks.map((_, i) => `Acceptance ${i}`), checks });
async function fixture(t) {
  // Resolve OS temporary-root aliases before choosing the actual project root.
  const base = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(base, 'rc-project-verifier-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('all three deterministic checks pass, reorder criteria and retain only evidence metadata', async t => {
  const root = await fixture(t);
  const body = 'done: private artifact content';
  await fs.writeFile(path.join(root, 'result.txt'), body);
  await fs.writeFile(path.join(root, 'report.json'), '{"items":[{"ready":true}],"a/b":{"~value":7}}');
  const result = await run(root, [
    { criterion: 2, type: 'file_sha256', path: 'result.txt', sha256: sha(body).toUpperCase() },
    textCheck(0),
    { criterion: 1, type: 'json_pointer_equals', path: 'report.json', pointer: '/a~1b/~0value', value: 7 }
  ]);
  assert.equal(result.passed, true);
  assert.deepEqual(result.acceptanceResults, [true, true, true]);
  assert.deepEqual(result.files, ['result.txt', 'report.json']);
  assert.deepEqual(result.results.map(item => item.code), ['PASS', 'PASS', 'PASS']);
  assert.equal(result.results[0].sha256, sha(body));
  assert.equal(JSON.stringify(result).includes('private artifact content'), false);
});

test('any failed criterion prevents overall acceptance', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'result.txt'), 'done');
  await fs.writeFile(path.join(root, 'report.json'), '{"ready":false}');
  const result = await run(root, [
    textCheck(0),
    { criterion: 1, type: 'file_sha256', path: 'result.txt', sha256: sha('different') },
    { criterion: 2, type: 'json_pointer_equals', path: 'report.json', pointer: '/ready', value: true }
  ]);
  assert.equal(result.passed, false);
  assert.deepEqual(result.acceptanceResults, [true, false, false]);
  assert.deepEqual(result.results.map(item => item.code), ['PASS', 'SHA256_MISMATCH', 'JSON_VALUE_MISMATCH']);
});

test('missing, duplicate, out-of-bounds, noninteger and empty criterion coverage throws', () => {
  for (const [checks, count] of [
    [[], 1], [[textCheck()], 2], [[textCheck(), textCheck()], 2],
    [[textCheck(-1)], 1], [[textCheck(1)], 1], [[textCheck(0.5)], 1],
    [[textCheck('0')], 1], [[], 0], [[textCheck()], NaN]
  ]) assert.throws(() => validateChecks(checks, count), /PROJECT_CHECKS_COVERAGE/u);
});

test('configuration rejects command checks, extra fields, unchecked booleans, malformed values and accessors', () => {
  const checks = [
    { ...textCheck(), type: 'command' },
    { ...textCheck(), passed: true },
    { ...textCheck(), text: '' },
    { criterion: 0, type: 'file_sha256', path: 'result.txt', sha256: 'bad' },
    { criterion: 0, type: 'json_pointer_equals', path: 'report.json', pointer: '/bad~2', value: true },
    { criterion: 0, type: 'json_pointer_equals', path: 'report.json', pointer: '', value: NaN },
    { criterion: 0, type: 'json_pointer_equals', path: 'report.json', pointer: '', value: undefined }
  ];
  for (const check of checks) assert.throws(() => validateChecks([check], 1), /PROJECT_CHECKS_/u);
  let invoked = false;
  const accessor = { ...textCheck(), get text() { invoked = true; return 'done'; } };
  assert.throws(() => validateChecks([accessor], 1), /PROJECT_CHECKS_INVALID/u);
  assert.equal(invoked, false);
});

test('paths reject traversal, absolute names, drive aliases, ADS and Windows alias names', () => {
  for (const file of ['../secret', 'a/../secret', 'a\\..\\secret', '/secret', 'C:\\secret', 'C:secret', '\\\\server\\share\\secret', 'a//b', './a', 'a.', 'a ', 'NUL.txt', 'dir/COM1', 'a:stream', 'a\0b']) {
    assert.throws(() => validateChecks([textCheck(0, file)], 1), /PROJECT_CHECKS_PATH/u, file);
  }
});

test('missing and nonregular evidence fail without exposing contents or OS errors', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'directory'));
  const result = await run(root, [textCheck(0, 'missing.txt'), textCheck(1, 'directory')]);
  assert.equal(result.passed, false);
  assert.deepEqual(result.files, []);
  assert.deepEqual(result.results.map(item => item.code), ['EVIDENCE_MISSING', 'EVIDENCE_NOT_REGULAR']);
});

test('oversized file is rejected before reading its contents', async t => {
  const root = await fixture(t);
  const handle = await fs.open(path.join(root, 'result.txt'), 'w');
  await handle.truncate(16 * 1024 * 1024 + 1);
  await handle.close();
  const result = await run(root, [textCheck()]);
  assert.equal(result.results[0].code, 'EVIDENCE_TOO_LARGE');
  assert.equal(result.results[0].sha256, undefined);
});

test('the exact 16 MiB evidence boundary is allowed for a regular file', async t => {
  const root = await fixture(t);
  const data = Buffer.alloc(16 * 1024 * 1024, 42);
  await fs.writeFile(path.join(root, 'result.bin'), data);
  const result = await run(root, [{ criterion: 0, type: 'file_sha256', path: 'result.bin', sha256: sha(data) }]);
  assert.equal(result.passed, true);
  assert.equal(result.results[0].sha256, sha(data));
});

test('hardlinked evidence is rejected even when both aliases are inside the root', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'source.txt'), 'done');
  await fs.link(path.join(root, 'source.txt'), path.join(root, 'result.txt'));
  const result = await run(root, [textCheck()]);
  assert.equal(result.results[0].code, 'EVIDENCE_HARDLINK');
});

test('junction or symlink parent cannot escape or alias the root', async t => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await fs.writeFile(path.join(outside, 'result.txt'), 'done');
  await fs.symlink(outside, path.join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await run(root, [textCheck(0, 'alias/result.txt')]);
  assert.equal(result.results[0].code, 'EVIDENCE_LINK');
  const linkedRoot = await run(path.join(root, 'alias'), [textCheck()]);
  assert.equal(linkedRoot.results[0].code, 'EVIDENCE_LINK');
});

test('leaf symlink is refused instead of hashing or reading its target', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'source.txt'), 'done');
  try { await fs.symlink(path.join(root, 'source.txt'), path.join(root, 'result.txt'), 'file'); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Windows account cannot create file symlinks'); return; }
    throw error;
  }
  const result = await run(root, [textCheck()]);
  assert.equal(result.results[0].code, 'EVIDENCE_LINK');
});

test('JSON pointer lookup is own-property-only and exact JSON comparison is order independent', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'report.json'), '{"safe":{"a":1,"b":[true,null]},"__proto__":{"owned":7},"empty/key":{"":9},"array":[1]}');
  const make = (criterion, pointer, value) => ({ criterion, type: 'json_pointer_equals', path: 'report.json', pointer, value });
  const result = await run(root, [
    make(0, '/safe', { b: [true, null], a: 1 }), make(1, '/__proto__/owned', 7),
    make(2, '/constructor/prototype', {}), make(3, '/array/length', 1),
    make(4, '/array/00', 1), make(5, '/empty~1key/', 9)
  ]);
  assert.deepEqual(result.acceptanceResults, [true, true, false, false, false, true]);
  assert.equal(result.results[2].code, 'JSON_POINTER_MISSING');
  assert.equal(Object.prototype.owned, undefined);
});

test('whole JSON value, null and scalar type mismatches are deterministic', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'report.json'), '{"number":1,"null":null}');
  const make = (criterion, pointer, value) => ({ criterion, type: 'json_pointer_equals', path: 'report.json', pointer, value });
  const result = await run(root, [make(0, '', { null: null, number: 1 }), make(1, '/null', null), make(2, '/number', '1')]);
  assert.deepEqual(result.acceptanceResults, [true, true, false]);
});

test('invalid UTF-8 and malformed JSON cannot pass text or JSON checks', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'result.txt'), Buffer.from([0xff, 0xfe]));
  await fs.writeFile(path.join(root, 'report.json'), '{broken');
  const result = await run(root, [textCheck(0), { criterion: 1, type: 'json_pointer_equals', path: 'report.json', pointer: '', value: true }]);
  assert.deepEqual(result.results.map(item => item.code), ['TEXT_INVALID_UTF8', 'JSON_INVALID']);
});

test('mutating evidence during its read fails rather than certifying a partial snapshot', async t => {
  const root = await fixture(t);
  const target = path.join(root, 'result.txt');
  await fs.writeFile(target, 'done');
  const originalOpen = fs.open;
  let changed = false;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === target) {
      const originalRead = handle.read.bind(handle);
      handle.read = async (...readArgs) => {
        const result = await originalRead(...readArgs);
        if (!changed) { changed = true; await fs.writeFile(target, 'done but replaced while being read'); }
        return result;
      };
    }
    return handle;
  });
  const result = await run(root, [textCheck()]);
  assert.equal(changed, true);
  assert.equal(result.passed, false);
  assert.equal(result.results[0].code, 'EVIDENCE_CHANGED');
});

test('replacement between path inspection and open is detected by file identity', async t => {
  const root = await fixture(t);
  const target = path.join(root, 'result.txt');
  await fs.writeFile(target, 'done');
  await fs.writeFile(path.join(root, 'replacement.txt'), 'done');
  const originalOpen = fs.open;
  let changed = false;
  t.mock.method(fs, 'open', async (...args) => {
    if (args[0] === target && !changed) {
      changed = true;
      await fs.rename(target, path.join(root, 'previous.txt'));
      await fs.rename(path.join(root, 'replacement.txt'), target);
    }
    return originalOpen(...args);
  });
  const result = await run(root, [textCheck()]);
  assert.equal(result.passed, false);
  assert.equal(result.results[0].code, 'EVIDENCE_CHANGED');
});

test('a later evidence read invalidates an earlier file that changed before final acceptance', async t => {
  const root = await fixture(t);
  const first = path.join(root, 'result.txt');
  const second = path.join(root, 'second.txt');
  await fs.writeFile(first, 'done');
  await fs.writeFile(second, 'done');
  const originalOpen = fs.open;
  t.mock.method(fs, 'open', async (...args) => {
    if (args[0] === second) await fs.writeFile(first, 'invalidated after reading');
    return originalOpen(...args);
  });
  const result = await run(root, [textCheck(0), textCheck(1, 'second.txt')]);
  assert.deepEqual(result.acceptanceResults, [false, true]);
  assert.equal(result.results[0].code, 'EVIDENCE_CHANGED');
  assert.deepEqual(result.files, ['second.txt']);
});
