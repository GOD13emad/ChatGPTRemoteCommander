// Fail-closed, owner-local V0.12 operation lease for one canonical host directory.
// This is NOT a grant, J01 owner approval, or an alternative to WorkflowStore
// root leases. All participating protected native Core processes on this host
// MUST use the same directory; an unknown/crashed operation stays quarantined
// until a separately authenticated owner reconciliation proves effect cessation.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const HOST=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KINDS=new Set(['host-shell','workflow-root','desktop-seat','browser-target']);
const DB_FILE='v012-native-operation-leases.sqlite';
const fail=code=>{throw Object.assign(new Error(code),{code});};

function requireSafePath(directory){
  if(process.platform!=='linux'||typeof process.getuid!=='function'
    ||typeof directory!=='string'||!path.isAbsolute(directory)
    ||directory.includes('\0')||directory.length>4096)
    fail('V012_NATIVE_LEASE_OWNER_DIRECTORY_REQUIRED');
  const absolute=path.resolve(directory);
  let cursor=path.parse(absolute).root;
  for(const component of absolute.slice(cursor.length).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,component);
    const entry=fs.lstatSync(cursor);
    if(!entry.isDirectory()||entry.isSymbolicLink())
      fail('V012_NATIVE_LEASE_DIRECTORY_ALIAS_DENIED');
  }
  const s=fs.lstatSync(absolute);
  if(s.uid!==process.getuid()||(s.mode&0o077)!==0
    ||fs.realpathSync.native(absolute)!==absolute)
    fail('V012_NATIVE_LEASE_DIRECTORY_NOT_PRIVATE');
  return absolute;
}
function checkDatabaseFile(file){
  for(const suffix of ['', '-journal', '-wal', '-shm']){
    let s;
    try{s=fs.lstatSync(file+suffix);}
    catch(e){if(e?.code==='ENOENT')continue;throw e;}
    if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1
      ||s.uid!==process.getuid()||(s.mode&0o077)!==0)
      fail('V012_NATIVE_LEASE_DATABASE_UNTRUSTED');
  }
}
function checkedResource(key,hostId){
  if(typeof key!=='string'||key.length>512)
    fail('V012_NATIVE_LEASE_RESOURCE_INVALID');
  let parts;
  try{parts=JSON.parse(key);}catch{fail('V012_NATIVE_LEASE_RESOURCE_INVALID');}
  if(!Array.isArray(parts)||parts.length!==4||parts[0]!==1
    ||parts[1]!==hostId||!KINDS.has(parts[2])
    ||typeof parts[3]!=='string'||!ID.test(parts[3])
    ||parts[3]==='.'||parts[3]==='..'||JSON.stringify(parts)!==key)
    fail('V012_NATIVE_LEASE_RESOURCE_INVALID');
  return key;
}

/**
 * SQLite BEGIN IMMEDIATE serializes lease acquisition across processes.
 * No TTL-based takeover: a crash may leave an uncertain external effect.
 * A separate owner-authenticated reconciliation mechanism must clear such a
 * persisted lease after proving process cessation and effect disposition.
 * This implementation deliberately exports no self-serve force-release API.
 */
export function createV012HostGlobalOperationLease({directory,hostId,now=Date.now}={}){
  if(typeof hostId!=='string'||!HOST.test(hostId)
    ||hostId==='.'||hostId==='..'||typeof now!=='function')
    fail('V012_NATIVE_LEASE_CONFIGURATION_INVALID');
  const safeDir=requireSafePath(directory);
  const file=path.join(safeDir,DB_FILE);
  checkDatabaseFile(file);
  // SQLite's default create mode depends on umask. Create the pathname with
  // O_EXCL and owner-only permissions BEFORE opening it as a database.
  try{
    const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT
      |fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    fs.closeSync(fd);
  }catch(e){if(e?.code!=='EEXIST')throw e;}
  checkDatabaseFile(file);
  const db=new DatabaseSync(file,{timeout:1000,allowExtension:false});
  let closed=false,poisoned=false,active=0;
  try{
    fs.chmodSync(file,0o600);
    checkDatabaseFile(file);
    db.exec('PRAGMA busy_timeout=1000; PRAGMA trusted_schema=OFF; PRAGMA synchronous=EXTRA;');
    if(db.prepare('PRAGMA journal_mode').get().journal_mode!=='delete')
      fail('V012_NATIVE_LEASE_JOURNAL_MODE_INVALID');
    db.exec('CREATE TABLE IF NOT EXISTS native_operation_leases ('+
      'resource TEXT PRIMARY KEY, owner TEXT NOT NULL,'+
      'acquired_at_ms INTEGER NOT NULL CHECK(acquired_at_ms > 0));');
    if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')
      fail('V012_NATIVE_LEASE_DATABASE_CORRUPT');
  }catch(e){db.close();throw e;}
  const begin=()=>db.exec('BEGIN IMMEDIATE');
  const rollback=()=>{try{db.exec('ROLLBACK');}catch{}};
  function reserve(key,owner){
    try{
      begin();
      if(db.prepare('SELECT 1 AS held FROM native_operation_leases WHERE resource=?').get(key))
        fail('V012_NATIVE_LEASE_OCCUPIED');
      const at=now();
      if(!Number.isSafeInteger(at)||at<=0)fail('V012_NATIVE_LEASE_CLOCK_INVALID');
      db.prepare('INSERT INTO native_operation_leases(resource,owner,acquired_at_ms) VALUES(?,?,?)')
        .run(key,owner,at);
      db.exec('COMMIT');
    }catch(e){rollback();
      if(e.code?.startsWith('V012_NATIVE_LEASE_'))throw e;
      fail('V012_NATIVE_LEASE_ACQUIRE_UNAVAILABLE');
    }
  }
  function release(key,owner){
    try{
      begin();
      const r=db.prepare('DELETE FROM native_operation_leases WHERE resource=? AND owner=?')
        .run(key,owner);
      if(r.changes!==1)fail('V012_NATIVE_LEASE_RELEASE_MISMATCH');
      db.exec('COMMIT');
    }catch(e){rollback();poisoned=true;
      fail('V012_NATIVE_LEASE_RELEASE_UNCERTAIN');
    }
  }
  return Object.freeze({
    async withLease(resource,work){
      if(closed||poisoned)fail('V012_NATIVE_LEASE_NOT_READY');
      if(typeof work!=='function')fail('V012_NATIVE_LEASE_CALLBACK_REQUIRED');
      const key=checkedResource(resource,hostId);
      const owner=randomUUID();
      reserve(key,owner);
      active++;
      // A thrown/rejected effect may have started an external operation before
      // losing its receipt. Do not make this resource available to another
      // requestId while cessation/effect disposition is unknown. No automatic
      // TTL expiry or rollback can prove that an external effect stopped.
      let fulfilled=false;
      try{
        const value=await work();
        fulfilled=true;
        return value;
      }finally{
        try{
          if(fulfilled)release(key,owner);
          // A fulfilled callback is only sufficient when the integration
          // contract returns AFTER its durable terminal receipt has committed.
          // This function itself cannot attest to remote effect completion.
        }finally{active--;}
      }
    },
    close(){
      if(closed)return;
      if(active>0)fail('V012_NATIVE_LEASE_IN_FLIGHT');
      closed=true;db.close();
    }
  });
}
