import fs from 'node:fs';
import path from 'node:path';

export const QUALIFIED_CODEX_VERSION = '0.156.1';

const RUNNER_ALLOWED_TOOLS = Object.freeze([
  'list_directory','read_text','file_info','write_text','create_directory'
]);
const RUNNER_TEAM = Object.freeze({
  workers: [
    { id: 'builder', role: 'Propose the safest bounded next step using current evidence.' },
    { id: 'reviewer', role: 'Check missing prerequisites, evidence and failure risks before the coordinator acts.' }
  ],
  maxParallel: 2
});

function clone(value) { return JSON.parse(JSON.stringify(value ?? {})); }

function executableFile(file, platform = process.platform) {
  if (typeof file !== 'string' || !file || file.includes('\0')) return false;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    if (platform !== 'win32') fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function qualifiedCandidates(stateRoot, platform = process.platform, arch = process.arch) {
  if (typeof stateRoot !== 'string' || !stateRoot) return [];
  const base = path.join(stateRoot, 'tools', 'codex-cli', QUALIFIED_CODEX_VERSION, 'node_modules', '@openai');
  const table = {
    'win32:x64': ['codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'],
    'win32:arm64': ['codex-win32-arm64', 'vendor', 'aarch64-pc-windows-msvc', 'bin', 'codex.exe'],
    'linux:x64': ['codex-linux-x64', 'vendor', 'x86_64-unknown-linux-musl', 'bin', 'codex'],
    'linux:arm64': ['codex-linux-arm64', 'vendor', 'aarch64-unknown-linux-musl', 'bin', 'codex']
  };
  const parts = table[`${platform}:${arch}`];
  return parts ? [path.join(base, ...parts)] : [];
}

export function discoverQualifiedProjectProvider({ stateRoot, platform = process.platform, arch = process.arch } = {}) {
  for (const executable of qualifiedCandidates(stateRoot, platform, arch)) {
    if (executableFile(executable, platform)) {
      return {
        status: 'QUALIFIED',
        kind: 'codex',
        version: QUALIFIED_CODEX_VERSION,
        executable
      };
    }
  }
  return {
    status: 'MISSING',
    kind: 'codex',
    version: QUALIFIED_CODEX_VERSION,
    executable: null
  };
}

function normalizedRunner(existing, executable) {
  const current = existing && typeof existing === 'object' && !Array.isArray(existing) ? clone(existing) : {};
  const provider = current.provider && typeof current.provider === 'object' && !Array.isArray(current.provider)
    ? clone(current.provider) : {};
  return {
    ...current,
    enabled: true,
    autoTick: current.autoTick !== false,
    provider: {
      ...provider,
      kind: provider.kind ?? 'codex',
      executable,
      timeoutMs: Math.min(Number.isSafeInteger(Number(provider.timeoutMs)) ? Number(provider.timeoutMs) : 30_000, 30_000),
      maxOutputBytes: Number.isSafeInteger(Number(provider.maxOutputBytes))
        ? Math.min(Math.max(Number(provider.maxOutputBytes), 64), 16 * 1024 * 1024)
        : 2 * 1024 * 1024
    },
    allowedTools: Array.isArray(current.allowedTools) && current.allowedTools.length
      ? [...current.allowedTools] : [...RUNNER_ALLOWED_TOOLS],
    maxActions: Number.isSafeInteger(Number(current.maxActions)) ? Number(current.maxActions) : 32,
    maxDurationMs: Number.isSafeInteger(Number(current.maxDurationMs)) ? Number(current.maxDurationMs) : 300_000,
    maxPlannerCalls: Number.isSafeInteger(Number(current.maxPlannerCalls)) ? Number(current.maxPlannerCalls) : 128,
    adaptive: {
      enabled: current.adaptive?.enabled !== false,
      maxExtensions: Number.isSafeInteger(Number(current.adaptive?.maxExtensions))
        ? Number(current.adaptive.maxExtensions) : 4
    },
    team: current.team ?? clone(RUNNER_TEAM),
    worker: {
      enabled: current.worker?.enabled !== false,
      maxArtifactBytes: Number.isSafeInteger(Number(current.worker?.maxArtifactBytes))
        ? Number(current.worker.maxArtifactBytes) : 65_536
    }
  };
}

export function applyProjectRunnerConfig(config, { stateRoot, platform = process.platform, arch = process.arch } = {}) {
  const next = clone(config);
  next.durableWorkflows ??= {};
  const profile = next.capabilityProfile ?? {};
  const disabled = new Set(Array.isArray(profile.disabledCapabilities) ? profile.disabledCapabilities : []);
  const authorized = profile.tier === 'FULL_POWER' && profile.explicitlyAuthorized === true;
  if (!authorized || disabled.has('workflow.project_engine') || next.durableWorkflows.enabled !== true) {
    if (next.durableWorkflows.runner && typeof next.durableWorkflows.runner === 'object') {
      next.durableWorkflows.runner.enabled = false;
      next.durableWorkflows.runner.autoTick = false;
    }
    return {
      config: next,
      status: disabled.has('workflow.project_engine') ? 'EXPLICITLY_DISABLED' : authorized ? 'WORKFLOW_DISABLED' : 'AUTHORITY_DISABLED',
      provider: null
    };
  }

  const existing = next.durableWorkflows.runner;
  const existingExecutable = existing?.provider?.executable;
  if (existing?.enabled === true && executableFile(existingExecutable, platform)) {
    next.durableWorkflows.runner = normalizedRunner(existing, existingExecutable);
    return {
      config: next,
      status: 'PRESERVED',
      provider: {
        kind: next.durableWorkflows.runner.provider.kind,
        executable: existingExecutable,
        qualifiedVersion: existing?.provider?.kind === 'codex' ? QUALIFIED_CODEX_VERSION : null
      }
    };
  }

  const discovered = discoverQualifiedProjectProvider({ stateRoot, platform, arch });
  if (discovered.status !== 'QUALIFIED') {
    if (next.durableWorkflows.runner && typeof next.durableWorkflows.runner === 'object') {
      next.durableWorkflows.runner.enabled = false;
      next.durableWorkflows.runner.autoTick = false;
    }
    return { config: next, status: 'PROVIDER_MISSING', provider: discovered };
  }

  next.durableWorkflows.runner = normalizedRunner(existing, discovered.executable);
  return { config: next, status: 'AUTO_CONFIGURED', provider: discovered };
}
