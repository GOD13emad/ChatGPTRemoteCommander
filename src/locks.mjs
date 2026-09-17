import path from 'node:path';

const states = new Map();

function keyFor(value) {
  const resolved = path.resolve(String(value));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function acquire(key) {
  let state = states.get(key);
  if (!state) {
    state = { locked: false, queue: [] };
    states.set(key, state);
  }
  return new Promise((resolve) => {
    const grant = () => {
      state.locked = true;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        const next = state.queue.shift();
        if (next) next();
        else { state.locked = false; states.delete(key); }
      });
    };
    if (state.locked) state.queue.push(grant);
    else grant();
  });
}
export async function withPathLocks(paths, fn) {
  const keys = [...new Set(paths.filter(Boolean).map(keyFor))].sort();
  const releases = [];
  try {
    for (const key of keys) releases.push(await acquire(key));
    return await fn();
  } finally {
    for (let i = releases.length - 1; i >= 0; i -= 1) releases[i]();
  }
}

export function lockStats() {
  let queued = 0;
  for (const state of states.values()) queued += state.queue.length;
  return { lockedKeys: states.size, queued };
}
