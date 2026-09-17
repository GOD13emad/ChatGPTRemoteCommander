import path from 'node:path';
import { access, realpath, stat } from 'node:fs/promises';

const WIN_ABS = /^(?:[a-zA-Z]:[\\/]|\\\\)/;

export function normalizeRoots(roots) {
  return roots.map((root) => path.resolve(root));
}

export function isWithin(candidate, roots) {
  const target = path.resolve(candidate).toLowerCase();
  return roots.some((root) => {
    const base = path.resolve(root).toLowerCase();
    const rel = path.relative(base, target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

export async function canonicalizeRoots(roots) {
  const result = [];
  for (const root of normalizeRoots(roots)) {
    await access(root);
    result.push(await realpath(root));
  }
  return result;
}
export function lexicalPath(userPath, roots, base = roots[0]) {
  if (typeof userPath !== 'string' || userPath.length === 0) {
    throw new Error('path must be a non-empty string');
  }
  const candidate = path.resolve(path.isAbsolute(userPath) ? userPath : path.join(base, userPath));
  if (!isWithin(candidate, roots)) throw new Error('path is outside allowed roots');
  return candidate;
}

export async function safeExistingPath(userPath, roots, base) {
  const candidate = lexicalPath(userPath, roots, base);
  const resolved = await realpath(candidate);
  if (!isWithin(resolved, roots)) throw new Error('resolved path escapes allowed roots');
  return resolved;
}

export async function safeWritablePath(userPath, roots, base) {
  const candidate = lexicalPath(userPath, roots, base);
  try {
    const info = await stat(candidate);
    if (info.isSymbolicLink()) throw new Error('symbolic-link writes are not allowed');
    const resolved = await realpath(candidate);
    if (!isWithin(resolved, roots)) throw new Error('resolved path escapes allowed roots');
    return candidate;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const parent = await realpath(path.dirname(candidate));
  if (!isWithin(parent, roots)) throw new Error('parent path escapes allowed roots');
  return candidate;
}

export function validateProgram(program, allowedPrograms) {
  if (typeof program !== 'string' || !program) throw new Error('program is required');
  if (path.isAbsolute(program) || program.includes('/') || program.includes('\\')) {
    throw new Error('program must be a bare executable name from the allowlist');
  }
  const normalized = path.basename(program).toLowerCase().replace(/\.exe$/, '');
  const allowed = allowedPrograms.map((p) => p.toLowerCase().replace(/\.exe$/, ''));
  if (!allowed.includes(normalized)) throw new Error(`program not allowed: ${program}`);
  return program;
}

export function validateCommandArgs(program, args, cwd, roots) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new Error('args must be an array of strings');
  }
  const name = path.basename(program).toLowerCase().replace(/\.exe$/, '');
  if ((name === 'python' || name === 'py') && args.some((a) => a === '-c' || a.startsWith('-c'))) {
    throw new Error('python -c is blocked; run a project script file instead');
  }
  if (name === 'node' && args.some((a) => a === '-e' || a.startsWith('-e') || a === '--eval' || a.startsWith('--eval=') || a === '-p' || a.startsWith('-p') || a === '--print' || a.startsWith('--print='))) {
    throw new Error('node eval/print is blocked; run a project script file instead');
  }
  for (const arg of args) {
    const possible = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : arg;
    if (WIN_ABS.test(possible) && !isWithin(possible, roots)) {
      throw new Error(`absolute argument path is outside allowed roots: ${possible}`);
    }
    if (possible === '..' || possible.startsWith(`..${path.sep}`)) {
      const resolved = path.resolve(cwd, possible);
      if (!isWithin(resolved, roots)) throw new Error('relative argument escapes allowed roots');
    }
  }
  return args;
}

export function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function rootForPath(candidate, roots) {
  const resolved = path.resolve(candidate).toLowerCase();
  const ordered = [...roots].sort((a, b) => b.length - a.length);
  const found = ordered.find((root) => isWithin(resolved, [root]));
  if (!found) throw new Error('path is outside allowed roots');
  return found;
}
