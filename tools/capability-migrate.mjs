import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateCapabilityConfig, compareCapabilityState } from '../src/capability-profile.mjs';

function parse(argv) {
  const out = { requestPower: false, requestStandard: false, requestGui: undefined, disableCapabilities: [], enableCapabilities: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--request-power') { out.requestPower = true; continue; }
    if (a === '--request-standard') { out.requestStandard = true; continue; }
    if (a === '--gui-on') { out.requestGui = true; continue; }
    if (a === '--gui-off') { out.requestGui = false; continue; }
    const v = argv[++i];
    if (v === undefined) throw new Error('CAPABILITY_MIGRATION_ARGUMENT');
    if (a === '--default') out.defaultPath = v;
    else if (a === '--existing') out.existingPath = v;
    else if (a === '--output') out.outputPath = v;
    else if (a === '--profile-id') out.profileId = v;
    else if (a === '--backup-root') out.backupRoot = v;
    else if (a === '--workflow-dir') out.workflowDirectory = v;
    else if (a === '--disable-capability') out.disableCapabilities.push(v);
    else if (a === '--enable-capability') out.enableCapabilities.push(v);
    else throw new Error('CAPABILITY_MIGRATION_ARGUMENT');
  }
  if (!out.defaultPath || !out.outputPath) throw new Error('CAPABILITY_MIGRATION_REQUIRED');
  out.profileId ??= 'default';
  return out;
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now().toString(36);
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

function stamp() { return new Date().toISOString().replaceAll(':','-') + '-' + process.pid; }

function backupWorkflowDb(config, backupDir) {
  const directory = config?.durableWorkflows?.directory;
  if (typeof directory !== 'string' || !directory) return { present: false };
  const dbPath = path.join(directory, 'workflows.sqlite');
  if (!fs.existsSync(dbPath)) return { present: false, dbPath };
  const out = path.join(backupDir, 'workflows.sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true, allowExtension: false });
  try {
    const check = db.prepare('PRAGMA quick_check').get().quick_check;
    if (check !== 'ok') throw new Error('CAPABILITY_WORKFLOW_DB_CORRUPT');
    const escaped = out.replaceAll("'", "''");
    db.exec("VACUUM INTO '" + escaped + "'");
  } finally { db.close(); }
  return { present: true, dbPath, backupPath: out };
}

const args = parse(process.argv.slice(2));
const defaultConfig = JSON.parse(fs.readFileSync(args.defaultPath, 'utf8'));
const existingConfig = args.existingPath && fs.existsSync(args.existingPath)
  ? JSON.parse(fs.readFileSync(args.existingPath, 'utf8')) : null;
const result = migrateCapabilityConfig({
  defaultConfig,
  existingConfig,
  profileId: args.profileId,
  requestPower: args.requestPower,
  requestStandard: args.requestStandard,
  requestGui: args.requestGui,
  workflowDirectory: args.workflowDirectory,
  disableCapabilities: args.disableCapabilities,
  enableCapabilities: args.enableCapabilities
});
const nextText = JSON.stringify(result.config, null, 2) + '\n';
let backupDir = null;
let oldBytes = null;
if (fs.existsSync(args.outputPath)) oldBytes = fs.readFileSync(args.outputPath);
if (existingConfig && args.backupRoot) {
  backupDir = path.join(args.backupRoot, 'capability-migration-' + stamp());
  fs.mkdirSync(backupDir, { recursive: true });
  if (args.existingPath && fs.existsSync(args.existingPath)) {
    fs.copyFileSync(args.existingPath, path.join(backupDir, 'config.before.json'));
  }
  fs.writeFileSync(path.join(backupDir, 'capability-profile.before.json'), JSON.stringify(
    existingConfig.capabilityProfile ?? { inferred: true }, null, 2) + '\n');
  const wf = backupWorkflowDb(existingConfig, backupDir);
  fs.writeFileSync(path.join(backupDir, 'workflow-backup.json'), JSON.stringify(wf, null, 2) + '\n');
}
try {
  atomicWrite(args.outputPath, nextText);
  const actual = JSON.parse(fs.readFileSync(args.outputPath, 'utf8'));
  const check = compareCapabilityState(result.config, actual);
  if (!check.ok) throw Object.assign(new Error('CONFIG_REGRESSION'), { check });
  console.log(JSON.stringify({
    status: 'CAPABILITY_MIGRATION_PASS',
    profileId: result.profile.id,
    tier: result.profile.tier,
    explicitlyAuthorized: result.profile.explicitlyAuthorized,
    persistAcrossUpdates: result.profile.persistAcrossUpdates,
    preservedExplicitAuthority: result.preservedExplicitAuthority,
    capabilityCount: result.profile.grantedCapabilities.length,
    configSha256: result.sha256,
    backupDir,
    selfTest: check
  }));
} catch (error) {
  if (oldBytes) atomicWrite(args.outputPath, oldBytes.toString('utf8'));
  else fs.rmSync(args.outputPath, { force: true });
  throw error;
}
