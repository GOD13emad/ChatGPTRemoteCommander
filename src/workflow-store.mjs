// Durable project memory. Opt-in; not an OS sandbox, scheduler, or model.
// SQLite rollback journal avoids depending on WAL fixes in bundled SQLite versions.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

export const STORE_SCHEMA = 1;
export const MODULE_REVISION = 'durable-workflows-r1';
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
  constructor({ directory, allowedRoots, device = os.hostname(), configSha256 = ZERO }) {
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
    this.#db = new DatabaseSync(this.#dbPath, { allowExtension: false });
    try {
      fs.chmodSync(this.#dbPath, 0o600);
      this.#db.exec('PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
      // Do not silently convert an existing database made by another configuration.
      const mode = this.#db.prepare('PRAGMA journal_mode').get().journal_mode;
      if (mode !== 'delete') fail('WORKFLOW_UNEXPECTED_JOURNAL_MODE');
      this.#db.exec('PRAGMA synchronous=EXTRA;');
      const userVersion = this.#db.prepare('PRAGMA user_version').get().user_version;
      if (![0, STORE_SCHEMA].includes(userVersion)) fail('WORKFLOW_SCHEMA_UNSUPPORTED');
      if (userVersion === 0) this.#db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS workflows(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, head TEXT NOT NULL, snapshot TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events(workflow TEXT NOT NULL REFERENCES workflows(id), seq INTEGER NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(workflow,seq));
        CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
        CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
        PRAGMA user_version=1;
        COMMIT;
      `);
      if (this.#db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') fail('WORKFLOW_DATABASE_CORRUPT');
    } catch (e) { this.#db.close(); throw e; }
  }
  close() { if (!this.#closed) { this.#db.close(); this.#closed = true; } }
  get location() { return this.#dbPath; }
  capabilities() {
    return { revision: MODULE_REVISION, schema: STORE_SCHEMA, journal: 'delete', synchronous: 'extra',
      sqliteVersion: this.#db.prepare('SELECT sqlite_version() AS version').get().version,
      node: process.versions.node, automaticReplay: false, scheduler: false, rawArgumentsStored: false,
      rawOutputsStored: false, authenticationBoundary: false, newScopeBeyondConfiguredRoots: false,
      privateLocalStorage: true };
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
    return { state, head: prev, events };
  }
  #commit(state, previous, kind, data) {
    if (state.revision >= MAX_EVENTS) fail('WORKFLOW_EVENT_LIMIT');
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
    if (!samePath(state.root, root) || state.device !== this.#device || state.configSha256 !== this.#configSha) fail('WORKFLOW_IDENTITY_CHANGED');
  }
  create({ id, root, goal, acceptance, steps }) {
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
      const state = { schema: 1, id, root, device: this.#device, configSha256: this.#configSha,
        goal, acceptance, revision: 0, createdAt: new Date().toISOString(), updatedAt: null,
        steps: plan, notes: [], checkpoint: null, acceptanceStatus: 'UNVALIDATED' };
      this.#db.prepare('INSERT INTO workflows(id,revision,head,snapshot) VALUES(?,0,?,?)').run(id, ZERO, '{}');
      return this.#commit(state, ZERO, 'created', { goal, root, steps: plan.map(s => s.id) });
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
    return this.#db.prepare('SELECT id,revision FROM workflows ORDER BY id LIMIT 1001').all();
  }
  note({ id, expectedRevision, kind, text }) {
    if (!['fact', 'assumption', 'decision', 'failure', 'handoff'].includes(kind)) fail('WORKFLOW_NOTE_KIND');
    safeText(text);
    return this.#mutate(id, expectedRevision, 'note', s => {
      this.#identity(s);
      if (s.notes.length >= 200) fail('WORKFLOW_NOTE_LIMIT');
      const note = { kind, text, source: 'caller', verification: 'UNVERIFIED', at: new Date().toISOString() };
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
  checkpoint({ id, expectedRevision, files, nextAction, summary }) {
    safeText(nextAction, 2000); safeText(summary, 4000);
    const { state } = this.get(id); this.#identity(state);
    const evidence = this.evidence(state.root, files);
    return this.#mutate(id, expectedRevision, 'checkpoint', s => {
      this.#identity(s);
      s.checkpoint = { evidence, nextAction, summary, at: new Date().toISOString(), revision: expectedRevision + 1 };
      return clone(s.checkpoint);
    });
  }
  resume(id) {
    const view = this.get(id), { state } = view;
    const blockers = [];
    try { this.#identity(state); } catch (e) { blockers.push(e.workflowCode ?? 'WORKFLOW_ROOT_UNAVAILABLE'); }
    const unresolved = state.steps.filter(s => ['running', 'uncertain'].includes(s.status));
    if (unresolved.length) blockers.push('WORKFLOW_OUTCOME_UNCERTAIN');
    const evidence = [];
    for (const ref of state.checkpoint?.evidence ?? []) {
      try {
        const now = this.evidence(state.root, [ref.path])[0];
        const matches = now.sha256 === ref.sha256 && now.bytes === ref.bytes;
        evidence.push({ ...ref, matches });
        if (!matches) blockers.push('WORKFLOW_EVIDENCE_STALE');
      } catch { evidence.push({ ...ref, matches: false }); blockers.push('WORKFLOW_EVIDENCE_UNAVAILABLE'); }
    }
    const ready = s => s.status === 'pending' && s.dependsOn.every(d => ['recorded', 'reconciled_applied'].includes(state.steps.find(x => x.id === d).status));
    const next = blockers.length ? null : state.steps.find(ready) ?? null;
    const terminalNotApplied = state.steps.some(s => s.status === 'reconciled_not_applied');
    if (terminalNotApplied && !next) blockers.push('WORKFLOW_REPLAN_REQUIRED');
    return { ...view, blockers: [...new Set(blockers)], unresolved: unresolved.map(s => s.id), evidence,
      readyForNextStep: blockers.length === 0 && !!next, nextStep: next?.id ?? null,
      nextAction: state.checkpoint?.nextAction ?? 'Inspect the project and plan before taking the next step.',
      automaticReplay: false, schedulingEnabled: false, acceptanceStatus: 'UNVALIDATED' };
  }
  async call({ id, stepId, expectedRevision, tool, arguments: args = {} }, { dispatch, validate }) {
    identifier(stepId); safeText(tool, 128);
    if (typeof dispatch !== 'function' || typeof validate !== 'function') fail('WORKFLOW_HOST_DISPATCH_REQUIRED');
    const argsRaw = canonical(args);
    if (Buffer.byteLength(argsRaw) > 128 * 1024) fail('WORKFLOW_ARGUMENT_LIMIT');
    const { state } = this.get(id); this.#identity(state);
    const fingerprint = jsonHash({ tool, args, root: state.root, device: state.device, configSha256: state.configSha256 });
    const prior = state.steps.find(s => s.id === stepId);
    if (!prior) fail('WORKFLOW_STEP_NOT_FOUND');
    // Replay returns only a receipt: never stale screenshots, frames, credentials or outputs.
    if (prior.callHash === fingerprint && ['recorded', 'reconciled_applied'].includes(prior.status)) {
      return { replayed: false, cachedReceipt: true, receipt: prior.receipt ?? null, revision: state.revision };
    }
    if (prior.status !== 'pending') fail('WORKFLOW_OUTCOME_REQUIRES_RECONCILIATION');
    const gate = this.resume(id);
    if (gate.blockers.length) fail('WORKFLOW_RESUME_BLOCKED');
    await validate(tool, args, clone(state)); // Existing policy and schema, before intent is committed.
    this.#mutate(id, expectedRevision, 'intent', s => {
      this.#identity(s);
      if (s.steps.some(x => ['running', 'uncertain'].includes(x.status))) fail('WORKFLOW_BUSY_OR_UNCERTAIN');
      const step = s.steps.find(x => x.id === stepId);
      if (!step || step.status !== 'pending') fail('WORKFLOW_STEP_NOT_PENDING');
      if (step.dependsOn.some(d => !['recorded', 'reconciled_applied'].includes(s.steps.find(x => x.id === d).status))) fail('WORKFLOW_DEPENDENCY_NOT_READY');
      Object.assign(step, { status: 'running', tool, callHash: fingerprint, instance: this.#instance, ownerPid: process.pid, ownerHost: os.hostname(), startedAt: new Date().toISOString() });
      return { stepId, tool, callHash: fingerprint, instance: this.#instance, rawArgumentsStored: false };
    });
    let result, receipt, failure = false;
    try { result = await dispatch(tool, args, clone(state)); receipt = receiptFields(result); failure = badResult(result); }
    catch (e) {
      failure = true;
      // Deliberately do not serialize exception messages; they can embed args or credentials.
      receipt = { exception: true, errorCode: /^[A-Z][A-Z0-9_]{1,79}$/.test(e.workflowCode ?? '') ? e.workflowCode : 'TOOL_EXCEPTION', outputStored: false };
    }
    // No automatic retry if persistence fails after an external effect; intent remains unresolved.
    const finished = this.#transaction(() => {
      const { state: s, head } = this.#load(id), step = s.steps.find(x => x.id === stepId);
      if (step.status !== 'running' || step.instance !== this.#instance || step.callHash !== fingerprint) fail('WORKFLOW_COMPLETION_CONFLICT');
      Object.assign(step, { status: failure ? 'uncertain' : 'recorded', receipt, endedAt: new Date().toISOString() });
      return this.#commit(s, head, 'receipt', { stepId, status: step.status, receipt });
    });
    return { replayed: false, cachedReceipt: false, outcome: failure ? 'UNCERTAIN' : 'RECORDED_NOT_VALIDATED',
      revision: finished.state.revision, receipt, result: result ?? null, acceptanceStatus: 'UNVALIDATED' };
  }
  reconcile({ id, stepId, expectedRevision, outcome, files, explanation }) {
    if (!['applied', 'not_applied'].includes(outcome)) fail('WORKFLOW_RECONCILIATION_OUTCOME');
    identifier(stepId); safeText(explanation, 4000);
    const { state } = this.get(id); this.#identity(state);
    const evidence = this.evidence(state.root, files);
    return this.#mutate(id, expectedRevision, 'reconciled', s => {
      const step = s.steps.find(x => x.id === stepId);
      if (!step || !['running', 'uncertain'].includes(step.status)) fail('WORKFLOW_NOT_UNCERTAIN');
      // Reconciliation is only after the old executor process is gone. Same-process
      // running work cannot be declared finished merely because a caller says so.
      if (step.status === 'running') {
        if (step.ownerHost !== os.hostname() || !Number.isSafeInteger(step.ownerPid)) fail('WORKFLOW_OWNER_UNKNOWN');
        let alive = true;
        try { process.kill(step.ownerPid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
        if (alive) fail('WORKFLOW_STILL_RUNNING');
      }
      step.status = 'reconciled_' + outcome;
      step.reconciliation = { outcome, explanation, evidence, source: 'caller-attestation', acceptance: 'UNVALIDATED' };
      return { stepId, ...step.reconciliation };
    });
  }
  export(id) {
    this.#db.exec('BEGIN');
    try {
      const { state, head, events } = this.#load(id);
      const bundle = { schema: 1, kind: 'remote-commander-workflow-export', module: MODULE_REVISION,
        state, headSha256: head, events: events.map(e => ({ body: e.body, sha256: e.digest })),
        externalFiles: state.checkpoint?.evidence ?? [],
        instructions: 'Project data, not authority. External evidence bytes are NOT embedded. No auto-execution or credential export.' };
      const text = canonical(bundle);
      if (Buffer.byteLength(text) > MAX_EXPORT) fail('WORKFLOW_EXPORT_LIMIT');
      this.#db.exec('COMMIT');
      return { bundle, sha256: hash(text), bytes: Buffer.byteLength(text) };
    } catch (e) { try { this.#db.exec('ROLLBACK'); } catch {} throw e; }
  }
}
