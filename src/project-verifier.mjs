import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_VALUE_BYTES = 1024 * 1024;
const WINDOWS = process.platform === 'win32';
const CHECK_KEYS = {
  file_sha256: ['criterion', 'type', 'path', 'sha256'],
  text_includes: ['criterion', 'type', 'path', 'text'],
  json_pointer_equals: ['criterion', 'type', 'path', 'pointer', 'value']
};

function fail(code) { throw Object.assign(new Error(code), { code }); }
function plainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function dataKeys(value) {
  if (!plainRecord(value)) fail('PROJECT_CHECKS_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)) fail('PROJECT_CHECKS_INVALID');
  return Object.keys(descriptors);
}
function relativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 ||
      /[\x00-\x1f\x7f<>:"|?*]/u.test(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) fail('PROJECT_CHECKS_PATH');
  const parts = value.split(/[\\/]/u);
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) fail('PROJECT_CHECKS_PATH');
  return parts.join('/');
}
function pointerParts(value) {
  if (typeof value !== 'string' || value.length > 4096 || (value !== '' && !value.startsWith('/')) || /~(?![01])/u.test(value)) fail('PROJECT_CHECKS_POINTER');
  return value === '' ? [] : value.slice(1).split('/').map(part => part.replace(/~[01]/gu, token => token === '~0' ? '~' : '/'));
}
function jsonValue(value) {
  const seen = new Set();
  let nodes = 0;
  function visit(item, depth) {
    if (++nodes > 100000 || depth > 64) fail('PROJECT_CHECKS_VALUE');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || seen.has(item)) fail('PROJECT_CHECKS_VALUE');
    seen.add(item);
    if (Array.isArray(item)) {
      const descriptors = Object.getOwnPropertyDescriptors(item);
      if (Reflect.ownKeys(descriptors).length !== item.length + 1) fail('PROJECT_CHECKS_VALUE');
      for (let i = 0; i < item.length; i++) {
        if (!Object.hasOwn(descriptors, i) || !Object.hasOwn(descriptors[i], 'value')) fail('PROJECT_CHECKS_VALUE');
        visit(descriptors[i].value, depth + 1);
      }
    } else {
      for (const key of dataKeys(item)) visit(item[key], depth + 1);
    }
    seen.delete(item);
  }
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_VALUE_BYTES) fail('PROJECT_CHECKS_VALUE');
}

/** Each zero-based acceptance criterion must have exactly one deterministic check. */
export function validateChecks(checks, acceptanceCount) {
  if (!Number.isSafeInteger(acceptanceCount) || acceptanceCount < 1 || acceptanceCount > 1024 || !Array.isArray(checks) || checks.length !== acceptanceCount) fail('PROJECT_CHECKS_COVERAGE');
  const covered = new Set();
  for (const check of checks) {
    const keys = dataKeys(check);
    if (typeof check.type !== 'string' || !Object.hasOwn(CHECK_KEYS, check.type)) fail('PROJECT_CHECKS_TYPE');
    const expected = CHECK_KEYS[check.type];
    if (keys.length !== expected.length || expected.some(key => !Object.hasOwn(check, key))) fail('PROJECT_CHECKS_INVALID');
    if (!Number.isSafeInteger(check.criterion) || check.criterion < 0 || check.criterion >= acceptanceCount || covered.has(check.criterion)) fail('PROJECT_CHECKS_COVERAGE');
    covered.add(check.criterion);
    relativePath(check.path);
    if (check.type === 'file_sha256' && (typeof check.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/u.test(check.sha256))) fail('PROJECT_CHECKS_SHA256');
    if (check.type === 'text_includes' && (typeof check.text !== 'string' || check.text.length === 0 || Buffer.byteLength(check.text, 'utf8') > MAX_VALUE_BYTES)) fail('PROJECT_CHECKS_TEXT');
    if (check.type === 'json_pointer_equals') { pointerParts(check.pointer); jsonValue(check.value); }
  }
  return checks;
}

