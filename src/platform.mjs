import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

export function spawnShell(command, options = {}) {
  const spec = shellSpec(command, options.interactive === true);
  return spawn(spec.file, spec.args, {
    cwd: options.cwd,
    windowsHide: true,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    env: options.env ?? process.env
  });
}

export function shellName() {
  return IS_WINDOWS ? 'PowerShell 7' : (process.env.SHELL || '/bin/bash');
}
