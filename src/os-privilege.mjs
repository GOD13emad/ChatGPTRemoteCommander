import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PROBE_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$id=[Security.Principal.WindowsIdentity]::GetCurrent()",
  "$p=[Security.Principal.WindowsPrincipal]::new($id)",
  "$s=[Diagnostics.Process]::GetCurrentProcess().SessionId",
  "[ordered]@{administrator=[bool]$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);system=[bool]$id.IsSystem;sessionId=[int]$s}|ConvertTo-Json -Compress"
].join(';');

function unknown(platform) {
  return { platform, elevated: null, authority: 'unknown',
    nativeAuthorizationRequired: null, source: 'native-probe-unavailable',
    crossUserSessionAccess: 'not-established' };
}

export function readEffectiveOsPrivilege({
  platform = process.platform,
  effectiveUid = typeof process.geteuid === 'function' ? process.geteuid() : null,
  runProbe = spawnSync,
  systemRoot = process.env.SystemRoot || 'C:\\Windows'
} = {}) {
  if (platform !== 'win32') {
    if (!Number.isSafeInteger(effectiveUid) || effectiveUid < 0) return unknown(platform);
    const root = effectiveUid === 0;
    return { platform, elevated: root, authority: root ? 'root' : 'user',
      uid: effectiveUid, nativeAuthorizationRequired: !root,
      source: 'posix-effective-uid', crossUserSessionAccess: 'not-established' };
  }
  try {
    const exe = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = runProbe(exe, ['-NoProfile', '-NonInteractive', '-Command', PROBE_SCRIPT],
      { shell: false, windowsHide: true, encoding: 'utf8', timeout: 4000, maxBuffer: 2048 });
    if (result?.error || result?.status !== 0) return unknown(platform);
    const data = JSON.parse(String(result.stdout || '').trim());
    if (typeof data.administrator !== 'boolean' || typeof data.system !== 'boolean'
      || !Number.isSafeInteger(data.sessionId) || data.sessionId < 0) return unknown(platform);
    const elevated = data.system || data.administrator;
    return { platform, elevated, authority: data.system ? 'system' : elevated ? 'administrator' : 'user',
      sessionId: data.sessionId, nativeAuthorizationRequired: !elevated,
      source: 'windows-access-token', crossUserSessionAccess: 'not-established' };
  } catch {
    return unknown(platform);
  }
}