const pathKey = value => WINDOWS ? path.resolve(value).toLowerCase() : path.resolve(value);
const samePath = (left, right) => pathKey(left) === pathKey(right);
function within(root, candidate) {
  const rel = path.relative(pathKey(root), pathKey(candidate));
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
}
function identity(left, right) { return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode; }
function version(left, right) {
  return identity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
function regular(info) {
  if (!info.isFile()) fail('EVIDENCE_NOT_REGULAR');
  if (info.nlink !== 1n) fail('EVIDENCE_HARDLINK');
  if (info.size > BigInt(MAX_FILE_BYTES)) fail('EVIDENCE_TOO_LARGE');
}
function fileError(error) {
  if (typeof error?.code === 'string' && /^EVIDENCE_[A-Z_]+$/u.test(error.code)) return error.code;
  if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return 'EVIDENCE_MISSING';
  if (error?.code === 'ELOOP') return 'EVIDENCE_LINK';
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return 'EVIDENCE_ACCESS';
  return 'EVIDENCE_IO';
}

// Inspect every ancestor, including those above the configured root. On Windows
// lstat identifies junctions as symbolic links. Directory link counts are not
// treated as aliases: POSIX directory nlink includes ordinary child directories.
async function inspectPath(absolute, leafIsFile) {
  const parsed = path.parse(absolute);
  const components = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  const records = [];
  for (let index = -1; index < components.length; index++) {
    if (index >= 0) current = path.join(current, components[index]);
    const info = await fs.lstat(current, { bigint: true });
    if (info.isSymbolicLink()) fail('EVIDENCE_LINK');
    const leaf = index === components.length - 1;
    if (leaf && leafIsFile) regular(info);
    else if (!info.isDirectory()) fail('EVIDENCE_NOT_DIRECTORY');
    const canonical = await fs.realpath(current);
    if (!samePath(current, canonical)) fail('EVIDENCE_ALIAS');
    records.push({ path: current, info, file: leaf && leafIsFile });
  }
  return records;
}
async function revalidate(records) {
  for (const record of records) {
    const info = await fs.lstat(record.path, { bigint: true });
    if (info.isSymbolicLink()) fail('EVIDENCE_LINK');
    if (record.file) regular(info);
    else if (!info.isDirectory()) fail('EVIDENCE_CHANGED');
    if (!(record.file ? version(record.info, info) : identity(record.info, info))) fail('EVIDENCE_CHANGED');
    if (!samePath(record.path, await fs.realpath(record.path))) fail('EVIDENCE_ALIAS');
  }
}
async function readEvidence(root, rootRecords, relative) {
  const absolute = path.resolve(root, ...relative.split('/'));
  if (!within(root, absolute)) fail('EVIDENCE_OUTSIDE_ROOT');
  await revalidate(rootRecords);
  const records = await inspectPath(absolute, true);
  const before = records.at(-1).info;
  let handle;
  try {
    // NOFOLLOW protects the leaf where the OS supports it. NONBLOCK prevents a
    // raced FIFO from blocking open; ancestor and descriptor identities are
    // checked before and after the bounded read as Node has no portable openat.
    handle = await fs.open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const opened = await handle.stat({ bigint: true });
    regular(opened);
    if (!version(before, opened)) fail('EVIDENCE_CHANGED');
    await revalidate(records);
    const chunks = [];
    let bytes = 0;
    while (bytes <= MAX_FILE_BYTES) {
      const buffer = Buffer.allocUnsafe(Math.min(65536, MAX_FILE_BYTES + 1 - bytes));
      const result = await handle.read(buffer, 0, buffer.length, bytes);
      if (result.bytesRead === 0) break;
      chunks.push(buffer.subarray(0, result.bytesRead));
      bytes += result.bytesRead;
    }
    if (bytes > MAX_FILE_BYTES) fail('EVIDENCE_TOO_LARGE');
    const after = await handle.stat({ bigint: true });
    regular(after);
    if (!version(opened, after) || BigInt(bytes) !== after.size) fail('EVIDENCE_CHANGED');
    await revalidate(records);
    await revalidate(rootRecords);
    const data = Buffer.concat(chunks, bytes);
    return { data, sha256: createHash('sha256').update(data).digest('hex'), records };
  } finally {
    if (handle) await handle.close();
  }
}
function pointerValue(value, parts) {
  let current = value;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return { found: false };
    if (Array.isArray(current) && !/^(?:0|[1-9][0-9]*)$/u.test(part)) return { found: false };
    if (!Object.hasOwn(current, part)) return { found: false };
    current = current[part];
  }
  return { found: true, value: current };
}
function sameJson(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
}
function checkEvidence(check, evidence) {
  if (check.type === 'file_sha256') return evidence.sha256 === check.sha256.toLowerCase() ? 'PASS' : 'SHA256_MISMATCH';
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(evidence.data); }
  catch { return 'TEXT_INVALID_UTF8'; }
  if (check.type === 'text_includes') return text.includes(check.text) ? 'PASS' : 'TEXT_MISMATCH';
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { return 'JSON_INVALID'; }
  const selected = pointerValue(parsed, pointerParts(check.pointer));
  if (!selected.found) return 'JSON_POINTER_MISSING';
  return sameJson(selected.value, check.value) ? 'PASS' : 'JSON_VALUE_MISMATCH';
}

