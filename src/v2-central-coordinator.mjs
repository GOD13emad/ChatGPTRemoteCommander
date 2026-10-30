// V2 R3 candidate: ONE central SQLite lease authority, not a per-host queue.
// Only a trusted coordinator worker may open this database. Remote actors must
// use an authenticated coordinator service (not supplied by this module).
// A fencing token MUST be checked at the protected resource immediately before
// its effect; time-based ownership alone is not distributed execution safety.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { normalizeV2Route, v2ResourceLeaseKey, v2OperationKey } from './v2-routing-contract.mjs';

function fail(code) { throw Object.assign(new Error(code), { code }); }
function privateDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail('V2_COORDINATOR_ABSOLUTE_ROOT_REQUIRED');
  const full = path.resolve(directory);
  let current = path.parse(full).root;
  for (const part of full.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      fail('V2_COORDINATOR_ALIAS_FORBIDDEN');
  }
  fs.mkdirSync(full, {recursive:true, mode:0o700});
  const stat=fs.lstatSync(full);
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      (process.platform!=='win32' && (stat.uid!==process.getuid() || (stat.mode & 0o077)!==0)))
    fail('V2_COORDINATOR_PRIVATE_ROOT_REQUIRED');
  return fs.realpathSync.native(full);
}
function validTtl(value) {
  if (!Number.isSafeInteger(value) || value<1000 || value>60000) fail('V2_COORDINATOR_TTL_INVALID');
  return value;
}
function validLease(value) {
  if (!value || typeof value!=='object' || typeof value.id!=='string' ||
    !/^[0-9a-f-]{36}$/.test(value.id) || !Number.isSafeInteger(value.fence) || value.fence<1)
    fail('V2_COORDINATOR_LEASE_INVALID');
}
export class V2CentralCoordinator {
  constructor({directory, now=Date.now, authorizeLease}={}) {
    if (typeof now!=='function' || typeof authorizeLease!=='function')
      fail('V2_COORDINATOR_TRUSTED_BOOTSTRAP_REQUIRED');
    this.now=now;
    this.authorizeLease=authorizeLease; // natively attested principal/grant, NEVER RPC-provided flags
    this.directory=privateDirectory(directory);
    const location=path.join(this.directory,'v2-central-leases.sqlite');
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      if(!fs.existsSync(location+suffix)) continue;
      const s=fs.lstatSync(location+suffix);
      if(!s.isFile() || s.isSymbolicLink() || s.nlink!==1)
        fail('V2_COORDINATOR_DB_ALIAS_FORBIDDEN');
    }
    this.db=new DatabaseSync(location,{allowExtension:false});
    try {
      if (process.platform!=='win32') fs.chmodSync(location,0o600);
      this.db.exec('PRAGMA busy_timeout=3000; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL;');
      if (this.db.prepare('PRAGMA journal_mode').get().journal_mode!=='delete')
        fail('V2_COORDINATOR_JOURNAL_MODE');
      const version=this.db.prepare('PRAGMA user_version').get().user_version;
      if (version>1) fail('V2_COORDINATOR_SCHEMA_TOO_NEW');
      this.db.exec(`CREATE TABLE IF NOT EXISTS v2_global_lease (
        resource TEXT PRIMARY KEY, holder TEXT NOT NULL, lease_id TEXT NOT NULL,
        fence INTEGER NOT NULL CHECK(fence>=1),
        expires_at_ms INTEGER NOT NULL, clock_floor_ms INTEGER NOT NULL
      ); PRAGMA user_version=1;`);
    } catch(error) { this.db.close();throw error; }
  }
  clock() {
    const n=this.now();
    if (!Number.isSafeInteger(n) || n<0) fail('V2_COORDINATOR_CLOCK_INVALID');
    return n;
  }
  async scope(route) {
    const r=normalizeV2Route(route);
    if(await this.authorizeLease(r)!==true) fail('V2_COORDINATOR_AUTH_REQUIRED');
    return {resource:v2ResourceLeaseKey(r),holder:v2OperationKey(r)};
  }
  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r=work();this.db.exec('COMMIT');return r; }
    catch(e) { this.db.exec('ROLLBACK');throw e; }
  }
  row(resource) {
    return this.db.prepare('SELECT * FROM v2_global_lease WHERE resource=?').get(resource);
  }
  lease(row) {
    return Object.freeze({id:row.lease_id,fence:row.fence,expiresAtMs:row.expires_at_ms});
  }
  checkClock(row,ms) {
    if(row && ms<row.clock_floor_ms) fail('V2_COORDINATOR_CLOCK_ROLLBACK');
  }
  async acquire({route,ttlMs=30000}) {
    validTtl(ttlMs);
    const {resource,holder}=await this.scope(route);
    const ms=this.clock();
    if(ms>Number.MAX_SAFE_INTEGER-ttlMs) fail('V2_COORDINATOR_CLOCK_INVALID');
    return this.transaction(()=>{
      const old=this.row(resource);this.checkClock(old,ms);
      if(old && old.expires_at_ms>ms){
        if(old.holder===holder) return this.lease(old); // lost ACK, no duplicate lease
        fail('V2_COORDINATOR_RESOURCE_BUSY');
      }
      const fence=old?old.fence+1:1;
      if(!Number.isSafeInteger(fence)) fail('V2_COORDINATOR_FENCE_EXHAUSTED');
      const newRow={resource,holder,lease_id:randomUUID(),fence,
        expires_at_ms:ms+ttlMs,clock_floor_ms:ms};
      this.db.prepare(`INSERT INTO v2_global_lease
        (resource,holder,lease_id,fence,expires_at_ms,clock_floor_ms)
        VALUES (@resource,@holder,@lease_id,@fence,@expires_at_ms,@clock_floor_ms)
        ON CONFLICT(resource) DO UPDATE SET holder=excluded.holder,
          lease_id=excluded.lease_id,fence=excluded.fence,
          expires_at_ms=excluded.expires_at_ms,clock_floor_ms=excluded.clock_floor_ms`).run(newRow);
      return this.lease(newRow);
    });
  }
  async renew({route,lease,ttlMs=30000}) {
    validLease(lease);validTtl(ttlMs);
    const {resource,holder}=await this.scope(route);
    const ms=this.clock();
    if(ms>Number.MAX_SAFE_INTEGER-ttlMs) fail('V2_COORDINATOR_CLOCK_INVALID');
    return this.transaction(()=>{
      const row=this.row(resource);this.checkClock(row,ms);
      if(!row||row.holder!==holder||row.lease_id!==lease.id||
        row.fence!==lease.fence||row.expires_at_ms<=ms)
        fail('V2_COORDINATOR_STALE_LEASE');
      this.db.prepare(`UPDATE v2_global_lease SET expires_at_ms=?,clock_floor_ms=?
        WHERE resource=?`).run(ms+ttlMs,ms,resource);
      return Object.freeze({id:lease.id,fence:lease.fence,expiresAtMs:ms+ttlMs});
    });
  }
  async assertCurrent({route,lease}) {
    validLease(lease);
    const {resource,holder}=await this.scope(route);
    const ms=this.clock();
    const row=this.row(resource);this.checkClock(row,ms);
    if(!row||row.holder!==holder||row.lease_id!==lease.id||
      row.fence!==lease.fence||row.expires_at_ms<=ms)
      fail('V2_COORDINATOR_STALE_LEASE');
    return true;
  }
  async release({route,lease}) {
    validLease(lease);
    const {resource,holder}=await this.scope(route);
    const ms=this.clock();
    return this.transaction(()=>{
      const row=this.row(resource);this.checkClock(row,ms);
      if(!row||row.holder!==holder||row.lease_id!==lease.id||
        row.fence!==lease.fence||row.expires_at_ms<=ms) return false;
      this.db.prepare('UPDATE v2_global_lease SET expires_at_ms=?,clock_floor_ms=? WHERE resource=?')
        .run(ms,ms,resource);
      return true;
    });
  }
  async withFencedLease({route,ttlMs=30000,run}) {
    if(typeof run!=='function') fail('V2_COORDINATOR_RUN_REQUIRED');
    const lease=await this.acquire({route,ttlMs});
    try {
      await this.assertCurrent({route,lease});
      // The protected actuator must independently reject stale fences on effect.
      const result=await run(Object.freeze({lease,
        assertCurrent:()=>this.assertCurrent({route,lease})}));
      // Never confirm completion after an expired/revoked lease, even if the
      // caller neglected a final check. The actuator still needs atomic fence enforcement.
      await this.assertCurrent({route,lease});
      return result;
    } finally {
      try {await this.release({route,lease});}
      catch { /* Never overwrite an original execution error or claim recovery. */ }
    }
  }
  close(){this.db.close();}
}
