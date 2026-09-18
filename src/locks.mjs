import path from 'node:path';

const active = [];
const queued = [];

function keyFor(value) {
  const resolved = path.resolve(String(value));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function normalizeKeys(values) {
  return [...new Set(values.filter(Boolean).map(keyFor))].sort();
}

function isSameOrAncestor(a, b) {
  if (a === b) return true;
  const rel = path.relative(a, b);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function conflicts(aKeys, bKeys) {
  for (const a of aKeys) {
    for (const b of bKeys) {
      if (isSameOrAncestor(a, b) || isSameOrAncestor(b, a)) return true;
    }
  }
  return false;
}

function canGrant(keys) {
  return !active.some((entry) => conflicts(keys, entry.keys));
}

function drainQueue() {
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (let i = 0; i < queued.length; i += 1) {
      const pending = queued[i];
      if (!canGrant(pending.keys)) continue;
      queued.splice(i, 1);
      grant(pending.keys, pending.resolve);
      progressed = true;
      break;
    }
  }
}

function grant(keys, resolve) {
  const entry = { keys };
  active.push(entry);
  let released = false;
  resolve(() => {
    if (released) return;
    released = true;
    const index = active.indexOf(entry);
    if (index >= 0) active.splice(index, 1);
    drainQueue();
  });
}

function acquire(keys) {
  return new Promise((resolve) => {
    if (canGrant(keys)) grant(keys, resolve);
    else queued.push({ keys, resolve });
  });
}

export async function withPathLocks(paths, fn) {
  const keys = normalizeKeys(paths);
  if (keys.length === 0) return fn();
  const release = await acquire(keys);
  try {
    return await fn();
  } finally {
    release();
  }
}

export function lockStats() {
  const lockedKeys = new Set(active.flatMap((entry) => entry.keys)).size;
  return { lockedKeys, activeRequests: active.length, queued: queued.length };
}

export const __test = { keyFor, normalizeKeys, isSameOrAncestor, conflicts };
