// Durable at-most-once guard for direct mutating MCP tools.
// Stores only tool name, stable input hash, state and bounded JSON result; raw arguments are never persisted.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(v => stableJson(v) ?? 'null').join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + stableJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
function fail(code) { throw Object.assign(new Error(code), { mutationIdempotencyCode: code }); }

export class MutationIdempotencyStore {
  constructor({ directory, scope }) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail('MUTATION_STORE_DIRECTORY_REQUIRED');
    if (typeof scope !== 'string' || scope.length < 1) fail('MUTATION_STORE_SCOPE_REQUIRED');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.scope = scope;
    this.location = path.join(directory, 'mutations.sqlite');
    this.db = new DatabaseSync(this.location, { allowExtension: false });
    fs.chmodSync(this.location, 0o600);
    this.db.exec('PRAGMA busy_timeout=3000; PRAGMA trusted_schema=OFF; PRAGMA synchronous=EXTRA;');
    if (this.db.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete') fail('MUTATION_STORE_JOURNAL_MODE');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) fail('MUTATION_STORE_SCHEMA_TOO_NEW');
    this.db.exec(`CREATE TABLE IF NOT EXISTS mutations (
      scope TEXT NOT NULL,
      request_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      state TEXT NOT NULL,
      result_json TEXT,
      result_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(scope,request_id));
      CREATE INDEX IF NOT EXISTS mutation_state ON mutations(scope,state);
      PRAGMA user_version=1;`);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const out = fn(); this.db.exec('COMMIT'); return out; }
    catch (error) { try { this.db.exec('ROLLBACK'); } catch {} throw error; }
  }
  status() {
    const rows = this.db.prepare('SELECT state,COUNT(*) AS count FROM mutations WHERE scope=? GROUP BY state').all(this.scope);
    return { enabled: true, durable: true, rawArgumentsStored: false,
      states: Object.fromEntries(rows.map(row => [row.state, Number(row.count)])) };
  }
  begin({ requestId, tool, input }) {
    if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) fail('MUTATION_REQUEST_ID_REQUIRED');
    const inputHash = digest(stableJson({ tool, input }));
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM mutations WHERE scope=? AND request_id=?').get(this.scope, requestId);
      if (existing) {
        if (existing.tool !== tool || existing.input_hash !== inputHash) fail('MUTATION_REQUEST_ID_CONFLICT');
        if (existing.state === 'SUCCEEDED') return { duplicate: true, result: JSON.parse(existing.result_json) };
        fail('MUTATION_OUTCOME_UNCERTAIN');
      }
      const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO mutations(scope,request_id,tool,input_hash,state,created_at,updated_at)
        VALUES(?,?,?,?, 'PREPARED', ?,?)`).run(this.scope, requestId, tool, inputHash, now, now);
      return { duplicate: false, inputHash };
    });
  }
  succeed(requestId, result) {
    const encoded = stableJson(result);
    const resultHash = digest(encoded);
    this.transaction(() => {
      const row = this.db.prepare('SELECT state FROM mutations WHERE scope=? AND request_id=?').get(this.scope, requestId);
      if (!row || row.state !== 'PREPARED') fail('MUTATION_STATE_CONFLICT');
      this.db.prepare(`UPDATE mutations SET state='SUCCEEDED',result_json=?,result_hash=?,updated_at=?
        WHERE scope=? AND request_id=?`).run(encoded, resultHash, new Date().toISOString(), this.scope, requestId);
    });
    return result;
  }
  uncertain(requestId) {
    this.db.prepare(`UPDATE mutations SET state='UNCERTAIN',updated_at=?
      WHERE scope=? AND request_id=? AND state='PREPARED'`).run(new Date().toISOString(), this.scope, requestId);
  }
  async execute({ requestId, tool, input }, effect) {
    const begun = this.begin({ requestId, tool, input });
    if (begun.duplicate) return begun.result;
    try {
      const result = await effect();
      return this.succeed(requestId, result);
    } catch (error) {
      this.uncertain(requestId);
      throw error;
    }
  }
  close() { this.db.close(); }
}
