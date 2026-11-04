// Owner-profile capability gap ledger. This records needs, not permission grants or test PASS.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const KEY=/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){1,9}$/;
const PROJECT=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const ERROR=/^[A-Z][A-Z0-9_]{1,79}$/;
const CATEGORIES=['GUI','BROWSER','PRIVILEGE','IDENTITY','WORKER','MODEL','CONNECTOR','INSTALLER','PLATFORM','WORKFLOW','OTHER'];
const CONSENTS=['NONE','NATIVE_USER','NATIVE_ADMIN','BROWSER_OWNER','OAUTH_OWNER','PORTAL_OWNER','EXTERNAL_PROVIDER'];
const STATES=['OPEN','TRIAGED','IMPLEMENTING','BLOCKED','READY_FOR_QA'];
const secrets=[/\b(?:authorization|cookie|set-cookie)\s*[:=]/i,/\b(?:password|passwd|client_secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key)\s*[:=]\s*\S+/i,/-----BEGIN [A-Z ]*PRIVATE KEY-----/i,/\b(?:sk|ghp|gho|github_pat)-[A-Za-z0-9_-]{12,}/i,/\bBearer\s+\S{12,}/i];
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=x=>{throw Object.assign(new Error(x),{capabilityGapCode:x});};
function check(s,min,max,err){
 if(typeof s!=='string'||s.length<min||s.length>max||s.trim()!==s||/[\u0000-\u001f\u007f]/.test(s))fail(err);
 if(secrets.some(r=>r.test(s)))fail('CAPABILITY_GAP_POSSIBLE_SECRET');
 return s;
}
function validKey(args){
 if(!args||typeof args!=='object'||Array.isArray(args)||typeof args.capabilityKey!=='string'||args.capabilityKey.length>112||!KEY.test(args.capabilityKey))fail('CAPABILITY_GAP_KEY_INVALID');
 return args.capabilityKey;
}
function validateReport(a){
 const key=validKey(a);
 if(!PROJECT.test(a.projectKey??''))fail('CAPABILITY_GAP_PROJECT_INVALID');
 if(!CATEGORIES.includes(a.category))fail('CAPABILITY_GAP_CATEGORY_INVALID');
 if(!CONSENTS.includes(a.consentGate))fail('CAPABILITY_GAP_CONSENT_INVALID');
 if(!ERROR.test(a.errorCode??''))fail('CAPABILITY_GAP_ERROR_INVALID');
 return {key,project:a.projectKey,category:a.category,consent:a.consentGate,error:a.errorCode,
   title:check(a.title,6,120,'CAPABILITY_GAP_TITLE_INVALID'),
   need:check(a.requiredBehavior,12,320,'CAPABILITY_GAP_NEED_INVALID'),
   observed:check(a.observedLimitation,8,640,'CAPABILITY_GAP_OBSERVATION_INVALID'),
   solution:a.candidateSolution===undefined?'':check(a.candidateSolution,10,500,'CAPABILITY_GAP_SOLUTION_INVALID'),
   acceptance:a.acceptanceTest===undefined?'':check(a.acceptanceTest,10,500,'CAPABILITY_GAP_ACCEPTANCE_INVALID')};
}
function noLinkDirectory(directory){
 if(typeof directory!=='string'||!path.isAbsolute(directory))fail('CAPABILITY_GAP_DIRECTORY_INVALID');
 const resolved=path.resolve(directory);
 let cursor=path.parse(resolved).root;
 for(const part of resolved.slice(cursor.length).split(path.sep).filter(Boolean)){
   cursor=path.join(cursor,part);
   let st;
   try{st=fs.lstatSync(cursor);}
   catch(e){if(e.code!=='ENOENT')throw e;fs.mkdirSync(cursor,{mode:0o700});st=fs.lstatSync(cursor);}
   if(!st.isDirectory()||st.isSymbolicLink())fail('CAPABILITY_GAP_STORE_ALIAS_DENIED');
 }
 return resolved;
}
function rowData(x){
 if(!x)return null;
 return {capabilityKey:x.capability_key,title:x.title,category:x.category,consentGate:x.consent_gate,
   requiredBehavior:x.required_behavior,candidateSolution:x.candidate_solution,acceptanceTest:x.acceptance_test,
   lastErrorCode:x.last_error_code,state:x.state,revision:Number(x.revision),
   observationCount:Number(x.observation_count),impactedProjects:JSON.parse(x.impacted_projects),
   impactedHosts:JSON.parse(x.impacted_hosts),createdAt:x.created_at,updatedAt:x.updated_at};
}
export class CapabilityGapRegistry{
 constructor({directory,scope='owner',device=os.hostname()}={}){
   this.directory=noLinkDirectory(directory);
   this.scope=check(scope,1,110,'CAPABILITY_GAP_SCOPE_INVALID');
   this.device=check(device,1,110,'CAPABILITY_GAP_DEVICE_INVALID');
   this.path=path.join(this.directory,'capability-gaps.sqlite');
   if(fs.existsSync(this.path)){
     const st=fs.lstatSync(this.path);
     if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)fail('CAPABILITY_GAP_STORE_ALIAS_DENIED');
   }
   this.db=new DatabaseSync(this.path,{allowExtension:false});
   fs.chmodSync(this.path,0o600);
   this.db.exec('PRAGMA busy_timeout=3000; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL;');
   if(this.db.prepare('PRAGMA journal_mode').get().journal_mode!=='delete')fail('CAPABILITY_GAP_JOURNAL_MODE_INVALID');
   if(Number(this.db.prepare('PRAGMA user_version').get().user_version)>1)fail('CAPABILITY_GAP_SCHEMA_TOO_NEW');
   this.db.exec('CREATE TABLE IF NOT EXISTS gaps(scope TEXT NOT NULL,capability_key TEXT NOT NULL,category TEXT NOT NULL,consent_gate TEXT NOT NULL,title TEXT NOT NULL,required_behavior TEXT NOT NULL,candidate_solution TEXT NOT NULL,acceptance_test TEXT NOT NULL,state TEXT NOT NULL,last_error_code TEXT NOT NULL,observation_count INTEGER NOT NULL,revision INTEGER NOT NULL,impacted_projects TEXT NOT NULL,impacted_hosts TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(scope,capability_key));');
   this.db.exec('CREATE TABLE IF NOT EXISTS observations(scope TEXT NOT NULL,capability_key TEXT NOT NULL,project_key TEXT NOT NULL,device TEXT NOT NULL,error_code TEXT NOT NULL,observed_hash TEXT NOT NULL,observed TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(scope,capability_key,project_key,device,error_code,observed_hash));');
   this.db.exec('CREATE INDEX IF NOT EXISTS capgap_state ON gaps(scope,state); PRAGMA user_version=1;');
 }
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const x=fn();this.db.exec('COMMIT');return x;}catch(e){try{this.db.exec('ROLLBACK');}catch{}throw e;}}
 get(key){
   if(typeof key!=='string'||!KEY.test(key))fail('CAPABILITY_GAP_KEY_INVALID');
   return rowData(this.db.prepare('SELECT * FROM gaps WHERE scope=? AND capability_key=?').get(this.scope,key));
 }
 report(args){
   const a=validateReport(args),device=this.device,now=new Date().toISOString();
   return this.transaction(()=>{
     const old=this.get(a.key);
     if(old&&(old.category!==a.category||old.consentGate!==a.consent))fail('CAPABILITY_GAP_IDENTITY_CONFLICT');
     // One stable functional key owns the canonical title/need; wording variations across chats are sightings, not new issues.
     const obs=this.db.prepare('INSERT OR IGNORE INTO observations(scope,capability_key,project_key,device,error_code,observed_hash,observed,at) VALUES(?,?,?,?,?,?,?,?)')
       .run(this.scope,a.key,a.project,device,a.error,hash(a.observed),a.observed,now);
     const distinct=obs.changes>0;
     if(!old){
       this.db.prepare("INSERT INTO gaps(scope,capability_key,category,consent_gate,title,required_behavior,candidate_solution,acceptance_test,state,last_error_code,observation_count,revision,impacted_projects,impacted_hosts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'OPEN',?,1,1,?,?,?,?)")
        .run(this.scope,a.key,a.category,a.consent,a.title,a.need,a.solution,a.acceptance,a.error,JSON.stringify([a.project]),JSON.stringify([device]),now,now);
       return {changed:true,created:true,record:this.get(a.key)};
     }
     const projects=[...new Set([...old.impactedProjects,a.project])].sort();
     const hosts=[...new Set([...old.impactedHosts,device])].sort();
     const acceptance=old.acceptanceTest||a.acceptance;
     const solution=old.candidateSolution||a.solution;
     const changed=distinct||acceptance!==old.acceptanceTest||solution!==old.candidateSolution||
        projects.length!==old.impactedProjects.length||hosts.length!==old.impactedHosts.length;
     if(changed){
       this.db.prepare('UPDATE gaps SET observation_count=observation_count+?,revision=revision+1,candidate_solution=?,acceptance_test=?,last_error_code=?,impacted_projects=?,impacted_hosts=?,updated_at=? WHERE scope=? AND capability_key=?')
        .run(distinct?1:0,solution,acceptance,a.error,JSON.stringify(projects),JSON.stringify(hosts),now,this.scope,a.key);
     }
     return {changed,created:false,record:this.get(a.key)};
   });
 }
 triage(args){
   const key=validKey(args);
   if(!STATES.includes(args.state)||args.state==='OPEN')fail('CAPABILITY_GAP_STATUS_INVALID');
   if(!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision<1)fail('CAPABILITY_GAP_REVISION_REQUIRED');
   const solution=check(args.candidateSolution,10,500,'CAPABILITY_GAP_SOLUTION_INVALID');
   const acceptance=check(args.acceptanceTest,10,500,'CAPABILITY_GAP_ACCEPTANCE_INVALID');
   return this.transaction(()=>{
     const old=this.get(key);
     if(!old)fail('CAPABILITY_GAP_NOT_FOUND');
     if(old.revision!==args.expectedRevision)fail('CAPABILITY_GAP_REVISION_CONFLICT');
     const changed=old.state!==args.state||old.candidateSolution!==solution||old.acceptanceTest!==acceptance;
     if(changed)this.db.prepare('UPDATE gaps SET state=?,candidate_solution=?,acceptance_test=?,revision=revision+1,updated_at=? WHERE scope=? AND capability_key=?')
       .run(args.state,solution,acceptance,new Date().toISOString(),this.scope,key);
     return {changed,record:this.get(key),acceptanceVerified:false,
       note:'Tracking does not grant native consent, administrator credentials or release PASS.'};
   });
 }
 evidence(args){
   const key=validKey(args),record=this.get(key);
   if(!record)fail('CAPABILITY_GAP_NOT_FOUND');
   const observations=this.db.prepare('SELECT project_key,device,error_code,observed,at FROM observations WHERE scope=? AND capability_key=? ORDER BY at DESC LIMIT 20').all(this.scope,key)
     .map(row=>({projectKey:row.project_key,device:row.device,errorCode:row.error_code,observedLimitation:row.observed,at:row.at}));
   return {record,observations,acceptanceVerified:false};
 }
 list({state,limit=50}={}){
   if(state!==undefined&&!STATES.includes(state))fail('CAPABILITY_GAP_STATUS_INVALID');
   if(!Number.isInteger(limit)||limit<1||limit>100)fail('CAPABILITY_GAP_LIMIT_INVALID');
   const rows=state?this.db.prepare('SELECT * FROM gaps WHERE scope=? AND state=? ORDER BY updated_at DESC LIMIT ?').all(this.scope,state,limit):
     this.db.prepare('SELECT * FROM gaps WHERE scope=? ORDER BY updated_at DESC LIMIT ?').all(this.scope,limit);
   return {items:rows.map(rowData),total:Number(this.db.prepare('SELECT COUNT(*) count FROM gaps WHERE scope=?').get(this.scope).count),
     sharedWithin:'same Commander profile across conversations and projects',fleetSync:false};
 }
 status(){
   const rows=this.db.prepare('SELECT state,COUNT(*) count FROM gaps WHERE scope=? GROUP BY state').all(this.scope);
   return {enabled:true,durable:true,profileScope:this.scope,states:Object.fromEntries(rows.map(r=>[r.state,Number(r.count)])),
     authorizationEffects:false,remoteFleetSync:false,passClaimAllowed:false,autoCaptureKnownNativeErrors:true};
 }
 close(){this.db.close();}
}
// Only deterministic native error codes are eligible. Never persist raw tool inputs or logs.
const AUTO_GAPS=Object.freeze({
 PORTAL_PERMISSION_NOT_GRANTED:{key:'gui.kde-portal.owner-grant',category:'GUI',consent:'PORTAL_OWNER',
  title:'KDE owner Portal capture grant unavailable',need:'Observe the owner KDE window under a real native Portal consent lease.',
  fix:'Present supported KDE Portal owner consent; bind it to the same window and effective owner.',
  test:'Native owner window snapshot succeeds after consent and fails before permission.'},
 PROFILE_ATTACH_NOT_READY:{key:'browser.owner-session.native-attach',category:'BROWSER',consent:'BROWSER_OWNER',
  title:'Owner browser session native attach unavailable',need:'Attach to an existing signed-in owner browser without copying credentials.',
  fix:'Discover the supported browser route and obtain scoped owner authorization through the native browser adapter.',
  test:'Authorized existing browser profile observation passes and cross-profile reuse fails.'},
 BLOCKED_PROVIDER_CONFIG_MISSING:{key:'identity.oauth.owner-issuer',category:'IDENTITY',consent:'OAUTH_OWNER',
  title:'Owner OAuth provider configuration unavailable',need:'Authenticate the trusted owner issuer and verify the exact per-chat grant.',
  fix:'Configure a trusted OAuth provider and test the existing owner consent and resource-server grant path.',
  test:'Real provider OAuth passes correct issuer and rejects cross-user or revoked grants.'},
 WORKSPACE_TARGET_GUI_UNAVAILABLE:{key:'gui.linux.target-route.native',category:'GUI',consent:'PORTAL_OWNER',
  title:'Native Linux GUI target route unavailable',need:'Observe existing Linux owner windows through a native session-safe backend.',
  fix:'Select supported owner KDE or GNOME route and obtain scoped portal consent when required.',
  test:'Enumerate and observe a real owner window and release the observer lease.'},
 PRIVILEGE_BROKER_NOT_READY:{key:'privilege.windows.broker-readiness',category:'PRIVILEGE',consent:'NATIVE_ADMIN',
  title:'Windows native privilege broker not ready',need:'Run one minimally authorized native elevated operation via the existing owner broker.',
  fix:'Repair broker with a bounded native UAC grant, not a permanent unrestricted administrator context.',
  test:'Permit one approved elevated operation and reject a different owner or disallowed operation.'}
});
function captureKnownFailure(registry,{tool,errorCode}={}){
 if(typeof tool!=='string'||!/^[a-z][a-z0-9_]{1,79}$/.test(tool)||typeof errorCode!=='string')return {captured:false};
 const code=/^([A-Z][A-Z0-9_]{1,79})(?=$|[:\s])/.exec(errorCode)?.[1];
 const spec=code?AUTO_GAPS[code]:undefined;
 if(!spec)return {captured:false};
 const result=registry.report({capabilityKey:spec.key,projectKey:'commander-runtime',
  category:spec.category,consentGate:spec.consent,title:spec.title,requiredBehavior:spec.need,
  observedLimitation:'Commander tool '+tool+' reported native error '+code+'.',
  errorCode:code,candidateSolution:spec.fix,acceptanceTest:spec.test});
 return {captured:true,changed:result.changed,capabilityKey:spec.key};
}
export function createCapabilityGapTools({directory,scope,device}={}){
 const registry=new CapabilityGapRegistry({directory,scope,device});
 const txt=(max,min=1)=>({type:'string',minLength:min,maxLength:max});
 const definitions=[
  {name:'capability_gap_report',description:'Durably report a missing Commander capability or permission; same capabilityKey is upserted across projects/conversations. No privilege or session grant results.',inputSchema:{
    type:'object',properties:{
      capabilityKey:{type:'string',pattern:KEY.source,maxLength:112},projectKey:{type:'string',pattern:PROJECT.source,maxLength:96},
      category:{type:'string',enum:CATEGORIES},consentGate:{type:'string',enum:CONSENTS},
      title:txt(120,6),requiredBehavior:txt(320,12),observedLimitation:txt(640,8),
      errorCode:{type:'string',pattern:ERROR.source,maxLength:80},acceptanceTest:txt(500,10),candidateSolution:txt(500,10)},
    required:['capabilityKey','projectKey','category','consentGate','title','requiredBehavior','observedLimitation','errorCode','requestId'],additionalProperties:false},
    annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
  {name:'capability_gap_list',description:'Read open capability gaps and their acceptance criteria across projects sharing the current Commander profile.',inputSchema:{
    type:'object',properties:{state:{type:'string',enum:STATES},limit:{type:'integer',minimum:1,maximum:100}},additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
  {name:'capability_gap_get',description:'Inspect the bounded recorded evidence and proposed acceptance test of one owner-profile gap, without elevating authority.',inputSchema:{
    type:'object',properties:{capabilityKey:{type:'string',pattern:KEY.source,maxLength:112}},required:['capabilityKey'],additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
  {name:'capability_gap_triage',description:'Record proposed repair, acceptance test and current implementation state with a revision guard; cannot mark PASS or grant elevated access.',inputSchema:{
    type:'object',properties:{capabilityKey:{type:'string',pattern:KEY.source,maxLength:112},
      expectedRevision:{type:'integer',minimum:1},state:{type:'string',enum:STATES.filter(x=>x!=='OPEN')},
      candidateSolution:txt(500,10),acceptanceTest:txt(500,10)},
    required:['capabilityKey','expectedRevision','state','candidateSolution','acceptanceTest','requestId'],additionalProperties:false},
    annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}}
 ];
 return {definitions,status:()=>registry.status(),close:()=>registry.close(),
   captureFailure:input=>captureKnownFailure(registry,input),
   execute:async(name,args={})=>{
     if(name==='capability_gap_report')return registry.report(args);
     if(name==='capability_gap_list')return registry.list(args);
     if(name==='capability_gap_get')return registry.evidence(args);
     if(name==='capability_gap_triage')return registry.triage(args);
     fail('CAPABILITY_GAP_UNKNOWN_TOOL');
   }};
}
