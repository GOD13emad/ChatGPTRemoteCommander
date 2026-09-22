// Durable project memory. Opt-in; not an OS sandbox, scheduler, or model.
// SQLite rollback journal avoids depending on WAL fixes in bundled SQLite versions.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import {
  AUTONOMY_REVISION, AUTONOMY_SCHEMA, normalizeWorkflowState, normalizeExecutionProfile,
  normalizeSchedulerPolicy, normalizeAuthority, authorityCompatible, classifyTool,
  reconciliationPlan, syncProjectBrain
} from './workflow-autonomy.mjs';

export const STORE_SCHEMA = AUTONOMY_SCHEMA;
export const MODULE_REVISION = AUTONOMY_REVISION;
const ZERO = '0'.repeat(64);
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const MAX_STATE = 512 * 1024;
const MAX_EVENTS = 10000;
const MAX_EXPORT = 4 * 1024 * 1024;
const MAX_FILE = 16 * 1024 * 1024;
export const fail = code => { throw Object.assign(new Error(code), { workflowCode: code }); };
export const hash = data => createHash('sha256').update(data).digest('hex');

export function canonical(value, depth = 0) {
  if (depth > 24) fail('WORKFLOW_JSON_DEPTH');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(x => canonical(x, depth + 1)).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value).sort();
    if (keys.some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) fail('WORKFLOW_JSON_KEY');
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(value[k], depth + 1)).join(',') + '}';
  }
  fail('WORKFLOW_JSON_VALUE');
}
const jsonHash = v => hash(canonical(v));
const identifier = id => { if (typeof id !== 'string' || !ID.test(id)) fail('WORKFLOW_INVALID_ID'); return id; };
const revision = n => { if (!Number.isSafeInteger(n) || n < 0) fail('WORKFLOW_REVISION_REQUIRED'); return n; };
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
export function inside(root, candidate) {
  let a = path.resolve(root), b = path.resolve(candidate);
  if (process.platform === 'win32') { a = a.toLowerCase(); b = b.toLowerCase(); }
  const r = path.relative(a, b);
  return r === '' || (r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r));
}
export function safeText(value, max = 8000) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || !value.isWellFormed() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail('WORKFLOW_INVALID_TEXT');
  // A leak guard, NOT a complete secret/PII classifier. Never put secrets in memory.
  if (/\b(?:sk|ghp|github_pat)[-_][A-Za-z0-9_-]{16,}|\bBearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|api[_ -]?key|access[_ -]?token|secret)\s*[=:]\s*\S+/i.test(value)) fail('WORKFLOW_SECRET_NOT_ALLOWED');
  return value;
}
function noLinks(target, existing = true) {
  const resolved = path.resolve(target);
  let cursor = path.parse(resolved).root;
  for (const bit of resolved.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, bit);
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) fail('WORKFLOW_LINK_NOT_ALLOWED');
    } catch (e) { if (e.code !== 'ENOENT' || existing) throw e; break; }
  }
  return resolved;
}
function rootWithin(target, roots) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) fail('WORKFLOW_ABSOLUTE_ROOT_REQUIRED');
  noLinks(target);
  const actual = fs.realpathSync.native(target);
  if (!fs.statSync(actual).isDirectory() || !roots.some(r => inside(r, actual))) fail('WORKFLOW_ROOT_OUT_OF_SCOPE');
  return actual;
}
function clone(value) { return JSON.parse(canonical(value)); }
function receiptFields(result) {
  const receipt = {};
  for (const k of ['exitCode', 'timedOut', 'isError', 'ok', 'submitted', 'visualVerificationRequired']) {
    if (result && Object.hasOwn(result, k) && ['boolean', 'number'].includes(typeof result[k])) receipt[k] = result[k];
  }
  const raw = canonical(result ?? null);
  if (Buffer.byteLength(raw) > 8 * 1024 * 1024) fail('WORKFLOW_RECEIPT_TOO_LARGE');
  return { ...receipt, resultSha256: hash(raw), outputStored: false };
}
function badResult(r) { return r?.timedOut === true || r?.isError === true || r?.ok === false || (typeof r?.exitCode === 'number' && r.exitCode !== 0) || r?.exitCode === null; }

