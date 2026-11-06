// Durable same-conversation continuation metadata.
// Stores bounded handoff envelopes/status only; never browser credentials, cookies, tokens, or chat transcripts.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROJECT=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const EVENT_TYPES=new Set([
  'PROCESS_EXIT','OPERATION_COMPLETED','OPERATION_FAILED','OPERATION_UNCERTAIN',
  'SOLVER_COMPLETE','NEW_RESULT_FILE','TIMEOUT_WITH_NO_PROGRESS','HASH_CHANGED',
  'PASS_GATE','FAIL_GATE','NONCONVERGENCE','ARTIFACT_CREATED','BLOCKER_DETECTED',
  'USER_APPROVAL_REQUIRED','PHASE_ADVANCED','NEEDS_CHAT'
]);
const fail=code=>{throw Object.assign(new Error(code),{conversationCode:code});};
const stable=value=>{
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
};
const digest=value=>createHash('sha256').update(typeof value==='string'?value:stable(value)).digest('hex');
const now=()=>new Date().toISOString();

function privateDirectory(directory){
  if(typeof directory!=='string'||!path.isAbsolute(directory)||/^(?:\\\\|\/\/)/.test(directory))fail('CONVERSATION_PRIVATE_DIRECTORY_REQUIRED');
  let cursor=path.parse(directory).root;
  for(const part of path.resolve(directory).slice(cursor.length).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,part);
    if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())fail('CONVERSATION_STATE_ALIAS');
  }
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  return fs.realpathSync.native(directory);
}
function safeId(value,code='CONVERSATION_INVALID_ID'){
  if(typeof value!=='string'||!ID.test(value))fail(code);
  return value;
}
function projectId(value){
  if(typeof value!=='string'||!PROJECT.test(value))fail('CONVERSATION_PROJECT_ID_INVALID');
  return value;
}
function boundedText(value,max,code='CONVERSATION_TEXT_INVALID'){
  if(typeof value!=='string'||value.length<1||Buffer.byteLength(value,'utf8')>max||value.includes('\0'))fail(code);
  return value;
}
function canonicalRoot(value){
  boundedText(value,4096,'CONVERSATION_ROOT_INVALID');
  if(!path.isAbsolute(value))fail('CONVERSATION_ROOT_INVALID');
  let real;
  try{real=fs.realpathSync.native(value);}catch{fail('CONVERSATION_ROOT_UNAVAILABLE');}
  const stat=fs.lstatSync(real);
  if(!stat.isDirectory()||stat.isSymbolicLink())fail('CONVERSATION_ROOT_INVALID');
  return real;
}
function decodeBinding(row){
  if(!row)return null;
  return {
    projectId:row.project_id,root:row.project_root,browser:row.browser,tabTitle:row.tab_title,
    composerNames:JSON.parse(row.composer_names),sendNames:JSON.parse(row.send_names),stopNames:JSON.parse(row.stop_names),
    state:row.state,createdAt:row.created_at,updatedAt:row.updated_at,lastSeenAt:row.last_seen_at
  };
}
function decodeHandoff(row){
  if(!row)return null;
  return {
    handoffId:row.id,projectId:row.project_id,eventKey:row.event_key,eventType:row.event_type,
    state:row.state,payload:JSON.parse(row.payload),messageHash:row.message_hash,attemptId:row.attempt_id,
    leaseUntil:row.lease_until,deferrals:row.deferrals,lastCode:row.last_code,
    nextAttemptAt:row.next_attempt_at,createdAt:row.created_at,updatedAt:row.updated_at,sentAt:row.sent_at
  };
}

export const CONVERSATION_EVENT_TYPES=Object.freeze([...EVENT_TYPES]);

