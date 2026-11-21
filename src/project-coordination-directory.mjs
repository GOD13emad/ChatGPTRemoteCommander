// Metadata-only, owner-scoped project continuity index (RC013 candidate).
// It does NOT grant MCP tools, assert actual ChatGPT identity, read transcripts,
// infer a ChatGPT project, auto-send to a chat or coordinate cross-host locks.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROJECT=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const STATES=new Set(['OBSERVED','FAILED','BLOCKED','UNCERTAIN','EVIDENCE_READY']);
const fail=code=>{throw Object.assign(new Error(code),{projectHubCode:code});};
const hash=s=>createHash('sha256').update(s).digest('hex');
function id(value,label,re=ID){
  if(typeof value!=='string'||!re.test(value))fail('PROJECT_HUB_'+label+'_INVALID');
  return value;
}
function privateDir(d){
  if(typeof d!=='string'||!path.isAbsolute(d))fail('PROJECT_HUB_DIRECTORY_INVALID');
  let next=path.parse(d).root;
  for(const part of path.resolve(d).slice(next.length).split(path.sep).filter(Boolean)){
    next=path.join(next,part);
    if(fs.existsSync(next)&&fs.lstatSync(next).isSymbolicLink())
      fail('PROJECT_HUB_SYMLINK_FORBIDDEN');
  }
  fs.mkdirSync(d,{recursive:true,mode:0o700});
  return fs.realpathSync.native(d);
}
function rootPath(root){
  if(typeof root!=='string'||!path.isAbsolute(root))
    fail('PROJECT_HUB_ROOT_INVALID');
  let prefix=path.parse(root).root;
  for(const part of path.resolve(root).slice(prefix.length).split(path.sep).filter(Boolean)){
    prefix=path.join(prefix,part);
    if(fs.existsSync(prefix)&&fs.lstatSync(prefix).isSymbolicLink())
      fail('PROJECT_HUB_ROOT_ALIAS');
  }
  const actual=fs.realpathSync.native(root);
  if(!fs.statSync(actual).isDirectory())fail('PROJECT_HUB_ROOT_INVALID');
  return actual;
}
function trustedRoute(route){
  // ONLY the injected, already-authenticated ingress resolver supplies this.
  if(!route||typeof route!=='object'||Array.isArray(route)
    ||route.source!=='TRUSTED_CONNECTOR_ROUTE'||route.verified!==true
    ||!['hostId','principalId','profileId','conversationId','bindingId','tunnelBindingHash']
      .every(k=>typeof route[k]==='string'&&ID.test(route[k]))
    ||typeof route.tunnelBindingHash!=='string'
    ||!HASH.test(route.tunnelBindingHash))
    fail('PROJECT_HUB_TRUSTED_ROUTE_REQUIRED');
  return Object.freeze({
    hostId:route.hostId,principalId:route.principalId,
    profileId:route.profileId,conversationId:route.conversationId,
    bindingHash:hash(route.bindingId),tunnelBindingHash:route.tunnelBindingHash
  });
}
function checkedEvidence({eventKey,operationId,outcome,evidenceSha256}){
  id(eventKey,'EVENT_KEY');id(operationId,'OPERATION');
  if(!STATES.has(outcome))fail('PROJECT_HUB_EVENT_STATE_INVALID');
  if(typeof evidenceSha256!=='string'||!HASH.test(evidenceSha256))
    fail('PROJECT_HUB_EVIDENCE_HASH_REQUIRED');
  return {eventKey,operationId,outcome,evidenceSha256};
}
export class ProjectCoordinationDirectory{
  constructor({directory,resolveAttestedRoute,authorizeProject}){
    if(typeof resolveAttestedRoute!=='function'
      ||typeof authorizeProject!=='function')
      fail('PROJECT_HUB_AUTH_CALLBACK_REQUIRED');
    this.resolveAttestedRoute=resolveAttestedRoute;
    this.authorizeProject=authorizeProject;
    this.directory=privateDir(directory);
    this.location=path.join(this.directory,'project-conversations.sqlite');
    for(const suffix of ['','-journal','-wal','-shm']){
      if(!fs.existsSync(this.location+suffix))continue;
      const s=fs.lstatSync(this.location+suffix);
      if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)
        fail('PROJECT_HUB_DATABASE_ALIAS');
    }
    this.db=new DatabaseSync(this.location,{allowExtension:false});
    try{fs.chmodSync(this.location,0o600);}catch{}
    this.db.exec('PRAGMA busy_timeout=2500; PRAGMA trusted_schema=OFF; PRAGMA synchronous=EXTRA; PRAGMA foreign_keys=ON;');
    const version=this.db.prepare('PRAGMA user_version').get().user_version;
    if(version>1){this.db.close();fail('PROJECT_HUB_SCHEMA_TOO_NEW');}
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS projects ('+
      'id TEXT PRIMARY KEY, root TEXT NOT NULL, created_at TEXT NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS contexts ('+
      'project_id TEXT NOT NULL REFERENCES projects(id),'+
      'host TEXT NOT NULL, principal TEXT NOT NULL, profile TEXT NOT NULL,'+
      'conversation TEXT NOT NULL, binding_hash TEXT NOT NULL,'+
      'tunnel_hash TEXT NOT NULL, created_at TEXT NOT NULL,'+
      'PRIMARY KEY(project_id,host,principal,profile,conversation),'+
      'UNIQUE(host,principal,profile,conversation));'+
      'CREATE TABLE IF NOT EXISTS events ('+
      'project_id TEXT NOT NULL REFERENCES projects(id), event_key TEXT NOT NULL,'+
      'operation TEXT NOT NULL, outcome TEXT NOT NULL, evidence_sha256 TEXT NOT NULL,'+
      'host TEXT NOT NULL, principal TEXT NOT NULL, profile TEXT NOT NULL,'+
      'conversation TEXT NOT NULL, created_at TEXT NOT NULL,'+
      'PRIMARY KEY(project_id,event_key));'+
      'PRAGMA user_version=1;'
    );
  }
  close(){this.db.close();}
  tx(fn){
    this.db.exec('BEGIN IMMEDIATE');
    try{const result=fn();this.db.exec('COMMIT');return result;}
    catch(e){try{this.db.exec('ROLLBACK');}catch{}throw e;}
  }
  async route(){
    // The caller has no route argument. No MCP-provided principal or Chat URL
    // is trusted. A production adapter MUST resolve an attested current caller.
    return trustedRoute(await this.resolveAttestedRoute());
  }
  async enroll({projectId,root,ownerProof}){
    id(projectId,'PROJECT_ID',PROJECT);
    const att=await this.route();
    const actionRoot=rootPath(root);
    if(await this.authorizeProject({action:'enroll',projectId,att,ownerProof})!==true)
      fail('PROJECT_HUB_OWNER_APPROVAL_REQUIRED');
    return this.tx(()=>{
      const existing=this.db.prepare('SELECT root FROM projects WHERE id=?').get(projectId);
      if(existing&&existing.root!==actionRoot)fail('PROJECT_HUB_ROOT_CONFLICT');
      this.db.prepare('INSERT OR IGNORE INTO projects(id,root,created_at) VALUES(?,?,?)')
        .run(projectId,actionRoot,new Date().toISOString());
      this.#join(projectId,att);
      return this.#snapshot(projectId);
    });
  }
  async join({projectId,ownerProof}){
    id(projectId,'PROJECT_ID',PROJECT);
    const att=await this.route();
    if(await this.authorizeProject({action:'join',projectId,att,ownerProof})!==true)
      fail('PROJECT_HUB_OWNER_APPROVAL_REQUIRED');
    return this.tx(()=>{
      if(!this.db.prepare('SELECT 1 FROM projects WHERE id=?').get(projectId))
        fail('PROJECT_HUB_PROJECT_UNKNOWN');
      this.#join(projectId,att);
      return this.#snapshot(projectId);
    });
  }
  #join(projectId,att){
    const existing=this.db.prepare(
      'SELECT binding_hash,tunnel_hash FROM contexts '+
      'WHERE project_id=? AND host=? AND principal=? AND profile=? AND conversation=?'
    ).get(projectId,att.hostId,att.principalId,att.profileId,att.conversationId);
    if(existing){
      if(existing.binding_hash!==att.bindingHash||existing.tunnel_hash!==att.tunnelBindingHash)
        fail('PROJECT_HUB_EXPIRED_BINDING_REAPPROVAL_REQUIRED');
      return;
    }
    const assigned=this.db.prepare(
      'SELECT project_id FROM contexts WHERE host=? AND principal=? AND profile=? AND conversation=?'
    ).get(att.hostId,att.principalId,att.profileId,att.conversationId);
    if(assigned)fail('PROJECT_HUB_CHAT_ALREADY_ASSIGNED');
    this.db.prepare(
      'INSERT INTO contexts(project_id,host,principal,profile,conversation,binding_hash,tunnel_hash,created_at) VALUES(?,?,?,?,?,?,?,?)'
    ).run(projectId,att.hostId,att.principalId,att.profileId,att.conversationId,
      att.bindingHash,att.tunnelBindingHash,new Date().toISOString());
  }
  #requireMember(projectId,att){
    const row=this.db.prepare(
      'SELECT binding_hash,tunnel_hash FROM contexts WHERE '+
      'project_id=? AND host=? AND principal=? AND profile=? AND conversation=?'
    ).get(projectId,att.hostId,att.principalId,att.profileId,att.conversationId);
    if(!row||row.binding_hash!==att.bindingHash||row.tunnel_hash!==att.tunnelBindingHash)
      fail('PROJECT_HUB_CURRENT_CHAT_NOT_MEMBER');
  }
  #snapshot(projectId){
    const p=this.db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
    if(!p)fail('PROJECT_HUB_PROJECT_UNKNOWN');
    const n=this.db.prepare('SELECT COUNT(*) AS n FROM contexts WHERE project_id=?').get(projectId).n;
    const events=this.db.prepare('SELECT COUNT(*) AS n FROM events WHERE project_id=?').get(projectId).n;
    return Object.freeze({
      projectId,canonicalRoot:p.root,registeredChats:Number(n),
      eventCount:Number(events),
      authority:'EXISTING_PROJECT_BRAIN_AND_WORKFLOW_STORE',
      next:'READ_LIVE_BRAIN_AND_CHECK_GLOBAL_WRITER_LEASE',
      executionAllowed:false,notionIsAuthority:false,
      globallyFencedWriter:false
    });
  }
  async snapshot(projectId){
    id(projectId,'PROJECT_ID',PROJECT);
    const att=await this.route();
    this.#requireMember(projectId,att);
    return this.#snapshot(projectId);
  }
  async observe(projectId,event){
    id(projectId,'PROJECT_ID',PROJECT);
    const att=await this.route();
    this.#requireMember(projectId,att);
    const value=checkedEvidence(event);
    return this.tx(()=>{
      const prior=this.db.prepare(
        'SELECT operation,outcome,evidence_sha256,host,principal,profile,conversation '+
        'FROM events WHERE project_id=? AND event_key=?'
      ).get(projectId,value.eventKey);
      if(prior){
        if(prior.operation!==value.operationId||prior.outcome!==value.outcome
          ||prior.evidence_sha256!==value.evidenceSha256
          ||prior.host!==att.hostId||prior.principal!==att.principalId
          ||prior.profile!==att.profileId||prior.conversation!==att.conversationId)
          fail('PROJECT_HUB_EVENT_CONFLICT');
        return Object.freeze({projectId,eventKey:value.eventKey,stored:true,reused:true,verified:false});
      }
      this.db.prepare(
        'INSERT INTO events(project_id,event_key,operation,outcome,evidence_sha256,host,principal,profile,conversation,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
      ).run(projectId,value.eventKey,value.operationId,value.outcome,value.evidenceSha256,
        att.hostId,att.principalId,att.profileId,att.conversationId,new Date().toISOString());
      return Object.freeze({projectId,eventKey:value.eventKey,stored:true,reused:false,verified:false});
    });
  }
}
