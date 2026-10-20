// PRIVATE WINDOWS QA: SQLite CLI, never a Core input or authorization tool.
// A per-root epoch marker detects some accidental history loss and file swaps.
// The marker AND database are writable by the same Windows account: neither
// establishes trusted owner identity or resists a malicious same-SID process.
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REF=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KINDS=new Set(['click','move','drag','type','key','scroll']);
const fail=code=>Object.assign(new Error(code),{code});

function canonicalPaths(root){
  if(process.platform!=='win32')throw fail('WIN_JOURNAL_PLATFORM_UNSUPPORTED');
  if(typeof root!=='string'||!path.isAbsolute(root))throw fail('WIN_JOURNAL_ROOT_INVALID');
  const resolved=path.resolve(root);
  const st=fs.lstatSync(resolved);
  if(!st.isDirectory()||st.isSymbolicLink()||
    fs.realpathSync.native(resolved).toLowerCase()!==resolved.toLowerCase())
    throw fail('WIN_JOURNAL_ROOT_UNTRUSTED');
  const file=path.join(resolved,'native-workspace-qa.sqlite');
  const marker=path.join(resolved,'native-workspace-qa.epoch');
  for(const p of [file,marker]){
    if(fs.existsSync(p)){
      const fst=fs.lstatSync(p);
      if(!fst.isFile()||fst.isSymbolicLink()||fst.nlink!==1)
        throw fail('WIN_JOURNAL_FILE_UNTRUSTED');
    }
  }
  return {file,marker};
}

