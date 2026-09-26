import path from 'node:path';
import { createHash } from 'node:crypto';
import { migrateCapabilityConfig, FULL_WORKFLOW_EXECUTION_TOOLS, normalizeCapabilityProfile } from './capability-profile.mjs';

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

export function buildProfileInstance({ baseConfig, existingConfig = null, profile, port, stateDirectory, allowedRoots, powerMode = undefined, guiControl = undefined }) {
  if (!baseConfig || typeof baseConfig !== 'object' || Array.isArray(baseConfig)) throw new Error('PROFILE_INSTANCE_BASE_CONFIG_REQUIRED');
  profile = validateProfileName(profile);
  port = validateMcpPort(port);
  stateDirectory = validateLocalAbsolute(stateDirectory);
  const roots = (allowedRoots ?? existingConfig?.allowedRoots ?? baseConfig.allowedRoots);
  if (!Array.isArray(roots) || roots.length < 1 || roots.some(x => typeof x !== 'string' || !x)) throw new Error('PROFILE_INSTANCE_ROOTS_REQUIRED');
  const basePrograms = safeProgramList(baseConfig.allowedPrograms);
  const migrated = migrateCapabilityConfig({
    defaultConfig: baseConfig,
    existingConfig,
    profileId: profile,
    requestPower: powerMode === true,
    requestStandard: powerMode === false,
    requestGui: guiControl
  });
  const power = migrated.config.powerMode;
  // A general-purpose interpreter/compiler is not a filesystem sandbox. Standard
  // isolated profiles therefore receive no command allowlist at all.
  const programs = power.enabled === true ? basePrograms : [];

  const executionTools = power.enabled === true
    ? [...FULL_WORKFLOW_EXECUTION_TOOLS]
    : ['system_status', 'list_directory', 'read_text', 'write_text'];
  const rootLeaseDirectory = migrated.config.durableWorkflows?.rootLeaseDirectory
    ?? path.join(path.dirname(path.dirname(stateDirectory)),'shared','root-leases');
  const config = {
    ...migrated.config,
    port,
    allowedRoots: [...roots],
    allowedPrograms: programs,
    auditLog: path.join(stateDirectory, 'audit.jsonl'),
    runtimeState: path.join(stateDirectory, 'mcp-runtime.json'),
    instance: { profile, isolated: true },
    powerMode: power,
    durableWorkflows: {
      ...(migrated.config.durableWorkflows ?? {}),
      enabled: true,
      directory: path.join(stateDirectory, 'workflows'),
      rootLeaseDirectory,
      executionTools
    }
  };
  config.capabilityProfile = normalizeCapabilityProfile({
    ...migrated.profile,
    id: profile
  }, config, { id: profile, legacyExplicit: true });
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