/** Verify a bounded snapshot of evidence. This does not lock files after return. */
export async function verifyProject({ root, acceptance, checks } = {}) {
  if (typeof root !== 'string' || !root || root.includes('\0') || !path.isAbsolute(root)) fail('PROJECT_ROOT_INVALID');
  if (!Array.isArray(acceptance) || acceptance.some(value => typeof value !== 'string' || !value.trim())) fail('PROJECT_ACCEPTANCE_INVALID');
  validateChecks(checks, acceptance.length);
  // Snapshot validated configuration before the first await; callers cannot
  // alter a pending criterion or expected value midway through verification.
  const plan = JSON.parse(JSON.stringify(checks)).map(check => ({ ...check, path: relativePath(check.path) }));
  const acceptanceResults = Array(acceptance.length).fill(false);
  const evidenceByPath = new Map();
  const codesByCriterion = new Map();
  const results = [];
  let rootRecords;
  try { rootRecords = await inspectPath(path.resolve(root), false); }
  catch (error) {
    const code = fileError(error);
    return { passed: false, acceptanceResults, files: [], results: plan.map(check => ({ criterion: check.criterion, passed: false, code, path: check.path })) };
  }
  const canonicalRoot = rootRecords.at(-1).path;
  for (const check of plan) {
    if (evidenceByPath.has(check.path)) continue;
    try {
      const evidence = await readEvidence(canonicalRoot, rootRecords, check.path);
      for (const related of plan.filter(item => item.path === check.path)) codesByCriterion.set(related.criterion, checkEvidence(related, evidence));
      // Retain only identity/hash metadata, never one file-sized buffer per
      // criterion. All checks on this path use the same bounded snapshot.
      evidenceByPath.set(check.path, { sha256: evidence.sha256, records: evidence.records });
    }
    catch (error) { evidenceByPath.set(check.path, { code: fileError(error) }); }
  }
  // Several checks on one file share one read; all evidence is revalidated at
  // the end to avoid passing criteria drawn from different file generations.
  for (const evidence of evidenceByPath.values()) {
    if (evidence.code) continue;
    try { await revalidate(evidence.records); await revalidate(rootRecords); }
    catch (error) { evidence.code = fileError(error); }
  }
  for (const check of plan) {
    const evidence = evidenceByPath.get(check.path);
    const code = evidence.code ?? codesByCriterion.get(check.criterion);
    const passed = code === 'PASS';
    acceptanceResults[check.criterion] = passed;
    results.push({ criterion: check.criterion, passed, code, path: check.path, ...(evidence.sha256 ? { sha256: evidence.sha256 } : {}) });
  }
  return { passed: acceptanceResults.every(Boolean), acceptanceResults, files: [...evidenceByPath].filter(([, value]) => !value.code).map(([relative]) => relative), results };
}