export class ConversationStore{
  constructor({directory,scope='default'}){
    safeId(scope,'CONVERSATION_SCOPE_INVALID');
    this.scope=scope;
    this.directory=privateDirectory(directory);
    this.location=path.join(this.directory,'conversation.sqlite');
    for(const suffix of ['','-journal','-wal','-shm']){
      if(!fs.existsSync(this.location+suffix))continue;
      const stat=fs.lstatSync(this.location+suffix);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)fail('CONVERSATION_STATE_ALIAS');
    }
    this.db=new DatabaseSync(this.location,{allowExtension:false});
    try{fs.chmodSync(this.location,0o600);}catch{}
    this.db.exec('PRAGMA busy_timeout=3000; PRAGMA trusted_schema=OFF; PRAGMA synchronous=EXTRA;');
    if(this.db.prepare('PRAGMA journal_mode').get().journal_mode!=='delete'){this.db.close();fail('CONVERSATION_JOURNAL_MODE');}
    const version=this.db.prepare('PRAGMA user_version').get().user_version;
    if(version>1){this.db.close();fail('CONVERSATION_SCHEMA_TOO_NEW');}
    this.db.exec(`CREATE TABLE IF NOT EXISTS bindings(
      scope TEXT NOT NULL,project_id TEXT NOT NULL,project_root TEXT NOT NULL,browser TEXT NOT NULL,
      tab_title TEXT NOT NULL,composer_names TEXT NOT NULL,send_names TEXT NOT NULL,stop_names TEXT NOT NULL,
      state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_seen_at TEXT,
      PRIMARY KEY(scope,project_id));
      CREATE TABLE IF NOT EXISTS events(
      seq INTEGER PRIMARY KEY AUTOINCREMENT,scope TEXT NOT NULL,project_id TEXT NOT NULL,event_key TEXT NOT NULL,
      kind TEXT NOT NULL,payload_hash TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,
      UNIQUE(scope,event_key));
      CREATE TABLE IF NOT EXISTS handoffs(
      seq INTEGER PRIMARY KEY AUTOINCREMENT,scope TEXT NOT NULL,id TEXT NOT NULL,project_id TEXT NOT NULL,
      event_key TEXT NOT NULL,event_type TEXT NOT NULL,payload TEXT NOT NULL,payload_hash TEXT NOT NULL,
      message_hash TEXT NOT NULL,state TEXT NOT NULL,attempt_id TEXT,lease_until INTEGER,
      deferrals INTEGER NOT NULL DEFAULT 0,last_code TEXT,next_attempt_at INTEGER,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,sent_at TEXT,
      UNIQUE(scope,id),UNIQUE(scope,event_key));
      CREATE INDEX IF NOT EXISTS conversation_outbox ON handoffs(scope,state,next_attempt_at,seq);
      PRAGMA user_version=1;`);
    this.closed=false;
  }
  close(){if(this.closed)return;this.closed=true;this.db.close();}
  transaction(fn){
    this.db.exec('BEGIN IMMEDIATE');
    try{const value=fn();this.db.exec('COMMIT');return value;}
    catch(error){try{this.db.exec('ROLLBACK');}catch{}throw error;}
  }
  binding(pid){
    projectId(pid);
    return decodeBinding(this.db.prepare('SELECT * FROM bindings WHERE scope=? AND project_id=?').get(this.scope,pid));
  }
  bind({projectId:pid,root,browser='chrome',tabTitle,composerNames=['Ask ChatGPT'],sendNames=['Send','Send prompt','Submit'],stopNames=['Stop','Stop generating']}){
    pid=projectId(pid);root=canonicalRoot(root);boundedText(tabTitle,300,'CONVERSATION_TAB_TITLE_INVALID');
    if(!['chrome','edge'].includes(browser))fail('CONVERSATION_BROWSER_INVALID');
    for(const [items,code] of [[composerNames,'COMPOSER'],[sendNames,'SEND'],[stopNames,'STOP']]){
      if(!Array.isArray(items)||items.length<1||items.length>10||items.some(x=>typeof x!=='string'||!x.trim()||x.length>120))fail('CONVERSATION_'+code+'_NAMES_INVALID');
    }
    const existing=this.binding(pid),stamp=now();
    this.db.prepare(`INSERT INTO bindings(scope,project_id,project_root,browser,tab_title,composer_names,send_names,stop_names,state,created_at,updated_at,last_seen_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)
      ON CONFLICT(scope,project_id) DO UPDATE SET project_root=excluded.project_root,browser=excluded.browser,
      tab_title=excluded.tab_title,composer_names=excluded.composer_names,send_names=excluded.send_names,
      stop_names=excluded.stop_names,state='BOUND',updated_at=excluded.updated_at`)
      .run(this.scope,pid,root,browser,tabTitle,stable(composerNames),stable(sendNames),stable(stopNames),'BOUND',existing?.createdAt??stamp,stamp);
    return this.binding(pid);
  }
  unbind(pid){
    pid=projectId(pid);
    if(!this.binding(pid))return {projectId:pid,unbound:false};
    this.transaction(()=>{
      this.db.prepare("UPDATE bindings SET state='UNBOUND',updated_at=? WHERE scope=? AND project_id=?").run(now(),this.scope,pid);
      this.db.prepare("UPDATE handoffs SET state='CANCELLED',updated_at=?,last_code='CONVERSATION_UNBOUND' WHERE scope=? AND project_id=? AND state IN ('QUEUED','CLAIMED','DEFERRED')")
        .run(now(),this.scope,pid);
    });
    return {projectId:pid,unbound:true};
  }
  markBinding(pid,state,{seen=false}={}){
    pid=projectId(pid);boundedText(state,64,'CONVERSATION_BINDING_STATE_INVALID');
    const stamp=now();
    this.db.prepare('UPDATE bindings SET state=?,updated_at=?,last_seen_at=CASE WHEN ?=1 THEN ? ELSE last_seen_at END WHERE scope=? AND project_id=?')
      .run(state,stamp,seen?1:0,stamp,this.scope,pid);
    return this.binding(pid);
  }
  enqueue({projectId:pid,eventKey,eventType,payload,message}){
    pid=projectId(pid);safeId(eventKey,'CONVERSATION_EVENT_KEY_INVALID');
    if(!EVENT_TYPES.has(eventType))fail('CONVERSATION_EVENT_TYPE_INVALID');
    const binding=this.binding(pid);
    if(!binding||binding.state==='UNBOUND')fail('CONVERSATION_NOT_BOUND');
    boundedText(message,12000,'CONVERSATION_MESSAGE_INVALID');
    const encoded=stable(payload??{});
    if(Buffer.byteLength(encoded,'utf8')>16000)fail('CONVERSATION_PAYLOAD_TOO_LARGE');
    const payloadHash=digest(encoded),messageHash=digest(message),stamp=now();
    return this.transaction(()=>{
      this.db.prepare('INSERT OR IGNORE INTO events(scope,project_id,event_key,kind,payload_hash,payload,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(this.scope,pid,eventKey,eventType,payloadHash,encoded,stamp);
      const event=this.db.prepare('SELECT project_id,kind,payload_hash FROM events WHERE scope=? AND event_key=?').get(this.scope,eventKey);
      if(event.project_id!==pid||event.kind!==eventType||event.payload_hash!==payloadHash)fail('CONVERSATION_EVENT_CONFLICT');
      this.db.prepare(`INSERT OR IGNORE INTO handoffs(scope,id,project_id,event_key,event_type,payload,payload_hash,message_hash,state,created_at,updated_at,next_attempt_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(this.scope,randomUUID(),pid,eventKey,eventType,encoded,payloadHash,messageHash,'QUEUED',stamp,stamp,Date.now());
      const row=this.db.prepare('SELECT * FROM handoffs WHERE scope=? AND event_key=?').get(this.scope,eventKey);
      if(row.project_id!==pid||row.event_type!==eventType||row.payload_hash!==payloadHash||row.message_hash!==messageHash)fail('CONVERSATION_HANDOFF_CONFLICT');
      return decodeHandoff(row);
    });
  }
  get(handoffId){
    safeId(handoffId);
    const row=this.db.prepare('SELECT * FROM handoffs WHERE scope=? AND id=?').get(this.scope,handoffId);
    if(!row)fail('CONVERSATION_HANDOFF_NOT_FOUND');
    return decodeHandoff(row);
  }
  pending(pid){
    if(pid!==undefined)projectId(pid);
    return this.db.prepare(`SELECT * FROM handoffs WHERE scope=? AND (? IS NULL OR project_id=?)
      AND state IN ('QUEUED','CLAIMED','DEFERRED','UNCERTAIN') ORDER BY seq LIMIT 100`)
      .all(this.scope,pid??null,pid??null).map(decodeHandoff);
  }
  claimNext({leaseMs=30000}={}){
    if(!Number.isSafeInteger(leaseMs)||leaseMs<5000||leaseMs>120000)fail('CONVERSATION_LEASE_INVALID');
    return this.transaction(()=>{
      const stamp=Date.now(),iso=now();
      this.db.prepare("UPDATE handoffs SET state='DEFERRED',attempt_id=NULL,lease_until=NULL,last_code='LEASE_EXPIRED',next_attempt_at=?,updated_at=? WHERE scope=? AND state='CLAIMED' AND lease_until<?")
        .run(stamp,iso,this.scope,stamp);
      const row=this.db.prepare(`SELECT * FROM handoffs WHERE scope=? AND state IN ('QUEUED','DEFERRED')
        AND COALESCE(next_attempt_at,0)<=? ORDER BY seq LIMIT 1`).get(this.scope,stamp);
      if(!row)return null;
      const attempt=randomUUID();
      this.db.prepare("UPDATE handoffs SET state='CLAIMED',attempt_id=?,lease_until=?,updated_at=? WHERE scope=? AND id=?")
        .run(attempt,stamp+leaseMs,iso,this.scope,row.id);
      return this.get(row.id);
    });
  }
  defer(id,attemptId,code,delayMs){
    safeId(id);safeId(attemptId);boundedText(code,120,'CONVERSATION_RESULT_CODE_INVALID');
    if(!Number.isSafeInteger(delayMs)||delayMs<1000||delayMs>15*60*1000)fail('CONVERSATION_DELAY_INVALID');
    return this.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM handoffs WHERE scope=? AND id=?').get(this.scope,id);
      if(!row||row.state!=='CLAIMED'||row.attempt_id!==attemptId)fail('CONVERSATION_CLAIM_LOST');
      this.db.prepare("UPDATE handoffs SET state='DEFERRED',attempt_id=NULL,lease_until=NULL,deferrals=deferrals+1,last_code=?,next_attempt_at=?,updated_at=? WHERE scope=? AND id=?")
        .run(code,Date.now()+delayMs,now(),this.scope,id);
      return this.get(id);
    });
  }
  sent(id,attemptId,code='UI_ACKNOWLEDGED'){
    safeId(id);safeId(attemptId);boundedText(code,120,'CONVERSATION_RESULT_CODE_INVALID');
    return this.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM handoffs WHERE scope=? AND id=?').get(this.scope,id);
      if(!row||row.state!=='CLAIMED'||row.attempt_id!==attemptId)fail('CONVERSATION_CLAIM_LOST');
      const stamp=now();
      this.db.prepare("UPDATE handoffs SET state='SENT',lease_until=NULL,last_code=?,sent_at=?,updated_at=? WHERE scope=? AND id=?")
        .run(code,stamp,stamp,this.scope,id);
      return this.get(id);
    });
  }
  uncertain(id,attemptId,code='SEND_OUTCOME_UNCERTAIN'){
    safeId(id);safeId(attemptId);boundedText(code,120,'CONVERSATION_RESULT_CODE_INVALID');
    return this.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM handoffs WHERE scope=? AND id=?').get(this.scope,id);
      if(!row||row.state!=='CLAIMED'||row.attempt_id!==attemptId)fail('CONVERSATION_CLAIM_LOST');
      this.db.prepare("UPDATE handoffs SET state='UNCERTAIN',lease_until=NULL,last_code=?,updated_at=? WHERE scope=? AND id=?")
        .run(code,now(),this.scope,id);
      return this.get(id);
    });
  }
  cancelEvent(pid,eventKey){
    pid=projectId(pid);safeId(eventKey,'CONVERSATION_EVENT_KEY_INVALID');
    return this.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM handoffs WHERE scope=? AND project_id=? AND event_key=?').get(this.scope,pid,eventKey);
      if(!row)return {projectId:pid,eventKey,cancelled:false,state:'ABSENT'};
      if(row.state==='SENT'||row.state==='CANCELLED')return {projectId:pid,eventKey,cancelled:row.state==='CANCELLED',state:row.state};
      if(row.state==='CLAIMED')fail('CONVERSATION_CLAIM_BUSY');
      this.db.prepare("UPDATE handoffs SET state='CANCELLED',attempt_id=NULL,lease_until=NULL,last_code='WORKFLOW_RESUMED',updated_at=? WHERE scope=? AND id=?")
        .run(now(),this.scope,row.id);
      return {projectId:pid,eventKey,cancelled:true,state:'CANCELLED'};
    });
  }
  resolveUncertain(id,action){
    safeId(id);
    if(!['confirm_sent','retry','cancel'].includes(action))fail('CONVERSATION_RESOLUTION_INVALID');
    return this.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM handoffs WHERE scope=? AND id=?').get(this.scope,id);
      if(!row)fail('CONVERSATION_HANDOFF_NOT_FOUND');
      if(action==='confirm_sent'&&row.state==='SENT')return decodeHandoff(row);
      if(action==='cancel'&&row.state==='CANCELLED')return decodeHandoff(row);
      if(action==='retry'&&['QUEUED','DEFERRED','CLAIMED'].includes(row.state))return decodeHandoff(row);
      if(row.state!=='UNCERTAIN')fail('CONVERSATION_RESOLUTION_NOT_APPLICABLE');
      const stamp=now();
      if(action==='confirm_sent'){
        this.db.prepare("UPDATE handoffs SET state='SENT',attempt_id=NULL,lease_until=NULL,last_code='EXPLICIT_CONFIRM_SENT',sent_at=?,updated_at=? WHERE scope=? AND id=?")
          .run(stamp,stamp,this.scope,id);
      }else if(action==='cancel'){
        this.db.prepare("UPDATE handoffs SET state='CANCELLED',attempt_id=NULL,lease_until=NULL,last_code='EXPLICIT_CANCEL',updated_at=? WHERE scope=? AND id=?")
          .run(stamp,this.scope,id);
      }else{
        this.db.prepare("UPDATE handoffs SET state='DEFERRED',attempt_id=NULL,lease_until=NULL,last_code='EXPLICIT_RETRY',next_attempt_at=?,updated_at=? WHERE scope=? AND id=?")
          .run(Date.now(),stamp,this.scope,id);
      }
      return this.get(id);
    });
  }
  nextDue(){
    const row=this.db.prepare("SELECT MIN(COALESCE(next_attempt_at,0)) AS due FROM handoffs WHERE scope=? AND state IN ('QUEUED','DEFERRED')").get(this.scope);
    return typeof row?.due==='number'?row.due:null;
  }
  stats(){
    const counts=Object.fromEntries(this.db.prepare('SELECT state,count(*) AS n FROM handoffs WHERE scope=? GROUP BY state').all(this.scope).map(row=>[row.state,row.n]));
    return {
      schema:1,scope:this.scope,
      bindings:this.db.prepare("SELECT count(*) AS n FROM bindings WHERE scope=? AND state!='UNBOUND'").get(this.scope).n,
      counts,pending:(counts.QUEUED??0)+(counts.CLAIMED??0)+(counts.DEFERRED??0),uncertain:counts.UNCERTAIN??0
    };
  }
}