export class WorkflowStore {
  #db;
  #roots;
  #device;
  #configSha;
  #instance = randomUUID();
  #dbPath;
  #closed = false;
  #authority;
  #executionProfile;
  #schedulerPolicy;
  #workerId = randomUUID();
  constructor({ directory, allowedRoots, device = os.hostname(), configSha256 = ZERO, authority = {}, executionProfile = {}, schedulerPolicy = {} }) {
    if (!Array.isArray(allowedRoots) || !allowedRoots.length) fail('WORKFLOW_ROOTS_REQUIRED');
    this.#roots = allowedRoots.map(r => { noLinks(r); return fs.realpathSync.native(r); });
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || /^(?:\\\\|\/\/)/.test(directory)) fail('WORKFLOW_LOCAL_STORE_REQUIRED');
    // Storage is operator-configured private local state, separate from project roots.
    // Workflow project/evidence roots remain enforced independently by rootWithin().
    noLinks(directory, false);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const dir = fs.realpathSync.native(directory);
    if (!fs.statSync(dir).isDirectory()) fail('WORKFLOW_LOCAL_STORE_REQUIRED');
    this.#dbPath = path.join(dir, 'workflows.sqlite');
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      noLinks(this.#dbPath + suffix, false);
      if (fs.existsSync(this.#dbPath + suffix)) {
        const s = fs.lstatSync(this.#dbPath + suffix);
        if (!s.isFile() || s.nlink > 1) fail('WORKFLOW_DATABASE_ALIAS');
      }
    }
    this.#device = safeText(device, 128);
    if (!/^[a-f0-9]{64}$/.test(configSha256)) fail('WORKFLOW_CONFIG_HASH_REQUIRED');
    this.#configSha = configSha256;
    this.#authority = normalizeAuthority(authority);
    this.#executionProfile = normalizeExecutionProfile(executionProfile);
    this.#schedulerPolicy = normalizeSchedulerPolicy(schedulerPolicy);
    this.#db = new DatabaseSync(this.#dbPath, { allowExtension: false });
    try {
      fs.chmodSync(this.#dbPath, 0o600);
      this.#db.exec('PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
      // Do not silently convert an existing database made by another configuration.
      const mode = this.#db.prepare('PRAGMA journal_mode').get().journal_mode;
      if (mode !== 'delete') fail('WORKFLOW_UNEXPECTED_JOURNAL_MODE');
      this.#db.exec('PRAGMA synchronous=EXTRA;');
      let userVersion = this.#db.prepare('PRAGMA user_version').get().user_version;
      if (![0, 1, STORE_SCHEMA].includes(userVersion)) fail('WORKFLOW_SCHEMA_UNSUPPORTED');
      if (userVersion === 0) {
        this.#db.exec(`
          BEGIN IMMEDIATE;
          CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, head TEXT NOT NULL, snapshot TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS events(workflow TEXT NOT NULL REFERENCES workflows(id), seq INTEGER NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(workflow,seq));
          CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
          CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
          PRAGMA user_version=1;
          COMMIT;
        `);
        userVersion = 1;
      }
      if (userVersion === 1) {
        this.#db.exec(`
          BEGIN IMMEDIATE;
          CREATE TABLE IF NOT EXISTS scheduler_jobs(
            workflow TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
            lifecycle TEXT NOT NULL, enabled INTEGER NOT NULL, next_run_at TEXT,
            lease_owner TEXT, lease_until TEXT, retry_count INTEGER NOT NULL DEFAULT 0,
            last_failure TEXT, updated_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS operations(
            operation_id TEXT PRIMARY KEY,
            workflow TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
            step_id TEXT NOT NULL, attempt_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
            classification TEXT NOT NULL, status TEXT NOT NULL, tool TEXT NOT NULL,
            input_hash TEXT NOT NULL, verification TEXT, pre_state_hash TEXT, result_status TEXT, exit_code INTEGER,
            post_state_hash TEXT, receipt TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS operations_workflow_step ON operations(workflow,step_id);
          CREATE TABLE IF NOT EXISTS root_leases(
            root TEXT PRIMARY KEY, workflow TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
            owner TEXT NOT NULL, expires_at TEXT NOT NULL, revision INTEGER NOT NULL
          );
          COMMIT;
        `);
      }
      if (this.#db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') fail('WORKFLOW_DATABASE_CORRUPT');
      const rows = this.#db.prepare('SELECT id,snapshot FROM workflows ORDER BY id').all();
      const now = new Date().toISOString();
      for (const row of rows) {
        let st = null; try { st = JSON.parse(row.snapshot); } catch { continue; }
        const enabled = st?.scheduler?.enabled === true || (st?.scheduler == null && this.#schedulerPolicy.enabled);
        const lifecycle = typeof st?.lifecycleState === 'string' ? st.lifecycleState : 'CREATED';
        this.#db.prepare('INSERT OR IGNORE INTO scheduler_jobs(workflow,lifecycle,enabled,next_run_at,lease_owner,lease_until,retry_count,last_failure,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(row.id,lifecycle,enabled?1:0,null,null,null,0,null,now);
      }
    } catch (e) { this.#db.close(); throw e; }
    this.recoverInterrupted();
  }
  close() { if (!this.#closed) { this.#db.close(); this.#closed = true; } }
  get location() { return this.#dbPath; }

  schedulerStatus() {
    const counts = {};
    for (const row of this.#db.prepare('SELECT lifecycle,COUNT(*) AS n FROM scheduler_jobs GROUP BY lifecycle').all()) counts[row.lifecycle] = Number(row.n);
    const pending = this.#db.prepare("SELECT COUNT(*) AS n FROM scheduler_jobs WHERE enabled=1 AND lifecycle NOT IN ('COMPLETED','FAILED','CANCELLED')").get().n;
    const interrupted = this.#db.prepare("SELECT COUNT(*) AS n FROM scheduler_jobs WHERE lifecycle='INTERRUPTED'").get().n;
    const leases = this.#db.prepare('SELECT COUNT(*) AS n FROM root_leases WHERE expires_at > ?').get(new Date().toISOString()).n;
    const reconciliationRequired = this.#db.prepare("SELECT COUNT(*) AS n FROM operations WHERE status='UNCERTAIN'").get().n;
    return {
      enabled: this.#schedulerPolicy.enabled,
      automaticContinuation: this.#schedulerPolicy.enabled,
      automaticContinuationScope: 'RECOVERY_AND_READINESS_ONLY',
      automaticExecution: false,
      runnerConfigured: false,
      pending: Number(pending),
      interrupted: Number(interrupted),
      reconciliationRequired: Number(reconciliationRequired),
      currentLeases: Number(leases),
      lifecycleCounts: counts,
      workerId: this.#workerId,
      policy: clone(this.#schedulerPolicy)
    };
  }

  recoverInterrupted() {
    const recovered = [];
    const ids = this.#db.prepare('SELECT id FROM workflows ORDER BY id').all().map(x=>x.id);
    for (const id of ids) {
      let loaded; try { loaded = this.#load(id); } catch { continue; }
      const dead = loaded.state.steps.filter(step => {
        if (step.status !== 'running') return false;
        if (step.ownerHost !== os.hostname() || !Number.isSafeInteger(step.ownerPid)) return true;
        try { process.kill(step.ownerPid,0); return false; } catch (e) { return e.code === 'ESRCH'; }
      });
      if (!dead.length) continue;
      const updated = this.#transaction(() => {
        const { state, head } = this.#load(id);
        const affected = [];
        for (const step of state.steps) {
          if (!dead.some(x=>x.id===step.id) || step.status !== 'running') continue;
          step.status = 'uncertain';
          if (step.operationId) {
            this.#db.prepare("UPDATE operations SET status='UNCERTAIN',result_status='INTERRUPTED',updated_at=? WHERE operation_id=?")
              .run(new Date().toISOString(), step.operationId);
          }
          affected.push(step.id);
        }
        if (!affected.length) return null;
        state.lifecycleState = 'INTERRUPTED';
        state.scheduler.lastFailureCode = 'INTERRUPTED_EXECUTION';
        const result = this.#commit(state, head, 'interruption_recovered', { steps: affected });
        this.#db.prepare("UPDATE scheduler_jobs SET lifecycle='INTERRUPTED',last_failure='INTERRUPTED_EXECUTION',updated_at=? WHERE workflow=?")
          .run(new Date().toISOString(), id);
        return result;
      });
      if (updated) recovered.push(id);
    }
    return recovered;
  }
  capabilities() {
    const scheduler = this.schedulerStatus();
    return { revision: MODULE_REVISION, schema: STORE_SCHEMA, journal: 'delete', synchronous: 'extra',
      sqliteVersion: this.#db.prepare('SELECT sqlite_version() AS version').get().version,
      databaseSchemaVersion: this.#db.prepare('PRAGMA user_version').get().user_version,
      node: process.versions.node, automaticReplay: false,
      automaticContinuation: this.#schedulerPolicy.enabled,
      automaticContinuationScope: 'RECOVERY_AND_READINESS_ONLY', automaticExecution: false, runnerConfigured: false,
      scheduler: this.#schedulerPolicy.enabled, schedulerPolicy: clone(this.#schedulerPolicy),
      schedulerState: scheduler, rawArgumentsStored: false, rawOutputsStored: false,
      authenticationBoundary: false, newScopeBeyondConfiguredRoots: false,
      privateLocalStorage: true, executionProfilePersistence: true, projectBrainIntegration: true,
      operationJournal: true, oneWriterPerRoot: this.#schedulerPolicy.oneWriterPerRoot };
  }
  #transaction(fn) {
    this.#db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.#db.exec('COMMIT'); return value; }
    catch (e) { try { this.#db.exec('ROLLBACK'); } catch { /* preserve original exception */ } throw e; }
  }
  #load(id) {
    identifier(id);
    const row = this.#db.prepare('SELECT * FROM workflows WHERE id=?').get(id);
    if (!row) fail('WORKFLOW_NOT_FOUND');
    let state;
    try { state = JSON.parse(row.snapshot); } catch { fail('WORKFLOW_CORRUPT_SNAPSHOT'); }
    const events = this.#db.prepare('SELECT seq,body,digest FROM events WHERE workflow=? ORDER BY seq').all(id);
    if (!events.length || events.length > MAX_EVENTS || events.length !== row.revision) fail('WORKFLOW_CORRUPT_HISTORY');
    let prev = ZERO, last;
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (event.seq !== i + 1 || hash(event.body) !== event.digest) fail('WORKFLOW_CORRUPT_EVENT');
      try { last = JSON.parse(event.body); } catch { fail('WORKFLOW_CORRUPT_EVENT'); }
      if (last.schema !== 1 || last.id !== id || last.seq !== event.seq || last.previous !== prev) fail('WORKFLOW_CORRUPT_CHAIN');
      prev = event.digest;
    }
    if (row.head !== prev || state.id !== id || state.revision !== row.revision || jsonHash(state) !== last.snapshotSha256) fail('WORKFLOW_CORRUPT_SNAPSHOT');
    normalizeWorkflowState(state, { authority: this.#authority, executionProfile: this.#executionProfile, schedulerPolicy: this.#schedulerPolicy });
    return { state, head: prev, events };
  }
  #commit(state, previous, kind, data) {
    if (state.revision >= MAX_EVENTS) fail('WORKFLOW_EVENT_LIMIT');
    state.schema = 2;
    state.configSha256 = this.#configSha;
    state.revision++;
    state.updatedAt = new Date().toISOString();
    const snapshot = canonical(state);
    if (Buffer.byteLength(snapshot) > MAX_STATE) fail('WORKFLOW_STATE_LIMIT');
    const body = canonical({ schema: 1, id: state.id, seq: state.revision, at: state.updatedAt,
      previous, kind, data, snapshotSha256: hash(snapshot) });
    const digest = hash(body);
    this.#db.prepare('UPDATE workflows SET revision=?, head=?, snapshot=? WHERE id=?').run(state.revision, digest, snapshot, state.id);
    this.#db.prepare('INSERT INTO events(workflow,seq,body,digest) VALUES(?,?,?,?)').run(state.id, state.revision, body, digest);
    return { state: clone(state), headSha256: digest };
  }
  #mutate(id, expectedRevision, kind, action) {
    revision(expectedRevision);
    return this.#transaction(() => {
      const { state, head } = this.#load(id);
      if (state.revision !== expectedRevision) fail('WORKFLOW_REVISION_CONFLICT');
      const data = action(state);
      return this.#commit(state, head, kind, data);
    });
  }
  #identity(state) {
    const root = rootWithin(state.root, this.#roots);
    if (!samePath(state.root, root) || state.device !== this.#device) fail('WORKFLOW_IDENTITY_CHANGED');
    const auth = authorityCompatible(state.authority, this.#authority);
    if (!auth.ok) fail(auth.code);
  }
  create({ id, root, goal, acceptance, steps, executionProfile = undefined, brainPath = undefined, autoContinue = undefined, retryBudget = undefined }) {
    identifier(id); safeText(goal);
    root = rootWithin(root, this.#roots);
    if (!Array.isArray(acceptance) || !acceptance.length || acceptance.length > 50) fail('WORKFLOW_ACCEPTANCE_REQUIRED');
    acceptance.forEach(x => safeText(x, 2000));
    if (!Array.isArray(steps) || !steps.length || steps.length > 100) fail('WORKFLOW_STEPS_REQUIRED');
    const seen = new Set();
    const plan = steps.map((s, i) => {
      identifier(s.id); safeText(s.title, 500);
      if (seen.has(s.id)) fail('WORKFLOW_DUPLICATE_STEP');
      const deps = s.dependsOn ?? (i ? [steps[i - 1].id] : []);
      if (!Array.isArray(deps) || deps.length > 100 || deps.some(d => !seen.has(d)) || new Set(deps).size !== deps.length) fail('WORKFLOW_INVALID_DEPENDENCY');
      seen.add(s.id);
      return { id: s.id, title: s.title, dependsOn: [...deps], status: 'pending' };
    });
    return this.#transaction(() => {
      if (this.#db.prepare('SELECT id FROM workflows WHERE id=?').get(id)) fail('WORKFLOW_ALREADY_EXISTS');
      if (this.#db.prepare('SELECT COUNT(*) AS n FROM workflows').get().n >= 1000) fail('WORKFLOW_COUNT_LIMIT');
      const state = { schema: 2, id, root, device: this.#device, configSha256: this.#configSha,
        goal, acceptance, revision: 0, createdAt: new Date().toISOString(), updatedAt: null,
        steps: plan, notes: [], checkpoint: null, acceptanceStatus: 'UNVALIDATED',
        lifecycleState: 'CREATED',
        executionProfile: normalizeExecutionProfile(executionProfile ?? this.#executionProfile),
        authority: clone(this.#authority),
        scheduler: {
          enabled: autoContinue === undefined ? this.#schedulerPolicy.enabled : autoContinue === true,
          automaticContinuation: autoContinue === undefined ? this.#schedulerPolicy.enabled : autoContinue === true,
          retryBudget: Number.isSafeInteger(Number(retryBudget)) ? Math.max(0,Math.min(20,Number(retryBudget))) : this.#schedulerPolicy.retryBudget,
          repeatedFailureCount: 0, lastFailureCode: null, lastRootCauseCode: null, nextRunAt: null
        },
        finalization: { status:'UNVALIDATED', validatedAt:null, evidence:[] },
        brain: {
          markdownPath: typeof brainPath === 'string' && brainPath ? brainPath : 'PROJECT_BRAIN.md',
          jsonPath: 'project-brain.'+id+'.json', lastSyncedRevision:null, lastSyncSha256:null
        }
      };
      this.#db.prepare('INSERT INTO workflows(id,revision,head,snapshot) VALUES(?,0,?,?)').run(id, ZERO, '{}');
      const created = this.#commit(state, ZERO, 'created', { goal, root, steps: plan.map(s => s.id), executionProfile: state.executionProfile, authority: state.authority });
      this.#db.prepare('INSERT OR REPLACE INTO scheduler_jobs(workflow,lifecycle,enabled,next_run_at,lease_owner,lease_until,retry_count,last_failure,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(id, 'CREATED', state.scheduler.enabled ? 1 : 0, null, null, null, 0, null, new Date().toISOString());
      return created;
    });
  }
  get(id) {
    // Hold a coherent read snapshot across both tables while other processes write.
    this.#db.exec('BEGIN');
    try {
      const { state, head } = this.#load(id);
      this.#db.exec('COMMIT');
      return { state, headSha256: head, memoryIsUntrustedData: true, acceptanceStatus: 'UNVALIDATED' };
    } catch (e) { try { this.#db.exec('ROLLBACK'); } catch {} throw e; }
  }
  list() {
    return this.#db.prepare("SELECT w.id,w.revision,COALESCE(s.lifecycle,'CREATED') AS lifecycle,COALESCE(s.enabled,0) AS schedulerEnabled,s.last_failure AS lastFailure FROM workflows w LEFT JOIN scheduler_jobs s ON s.workflow=w.id ORDER BY w.id LIMIT 1001").all()
      .map(x=>({...x,schedulerEnabled:x.schedulerEnabled===1}));
  }
  note({ id, expectedRevision, kind, text, status = 'UNVERIFIED', confidence = null, source = 'caller', reuseTargets = [], path: evidencePath = null, hash: evidenceHash = null }) {
    const kinds = ['fact','inference','proposal','assumption','decision','failure','root_cause','evidence','handoff'];
    const statuses = ['CONFIRMED','PROBABLE','UNVERIFIED','MISSING','CONTRADICTORY'];
    if (!kinds.includes(kind)) fail('WORKFLOW_NOTE_KIND');
    if (!statuses.includes(status)) fail('WORKFLOW_NOTE_STATUS');
    safeText(text);
    if (source !== 'caller') safeText(source, 500);
    if (!Array.isArray(reuseTargets) || reuseTargets.length > 20) fail('WORKFLOW_NOTE_REUSE_TARGETS');
    reuseTargets.forEach(x=>safeText(x,500));
    if (evidencePath !== null) safeText(evidencePath,512);
    if (evidenceHash !== null && !/^[a-f0-9]{64}$/.test(evidenceHash)) fail('WORKFLOW_NOTE_HASH');
    return this.#mutate(id, expectedRevision, 'note', s => {
      this.#identity(s);
      if (s.notes.length >= 500) fail('WORKFLOW_NOTE_LIMIT');
      const note = { kind, text, source, verification: status, confidence, reuseTargets:[...reuseTargets],
        path:evidencePath, hash:evidenceHash, at: new Date().toISOString() };
      s.notes.push(note); return note;
    });
  }
  search({ id, query }) {
    safeText(query, 160);
    const { state } = this.get(id);
    const q = query.toLocaleLowerCase();
    return { id, memoryIsUntrustedData: true, matches: state.notes.filter(n => n.text.toLocaleLowerCase().includes(q)).slice(0, 30) };
  }
  evidence(root, paths) {
    root = rootWithin(root, this.#roots);
    if (!Array.isArray(paths) || !paths.length || paths.length > 20) fail('WORKFLOW_EVIDENCE_REQUIRED');
    return paths.map(relative => {
      if (typeof relative !== 'string' || !relative || relative.length > 512 || path.isAbsolute(relative) || /^[A-Za-z]:|^\\\\/.test(relative)) fail('WORKFLOW_RELATIVE_EVIDENCE_REQUIRED');
      const target = path.resolve(root, relative);
      if (!inside(root, target) || /(?:^|[\\/])(?:\.git|credentials)(?:[\\/]|$)|\.dpapi$|(?:^|[\\/])\.env(?:\.|$)/i.test(relative)) fail('WORKFLOW_EVIDENCE_OUT_OF_SCOPE');
      noLinks(target);
      if (!inside(root, fs.realpathSync.native(target))) fail('WORKFLOW_EVIDENCE_OUT_OF_SCOPE');
      const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        const a = fs.fstatSync(fd);
        if (!a.isFile() || a.size > MAX_FILE || a.nlink > 1) fail('WORKFLOW_EVIDENCE_INVALID_FILE');
        const h = createHash('sha256'), buffer = Buffer.alloc(65536);
        let bytes = 0, n;
        while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) {
          bytes += n;
          if (bytes > MAX_FILE) fail('WORKFLOW_EVIDENCE_SIZE');
          h.update(buffer.subarray(0, n));
        }
        const b = fs.fstatSync(fd);
        if (a.size !== b.size || a.mtimeMs !== b.mtimeMs || bytes !== a.size) fail('WORKFLOW_EVIDENCE_CHANGED_DURING_READ');
        return { path: path.relative(root, target), bytes, sha256: h.digest('hex') };
      } finally { fs.closeSync(fd); }
    });
  }
  resume(id) {
    const view = this.get(id), { state } = view;
    const blockers = [];
    try { this.#identity(state); } catch (e) { blockers.push(e.workflowCode ?? 'WORKFLOW_ROOT_UNAVAILABLE'); }
    const configDrift = state.configSha256 !== this.#configSha;
    const unresolved = state.steps.filter(s => ['running', 'uncertain'].includes(s.status));
    if (unresolved.length) blockers.push('WORKFLOW_OUTCOME_UNCERTAIN');
    if (state.lifecycleState === 'FINALIZING') blockers.push('WORKFLOW_FINALIZATION_INCOMPLETE');
    const evidence = [];
    for (const ref of state.checkpoint?.evidence ?? []) {
      try {
        const now = this.evidence(state.root, [ref.path])[0];
        const matches = now.sha256 === ref.sha256 && now.bytes === ref.bytes;
        evidence.push({ ...ref, matches });
        if (!matches) blockers.push('WORKFLOW_EVIDENCE_STALE');
      } catch { evidence.push({ ...ref, matches: false }); blockers.push('WORKFLOW_EVIDENCE_UNAVAILABLE'); }
    }
    const ready = s => s.status === 'pending' && s.dependsOn.every(d => ['recorded', 'verified', 'reconciled_applied'].includes(state.steps.find(x => x.id === d).status));
    const next = blockers.length ? null : state.steps.find(ready) ?? null;
    const terminalNotApplied = state.steps.some(s => s.status === 'reconciled_not_applied');
    if (terminalNotApplied && !next) blockers.push('WORKFLOW_REPLAN_REQUIRED');
    const schedulingEnabled = this.#schedulerPolicy.enabled && state.scheduler?.enabled === true;
    const derivedState = blockers.length ? (unresolved.length ? 'INTERRUPTED' : 'BLOCKED')
      : next ? 'RESUMING' : (state.lifecycleState === 'COMPLETED' ? 'COMPLETED' : 'WAITING');
    return { ...view, blockers: [...new Set(blockers)], unresolved: unresolved.map(s => s.id), evidence,
      readyForNextStep: blockers.length === 0 && !!next, nextStep: next?.id ?? null,
      nextAction: state.checkpoint?.nextAction ?? (next ? next.title : 'Inspect the project and plan before taking the next step.'),
      automaticReplay: false, automaticContinuation: schedulingEnabled, schedulingEnabled,
      lifecycleState: derivedState, persistedLifecycleState: state.lifecycleState,
      configDrift, currentConfigSha256: this.#configSha,
      executionProfile: clone(state.executionProfile), modelProfileRequested: clone(state.executionProfile),
      acceptanceStatus: state.acceptanceStatus ?? 'UNVALIDATED' };
  }
  async call({ id, stepId, expectedRevision, tool, arguments: args = {} }, { dispatch, validate }) {
    identifier(stepId); safeText(tool, 128);
    if (typeof dispatch !== 'function' || typeof validate !== 'function') fail('WORKFLOW_HOST_DISPATCH_REQUIRED');
    const argsRaw = canonical(args);
    if (Buffer.byteLength(argsRaw) > 128 * 1024) fail('WORKFLOW_ARGUMENT_LIMIT');
    const view = this.get(id), { state } = view; this.#identity(state);
    const fingerprint = jsonHash({ tool, args, root: state.root, device: state.device, authority: state.authority });
    const prior = state.steps.find(s => s.id === stepId);
    if (!prior) fail('WORKFLOW_STEP_NOT_FOUND');
    if (prior.callHash === fingerprint && ['recorded', 'verified', 'reconciled_applied'].includes(prior.status)) {
      return { replayed: false, cachedReceipt: true, receipt: prior.receipt ?? null, revision: state.revision };
    }
    if (prior.status !== 'pending') fail('WORKFLOW_OUTCOME_REQUIRES_RECONCILIATION');
    const gate = this.resume(id);
    if (gate.blockers.length) fail('WORKFLOW_RESUME_BLOCKED');
    await validate(tool, args, clone(state));

    const classification = classifyTool(tool,args);
    const verification = reconciliationPlan(tool,args);
    const inputHash = hash(argsRaw);
    const operationId = randomUUID(), attemptId = randomUUID();
    const idempotencyKey = hash(canonical({ workflowId:id, stepId, tool, inputHash }));
    const owner = this.#workerId + ':' + operationId;
    const now = new Date().toISOString();
    const expires = new Date(Date.now()+Math.max(this.#schedulerPolicy.leaseMs,30000)).toISOString();

    const prepared = this.#mutate(id, expectedRevision, 'intent', s => {
      this.#identity(s);
      if (s.steps.some(x => ['running', 'uncertain'].includes(x.status))) fail('WORKFLOW_BUSY_OR_UNCERTAIN');
      const step = s.steps.find(x => x.id === stepId);
      if (!step || step.status !== 'pending') fail('WORKFLOW_STEP_NOT_PENDING');
      if (step.dependsOn.some(d => !['recorded','verified','reconciled_applied'].includes(s.steps.find(x => x.id === d).status))) fail('WORKFLOW_DEPENDENCY_NOT_READY');

      this.#db.prepare('DELETE FROM root_leases WHERE expires_at <= ?').run(now);
      const lease = this.#db.prepare('SELECT workflow,owner FROM root_leases WHERE root=?').get(s.root);
      if (lease && lease.workflow !== id) fail('WORKFLOW_ROOT_LEASED');
      this.#db.prepare('INSERT OR REPLACE INTO root_leases(root,workflow,owner,expires_at,revision) VALUES(?,?,?,?,?)')
        .run(s.root,id,owner,expires,expectedRevision);

      this.#db.prepare('INSERT INTO operations(operation_id,workflow,step_id,attempt_id,idempotency_key,classification,status,tool,input_hash,verification,pre_state_hash,result_status,exit_code,post_state_hash,receipt,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(operationId,id,stepId,attemptId,idempotencyKey,classification,'PREPARED',tool,inputHash,JSON.stringify(verification),
          view.headSha256,null,null,null,null,now,now);

      Object.assign(step, {
        status:'running', tool, callHash:fingerprint, operationId, attemptId, idempotencyKey,
        classification, inputHash, instance:this.#instance, ownerPid:process.pid, ownerHost:os.hostname(), startedAt:now
      });
      s.lifecycleState='RUNNING';
      return { stepId, tool, callHash:fingerprint, operationId, attemptId, idempotencyKey,
        classification, inputHash, preStateHash:view.headSha256, operationStatus:'PREPARED', rawArgumentsStored:false };
    });

    this.#db.prepare("UPDATE operations SET status='EXECUTING',updated_at=? WHERE operation_id=?").run(new Date().toISOString(),operationId);
    this.#db.prepare("UPDATE scheduler_jobs SET lifecycle='RUNNING',lease_owner=?,lease_until=?,updated_at=? WHERE workflow=?")
      .run(owner,expires,new Date().toISOString(),id);

    let renew = setInterval(() => {
      try {
        const until = new Date(Date.now()+Math.max(this.#schedulerPolicy.leaseMs,30000)).toISOString();
        this.#db.prepare('UPDATE root_leases SET expires_at=? WHERE root=? AND workflow=? AND owner=?').run(until,state.root,id,owner);
        this.#db.prepare('UPDATE scheduler_jobs SET lease_until=?,updated_at=? WHERE workflow=? AND lease_owner=?')
          .run(until,new Date().toISOString(),id,owner);
      } catch { /* recovery will reconcile if persistence becomes unavailable */ }
    }, Math.max(2000,Math.floor(Math.max(this.#schedulerPolicy.leaseMs,30000)/3)));
    renew.unref?.();

    let result, receipt, failure = false, finished = null;
    try {
      try { result = await dispatch(tool, args, clone(state)); receipt = receiptFields(result); failure = badResult(result); }
      catch (e) {
        failure = true;
        receipt = { exception:true, errorCode:/^[A-Z][A-Z0-9_]{1,79}$/.test(e.workflowCode ?? '') ? e.workflowCode : 'TOOL_EXCEPTION', outputStored:false };
      }
      receipt = { ...receipt, operationId, attemptId, idempotencyKey, classification, inputHash, preStateHash:view.headSha256, postStateHash:null };
      finished = this.#transaction(() => {
        const { state:s, head } = this.#load(id), step = s.steps.find(x => x.id === stepId);
        if (step.status !== 'running' || step.operationId !== operationId || step.callHash !== fingerprint) fail('WORKFLOW_COMPLETION_CONFLICT');
        const operationStatus = failure ? 'UNCERTAIN' : (classification === 'READ_ONLY' ? 'VERIFIED' : 'EXECUTED');
        Object.assign(step, { status: failure ? 'uncertain' : (classification === 'READ_ONLY' ? 'verified' : 'recorded'), receipt, endedAt:new Date().toISOString() });
        if (failure) {
          const code=receipt.errorCode ?? 'OPERATION_UNCERTAIN';
          s.scheduler.repeatedFailureCount = s.scheduler.lastRootCauseCode === code
            ? Number(s.scheduler.repeatedFailureCount ?? 0) + 1 : 1;
          s.scheduler.lastRootCauseCode = code;
          const budget=Number.isSafeInteger(Number(s.scheduler.retryBudget)) ? Number(s.scheduler.retryBudget) : this.#schedulerPolicy.retryBudget;
          s.scheduler.lastFailureCode = s.scheduler.repeatedFailureCount > budget ? 'BLOCKED_REQUIRES_REASSESSMENT' : code;
          s.lifecycleState = s.scheduler.repeatedFailureCount > budget ? 'BLOCKED' : 'INTERRUPTED';
        } else {
          s.lifecycleState='RUNNING';
          s.scheduler.repeatedFailureCount=0;
          s.scheduler.lastFailureCode=null;s.scheduler.lastRootCauseCode=null;
        }
        this.#db.prepare('UPDATE operations SET status=?,result_status=?,exit_code=?,post_state_hash=?,receipt=?,updated_at=? WHERE operation_id=?')
          .run(operationStatus, failure?'UNCERTAIN':'EXECUTED',
            typeof receipt.exitCode==='number'?receipt.exitCode:null,
            (!failure && classification==='READ_ONLY')?(receipt.resultSha256??null):null,
            JSON.stringify(receipt),new Date().toISOString(),operationId);
        const committed = this.#commit(s,head,'receipt',{stepId,operationId,status:step.status,operationStatus,receipt});
        this.#db.prepare('UPDATE scheduler_jobs SET lifecycle=?,retry_count=?,last_failure=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE workflow=?')
          .run(s.lifecycleState,Number(s.scheduler.repeatedFailureCount??0),s.scheduler.lastFailureCode,new Date().toISOString(),id);
        this.#db.prepare('DELETE FROM root_leases WHERE root=? AND workflow=? AND owner=?').run(s.root,id,owner);
        return committed;
      });
    } finally {
      clearInterval(renew);
    }
    return { replayed:false,cachedReceipt:false,outcome:failure?'UNCERTAIN':'RECORDED_NOT_VALIDATED',
      revision:finished.state.revision,receipt,result:result??null,acceptanceStatus:'UNVALIDATED',
      operation:{operationId,attemptId,idempotencyKey,classification,status:failure?'UNCERTAIN':(classification==='READ_ONLY'?'VERIFIED':'EXECUTED')} };
  }
  reconcile({ id, stepId, expectedRevision, outcome, files, explanation }) {
    if (!['applied', 'not_applied'].includes(outcome)) fail('WORKFLOW_RECONCILIATION_OUTCOME');
    identifier(stepId); safeText(explanation, 4000);
    const { state } = this.get(id); this.#identity(state);
    const evidence = this.evidence(state.root, files);
    const evidenceHash = hash(canonical(evidence));
    return this.#mutate(id, expectedRevision, 'reconciled', s => {
      const step = s.steps.find(x => x.id === stepId);
      if (!step || !['running', 'uncertain'].includes(step.status)) fail('WORKFLOW_NOT_UNCERTAIN');
      if (step.status === 'running') {
        if (step.ownerHost !== os.hostname() || !Number.isSafeInteger(step.ownerPid)) fail('WORKFLOW_OWNER_UNKNOWN');
        let alive = true;
        try { process.kill(step.ownerPid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
        if (alive) fail('WORKFLOW_STILL_RUNNING');
      }
      step.status = 'reconciled_' + outcome;
      step.reconciliation = { outcome, explanation, evidence, source: 'caller-attestation', acceptance: 'UNVALIDATED' };
      if (step.operationId) {
        this.#db.prepare('UPDATE operations SET status=?,post_state_hash=?,updated_at=? WHERE operation_id=?')
          .run(outcome === 'applied' ? 'VERIFIED' : 'NOT_APPLIED', evidenceHash, new Date().toISOString(), step.operationId);
      }
      s.lifecycleState = outcome === 'applied' ? 'RUNNING' : 'BLOCKED';
      s.scheduler.lastFailureCode = outcome === 'applied' ? null : 'WORKFLOW_REPLAN_REQUIRED';
      this.#db.prepare('UPDATE scheduler_jobs SET lifecycle=?,last_failure=?,updated_at=? WHERE workflow=?')
        .run(s.lifecycleState,s.scheduler.lastFailureCode,new Date().toISOString(),id);
      return { stepId, operationId:step.operationId ?? null, evidenceHash, ...step.reconciliation };
    });
  }

  async reconcileAutomatically(id, { verify }) {
    if (typeof verify !== 'function') fail('WORKFLOW_VERIFIER_REQUIRED');
    const view=this.get(id), state=view.state; this.#identity(state);
    const step=state.steps.find(x=>x.status==='uncertain' && x.operationId);
    if (!step) return { id, changed:false, reason:'NO_UNCERTAIN_OPERATION' };
    const op=this.#db.prepare('SELECT * FROM operations WHERE operation_id=? AND workflow=?').get(step.operationId,id);
    if (!op) fail('WORKFLOW_OPERATION_MISSING');
    if (['VERIFIED','NOT_APPLIED','CONFLICT'].includes(op.status)) {
      return {id,changed:false,status:op.status,reason:'RECONCILIATION_ALREADY_TERMINAL'};
    }
    let plan={strategy:'MANUAL_OR_REMOTE_STATE',classification:op.classification};
    try { if (op.verification) plan=JSON.parse(op.verification); } catch { fail('WORKFLOW_OPERATION_CORRUPT'); }
    const verdict=await verify(clone(plan),{workflowId:id,stepId:step.id,tool:op.tool,classification:op.classification,inputHash:op.input_hash});
    const status=verdict?.status;
    if (!['APPLIED','NOT_APPLIED','CONFLICT','UNAVAILABLE'].includes(status)) fail('WORKFLOW_VERIFIER_RESULT');
    if (status==='UNAVAILABLE') return {id,changed:false,status};
    const evidenceHash=/^[a-f0-9]{64}$/.test(verdict?.evidenceHash??'')?verdict.evidenceHash:null;
    const summary=typeof verdict?.summary==='string' && verdict.summary ? safeText(verdict.summary,1000) : status;
    const updated=this.#mutate(id,state.revision,'auto_reconciled',s=>{
      const current=s.steps.find(x=>x.id===step.id);
      if (!current || current.status!=='uncertain' || current.operationId!==op.operation_id) fail('WORKFLOW_RECONCILIATION_CONFLICT');
      if (status==='APPLIED') {
        current.status='reconciled_applied';
        current.reconciliation={outcome:'applied',explanation:summary,evidenceHash,source:'automatic-read-only-verification',acceptance:'UNVALIDATED'};
        s.lifecycleState='RESUMING';s.scheduler.lastFailureCode=null;
        this.#db.prepare("UPDATE operations SET status='VERIFIED',post_state_hash=?,updated_at=? WHERE operation_id=?").run(evidenceHash,new Date().toISOString(),op.operation_id);
      } else if (status==='NOT_APPLIED') {
        current.status='reconciled_not_applied';
        current.reconciliation={outcome:'not_applied',explanation:summary,evidenceHash,source:'automatic-read-only-verification',acceptance:'UNVALIDATED'};
        s.lifecycleState='BLOCKED';s.scheduler.lastFailureCode='WORKFLOW_REPLAN_REQUIRED';
        this.#db.prepare("UPDATE operations SET status='NOT_APPLIED',post_state_hash=?,updated_at=? WHERE operation_id=?").run(evidenceHash,new Date().toISOString(),op.operation_id);
      } else {
        current.reconciliation={outcome:'conflict',explanation:summary,evidenceHash,source:'automatic-read-only-verification',acceptance:'UNVALIDATED'};
        s.lifecycleState='BLOCKED';s.scheduler.lastFailureCode='WORKFLOW_RECONCILIATION_CONFLICT';
        this.#db.prepare("UPDATE operations SET status='CONFLICT',post_state_hash=?,updated_at=? WHERE operation_id=?").run(evidenceHash,new Date().toISOString(),op.operation_id);
      }
      this.#db.prepare('UPDATE scheduler_jobs SET lifecycle=?,last_failure=?,updated_at=? WHERE workflow=?')
        .run(s.lifecycleState,s.scheduler.lastFailureCode,new Date().toISOString(),id);
      return {stepId:current.id,operationId:op.operation_id,status,evidenceHash,summary};
    });
    return {id,changed:true,status,revision:updated.state.revision,state:updated.state};
  }

  checkpoint({ id, expectedRevision, files, nextAction, summary }) {
    safeText(nextAction, 2000); safeText(summary, 4000);
    const { state } = this.get(id); this.#identity(state);
    const evidence = this.evidence(state.root, files);
    const committed = this.#mutate(id, expectedRevision, 'checkpoint', s => {
      this.#identity(s);
      s.checkpoint = { evidence, nextAction, summary, at: new Date().toISOString(), revision: expectedRevision + 1 };
      if (s.lifecycleState !== 'COMPLETED') {
        s.lifecycleState = 'WAITING';
        this.#db.prepare('UPDATE scheduler_jobs SET lifecycle=?,enabled=?,next_run_at=?,updated_at=? WHERE workflow=?')
          .run(s.lifecycleState,s.scheduler.enabled?1:0,s.scheduler.nextRunAt,new Date().toISOString(),id);
      }
      return clone(s.checkpoint);
    });
    let brainSync=null, brainError=null;
    try { brainSync=syncProjectBrain(committed.state); }
    catch(e) { brainError=e.message; }
    return {...committed,brainSync,brainError};
  }

  finalize({ id, expectedRevision, acceptanceResults, files, summary }) {
    revision(expectedRevision);
    safeText(summary,4000);
    const initial=this.get(id), state=initial.state; this.#identity(state);
    if (state.revision !== expectedRevision) fail('WORKFLOW_REVISION_CONFLICT');
    if (!Array.isArray(acceptanceResults) || acceptanceResults.length !== state.acceptance.length || acceptanceResults.some(x=>x!==true)) {
      fail('WORKFLOW_ACCEPTANCE_UNPROVEN');
    }
    const incomplete=state.steps.filter(s=>!['recorded','verified','reconciled_applied'].includes(s.status));
    if (incomplete.length) fail('WORKFLOW_STEPS_INCOMPLETE');
    const evidence=this.evidence(state.root,files);
    let finalizing;
    if (state.lifecycleState === 'FINALIZING') {
      if (state.finalization?.status !== 'VALIDATING') fail('WORKFLOW_FINALIZATION_STATE');
      finalizing={state,headSha256:initial.headSha256};
    } else {
      finalizing=this.#mutate(id,expectedRevision,'finalization_started',s=>{
        s.lifecycleState='FINALIZING';s.acceptanceStatus='VALIDATING';
        s.finalization={status:'VALIDATING',validatedAt:null,evidence,summary,acceptanceResults:[...acceptanceResults]};
        this.#db.prepare("UPDATE scheduler_jobs SET lifecycle='FINALIZING',updated_at=? WHERE workflow=?").run(new Date().toISOString(),id);
        return {acceptanceResults:[...acceptanceResults],evidence,summary};
      });
    }
    const prospective=clone(finalizing.state);
    prospective.lifecycleState='COMPLETED';prospective.acceptanceStatus='PASS';
    prospective.finalization={...prospective.finalization,status:'PASS',validatedAt:new Date().toISOString()};
    prospective.revision=finalizing.state.revision+1;prospective.updatedAt=new Date().toISOString();
    const brainSync=syncProjectBrain(prospective);
    const done=this.#mutate(id,finalizing.state.revision,'finalized',s=>{
      s.lifecycleState='COMPLETED';s.acceptanceStatus='PASS';
      s.finalization={...s.finalization,status:'PASS',validatedAt:prospective.finalization.validatedAt,brainSync};
      s.brain.lastSyncedRevision=s.revision+1;s.brain.lastSyncSha256=brainSync.jsonSha256;
      this.#db.prepare("UPDATE scheduler_jobs SET lifecycle='COMPLETED',enabled=0,last_failure=NULL,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE workflow=?")
        .run(new Date().toISOString(),id);
      this.#db.prepare('DELETE FROM root_leases WHERE workflow=?').run(id);
      return {acceptanceStatus:'PASS',evidence,brainSync};
    });
    return {...done,brainSync,acceptanceStatus:'PASS'};
  }

  health() {
    const integrity=this.#db.prepare('PRAGMA quick_check').get().quick_check;
    const scheduler=this.schedulerStatus();
    return {
      ok:integrity==='ok',schema:STORE_SCHEMA,databaseSchemaVersion:this.#db.prepare('PRAGMA user_version').get().user_version,module:MODULE_REVISION,databaseIntegrity:integrity,
      scheduler,executionProfilePersistence:true,projectBrainIntegration:true,
      configSha256:this.#configSha,authority:clone(this.#authority)
    };
  }

  revise({ id, expectedRevision, goal, acceptance, reason }) {
    revision(expectedRevision);safeText(reason,1000);
    if (goal !== undefined) safeText(goal);
    if (acceptance !== undefined) {
      if (!Array.isArray(acceptance) || acceptance.length < 1 || acceptance.length > 50) fail('WORKFLOW_ACCEPTANCE_REQUIRED');
      acceptance.forEach(x=>safeText(x,2000));
    }
    return this.#mutate(id,expectedRevision,'revised',s=>{
      this.#identity(s);
      if (s.lifecycleState==='COMPLETED' || s.lifecycleState==='CANCELLED') fail('WORKFLOW_TERMINAL');
      const before={goal:s.goal,acceptance:[...s.acceptance]};
      if (goal !== undefined) s.goal=goal;
      if (acceptance !== undefined) s.acceptance=[...acceptance];
      s.acceptanceStatus='UNVALIDATED';
      s.finalization={status:'UNVALIDATED',validatedAt:null,evidence:[]};
      s.lifecycleState='WAITING';
      s.scheduler.lastFailureCode=null;s.scheduler.lastRootCauseCode=null;s.scheduler.repeatedFailureCount=0;
      this.#db.prepare("UPDATE scheduler_jobs SET lifecycle='WAITING',retry_count=0,last_failure=NULL,updated_at=? WHERE workflow=?")
        .run(new Date().toISOString(),id);
      return {reason,before,after:{goal:s.goal,acceptance:[...s.acceptance]}};
    });
  }

  control({ id, expectedRevision, action, reason }) {
    if (!['pause','resume','cancel'].includes(action)) fail('WORKFLOW_CONTROL_ACTION');
    safeText(reason,1000);
    const result=this.#mutate(id,expectedRevision,'control',s=>{
      this.#identity(s);
      if (s.lifecycleState==='COMPLETED') fail('WORKFLOW_ALREADY_COMPLETED');
      if (action==='pause') {
        s.lifecycleState='WAITING';s.scheduler.enabled=false;s.scheduler.automaticContinuation=false;
      } else if (action==='resume') {
        if (s.lifecycleState==='CANCELLED') fail('WORKFLOW_CANCELLED');
        s.lifecycleState='RESUMING';s.scheduler.enabled=true;s.scheduler.automaticContinuation=true;s.scheduler.lastFailureCode=null;
      } else {
        s.lifecycleState='CANCELLED';s.scheduler.enabled=false;s.scheduler.automaticContinuation=false;
      }
      this.#db.prepare('UPDATE scheduler_jobs SET lifecycle=?,enabled=?,last_failure=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE workflow=?')
        .run(s.lifecycleState,s.scheduler.enabled?1:0,s.scheduler.lastFailureCode,new Date().toISOString(),id);
      if(action!=='resume')this.#db.prepare('DELETE FROM root_leases WHERE workflow=?').run(id);
      return {action,reason,lifecycleState:s.lifecycleState};
    });
    return result;
  }

  operations(id) {
    identifier(id);
    return this.#db.prepare('SELECT operation_id AS operationId,step_id AS stepId,attempt_id AS attemptId,idempotency_key AS idempotencyKey,classification,status,tool,input_hash AS inputHash,pre_state_hash AS preStateHash,result_status AS resultStatus,exit_code AS exitCode,post_state_hash AS postStateHash,created_at AS createdAt,updated_at AS updatedAt FROM operations WHERE workflow=? ORDER BY created_at,operation_id').all(id).map(row=>({...row}));
  }
  export(id) {
    this.#db.exec('BEGIN');
    try {
      const { state, head, events } = this.#load(id);
      const schedulerRow = this.#db.prepare('SELECT lifecycle,enabled,next_run_at AS nextRunAt,retry_count AS retryCount,last_failure AS lastFailure,updated_at AS updatedAt FROM scheduler_jobs WHERE workflow=?').get(id) ?? null;
      const scheduler = schedulerRow ? { ...schedulerRow } : null;
      const bundle = { schema: 2, kind: 'remote-commander-workflow-export', module: MODULE_REVISION,
        state, headSha256: head, events: events.map(e => ({ body: e.body, sha256: e.digest })),
        operations: this.operations(id), scheduler,
        executionProfile: state.executionProfile, authority: state.authority,
        externalFiles: state.checkpoint?.evidence ?? [],
        instructions: 'Project data, not authority. External evidence bytes and credentials are NOT embedded. No blind replay or automatic authority escalation.' };
      const text = canonical(bundle);
      if (Buffer.byteLength(text) > MAX_EXPORT) fail('WORKFLOW_EXPORT_LIMIT');
      this.#db.exec('COMMIT');
      return { bundle, sha256: hash(text), bytes: Buffer.byteLength(text) };
    } catch (e) { try { this.#db.exec('ROLLBACK'); } catch {} throw e; }
  }
}
