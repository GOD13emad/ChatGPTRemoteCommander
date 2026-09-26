// Private Commander delivery metadata. Never stores chat transcripts, credentials or raw tool arguments.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { expandPathValue } from './platform.mjs';

export const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const DELIVERY_STATES = Object.freeze(['COMPLETED_UNDELIVERED', 'DELIVERY_PENDING', 'DELIVERED', 'DEAD_LETTER']);
const KINDS = new Set(['COMPLETED', 'FAILED', 'UNCERTAIN', 'WAITING_INPUT', 'BLOCKED', 'EXHAUSTED', 'CANCELLED', 'PAUSED']);
const SOURCE_KINDS = new Set(['tool', 'operation', 'project']);
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const MAX_CHUNK_BYTES = 16 * 1024;
const MAX_DELIVERY_ATTEMPTS = 10;
const fail = code => { throw Object.assign(new Error(code), { deliveryCode: code }); };

export function opaqueId(value) {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) fail('DELIVERY_INVALID_ID');
  return value;
}
export function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(v => stableJson(v) ?? 'null').join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + stableJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(value).digest('hex');
const integer = (value, fallback, min, max) => {
  const n = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(n) || n < min || n > max) fail('DELIVERY_INVALID_LIMIT');
  return n;
};
function noLinks(target) {
  let cursor = path.parse(target).root;
  for (const part of path.resolve(target).slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) fail('DELIVERY_STATE_ALIAS');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
function regular(target) {
  noLinks(target);
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('DELIVERY_STATE_ALIAS');
  return stat;
}
function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
export function deliveryLocation(config, configPath) {
  const scope = digest(stableJson({ configPath: path.resolve(configPath), profile: config.instance?.profile ?? 'default' }));
  const configured = config.durableDelivery?.directory;
  const base = configured ? path.resolve(expandPathValue(configured))
    : config.asyncOperations?.stateDir ? path.join(path.resolve(expandPathValue(config.asyncOperations.stateDir)), 'delivery')
      : config.durableWorkflows?.directory ? path.join(path.resolve(expandPathValue(config.durableWorkflows.directory)), 'delivery')
        : path.join(os.homedir(), '.chatgpt-remote-commander', 'delivery', scope);
  return { directory: base, scope, forbiddenRoots: config.allowedRoots ?? [] };
}

export class DeliveryStore {
  constructor({ directory, scope = 'default', forbiddenRoots = [] }) {
    opaqueId(scope);
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || /^(?:\\\\|\/\/)/.test(directory)) {
      fail('DELIVERY_PRIVATE_LOCAL_DIRECTORY_REQUIRED');
    }
    noLinks(directory);
    for (const root of forbiddenRoots) {
      if (within(path.resolve(root), path.resolve(directory))) fail('DELIVERY_STORE_INSIDE_PROJECT');
    }
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.directory = fs.realpathSync.native(directory);
    this.scope = scope;
    this.closed = false;
    const location = path.join(this.directory, 'delivery.sqlite');
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      if (fs.existsSync(location + suffix)) regular(location + suffix);
    }
    this.db = new DatabaseSync(location, { allowExtension: false });
    fs.chmodSync(location, 0o600);
    this.db.exec('PRAGMA busy_timeout=3000; PRAGMA trusted_schema=OFF; PRAGMA synchronous=EXTRA;');
    if (this.db.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete') {
      this.db.close();
      fail('DELIVERY_JOURNAL_MODE');
    }
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) { this.db.close(); fail('DELIVERY_SCHEMA_TOO_NEW'); }
    this.db.exec(`CREATE TABLE IF NOT EXISTS deliveries (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      id TEXT NOT NULL,
      event_key TEXT NOT NULL,
      correlation TEXT NOT NULL,
      payload TEXT NOT NULL,
      result_hash TEXT NOT NULL,
      state TEXT NOT NULL,
      attempt TEXT,
      lease_until INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      receipt TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(scope,id),
      UNIQUE(scope,event_key));
      CREATE INDEX IF NOT EXISTS delivery_inbox ON deliveries(scope,correlation,seq);
      CREATE TABLE IF NOT EXISTS requests (
      scope TEXT NOT NULL,
      request_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      correlation TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      tool TEXT NOT NULL,
      status TEXT NOT NULL,
      owner_pid INTEGER NOT NULL,
      deadline INTEGER NOT NULL,
      delivery_id TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(scope,request_id),
      UNIQUE(scope,job_id));
      PRAGMA user_version=1;`);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }
  decode(row) {
    if (!row) fail('DELIVERY_NOT_FOUND');
    return {
      deliveryId: row.id, cursor: row.seq, ...JSON.parse(row.payload), resultHash: row.result_hash,
      state: row.state, attemptId: row.attempt, leaseUntil: row.lease_until, attempts: row.attempts,
      receiptId: row.receipt, createdAt: row.created_at, updatedAt: row.updated_at
    };
  }
  get(deliveryId, correlationId) {
    opaqueId(deliveryId);
    if (correlationId !== undefined) opaqueId(correlationId);
    const item = this.decode(this.db.prepare('SELECT * FROM deliveries WHERE scope=? AND id=?').get(this.scope, deliveryId));
    if (correlationId !== undefined && item.correlationId !== correlationId) fail('DELIVERY_CORRELATION_MISMATCH');
    return item;
  }
  publish({ eventKey, correlationId, source, sourceId, kind, code = kind, artifact = null }) {
    opaqueId(eventKey); opaqueId(correlationId); opaqueId(sourceId); opaqueId(code);
    if (!SOURCE_KINDS.has(source) || !KINDS.has(kind)) fail('DELIVERY_INVALID_EVENT');
    if (artifact && (
      !/^[a-f0-9]{64}$/.test(artifact.id) || !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      artifact.id !== artifact.sha256 || !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 0 || artifact.bytes > MAX_ARTIFACT_BYTES
    )) fail('DELIVERY_INVALID_ARTIFACT');
    const payload = stableJson({
      correlationId, source, sourceId, kind, code,
      artifact: artifact ? { id: artifact.id, sha256: artifact.sha256, bytes: artifact.bytes } : null
    });
    const resultHash = digest(payload), now = new Date().toISOString();
    this.db.prepare(`INSERT OR IGNORE INTO deliveries(
      scope,id,event_key,correlation,payload,result_hash,state,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'COMPLETED_UNDELIVERED',?,?)`)
      .run(this.scope, randomUUID(), eventKey, correlationId, payload, resultHash, now, now);
    const row = this.db.prepare('SELECT * FROM deliveries WHERE scope=? AND event_key=?').get(this.scope, eventKey);
    if (row.result_hash !== resultHash) fail('DELIVERY_EVENT_CONFLICT');
    return this.decode(row);
  }
  list({ after = 0, limit = 20, correlationId, includeDelivered = false } = {}) {
    integer(after, 0, 0, Number.MAX_SAFE_INTEGER); integer(limit, 20, 1, 50);
    if (correlationId !== undefined) opaqueId(correlationId);
    const rows = this.db.prepare(`SELECT * FROM deliveries WHERE scope=? AND seq>?
      AND (? IS NULL OR correlation=?) AND (?=1 OR state!='DELIVERED') ORDER BY seq LIMIT ?`)
      .all(this.scope, after, correlationId ?? null, correlationId ?? null, includeDelivered ? 1 : 0, limit + 1);
    const items = rows.slice(0, limit).map(row => this.decode(row));
    return { items, nextCursor: rows.length > limit ? items.at(-1)?.cursor ?? null : null };
  }
  claim({ deliveryId, correlationId, attemptId, leaseMs = 60000 }) {
    opaqueId(correlationId); opaqueId(attemptId); integer(leaseMs, 60000, 1000, 300000);
    return this.transaction(() => {
      const item = this.get(deliveryId, correlationId);
      if (item.state === 'DELIVERED') {
        if (item.attemptId !== attemptId) fail('DELIVERY_ATTEMPT_CONFLICT');
        return { ...item, claimed: false, alreadyDelivered: true };
      }
      if (item.state === 'DEAD_LETTER') return { ...item, claimed: false };
      if (item.attemptId === attemptId) return { ...item, claimed: true };
      if (item.state === 'DELIVERY_PENDING' && item.leaseUntil > Date.now()) fail('DELIVERY_CLAIM_BUSY');
      if (item.attempts >= MAX_DELIVERY_ATTEMPTS) {
        this.db.prepare("UPDATE deliveries SET state='DEAD_LETTER',updated_at=? WHERE scope=? AND id=?")
          .run(new Date().toISOString(), this.scope, deliveryId);
        return { ...this.get(deliveryId, correlationId), claimed: false };
      }
      this.db.prepare(`UPDATE deliveries
        SET state='DELIVERY_PENDING',attempt=?,lease_until=?,attempts=attempts+1,updated_at=?
        WHERE scope=? AND id=?`)
        .run(attemptId, Date.now() + leaseMs, new Date().toISOString(), this.scope, deliveryId);
      return { ...this.get(deliveryId, correlationId), claimed: true };
    });
  }
  ack({ deliveryId, correlationId, attemptId }) {
    opaqueId(correlationId); opaqueId(attemptId);
    return this.transaction(() => {
      const item = this.get(deliveryId, correlationId);
      if (item.attemptId !== attemptId) fail('DELIVERY_ATTEMPT_CONFLICT');
      if (item.state === 'DELIVERED') return item;
      if (item.state !== 'DELIVERY_PENDING') fail('DELIVERY_NOT_CLAIMED');
      this.db.prepare(`UPDATE deliveries
        SET state='DELIVERED',receipt=?,lease_until=NULL,updated_at=?
        WHERE scope=? AND id=?`)
        .run(randomUUID(), new Date().toISOString(), this.scope, deliveryId);
      return this.get(deliveryId, correlationId);
    });
  }
  artifactPath(id) {
    if (!/^[a-f0-9]{64}$/.test(id)) fail('DELIVERY_INVALID_ARTIFACT');
    const dir = path.join(this.directory, 'artifacts', this.scope);
    noLinks(dir); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return path.join(dir, id + '.json');
  }
  writeArtifact(result) {
    const bytes = Buffer.from(JSON.stringify(result) ?? 'null');
    if (bytes.length > MAX_ARTIFACT_BYTES) fail('DELIVERY_ARTIFACT_TOO_LARGE');
    const sha256 = digest(bytes), target = this.artifactPath(sha256);
    if (!fs.existsSync(target)) {
      const fd = fs.openSync(target, 'wx', 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (process.platform !== 'win32') {
        const parent = fs.openSync(path.dirname(target), 'r');
        try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
      }
    }
    const stat = regular(target);
    if (stat.size !== bytes.length || digest(fs.readFileSync(target)) !== sha256) fail('DELIVERY_ARTIFACT_CHANGED');
    return { id: sha256, sha256, bytes: bytes.length };
  }
  readArtifact({ deliveryId, correlationId, offset = 0, maxBytes = MAX_CHUNK_BYTES }) {
    opaqueId(correlationId); integer(offset, 0, 0, Number.MAX_SAFE_INTEGER);
    integer(maxBytes, MAX_CHUNK_BYTES, 1, MAX_CHUNK_BYTES);
    const item = this.get(deliveryId, correlationId), ref = item.artifact;
    if (!ref) fail('DELIVERY_NO_ARTIFACT');
    const target = this.artifactPath(ref.id), before = regular(target);
    if (before.size !== ref.bytes) fail('DELIVERY_ARTIFACT_CHANGED');
    const fd = fs.openSync(target, 'r');
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== before.ino || opened.dev !== before.dev) fail('DELIVERY_STATE_ALIAS');
      const length = Math.min(maxBytes, Math.max(0, ref.bytes - offset)), chunk = Buffer.alloc(length);
      const count = length ? fs.readSync(fd, chunk, 0, length, offset) : 0;
      if (count !== length || fs.fstatSync(fd).size !== ref.bytes) fail('DELIVERY_ARTIFACT_CHANGED');
      return {
        deliveryId, artifactId: ref.id, sha256: ref.sha256, bytes: ref.bytes, offset,
        encoding: 'base64', data: chunk.toString('base64'), chunkSha256: digest(chunk),
        nextOffset: offset + count < ref.bytes ? offset + count : null
      };
    } finally { fs.closeSync(fd); }
  }
  reserve({ requestId, correlationId = requestId, tool, inputHash, durationMs = 3600000 }) {
    opaqueId(requestId); opaqueId(correlationId); opaqueId(tool);
    integer(durationMs, 3600000, 1000, 24 * 60 * 60 * 1000);
    if (!/^[a-f0-9]{64}$/.test(inputHash)) fail('DELIVERY_INVALID_HASH');
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM requests WHERE scope=? AND request_id=?').get(this.scope, requestId);
      if (previous) {
        if (previous.input_hash !== inputHash || previous.correlation !== correlationId || previous.tool !== tool) fail('REQUEST_ID_CONFLICT');
        return { ...this.request(requestId), duplicate: true };
      }
      this.db.prepare("INSERT INTO requests VALUES(?,?,?,?,?,?,'RUNNING',?,?,NULL,?)")
        .run(this.scope, requestId, randomUUID(), correlationId, inputHash, tool, process.pid,
          Date.now() + durationMs, new Date().toISOString());
      return { ...this.request(requestId), duplicate: false };
    });
  }
  request(requestId) {
    opaqueId(requestId);
    const row = this.db.prepare('SELECT * FROM requests WHERE scope=? AND request_id=?').get(this.scope, requestId);
    if (!row) fail('DELIVERY_REQUEST_NOT_FOUND');
    return {
      requestId: row.request_id, jobId: row.job_id, correlationId: row.correlation,
      tool: row.tool, status: row.status, deliveryId: row.delivery_id
    };
  }
  finish(requestId, result, kind = 'COMPLETED') {
    const request = this.request(requestId);
    if (request.status === 'COMPLETED' || request.status === 'UNCERTAIN') {
      return request.deliveryId ? this.get(request.deliveryId, request.correlationId) : null;
    }
    const artifact = this.writeArtifact(result);
    return this.transaction(() => {
      const event = this.publish({
        eventKey: 'tool:' + request.jobId + ':final',
        correlationId: request.correlationId, source: 'tool', sourceId: request.jobId, kind, artifact
      });
      this.db.prepare("UPDATE requests SET status='COMPLETED',delivery_id=? WHERE scope=? AND request_id=?")
        .run(event.deliveryId, this.scope, requestId);
      return event;
    });
  }
  recover(limit = 50) {
    integer(limit, 50, 1, 100);
    const rows = this.db.prepare("SELECT * FROM requests WHERE scope=? AND status='RUNNING' ORDER BY created_at LIMIT ?")
      .all(this.scope, limit);
    let recovered = 0;
    for (const row of rows) {
      let alive = true;
      try { process.kill(row.owner_pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
      if (alive && Date.now() < row.deadline) continue;
      this.transaction(() => {
        const event = this.publish({
          eventKey: 'tool:' + row.job_id + ':uncertain',
          correlationId: row.correlation, source: 'tool', sourceId: row.job_id,
          kind: 'UNCERTAIN', code: 'RECONCILE_BEFORE_NEW_REQUEST'
        });
        this.db.prepare(`UPDATE requests SET status='UNCERTAIN',delivery_id=?
          WHERE scope=? AND request_id=? AND status='RUNNING'`)
          .run(event.deliveryId, this.scope, row.request_id);
      });
      recovered += 1;
    }
    return { recovered };
  }
  health() {
    const counts = Object.fromEntries(
      this.db.prepare('SELECT state,count(*) AS n FROM deliveries WHERE scope=? GROUP BY state')
        .all(this.scope).map(row => [row.state, row.n])
    );
    return {
      durable: true, schema: 1, scope: this.scope, counts,
      pending: (counts.COMPLETED_UNDELIVERED ?? 0) + (counts.DELIVERY_PENDING ?? 0),
      deadLetter: counts.DEAD_LETTER ?? 0,
      unfinishedRequests: this.db.prepare("SELECT count(*) AS n FROM requests WHERE scope=? AND status='RUNNING'")
        .get(this.scope).n,
      identityBoundary: 'TRUSTED_PROFILE_NOT_AUTHENTICATED_CHAT',
      rawArgumentsStored: false, maxArtifactBytes: MAX_ARTIFACT_BYTES, maxChunkBytes: MAX_CHUNK_BYTES
    };
  }
}
