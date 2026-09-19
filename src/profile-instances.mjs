import path from 'node:path';
import { createHash } from 'node:crypto';

const PROFILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LOCAL_WIN = /^[A-Za-z]:[\\/]/;

export function validateProfileName(value) {
  if (typeof value !== 'string' || !PROFILE.test(value) || value.includes('..') || value === '.' || value === '..') {
    throw new Error('PROFILE_INSTANCE_INVALID_NAME');
  }
  return value;
}

export function validateLocalAbsolute(value, platform = process.platform) {
  if (typeof value !== 'string' || !value || /^(?:\\\\|\/\/)/.test(value)) throw new Error('PROFILE_INSTANCE_LOCAL_PATH_REQUIRED');
  const absolute = platform === 'win32' ? LOCAL_WIN.test(value) : path.posix.isAbsolute(value);
  if (!absolute) throw new Error('PROFILE_INSTANCE_LOCAL_PATH_REQUIRED');
  return path.resolve(value);
}

export function validateMcpPort(value) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || port === 47831) throw new Error('PROFILE_INSTANCE_INVALID_PORT');
  return port;
}

function safeProgramList(value) {
  if (!Array.isArray(value) || value.some(x => typeof x !== 'string' || !x)) throw new Error('PROFILE_INSTANCE_PROGRAMS_REQUIRED');
  return [...value];
}

export function buildProfileInstance({ baseConfig, profile, port, stateDirectory, allowedRoots, powerMode = false, guiControl = false }) {
  if (!baseConfig || typeof baseConfig !== 'object' || Array.isArray(baseConfig)) throw new Error('PROFILE_INSTANCE_BASE_CONFIG_REQUIRED');
  profile = validateProfileName(profile);
  port = validateMcpPort(port);
  stateDirectory = validateLocalAbsolute(stateDirectory);
  const roots = (allowedRoots ?? baseConfig.allowedRoots);
  if (!Array.isArray(roots) || roots.length < 1 || roots.some(x => typeof x !== 'string' || !x)) throw new Error('PROFILE_INSTANCE_ROOTS_REQUIRED');
  const basePrograms = safeProgramList(baseConfig.allowedPrograms);
  // A general-purpose interpreter/compiler is not a filesystem sandbox. Standard
  // isolated profiles therefore receive no command allowlist at all.
  const programs = powerMode === true ? basePrograms : [];

  const basePower = baseConfig.powerMode && typeof baseConfig.powerMode === 'object' ? baseConfig.powerMode : {};
  const power = powerMode === true
    ? { ...basePower, enabled: true, fullFilesystem: true, allowPermanentDelete: false,
        guiControl: { ...(basePower.guiControl ?? {}), enabled: guiControl === true } }
    : { ...basePower, enabled: false, fullFilesystem: false, allowShell: false, allowProcessControl: false,
        allowPermanentDelete: false, guiControl: { ...(basePower.guiControl ?? {}), enabled: false } };

  const config = {
    ...baseConfig,
    port,
    allowedRoots: [...roots],
    allowedPrograms: programs,
    auditLog: path.join(stateDirectory, 'audit.jsonl'),
    runtimeState: path.join(stateDirectory, 'mcp-runtime.json'),
    instance: { profile, isolated: true },
    powerMode: power,
    durableWorkflows: {
      enabled: true,
      directory: path.join(stateDirectory, 'workflows'),
      executionTools: powerMode === true
        ? ['system_status', 'list_directory', 'read_text', 'write_text', 'run_project_command']
        : ['system_status', 'list_directory', 'read_text', 'write_text']
    }
  };
  const json = JSON.stringify(config, null, 2) + '\n';
  const configSha256 = createHash('sha256').update(json).digest('hex');
  const record = {
    schema: 1, profile, enabled: true, mcpPort: port,
    configPath: path.join(stateDirectory, 'config.json'),
    configSha256, isolated: true
  };
  return { config, json, configSha256, record };
}

export function validateInstanceRecord(record) {
  if (!record || record.schema !== 1 || record.enabled !== true || record.isolated !== true) throw new Error('PROFILE_INSTANCE_RECORD_INVALID');
  validateProfileName(record.profile);
  validateMcpPort(record.mcpPort);
  validateLocalAbsolute(record.configPath);
  if (typeof record.configSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.configSha256)) throw new Error('PROFILE_INSTANCE_RECORD_INVALID');
  return record;
}
