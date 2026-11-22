// RC013 scoped QA candidate. This is a SQL-only effect sink, NOT a remote
// execution adapter, OS-owner attestor, or filesystem/GUI/Shell fence.
// The same local SQLite transaction validates the epoch, reserves the operation
// key and increments the fixture counter. No other effect kind is supported.
import { DatabaseSync } from 'node:sqlite';
import { isProxy } from 'node:util/types';
import fs from 'node:fs';
import path from 'node:path';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
function dataRecord(value, names) {
  if(!value||typeof value!=='object'||Array.isArray(value)||isProxy(value)||
    Object.getPrototypeOf(value)!==Object.prototype||
    Reflect.ownKeys(value).sort().join('|')!==[...names].sort().join('|')) fail('RC013_SINK_RECORD_INVALID');
  const result={};
  for(const key of names){
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value')) fail('RC013_SINK_RECORD_INVALID');
    result[key]=descriptor.value;
  }
  return Object.freeze(result);
}
const validId=x=>typeof x==='string'&&ID.test(x);
const validHash=x=>typeof x==='string'&&HASH.test(x);
const tx=(db,fn)=>{
  db.exec('BEGIN IMMEDIATE');
  try{const out=fn();db.exec('COMMIT');return out;}
  catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}
};

export class Rc013SqliteEffectSink {
  #db;
  #verifyOwner;
  constructor({databasePath,verifyOwner}) {
    if(typeof verifyOwner!=='function'||typeof databasePath!=='string'||
      !path.isAbsolute(databasePath)||/^(?:\\\\|\/\/)/.test(databasePath)) fail('RC013_SINK_PRIVATE_BOOTSTRAP_REQUIRED');
    const dir=path.dirname(databasePath);
    const normalizeLocal = p => process.platform === 'win32'
      ? path.toNamespacedPath(p).toLowerCase() : p;
    if(normalizeLocal(fs.realpathSync.native(dir)) !== normalizeLocal(path.resolve(dir))
      || fs.lstatSync(dir).isSymbolicLink()) fail('RC013_SINK_LOCAL_DIRECTORY_REQUIRED');
    if(fs.existsSync(databasePath)&&!fs.lstatSync(databasePath).isFile()) fail('RC013_SINK_LOCAL_DATABASE_REQUIRED');
    // Production owner/OS ACL attestation is deliberately NOT implemented here.
    this.#verifyOwner=verifyOwner;
    this.#db=new DatabaseSync(databasePath,{allowExtension:false});
    this.#db.exec(`PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA;
      CREATE TABLE IF NOT EXISTS rc013_owner(project_id TEXT PRIMARY KEY,host_id TEXT NOT NULL,root_hash TEXT NOT NULL,epoch INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rc013_operations(project_id TEXT NOT NULL,operation_key TEXT NOT NULL,payload_hash TEXT NOT NULL,counter_key TEXT NOT NULL,PRIMARY KEY(project_id,operation_key));
      CREATE TABLE IF NOT EXISTS rc013_counters(project_id TEXT NOT NULL,counter_key TEXT NOT NULL,value INTEGER NOT NULL DEFAULT 0 CHECK(value>=0),PRIMARY KEY(project_id,counter_key));`);
  }
  close(){this.#db.close();}
  #owner(command,record) {
    // Trusted native-owner callbacks are not supplied by this candidate; the
    // caller must not route input/headers/model text into verifyOwner.
    if(this.#verifyOwner(command,Object.freeze({...record}))!==true) fail('RC013_SINK_OWNER_PROOF_REQUIRED');
  }
  enroll(input) {
    const c=dataRecord(input,['projectId','hostId','rootFingerprint','epoch']);
    if(!validId(c.projectId)||!validId(c.hostId)||!validHash(c.rootFingerprint)||c.epoch!==1)fail('RC013_SINK_ENROLL_INVALID');
    this.#owner('enroll',c);
    return tx(this.#db,()=>{
      if(this.#db.prepare('SELECT 1 FROM rc013_owner WHERE project_id=?').get(c.projectId))fail('RC013_SINK_ALREADY_ENROLLED');
      this.#db.prepare('INSERT INTO rc013_owner VALUES(?,?,?,?)').run(c.projectId,c.hostId,c.rootFingerprint,c.epoch);
      return Object.freeze({...c});
    });
  }
  rotate(input) {
    const c=dataRecord(input,['projectId','expectedEpoch','nextHostId','nextRootFingerprint']);
    if(!validId(c.projectId)||!validId(c.nextHostId)||!validHash(c.nextRootFingerprint)||
      !Number.isSafeInteger(c.expectedEpoch)||c.expectedEpoch<1||c.expectedEpoch>=Number.MAX_SAFE_INTEGER)fail('RC013_SINK_ROTATE_INVALID');
    this.#owner('rotate',c);
    return tx(this.#db,()=>{
      const result=this.#db.prepare('UPDATE rc013_owner SET host_id=?,root_hash=?,epoch=epoch+1 WHERE project_id=? AND epoch=?')
        .run(c.nextHostId,c.nextRootFingerprint,c.projectId,c.expectedEpoch);
      if(result.changes!==1)fail('RC013_SINK_STALE_EPOCH');
      return Object.freeze({projectId:c.projectId,hostId:c.nextHostId,epoch:c.expectedEpoch+1});
    });
  }
  // Only one fixed, SQL-transactional fixture effect. NOT an async arbitrary
  // callback: filesystem, process, GUI and remote effects cannot roll back
  // together with SQLite and MUST NOT be passed through this function.
  increment(input) {
    const c=dataRecord(input,['projectId','hostId','rootFingerprint','epoch','operationKey','payloadHash','counterKey']);
    if(!validId(c.projectId)||!validId(c.hostId)||!validHash(c.rootFingerprint)||
      !Number.isSafeInteger(c.epoch)||c.epoch<1||typeof c.operationKey!=='string'||
      !c.operationKey.length||c.operationKey.length>768||!validHash(c.payloadHash)||!validId(c.counterKey))fail('RC013_SINK_EFFECT_INVALID');
    return tx(this.#db,()=>{
      const owner=this.#db.prepare('SELECT host_id,root_hash,epoch FROM rc013_owner WHERE project_id=?').get(c.projectId);
      if(!owner||owner.host_id!==c.hostId||owner.root_hash!==c.rootFingerprint||owner.epoch!==c.epoch)
        fail('RC013_SINK_AUTHORITY_FENCE_REJECTED');
      const prior=this.#db.prepare('SELECT payload_hash,counter_key FROM rc013_operations WHERE project_id=? AND operation_key=?')
        .get(c.projectId,c.operationKey);
      if(prior){
        if(prior.payload_hash!==c.payloadHash||prior.counter_key!==c.counterKey)fail('RC013_SINK_REPLAY_CONFLICT');
        return Object.freeze({status:'CACHED',epoch:c.epoch});
      }
      this.#db.prepare('INSERT INTO rc013_operations VALUES(?,?,?,?)').run(c.projectId,c.operationKey,c.payloadHash,c.counterKey);
      this.#db.prepare(`INSERT INTO rc013_counters(project_id,counter_key,value) VALUES(?,?,1)
        ON CONFLICT(project_id,counter_key) DO UPDATE SET value=value+1`).run(c.projectId,c.counterKey);
      return Object.freeze({status:'APPLIED',epoch:c.epoch});
    });
  }
  inspect(projectId,counterKey){
    if(!validId(projectId)||!validId(counterKey))fail('RC013_SINK_QUERY_INVALID');
    const row=this.#db.prepare('SELECT value FROM rc013_counters WHERE project_id=? AND counter_key=?').get(projectId,counterKey);
    return row?.value??0;
  }
}
