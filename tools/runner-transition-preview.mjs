#!/usr/bin/env node
// Read-only, fail-closed preflight for an explicitly signed runner-policy proposal.
// This tool NEVER modifies a config, routes traffic, or grants production authority.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const reject = (code) => { throw Error(code); };

function readBounded(name, privateOwner = false) {
  if (typeof name !== 'string' || !path.isAbsolute(name)) reject('INVALID_PATH');
  // The pathname is used for selection only. Bind the read to an opened file
  // descriptor and check identity before/after to avoid path replacement races.
  const first = fs.lstatSync(name);
  if (!first.isFile() || first.isSymbolicLink() || first.nlink !== 1
    || first.size < 2 || first.size > 2 * 1024 * 1024) reject('INVALID_FILE');
  const fd = fs.openSync(name, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const st = fs.fstatSync(fd);
    const identical = (a, b) => a.dev === b.dev && a.ino === b.ino
      && a.mode === b.mode && a.uid === b.uid && a.gid === b.gid
      && a.nlink === b.nlink && a.size === b.size
      && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
    if (!st.isFile() || st.nlink !== 1 || st.size < 2 || st.size > 2 * 1024 * 1024
      || !identical(first, st)) reject('FILE_CHANGED_DURING_READ');
    if (privateOwner && process.platform !== 'win32') {
      if ((st.mode & 0o077) !== 0 || st.uid !== process.getuid())
        reject('UNTRUSTED_APPROVAL_FILE');
    }
    const bytes = fs.readFileSync(fd);
    if (!identical(st, fs.fstatSync(fd)) || !identical(st, fs.lstatSync(name))
      || bytes.byteLength !== st.size) reject('FILE_CHANGED_DURING_READ');
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}
function objectFrom(buffer) {
  const obj = JSON.parse(buffer.toString('utf8'));
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) reject('INVALID_DOCUMENT');
  return obj;
}
function validHash(v) {
  return typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
}
function validUtc(v) {
  return typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v)
    && Number.isFinite(Date.parse(v));
}
function validatePolicy(current, candidate) {
  if (!current || !candidate || current.enabled !== true || candidate.enabled !== true
    || current.provider?.kind !== 'command' || candidate.provider?.kind !== 'command'
    || current.autoTick !== false || candidate.autoTick !== false
    || current.maxPlannerCalls !== 2 || candidate.maxPlannerCalls !== 3
    || !Array.isArray(current.team?.workers) || current.team.workers.length !== 2
    || !Array.isArray(current.provider?.args) || !Array.isArray(candidate.provider?.args))
    reject('UNSUPPORTED_TRANSITION');
  const masked = structuredClone(candidate);
  masked.maxPlannerCalls = current.maxPlannerCalls;
  masked.provider.args = structuredClone(current.provider.args);
  if (!isDeepStrictEqual(masked, current)) reject('UNBOUNDED_POLICY_CHANGE');
  const changed = ['maxPlannerCalls'];
  if (!isDeepStrictEqual(candidate.provider.args, current.provider.args)) changed.push('provider.args');
  return changed;
}
function main() {
  if (process.argv.length !== 6) reject('INVALID_ARGS');
  const [oldPath, newPath, approvalPath, publicKeyPath] = process.argv.slice(2);
  if ([oldPath, newPath, approvalPath, publicKeyPath].some(v => typeof v !== 'string' || !path.isAbsolute(v)))
    reject('INVALID_PATH');
  const currentRaw = readBounded(oldPath);
  const candidateRaw = readBounded(newPath);
  const current = objectFrom(currentRaw);
  const candidate = objectFrom(candidateRaw);
  const changes = validatePolicy(current.durableWorkflows?.runner, candidate.durableWorkflows?.runner);
  const grant = objectFrom(readBounded(approvalPath, true));
  const payload = grant.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(grant).sort().join(',') !== 'payload,signature'
    || typeof grant.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(grant.signature))
    reject('INVALID_APPROVAL');
  const required = ['schema','intent','profile','activeConfigSha256','candidateConfigSha256','candidateRunnerSha256',
    'allowedChangedFields','issuedAtUtc','expiresAtUtc'];
  if (Object.keys(payload).sort().join(',') !== required.sort().join(',')
    || payload.schema !== 1 || payload.intent !== 'owner-approved-runner-transition'
    || payload.profile !== 'default' || !validHash(payload.activeConfigSha256)
    || !validHash(payload.candidateConfigSha256)
    || !validHash(payload.candidateRunnerSha256)
    || !Array.isArray(payload.allowedChangedFields)
    || !isDeepStrictEqual([...payload.allowedChangedFields].sort(), [...changes].sort()))
    reject('INVALID_APPROVAL');
  if (payload.activeConfigSha256 !== sha256(currentRaw)
    || payload.candidateConfigSha256 !== sha256(candidateRaw)
    || payload.candidateRunnerSha256 !== sha256(JSON.stringify(candidate.durableWorkflows.runner)))
    reject('APPROVAL_HASH_MISMATCH');
  if (!validUtc(payload.issuedAtUtc) || !validUtc(payload.expiresAtUtc))
    reject('INVALID_APPROVAL_TIME');
  const now = Date.now(), start = Date.parse(payload.issuedAtUtc), expiry = Date.parse(payload.expiresAtUtc);
  if (start > now + 60000 || expiry <= now || expiry <= start || expiry - start > 900000)
    reject('APPROVAL_EXPIRED_OR_NOT_YET_VALID');
  const key = createPublicKey(readBounded(publicKeyPath, true));
  if (key.asymmetricKeyType !== 'ed25519') reject('UNTRUSTED_KEY_TYPE');
  const signature = Buffer.from(grant.signature, 'base64');
  if (signature.length !== 64 || !verify(null, Buffer.from(JSON.stringify(payload)), key, signature))
    reject('BAD_APPROVAL_SIGNATURE');
  process.stdout.write('OWNER_TRANSITION_PREVIEW_VALIDATED_ONLY\n');
}
try { main(); } catch (e) {
  const known = new Set([
    'INVALID_ARGS','INVALID_PATH','INVALID_FILE','UNTRUSTED_APPROVAL_FILE','FILE_CHANGED_DURING_READ',
    'INVALID_DOCUMENT','UNSUPPORTED_TRANSITION','UNBOUNDED_POLICY_CHANGE','INVALID_APPROVAL',
    'APPROVAL_HASH_MISMATCH','INVALID_APPROVAL_TIME','APPROVAL_EXPIRED_OR_NOT_YET_VALID',
    'UNTRUSTED_KEY_TYPE','BAD_APPROVAL_SIGNATURE'
  ]);
  process.stderr.write('OWNER_TRANSITION_PREVIEW_BLOCK ' + (known.has(e?.message) ? e.message : 'UNVERIFIED') + '\n');
  process.exitCode = 3;
}
