// V2-G1: one durable, default-deny Commander access registry for a host.
// Candidate-only; NOT exposed to legacy unauthenticated MCP tools.
// The owning system service must provision restrictive OS ACLs on the directory
// and supply authenticated administrator callbacks before any production activation.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeV2Route } from './v2-routing-contract.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TOOL = /^[a-z][a-z0-9_]{0,79}$/;
const ALLOWED = new Set(['ENABLED', 'REVOKED']);
function fail(code) { throw Object.assign(new Error(code), { code }); }
function safeId(value) {
  if (typeof value !== 'string' || !ID.test(value) || value === '.' || value === '..') fail('V2_GRANT_IDENTIFIER_INVALID');
  return value;
}
function assertPrivatePath(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || /^(?:\\\\|\/\/)/.test(directory)) fail('V2_GRANT_ABSOLUTE_DIRECTORY_REQUIRED');
  const full = path.resolve(directory);
  let cursor = path.parse(full).root;
  for (const part of full.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor)) {
      const info = fs.lstatSync(cursor);
      if (info.isSymbolicLink()) fail('V2_GRANT_ALIAS_NOT_ALLOWED');
    }
  }
  fs.mkdirSync(full, { recursive: true, mode: 0o700 });
  return fs.realpathSync.native(full);
}
function scopeOf(route, tool) {
  const r = normalizeV2Route(route);
  if (typeof tool !== 'string' || !TOOL.test(tool)) fail('V2_GRANT_TOOL_INVALID');
  return [r.hostId, r.principalId, r.profileId, r.conversationId, r.target.kind, r.target.id, tool];
}
function toGrant(row) {
  return row ? Object.freeze({
    status: row.status, revision: Number(row.revision), actor: row.actor,
    updatedAt: row.updated_at
  }) : null;
}
export class V2GrantRegistry {
  constructor({ directory, authorizeAdministration }) {
    if (typeof authorizeAdministration !== 'function') fail('V2_GRANT_ADMIN_PROVIDER_REQUIRED');
    this.authorizeAdministration = authorizeAdministration;
    this.directory = assertPrivatePath(directory);
    this.location = path.join(this.directory, 'v2-access.sqlite');
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      if (!fs.existsSync(this.location + suffix)) continue;
      const info = fs.lstatSync(this.location + suffix);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) fail('V2_GRANT_ALIAS_NOT_ALLOWED');
    }
    this.db = new DatabaseSync(this.location, { allowExtension: false });
    try { fs.chmodSync(this.location, 0o600); } catch { /* Windows owner ACLs are a separate deployment gate */ }
    this.db.exec('PRAGMA busy_timeout=3000; PRAGMA trusted_schema=OFF; PRAGMA synchronous=EXTRA;');
    if (this.db.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete') fail('V2_GRANT_JOURNAL_MODE');
    const version=this.db.prepare('PRAGMA user_version').get().user_version;
    if(version===1){this.db.close();fail('V2_GRANT_SCHEMA_MIGRATION_REQUIRED');}
    if(version>2){this.db.close();fail('V2_GRANT_SCHEMA_TOO_NEW');}
    this.db.exec(`CREATE TABLE IF NOT EXISTS v2_grants (
      host TEXT NOT NULL, principal TEXT NOT NULL, profile TEXT NOT NULL,
      conversation TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, tool TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ENABLED','REVOKED')),
      revision INTEGER NOT NULL CHECK (revision >= 1),
      actor TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(host,principal,profile,conversation,kind,target,tool)
    );
    CREATE TABLE IF NOT EXISTS v2_grant_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,host TEXT NOT NULL,principal TEXT NOT NULL,profile TEXT NOT NULL,
      conversation TEXT NOT NULL,kind TEXT NOT NULL,target TEXT NOT NULL,tool TEXT NOT NULL,from_status TEXT,
      to_status TEXT NOT NULL,revision INTEGER NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    PRAGMA user_version=2;`);
  }
  read(route, tool) {
    const s = scopeOf(route, tool);
    const row = this.db.prepare(`SELECT status,revision,actor,updated_at FROM v2_grants
      WHERE host=? AND principal=? AND profile=? AND conversation=? AND kind=? AND target=? AND tool=?`).get(...s);
    return toGrant(row);
  }
  isAllowed(route, tool) { return this.read(route, tool)?.status === 'ENABLED'; }
  /**
   * Only a verified owner/admin worker may call this. Authority comes from an
   * injected trusted principal/session provider, not actor strings or OS admin
   * membership inferred from a Commander FULL_POWER profile.
   */
  change({ route, tool, status, expectedRevision, actor, reason }) {
    const scope = scopeOf(route, tool);
    if (!ALLOWED.has(status)) fail('V2_GRANT_STATUS_INVALID');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('V2_GRANT_EXPECTED_REVISION_REQUIRED');
    safeId(actor);
    if (typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 400) fail('V2_GRANT_REASON_REQUIRED');
    if (this.authorizeAdministration({ actor, route, tool, status }) !== true) fail('V2_GRANT_ADMIN_AUTH_REQUIRED');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.db.prepare(`SELECT status,revision FROM v2_grants WHERE host=? AND principal=?
        AND profile=? AND conversation=? AND kind=? AND target=? AND tool=?`).get(...scope);
      const revision = current ? Number(current.revision) : 0;
      if (revision !== expectedRevision) fail('V2_GRANT_REVISION_CONFLICT');
      if (!current && status === 'REVOKED') fail('V2_GRANT_NOT_FOUND');
      if (current?.status === status) { this.db.exec('COMMIT'); return this.read(route, tool); }
      const next = revision + 1;
      const stamp = new Date().toISOString();
      this.db.prepare(`INSERT INTO v2_grants(host,principal,profile,conversation,kind,target,tool,status,revision,actor,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(host,principal,profile,conversation,kind,target,tool)
        DO UPDATE SET status=excluded.status,revision=excluded.revision,actor=excluded.actor,updated_at=excluded.updated_at`)
        .run(...scope, status, next, actor, stamp);
      this.db.prepare(`INSERT INTO v2_grant_events
        (host,principal,profile,conversation,kind,target,tool,from_status,to_status,revision,actor,reason,occurred_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(...scope, current?.status ?? null, status, next, actor, reason.trim(), stamp);
      this.db.exec('COMMIT');
      return this.read(route, tool);
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }
  events(route, tool) {
    const s = scopeOf(route, tool);
    return this.db.prepare(`SELECT seq,from_status AS fromStatus,to_status AS toStatus,revision,actor,reason,occurred_at AS occurredAt
      FROM v2_grant_events WHERE host=? AND principal=? AND profile=? AND conversation=? AND kind=? AND target=? AND tool=? ORDER BY seq`).all(...s);
  }
  close() { this.db.close(); }
}
