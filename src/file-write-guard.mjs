import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';

const key = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
const sameFile = (a, b) => sameIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
function fail(code) { throw Object.assign(new Error(code), { code }); }

/** Inspect without following aliases; recheck the snapshot before each mutation.
 * This is a filesystem precondition, not isolation from another local OS actor.
 */
export async function guardFileWrite(target, expected) {
  target = path.resolve(target);
  const parsed = path.parse(target);
  const parts = target.slice(parsed.root.length).split(path.sep).filter(Boolean);
  const ancestors = [];
  let cursor = parsed.root, leaf = null, missing = false, deepestExisting = null;
  for (let index = -1; index < parts.length; index++) {
    if (index >= 0) cursor = path.join(cursor, parts[index]);
    const last = index === parts.length - 1;
    let info;
    try { info = await lstat(cursor, { bigint: true }); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing = true;
      break;
    }
    if (info.isSymbolicLink()) fail('FILE_WRITE_ALIAS');
    if (last) {
      if (!info.isFile()) fail('FILE_WRITE_NOT_REGULAR');
      if (info.nlink !== 1n) fail('FILE_WRITE_HARDLINK');
      leaf = info;
    } else {
      if (!info.isDirectory()) fail('FILE_WRITE_PARENT_NOT_DIRECTORY');
      ancestors.push({ path: cursor, info });
    }
    deepestExisting = cursor;
  }
  // One full canonical path verifies the complete ancestor chain. Resolving
  // each ancestor separately can require unrelated directory permissions that
  // the caller does not have, even when this exact descendant is authorized.
  // Never ignore canonicalization errors, and never canonicalize a missing leaf.
  if (!deepestExisting) fail('FILE_WRITE_PARENT_NOT_DIRECTORY');
  if (key(await realpath(deepestExisting)) !== key(deepestExisting)) fail('FILE_WRITE_ALIAS');
  if (expected !== undefined) {
    if ((expected.leaf === null) !== (leaf === null) || (leaf !== null && !sameFile(expected.leaf, leaf))) fail('FILE_WRITE_TARGET_CHANGED');
    for (const before of expected.ancestors) {
      const now = ancestors.find(item => key(item.path) === key(before.path));
      if (!now || !sameIdentity(before.info, now.info)) fail('FILE_WRITE_TARGET_CHANGED');
    }
  }
  return { target, leaf: missing ? null : leaf, ancestors };
}