function exclusiveCreate(p,contents){
  let fd;
  try{
    fd=fs.openSync(p,'wx',0o600);
    if(contents!==undefined)fs.writeFileSync(fd,contents);
    fs.fsyncSync(fd);
  }catch(e){
    if(e?.code==='EEXIST')throw fail('WIN_JOURNAL_ALREADY_INITIALIZED');
    throw e;
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}
function markerGeneration(marker){
  const raw=fs.readFileSync(marker);
  if(raw.length!==64)throw fail('WIN_JOURNAL_MARKER_UNTRUSTED');
  const generation=raw.toString('ascii');
  if(!REF.test(generation))throw fail('WIN_JOURNAL_MARKER_UNTRUSTED');
  return generation;
}
function operate(method,root,workspaceRef,operationId,kind){
  if(!['provision','prepare','ack','inspect'].includes(method))
    throw fail('WIN_JOURNAL_METHOD_INVALID');
  if(method!=='provision'&&!ID.test(operationId??''))
    throw fail('WIN_JOURNAL_OPERATION_INVALID');
  if(['prepare','ack'].includes(method)&&!REF.test(workspaceRef??''))
    throw fail('WIN_JOURNAL_WORKSPACE_INVALID');
  if(method==='prepare'&&!KINDS.has(kind))
    throw fail('WIN_JOURNAL_ACTION_INVALID');
  const {file,marker}=canonicalPaths(root);
  const fileExists=fs.existsSync(file);
  const markerExists=fs.existsSync(marker);
  if(method==='provision'){
    // QA bootstrap only. No automatic recovery or reprovision after a failed
    // bootstrap: the owner must investigate and preserve evidence manually.
    if(fileExists||markerExists)throw fail('WIN_JOURNAL_ALREADY_INITIALIZED');
    const generation=randomBytes(32).toString('hex');
    // The marker is created first; even interrupted SQLite initialization
    // leaves the next provisioning attempt in fail-closed state.
    exclusiveCreate(marker,generation);
    exclusiveCreate(file);
    const db=new DatabaseSync(file);
    try{
      db.exec('PRAGMA busy_timeout=4000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
      db.exec('BEGIN IMMEDIATE');
      try{
        db.exec([
          'CREATE TABLE journal_meta (',
          'id INTEGER PRIMARY KEY CHECK (id=1),',
          'generation TEXT NOT NULL );',
          'CREATE TABLE native_intents (',
          'seq INTEGER PRIMARY KEY AUTOINCREMENT,',
          'workspace_ref TEXT NOT NULL,',
          'operation_id TEXT NOT NULL UNIQUE,',
          'kind TEXT NOT NULL,',
          "state TEXT NOT NULL CHECK (state IN ('PREPARED','ACKED')),",
          'created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );',
          'CREATE INDEX native_intents_workspace ON native_intents(workspace_ref,seq);'
        ].join(' '));
        db.prepare('INSERT INTO journal_meta(id,generation) VALUES (1,?)').run(generation);
        db.exec('COMMIT');
      }catch(e){
        try{db.exec('ROLLBACK')}catch{}
        throw e;
      }
      return {provisioned:true};
    }finally{db.close();}
  }
  if(!fileExists&&!markerExists){
    if(method==='inspect')return null;
    throw fail('WIN_JOURNAL_UNINITIALIZED');
  }
  if(!fileExists||!markerExists)throw fail('WIN_JOURNAL_HISTORY_INCOMPLETE');
  const generation=markerGeneration(marker);
  const db=new DatabaseSync(file,{readOnly:method==='inspect'});
  try{
    const dbGeneration=db.prepare('SELECT generation FROM journal_meta WHERE id=1').get()?.generation;
    if(dbGeneration!==generation)throw fail('WIN_JOURNAL_GENERATION_MISMATCH');
    if(method==='inspect'){
      return db.prepare(
        'SELECT workspace_ref,operation_id,kind,state FROM native_intents WHERE operation_id=?'
      ).get(operationId)||null;
    }
    db.exec('PRAGMA busy_timeout=4000; PRAGMA synchronous=FULL;');
    const mode=Object.values(db.prepare('PRAGMA journal_mode').get())[0];
    const sync=Object.values(db.prepare('PRAGMA synchronous').get())[0];
    if(mode!=='delete'||sync!==2)throw fail('WIN_JOURNAL_DURABILITY_UNAVAILABLE');
    db.exec('BEGIN IMMEDIATE');
    try{
      if(method==='prepare'){
        const last=db.prepare(
          'SELECT state FROM native_intents WHERE workspace_ref=? ORDER BY seq DESC LIMIT 1'
        ).get(workspaceRef);
        if(last?.state==='PREPARED')throw fail('WIN_JOURNAL_WORKSPACE_UNCERTAIN');
        try{
          db.prepare(
            "INSERT INTO native_intents(workspace_ref,operation_id,kind,state) VALUES (?,?,?,'PREPARED')"
          ).run(workspaceRef,operationId,kind);
        }catch(e){
          if(e?.code?.startsWith('ERR_SQLITE_CONSTRAINT')||
            (e?.code==='ERR_SQLITE_ERROR'&&
              /^UNIQUE constraint failed: native_intents\.operation_id\b/.test(e.message)))
            throw fail('WIN_JOURNAL_OPERATION_REPLAY_DENIED');
          throw e;
        }
      }else{
        if(db.prepare(
          "UPDATE native_intents SET state='ACKED' WHERE workspace_ref=? AND operation_id=? AND state='PREPARED'"
        ).run(workspaceRef,operationId).changes!==1)
          throw fail('WIN_JOURNAL_ACK_FAILED');
      }
      db.exec('COMMIT');
    }catch(e){
      try{db.exec('ROLLBACK');}catch{}
      throw e;
    }
    return {committed:true};
  }finally{db.close();}
}
try{
  const args=process.argv.slice(2);
  if(args.length!==5)throw fail('WIN_JOURNAL_ARGUMENTS_INVALID');
  const result=operate(...args);
  process.stdout.write(JSON.stringify({ok:true,result}));
}catch(error){
  const code=typeof error?.code==='string'&&/^WIN_JOURNAL_[A-Z_]+$/.test(error.code)
    ?error.code:'WIN_JOURNAL_STORAGE_UNAVAILABLE';
  process.stdout.write(JSON.stringify({ok:false,code}));
  process.exitCode=2;
}
