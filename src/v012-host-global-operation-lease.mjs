// Fail-closed, owner-local V0.12 operation lease for one canonical host directory.
// This is NOT a grant, J01 owner approval, or an alternative to WorkflowStore
// root leases. All participating protected native Core processes on this host
// MUST use the same directory AND the same enrolled host ID. An unknown/crashed
// operation stays quarantined
// until a separately authenticated owner reconciliation proves effect cessation.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {assertWindowsHostLeaseStorage,
  createV012WindowsPrivateLeaseDatabase} from './v012-windows-host-global-lease-acl.mjs';

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
function checkDatabaseFile(file,windows=false){
  for(const suffix of ['', '-journal', '-wal', '-shm']){
    let s;
    try{s=fs.lstatSync(file+suffix);}
    catch(e){if(e?.code==='ENOENT')continue;throw e;}
    if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1
      ||(!windows&&(s.uid!==process.getuid()||(s.mode&0o077)!==0)))
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
function createCheckedLease({directory,hostId,now=Date.now,windows=false,verifyWindowsStorage=null}={}){
  if(typeof hostId!=='string'||!HOST.test(hostId)
    ||hostId==='.'||hostId==='..'||typeof now!=='function')
    fail('V012_NATIVE_LEASE_CONFIGURATION_INVALID');
  if(windows&&typeof verifyWindowsStorage!=='function')
    fail('V012_WINDOWS_NATIVE_LEASE_PRIVATE_DIRECTORY_REQUIRED');
  const safeDir=windows?directory:requireSafePath(directory);
  const file=path.join(safeDir,DB_FILE);
  checkDatabaseFile(file,windows);
  // SQLite's default create mode depends on umask. Create the pathname with
  // O_EXCL and owner-only permissions BEFORE opening it as a database.
  try{
    const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT
      |fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    fs.closeSync(fd);
  }catch(e){if(e?.code!=='EEXIST')throw e;}
  checkDatabaseFile(file,windows);
  const db=new DatabaseSync(file,{timeout:1000,allowExtension:false});
  let closed=false,poisoned=false,active=0;
  function assertHostPin(){
    const rows=db.prepare('SELECT singleton,host_id FROM native_operation_lease_identity LIMIT 2').all();
    if(rows.length!==1||rows[0].singleton!==1||rows[0].host_id!==hostId)
      fail('V012_NATIVE_LEASE_HOST_ID_MISMATCH');
  }
  try{
    if(!windows)fs.chmodSync(file,0o600);
    checkDatabaseFile(file,windows);
    db.exec('PRAGMA busy_timeout=1000; PRAGMA trusted_schema=OFF; PRAGMA synchronous=EXTRA;');
    if(db.prepare('PRAGMA journal_mode').get().journal_mode!=='delete')
      fail('V012_NATIVE_LEASE_JOURNAL_MODE_INVALID');
    db.exec('CREATE TABLE IF NOT EXISTS native_operation_leases ('+
      'resource TEXT PRIMARY KEY, owner TEXT NOT NULL,'+
      'acquired_at_ms INTEGER NOT NULL CHECK(acquired_at_ms > 0));');
    db.exec('CREATE TABLE IF NOT EXISTS native_operation_deferred ('+
      'resource TEXT PRIMARY KEY,owner TEXT NOT NULL,operation_id TEXT UNIQUE NOT NULL,'+
      'input_hash TEXT NOT NULL,binding_json TEXT NOT NULL,handoff TEXT NOT NULL,storage_json TEXT);');
    if(!db.prepare('PRAGMA table_info(native_operation_deferred)').all().some(c=>c.name==='storage_json'))
      db.exec('ALTER TABLE native_operation_deferred ADD COLUMN storage_json TEXT');
    if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')
      fail('V012_NATIVE_LEASE_DATABASE_CORRUPT');
    // Pin one host namespace for this physical DB under the same SQLite
    // write lock used for acquisition. Existing uncertain rows must never
    // be relabelled, deleted or silently admitted under a different host.
    db.exec('BEGIN IMMEDIATE');
    try{
      db.exec('CREATE TABLE IF NOT EXISTS native_operation_lease_identity ('+
        'singleton INTEGER PRIMARY KEY CHECK(singleton=1),host_id TEXT NOT NULL);');
      const pin=db.prepare('SELECT singleton,host_id FROM native_operation_lease_identity LIMIT 2').all();
      if(pin.length===0){
        // Migrate an older DB only when every persisted resource belongs
        // to the current owner-enrolled host. An empty DB pins first use.
        for(const row of db.prepare('SELECT resource FROM native_operation_leases').iterate()){
          try{checkedResource(row.resource,hostId);}
          catch{fail('V012_NATIVE_LEASE_HOST_ID_MISMATCH');}
        }
        db.prepare('INSERT INTO native_operation_lease_identity(singleton,host_id) VALUES(1,?)').run(hostId);
      }
      assertHostPin();
      db.exec('COMMIT');
    }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  }catch(e){db.close();throw e;}
  const begin=()=>db.exec('BEGIN IMMEDIATE');
  const rollback=()=>{try{db.exec('ROLLBACK');}catch{}};
  function reserve(key,owner){
    try{
      begin();
      assertHostPin();
      if(db.prepare('SELECT 1 AS held FROM native_operation_leases WHERE resource=?').get(key))
        fail('V012_NATIVE_LEASE_OCCUPIED');
      const at=now();
      if(!Number.isSafeInteger(at)||at<=0)fail('V012_NATIVE_LEASE_CLOCK_INVALID');
      db.prepare('INSERT INTO native_operation_leases(resource,owner,acquired_at_ms) VALUES(?,?,?)')
        .run(key,owner,at);
      db.exec('COMMIT');
      return at;
    }catch(e){rollback();
      if(e.code?.startsWith('V012_NATIVE_LEASE_'))throw e;
      fail('V012_NATIVE_LEASE_ACQUIRE_UNAVAILABLE');
    }
  }
  function release(key,owner){
    try{
      begin();
      assertHostPin();
      const r=db.prepare('DELETE FROM native_operation_leases WHERE resource=? AND owner=?')
        .run(key,owner);
      if(r.changes!==1)fail('V012_NATIVE_LEASE_RELEASE_MISMATCH');
      db.prepare('DELETE FROM native_operation_deferred WHERE resource=? AND owner=?').run(key,owner);
      db.exec('COMMIT');
    }catch(e){rollback();poisoned=true;
      fail('V012_NATIVE_LEASE_RELEASE_UNCERTAIN');
    }
  }
  return Object.freeze({
    // Host-owned reader only: this method is not an MCP action and accepts
    // no caller claim that an operation "finished". The reader must verify
    // the durable operation reservation/result/proof before returning data.
    async reconcileDeferred(resource,readCompletion){
      if(closed||poisoned)fail('V012_NATIVE_LEASE_NOT_READY');
      if(typeof readCompletion!=='function')fail('V012_NATIVE_LEASE_COMPLETION_READER_REQUIRED');
      const key=checkedResource(resource,hostId);
      if(windows)await verifyWindowsStorage();
      const row=db.prepare('SELECT d.*,l.acquired_at_ms FROM native_operation_deferred d '+
        'JOIN native_operation_leases l ON l.resource=d.resource AND l.owner=d.owner WHERE d.resource=?').get(key);
      if(!row||row.handoff!=='COMMITTED')return {released:false,reason:'NO_COMPLETED_HANDOFF'};
      let binding,completion;
      try{
        binding=JSON.parse(row.binding_json);
        completion=await readCompletion(Object.freeze({
          operationId:row.operation_id,inputHash:row.input_hash,binding:Object.freeze(binding),
          ...(row.storage_json ? {storage:Object.freeze(JSON.parse(row.storage_json))} : {})
        }));
      }catch{return {released:false,reason:'COMPLETION_UNAVAILABLE'};}
      const {isSerializedProcessCessationProof}=await import('./process-containment.mjs');
      if(completion?.inputHash!==row.input_hash
        ||!isSerializedProcessCessationProof(completion?.processCessationProof,binding))
        return {released:false,reason:'CESSATION_UNVERIFIED'};
      if(closed||poisoned)fail('V012_NATIVE_LEASE_NOT_READY');
      if(windows)await verifyWindowsStorage();
      try{
        begin();assertHostPin();
        const current=db.prepare('SELECT owner,operation_id,input_hash,binding_json,storage_json '+
          'FROM native_operation_deferred WHERE resource=?').get(key);
        if(!current||['owner','operation_id','input_hash','binding_json','storage_json'].some(k=>current[k]!==row[k])){
          db.exec('ROLLBACK');return {released:false,reason:'BINDING_CHANGED'};
        }
        const removed=db.prepare('DELETE FROM native_operation_leases WHERE resource=? AND owner=? AND acquired_at_ms=?')
          .run(key,row.owner,row.acquired_at_ms);
        if(removed.changes!==1){db.exec('ROLLBACK');return {released:false,reason:'OWNER_CHANGED'};}
        db.prepare('DELETE FROM native_operation_deferred WHERE resource=? AND owner=? AND operation_id=?')
          .run(key,row.owner,row.operation_id);
        db.exec('COMMIT');return {released:true,operationId:row.operation_id};
      }catch(error){rollback();fail('V012_NATIVE_LEASE_RECONCILIATION_UNAVAILABLE');}
    },
    async withLease(resource,work){
      if(closed||poisoned)fail('V012_NATIVE_LEASE_NOT_READY');
      if(typeof work!=='function')fail('V012_NATIVE_LEASE_CALLBACK_REQUIRED');
      const key=checkedResource(resource,hostId);
      if(windows){
        await verifyWindowsStorage();
        if(closed||poisoned)fail('V012_NATIVE_LEASE_NOT_READY');
        checkDatabaseFile(file,true);
      }
      const owner=randomUUID();
      const acquiredAt=reserve(key,owner);
      active++;
      let effectStarted=false,completed=false,provenNoEffect=false,deferredBinding=null,handoffRequested=false;
      // A rejected callback has an unknown external outcome by DEFAULT.
      // Only trusted Core admission may prove no effect occurred. The owner
      // must reconcile a quarantined row after independently proving cessation.
      const leaseContext=Object.freeze({
        bindDeferredOperation({operationId,inputHash,storage=null}={}){
          if(deferredBinding||provenNoEffect
            ||typeof operationId!=='string'||!/^[a-f0-9-]{36}$/.test(operationId)
            ||typeof inputHash!=='string'||!/^[a-f0-9]{64}$/.test(inputHash))
            fail('V012_NATIVE_LEASE_DEFERRED_BINDING_INVALID');
          if(storage!==null&&(typeof storage?.stateRoot!=='string'
            ||!path.isAbsolute(storage.stateRoot)||storage.stateRoot.length>4096
            ||storage.stateRoot.includes('\0')||!/^[a-f0-9]{64}$/.test(storage.requestKey??'')
            ||Object.keys(storage).length!==2))fail('V012_NATIVE_LEASE_DEFERRED_STORAGE_INVALID');
          const storageJson=storage===null?null:JSON.stringify({stateRoot:storage.stateRoot,requestKey:storage.requestKey});
          const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
          const binding=Object.freeze({workflowId:'native-root',stepId:'deferred-effect',operationId,
            rootFingerprint:digest(key),revision:1,
            leaseId:digest([hostId,key,owner,operationId,inputHash,storageJson]),fencingToken:acquiredAt});
          try{
            begin();assertHostPin();
            const held=db.prepare('SELECT owner FROM native_operation_leases WHERE resource=?').get(key);
            if(held?.owner!==owner)fail('V012_NATIVE_LEASE_DEFERRED_OWNER_CHANGED');
            db.prepare('INSERT INTO native_operation_deferred(resource,owner,operation_id,input_hash,binding_json,handoff,storage_json) VALUES(?,?,?,?,?,?,?)')
              .run(key,owner,operationId,inputHash,JSON.stringify(binding),'BOUND',storageJson);
            db.exec('COMMIT');deferredBinding=binding;effectStarted=true;return binding;
          }catch(error){rollback();fail('V012_NATIVE_LEASE_DEFERRED_BINDING_UNAVAILABLE');}
        },
        commitDeferredHandoff({operationId}={}){
          if(!deferredBinding||deferredBinding.operationId!==operationId||handoffRequested)
            fail('V012_NATIVE_LEASE_HANDOFF_BINDING_REQUIRED');
          // Publication is deferred until the entire outer callback settles.
          // Another process must never release a still-active caller's scope.
          handoffRequested=true;
        },
        markEffectStarted(){
          if(provenNoEffect)fail('V012_NATIVE_LEASE_EFFECT_AFTER_DENIAL');
          effectStarted=true;
        },
        markSafePreEffectDenial(){
          if(effectStarted)fail('V012_NATIVE_LEASE_EFFECT_ALREADY_STARTED');
          provenNoEffect=true;
        }
      });
      try{
        const result=await work(leaseContext);
        completed=true;
        return result;
      }finally{
        try{
          if(handoffRequested){
            const r=db.prepare("UPDATE native_operation_deferred SET handoff='COMMITTED' "+
              "WHERE resource=? AND owner=? AND operation_id=? AND handoff='BOUND'")
              .run(key,owner,deferredBinding.operationId);
            if(r.changes!==1){poisoned=true;fail('V012_NATIVE_LEASE_HANDOFF_UNCERTAIN');}
          }
          if(!deferredBinding&&(completed||provenNoEffect))release(key,owner);
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

// Linux retains its synchronous POSIX owner-private directory contract.
export function createV012HostGlobalOperationLease({
  directory,hostId,now=Date.now
}={}){
  // Do not accept externally supplied "windows" or validator arguments;
  // only the dedicated native Windows factory may enable that code path.
  return createCheckedLease({directory,hostId,now});
}

// Windows uses the same durable SQLite lease engine, but requires verified
// native owner-only NTFS paths, ACLs and files before initialization and
// before each resource acquisition. No privilege elevation or TTL takeover.
export async function createV012WindowsHostGlobalOperationLease({
  directory,hostId,now=Date.now
}={}){
  if(process.platform!=='win32'||typeof directory!=='string'
    ||!path.win32.isAbsolute(directory)
    ||! /^[a-z]:[\\/]/i.test(directory))
    fail('V012_WINDOWS_NATIVE_LEASE_PRIVATE_DIRECTORY_REQUIRED');
  const root=path.win32.resolve(directory);
  // A canonical physical host path is required across ALL Core processes.
  // Windows ACL checks alone cannot prove two path aliases share one DB.
  try{
    const canonical=fs.realpathSync.native(root);
    if(path.win32.normalize(canonical).toLowerCase()!==root.toLowerCase())
      fail('V012_WINDOWS_NATIVE_LEASE_DIRECTORY_ALIAS_DENIED');
  }catch{
    fail('V012_WINDOWS_NATIVE_LEASE_PRIVATE_DIRECTORY_REQUIRED');
  }
  const file=path.win32.join(root,DB_FILE);
  const verifyWindowsStorage=()=>assertWindowsHostLeaseStorage(root,file);
  await verifyWindowsStorage();
  // Windows cannot use POSIX 0600 for a newly created SQLite file. Apply
  // native owner SID/DACL at atomic CreateNew, never repair an existing DB.
  await createV012WindowsPrivateLeaseDatabase(file);
  await verifyWindowsStorage();
  const lease=createCheckedLease({
    directory:root,hostId,now,windows:true,verifyWindowsStorage
  });
  try{await verifyWindowsStorage();}
  catch(error){lease.close();throw error;}
  return lease;
}
