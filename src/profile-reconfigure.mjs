import fs from 'node:fs';
import path from 'node:path';
import { buildProfileInstance, validateInstanceRecord } from './profile-instances.mjs';

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp-' + process.pid + '-' + Date.now().toString(36);
  fs.writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
}
function stamp() { return new Date().toISOString().replaceAll(':','-') + '-' + process.pid; }

export function reconfigureProfileInstance({ profile, stateDirectory, baseConfigPath, powerMode, guiControl, allowedRoots }) {
  if (guiControl === true && powerMode !== true) throw new Error('PROFILE_RECONFIGURE_GUI_REQUIRES_POWER');
  if (typeof stateDirectory !== 'string' || !path.isAbsolute(stateDirectory)) throw new Error('PROFILE_RECONFIGURE_STATE_REQUIRED');
  const configFile = path.join(stateDirectory, 'config.json');
  const recordFile = path.join(stateDirectory, 'instance.json');
  if (!fs.existsSync(configFile) || !fs.existsSync(recordFile)) throw new Error('PROFILE_RECONFIGURE_INSTANCE_MISSING');

  const oldConfigText = fs.readFileSync(configFile, 'utf8');
  const oldConfig = JSON.parse(oldConfigText);
  const oldRecord = validateInstanceRecord(JSON.parse(fs.readFileSync(recordFile, 'utf8')));
  if (oldRecord.profile !== profile || oldConfig.instance?.profile !== profile || oldConfig.instance?.isolated !== true) throw new Error('PROFILE_RECONFIGURE_IDENTITY_MISMATCH');
  if (Number(oldConfig.port) !== Number(oldRecord.mcpPort)) throw new Error('PROFILE_RECONFIGURE_PORT_MISMATCH');
  const baseConfig = JSON.parse(fs.readFileSync(baseConfigPath, 'utf8'));
  const roots = allowedRoots?.length ? allowedRoots : oldConfig.allowedRoots;
  const built = buildProfileInstance({ baseConfig, profile, port: oldRecord.mcpPort, stateDirectory, allowedRoots: roots, powerMode, guiControl });
  const nextRecord = { ...built.record, configPath: configFile };

  if (built.config.durableWorkflows.directory !== oldConfig.durableWorkflows?.directory) {
    throw new Error('PROFILE_RECONFIGURE_MEMORY_PATH_CHANGED');
  }
  if (built.config.runtimeState !== oldConfig.runtimeState) throw new Error('PROFILE_RECONFIGURE_RUNTIME_PATH_CHANGED');

  const backupDir = path.join(stateDirectory, 'backups', 'reconfigure-' + stamp());
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(configFile, path.join(backupDir, 'config.json'));
  fs.copyFileSync(recordFile, path.join(backupDir, 'instance.json'));
  const beforeConfig = fs.readFileSync(configFile);
  const beforeRecord = fs.readFileSync(recordFile);
  try {
    atomicWrite(configFile, built.json);
    atomicWrite(recordFile, JSON.stringify(nextRecord, null, 2) + '\n');
    const checkRecord = validateInstanceRecord(JSON.parse(fs.readFileSync(recordFile, 'utf8')));
    if (checkRecord.configSha256 !== built.configSha256) throw new Error('PROFILE_RECONFIGURE_RECORD_HASH_MISMATCH');
    const afterConfig = fs.readFileSync(configFile, 'utf8');
    if (afterConfig !== built.json) throw new Error('PROFILE_RECONFIGURE_CONFIG_WRITE_MISMATCH');
    return {
      profile, mcpPort: oldRecord.mcpPort, backupDir,
      oldConfigSha256: oldRecord.configSha256, newConfigSha256: built.configSha256,
      powerMode: built.config.powerMode.enabled === true,
      guiControl: built.config.powerMode.guiControl?.enabled === true,
      durableWorkflows: built.config.durableWorkflows.enabled === true,
      supervisorRecycleRequired: oldRecord.configSha256 !== built.configSha256
    };
  } catch (error) {
    atomicWrite(configFile, beforeConfig.toString('utf8'));
    atomicWrite(recordFile, beforeRecord.toString('utf8'));
    throw error;
  }
}
