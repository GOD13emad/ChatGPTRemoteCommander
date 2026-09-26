import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export const IS_WINDOWS = process.platform === 'win32';
export const IS_LINUX = process.platform === 'linux';

export function expandPathValue(value) {
  let text = String(value ?? '');
  text = text.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? (name.toUpperCase() === 'USERPROFILE' ? os.homedir() : _));
  text = text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => process.env[name] ?? _);
  text = text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => process.env[name] ?? _);
  if (!IS_WINDOWS) text = text.replaceAll('\\', '/');
  if (text === '~') text = os.homedir();
  else if (text.startsWith(`~${path.sep}`) || text.startsWith('~/') || text.startsWith('~\\')) {
    text = path.join(os.homedir(), text.slice(2));
  }
  return text;
}

export function defaultBackupRoot() {
  return path.join(os.homedir(), '.chatgpt-remote-commander', 'backups');
}
export function shellSpec(command, interactive = false) {
  if (IS_WINDOWS) {
    return interactive
      ? { file: 'pwsh.exe', args: ['-NoLogo', '-NoProfile'] }
      : { file: 'pwsh.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command] };
  }
  const shell = process.env.SHELL || '/bin/bash';
  return interactive
    ? { file: shell, args: ['--noprofile', '--norc'] }
    : { file: shell, args: ['-c', command] };
}

export function terminateProcessTree(pid, { signal = 'SIGTERM', windowsTimeoutMs = 5000 } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return { requested: false, method: 'none' };
  if (IS_WINDOWS) {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
    const result = spawnSync(executable, ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true, shell: false, stdio: 'ignore', timeout: windowsTimeoutMs
    });
    if (result.error) {
      try { process.kill(pid, signal); } catch {}
      return { requested: true, method: 'taskkill-fallback', status: result.status ?? null };
    }
    return { requested: true, method: 'taskkill-tree', status: result.status ?? null };
  }
  try {
    process.kill(-pid, signal);
    return { requested: true, method: 'process-group' };
  } catch {
    try {
      process.kill(pid, signal);
      return { requested: true, method: 'direct-fallback' };
    } catch {
      return { requested: true, method: 'already-exited' };
    }
  }
}

export function spawnShell(command, options = {}) {
  const spec = shellSpec(command, options.interactive === true);
  return spawn(spec.file, spec.args, {
    cwd: options.cwd,
    windowsHide: true,
    detached: !IS_WINDOWS,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    env: options.env ?? process.env
  });
}

export function shellName() {
  return IS_WINDOWS ? 'PowerShell 7' : (process.env.SHELL || '/bin/bash');
}
