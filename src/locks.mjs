import fs from 'node:fs';
import path from 'node:path';

let nextId = 1;
const active = new Map();
const queue = [];

function normalizeCase(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function canonicalKey(value) {
  const resolved = path.resolve(String(value));
  const suffix = [];
  let cursor = resolved;

  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }

  let base = cursor;
  try { base = fs.realpathSync.native(cursor); } catch { base = path.resolve(cursor); }
  return normalizeCase(path.join(base, ...suffix));
}

function isSameOrDescendant(parent, child) {
  if (parent === child) return true;
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function overlaps(a, b) {
  return isSameOrDescendant(a, b) || isSameOrDescendant(b, a);
}

function conflicts(keys) {
  for (const held of active.values()) {
    for (const a of keys) {
      for (const b of held) if (overlaps(a, b)) return true;
    }
  }
  return false;
}

function drain() {
  for (let i = 0; i < queue.length;) {
    const item = queue[i];
    if (conflicts(item.keys)) { i += 1; continue; }
    queue.splice(i, 1);
    active.set(item.id, item.keys);
    item.resolve(() => release(item.id));
  }
}

function release(id) {
  active.delete(id);
  drain();
}

function acquireMany(values) {
  const keys = [...new Set(values.filter(Boolean).map(canonicalKey))].sort();
  if (keys.length === 0) return Promise.resolve(() => {});
  const id = nextId++;
  return new Promise((resolve) => {
    const item = { id, keys, resolve };
    if (conflicts(keys)) queue.push(item);
    else {
      active.set(id, keys);
      resolve(() => release(id));
    }
  });
}

export async function withPathLocks(paths, fn) {
  const unlock = await acquireMany(paths);
  try { return await fn(); }
  finally { unlock(); }
}

export function lockStats() {
  return {
    lockedKeys: [...active.values()].reduce((sum, keys) => sum + keys.length, 0),
    activeOperations: active.size,
    queued: queue.length,
    hierarchyAware: true,
    canonicalAliases: true
  };
}

export const __lockInternals = { canonicalKey, overlaps };
